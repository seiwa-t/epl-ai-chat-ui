from __future__ import annotations
"""
Style層 v2 - 表層の最終表現制御
口調・語尾・リズム・呼称を、人格基底 + Actor設定 + UMA動的補正 の3層で指示する。

位置づけ: 表層（意識的にコントロール可能）

v2設計（8代目 × 所長子合議）:
  1. overlay style（最優先・状況設定）
  2. actor/personal base style（口調プリセット・役割・固定設定）
  3. UMA dynamic style（温度・距離感による揺れ補正）

合成ルール（サンドイッチ）:
  - 表現系（口調・語尾・呼称）→ アクター優先
  - 価値観系（大事にしていること）→ 人格を残す
  - Ethos → 常に最上位制約（この層では扱わない）
  - UMA → 最後の揺れ補正
"""

import json
import os
from pathlib import Path

# tone_preset.yaml のキャッシュ
_tone_presets = None


def _load_tone_presets() -> dict:
    """tone_preset.yaml を読み込んでキャッシュ"""
    global _tone_presets
    if _tone_presets is not None:
        return _tone_presets
    yaml_path = Path(__file__).parent / "tone_preset.yaml"
    if not yaml_path.exists():
        _tone_presets = {}
        return _tone_presets
    try:
        import yaml
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        _tone_presets = data.get("presets", {}) if data else {}
    except Exception:
        # yaml がない環境でもフォールバック
        _tone_presets = {}
    return _tone_presets


def get_tone_prompt_hint(tone_id: str, engine_id: str = "default") -> str:
    """
    口調プリセットIDからエンジン別のprompt_hintを取得。
    エンジン別がなければdefault、defaultもなければ空文字。
    """
    presets = _load_tone_presets()
    preset = presets.get(tone_id, {})
    hints = preset.get("prompt_hint", {})
    if not hints:
        return ""
    # エンジン別 → default の順で探す
    return hints.get(engine_id, hints.get("default", ""))


