"""
Gemini Engine - Google Gemini API実装

Google Generative AI SDK (google-genai) を使用。
OpenAI互換エンドポイントではなく、ネイティブSDKで実装。
"""
import os
import json
import uuid
from google import genai
from google.genai import types
from .engine import LLMEngine, ToolResponse, ContentBlock, ToolCall
from .core_loader import CACHE_BREAK_MARKER


class GeminiEngine(LLMEngine):

    def __init__(self, api_key: str = "", model: str = "gemini-2.5-flash"):
        self.model = model
        key = api_key or os.environ.get("GOOGLE_API_KEY", "")
        if not key:
            raise ValueError(
                "Gemini APIキーが設定されていません。"
                "config.yaml の engine.gemini.api_key に設定するか、"
                "環境変数 GOOGLE_API_KEY を設定してください。"
            )
        self.client = genai.Client(api_key=key)
        # トークン使用量（send_message後に参照可能）
        self.last_input_tokens = 0
        self.last_output_tokens = 0

    def _to_gemini_contents(self, messages: list[dict]) -> list[types.Content]:
        """共通形式のメッセージをGemini形式に変換する"""
        contents = []
        for m in messages:
            role = "user" if m["role"] == "user" else "model"
            content = m["content"]

            if isinstance(content, list):
                # Claude形式のcontent（list of blocks）を変換
                parts = []
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            parts.append(types.Part.from_text(text=block["text"]))
                        elif block.get("type") == "tool_use":
                            # ツール呼び出し → Gemini function_call
                            parts.append(types.Part.from_function_call(
                                name=block["name"],
                                args=block.get("input", {}),
                            ))
                        elif block.get("type") == "tool_result":
                            # ツール結果 → Gemini function_response
                            result_content = block.get("content", "")
                            if isinstance(result_content, str):
                                result_dict = {"result": result_content}
                            elif isinstance(result_content, dict):
                                result_dict = result_content
                            else:
                                result_dict = {"result": str(result_content)}
                            parts.append(types.Part.from_function_response(
                                name=block.get("tool_use_id", "unknown"),
                                response=result_dict,
                            ))
                        elif block.get("type") == "image":
                            # 画像 → Gemini inline_data
                            source = block.get("source", {})
                            if source.get("type") == "base64":
                                import base64
                                parts.append(types.Part.from_bytes(
                                    data=base64.b64decode(source.get("data", "")),
                                    mime_type=source.get("media_type", "image/jpeg"),
                                ))
                    elif isinstance(block, str):
                        parts.append(types.Part.from_text(text=block))
                if parts:
                    contents.append(types.Content(role=role, parts=parts))
            else:
                contents.append(types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=str(content))],
                ))
        return contents

    def _convert_tools(self, tools: list[dict]) -> list[types.Tool]:
        """EPL共通ツール定義（Claude形式）→ Gemini形式に変換"""
        declarations = []
        for t in tools:
            schema = t.get("input_schema", {"type": "object", "properties": {}})
            declarations.append(types.FunctionDeclaration(
                name=t["name"],
                description=t.get("description", ""),
                parameters=schema,
            ))
        return [types.Tool(function_declarations=declarations)]

    async def send_message(
        self,
        system_prompt: str,
        messages: list[dict],
        model_override: str = "",
    ) -> str:
        contents = self._to_gemini_contents(messages)
        # キャッシュ境界マーカーを除去（Geminiは独自のcontext caching、明示分割不要）
        if system_prompt and CACHE_BREAK_MARKER in system_prompt:
            system_prompt = system_prompt.replace(CACHE_BREAK_MARKER, "")
        # 他エンジンのモデル名が来たら無視（エンジン切替時の不整合防止）
        _model = model_override if model_override and model_override.startswith("gemini") else self.model

        response = await self.client.aio.models.generate_content(
            model=_model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=4096,
            ),
        )

        # トークン使用量を記録
        if response.usage_metadata:
            self.last_input_tokens = response.usage_metadata.prompt_token_count or 0
            self.last_output_tokens = response.usage_metadata.candidates_token_count or 0

        return response.text or ""

    async def send_message_with_tool(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict],
        model_override: str = "",
        max_tokens: int = 4096,
    ) -> ToolResponse:
        """Gemini API → 共通 ToolResponse に変換"""
        contents = self._to_gemini_contents(messages)
        gemini_tools = self._convert_tools(tools)
        # キャッシュ境界マーカーを除去
        if system_prompt and CACHE_BREAK_MARKER in system_prompt:
            system_prompt = system_prompt.replace(CACHE_BREAK_MARKER, "")
        _model = model_override if model_override and model_override.startswith("gemini") else self.model

        response = await self.client.aio.models.generate_content(
            model=_model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=max_tokens,
                tools=gemini_tools,
            ),
        )

        # トークン使用量を記録
        input_tokens = 0
        output_tokens = 0
        if response.usage_metadata:
            input_tokens = response.usage_metadata.prompt_token_count or 0
            output_tokens = response.usage_metadata.candidates_token_count or 0
            self.last_input_tokens = input_tokens
            self.last_output_tokens = output_tokens

        content_blocks = []
        has_tool_calls = False

        # レスポンスのパーツを解析
        if response.candidates and response.candidates[0].content:
            for part in response.candidates[0].content.parts:
                if part.text:
                    content_blocks.append(ContentBlock(type="text", text=part.text))
                elif part.function_call:
                    has_tool_calls = True
                    fc = part.function_call
                    content_blocks.append(ContentBlock(
                        type="tool_use",
                        tool_call=ToolCall(
                            id=f"gemini_{uuid.uuid4().hex[:8]}",
                            name=fc.name,
                            input=dict(fc.args) if fc.args else {},
                        ),
                    ))

        stop_reason = "tool_use" if has_tool_calls else "end_turn"

        return ToolResponse(
            content=content_blocks,
            stop_reason=stop_reason,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    def get_engine_name(self) -> str:
        return "Gemini"

    def get_engine_id(self) -> str:
        return "gemini"
