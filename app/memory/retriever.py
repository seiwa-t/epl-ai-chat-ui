"""
Instant Memory Retriever（瞬間記憶生成）
会話内容に応じて記録DBから関連記憶を検索し、プロンプト用テキストを生成する
"""
import re
from .db import MemoryDB


STOP_WORDS = {
    "の", "に", "は", "を", "た", "が", "で", "て", "と", "し", "れ", "さ",
    "ある", "いる", "する", "なる", "できる", "それ", "この", "ない",
    "です", "ます", "から", "まで", "もの", "こと", "よう", "ため",
    "って", "けど", "だけ", "でも", "ちょっと", "まあ", "ねえ",
}


def extract_keywords(text: str) -> list[str]:
    en_words = re.findall(r"[a-zA-Z]{3,}", text)
    katakana = re.findall(r"[\u30A0-\u30FF]{2,}", text)
    kanji = re.findall(r"[\u4E00-\u9FFF\u3040-\u309F]{2,}", text)
    all_words = en_words + katakana + kanji
    return [w for w in all_words if w.lower() not in STOP_WORDS][:10]


def detect_vague_reference(text: str) -> bool:
    patterns = [r"あれ", r"それ", r"さっきの", r"前の", r"この前",
                r"あの時", r"あの話", r"なんだっけ", r"思い出せ", r"覚えて"]
    return any(re.search(p, text) for p in patterns)


