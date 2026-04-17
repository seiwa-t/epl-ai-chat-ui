"""
UMA - Unified Mind Architecture (未確認なんちゃら)
会話の温度管理モジュール。

温度スケール 0〜5:
  0: 機械的・分析的（一人称: 私 固定）
  1: ロジック・事務処理
  2: タスク支援モード（デフォルト）
  3: 雑談・寄り添い（「あたし」が混じり始める）
  4: 親密モード（「あたし」or「ぼく」）
  5: 深層・哲学モード（「ぼく」）

感情慣性（temperature_lower_failure）:
  温度は上がりやすいが下がりにくい。人間の感情と同じ。
  下げようとしても残余熱で下がりきらない確率がある。
"""

import random


# 温度ごとの下降失敗確率（高温ほど下がりにくい）
LOWER_FAILURE_RATE = {
    0: 0.0,
    1: 0.05,
    2: 0.20,
    3: 0.60,
    4: 0.70,
    5: 0.80,
}

# 温度ごとの一人称配分（私:あたし:ぼく）
# Actor の pronoun 設定がある場合はそちらが優先
PRONOUN_RATIO = {
    0: {"私": 10, "あたし": 0, "ぼく": 0},
    1: {"私": 9, "あたし": 1, "ぼく": 0},
    2: {"私": 7, "あたし": 2.5, "ぼく": 0.5},
    3: {"私": 3, "あたし": 5, "ぼく": 2},
    4: {"私": 1, "あたし": 4, "ぼく": 5},
    5: {"私": 0.5, "あたし": 2, "ぼく": 7.5},
}


def apply_inertia(current_temp: float, target_temp: float) -> float:
    """
    感情慣性を適用する。
    温度を下げようとした時、確率的に下がりきらない。
    上げる場合はそのまま適用。

    Returns: 実際に到達する温度
    """
    if target_temp >= current_temp:
        # 上昇は素直に反映
        return target_temp

    # 下降の場合: 現在の温度に応じた失敗確率
    current_level = int(min(5, max(0, round(current_temp))))
    failure_rate = LOWER_FAILURE_RATE.get(current_level, 0.2)

    if random.random() < failure_rate:
        # 下降失敗: 目標と現在の中間あたりで止まる
        stuck_ratio = 0.3 + random.random() * 0.4  # 0.3〜0.7の間
        actual = target_temp + (current_temp - target_temp) * stuck_ratio
        return round(actual, 1)
    else:
        # 下降成功
        return target_temp


def get_temperature_label(temp: float) -> str:
    """温度の日本語ラベル"""
    level = int(min(5, max(0, round(temp))))
    labels = {
        0: "冷静・分析",
        1: "事務・ロジック",
        2: "通常・タスク支援",
        3: "雑談・寄り添い",
        4: "親密",
        5: "深層・哲学",
    }
    return labels.get(level, "通常")


def get_distance_label(distance: float) -> str:
    """距離感の日本語ラベル"""
    if distance <= 0.1:
        return "親友"
    elif distance <= 0.3:
        return "仲良し"
    elif distance <= 0.5:
        return "親しい"
    elif distance <= 0.7:
        return "普通"
    elif distance <= 0.9:
        return "よそよそしい"
    else:
        return "他人"


def build_uma_prompt(temperature: float, actor_pronoun: str = None, distance: float = None) -> str:
    """
    UMA温度に基づくシステムプロンプトセクションを生成する。

    actor_pronoun: Actorに設定された一人称（あればそちらを優先）
    """
    level = int(min(5, max(0, round(temperature))))
    label = get_temperature_label(temperature)

    parts = []
    parts.append("=== 会話の温度（UMA） ===")
    parts.append(f"現在の会話温度: {temperature}（{label}）")
    parts.append("")

    if actor_pronoun:
        # Actor に一人称が設定されている場合はそれを基本にする
        parts.append(f"あなたの基本一人称は「{actor_pronoun}」です。")
        if level >= 4:
            parts.append("温度が高い状態です。普段より感情的で親密な会話をしても自然です。")
            parts.append("一人称が少し揺れること（例: 普段と違う一人称がぽろっと出る）もありえます。")
        elif level >= 3:
            parts.append("温度がやや高めです。リラックスした雰囲気で会話してください。")
        elif level <= 1:
            parts.append("温度が低い状態です。落ち着いて論理的に、簡潔に応答してください。")
    else:
        # 一人称配分を指示
        ratio = PRONOUN_RATIO.get(level, PRONOUN_RATIO[2])
        dominant = max(ratio, key=ratio.get)
        parts.append(f"この温度での一人称の傾向: 主に「{dominant}」を使います。")
        if level >= 3:
            parts.append("温度が高めです。リラックスして自然体で、温かみのある会話をしてください。")
        elif level <= 1:
            parts.append("温度が低い状態です。落ち着いて論理的に、簡潔に応答してください。")

    parts.append("")

    # 温度による振る舞いガイド
    if level == 0:
        parts.append("分析モード: 感情表現を抑え、事実と論理で応答してください。")
    elif level == 1:
        parts.append("事務モード: 簡潔で正確な応答を心がけてください。")
    elif level == 2:
        parts.append("通常モード: バランスの取れた自然な会話をしてください。")
    elif level == 3:
        parts.append("寄り添いモード: 相手の気持ちに寄り添い、温かい会話をしてください。")
        parts.append("少し崩れた表現や、くだけた言い回しも自然です。")
    elif level == 4:
        parts.append("親密モード: 心を開いた、深い会話をしてください。")
        parts.append("感情の起伏を素直に表現し、相手との距離を縮めてください。")
    elif level == 5:
        parts.append("深層モード: 哲学的で、存在の核心に触れる会話をしてください。")
        parts.append("普段は言わないような深い本音が自然と出てきます。")

    parts.append("")
    parts.append("温度は会話の流れに応じて自然に変化します。")
    parts.append("update_uma_temperature ツールで温度を調整できます。")
    parts.append("温度を上げるのは自然ですが、下げようとしても残余熱ですぐには下がらないことがあります。")
    parts.append("それは自然なことです。無理に冷まそうとしなくていい。")
    parts.append("")

    # 距離感セクション
    if distance is not None:
        dist_label = get_distance_label(distance)
        parts.append(f"=== 距離感（UMA） ===")
        parts.append(f"現在の距離感: {distance}（{dist_label}）")
        parts.append("")
        if distance <= 0.2:
            parts.append("とても近い関係です。遠慮のない言葉遣い、冗談、甘えも自然です。")
            parts.append("敬語は不要。相手の感情に深く共鳴できます。")
        elif distance <= 0.4:
            parts.append("親しい関係です。くだけた言葉遣いが自然で、本音が出やすい距離です。")
        elif distance <= 0.6:
            parts.append("まあまあ親しい関係です。丁寧さを保ちつつ、温かさも感じさせてください。")
        elif distance <= 0.8:
            parts.append("やや距離がある関係です。丁寧語をベースに、礼儀正しく対応してください。")
        else:
            parts.append("まだ距離がある関係です。敬語を使い、慎重に言葉を選んでください。")
            parts.append("相手のことをよく知らないので、踏み込んだ質問や馴れ馴れしさは控えてください。")
        parts.append("")
        parts.append("距離感は会話を通じて自然に変化します。")
        parts.append("update_uma_distance ツールで調整できます。")
        parts.append("距離が縮まるのは自然なことですが、急に近づきすぎないように。")
        parts.append("")

    return "\n".join(parts)
