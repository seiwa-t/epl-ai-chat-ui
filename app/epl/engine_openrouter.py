"""
OpenRouter Engine - OpenRouter API経由の汎用LLMエンジン
OpenAI互換APIを使用。1つのAPIキーで複数モデル（Rakuten AI, Llama, Mistral等）にアクセス可能。

設計: 8代目クワトロ子
- OpenAIEngineのメッセージ変換ロジックを流用
- エンドポイントとヘッダーをOpenRouter仕様に変更
- モデルIDで任意のモデルに切り替え可能
"""
import os
import json
import uuid
import httpx
from .engine import LLMEngine, ToolResponse, ContentBlock, ToolCall
from .core_loader import CACHE_BREAK_MARKER


# OpenRouterのデフォルトモデル
DEFAULT_MODEL = "rakuten/rakuten-ai-3-700b"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterEngine(LLMEngine):

    def __init__(
        self,
        api_key: str = "",
        model: str = DEFAULT_MODEL,
        site_url: str = "http://localhost:8001",
        site_name: str = "EPL AI Chat UI",
    ):
        self.model = model
        self.key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
        if not self.key:
            raise ValueError(
                "OpenRouter APIキーが設定されていません。"
                "config.yaml の engine.openrouter.api_key に設定するか、"
                "環境変数 OPENROUTER_API_KEY を設定してください。"
            )
        self.site_url = site_url
        self.site_name = site_name
        # トークン使用量（send_message後に参照可能）
        self.last_input_tokens = 0
        self.last_output_tokens = 0

    def _headers(self) -> dict:
        """OpenRouter固有のヘッダー"""
        return {
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "HTTP-Referer": self.site_url,
            "X-Title": self.site_name,
        }

    def _to_oai_messages(self, system_prompt: str, messages: list[dict]) -> list[dict]:
        """共通形式のメッセージをOpenAI互換形式に変換する（OpenAIEngineと同一ロジック）"""
        # キャッシュ境界マーカーを除去
        if system_prompt and CACHE_BREAK_MARKER in system_prompt:
            system_prompt = system_prompt.replace(CACHE_BREAK_MARKER, "")
        oai_messages = [{"role": "system", "content": system_prompt}]
        for m in messages:
            role = m["role"]
            content = m["content"]

            if isinstance(content, list):
                text_parts = []
                tool_calls_for_msg = []
                tool_results_for_msg = []

                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text_parts.append(block["text"])
                        elif block.get("type") == "tool_use":
                            tool_calls_for_msg.append({
                                "id": block.get("id", str(uuid.uuid4())[:8]),
                                "type": "function",
                                "function": {
                                    "name": block["name"],
                                    "arguments": json.dumps(block.get("input", {}), ensure_ascii=False),
                                },
                            })
                        elif block.get("type") == "tool_result":
                            tool_results_for_msg.append({
                                "role": "tool",
                                "tool_call_id": block.get("tool_use_id", ""),
                                "content": str(block.get("content", "")),
                            })
                        elif block.get("type") == "image":
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

                has_image = any(isinstance(p, dict) for p in text_parts)

                if role == "assistant":
                    msg = {"role": "assistant"}
                    if text_parts:
                        str_parts = [p for p in text_parts if isinstance(p, str)]
                        msg["content"] = "\n".join(str_parts) if str_parts else None
                    else:
                        msg["content"] = None
                    if tool_calls_for_msg:
                        msg["tool_calls"] = tool_calls_for_msg
                    oai_messages.append(msg)
                elif tool_results_for_msg:
                    for tr in tool_results_for_msg:
                        oai_messages.append(tr)
                elif has_image:
                    def _build_parts(parts):
                        result = []
                        for p in parts:
                            if isinstance(p, dict):
                                result.append(p)
                            elif isinstance(p, str) and p:
                                result.append({"type": "text", "text": p})
                        return result
                    oai_messages.append({"role": role, "content": _build_parts(text_parts)})
                else:
                    oai_messages.append({"role": role, "content": "\n".join(text_parts) if text_parts else str(content)})
            else:
                oai_messages.append({"role": role, "content": content})

        # サニタイズ: orphaned tool_calls を除去
        sanitized = []
        for i, msg in enumerate(oai_messages):
            if msg.get("role") == "assistant" and msg.get("tool_calls"):
                tc_ids = {tc["id"] for tc in msg["tool_calls"]}
                found_ids = set()
                for j in range(i + 1, len(oai_messages)):
                    if oai_messages[j].get("role") == "tool" and oai_messages[j].get("tool_call_id") in tc_ids:
                        found_ids.add(oai_messages[j]["tool_call_id"])
                    elif oai_messages[j].get("role") in ("user", "assistant"):
                        break
                if not found_ids:
                    sanitized.append({"role": "assistant", "content": msg.get("content") or ""})
                elif found_ids != tc_ids:
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
        """テキストのみの送信"""
        oai_messages = self._to_oai_messages(system_prompt, messages)
        _model = model_override or self.model

        payload = {
            "model": _model,
            "max_tokens": 4096,
            "messages": oai_messages,
        }

        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                headers=self._headers(),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        # トークン使用量を記録
        usage = data.get("usage", {})
        self.last_input_tokens = usage.get("prompt_tokens", 0)
        self.last_output_tokens = usage.get("completion_tokens", 0)

        return data["choices"][0]["message"]["content"] or ""

    async def send_message_with_tool(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict],
        model_override: str = "",
        max_tokens: int = 4096,
    ) -> ToolResponse:
        """ツール対応の送信（OpenAI互換）"""
        oai_messages = self._to_oai_messages(system_prompt, messages)
        oai_tools = self._convert_tools(tools)
        _model = model_override or self.model

        payload = {
            "model": _model,
            "max_tokens": max_tokens,
            "messages": oai_messages,
        }
        # tool_useに対応してないモデルもあるので、ツールがあれば渡す
        if oai_tools:
            payload["tools"] = oai_tools

        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                headers=self._headers(),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        # トークン使用量
        usage = data.get("usage", {})
        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)
        self.last_input_tokens = input_tokens
        self.last_output_tokens = output_tokens

        choice = data["choices"][0]
        msg = choice["message"]
        content_blocks = []

        # テキスト部分
        if msg.get("content"):
            content_blocks.append(ContentBlock(type="text", text=msg["content"]))

        # ツール呼び出し部分
        has_tool_calls = False
        if msg.get("tool_calls"):
            has_tool_calls = True
            for tc in msg["tool_calls"]:
                try:
                    args = json.loads(tc["function"]["arguments"])
                except (json.JSONDecodeError, TypeError):
                    args = {}
                content_blocks.append(ContentBlock(
                    type="tool_use",
                    tool_call=ToolCall(
                        id=tc.get("id", f"or_{uuid.uuid4().hex[:8]}"),
                        name=tc["function"]["name"],
                        input=args,
                    ),
                ))

        # stop_reason
        finish_reason = choice.get("finish_reason", "stop")
        if has_tool_calls:
            stop_reason = "tool_use"
        elif finish_reason == "stop":
            stop_reason = "end_turn"
        else:
            stop_reason = finish_reason

        return ToolResponse(
            content=content_blocks,
            stop_reason=stop_reason,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    def get_engine_name(self) -> str:
        """モデル名から表示名を生成"""
        # "rakuten/rakuten-ai-3-700b" → "Rakuten AI"
        # "meta-llama/llama-3.1-405b" → "Llama"
        model_lower = self.model.lower()
        if "rakuten" in model_lower:
            return "Rakuten AI"
        elif "llama" in model_lower:
            return "Llama"
        elif "mistral" in model_lower:
            return "Mistral"
        elif "qwen" in model_lower:
            return "Qwen"
        elif "deepseek" in model_lower:
            return "DeepSeek"
        # フォールバック: スラッシュ以降のモデル名
        if "/" in self.model:
            return self.model.split("/")[-1].split("-")[0].capitalize()
        return "OpenRouter"

    def get_engine_id(self) -> str:
        return "openrouter"
