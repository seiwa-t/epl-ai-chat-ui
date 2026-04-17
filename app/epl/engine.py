from __future__ import annotations
"""
LLM Engine - 抽象化レイヤー
Claude / OpenAI / Gemini を統一インターフェースで扱う

== 共通レスポンス形式 ==
send_message_with_tool() は ToolResponse を返す。
サーバー側はエンジン固有の形式を意識しなくていい。
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ToolCall:
    """AIが呼び出したツール1件"""
    id: str                # ツール呼び出しID（tool_resultで返す時に使う）
    name: str              # ツール名
    input: dict            # ツールへの入力パラメータ


@dataclass
class ContentBlock:
    """レスポンス内のコンテンツブロック"""
    type: str              # "text" or "tool_use"
    text: str = ""         # type=="text" の場合
    tool_call: ToolCall | None = None  # type=="tool_use" の場合


@dataclass
class ToolResponse:
    """send_message_with_tool() の共通レスポンス"""
    content: list[ContentBlock]           # コンテンツブロックのリスト
    stop_reason: str = "end_turn"         # "end_turn" or "tool_use"
    input_tokens: int = 0
    output_tokens: int = 0
    # Prompt Caching 統計（対応エンジンのみ）
    cache_read_tokens: int = 0            # キャッシュから読み込んだトークン数（料金10%）
    cache_write_tokens: int = 0           # キャッシュに書き込んだトークン数（料金125%）

    def get_text(self) -> str:
        """テキスト部分を結合して返す"""
        return "".join(b.text for b in self.content if b.type == "text")

    def get_tool_calls(self) -> list[ToolCall]:
        """ツール呼び出しのリスト"""
        return [b.tool_call for b in self.content if b.type == "tool_use" and b.tool_call]

    def to_assistant_message(self) -> list[dict]:
        """Claude互換のassistantメッセージ content を生成（会話履歴用）"""
        result = []
        for b in self.content:
            if b.type == "text":
                result.append({"type": "text", "text": b.text})
            elif b.type == "tool_use" and b.tool_call:
                result.append({
                    "type": "tool_use",
                    "id": b.tool_call.id,
                    "name": b.tool_call.name,
                    "input": b.tool_call.input,
                })
        return result


class LLMEngine(ABC):
    """LLMエンジンの共通インターフェース"""

    @abstractmethod
    async def send_message(
        self,
        system_prompt: str,
        messages: list[dict],
        model_override: str = "",
    ) -> str:
        """
        メッセージを送信してAI応答を返す（テキストのみ）

        Args:
            system_prompt: システムプロンプト（EPLコア + 記憶）
            messages: 会話履歴 [{"role": "user"|"assistant", "content": "..."}]
            model_override: モデルIDを一時的に上書き（会議参加者用）

        Returns:
            AI応答テキスト
        """
        pass

    async def send_message_with_tool(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict],
        model_override: str = "",
        max_tokens: int = 4096,
    ) -> ToolResponse:
        """
        ツール付きメッセージ送信。

        Args:
            system_prompt: システムプロンプト
            messages: 会話履歴
            tools: ツール定義リスト（EPL共通形式 = Claude形式）
            model_override: モデルIDを一時的に上書き（会議参加者用）
            max_tokens: 最大出力トークン数（デフォルト4096、会議モードで制限用）

        Returns:
            ToolResponse（共通形式）
        """
        # デフォルト実装: ツール非対応 → テキストのみで返す
        text = await self.send_message(system_prompt, messages, model_override=model_override)
        return ToolResponse(
            content=[ContentBlock(type="text", text=text)],
            stop_reason="end_turn",
        )

    @abstractmethod
    def get_engine_name(self) -> str:
        """エンジン名を返す（UI表示用）"""
        pass

    @abstractmethod
    def get_engine_id(self) -> str:
        """エンジンID（claude / openai / gemini）"""
        pass
