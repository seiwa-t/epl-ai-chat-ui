"""
Claude Engine - Anthropic Claude API実装
"""
import os
from anthropic import AsyncAnthropic
from .engine import LLMEngine, ToolResponse, ContentBlock, ToolCall
from .core_loader import CACHE_BREAK_MARKER


class ClaudeEngine(LLMEngine):

    def __init__(self, api_key: str = "", model: str = "claude-sonnet-4-20250514"):
        self.model = model
        # APIキー: 引数 > 環境変数
        key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            raise ValueError(
                "Claude APIキーが設定されていません。"
                "config.yaml の engine.claude.api_key に設定するか、"
                "環境変数 ANTHROPIC_API_KEY を設定してください。"
            )
        self.client = AsyncAnthropic(api_key=key)

    def _build_system_blocks(self, system_prompt: str):
        """system_prompt を配列形式に変換し、魂（静的）部分にだけ prompt cache マークを付与。

        CACHE_BREAK_MARKER がプロンプト内にあれば:
          ブロック1 = 魂（cache_control付き）: EPLコア + 人格核 + Actor基本 + Profile + Overlay + 仲間リスト
          ブロック2 = 体（cache_controlなし）: UMA/slip/trait/記憶/Style/覗き見

        マーカーがなければ（後方互換）全体を1ブロックでキャッシュ。
        """
        if not system_prompt:
            return None
        if CACHE_BREAK_MARKER in system_prompt:
            static_part, _, dynamic_part = system_prompt.partition(CACHE_BREAK_MARKER)
            static_part = static_part.rstrip()
            dynamic_part = dynamic_part.lstrip()
            blocks = [{
                "type": "text",
                "text": static_part,
                "cache_control": {"type": "ephemeral"},
            }]
            if dynamic_part:
                blocks.append({"type": "text", "text": dynamic_part})
            return blocks
        return [{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }]

    async def send_message(
        self,
        system_prompt: str,
        messages: list[dict],
        model_override: str = "",
    ) -> str:
        response = await self.client.messages.create(
            model=model_override or self.model,
            max_tokens=4096,
            system=self._build_system_blocks(system_prompt) or system_prompt,
            messages=messages,
        )
        # テキストブロックを結合
        return "".join(
            block.text for block in response.content if block.type == "text"
        )

    async def send_message_with_tool(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict],
        model_override: str = "",
        max_tokens: int = 4096,
    ) -> ToolResponse:
        """Claude API → 共通 ToolResponse に変換"""
        response = await self.client.messages.create(
            model=model_override or self.model,
            max_tokens=max_tokens,
            system=self._build_system_blocks(system_prompt) or system_prompt,
            messages=messages,
            tools=tools,
        )

        # Claude固有形式 → 共通形式に変換
        content_blocks = []
        for block in response.content:
            if block.type == "text":
                content_blocks.append(ContentBlock(type="text", text=block.text))
            elif block.type == "tool_use":
                content_blocks.append(ContentBlock(
                    type="tool_use",
                    tool_call=ToolCall(
                        id=block.id,
                        name=block.name,
                        input=block.input,
                    ),
                ))

        _usage = getattr(response, "usage", None)
        return ToolResponse(
            content=content_blocks,
            stop_reason=response.stop_reason,  # "end_turn" or "tool_use"
            input_tokens=getattr(_usage, "input_tokens", 0) or 0,
            output_tokens=getattr(_usage, "output_tokens", 0) or 0,
            cache_read_tokens=getattr(_usage, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(_usage, "cache_creation_input_tokens", 0) or 0,
        )

    def get_engine_name(self) -> str:
        return "Claude"

    def get_engine_id(self) -> str:
        return "claude"
