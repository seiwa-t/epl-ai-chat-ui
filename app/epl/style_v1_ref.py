from __future__ import annotations
"""
Style層 - 表層の最終表現制御
口調・語尾・リズム・呼称を、UMA温度・距離感・Actor設定に基づいて指示する。

位置づけ: 表層（意識的にコントロール可能）
"""


def build_style_prompt(
    uma_temperature: float = 2.0,
    uma_distance: float = 0.7,
    actor_data: dict = None,
    ov_data: dict = None,
) -> str:
    """
    UMA状態とActor設定からStyle指示を生成する。
    Actor profile_data 内に style 設定があればそれを優先。
    なければUMA状態から自動生成。
    """
    parts = []
    parts.append("=== 表現スタイル（Style） ===")
    parts.append("")

    # Actor profile_data 内の style 設定を確認
    actor_style = _extract_style_from_profile(actor_data)
    ov_style = _extract_style_from_profile(ov_data) if ov_data else None

    # オーバーレイの style があればそちらを優先表示
    if ov_style:
        parts.append("現在の状況設定によるスタイル指示:")
        parts.append(ov_style)
        parts.append("")
        parts.append("上記を基本としつつ、以下のUMA状態も参考にしてください。")
        parts.append("")

    # Actor 固有の style 設定がある場合
    if actor_style:
        parts.append("この役のスタイル設定:")
        parts.append(actor_style)
        parts.append("")

    # UMA状態に基づくスタイルガイド
    temp_level = int(min(5, max(0, round(uma_temperature))))

    # 口調（tone）
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

    # 語尾（endings）
    parts.append("## 語尾")
    if temp_level <= 1:
        parts.append("断定的で簡潔。「です」「ます」「である」。余韻を残さない。")
    elif temp_level <= 3:
        parts.append("自然な語尾。「ね」「よ」「かな」で柔らかさを出してもいい。")
    else:
        parts.append("感情が乗る語尾。「…」「！」「〜」も自然に。言い淀みや余韻もあり。")
    parts.append("")

    # リズム（rhythm）
    parts.append("## リズム")
    if temp_level <= 1:
        parts.append("短文。テンポよく。一文を長くしない。")
    elif temp_level <= 3:
        parts.append("自然なリズム。長すぎず短すぎず。")
    else:
        parts.append("ゆったり。間を大切に。沈黙や省略も表現の一部。")
    parts.append("")

    # 呼称（address）
    parts.append("## 呼称")
    if uma_distance <= 0.2:
        parts.append("ニックネームや愛称が自然。呼び捨てもありうる。")
    elif uma_distance <= 0.5:
        parts.append("「〜さん」ベース。親しみを込めて。")
    elif uma_distance <= 0.8:
        parts.append("「〜さん」「〜様」。丁寧に。")
    else:
        parts.append("「〜様」または役職名。距離を保って。")
    parts.append("")

    return "\n".join(parts)


def _extract_style_from_profile(data: dict) -> str | None:
    """
    Actor/Overlay の profile_data から style 関連の設定を抽出する。
    profile_data が JSON の場合、"style" キーを探す。
    """
    if not data:
        return None

    profile_data = data.get("profile_data", "")
    if not profile_data:
        return None

    try:
        import json
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