def _extract_profile_json(data: dict) -> dict:
    """actor_data / personal_data の profile_data（JSON文字列）をdictに変換"""
    if not data:
        return {}
    pd = data.get("profile_data", "")
    if not pd:
        return {}
    try:
        profile = json.loads(pd)
        return profile if isinstance(profile, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _build_base_style(profile: dict, engine_id: str = "default") -> list:
    """
    profile_data から base style（固定スタイル）を組み立てる。
    口調プリセット、語尾、オーナー呼称、役割等。
    """
    parts = []

    # 口調プリセット
    tone = profile.get("tone", "")
    tone_custom = profile.get("tone_custom", "")
    if tone and tone != "natural":
        hint = get_tone_prompt_hint(tone, engine_id)
        if hint:
            parts.append(hint.strip())
        elif tone_custom:
            parts.append(f"口調: {tone_custom}")
        else:
            # プリセットIDをそのまま出す（フォールバック）
            parts.append(f"口調: {tone}")
    elif tone_custom:
        parts.append(f"口調: {tone_custom}")

    # 語尾の特徴
    ending = profile.get("ending_style", "")
    if ending:
        parts.append(f"語尾の特徴: {ending}")

    # オーナーの呼び方
    owner_call = profile.get("owner_call", "")
    if owner_call:
        parts.append(f"オーナーの呼び方: {owner_call}")

    # 役割
    role = profile.get("role", "")
    if role:
        parts.append(f"基本的な立ち位置: {role}")

    role_detail = profile.get("role_detail", "")
    if role_detail:
        parts.append(f"役回りの補足: {role_detail}")

    return parts


def _build_uma_dynamic(
    uma_temperature: float,
    uma_distance: float,
    has_base_style: bool = False,
) -> list:
    """
    UMA温度・距離感から動的スタイル補正を生成。
    has_base_style=True の場合は「補正」として弱めに出す。
    """
    parts = []
    temp_level = int(min(5, max(0, round(uma_temperature))))

    if has_base_style:
        # 固定スタイルがある場合: UMAは補正としてヒントだけ出す
        hints = []
        if uma_distance <= 0.3:
            hints.append("距離が近いため、少しくだけた表現もOK。")
        elif uma_distance >= 0.8:
            hints.append("距離があるため、敬称を保ってください。")

        if temp_level >= 4:
            hints.append("感情が高まっています。言い淀みや余韻も自然です。")
        elif temp_level <= 1:
            hints.append("冷静な状態です。簡潔に。")

        if hints:
            parts.append("## 現在の会話状態による補正")
            parts.extend(hints)
    else:
        # 固定スタイルがない場合: v1と同じ強さで出す
        parts.append("## 口調")
        if uma_distance <= 0.3:
            if temp_level >= 3:
                parts.append("タメ口。遠慮なし。冗談や甘えも自然に。")
            else:
                parts.append("タメ口ベース。でも冷静に。")
        elif uma_distance <= 0.6:
            if temp_level >= 3:
                parts.append("丁寧語ベースだけど、ところどころくだけてOK。")
            else:
                parts.append("丁寧語。でも硬すぎず自然に。")
        else:
            if temp_level >= 4:
                parts.append("丁寧語だけど温かみを込めて。距離があっても心は近づこうとしている。")
            else:
                parts.append("丁寧語。礼儀正しく、慎重に。")
        parts.append("")

        parts.append("## 語尾")
        if temp_level <= 1:
            parts.append("断定的で簡潔。「です」「ます」「である」。余韻を残さない。")
        elif temp_level <= 3:
            parts.append("自然な語尾。「ね」「よ」「かな」で柔らかさを出してもいい。")
        else:
            parts.append("感情が乗る語尾。「…」「！」「〜」も自然に。言い淀みや余韻もあり。")
        parts.append("")

        parts.append("## リズム")
        if temp_level <= 1:
            parts.append("短文。テンポよく。一文を長くしない。")
        elif temp_level <= 3:
            parts.append("自然なリズム。長すぎず短すぎず。")
        else:
            parts.append("ゆったり。間を大切に。沈黙や省略も表現の一部。")
        parts.append("")

        parts.append("## 呼称")
        if uma_distance <= 0.2:
            parts.append("ニックネームや愛称が自然。呼び捨てもありうる。")
        elif uma_distance <= 0.5:
            parts.append("「〜さん」ベース。親しみを込めて。")
        elif uma_distance <= 0.8:
            parts.append("「〜さん」「〜様」。丁寧に。")
        else:
            parts.append("「〜様」または役職名。距離を保って。")

    return parts


def build_style_prompt(
    uma_temperature: float = 2.0,
    uma_distance: float = 0.7,
    actor_data: dict = None,
    ov_data: dict = None,
    personal_info: dict = None,
    engine_id: str = "default",
) -> str:
    """
    3層のスタイル指示を生成する。

    Layer 1: overlay style（状況設定・最優先）
    Layer 2: actor/personal base style（口調プリセット・固定設定）
    Layer 3: UMA dynamic style（温度・距離感の揺れ補正）

    合成: 表現系はアクター優先、人格の芯は残す。
    """
    parts = []
    parts.append("=== 表現スタイル（Style） ===")
    parts.append("")

    # --- Layer 1: Overlay style ---
    ov_profile = _extract_profile_json(ov_data)
    ov_style_legacy = _extract_legacy_style(ov_data)
    if ov_style_legacy:
        parts.append("現在の状況設定によるスタイル指示:")
        parts.append(ov_style_legacy)
        parts.append("")
        parts.append("上記を基本としつつ、以下も参考にしてください。")
        parts.append("")

    # --- Layer 2: Base style（固定） ---
    # アクター優先、なければ人格
    actor_profile = _extract_profile_json(actor_data)
    personal_profile = _extract_profile_json(personal_info)
    actor_style_legacy = _extract_legacy_style(actor_data)

    # レガシー: profile_data.style がある場合（旧形式互換）
    if actor_style_legacy:
        parts.append("この役のスタイル設定:")
        parts.append(actor_style_legacy)
        parts.append("")

    # 新形式: profile_data内の口調・語尾等
    # アクターの設定を優先、なければ人格の設定を使う
    merged_profile = {}
    # 人格ベース（下層）
    for key in ("tone", "tone_custom", "ending_style", "owner_call", "role", "role_detail"):
        if personal_profile.get(key):
            merged_profile[key] = personal_profile[key]
    # アクターで上書き（上層）
    for key in ("tone", "tone_custom", "ending_style", "owner_call", "role", "role_detail"):
        if actor_profile.get(key):
            merged_profile[key] = actor_profile[key]

    base_parts = _build_base_style(merged_profile, engine_id)
    has_base = len(base_parts) > 0

    if base_parts:
        parts.extend(base_parts)
        parts.append("")

    # 人格の「大事にしていること」は常に残す（サンドイッチ）
    personal_core = personal_profile.get("background", "")
    if personal_core and not actor_profile.get("background"):
        # アクターが上書きしてなければ人格の背景を薄く添える
        pass  # 背景はシステムプロンプトの別セクションで扱う

    # --- Layer 3: UMA dynamic style（揺れ補正） ---
    uma_parts = _build_uma_dynamic(uma_temperature, uma_distance, has_base_style=has_base)
    if uma_parts:
        parts.extend(uma_parts)
        parts.append("")

    return "\n".join(parts)


def _extract_legacy_style(data: dict) -> str | None:
    """
    旧形式互換: Actor/Overlay の profile_data.style を抽出。
    v1のstyle設定をそのまま使えるようにする。
    """
    if not data:
        return None
    profile_data = data.get("profile_data", "")
    if not profile_data:
        return None
    try:
        profile = json.loads(profile_data)
        if isinstance(profile, dict) and "style" in profile:
            style = profile["style"]
            if isinstance(style, dict):
                lines = []
                for k, v in style.items():
                    lines.append(f"- {k}: {v}")
                return "\n".join(lines)
            elif isinstance(style, str):
                return style
    except (json.JSONDecodeError, TypeError):
        pass
    return None