def build_instant_memory(
    db: MemoryDB, personal_id: int, user_message: str, chat_thread_id: str,
    actor_id: int = None, max_chars: int = 3000,
    tier_recall: dict = None,  # {"short": 0, "middle": 0, "long": 0, "exp": 0}
    recall_info: dict = None,  # 呼び出し元が渡した空dict → 想起ログ情報を書き込む
    is_meeting: bool = False,  # 会議モード時、過去の会議記憶を自動注入
) -> str:
    """
    デフォルト: A（個性）+ F（キャッシュ）のみ
    tier_recall で E/D/C/B を追加ロード
    G（会話履歴）は server.py 側で recall_limit(chat) で制御
    recall_info が渡された場合、想起した short/middle の情報をそこに書き込む
    """
    parts = []
    tr = tier_recall or {}

    # recall_info 初期化
    _ri = recall_info if recall_info is not None else {}
    _ri.update({
        "short_ids": [], "short_count": 0, "short_source": "none",
        "middle_id": None, "middle_source": "none",
    })

    # A: 個性（常時ロード）
    traits = db.get_all_personal_trait(personal_id)
    if traits:
        parts.append("【個性】\n" + "".join(f"- {t['label']}: {t['description']}\n" for t in traits[:5]))

    # F: キャッシュ記憶（常時ロード）
    try:
        cache = db.get_cache(personal_id, chat_thread_id)
        if cache:
            parts.append(f"【このスレッドの流れ】\n{cache['content']}")
    except Exception:
        pass

    # Entity: 人名・固有名詞記憶（常時ロード）
    try:
        entities = db.get_entity_long_term(personal_id, limit=30)
        if entities:
            lines = []
            for e in entities:
                lines.append(f"- {e.get('abstract') or e['content']}")
            parts.append("【知っている人・プロジェクト・固有名詞】\n" + "\n".join(lines))
    except Exception:
        pass

    # D-base: 中期記憶（常時1件ロード: 前セッションの圧縮記憶を背景として保持）
    # 小脳がD層をより多く要求している場合は重複を避けてスキップ
    if not tr.get("middle", 0):
        try:
            base_middle = db.get_recent_middle_term(personal_id, actor_id=actor_id, limit=1)
            if base_middle:
                mid = base_middle[0]
                parts.append(f"【前の会話から】\n{mid.get('abstract') or mid['content']}")
                _ri["middle_id"] = mid.get("id")
                _ri["middle_source"] = "d_base"
        except Exception:
            pass

    # E: 短期記憶（トピック関連2件 → ヒットなしなら直近middle1件にフォールバック）
    short_limit = tr.get("short", 0)
    keywords = extract_keywords(user_message)
    if short_limit > 0:
        # まずキーワードで関連shortを検索
        matched_shorts = db.search_short_term(personal_id, keywords, actor_id=actor_id, limit=2) if keywords else []
        if matched_shorts:
            parts.append("【関連する最近の記憶】\n" + "".join(f"- {s['summary']}\n" for s in matched_shorts))
            _ri["short_ids"] = [s.get("id") for s in matched_shorts]
            _ri["short_count"] = len(matched_shorts)
            _ri["short_source"] = "keyword_match"
        else:
            # フォールバック: 直近のmiddle 1件
            try:
                fallback_mid = db.get_recent_middle_term(personal_id, actor_id=actor_id, limit=1)
                if fallback_mid:
                    mid = fallback_mid[0]
                    parts.append("【前の会話から（短期記憶なし）】\n- " + (mid.get("abstract") or mid["content"]))
                    # D-baseと同じmiddleの場合は上書きしない
                    if _ri["middle_id"] is None:
                        _ri["middle_id"] = mid.get("id")
                    _ri["middle_source"] = "fallback"
            except Exception:
                pass

    # D: 中期記憶（小脳が要求した時のみ）
    middle_limit = tr.get("middle", 0)
    if middle_limit > 0:
        try:
            middle = db.get_recent_middle_term(personal_id, actor_id=actor_id, limit=middle_limit)
            if middle:
                parts.append("【中期記憶】\n" + "".join(f"- {m.get('abstract') or m['content']}\n" for m in middle))
                if _ri["middle_id"] is None:
                    _ri["middle_id"] = middle[0].get("id")
                _ri["middle_source"] = "tier_recall"
        except Exception:
            pass

    # C: 長期記憶（小脳が要求した時のみ）
    long_limit = tr.get("long", 0)
    if long_limit > 0 and keywords:
        ltm = db.search_long_term(personal_id, keywords, actor_id=actor_id, limit=long_limit, chat_thread_id=chat_thread_id)
        if ltm:
            parts.append("【関連する記憶】\n" + "".join(f"- {m.get('abstract') or m['content']}\n" for m in ltm))

    # B: 経験（小脳が要求した時のみ）
    exp_limit = tr.get("exp", 0)
    if exp_limit > 0 and keywords:
        exp = db.search_experience(personal_id, keywords, actor_id=actor_id, limit=exp_limit)
        if exp:
            parts.append("【関連する経験】\n" + "".join(f"- {e.get('abstract') or e['content']}\n" for e in exp))

    # 会議モード: 過去の会議記憶を自動注入（キーワード不要）
    if is_meeting:
        meeting_mems = db.get_meeting_memory(personal_id, actor_id=actor_id, limit=3, chat_thread_id=chat_thread_id)
        if meeting_mems:
            parts.append("【過去の会議記憶】\n" + "".join(
                f"- {m.get('abstract', '')}: {m.get('content', '')[:200]}\n" for m in meeting_mems
            ))

    result = "\n".join(parts)
    if len(result) > max_chars:
        result = result[:max_chars] + "\n（記憶の一部は省略されています）"
    return result


def build_vague_search_prompt(user_message: str, search_results: list) -> str:
    if not search_results:
        return (
            "\n【記憶検索の結果】\n"
            "ユーザーが何かを参照しようとしていますが、関連する記憶が見つかりませんでした。"
            "「すみません、思い出せません。もう少しヒントをもらえますか？」のように正直に伝えてください。"
        )
    text = "\n【記憶検索の結果（候補）】\nユーザーが曖昧に何かを参照しています。以下の候補から心当たりがあれば提案してください：\n"
    for r in search_results[:3]:
        text += f"- {r.get('abstract') or r.get('content', '')}\n"
    text += "もし該当するものがあれば「あ、もしかして○○のことですか？」のように自然に聞いてください。\n"
    return text
