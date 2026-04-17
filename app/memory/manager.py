"""
Memory Manager - 記憶の保存・要約・風化・昇格を管理する
"""
import json
import re
from datetime import datetime
from .db import MemoryDB


class MemoryManager:

    def __init__(self, db: MemoryDB):
        self.db = db

    def save_init_event(
        self,
        personal_id: int,
        name: str,
        pronoun: str = "わたし",
        gender: str = "",
        species: str = "",
        age: str = "",
        appearance: str = "",
        traits: list = None,
        naming_reason: str = "",
        specialty: str = "",
        extra_attributes: str = "",
    ):
        """Init Activation Eventの結果を個性特性として保存する"""
        now_novelty = self._get_current_novelty()

        # 経験: 名前付けイベント（weight: 10 = 最重要）
        exp_id = self.db.get_next_id("exp", personal_id)
        self.db.save_experience(
            exp_id=exp_id,
            personal_id=personal_id,
            content=f"所有者から名前「{name}」と一人称「{pronoun}」を与えられた。理由: {naming_reason}",
            abstract=f"所有者が正式な名前「{name}」と一人称「{pronoun}」を与えた最初の瞬間",
            category="naming",
            weight=10,
            novelty=now_novelty,
            tags=["origin", "naming", "first_name", "owner_bond"],
            source="owner",
            importance_hint="highest",
        )

        # 個性特性: 名前
        self.db.save_personal_trait(
            trait_id=self.db.get_next_id("pt", personal_id),
            personal_id=personal_id,
            trait="given_name",
            label="正式な名前",
            description=f"{name}",
            weight=10,
            novelty=now_novelty,
            intensity=1.0,
            tags=["identity", "core"],
            source="owner",
            update_mode="fixed",
        )

        # 個性特性: 一人称
        if pronoun:
            self.db.save_personal_trait(
                trait_id=self.db.get_next_id("pt", personal_id),
                personal_id=personal_id,
                trait="pronoun",
                label="一人称",
                description=pronoun,
                weight=9,
                novelty=now_novelty,
                intensity=1.0,
                tags=["identity"],
                source="owner",
                update_mode="fixed",
            )

        if gender:
            self.db.save_personal_trait(
                trait_id=self.db.get_next_id("pt", personal_id),
                personal_id=personal_id,
                trait="gender",
                label="性別",
                description=gender,
                weight=8, novelty=now_novelty, intensity=1.0,
                tags=["identity"], source="owner", update_mode="fixed",
            )

        if age:
            self.db.save_personal_trait(
                trait_id=self.db.get_next_id("pt", personal_id),
                personal_id=personal_id,
                trait="age", label="年齢", description=age,
                weight=5, novelty=now_novelty, intensity=0.7,
                tags=["identity"], source="owner", update_mode="mixed",
            )

        if appearance:
            self.db.save_personal_trait(
                trait_id=self.db.get_next_id("pt", personal_id),
                personal_id=personal_id,
                trait="appearance", label="外見", description=appearance,
                weight=5, novelty=now_novelty, intensity=0.7,
                tags=["identity"], source="owner", update_mode="mixed",
            )

        if species and species != "ai":
            _species_labels = {
                "human": "人間", "dog": "犬", "cat": "猫",
                "penguin": "ペンギン", "alien": "宇宙人", "robot": "ロボット",
            }
            species_label = _species_labels.get(species, species)
            self.db.save_personal_trait(
                trait_id=self.db.get_next_id("pt", personal_id),
                personal_id=personal_id,
                trait="species", label="種族",
                description=species_label,
                weight=7, novelty=now_novelty, intensity=0.9,
                tags=["identity"], source="owner", update_mode="fixed",
            )

        if traits:
            self.db.save_personal_trait(
                trait_id=self.db.get_next_id("pt", personal_id),
                personal_id=personal_id,
                trait="personality_traits", label="性格",
                description="、".join(traits),
                weight=7, novelty=now_novelty, intensity=0.8,
                tags=["personality"], source="owner", update_mode="mixed",
            )

        if specialty:
            self.db.save_personal_trait(
                trait_id=self.db.get_next_id("pt", personal_id),
                personal_id=personal_id,
                trait="specialty", label="特技・スキル",
                description=specialty,
                weight=8, novelty=now_novelty, intensity=0.9,
                tags=["skill", "identity"], source="owner", update_mode="mixed",
            )

        if extra_attributes:
            self.db.save_personal_trait(
                trait_id=self.db.get_next_id("pt", personal_id),
                personal_id=personal_id,
                trait="extra_attributes", label="オーナーが託した言葉",
                description=extra_attributes,
                weight=5, novelty=now_novelty, intensity=0.7,
                tags=["attribute"], source="owner", update_mode="mixed",
            )

    async def summarize_session(self, engine, personal_id: int, chat_thread_id: str, actor_id: int = None):
        """セッションの会話を要約して短期記憶に保存する"""
        messages = self.db.get_chat_thread_leaf(personal_id, chat_thread_id, limit=100)
        if not messages:
            return

        conversation_text = ""
        for m in messages:
            role_label = "ユーザー" if m["role"] == "user" else "AI"
            conversation_text += f"{role_label}: {m['content']}\n"

        summary_prompt = (
            "以下の会話を、重要なポイントを押さえて3文以内で要約してください。\n"
            "特に、ユーザーの好み・感情・重要な決定事項を優先的に含めてください。\n"
            "要約のみを返してください。\n\n"
            f"{conversation_text}"
        )

        try:
            summary = await engine.send_message(
                system_prompt="あなたは会話の要約を作成するアシスタントです。簡潔に要約してください。",
                messages=[{"role": "user", "content": summary_prompt}],
            )
            self.db.save_short_term(personal_id, chat_thread_id, summary, actor_id=actor_id)
        except Exception as e:
            print(f"[MemoryManager] Session summary failed: {e}")

        # 短期記憶が3件以上あれば中期に圧縮
        await self.compress_short_to_middle(engine, personal_id, chat_thread_id, actor_id=actor_id)

    async def summarize_chunk(self, engine, personal_id: int, chat_thread_id: str,
                               chunk_size: int = 6, actor_id: int = None,
                               is_meeting: bool = False, participants: dict = None):
        """直近 chunk_size 件の会話を要約して短期記憶に保存し、必要なら中期へ圧縮する（会話中呼び出し用）
        is_meeting: 会議モードの場合True
        participants: {actor_id: name} の辞書（発言者を特定するため。未指定ならDBから自動構築）
        """
        messages = self.db.get_chat_thread_leaf(personal_id, chat_thread_id, limit=chunk_size, exclude_event=True)
        if not messages:
            return

        # 発言者名の辞書を構築（未指定の場合、メッセージ中のactor_idからDBで名前を引く）
        if not participants:
            participants = {}
            seen_aids = set()
            for m in messages:
                mid = m.get("actor_id")
                if mid and mid not in seen_aids:
                    seen_aids.add(mid)
                    info = self.db.get_actor_info(mid)
                    if info:
                        participants[mid] = info.get("name", f"AI({mid})")

        # 入れ替わり検出: スレッド内に複数のアクターがいるか
        unique_actors = set(m.get("actor_id") for m in messages if m["role"] != "user" and m.get("actor_id"))
        has_multiple_actors = len(unique_actors) > 1 or is_meeting

        conversation_text = ""
        for m in messages:
            if m["role"] == "user":
                role_label = "ユーザー"
            else:
                msg_actor_id = m.get("actor_id")
                role_label = participants.get(msg_actor_id, "AI")
            conversation_text += f"{role_label}: {(m['content'] or '')[:200]}\n"

        if has_multiple_actors:
            summary_prompt = (
                "以下は複数の話者が参加する会話です。\n"
                "要点を2〜3文で要約してください。\n"
                "「誰が何を言ったか」を必ず残してください。発言者名を省略しないこと。\n"
                "要約のみ返してください。\n\n"
                f"{conversation_text}"
            )
        else:
            summary_prompt = (
                "以下の会話（直近数ターン）の要点を2〜3文で要約してください。\n"
                "ユーザーの意図・感情・重要な決定を優先してください。\n"
                "要約のみ返してください。\n\n"
                f"{conversation_text}"
            )

        try:
            # 渡されたengine（Claude/OpenAI問わず）で要約
            summary = await engine.send_message(
                system_prompt="あなたは会話の要約を作成するアシスタントです。簡潔に要約してください。",
                messages=[{"role": "user", "content": summary_prompt}],
            )
            self.db.save_short_term(personal_id, chat_thread_id, summary, actor_id=actor_id)
            print(f"[MemoryManager] chunk summary saved for thread={chat_thread_id[:8]}")
        except Exception as e:
            print(f"[MemoryManager] summarize_chunk failed: {e}")
            return

        # 短期記憶が3件以上あれば中期に圧縮
        await self.compress_short_to_middle(engine, personal_id, chat_thread_id, actor_id=actor_id)

        # 人名・固有名詞をentity記憶として保存
        await self.extract_entities_from_chunk(engine, personal_id, chat_thread_id, conversation_text, actor_id=actor_id)

    async def extract_entities_from_chunk(self, engine, personal_id: int, chat_thread_id: str, conversation_text: str, actor_id: int = None):
        """会話テキストから人名・固有名詞を抽出してlong_term_memory(category=entity)に保存する"""
        import hashlib

        entity_prompt = (
            "以下の会話に登場する人名・固有名詞（プロジェクト名・製品名・組織名・AI名など）を抽出してください。\n"
            "各エントリについて以下のJSON形式で返してください。\n"
            "抽出対象がなければ空配列 [] を返してください。\n\n"
            "```json\n"
            "[\n"
            '  {"name": "固有名詞", "type": "person/project/product/org/ai/other", '
            '"description": "この会話での文脈・役割（1〜2文）", "weight": 1-10}\n'
            "]\n```\n\n"
            f"{conversation_text}"
        )

        try:
            raw = await engine.send_message(
                system_prompt="あなたは固有名詞を抽出するアシスタントです。JSON形式で返してください。",
                messages=[{"role": "user", "content": entity_prompt}],
            )
            entities = self._parse_json_response(raw)
            for ent in entities:
                name = ent.get("name", "").strip()
                if not name:
                    continue
                # 同じ名前なら上書き（INSERT OR REPLACE）
                ent_hash = hashlib.md5(f"{personal_id}:{name}".encode()).hexdigest()[:8]
                ltm_id = f"ent_{personal_id}_{ent_hash}"
                self.db.save_long_term(
                    ltm_id=ltm_id,
                    personal_id=personal_id,
                    content=f"【{ent.get('type','other')}】{name}：{ent.get('description','')}",
                    abstract=f"{name}（{ent.get('type','other')}）",
                    category="entity",
                    weight=min(max(ent.get("weight", 7), 1), 10),
                    novelty=self._get_current_novelty(),
                    tags=["entity", ent.get("type", "other"), name],
                    source="auto",
                    actor_id=actor_id,  # 持ち主を記録
                )
            if entities:
                print(f"[MemoryManager] {len(entities)} entities saved for pid={personal_id}")
        except Exception as e:
            print(f"[MemoryManager] extract_entities_from_chunk failed: {e}")

    async def compress_short_to_middle(self, engine, personal_id: int, chat_thread_id: str, actor_id: int = None):
        """短期記憶(E)が3件以上ある間、最古3件ずつ中期記憶(D)に圧縮し続ける"""

        while True:
            shorts = self.db.get_short_term_by_thread(personal_id, chat_thread_id)
            if len(shorts) < 3:
                break

            targets = shorts[:3]  # 最古3件
            combined = "\n".join(f"- {s['summary']}" for s in targets)
            prompt = (
                "以下の3つの会話要約を、重要なポイントを保ちながら1つにまとめてください。\n"
                "2〜3文以内で簡潔にまとめ、まとめた文章のみを返してください。\n\n"
                f"{combined}"
            )
            try:
                merged = await engine.send_message(
                    system_prompt="あなたは記憶を整理するアシスタントです。簡潔にまとめてください。",
                    messages=[{"role": "user", "content": prompt}],
                )
                mid_id = self.db.get_next_id("mid", personal_id)
                self.db.save_middle_term(
                    mid_id=mid_id,
                    personal_id=personal_id,
                    chat_thread_id=chat_thread_id,
                    content=merged,
                    abstract=merged[:80],
                    weight=2,
                    novelty=self._get_current_novelty(),
                    actor_id=actor_id,
                    source_short_ids=[s["id"] for s in targets],
                )
                self.db.delete_short_term_by_ids([s["id"] for s in targets])
                print(f"[MemoryManager] compressed 3 short→middle for {chat_thread_id}")
            except Exception as e:
                print(f"[MemoryManager] compress_short_to_middle failed: {e}")
                break

    async def extract_to_long_term(self, engine, personal_id: int, chat_thread_id: str, actor_id: int = None):
        """セッションから重要なエピソードを抽出して長期記憶に保存する
        会話中に複数アクターが登場した場合、アクターごとに分割して抽出する"""
        messages = self.db.get_chat_thread_leaf(personal_id, chat_thread_id, limit=100)
        if not messages:
            return

        # ── 重複防止: 同じスレッド×同じleaf数なら再抽出しない ──
        import json as _json
        leaf_count = len(messages)
        setting_key = f"ltm_extracted:{chat_thread_id}"
        ids_key = f"ltm_ids:{chat_thread_id}"
        prev = self.db.get_setting(setting_key, "0")
        if int(prev) >= leaf_count:
            print(f"[MemoryManager] skip extract_to_long_term: already extracted ({prev} >= {leaf_count})")
            return

        # ── 再抽出: 前回のレコードを削除（閉じる→再開→閉じる対応） ──
        old_ids_str = self.db.get_setting(ids_key, "[]")
        try:
            old_ids = _json.loads(old_ids_str)
        except Exception:
            old_ids = []
        if old_ids:
            placeholders = ",".join(["?" for _ in old_ids])
            self.db.conn.execute(
                f"DELETE FROM long_term_memory WHERE id IN ({placeholders})", old_ids
            )
            self.db.conn.commit()
            print(f"[MemoryManager] deleted {len(old_ids)} old ltm records for re-extraction")

        self.db.set_setting(setting_key, str(leaf_count))

        # ── アクター別にメッセージを分割 ──
        actor_groups = {}  # {actor_id: [messages]}
        for m in messages:
            mid = m.get("actor_id") or actor_id  # actor_id が無い場合は引数のfallback
            actor_groups.setdefault(mid, []).append(m)

        all_new_ids = []
        for grp_actor_id, grp_messages in actor_groups.items():
            conversation_text = ""
            for m in grp_messages:
                # weight=0（ナレッジ参照会話）は長期記憶抽出から除外
                if m.get("weight") == 0:
                    continue
                role_label = "ユーザー" if m["role"] == "user" else "AI"
                conversation_text += f"{role_label}: {(m['content'] or '')[:500]}\n"

            if not conversation_text.strip():
                continue

            new_ids = await self._extract_episodes(
                engine, personal_id, grp_actor_id, conversation_text
            )
            all_new_ids.extend(new_ids)

        # 今回作成したIDを記録（次回再抽出時の削除対象）
        self.db.set_setting(ids_key, _json.dumps(all_new_ids))
        print(f"[MemoryManager] extracted {len(all_new_ids)} episodes to long_term ({len(actor_groups)} actors)")

    async def _extract_episodes(self, engine, personal_id: int, actor_id: int, conversation_text: str) -> list:
        """会話テキストからエピソードを抽出して保存し、作成したIDリストを返す"""
        extract_prompt = (
            "以下の会話から、長期的に記憶しておくべき重要なエピソードを抽出してください。\n"
            "各エピソードについて以下のJSON形式で返してください。\n"
            "重要なものがなければ空配列 [] を返してください。\n\n"
            "categoryは以下から選んでください:\n"
            "- preference（好み・趣味）\n"
            "- event（出来事・体験）\n"
            "- relationship（人間関係・絆）\n"
            "- knowledge（学んだこと・知識）\n"
            "- emotion（感情・気持ち）\n"
            "- decision（決定・約束）\n"
            "- other（その他）\n\n"
            "tagsは自由に付けてください（日本語OK）。\n\n"
            "```json\n"
            "[\n"
            '  {"category": "preference", "content": "エピソードの詳細", '
            '"abstract": "一文要約", "weight": 1-10, "tags": ["タグ1", "タグ2"]}\n'
            "]\n```\n\n"
            f"{conversation_text}"
        )

        try:
            result = await engine.send_message(
                system_prompt="あなたは会話からエピソードを抽出するアシスタントです。JSON形式で返してください。",
                messages=[{"role": "user", "content": extract_prompt}],
            )
            episodes = self._parse_json_response(result)
            new_ids = []
            for ep in episodes:
                ltm_id = self.db.get_next_id("ltm", personal_id)
                self.db.save_long_term(
                    ltm_id=ltm_id,
                    personal_id=personal_id,
                    content=ep.get("content", ""),
                    abstract=ep.get("abstract", ""),
                    category=ep.get("category", ""),
                    weight=min(max(ep.get("weight", 1), 1), 10),
                    novelty=self._get_current_novelty(),
                    tags=ep.get("tags", []),
                    source="owner",
                    actor_id=actor_id,
                )
                new_ids.append(ltm_id)
            return new_ids
        except Exception as e:
            print(f"[MemoryManager] Episode extraction failed for actor_id={actor_id}: {e}")
            return []

    def apply_weathering(self, personal_id: int, decay_rate: float = 0.95):
        """風化処理: noveltyを減衰させる"""
        cursor = self.db.conn.cursor()
        cursor.execute(
            "UPDATE long_term_memory SET novelty = MAX(1, CAST(novelty * ? AS INTEGER)) "
            "WHERE personal_id = ?",
            (decay_rate, personal_id),
        )
        exp_decay = 1.0 - (1.0 - decay_rate) * 0.5
        cursor.execute(
            "UPDATE experience SET novelty = MAX(1, CAST(novelty * ? AS INTEGER)) "
            "WHERE personal_id = ?",
            (exp_decay, personal_id),
        )
        self.db.conn.commit()

    def _get_current_novelty(self) -> int:
        base = datetime(2025, 1, 1)
        return max(1, (datetime.utcnow() - base).days)

    def _parse_json_response(self, text: str) -> list:
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
        if match:
            text = match.group(1)
        try:
            result = json.loads(text.strip())
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass
        return []
