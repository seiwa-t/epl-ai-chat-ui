"""
OpenAI Engine - GPT API実装

Prompt Caching について:
- OpenAI は自動キャッシュ（明示的指定不要）
- 1024トークン以上の共通プレフィックスで自動適用
- 5-10分TTL
- 読み込み料金: 50% 割引（キャッシュヒット時）
- EPLのsystem_promptは十分大きいので自動キャッシュされる
"""
import os
import json
import uuid
from openai import AsyncOpenAI
from .engine import LLMEngine, ToolResponse, ContentBlock, ToolCall
from .core_loader import CACHE_BREAK_MARKER


class OpenAIEngine(LLMEngine):

    def __init__(self, api_key: str = "", model: str = "gpt-4o"):
        self.model = model
        key = api_key or os.environ.get("OPENAI_API_KEY", "")
        if not key:
            raise ValueError(
                "OpenAI APIキーが設定されていません。"
                "config.yaml の engine.openai.api_key に設定するか、"
                "環境変数 OPENAI_API_KEY を設定してください。"
            )
        self.client = AsyncOpenAI(api_key=key)
        # トークン使用量（send_message後に参照可能）
        self.last_input_tokens = 0
        self.last_output_tokens = 0

    def _to_oai_messages(self, system_prompt: str, messages: list[dict]) -> list[dict]:
        """共通形式のメッセージをOpenAI形式に変換する"""
        # キャッシュ境界マーカーを除去（OpenAIは自動キャッシュなので明示分割不要）
        if system_prompt and CACHE_BREAK_MARKER in system_prompt:
            system_prompt = system_prompt.replace(CACHE_BREAK_MARKER, "")
        oai_messages = [{"role": "system", "content": system_prompt}]
        for m in messages:
            role = m["role"]
            content = m["content"]

            # Claude形式のcontent（list of blocks）をOpenAI形式に変換
            if isinstance(content, list):
                text_parts = []
                tool_calls_for_msg = []
                tool_results_for_msg = []

                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text_parts.append(block["text"])
                        elif block.get("type") == "tool_use":
                            # assistantのtool_use → OpenAIのtool_calls
                            tool_calls_for_msg.append({
                                "id": block.get("id", str(uuid.uuid4())[:8]),
                                "type": "function",
                                "function": {
                                    "name": block["name"],
                                    "arguments": json.dumps(block.get("input", {}), ensure_ascii=False),
                                },
                            })
                        elif block.get("type") == "tool_result":
                            # userのtool_result → OpenAIのtoolメッセージ
                            tool_results_for_msg.append({
                                "role": "tool",
                                "tool_call_id": block.get("tool_use_id", ""),
                                "content": str(block.get("content", "")),
                            })
                        elif block.get("type") == "image":
                            # Claude形式の画像 → OpenAI vision形式に変換
                            source = block.get("source", {})
                            if source.get("type") == "base64":
                                media_type = source.get("media_type", "image/jpeg")
                                data = source.get("data", "")
                                text_parts.append({
                                    "type": "image_url",
                                    "image_url": {"url": f"data:{media_type};base64,{data}"},
                                })
                    elif isinstance(block, str):
                        text_parts.append(block)

                # text_partsに画像dict(image_url)が含まれるかチェック
                has_image = any(isinstance(p, dict) for p in text_parts)

                def _build_content_parts(parts):
                    """text_parts を OpenAI content配列に変換（text + image_url混在対応）"""
                    result = []
                    for p in parts:
                        if isinstance(p, dict):
                            result.append(p)  # image_url block
                        elif isinstance(p, str) and p:
                            result.append({"type": "text", "text": p})
                    return result

                # assistantメッセージ + tool_calls
                if role == "assistant":
                    msg = {"role": "assistant"}
                    if text_parts:
                        # assistantは画像を含まないのでテキスト結合
                        str_parts = [p for p in text_parts if isinstance(p, str)]
                        msg["content"] = "\n".join(str_parts) if str_parts else None
                    else:
                        msg["content"] = None
                    if tool_calls_for_msg:
                        msg["tool_calls"] = tool_calls_for_msg
                    oai_messages.append(msg)
                # userメッセージにtool_resultが含まれる場合 → toolメッセージに変換
                elif tool_results_for_msg:
                    for tr in tool_results_for_msg:
                        oai_messages.append(tr)
                elif has_image:
                    # 画像+テキスト混在 → OpenAI vision形式（content配列）
                    oai_messages.append({"role": role, "content": _build_content_parts(text_parts)})
                else:
                    oai_messages.append({"role": role, "content": "\n".join(text_parts) if text_parts else str(content)})
            else:
                oai_messages.append({"role": role, "content": content})
        # サニタイズ: orphaned tool_calls を除去
        # (tool_callsを持つassistantメッセージの後にtoolメッセージがない場合、tool_callsを削除)
        sanitized = []
        for i, msg in enumerate(oai_messages):
            if msg.get("role") == "assistant" and msg.get("tool_calls"):
                # このtool_callsのIDに対応するtoolメッセージがあるか確認
                tc_ids = {tc["id"] for tc in msg["tool_calls"]}
                found_ids = set()
                for j in range(i + 1, len(oai_messages)):
                    if oai_messages[j].get("role") == "tool" and oai_messages[j].get("tool_call_id") in tc_ids:
                        found_ids.add(oai_messages[j]["tool_call_id"])
                    elif oai_messages[j].get("role") in ("user", "assistant"):
                        break  # 次のuser/assistantメッセージに到達
                if not found_ids:
                    # 全tool_callが孤立 → tool_callsを除去してテキストだけ残す
                    sanitized.append({"role": "assistant", "content": msg.get("content") or ""})
                elif found_ids != tc_ids:
                    # 一部だけ孤立 → 対応するものだけ残す
                    msg_copy = {**msg, "tool_calls": [tc for tc in msg["tool_calls"] if tc["id"] in found_ids]}
                    sanitized.append(msg_copy)
                else:
                    sanitized.append(msg)
            else:
                sanitized.append(msg)
        return sanitized

    def _convert_tools(self, tools: list[dict]) -> list[dict]:
        """EPL共通ツール定義（Claude形式）→ OpenAI形式に変換"""
        oai_tools = []
        for t in tools:
            oai_tools.append({
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
                },
            })
        return oai_tools

    async def send_message(
        self,
        system_prompt: str,
        messages: list[dict],
        model_override: str = "",
    ) -> str:
        oai_messages = self._to_oai_messages(system_prompt, messages)
        # 他エンジンのモデル名が来たら無視
        _model = model_override if model_override and (model_override.startswith("gpt") or model_override.startswith("o") or model_override.startswith("chatgpt")) else ""

        response = await self.client.chat.completions.create(
            model=_model or self.model,
            max_tokens=4096,
            messages=oai_messages,
        )
        # トークン使用量を記録
        if response.usage:
            self.last_input_tokens = response.usage.prompt_tokens or 0
            self.last_output_tokens = response.usage.completion_tokens or 0
        return response.choices[0].message.content or ""

    async def send_message_with_tool(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict],
        model_override: str = "",
        max_tokens: int = 4096,
    ) -> ToolResponse:
        """OpenAI API → 共通 ToolResponse に変換"""
        oai_messages = self._to_oai_messages(system_prompt, messages)
        oai_tools = self._convert_tools(tools)
        _model = model_override if model_override and (model_override.startswith("gpt") or model_override.startswith("o") or model_override.startswith("chatgpt")) else ""

        response = await self.client.chat.completions.create(
            model=_model or self.model,
            max_tokens=max_tokens,
            messages=oai_messages,
            tools=oai_tools if oai_tools else None,
        )

        # トークン使用量を記録
        input_tokens = 0
        output_tokens = 0
        if response.usage:
            input_tokens = response.usage.prompt_tokens or 0
            output_tokens = response.usage.completion_tokens or 0
            self.last_input_tokens = input_tokens
            self.last_output_tokens = output_tokens

        choice = response.choices[0]
        msg = choice.message
        content_blocks = []

        # テキスト部分
        if msg.content:
            content_blocks.append(ContentBlock(type="text", text=msg.content))

        # ツール呼び出し部分
        has_tool_calls = False
        if msg.tool_calls:
            has_tool_calls = True
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except (json.JSONDecodeError, TypeError):
                    args = {}
                content_blocks.append(ContentBlock(
                    type="tool_use",
                    tool_call=ToolCall(
                        id=tc.id,
                        name=tc.function.name,
                        input=args,
                    ),
                ))

        # stop_reason の変換: GPT "tool_calls" → 共通 "tool_use"
        if has_tool_calls:
            stop_reason = "tool_use"
        elif choice.finish_reason == "stop":
            stop_reason = "end_turn"
        else:
            stop_reason = choice.finish_reason or "end_turn"

        return ToolResponse(
            content=content_blocks,
            stop_reason=stop_reason,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    def get_engine_name(self) -> str:
        return "GPT"

    def get_engine_id(self) -> str:
        return "openai"
