from __future__ import annotations
"""
Memory DB - SQLiteによる記憶の永続化
EPL仕様に基づく: 人格実体(personal) / 会話履歴 / 短期記憶 / 長期記憶 / 経験 / 個性特性
全テーブルが personal_id に紐づく
"""
import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path


class MemoryDB:

    def __init__(self, db_path: str = "data/db/epel.db"):
        # 旧パス (data/xxx.db) から新パス (data/db/xxx.db) への自動移行
        _new_path = Path(db_path)
        _new_parent = _new_path.parent
        _new_parent.mkdir(parents=True, exist_ok=True)
        if not _new_path.exists():
            # data/db/ 階層を外した旧パスを試す（例: data/db/epel.db → data/epel.db）
            _old_path = _new_parent.parent / _new_path.name
            if _old_path.exists() and _old_path.resolve() != _new_path.resolve():
                import shutil
                shutil.move(str(_old_path), str(_new_path))
                print(f"[MIGRATE-PATH] {_old_path} -> {_new_path}")
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._create_tables()
        self._migrate_tables()

    def _migrate_tables(self):
        """既存テーブル名のマイグレーション"""
        cursor = self.conn.cursor()
        # personals → personal
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='personals'")
            if cursor.fetchone():
                cursor.execute("ALTER TABLE personals RENAME TO personal")
                self.conn.commit()
                print("[MIGRATE] personals → personal")
        except Exception as e:
            print(f"[MIGRATE] skip: {e}")

        # conversations → chat_leaf
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'")
            if cursor.fetchone():
                cursor.execute("ALTER TABLE conversations RENAME TO chat_leaf")
                self.conn.commit()
                print("[MIGRATE] conversations → chat_leaf")
        except Exception as e:
            print(f"[MIGRATE] conversations→chat_leaf skip: {e}")

        # settings → setting
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
            if cursor.fetchone():
                cursor.execute("ALTER TABLE settings RENAME TO setting")
                self.conn.commit()
                print("[MIGRATE] settings → setting")
        except Exception as e:
            print(f"[MIGRATE] settings→setting skip: {e}")

        # personal_traits → personal_trait
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='personal_traits'")
            if cursor.fetchone():
                cursor.execute("ALTER TABLE personal_traits RENAME TO personal_trait")
                self.conn.commit()
                print("[MIGRATE] personal_traits → personal_trait")
        except Exception as e:
            print(f"[MIGRATE] personal_traits→personal_trait skip: {e}")

        # chat_leaf に user_id カラム追加
        try:
            cursor.execute("PRAGMA table_info(chat_leaf)")
            columns = [row[1] for row in cursor.fetchall()]
            if columns and "user_id" not in columns:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1")
                self.conn.commit()
                print("[MIGRATE] chat_leaf に user_id カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf user_id skip: {e}")

        # actor テーブルが無ければ作成 & personal からデータ移行
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='actor'")
            if not cursor.fetchone():
                cursor.execute("""
                    CREATE TABLE actor (
                        actor_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        personal_id INTEGER NOT NULL,
                        name TEXT NOT NULL,
                        pronoun TEXT DEFAULT 'わたし',
                        gender TEXT DEFAULT '',
                        age TEXT DEFAULT '',
                        appearance TEXT DEFAULT '',
                        is_unnamed INTEGER DEFAULT 0,
                        naming_reason TEXT DEFAULT '',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (personal_id) REFERENCES personal(personal_id)
                    )
                """)
                rows = cursor.execute(
                    "SELECT personal_id, name, pronoun, gender, age, appearance, is_unnamed, naming_reason, created_at FROM personal"
                ).fetchall()
                for r in rows:
                    cursor.execute(
                        "INSERT INTO actor (actor_id, personal_id, name, pronoun, gender, age, appearance, is_unnamed, naming_reason, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (r[0], r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]),
                    )
                    print(f"[MIGRATE] actor 作成: {r[1]} (actor_id={r[0]}, personal_id={r[0]})")
                self.conn.commit()
        except Exception as e:
            print(f"[MIGRATE] actor skip: {e}")

        # chat_leaf に actor_id カラム追加
        try:
            cursor.execute("PRAGMA table_info(chat_leaf)")
            columns = [row[1] for row in cursor.fetchall()]
            if columns and "actor_id" not in columns:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN actor_id INTEGER NOT NULL DEFAULT 1")
                self.conn.commit()
                print("[MIGRATE] chat_leaf に actor_id カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf actor_id skip: {e}")

        # user に dev_flag カラム追加
        try:
            cursor.execute("PRAGMA table_info(user)")
            columns = [row[1] for row in cursor.fetchall()]
            if "dev_flag" not in columns:
                cursor.execute("ALTER TABLE user ADD COLUMN dev_flag INTEGER NOT NULL DEFAULT 0")
                self.conn.commit()
                print("[MIGRATE] user に dev_flag カラム追加")
        except Exception as e:
            print(f"[MIGRATE] user dev_flag skip: {e}")

        # actor に immersion カラム追加
        try:
            cursor.execute("PRAGMA table_info(actor)")
            columns = [row[1] for row in cursor.fetchall()]
            if "immersion" not in columns:
                cursor.execute("ALTER TABLE actor ADD COLUMN immersion REAL DEFAULT 0.7")
                cursor.execute("UPDATE actor SET immersion = 1.0 WHERE actor_id = 1")
                self.conn.commit()
                print("[MIGRATE] actor に immersion カラム追加（actor_id=1は1.0）")
        except Exception as e:
            print(f"[MIGRATE] actor immersion skip: {e}")

        # actor に profile_data カラム追加
        try:
            cursor.execute("PRAGMA table_info(actor)")
            columns = [row[1] for row in cursor.fetchall()]
            if "profile_data" not in columns:
                cursor.execute("ALTER TABLE actor ADD COLUMN profile_data TEXT DEFAULT NULL")
                self.conn.commit()
                print("[MIGRATE] actor に profile_data カラム追加")
        except Exception as e:
            print(f"[MIGRATE] actor profile_data skip: {e}")

        # 記憶テーブルに actor_id カラム追加
        for table in ["short_term_memory", "long_term_memory", "experience"]:
            try:
                cursor.execute(f"PRAGMA table_info({table})")
                columns = [row[1] for row in cursor.fetchall()]
                if columns and "actor_id" not in columns:
                    cursor.execute(f"ALTER TABLE {table} ADD COLUMN actor_id INTEGER DEFAULT NULL")
                    self.conn.commit()
                    print(f"[MIGRATE] {table} に actor_id カラム追加")
            except Exception as e:
                print(f"[MIGRATE] {table} actor_id skip: {e}")

        # chat → chat_leaf リネーム
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='chat'")
            has_chat = cursor.fetchone()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_leaf'")
            has_chat_leaf = cursor.fetchone()
            if has_chat and not has_chat_leaf:
                cursor.execute("ALTER TABLE chat RENAME TO chat_leaf")
                self.conn.commit()
                print("[MIGRATE] chat → chat_leaf")
        except Exception as e:
            print(f"[MIGRATE] chat→chat_leaf skip: {e}")

        # session_id → chat_thread_id リネーム
        try:
            cursor.execute("PRAGMA table_info(chat_leaf)")
            columns = [row[1] for row in cursor.fetchall()]
            if "session_id" in columns and "chat_thread_id" not in columns:
                cursor.execute("ALTER TABLE chat_leaf RENAME COLUMN session_id TO chat_thread_id")
                self.conn.commit()
                print("[MIGRATE] chat_leaf: session_id → chat_thread_id")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf session_id rename skip: {e}")

        try:
            cursor.execute("PRAGMA table_info(short_term_memory)")
            columns = [row[1] for row in cursor.fetchall()]
            if "session_id" in columns and "chat_thread_id" not in columns:
                cursor.execute("ALTER TABLE short_term_memory RENAME COLUMN session_id TO chat_thread_id")
                self.conn.commit()
                print("[MIGRATE] short_term_memory: session_id → chat_thread_id")
        except Exception as e:
            print(f"[MIGRATE] short_term_memory session_id rename skip: {e}")

        # setting キーのリネーム
        try:
            key_renames = [
                ('session_title:', 'chat_thread_title:'),
                ('session_share_level:', 'chat_thread_share_level:'),
                ('session_immersion:', 'chat_thread_immersion:'),
            ]
            for old_prefix, new_prefix in key_renames:
                rows = cursor.execute(
                    "SELECT key, value FROM setting WHERE key LIKE ?",
                    (old_prefix + '%',)
                ).fetchall()
                for r in rows:
                    new_key = new_prefix + r[0][len(old_prefix):]
                    cursor.execute("INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)", (new_key, r[1]))
                    cursor.execute("DELETE FROM setting WHERE key = ?", (r[0],))
                    print(f"[MIGRATE] setting key: {r[0]} → {new_key}")
            self.conn.commit()
        except Exception as e:
            print(f"[MIGRATE] setting key rename skip: {e}")

        # actor に is_ov カラム追加
        try:
            cursor.execute("PRAGMA table_info(actor)")
            columns = [row[1] for row in cursor.fetchall()]
            if "is_ov" not in columns:
                cursor.execute("ALTER TABLE actor ADD COLUMN is_ov INTEGER DEFAULT 0")
                self.conn.commit()
                print("[MIGRATE] actor: is_ov カラム追加")
        except Exception as e:
            print(f"[MIGRATE] actor is_ov skip: {e}")

        # chat_leaf に tags カラム追加
        try:
            cursor.execute("PRAGMA table_info(chat_leaf)")
            columns = [row[1] for row in cursor.fetchall()]
            if "tags" not in columns:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN tags TEXT DEFAULT '[]'")
                self.conn.commit()
                print("[MIGRATE] chat_leaf: tags カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf tags skip: {e}")

        # actor に actor_key カラム追加
        try:
            cursor.execute("PRAGMA table_info(actor)")
            columns = [row[1] for row in cursor.fetchall()]
            if "actor_key" not in columns:
                import uuid
                cursor.execute("ALTER TABLE actor ADD COLUMN actor_key TEXT DEFAULT NULL")
                rows = cursor.execute("SELECT actor_id FROM actor WHERE actor_key IS NULL").fetchall()
                for row in rows:
                    key = uuid.uuid4().hex[:8]
                    cursor.execute("UPDATE actor SET actor_key = ? WHERE actor_id = ?", (key, row[0]))
                self.conn.commit()
                print(f"[MIGRATE] actor: actor_key カラム追加（{len(rows)}件バックフィル）")
        except Exception as e:
            print(f"[MIGRATE] actor actor_key skip: {e}")

        # chat_leaf に deleted_at カラム追加
        try:
            cursor.execute("PRAGMA table_info(chat_leaf)")
            columns = [row[1] for row in cursor.fetchall()]
            if "deleted_at" not in columns:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN deleted_at TEXT DEFAULT NULL")
                self.conn.commit()
                print("[MIGRATE] chat_leaf: deleted_at カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf deleted_at skip: {e}")

        # chat_leaf に is_system_context カラム追加
        try:
            cursor.execute("PRAGMA table_info(chat_leaf)")
            columns = [row[1] for row in cursor.fetchall()]
            if "is_system_context" not in columns:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN is_system_context INTEGER NOT NULL DEFAULT 0")
                self.conn.commit()
                print("[MIGRATE] chat_leaf: is_system_context カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf is_system_context skip: {e}")

        # chat_leaf に attachment カラム追加
        try:
            cursor.execute("PRAGMA table_info(chat_leaf)")
            columns = [row[1] for row in cursor.fetchall()]
            if "attachment" not in columns:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN attachment TEXT DEFAULT NULL")
                self.conn.commit()
                print("[MIGRATE] chat_leaf: attachment カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf attachment skip: {e}")

        # cerebellum_log の cb_recall / used_recall を INTEGER→TEXT に変更
        try:
            cursor.execute("PRAGMA table_info(cerebellum_log)")
            col_info = {row[1]: row[2] for row in cursor.fetchall()}
            cb_recall_type = col_info.get("cerebellum_recall", "")
            used_recall_type = col_info.get("used_recall", "")
            if "INTEGER" in cb_recall_type.upper() or "INTEGER" in used_recall_type.upper():
                cursor.execute("ALTER TABLE cerebellum_log RENAME TO cerebellum_log_old")
                cursor.execute("""
                    CREATE TABLE cerebellum_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_at TEXT NOT NULL, message_preview TEXT,
                        keyword_tools TEXT, keyword_recall INTEGER,
                        cerebellum_tools TEXT, cerebellum_recall TEXT,
                        cerebellum_ms REAL, match INTEGER,
                        used_tools TEXT, used_recall TEXT, used_by TEXT
                    )
                """)
                cursor.execute("""
                    INSERT INTO cerebellum_log
                    SELECT id, created_at, message_preview, keyword_tools, keyword_recall,
                           cerebellum_tools, CAST(cerebellum_recall AS TEXT),
                           cerebellum_ms, match, used_tools,
                           CAST(used_recall AS TEXT), used_by
                    FROM cerebellum_log_old
                """)
                cursor.execute("DROP TABLE cerebellum_log_old")
                self.conn.commit()
                print("[MIGRATE] cerebellum_log: cb_recall/used_recall を TEXT 型に変更")
        except Exception as e:
            print(f"[MIGRATE] cerebellum_log TEXT型変換 skip: {e}")

        # chat テーブル新規作成＋既存データ移行
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='chat'")
            if not cursor.fetchone():
                cursor.execute("""
                    CREATE TABLE chat (
                        id TEXT PRIMARY KEY, personal_id INTEGER NOT NULL DEFAULT 1,
                        actor_id INTEGER NOT NULL DEFAULT 1, ov_id INTEGER DEFAULT NULL,
                        title TEXT DEFAULT NULL, source_id TEXT DEFAULT NULL,
                        mode TEXT DEFAULT 'single',
                        meeting_lv INTEGER DEFAULT 0,
                        meeting_type TEXT DEFAULT 'casual',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cursor.execute("""
                    INSERT OR IGNORE INTO chat (id, personal_id, actor_id, created_at, updated_at)
                    SELECT chat_thread_id, personal_id,
                        (SELECT actor_id FROM chat_leaf cl2 WHERE cl2.chat_thread_id = cl.chat_thread_id ORDER BY cl2.id DESC LIMIT 1),
                        MIN(created_at), MAX(created_at)
                    FROM chat_leaf cl GROUP BY chat_thread_id
                """)
                for r in cursor.execute("SELECT key, value FROM setting WHERE key LIKE 'chat_thread_title:%'").fetchall():
                    cursor.execute("UPDATE chat SET title = ? WHERE id = ?", (r[1], r[0][len('chat_thread_title:'):]))
                for r in cursor.execute("SELECT key, value FROM setting WHERE key LIKE 'chat_thread_source:%'").fetchall():
                    cursor.execute("UPDATE chat SET source_id = ? WHERE id = ?", (r[1], r[0][len('chat_thread_source:'):]))
                for r in cursor.execute("SELECT key, value FROM setting WHERE key LIKE 'chat_thread_ov:%' AND value != ''").fetchall():
                    try:
                        cursor.execute("UPDATE chat SET ov_id = ? WHERE id = ?", (int(r[1]), r[0][len('chat_thread_ov:'):]))
                    except ValueError:
                        pass
                self.conn.commit()
                print("[MIGRATE] chat テーブル作成＋既存スレッドデータ移行完了")
        except Exception as e:
            print(f"[MIGRATE] chat テーブル skip: {e}")

        # token_log にカラム追加
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(token_log)").fetchall()]
            if "response_preview" not in cols:
                cursor.execute("ALTER TABLE token_log ADD COLUMN response_preview TEXT DEFAULT NULL")
                self.conn.commit()
            if "error_flag" not in cols:
                cursor.execute("ALTER TABLE token_log ADD COLUMN error_flag INTEGER NOT NULL DEFAULT 0")
                self.conn.commit()
            if "cost_usd" not in cols:
                cursor.execute("ALTER TABLE token_log ADD COLUMN cost_usd REAL DEFAULT NULL")
                self.conn.commit()
            if "cache_read_tokens" not in cols:
                cursor.execute("ALTER TABLE token_log ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0")
                self.conn.commit()
                print("[MIGRATE] token_log: cache_read_tokens カラム追加")
            if "cache_write_tokens" not in cols:
                cursor.execute("ALTER TABLE token_log ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0")
                self.conn.commit()
                print("[MIGRATE] token_log: cache_write_tokens カラム追加")
        except Exception as e:
            print(f"[MIGRATE] token_log columns skip: {e}")

        # cerebellum_log に model_judgment カラム追加
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(cerebellum_log)").fetchall()]
            if cols and "model_judgment" not in cols:
                cursor.execute("ALTER TABLE cerebellum_log ADD COLUMN model_judgment TEXT DEFAULT NULL")
                self.conn.commit()
        except Exception as e:
            print(f"[MIGRATE] cerebellum_log model_judgment skip: {e}")

        # chat_leaf に model カラム追加
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(chat_leaf)").fetchall()]
            if cols and "model" not in cols:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN model TEXT DEFAULT NULL")
                self.conn.commit()
        except Exception as e:
            print(f"[MIGRATE] chat_leaf model skip: {e}")

        # chat_leaf に is_blind カラム追加（ブラインド発言フラグ）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(chat_leaf)").fetchall()]
            if cols and "is_blind" not in cols:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN is_blind INTEGER NOT NULL DEFAULT 0")
                self.conn.commit()
                print("[MIGRATE] chat_leaf: is_blind カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf is_blind skip: {e}")

        # chat_leaf に cache_summary カラム追加（leaf単位キャッシュ記憶）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(chat_leaf)").fetchall()]
            if cols and "cache_summary" not in cols:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN cache_summary TEXT DEFAULT NULL")
                self.conn.commit()
                print("[MIGRATE] chat_leaf: cache_summary カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf cache_summary skip: {e}")

        # chat_leaf に is_archived カラム追加（アーカイブフラグ）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(chat_leaf)").fetchall()]
            if cols and "is_archived" not in cols:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0")
                self.conn.commit()
                print("[MIGRATE] chat_leaf: is_archived カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf is_archived skip: {e}")

        # chat_leaf に weight カラム追加（ナレッジ参照会話はweight=0で長期記憶除外）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(chat_leaf)").fetchall()]
            if "weight" not in cols:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN weight INTEGER DEFAULT NULL")
                self.conn.commit()
                print("[MIGRATE] chat_leaf: weight カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf weight skip: {e}")

        # chat_leaf に weight_reason カラム追加（重みづけの理由）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(chat_leaf)").fetchall()]
            if "weight_reason" not in cols:
                cursor.execute("ALTER TABLE chat_leaf ADD COLUMN weight_reason TEXT DEFAULT NULL")
                self.conn.commit()
                print("[MIGRATE] chat_leaf: weight_reason カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat_leaf weight_reason skip: {e}")

        # chat テーブルに mode カラム追加（会議モード対応）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(chat)").fetchall()]
            if cols and "mode" not in cols:
                cursor.execute("ALTER TABLE chat ADD COLUMN mode TEXT DEFAULT 'single'")
                self.conn.commit()
                print("[MIGRATE] chat: mode カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat mode skip: {e}")

        # chat テーブルに meeting_lv カラム追加（会議記憶レベル: 0/1/2）
        # 旧名 memory_level → meeting_lv にリネーム（通常チャットのmemory_levelとの混同防止）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(chat)").fetchall()]
            if cols and "meeting_lv" not in cols and "memory_level" not in cols:
                cursor.execute("ALTER TABLE chat ADD COLUMN meeting_lv INTEGER DEFAULT 0")
                self.conn.commit()
                print("[MIGRATE] chat: meeting_lv カラム追加（新規）")
            elif cols and "memory_level" in cols and "meeting_lv" not in cols:
                cursor.execute("ALTER TABLE chat RENAME COLUMN memory_level TO meeting_lv")
                self.conn.commit()
                print("[MIGRATE] chat: memory_level → meeting_lv リネーム")
        except Exception as e:
            print(f"[MIGRATE] chat meeting_lv skip: {e}")

        # chat テーブルに meeting_type カラム追加（会議タイプ: casual/debate/brainstorm/consultation）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(chat)").fetchall()]
            if cols and "meeting_type" not in cols:
                cursor.execute("ALTER TABLE chat ADD COLUMN meeting_type TEXT DEFAULT 'casual'")
                self.conn.commit()
                print("[MIGRATE] chat: meeting_type カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat meeting_type skip: {e}")

        # chat に is_birth カラム追加（誕生スレッド削除禁止用）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(chat)").fetchall()]
            if cols and "is_birth" not in cols:
                cursor.execute("ALTER TABLE chat ADD COLUMN is_birth INTEGER DEFAULT 0")
                self.conn.commit()
                print("[MIGRATE] chat: is_birth カラム追加")
        except Exception as e:
            print(f"[MIGRATE] chat is_birth skip: {e}")

        # long_term_memory に meeting_only_thread カラム追加（Lv0会議記憶の外部参照禁止用）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(long_term_memory)").fetchall()]
            if cols and "meeting_only_thread" not in cols:
                cursor.execute("ALTER TABLE long_term_memory ADD COLUMN meeting_only_thread TEXT DEFAULT NULL")
                self.conn.commit()
                print("[MIGRATE] long_term_memory: meeting_only_thread カラム追加")
        except Exception as e:
            print(f"[MIGRATE] long_term_memory meeting_only_thread skip: {e}")

        # knowledge テーブル v2 移行（TEXT id → INTEGER id + key）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(knowledge)").fetchall()]
            if cols and "key" not in cols:
                # 旧テーブルのデータを退避
                old_rows = cursor.execute("SELECT * FROM knowledge").fetchall()
                old_cols = [d[0] for d in cursor.description] if cursor.description else []
                cursor.execute("DROP TABLE knowledge")
                self.conn.commit()
                print(f"[MIGRATE] knowledge: dropped old table ({len(old_rows)} rows backed up)")
                # 新テーブルを即座に再作成（_create_tablesは既に実行済みなので手動で）
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS knowledge (
                        id INTEGER PRIMARY KEY,
                        key TEXT UNIQUE NOT NULL,
                        personal_id INTEGER DEFAULT NULL,
                        type TEXT NOT NULL DEFAULT 'knowledge',
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        category TEXT NOT NULL DEFAULT 'guide',
                        is_system INTEGER NOT NULL DEFAULT 0,
                        shortcut TEXT DEFAULT NULL,
                        is_magic INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """)
                self.conn.commit()
                print("[MIGRATE] knowledge: v2 table created")
            elif not cols:
                pass  # テーブルが存在しない（新規）
        except Exception as e:
            print(f"[MIGRATE] knowledge v2 skip: {e}")

        # personal に profile_data カラム追加（8代目: 口調・役割等を格納）
        try:
            cursor.execute("PRAGMA table_info(personal)")
            columns = [row[1] for row in cursor.fetchall()]
            if "profile_data" not in columns:
                cursor.execute("ALTER TABLE personal ADD COLUMN profile_data TEXT DEFAULT NULL")
                self.conn.commit()
                print("[MIGRATE] personal: added profile_data")
        except Exception as e:
            print(f"[MIGRATE] personal.profile_data skip: {e}")

        # actor に show_role_label カラム追加（8代目: 名前横の役割表示フラグ）
        try:
            cursor.execute("PRAGMA table_info(actor)")
            columns = [row[1] for row in cursor.fetchall()]
            if "show_role_label" not in columns:
                cursor.execute("ALTER TABLE actor ADD COLUMN show_role_label INTEGER DEFAULT 0")
                self.conn.commit()
                print("[MIGRATE] actor: added show_role_label")
        except Exception as e:
            print(f"[MIGRATE] actor.show_role_label skip: {e}")

    def _create_tables(self):
        cursor = self.conn.cursor()

        # ユーザー（将来の多人数ログイン対応）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT NOT NULL DEFAULT '初期ユーザ',
                dev_flag INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # デフォルトの初期ユーザを作成（存在しない場合）
        row = cursor.execute("SELECT COUNT(*) as cnt FROM user").fetchone()
        if row[0] == 0:
            cursor.execute(
                "INSERT INTO user (user_id, nickname) VALUES (1, '初期ユーザ')"
            )
            print("[INIT] 初期ユーザ(user_id=1) を作成")

        # 後回しメモ
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                personal_id INTEGER NOT NULL,
                actor_id INTEGER,
                chat_thread_id TEXT,
                content TEXT NOT NULL,
                memo_type TEXT DEFAULT 'memo',
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (personal_id) REFERENCES personal(personal_id)
            )
        """)
        # memo_type カラムのマイグレーション
        try:
            cursor.execute("PRAGMA table_info(memos)")
            cols = [r[1] for r in cursor.fetchall()]
            if cols and "memo_type" not in cols:
                cursor.execute("ALTER TABLE memos ADD COLUMN memo_type TEXT DEFAULT 'memo'")
                self.conn.commit()
                print("[MIGRATE] memos: memo_type カラム追加")
        except Exception:
            pass

        # Google認証ユーザー管理テーブル
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS google_auth (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                google_sub TEXT,
                personal_id INTEGER NOT NULL,
                display_name TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (personal_id) REFERENCES personal(personal_id)
            )
        """)

        # 会議参加者（会議モード用: スレッドごとの参加Actor一覧）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_participant (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_thread_id TEXT NOT NULL,
                actor_id INTEGER NOT NULL,
                personal_id INTEGER NOT NULL,
                engine_id TEXT DEFAULT NULL,
                model_id TEXT DEFAULT NULL,
                role TEXT DEFAULT 'member',
                join_order INTEGER DEFAULT 0,
                color TEXT DEFAULT NULL,
                label TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (actor_id) REFERENCES actor(actor_id),
                FOREIGN KEY (personal_id) REFERENCES personal(personal_id),
                UNIQUE(chat_thread_id, actor_id)
            )
        """)
        # migration: label カラム追加
        try:
            cursor.execute("ALTER TABLE chat_participant ADD COLUMN label TEXT DEFAULT NULL")
        except Exception:
            pass  # already exists

        # 人格実体（Personal単位 = 名前を持つ個性の実体）
        # Core(.epl)は共有、Personalが個性の単位
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS personal (
                personal_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                pronoun TEXT DEFAULT 'わたし',
                gender TEXT DEFAULT '',
                age TEXT DEFAULT '',
                appearance TEXT DEFAULT '',
                is_unnamed INTEGER DEFAULT 0,
                naming_reason TEXT DEFAULT '',
                profile_data TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # アクター（Actor = 名前を持つ表出人格、Personal配下に複数可）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS actor (
                actor_id INTEGER PRIMARY KEY AUTOINCREMENT,
                personal_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                pronoun TEXT DEFAULT 'わたし',
                gender TEXT DEFAULT '',
                age TEXT DEFAULT '',
                appearance TEXT DEFAULT '',
                is_unnamed INTEGER DEFAULT 0,
                naming_reason TEXT DEFAULT '',
                immersion REAL DEFAULT 0.7,
                profile_data TEXT DEFAULT NULL,
                is_ov INTEGER DEFAULT 0,
                actor_key TEXT DEFAULT NULL,
                base_lang TEXT DEFAULT NULL,
                show_role_label INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (personal_id) REFERENCES personal(personal_id)
            )
        """)

        # マイグレーション: actor に base_lang 列追加
        try:
            self.conn.execute("ALTER TABLE actor ADD COLUMN base_lang TEXT DEFAULT NULL")
            self.conn.commit()
            print("[MIGRATE] actor.base_lang 列を追加しました")
        except Exception:
            pass  # 既に存在

        # マイグレーション: actor に role_name 列追加（得意なこと・役割名）
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(actor)").fetchall()]
            if "role_name" not in cols:
                cursor.execute("ALTER TABLE actor ADD COLUMN role_name TEXT DEFAULT NULL")
                self.conn.commit()
                print("[MIGRATE] actor: role_name カラム追加")
        except Exception as e:
            print(f"[MIGRATE] actor role_name skip: {e}")

        # 会話履歴（全ログ・user_id + personal_id + actor_id紐づけ）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_leaf (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL DEFAULT 1,
                personal_id INTEGER NOT NULL DEFAULT 1,
                actor_id INTEGER NOT NULL DEFAULT 1,
                chat_thread_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT DEFAULT '[]',
                deleted_at TEXT DEFAULT NULL,
                is_system_context INTEGER NOT NULL DEFAULT 0,
                attachment TEXT DEFAULT NULL,
                model TEXT DEFAULT NULL,
                is_blind INTEGER NOT NULL DEFAULT 0,
                cache_summary TEXT DEFAULT NULL,
                is_archived INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES user(user_id),
                FOREIGN KEY (personal_id) REFERENCES personal(personal_id),
                FOREIGN KEY (actor_id) REFERENCES actor(actor_id)
            )
        """)

        # 短期記憶（セッション単位の要約）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS short_term_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                personal_id INTEGER NOT NULL DEFAULT 1,
                actor_id INTEGER DEFAULT NULL,
                chat_thread_id TEXT NOT NULL,
                summary TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (personal_id) REFERENCES personal(personal_id),
                FOREIGN KEY (actor_id) REFERENCES actor(actor_id)
            )
        """)

        # 中期記憶（複数スレッドの短期記憶を圧縮）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS middle_term_memory (
                id TEXT PRIMARY KEY,
                personal_id INTEGER NOT NULL DEFAULT 1,
                actor_id INTEGER DEFAULT NULL,
                chat_thread_id TEXT,
                content TEXT NOT NULL,
                abstract TEXT,
                weight INTEGER DEFAULT 1,
                novelty INTEGER DEFAULT 1,
                tags TEXT DEFAULT '[]',
                source_short_ids TEXT DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # キャッシュ記憶（スレッドごとの即時メモ）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cache_memory (
                id TEXT PRIMARY KEY,
                personal_id INTEGER NOT NULL DEFAULT 1,
                actor_id INTEGER DEFAULT NULL,
                chat_thread_id TEXT NOT NULL UNIQUE,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 長期記憶（風化モデル対応）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS long_term_memory (
                id TEXT PRIMARY KEY,
                personal_id INTEGER NOT NULL DEFAULT 1,
                actor_id INTEGER DEFAULT NULL,
                category TEXT,
                content TEXT NOT NULL,
                abstract TEXT,
                weight INTEGER DEFAULT 1,
                novelty INTEGER DEFAULT 1,
                tags TEXT DEFAULT '[]',
                source TEXT DEFAULT 'owner',
                created_at TIMESTAMP,
                updated_at TIMESTAMP,
                FOREIGN KEY (personal_id) REFERENCES personal(personal_id),
                FOREIGN KEY (actor_id) REFERENCES actor(actor_id)
            )
        """)

        # 経験レイヤー（追加のみ）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS experience (
                id TEXT PRIMARY KEY,
                personal_id INTEGER NOT NULL DEFAULT 1,
                actor_id INTEGER DEFAULT NULL,
                category TEXT,
                content TEXT NOT NULL,
                abstract TEXT,
                weight INTEGER DEFAULT 1,
                novelty INTEGER DEFAULT 1,
                tags TEXT DEFAULT '[]',
                source TEXT DEFAULT 'owner',
                origin_ref TEXT,
                locked INTEGER DEFAULT 0,
                importance_hint TEXT DEFAULT 'normal',
                goal_memory_id TEXT,
                created_at TIMESTAMP,
                updated_at TIMESTAMP,
                FOREIGN KEY (personal_id) REFERENCES personal(personal_id),
                FOREIGN KEY (actor_id) REFERENCES actor(actor_id)
            )
        """)

        # 個性特性（ミックス更新あり）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS personal_trait (
                id TEXT PRIMARY KEY,
                personal_id INTEGER NOT NULL DEFAULT 1,
                actor_id INTEGER DEFAULT NULL,
                trait TEXT NOT NULL,
                label TEXT,
                description TEXT,
                intensity REAL DEFAULT 0.5,
                weight INTEGER DEFAULT 1,
                novelty INTEGER DEFAULT 1,
                tags TEXT DEFAULT '[]',
                source TEXT DEFAULT 'owner',
                update_mode TEXT DEFAULT 'mixed',
                status TEXT DEFAULT 'active',
                history TEXT DEFAULT '[]',
                owner_visible INTEGER DEFAULT 1,
                owner_editable INTEGER DEFAULT 1,
                created_at TIMESTAMP,
                updated_at TIMESTAMP,
                FOREIGN KEY (personal_id) REFERENCES personal(personal_id),
                FOREIGN KEY (actor_id) REFERENCES actor(actor_id),
                UNIQUE(personal_id, actor_id, trait)
            )
        """)

        # マイグレーション: actor_id カラム追加
        try:
            cursor.execute("ALTER TABLE personal_trait ADD COLUMN actor_id INTEGER DEFAULT NULL")
        except Exception:
            pass
        # マイグレーション: status カラム追加
        try:
            cursor.execute("ALTER TABLE personal_trait ADD COLUMN status TEXT DEFAULT 'active'")
        except Exception:
            pass

        # マイグレーション: UNIQUE制約を (personal_id, trait) → (personal_id, actor_id, trait) に更新
        # per-actor traitを同じtrait名で複数登録可能にする
        try:
            # 現在のUNIQUE制約を確認
            _pt_sql = cursor.execute(
                "SELECT sql FROM sqlite_master WHERE name='personal_trait' AND type='table'"
            ).fetchone()
            if _pt_sql and "UNIQUE(personal_id, trait)" in _pt_sql[0] and "UNIQUE(personal_id, actor_id, trait)" not in _pt_sql[0]:
                print("[MIGRATE] personal_trait: UNIQUE制約を (personal_id, actor_id, trait) に更新中...")
                cursor.execute("ALTER TABLE personal_trait RENAME TO _personal_trait_old")
                cursor.execute("""
                    CREATE TABLE personal_trait (
                        id TEXT PRIMARY KEY,
                        personal_id INTEGER NOT NULL DEFAULT 1,
                        actor_id INTEGER DEFAULT NULL,
                        trait TEXT NOT NULL,
                        label TEXT,
                        description TEXT,
                        intensity REAL DEFAULT 0.5,
                        weight INTEGER DEFAULT 1,
                        novelty INTEGER DEFAULT 1,
                        tags TEXT DEFAULT '[]',
                        source TEXT DEFAULT 'owner',
                        update_mode TEXT DEFAULT 'mixed',
                        status TEXT DEFAULT 'active',
                        history TEXT DEFAULT '[]',
                        owner_visible INTEGER DEFAULT 1,
                        owner_editable INTEGER DEFAULT 1,
                        created_at TIMESTAMP,
                        updated_at TIMESTAMP,
                        FOREIGN KEY (personal_id) REFERENCES personal(personal_id),
                        FOREIGN KEY (actor_id) REFERENCES actor(actor_id),
                        UNIQUE(personal_id, actor_id, trait)
                    )
                """)
                cursor.execute("""
                    INSERT INTO personal_trait
                    SELECT id, personal_id, actor_id, trait, label, description, intensity,
                           weight, novelty, tags, source, update_mode, status, history,
                           owner_visible, owner_editable, created_at, updated_at
                    FROM _personal_trait_old
                """)
                cursor.execute("DROP TABLE _personal_trait_old")
                self.conn.commit()
                print("[MIGRATE] personal_trait: UNIQUE制約更新完了")
        except Exception as e:
            print(f"[MIGRATE] personal_trait UNIQUE constraint update skip: {e}")

        # 関係性UMA（心の層 — ユーザー×人格の永続的な温度・距離）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS relationship_uma (
                user_id INTEGER NOT NULL,
                personal_id INTEGER NOT NULL,
                actor_id INTEGER,
                base_temperature REAL NOT NULL DEFAULT 2.0,
                base_distance REAL NOT NULL DEFAULT 0.7,
                interaction_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT,
                UNIQUE(user_id, personal_id, actor_id)
            )
        """)

        # トークン使用ログ
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS token_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_thread_id TEXT NOT NULL,
                personal_id INTEGER NOT NULL,
                actor_id INTEGER,
                model TEXT NOT NULL,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cache_read_tokens INTEGER NOT NULL DEFAULT 0,
                cache_write_tokens INTEGER NOT NULL DEFAULT 0,
                response_preview TEXT DEFAULT NULL,
                error_flag INTEGER NOT NULL DEFAULT 0,
                cost_usd REAL DEFAULT NULL,
                created_at TEXT
            )
        """)

        # 設定（改行モード等）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS setting (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        # ゴールメモリ（C+: 目的別要約記憶）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS goal_memory (
                id TEXT PRIMARY KEY,
                personal_id INTEGER NOT NULL DEFAULT 1,
                label TEXT NOT NULL,
                parent_id TEXT,
                summary TEXT,
                ultra_summary TEXT,
                label_source TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # C+とスレッドの関連
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS goal_memory_thread (
                goal_memory_id TEXT NOT NULL,
                chat_thread_id TEXT NOT NULL,
                PRIMARY KEY (goal_memory_id, chat_thread_id)
            )
        """)

        # experienceにgoal_memory_idカラム追加（なければ）
        try:
            cursor.execute("ALTER TABLE experience ADD COLUMN goal_memory_id TEXT")
        except Exception:
            pass

        # 小脳シャドウログ（cb_recall/used_recall は TEXT型でdict形式のJSONを格納）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cerebellum_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                message_preview TEXT,
                keyword_tools TEXT,
                keyword_recall INTEGER,
                cerebellum_tools TEXT,
                cerebellum_recall TEXT,
                cerebellum_ms REAL,
                match INTEGER,
                used_tools TEXT,
                used_recall TEXT,
                used_by TEXT,
                model_judgment TEXT DEFAULT NULL
            )
        """)
        # マイグレーション: used_tools / used_recall / used_by カラム追加
        for col, typedef in [("used_tools", "TEXT"), ("used_recall", "TEXT"), ("used_by", "TEXT")]:
            try:
                cursor.execute(f"ALTER TABLE cerebellum_log ADD COLUMN {col} {typedef}")
            except Exception:
                pass

        # 記憶想起ログ（ターンごとにどのshort/middleが呼ばれたか記録）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memory_recall_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_thread_id TEXT NOT NULL,
                personal_id INTEGER NOT NULL DEFAULT 1,
                actor_id INTEGER DEFAULT NULL,
                user_message_preview TEXT,
                short_ids TEXT DEFAULT '[]',
                short_count INTEGER DEFAULT 0,
                short_source TEXT DEFAULT 'none',
                middle_id TEXT DEFAULT NULL,
                middle_source TEXT DEFAULT 'none',
                created_at TEXT NOT NULL
            )
        """)

        # サルベージデータ（user_data/からスキャンした生データ。有料オプション）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS salvage_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_name TEXT NOT NULL,
                source_path TEXT NOT NULL,
                filename TEXT NOT NULL,
                content_summary TEXT NOT NULL DEFAULT '',
                is_file_ref INTEGER NOT NULL DEFAULT 0,
                file_type TEXT DEFAULT '',
                file_size INTEGER DEFAULT 0,
                file_hash TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'raw',
                scanned_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(source_path)
            )
        """)

        # salvage_data マイグレーション: content → content_summary + is_file_ref
        try:
            cursor.execute("PRAGMA table_info(salvage_data)")
            cols = [row[1] for row in cursor.fetchall()]
            if "content" in cols and "content_summary" not in cols:
                cursor.execute("ALTER TABLE salvage_data ADD COLUMN content_summary TEXT NOT NULL DEFAULT ''")
                cursor.execute("ALTER TABLE salvage_data ADD COLUMN is_file_ref INTEGER NOT NULL DEFAULT 0")
                cursor.execute("UPDATE salvage_data SET content_summary = SUBSTR(content, 1, 2000)")
                cursor.execute("UPDATE salvage_data SET is_file_ref = 1 WHERE LENGTH(content) > 2000")
                self.conn.commit()
                print("[MIGRATE] salvage_data: content → content_summary + is_file_ref")
            elif "content_summary" not in cols and "content" not in cols:
                pass  # 新規テーブル（CREATE TABLE で既に正しいスキーマ）
        except Exception as e:
            print(f"[MIGRATE] salvage_data skip: {e}")

        # ナレッジ（参照ドキュメント。記憶とは完全分離）
        # id: 1-10000=システム予約, 10001+=ユーザー
        # key: sys_xxx（システム）/ usr_xxx（ユーザー）
        # type: knowledge / tool（将来拡張）
        # shortcut: _xxx（システム）/ xxx（ユーザー）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS knowledge (
                id INTEGER PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                personal_id INTEGER DEFAULT NULL,
                type TEXT NOT NULL DEFAULT 'knowledge',
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'guide',
                is_system INTEGER NOT NULL DEFAULT 0,
                shortcut TEXT DEFAULT NULL,
                is_magic INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        self.conn.commit()

    # ========== トークンログ ==========

    # モデル別単価（USD/1Mトークン）
    _MODEL_PRICE = {
        "claude-haiku-4-5-20251001": {"input": 0.80,  "output": 4.00},
        "claude-sonnet-4-6":         {"input": 3.00,  "output": 15.00},
        "claude-sonnet-4-20250514":  {"input": 3.00,  "output": 15.00},
        "claude-opus-4-6":           {"input": 15.00, "output": 75.00},
    }

    def calc_cost_usd(self, model: str, input_tokens: int, output_tokens: int,
                      cache_read_tokens: int = 0, cache_write_tokens: int = 0) -> float:
        """料金計算（キャッシュ対応）。
        - 通常input: 100%
        - cache_write: 125%（書き込み割増）
        - cache_read: 10%（読み込み90%オフ）
        - output: 100%
        ※ Anthropic仕様: input_tokens はキャッシュに乗らなかった分のみなので単純加算でOK。
        """
        price = self._MODEL_PRICE.get(model)
        if not price:
            # 未知モデルはsonnet単価でフォールバック
            price = {"input": 3.00, "output": 15.00}
        cost = (
            input_tokens * price["input"]
            + cache_write_tokens * price["input"] * 1.25
            + cache_read_tokens * price["input"] * 0.10
            + output_tokens * price["output"]
        )
        return cost / 1_000_000

    def add_token_log(self, chat_thread_id: str, personal_id: int, actor_id, model: str,
                      input_tokens: int, output_tokens: int,
                      response_preview: str = None, error_flag: int = 0,
                      cache_read_tokens: int = 0, cache_write_tokens: int = 0):
        now = datetime.utcnow().isoformat()
        cost_usd = self.calc_cost_usd(model, input_tokens, output_tokens,
                                      cache_read_tokens, cache_write_tokens)
        self.conn.execute(
            """INSERT INTO token_log
               (chat_thread_id, personal_id, actor_id, model, input_tokens, output_tokens,
                cache_read_tokens, cache_write_tokens,
                response_preview, error_flag, cost_usd, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (chat_thread_id, personal_id, actor_id, model, input_tokens, output_tokens,
             cache_read_tokens, cache_write_tokens,
             response_preview, error_flag, cost_usd, now),
        )
        self.conn.commit()

    def get_token_stats(self, personal_id: int = None, chat_thread_id: str = None) -> dict:
        cursor = self.conn.cursor()
        conditions = []
        params = ()
        if personal_id:
            conditions.append("personal_id = ?")
            params += (personal_id,)
        if chat_thread_id:
            conditions.append("chat_thread_id = ?")
            params += (chat_thread_id,)
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        usd_to_jpy = float(self.get_setting("usd_to_jpy", "150") or "150")

        # 累計
        row = cursor.execute(
            f"SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COUNT(*), COALESCE(SUM(cost_usd),0), "
            f"COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_write_tokens),0) FROM token_log {where}", params
        ).fetchone()
        total_input, total_output, call_count, total_cost_usd = row[0], row[1], row[2], row[3] or 0.0
        total_cache_read, total_cache_write = row[4] or 0, row[5] or 0
        # キャッシュ割引で節約した金額 (read された分を「通常課金だったら」との差で計算)
        # 便宜上 sonnet単価で概算（モデル別にやると重いので累計表示用）
        _avg_input_price = 3.00  # USD/1M
        cache_saved_usd = total_cache_read * _avg_input_price * 0.90 / 1_000_000

        # モデル別
        rows = cursor.execute(
            f"SELECT model, SUM(input_tokens), SUM(output_tokens), COUNT(*), COALESCE(SUM(cost_usd),0) FROM token_log {where} GROUP BY model ORDER BY SUM(input_tokens+output_tokens) DESC",
            params,
        ).fetchall()
        by_model = [{"model": r[0], "input_tokens": r[1], "output_tokens": r[2], "calls": r[3], "cost_usd": round(r[4] or 0, 4)} for r in rows]

        # 今月
        from datetime import datetime as _dt
        this_month = _dt.utcnow().strftime("%Y-%m")
        month_where = f"{'WHERE' if not where else where + ' AND'} strftime('%Y-%m', created_at) = ?"
        month_params = params + (this_month,)
        row = cursor.execute(
            f"SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COUNT(*), COALESCE(SUM(cost_usd),0) FROM token_log {month_where}", month_params
        ).fetchone()
        month_cost_usd = row[3] or 0.0

        # 日別（直近30日）
        rows = cursor.execute(
            f"SELECT strftime('%Y-%m-%d', created_at) as day, COUNT(*) as turns, COALESCE(SUM(cost_usd),0) as cost FROM token_log {where} GROUP BY day ORDER BY day DESC LIMIT 30",
            params,
        ).fetchall()
        by_day = [{"day": r[0], "turns": r[1], "cost_usd": round(r[2] or 0, 4), "cost_jpy": round((r[2] or 0) * usd_to_jpy, 1)} for r in rows]

        # コストシミュレーション（全ターン分を各モデルで計算）
        all_rows = cursor.execute(
            f"SELECT input_tokens, output_tokens FROM token_log {where}", params
        ).fetchall()
        sim = {}
        for model_id, price in self._MODEL_PRICE.items():
            cost = sum((r[0]*price["input"] + r[1]*price["output"])/1_000_000 for r in all_rows)
            sim[model_id] = {"cost_usd": round(cost, 4), "cost_jpy": round(cost * usd_to_jpy, 0)}

        # 直近20件
        rows = cursor.execute(
            f"SELECT chat_thread_id, model, input_tokens, output_tokens, cost_usd, created_at, "
            f"cache_read_tokens, cache_write_tokens FROM token_log {where} ORDER BY id DESC LIMIT 20",
            params,
        ).fetchall()
        recent = [{"chat_thread_id": r[0], "model": r[1], "input_tokens": r[2], "output_tokens": r[3],
                   "cost_usd": round(r[4] or 0, 5), "cost_jpy": round((r[4] or 0) * usd_to_jpy, 2),
                   "created_at": r[5],
                   "cache_read_tokens": r[6] or 0, "cache_write_tokens": r[7] or 0} for r in rows]

        return {
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "total_tokens": total_input + total_output,
            "call_count": call_count,
            "total_cost_usd": round(total_cost_usd, 4),
            "total_cost_jpy": round(total_cost_usd * usd_to_jpy, 0),
            "this_month_cost_usd": round(month_cost_usd, 4),
            "this_month_cost_jpy": round(month_cost_usd * usd_to_jpy, 0),
            "usd_to_jpy": usd_to_jpy,
            "by_model": by_model,
            "by_day": by_day,
            "cost_simulation": sim,
            "recent": recent,
            "total_cache_read_tokens": total_cache_read,
            "total_cache_write_tokens": total_cache_write,
            "cache_saved_usd": round(cache_saved_usd, 4),
            "cache_saved_jpy": round(cache_saved_usd * usd_to_jpy, 1),
            # キャッシュヒット率: read / (input + read)
            "cache_hit_ratio": round(total_cache_read / max(1, total_input + total_cache_read), 3),
        }

    # ========== 小脳ログ ==========

    def add_cerebellum_log(self, message_preview: str, keyword_tools: str, keyword_recall: int,
                           cerebellum_tools: str, cerebellum_recall, cerebellum_ms: float,
                           used_tools: str = None, used_recall=None, used_by: str = None,
                           model_judgment: str = None):
        # cerebellum_recall / used_recall は dict または int を TEXT(JSON)で保存
        cb_recall_str = json.dumps(cerebellum_recall) if isinstance(cerebellum_recall, dict) else str(cerebellum_recall) if cerebellum_recall is not None else None
        used_recall_str = json.dumps(used_recall) if isinstance(used_recall, dict) else str(used_recall) if used_recall is not None else None
        # match 判定: 旧形式(int)との互換のため keyword_recall と chat 値で比較
        cb_chat = cerebellum_recall.get("chat", cerebellum_recall) if isinstance(cerebellum_recall, dict) else cerebellum_recall
        match = 1 if (keyword_tools == cerebellum_tools and keyword_recall == cb_chat) else 0
        now = datetime.now().isoformat()
        self.conn.execute(
            """INSERT INTO cerebellum_log
               (created_at, message_preview, keyword_tools, keyword_recall,
                cerebellum_tools, cerebellum_recall, cerebellum_ms, match,
                used_tools, used_recall, used_by, model_judgment)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (now, message_preview[:60], keyword_tools, keyword_recall,
             cerebellum_tools, cb_recall_str, cerebellum_ms, match,
             used_tools, used_recall_str, used_by, model_judgment),
        )
        self.conn.commit()

    def save_memory_recall_log(
        self,
        chat_thread_id: str,
        personal_id: int,
        user_message_preview: str,
        short_ids: list,
        short_source: str,        # "keyword_match" | "none"
        middle_id: str | None,
        middle_source: str,       # "d_base" | "tier_recall" | "fallback" | "none"
        actor_id: int = None,
    ):
        """ターンごとの記憶想起ログを保存"""
        now = datetime.now().isoformat()
        self.conn.execute(
            """INSERT INTO memory_recall_log
               (chat_thread_id, personal_id, actor_id, user_message_preview,
                short_ids, short_count, short_source, middle_id, middle_source, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                chat_thread_id, personal_id, actor_id,
                (user_message_preview or "")[:60],
                json.dumps(short_ids or []),
                len(short_ids or []),
                short_source,
                middle_id,
                middle_source,
                now,
            ),
        )
        self.conn.commit()

    def get_memory_recall_log(self, personal_id: int, actor_id: int = None, limit: int = 20) -> list[dict]:
        """最近の記憶想起ログを返す"""
        if actor_id is not None:
            rows = self.conn.execute(
                """SELECT * FROM memory_recall_log
                   WHERE personal_id=? AND (actor_id IS NULL OR actor_id=?)
                   ORDER BY id DESC LIMIT ?""",
                (personal_id, actor_id, limit),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM memory_recall_log WHERE personal_id=? ORDER BY id DESC LIMIT ?",
                (personal_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_cerebellum_stats(self, limit: int = 50) -> dict:
        cursor = self.conn.cursor()
        rows = cursor.execute(
            "SELECT * FROM cerebellum_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        logs = [dict(r) for r in rows]

        total = len(logs)
        if total == 0:
            return {"total": 0, "match_rate": None, "avg_ms": None, "cb_adoption_rate": None, "logs": []}

        matched = sum(1 for r in logs if r["match"])
        avg_ms = sum(r["cerebellum_ms"] for r in logs if r["cerebellum_ms"]) / total
        # 小脳が実際に採用された割合（used_by="cerebellum"）
        cb_adopted = sum(1 for r in logs if r.get("used_by") == "cerebellum")
        return {
            "total": total,
            "match_rate": round(matched / total * 100, 1),
            "avg_ms": round(avg_ms, 1),
            "cb_adoption_rate": round(cb_adopted / total * 100, 1),
            "logs": logs,
        }

    # ========== ゴールメモリ (C+) ==========

    def create_goal_memory(self, personal_id: int, label: str, parent_id: str = None,
                           summary: str = "", ultra_summary: str = "",
                           label_source: str = "user") -> str:
        gid = str(uuid.uuid4())
        now = datetime.now().isoformat()
        self.conn.execute(
            """INSERT INTO goal_memory
               (id, personal_id, label, parent_id, summary, ultra_summary, label_source, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (gid, personal_id, label, parent_id, summary, ultra_summary, label_source, now, now),
        )
        self.conn.commit()
        return gid

    def get_goal_memories(self, personal_id: int) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM goal_memory WHERE personal_id=? ORDER BY updated_at DESC",
            (personal_id,)
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["thread_count"] = self.conn.execute(
                "SELECT COUNT(*) FROM goal_memory_thread WHERE goal_memory_id=?", (d["id"],)
            ).fetchone()[0]
            result.append(d)
        return result

    def get_goal_memory(self, gid: str) -> dict | None:
        row = self.conn.execute("SELECT * FROM goal_memory WHERE id=?", (gid,)).fetchone()
        return dict(row) if row else None

    def update_goal_memory(self, gid: str, label: str = None, summary: str = None,
                           ultra_summary: str = None, label_source: str = None):
        now = datetime.now().isoformat()
        gm = self.get_goal_memory(gid)
        if not gm:
            return
        self.conn.execute(
            """UPDATE goal_memory SET
               label=?, summary=?, ultra_summary=?, label_source=?, updated_at=?
               WHERE id=?""",
            (label or gm["label"], summary if summary is not None else gm["summary"],
             ultra_summary if ultra_summary is not None else gm["ultra_summary"],
             label_source or gm["label_source"], now, gid),
        )
        self.conn.commit()

    def delete_goal_memory(self, gid: str):
        self.conn.execute("DELETE FROM goal_memory_thread WHERE goal_memory_id=?", (gid,))
        self.conn.execute("DELETE FROM goal_memory WHERE id=?", (gid,))
        self.conn.commit()

    def link_thread_to_goal(self, gid: str, chat_thread_id: str):
        try:
            self.conn.execute(
                "INSERT INTO goal_memory_thread (goal_memory_id, chat_thread_id) VALUES (?,?)",
                (gid, chat_thread_id)
            )
            now = datetime.now().isoformat()
            self.conn.execute("UPDATE goal_memory SET updated_at=? WHERE id=?", (now, gid))
            self.conn.commit()
        except Exception:
            pass  # 重複は無視

    def unlink_thread_from_goal(self, gid: str, chat_thread_id: str):
        self.conn.execute(
            "DELETE FROM goal_memory_thread WHERE goal_memory_id=? AND chat_thread_id=?",
            (gid, chat_thread_id)
        )
        self.conn.commit()

    def get_threads_for_goal(self, gid: str) -> list[str]:
        rows = self.conn.execute(
            "SELECT chat_thread_id FROM goal_memory_thread WHERE goal_memory_id=?", (gid,)
        ).fetchall()
        return [r[0] for r in rows]

    def get_goals_for_thread(self, chat_thread_id: str) -> list[dict]:
        rows = self.conn.execute(
            """SELECT gm.* FROM goal_memory gm
               JOIN goal_memory_thread gmt ON gm.id = gmt.goal_memory_id
               WHERE gmt.chat_thread_id=?""",
            (chat_thread_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def get_long_term_memories_for_goal(self, gid: str) -> list[dict]:
        """C+に紐づくスレッドのC（長期記憶）を取得"""
        thread_ids = self.get_threads_for_goal(gid)
        if not thread_ids:
            return []
        placeholders = ",".join("?" * len(thread_ids))
        rows = self.conn.execute(
            f"SELECT * FROM long_term_memory WHERE source IN ({placeholders}) ORDER BY created_at DESC",
            thread_ids
        ).fetchall()
        return [dict(r) for r in rows]

    def set_experience_goal(self, experience_id: str, goal_memory_id: str):
        self.conn.execute(
            "UPDATE experience SET goal_memory_id=? WHERE id=?",
            (goal_memory_id, experience_id)
        )
        self.conn.commit()

    def get_ai_suggested_goal_labels(self, personal_id: int) -> list[dict]:
        """Lv1: AI自動候補（未確定）を返す"""
        rows = self.conn.execute(
            "SELECT * FROM goal_memory WHERE personal_id=? AND label_source='ai_auto' ORDER BY created_at DESC",
            (personal_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    # ========== 関係性UMA ==========

    def get_relationship_uma(self, user_id: int, personal_id: int, actor_id: int = None) -> dict:
        """
        関係性UMAを取得する。
        actor_id指定: そのActor固有の関係性を返す（なければPersonal共通にフォールバック）
        actor_id=None: Personal共通の関係性を返す
        """
        if actor_id is not None:
            # Actor固有を探す
            row = self.conn.execute(
                "SELECT * FROM relationship_uma WHERE user_id = ? AND personal_id = ? AND actor_id = ?",
                (user_id, personal_id, actor_id),
            ).fetchone()
            if row:
                return dict(row)
        # Personal共通（actor_id IS NULL）にフォールバック
        row = self.conn.execute(
            "SELECT * FROM relationship_uma WHERE user_id = ? AND personal_id = ? AND actor_id IS NULL",
            (user_id, personal_id),
        ).fetchone()
        if row:
            return dict(row)
        # まだ関係性がない: デフォルト値
        return {
            "user_id": user_id,
            "personal_id": personal_id,
            "actor_id": actor_id,
            "base_temperature": 2.0,
            "base_distance": 0.7,
            "interaction_count": 0,
            "updated_at": None,
        }

    def update_relationship_uma(
        self,
        user_id: int,
        personal_id: int,
        actor_id: int = None,
        chat_temperature: float = None,
        chat_distance: float = None,
        mix_ratio: float = 0.15,
    ) -> dict:
        """
        チャットUMAの値を関係性UMAに弱動的mixingで反映する。
        new_base = old_base * (1 - mix_ratio) + chat_value * mix_ratio
        """
        import datetime
        current = self.get_relationship_uma(user_id, personal_id, actor_id)
        old_temp = current["base_temperature"]
        old_dist = current["base_distance"]
        count = current["interaction_count"]

        new_temp = old_temp
        new_dist = old_dist
        if chat_temperature is not None:
            new_temp = round(old_temp * (1 - mix_ratio) + chat_temperature * mix_ratio, 2)
        if chat_distance is not None:
            new_dist = round(old_dist * (1 - mix_ratio) + chat_distance * mix_ratio, 3)
        new_count = count + 1
        now = datetime.datetime.now().isoformat()

        self._upsert_relationship_uma(user_id, personal_id, actor_id, new_temp, new_dist, new_count, now)

        return {
            "old_temperature": old_temp,
            "new_temperature": new_temp,
            "old_distance": old_dist,
            "new_distance": new_dist,
            "interaction_count": new_count,
            "mix_ratio": mix_ratio,
        }

    def _upsert_relationship_uma(
        self, user_id: int, personal_id: int, actor_id: int,
        base_temperature: float, base_distance: float,
        interaction_count: int, updated_at: str,
    ):
        """SQLiteのNULL UNIQUE問題を回避するupsert。"""
        if actor_id is None:
            existing = self.conn.execute(
                "SELECT rowid FROM relationship_uma WHERE user_id = ? AND personal_id = ? AND actor_id IS NULL",
                (user_id, personal_id),
            ).fetchone()
        else:
            existing = self.conn.execute(
                "SELECT rowid FROM relationship_uma WHERE user_id = ? AND personal_id = ? AND actor_id = ?",
                (user_id, personal_id, actor_id),
            ).fetchone()

        if existing:
            self.conn.execute("""
                UPDATE relationship_uma
                SET base_temperature = ?, base_distance = ?, interaction_count = ?, updated_at = ?
                WHERE rowid = ?
            """, (base_temperature, base_distance, interaction_count, updated_at, existing["rowid"]))
        else:
            self.conn.execute("""
                INSERT INTO relationship_uma (user_id, personal_id, actor_id, base_temperature, base_distance, interaction_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (user_id, personal_id, actor_id, base_temperature, base_distance, interaction_count, updated_at))
        self.conn.commit()

    def set_relationship_uma_direct(
        self,
        user_id: int,
        personal_id: int,
        actor_id: int = None,
        base_temperature: float = None,
        base_distance: float = None,
    ) -> dict:
        """人格のtool_useやAPIから直接設定する用。"""
        import datetime
        current = self.get_relationship_uma(user_id, personal_id, actor_id)
        new_temp = base_temperature if base_temperature is not None else current["base_temperature"]
        new_dist = base_distance if base_distance is not None else current["base_distance"]
        now = datetime.datetime.now().isoformat()

        self._upsert_relationship_uma(user_id, personal_id, actor_id, new_temp, new_dist, current["interaction_count"], now)

        return {
            "base_temperature": new_temp,
            "base_distance": new_dist,
            "interaction_count": current["interaction_count"],
        }

    # ========== 設定 ==========

    def get_setting(self, key: str, default: str = "") -> str:
        row = self.conn.execute(
            "SELECT value FROM setting WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else default

    def set_setting(self, key: str, value: str):
        self.conn.execute(
            "INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)",
            (key, value),
        )
        self.conn.commit()

    # ========== エンジン解決（4層カスケード） ==========

    def resolve_engine(self, user_id: int, personal_id: int, actor_id: int | None,
                       system_default_engine: str = "claude",
                       system_default_model: str = "") -> tuple[str, str]:
        """エンジンとモデルを4層カスケードで解決する。
        優先順位: アクター → パーソナル → ユーザー → システム（下層が上書き）
        Returns: (engine_id, model)  engine_id = "claude" | "openai"
        """
        engine_id = (
            (self.get_setting(f"engine:actor:{actor_id}", "") if actor_id else "") or
            self.get_setting(f"engine:personal:{personal_id}", "") or
            self.get_setting(f"engine:user:{user_id}", "") or
            system_default_engine
        )
        model = (
            (self.get_setting(f"engine_model:actor:{actor_id}", "") if actor_id else "") or
            self.get_setting(f"engine_model:personal:{personal_id}", "") or
            self.get_setting(f"engine_model:user:{user_id}", "") or
            system_default_model
        )
        return engine_id, model

    # ========== スレッド状態（固定化） ==========

    def close_thread(self, chat_thread_id: str, summary_500: str = "", summary_2000: str = ""):
        now = datetime.now().isoformat()
        self.set_setting(f"thread_closed:{chat_thread_id}", now)
        if summary_500:
            self.set_setting(f"thread_summary_500:{chat_thread_id}", summary_500)
        if summary_2000:
            self.set_setting(f"thread_summary_2000:{chat_thread_id}", summary_2000)

    def reopen_thread(self, chat_thread_id: str):
        self.conn.execute("DELETE FROM setting WHERE key=?", (f"thread_closed:{chat_thread_id}",))
        self.conn.commit()

    def is_thread_closed(self, chat_thread_id: str) -> bool:
        return bool(self.get_setting(f"thread_closed:{chat_thread_id}", ""))

    def get_thread_summaries(self, chat_thread_id: str) -> dict:
        return {
            "summary_500":  self.get_setting(f"thread_summary_500:{chat_thread_id}", ""),
            "summary_2000": self.get_setting(f"thread_summary_2000:{chat_thread_id}", ""),
            "closed_at":    self.get_setting(f"thread_closed:{chat_thread_id}", ""),
        }

    # ========== ユーザー ==========

    def get_user(self, user_id: int) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM user WHERE user_id = ?", (user_id,)
        ).fetchone()
        return dict(row) if row else None

    def get_all_user(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM user ORDER BY user_id"
        ).fetchall()
        return [dict(r) for r in rows]

    def create_user(self, nickname: str) -> int:
        cursor = self.conn.execute(
            "INSERT INTO user (nickname) VALUES (?)", (nickname,)
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_default_user_id(self) -> int:
        """デフォルトuser_idを返す（常に1）"""
        return 1

    def get_dev_flag(self, user_id: int) -> int:
        """ユーザーのdev_flagを返す（0=一般, 1=開発者）"""
        row = self.conn.execute(
            "SELECT dev_flag FROM user WHERE user_id = ?", (user_id,)
        ).fetchone()
        return row["dev_flag"] if row else 0

    def set_dev_flag(self, user_id: int, flag: int):
        """ユーザーのdev_flagを設定"""
        self.conn.execute(
            "UPDATE user SET dev_flag = ? WHERE user_id = ?", (flag, user_id)
        )
        self.conn.commit()

    # ========== 人格実体 ==========

    def create_personal(
        self,
        name: str,
        pronoun: str = "わたし",
        gender: str = "",
        age: str = "",
        appearance: str = "",
        is_unnamed: bool = False,
        naming_reason: str = "",
        profile_data: str = None,
    ) -> int:
        """人格実体を作成し、personal_idを返す"""
        cursor = self.conn.execute(
            "INSERT INTO personal (name, pronoun, gender, age, appearance, is_unnamed, naming_reason, profile_data) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (name, pronoun, gender, age, appearance, 1 if is_unnamed else 0, naming_reason, profile_data),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_personal_info(self, personal_id: int) -> dict | None:
        """人格実体の基本情報を取得"""
        row = self.conn.execute(
            "SELECT * FROM personal WHERE personal_id = ?", (personal_id,)
        ).fetchone()
        return dict(row) if row else None

    def get_all_personal(self) -> list[dict]:
        """全人格実体の一覧"""
        rows = self.conn.execute(
            "SELECT * FROM personal ORDER BY personal_id"
        ).fetchall()
        return [dict(r) for r in rows]

    def has_any_personal(self) -> bool:
        """人格実体が1つでもあるか"""
        row = self.conn.execute("SELECT COUNT(*) as cnt FROM personal").fetchone()
        return row["cnt"] > 0

    def get_default_personal_id(self) -> int | None:
        """デフォルト（最初の）personal_idを返す"""
        row = self.conn.execute(
            "SELECT personal_id FROM personal ORDER BY personal_id LIMIT 1"
        ).fetchone()
        return row["personal_id"] if row else None

    # ========== アクター ==========

    def create_actor(
        self,
        personal_id: int,
        name: str,
        pronoun: str = "わたし",
        gender: str = "",
        age: str = "",
        appearance: str = "",
        is_unnamed: bool = False,
        naming_reason: str = "",
        immersion: float = 0.7,
        profile_data: str = None,
        is_ov: bool = False,
        base_lang: str = None,
        role_name: str = None,
        show_role_label: bool = False,
    ) -> int:
        """アクターを作成し、actor_idを返す。profile_dataはJSON文字列"""
        import uuid
        actor_key = uuid.uuid4().hex[:8]
        cursor = self.conn.execute(
            "INSERT INTO actor (personal_id, name, pronoun, gender, age, appearance, is_unnamed, naming_reason, immersion, profile_data, is_ov, actor_key, base_lang, role_name, show_role_label) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (personal_id, name, pronoun, gender, age, appearance, 1 if is_unnamed else 0, naming_reason, immersion, profile_data, 1 if is_ov else 0, actor_key, base_lang, role_name, 1 if show_role_label else 0),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_actor_by_key(self, actor_key: str) -> dict | None:
        """actor_keyからアクター情報を取得"""
        row = self.conn.execute(
            "SELECT * FROM actor WHERE actor_key = ?", (actor_key,)
        ).fetchone()
        return dict(row) if row else None

    def update_actor(self, actor_id: int, **kwargs) -> bool:
        """アクターの任意カラムを更新。許可カラム: name, pronoun, gender, age, appearance, naming_reason"""
        allowed = {"name", "pronoun", "gender", "age", "appearance", "naming_reason", "base_lang", "role_name"}
        updates = {k: v for k, v in kwargs.items() if k in allowed and (v is not None or k == "base_lang")}
        if not updates:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [actor_id]
        self.conn.execute(f"UPDATE actor SET {set_clause} WHERE actor_id = ?", values)
        self.conn.commit()
        return True

    def update_actor_immersion(self, actor_id: int, immersion: float):
        """アクターの没入度を更新"""
        immersion = max(0.0, min(1.0, immersion))
        self.conn.execute(
            "UPDATE actor SET immersion = ? WHERE actor_id = ?",
            (immersion, actor_id),
        )
        self.conn.commit()

    def update_actor_profile(self, actor_id: int, profile_data: str):
        """アクターの profile_data を更新"""
        self.conn.execute(
            "UPDATE actor SET profile_data = ? WHERE actor_id = ?",
            (profile_data, actor_id),
        )
        self.conn.commit()

    def get_actor_info(self, actor_id: int) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM actor WHERE actor_id = ?", (actor_id,)
        ).fetchone()
        return dict(row) if row else None

    def get_actor_by_personal(self, personal_id: int, include_ov: bool = False) -> list[dict]:
        if include_ov:
            rows = self.conn.execute(
                "SELECT * FROM actor WHERE personal_id = ? ORDER BY actor_id",
                (personal_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM actor WHERE personal_id = ? AND (is_ov = 0 OR is_ov IS NULL) ORDER BY actor_id",
                (personal_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_ov_actor(self, personal_id: int) -> list[dict]:
        """オーバーレイActorの一覧を返す（personal_id=0の共有OVも含む）"""
        rows = self.conn.execute(
            "SELECT * FROM actor WHERE personal_id IN (0, ?) AND is_ov = 1 ORDER BY actor_id",
            (personal_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_all_actor(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM actor ORDER BY actor_id"
        ).fetchall()
        return [dict(r) for r in rows]

    def get_default_actor_id(self, personal_id: int) -> int | None:
        row = self.conn.execute(
            "SELECT actor_id FROM actor WHERE personal_id = ? ORDER BY actor_id LIMIT 1",
            (personal_id,),
        ).fetchone()
        return row["actor_id"] if row else None

    def get_chat_thread_actor_id(self, chat_thread_id: str) -> int | None:
        """スレッドのactor_idを取得（chatテーブル優先、フォールバックにchat_leaf最新）"""
        row = self.conn.execute(
            "SELECT actor_id FROM chat WHERE id = ?",
            (chat_thread_id,),
        ).fetchone()
        if row:
            return row["actor_id"]
        # フォールバック: chat_leaf の最新メッセージ（ORDER BY修正）
        row = self.conn.execute(
            "SELECT actor_id FROM chat_leaf WHERE chat_thread_id = ? ORDER BY id DESC LIMIT 1",
            (chat_thread_id,),
        ).fetchone()
        return row["actor_id"] if row else None

    # ========== 会話履歴 ==========

    def save_message(self, user_id: int, personal_id: int, actor_id: int, chat_thread_id: str, role: str, content: str, is_system_context: bool = False, attachment: str = None, model: str = None, is_blind: bool = False, weight: int = None, weight_reason: str = None) -> int:
        from epl.tagger import detect_tags
        tags = detect_tags(content)
        cur = self.conn.execute(
            "INSERT INTO chat_leaf (user_id, personal_id, actor_id, chat_thread_id, role, content, tags, is_system_context, attachment, model, is_blind, weight, weight_reason) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, personal_id, actor_id, chat_thread_id, role, content, json.dumps(tags, ensure_ascii=False), 1 if is_system_context else 0, attachment, model, 1 if is_blind else 0, weight, weight_reason),
        )
        self.conn.commit()
        return cur.lastrowid

    def get_chat_thread_leaf(self, personal_id: int, chat_thread_id: str, limit: int = 50,
                               exclude_event: bool = False) -> list[dict]:
        if exclude_event:
            rows = self.conn.execute(
                "SELECT id, role, content, created_at, is_system_context, attachment, model, actor_id, weight FROM chat_leaf "
                "WHERE personal_id = ? AND chat_thread_id = ? AND deleted_at IS NULL AND role != 'system_event' ORDER BY id DESC LIMIT ?",
                (personal_id, chat_thread_id, limit),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT id, role, content, created_at, is_system_context, attachment, model, actor_id, weight FROM chat_leaf "
                "WHERE personal_id = ? AND chat_thread_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?",
                (personal_id, chat_thread_id, limit),
            ).fetchall()
        return [dict(r) for r in reversed(rows)]

    def get_chat_thread_leaf_all(self, chat_thread_id: str, limit: int = 50,
                                   exclude_event: bool = False) -> list[dict]:
        """会議モード用: personal_idに関係なくスレッド内の全メッセージを取得"""
        if exclude_event:
            rows = self.conn.execute(
                "SELECT id, role, content, created_at, is_system_context, attachment, model, actor_id, personal_id FROM chat_leaf "
                "WHERE chat_thread_id = ? AND deleted_at IS NULL AND role != 'system_event' ORDER BY id DESC LIMIT ?",
                (chat_thread_id, limit),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT id, role, content, created_at, is_system_context, attachment, model, actor_id, personal_id FROM chat_leaf "
                "WHERE chat_thread_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?",
                (chat_thread_id, limit),
            ).fetchall()
        return [dict(r) for r in reversed(rows)]

    def get_chat_leaf_count(self, chat_thread_id: str) -> int:
        """スレッド内の有効メッセージ件数（is_system_context, system_event除く）"""
        row = self.conn.execute(
            "SELECT COUNT(*) FROM chat_leaf WHERE chat_thread_id = ? AND deleted_at IS NULL AND is_system_context = 0 AND role != 'system_event'",
            (chat_thread_id,),
        ).fetchone()
        return row[0] if row else 0

    def get_today_message_count(self, user_id: int) -> int:
        """当日の全スレッド合計メッセージ数（user発言のみ）"""
        row = self.conn.execute(
            "SELECT COUNT(*) FROM chat_leaf WHERE user_id = ? AND role = 'user' AND deleted_at IS NULL AND DATE(created_at) = DATE('now', 'localtime')",
            (user_id,),
        ).fetchone()
        return row[0] if row else 0

    def delete_messages_from(self, chat_thread_id: str, msg_id: int):
        """msg_id以降のメッセージを物理削除（リトライトリム用）。アーカイブ済みは除外。
        該当範囲に紐づく承認待ちも削除"""
        self.conn.execute(
            "DELETE FROM chat_leaf WHERE chat_thread_id = ? AND id >= ? AND is_archived = 0",
            (chat_thread_id, msg_id),
        )
        # msg_id以降で作られた承認待ちを削除
        rows = self.conn.execute(
            "SELECT key, value FROM setting WHERE key LIKE 'pending_approval:%'"
        ).fetchall()
        for key, value in rows:
            try:
                data = json.loads(value)
                if data.get("chat_thread_id") == chat_thread_id and data.get("source_msg_id", 0) >= msg_id:
                    self.conn.execute("DELETE FROM setting WHERE key = ?", (key,))
            except (json.JSONDecodeError, TypeError):
                pass
        self.conn.commit()

    def archive_thread_leaves(self, chat_thread_id: str, is_meeting: bool = False) -> int:
        """スレッド内の全leafにアーカイブフラグを立て、最新leaf以外のcache_summaryをクリア。
        会議モードの場合は各参加者の最新leafのキャッシュを残す。"""
        # 最新leafのIDを取得（残すべきキャッシュ）
        if is_meeting:
            # 会議: 各actor_idの最新leaf
            keep_rows = self.conn.execute(
                "SELECT MAX(id) as max_id FROM chat_leaf "
                "WHERE chat_thread_id = ? AND deleted_at IS NULL AND is_archived = 0 "
                "AND role = 'assistant' AND cache_summary IS NOT NULL "
                "GROUP BY actor_id",
                (chat_thread_id,),
            ).fetchall()
        else:
            # 通常: 最新1件
            keep_rows = self.conn.execute(
                "SELECT MAX(id) as max_id FROM chat_leaf "
                "WHERE chat_thread_id = ? AND deleted_at IS NULL AND is_archived = 0 "
                "AND cache_summary IS NOT NULL",
                (chat_thread_id,),
            ).fetchall()
        keep_ids = [r[0] for r in keep_rows if r[0] is not None]

        # 残すleaf以外のcache_summaryをクリア
        if keep_ids:
            placeholders = ",".join("?" * len(keep_ids))
            self.conn.execute(
                f"UPDATE chat_leaf SET cache_summary = NULL "
                f"WHERE chat_thread_id = ? AND id NOT IN ({placeholders}) AND is_archived = 0",
                (chat_thread_id, *keep_ids),
            )

        # 全leafにアーカイブフラグ
        cursor = self.conn.execute(
            "UPDATE chat_leaf SET is_archived = 1 "
            "WHERE chat_thread_id = ? AND deleted_at IS NULL AND is_archived = 0",
            (chat_thread_id,),
        )
        self.conn.commit()
        return cursor.rowcount

    def update_leaf_cache_summary(self, leaf_id: int, cache_summary: str):
        """leaf単位のキャッシュ記憶を保存"""
        self.conn.execute(
            "UPDATE chat_leaf SET cache_summary = ? WHERE id = ?",
            (cache_summary, leaf_id),
        )
        self.conn.commit()

    def get_latest_cache_summary(self, chat_thread_id: str, actor_id: int = None) -> str | None:
        """直近の非削除・非アーカイブleafからcache_summaryを取得。
        actor_id指定時はそのactorのleafから取得（会議モード用）。"""
        if actor_id:
            row = self.conn.execute(
                "SELECT cache_summary FROM chat_leaf "
                "WHERE chat_thread_id = ? AND actor_id = ? AND deleted_at IS NULL AND is_archived = 0 "
                "AND cache_summary IS NOT NULL AND cache_summary != '' "
                "ORDER BY id DESC LIMIT 1",
                (chat_thread_id, actor_id),
            ).fetchone()
            if row:
                return row[0]
        # フォールバック: actor_id不問で最新
        row = self.conn.execute(
            "SELECT cache_summary FROM chat_leaf "
            "WHERE chat_thread_id = ? AND deleted_at IS NULL AND is_archived = 0 "
            "AND cache_summary IS NOT NULL AND cache_summary != '' "
            "ORDER BY id DESC LIMIT 1",
            (chat_thread_id,),
        ).fetchone()
        return row[0] if row else None

    def get_recent_chat_thread(self, personal_id: int, limit: int = 10) -> list[str]:
        rows = self.conn.execute(
            "SELECT chat_thread_id, MAX(id) as max_id FROM chat_leaf "
            "WHERE personal_id = ? AND deleted_at IS NULL GROUP BY chat_thread_id ORDER BY max_id DESC LIMIT ?",
            (personal_id, limit),
        ).fetchall()
        return [r["chat_thread_id"] for r in rows]

    def get_other_thread_leaf(self, personal_id: int, current_chat_thread_id: str) -> list[dict]:
        """他スレッドの直近メッセージをスレッド単位で取得（覗き見用）。
        各スレッドの元Actorのimmersionに基づいてvisibility計算するため、
        スレッド情報（actor_id, immersion）も含めて返す。Lv2以上のスレッドのみ。
        戻り値: [{"chat_thread_id", "actor_id", "immersion", "share_level", "leaves": [...]}]
        """
        threads = self.conn.execute(
            "SELECT c.chat_thread_id, c.actor_id, MAX(c.id) as last_id "
            "FROM chat_leaf c "
            "WHERE c.personal_id = ? AND c.chat_thread_id != ? AND c.deleted_at IS NULL "
            "GROUP BY c.chat_thread_id "
            "ORDER BY last_id DESC LIMIT 5",
            (personal_id, current_chat_thread_id),
        ).fetchall()

        result = []
        for t in threads:
            tid = t["chat_thread_id"]
            actor_id = t["actor_id"]
            # 共有レベルチェック
            level = self.get_setting(f"chat_thread_share_level:{tid}", "2")
            if int(level) < 2:
                continue
            # Actor の immersion を取得
            actor_row = self.conn.execute(
                "SELECT immersion FROM actor WHERE actor_id = ?", (actor_id,)
            ).fetchone()
            immersion = actor_row["immersion"] if actor_row else 0.7
            # chat_thread_immersion の上書きチェック
            thread_imm_str = self.get_setting(f"chat_thread_immersion:{tid}", "")
            if thread_imm_str:
                immersion = float(thread_imm_str)
            # 直近メッセージを取得
            rows = self.conn.execute(
                "SELECT role, content, chat_thread_id, created_at FROM chat_leaf "
                "WHERE personal_id = ? AND chat_thread_id = ? ORDER BY id DESC LIMIT 5",
                (personal_id, tid),
            ).fetchall()
            result.append({
                "chat_thread_id": tid,
                "actor_id": actor_id,
                "immersion": immersion,
                "share_level": int(level),
                "leaves": [dict(r) for r in reversed(rows)],
            })
        return result

    def get_all_chat_leaf(self, personal_id: int, limit: int = 200) -> list[dict]:
        """全チャット履歴を取得（保存・エクスポート用）"""
        rows = self.conn.execute(
            "SELECT chat_thread_id, role, content, created_at FROM chat_leaf "
            "WHERE personal_id = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT ?",
            (personal_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_chat_thread_list(self, personal_id: int, limit: int = 50) -> list[dict]:
        """セッション一覧を取得（最初のユーザーメッセージをプレビューとして含む）"""
        rows = self.conn.execute(
            "SELECT c.chat_thread_id, "
            "  MIN(c.id) as first_id, "
            "  MAX(c.id) as last_id, "
            "  MIN(c.created_at) as started_at, "
            "  MAX(c.created_at) as last_at, "
            "  COUNT(*) as message_count, "
            "  (SELECT actor_id FROM chat_leaf WHERE personal_id = c.personal_id AND chat_thread_id = c.chat_thread_id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) as actor_id, "
            "  ch.title as title, "
            "  ch.source_id as source_id "
            "FROM chat_leaf c "
            "LEFT JOIN chat ch ON ch.id = c.chat_thread_id "
            "WHERE c.personal_id = ? AND c.deleted_at IS NULL "
            "GROUP BY c.chat_thread_id "
            "ORDER BY last_id DESC LIMIT ?",
            (personal_id, limit),
        ).fetchall()

        result = []
        for r in rows:
            # 最初のユーザーメッセージをプレビューとして取得
            preview_row = self.conn.execute(
                "SELECT content FROM chat_leaf "
                "WHERE personal_id = ? AND chat_thread_id = ? AND role = 'user' "
                "ORDER BY id ASC LIMIT 1",
                (personal_id, r["chat_thread_id"]),
            ).fetchone()
            preview = ""
            if preview_row:
                preview = preview_row["content"][:40]
                if len(preview_row["content"]) > 40:
                    preview += "…"

            # チャット内の全タグを集計（出現頻度上位3つ）
            tag_rows = self.conn.execute(
                "SELECT tags FROM chat_leaf WHERE personal_id = ? AND chat_thread_id = ? AND tags != '[]'",
                (personal_id, r["chat_thread_id"]),
            ).fetchall()
            tag_count: dict = {}
            for tr in tag_rows:
                try:
                    for t in json.loads(tr["tags"]):
                        tag_count[t] = tag_count.get(t, 0) + 1
                except Exception:
                    pass
            top_tags = sorted(tag_count, key=lambda x: -tag_count[x])[:3]

            # title: chat テーブル優先、なければ setting からフォールバック
            title = r["title"]
            if not title:
                title = self.get_setting(f"chat_thread_title:{r['chat_thread_id']}")

            result.append({
                "chat_thread_id": r["chat_thread_id"],
                "started_at": r["started_at"],
                "last_at": r["last_at"],
                "message_count": r["message_count"],
                "actor_id": r["actor_id"],
                "preview": preview,
                "tags": top_tags,
                "title": title,
                "source_id": r["source_id"],
            })
        return result

    def get_chat_thread_list_by_user(self, user_id: int, limit: int = 50) -> list[dict]:
        """ユーザ所有の全Personalのセッション一覧"""
        rows = self.conn.execute(
            "SELECT c.chat_thread_id, c.personal_id, "
            "  MIN(c.id) as first_id, "
            "  MAX(c.id) as last_id, "
            "  MIN(c.created_at) as started_at, "
            "  MAX(c.created_at) as last_at, "
            "  COUNT(*) as message_count, "
            "  (SELECT actor_id FROM chat_leaf WHERE user_id = c.user_id AND chat_thread_id = c.chat_thread_id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) as actor_id, "
            "  ch.title as title, "
            "  ch.source_id as source_id, "
            "  COALESCE(ch.is_birth, 0) as is_birth "
            "FROM chat_leaf c "
            "LEFT JOIN chat ch ON ch.id = c.chat_thread_id "
            "WHERE c.user_id = ? AND c.deleted_at IS NULL "
            "GROUP BY c.chat_thread_id "
            "ORDER BY last_id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()

        result = []
        for r in rows:
            preview_row = self.conn.execute(
                "SELECT content FROM chat_leaf "
                "WHERE user_id = ? AND chat_thread_id = ? AND role = 'user' "
                "ORDER BY id ASC LIMIT 1",
                (user_id, r["chat_thread_id"]),
            ).fetchone()
            preview = ""
            if preview_row:
                preview = preview_row["content"][:40]
                if len(preview_row["content"]) > 40:
                    preview += "…"

            tag_rows = self.conn.execute(
                "SELECT tags FROM chat_leaf WHERE user_id = ? AND chat_thread_id = ? AND tags != '[]'",
                (user_id, r["chat_thread_id"]),
            ).fetchall()
            tag_count: dict = {}
            for tr in tag_rows:
                try:
                    for t in json.loads(tr["tags"]):
                        tag_count[t] = tag_count.get(t, 0) + 1
                except Exception:
                    pass
            top_tags = sorted(tag_count, key=lambda x: -tag_count[x])[:3]

            title = r["title"]
            if not title:
                title = self.get_setting(f"chat_thread_title:{r['chat_thread_id']}")

            # thread別エンジン設定（サイドバーのバッジ色で使う）
            _thread_engine = self.get_setting(f"engine:thread:{r['chat_thread_id']}", "")
            result.append({
                "chat_thread_id": r["chat_thread_id"],
                "personal_id": r["personal_id"],
                "started_at": r["started_at"],
                "last_at": r["last_at"],
                "message_count": r["message_count"],
                "actor_id": r["actor_id"],
                "preview": preview,
                "tags": top_tags,
                "title": title,
                "source_id": r["source_id"],
                "is_birth": bool(r["is_birth"]),
                "thread_engine": _thread_engine,
            })
        return result

    # ========== chat テーブル（スレッド状態管理） ==========

    def get_chat(self, chat_thread_id: str) -> dict | None:
        """chatテーブルからスレッドの現在状態を取得"""
        row = self.conn.execute(
            "SELECT id, personal_id, actor_id, ov_id, title, source_id FROM chat WHERE id = ?",
            (chat_thread_id,),
        ).fetchone()
        return dict(row) if row else None

    def ensure_chat(self, chat_thread_id: str, personal_id: int, actor_id: int,
                    ov_id: int | None = None, source_id: str | None = None,
                    is_birth: bool = False) -> None:
        """スレッドをchatテーブルに登録（既存なら無視）"""
        self.conn.execute(
            "INSERT OR IGNORE INTO chat (id, personal_id, actor_id, ov_id, source_id, is_birth) VALUES (?, ?, ?, ?, ?, ?)",
            (chat_thread_id, personal_id, actor_id, ov_id, source_id, 1 if is_birth else 0),
        )
        self.conn.commit()

    def is_birth_thread(self, chat_thread_id: str) -> bool:
        """誕生スレッドかどうかを判定"""
        row = self.conn.execute(
            "SELECT is_birth FROM chat WHERE id = ?", (chat_thread_id,)
        ).fetchone()
        return bool(row and row[0])

    def update_chat_actor(self, chat_thread_id: str, actor_id: int) -> None:
        """スレッドのactor_idを更新"""
        self.conn.execute(
            "UPDATE chat SET actor_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (actor_id, chat_thread_id),
        )
        self.conn.commit()

    def update_chat_ov(self, chat_thread_id: str, ov_id: int | None) -> None:
        """スレッドのov_idを更新（Noneでクリア）"""
        self.conn.execute(
            "UPDATE chat SET ov_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (ov_id, chat_thread_id),
        )
        self.conn.commit()

    def update_chat_title(self, chat_thread_id: str, title: str) -> None:
        """スレッドタイトルをchatテーブルとsetting両方に保存"""
        self.conn.execute(
            "UPDATE chat SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (title, chat_thread_id),
        )
        self.set_setting(f"chat_thread_title:{chat_thread_id}", title)
        self.conn.commit()

    def update_chat_thread_tags(self, personal_id: int, chat_thread_id: str, tags: list):
        """チャットスレッドの全メッセージにタグを付与"""
        self.conn.execute(
            "UPDATE chat_leaf SET tags = ? WHERE personal_id = ? AND chat_thread_id = ?",
            (json.dumps(tags, ensure_ascii=False), personal_id, chat_thread_id),
        )
        self.conn.commit()

    def delete_chat_thread(self, personal_id: int, chat_thread_id: str):
        """チャットスレッドをソフトデリート（論理削除）"""
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.conn.execute(
            "UPDATE chat_leaf SET deleted_at = ? WHERE personal_id = ? AND chat_thread_id = ?",
            (now, personal_id, chat_thread_id),
        )
        self.conn.commit()

    def restore_chat_thread(self, personal_id: int, chat_thread_id: str):
        """ソフトデリートされたチャットスレッドを復元"""
        self.conn.execute(
            "UPDATE chat_leaf SET deleted_at = NULL WHERE personal_id = ? AND chat_thread_id = ?",
            (personal_id, chat_thread_id),
        )
        self.conn.commit()

    def get_thread_status(self, chat_thread_id: str) -> str:
        """スレッドの状態を返す: 'active' | 'deleted' | 'purged'"""
        # purged_thread設定が残っていれば完全削除済み
        row = self.conn.execute(
            "SELECT value FROM setting WHERE key = ?",
            (f"purged_thread:{chat_thread_id}",),
        ).fetchone()
        if row:
            return "purged"
        # chat_leafに削除済みレコードが存在すればゴミ箱
        row = self.conn.execute(
            "SELECT id FROM chat_leaf WHERE chat_thread_id = ? AND deleted_at IS NOT NULL LIMIT 1",
            (chat_thread_id,),
        ).fetchone()
        if row:
            return "deleted"
        return "active"

    def purge_chat_thread(self, personal_id: int, chat_thread_id: str):
        """チャットスレッドを完全削除（物理削除）"""
        from datetime import datetime, timezone
        # purged記録を残す（IDで「完全削除済み」と判別できるように）
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.conn.execute(
            "INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)",
            (f"purged_thread:{chat_thread_id}", now),
        )
        self.conn.execute(
            "DELETE FROM chat_leaf WHERE personal_id = ? AND chat_thread_id = ?",
            (personal_id, chat_thread_id),
        )
        self.conn.execute(
            "DELETE FROM short_term_memory WHERE personal_id = ? AND chat_thread_id = ?",
            (personal_id, chat_thread_id),
        )
        self.conn.execute(
            "DELETE FROM setting WHERE key LIKE ? AND key != ?",
            (f"%:{chat_thread_id}%", f"purged_thread:{chat_thread_id}"),
        )
        self.conn.commit()

    def get_deleted_chat_threads(self, personal_id: int, limit: int = 50) -> list[dict]:
        """ソフトデリート済みスレッド一覧を返す（削除日時の新しい順）"""
        rows = self.conn.execute(
            """
            SELECT chat_thread_id, MIN(deleted_at) as deleted_at, COUNT(*) as msg_count
            FROM chat_leaf
            WHERE personal_id = ? AND deleted_at IS NOT NULL
            GROUP BY chat_thread_id
            ORDER BY deleted_at DESC
            LIMIT ?
            """,
            (personal_id, limit),
        ).fetchall()
        result = []
        for r in rows:
            tid = r["chat_thread_id"]
            title = self.get_setting(f"chat_thread_title:{tid}", "")
            result.append({
                "chat_thread_id": tid,
                "deleted_at": r["deleted_at"],
                "msg_count": r["msg_count"],
                "title": title,
            })
        return result

    def purge_expired_deleted_threads(self, days: int = 15) -> int:
        """ソフトデリートから指定日数経過したスレッドを完全削除。削除件数を返す。"""
        from datetime import datetime, timezone, timedelta
        threshold = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        # 期限切れのchat_thread_idを収集
        rows = self.conn.execute(
            "SELECT DISTINCT chat_thread_id FROM chat_leaf WHERE deleted_at IS NOT NULL AND deleted_at < ?",
            (threshold,),
        ).fetchall()
        count = len(rows)
        for r in rows:
            tid = r["chat_thread_id"]
            self.conn.execute("DELETE FROM chat_leaf WHERE chat_thread_id = ?", (tid,))
            self.conn.execute("DELETE FROM short_term_memory WHERE chat_thread_id = ?", (tid,))
            self.conn.execute("DELETE FROM setting WHERE key LIKE ?", (f"%:{tid}%",))
        self.conn.commit()
        if count > 0:
            print(f"[PURGE] ソフトデリートから{days}日超のスレッド {count}件を完全削除")
        return count

    # ========== 短期記憶 ==========

    def save_short_term(self, personal_id: int, chat_thread_id: str, summary: str, actor_id: int = None):
        self.conn.execute(
            "INSERT INTO short_term_memory (personal_id, actor_id, chat_thread_id, summary) "
            "VALUES (?, ?, ?, ?)",
            (personal_id, actor_id, chat_thread_id, summary),
        )
        self.conn.commit()

    def get_recent_short_term(self, personal_id: int, actor_id: int = None, limit: int = 5) -> list[dict]:
        rows = self.conn.execute(
            "SELECT chat_thread_id, summary, actor_id, created_at FROM short_term_memory "
            "WHERE personal_id = ? AND (actor_id IS NULL OR actor_id = ?) ORDER BY id DESC LIMIT ?",
            (personal_id, actor_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def search_short_term(self, personal_id: int, keywords: list[str], actor_id: int = None, limit: int = 2) -> list[dict]:
        """キーワードでsummaryを検索して関連short_termを返す（複数キーワードのOR検索、スコア順）"""
        if not keywords:
            return []
        # 各キーワードにヒットした件数をスコアとして集計
        scored = {}
        for kw in keywords[:8]:
            like = f"%{kw}%"
            if actor_id is not None:
                rows = self.conn.execute(
                    "SELECT id, chat_thread_id, summary, actor_id, created_at FROM short_term_memory "
                    "WHERE personal_id=? AND (actor_id IS NULL OR actor_id=?) AND summary LIKE ? ORDER BY id DESC",
                    (personal_id, actor_id, like),
                ).fetchall()
            else:
                rows = self.conn.execute(
                    "SELECT id, chat_thread_id, summary, actor_id, created_at FROM short_term_memory "
                    "WHERE personal_id=? AND summary LIKE ? ORDER BY id DESC",
                    (personal_id, like),
                ).fetchall()
            for r in rows:
                rid = r["id"]
                if rid not in scored:
                    scored[rid] = {"row": dict(r), "score": 0}
                scored[rid]["score"] += 1
        if not scored:
            return []
        # スコア降順 → 同スコアは新しい順
        sorted_items = sorted(scored.values(), key=lambda x: (-x["score"], -x["row"]["id"] if x["row"].get("id") else 0))
        return [item["row"] for item in sorted_items[:limit]]

    # ========== 長期記憶 ==========

    def save_long_term(
        self,
        ltm_id: str,
        personal_id: int,
        content: str,
        abstract: str = "",
        category: str = "",
        weight: int = 1,
        novelty: int = 1,
        tags: list = None,
        source: str = "owner",
        actor_id: int = None,
        meeting_only_thread: str = None,
    ):
        now = datetime.utcnow().isoformat()
        self.conn.execute(
            "INSERT OR REPLACE INTO long_term_memory "
            "(id, personal_id, actor_id, category, content, abstract, weight, novelty, tags, source, created_at, updated_at, meeting_only_thread) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (ltm_id, personal_id, actor_id, category, content, abstract, weight, novelty,
             json.dumps(tags or [], ensure_ascii=False), source, now, now, meeting_only_thread),
        )
        self.conn.commit()

    def search_long_term(self, personal_id: int, keywords: list[str], actor_id: int = None, limit: int = 10, chat_thread_id: str = None) -> list[dict]:
        conditions = []
        params = [personal_id, actor_id]
        for kw in keywords:
            conditions.append("(content LIKE ? OR abstract LIKE ? OR tags LIKE ?)")
            like = f"%{kw}%"
            params.extend([like, like, like])

        kw_where = " OR ".join(conditions) if conditions else "1=1"
        # meeting_only_thread が設定されたレコードは、同一スレッドからのみ参照可能
        if chat_thread_id:
            _mot_filter = "AND (meeting_only_thread IS NULL OR meeting_only_thread = ?)"
            _extra_params = [chat_thread_id]
        else:
            _mot_filter = "AND meeting_only_thread IS NULL"
            _extra_params = []
        rows = self.conn.execute(
            f"SELECT * FROM long_term_memory WHERE personal_id = ? "
            f"AND (actor_id IS NULL OR actor_id = ?) AND ({kw_where}) "
            f"{_mot_filter} "
            "ORDER BY (weight * novelty) DESC LIMIT ?",
            params + _extra_params + [limit],
        ).fetchall()
        return [dict(r) for r in rows]

    def get_entity_long_term(self, personal_id: int, limit: int = 30) -> list[dict]:
        """人名・固有名詞記憶（category='entity'）を常時ロード用に取得"""
        rows = self.conn.execute(
            "SELECT * FROM long_term_memory WHERE personal_id = ? AND category = 'entity' "
            "AND meeting_only_thread IS NULL "
            "ORDER BY weight DESC, updated_at DESC LIMIT ?",
            (personal_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_top_long_term(self, personal_id: int, actor_id: int = None, limit: int = 10, chat_thread_id: str = None) -> list[dict]:
        if chat_thread_id:
            _mot_filter = "AND (meeting_only_thread IS NULL OR meeting_only_thread = ?)"
            _extra = (chat_thread_id,)
        else:
            _mot_filter = "AND meeting_only_thread IS NULL"
            _extra = ()
        rows = self.conn.execute(
            f"SELECT * FROM long_term_memory WHERE personal_id = ? "
            f"AND (actor_id IS NULL OR actor_id = ?) "
            f"{_mot_filter} "
            "ORDER BY (weight * novelty) DESC LIMIT ?",
            (personal_id, actor_id) + _extra + (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_meeting_memory(self, personal_id: int, actor_id: int = None, limit: int = 5, chat_thread_id: str = None) -> list[dict]:
        """会議記憶（category='meeting'）を最新順に取得"""
        if chat_thread_id:
            _mot_filter = "AND (meeting_only_thread IS NULL OR meeting_only_thread = ?)"
            _extra = (chat_thread_id,)
        else:
            _mot_filter = "AND meeting_only_thread IS NULL"
            _extra = ()
        rows = self.conn.execute(
            f"SELECT * FROM long_term_memory WHERE personal_id = ? "
            f"AND (actor_id IS NULL OR actor_id = ?) AND category = 'meeting' "
            f"{_mot_filter} "
            "ORDER BY created_at DESC LIMIT ?",
            (personal_id, actor_id) + _extra + (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ========== 経験レイヤー ==========

    def save_experience(
        self,
        exp_id: str,
        personal_id: int,
        content: str,
        abstract: str = "",
        category: str = "",
        weight: int = 1,
        novelty: int = 1,
        tags: list = None,
        source: str = "owner",
        origin_ref: str = None,
        importance_hint: str = "normal",
        actor_id: int = None,
    ):
        now = datetime.utcnow().isoformat()
        self.conn.execute(
            "INSERT INTO experience "
            "(id, personal_id, actor_id, category, content, abstract, weight, novelty, tags, source, "
            "origin_ref, importance_hint, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (exp_id, personal_id, actor_id, category, content, abstract, weight, novelty,
             json.dumps(tags or [], ensure_ascii=False), source,
             origin_ref, importance_hint, now, now),
        )
        self.conn.commit()

    def get_all_experience(self, personal_id: int, actor_id: int = None, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM experience WHERE personal_id = ? "
            "AND (actor_id IS NULL OR actor_id = ?) "
            "ORDER BY (weight * novelty) DESC LIMIT ?",
            (personal_id, actor_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def search_experience(self, personal_id: int, keywords: list[str], actor_id: int = None, limit: int = 10) -> list[dict]:
        conditions = []
        params = [personal_id, actor_id]
        for kw in keywords:
            conditions.append("(content LIKE ? OR abstract LIKE ? OR tags LIKE ?)")
            like = f"%{kw}%"
            params.extend([like, like, like])

        kw_where = " OR ".join(conditions) if conditions else "1=1"
        rows = self.conn.execute(
            f"SELECT * FROM experience WHERE personal_id = ? "
            f"AND (actor_id IS NULL OR actor_id = ?) AND ({kw_where}) "
            "ORDER BY (weight * novelty) DESC LIMIT ?",
            params + [limit],
        ).fetchall()
        return [dict(r) for r in rows]

    def search_chat_leaf(self, personal_id: int, query: str, limit: int = 5, actor_id: int = None) -> list[dict]:
        """chat_leaf を全文検索し、ヒットしたメッセージとその前後1件を返す。
        share_level=1 のスレッドは thread の actor_id が一致する場合のみ対象。
        share_level=2（デフォルト）は全 actor からアクセス可。
        """
        # アクセス可能なスレッドIDを先に絞り込む
        chat_rows = self.conn.execute(
            "SELECT id, actor_id FROM chat WHERE personal_id = ?", (personal_id,)
        ).fetchall()
        accessible = []
        for row in chat_rows:
            thread_id, thread_actor = row[0], row[1]
            try:
                sl = int(self.get_setting(f"chat_thread_share_level:{thread_id}", "2"))
            except Exception:
                sl = 2
            # share_level=1: そのスレッドのactor_idと一致する場合のみ
            if sl == 1 and actor_id is not None and thread_actor != actor_id:
                continue
            accessible.append(thread_id)

        if not accessible:
            return []

        like = f"%{query}%"
        placeholders = ",".join("?" * len(accessible))
        rows = self.conn.execute(
            f"""SELECT id as row_id, chat_thread_id, role, actor_id,
                       content, created_at, weight, weight_reason
                FROM chat_leaf
                WHERE personal_id = ? AND content LIKE ? AND is_system_context = 0
                  AND chat_thread_id IN ({placeholders})
                ORDER BY created_at DESC LIMIT ?""",
            [personal_id, like] + accessible + [limit],
        ).fetchall()

        # 現在のスレッドの最新メッセージIDを取得（何件前か計算用）
        # current_thread_id は呼び出し側から渡す想定だが、ここでは accessible の先頭スレッドを現在スレと扱わない
        # → current_thread_id パラメータで渡す
        results = []
        for row in rows:
            r = dict(row)
            ctx = self.conn.execute(
                """SELECT role, substr(content, 1, 100) as content, created_at
                   FROM chat_leaf
                   WHERE chat_thread_id = ? AND id BETWEEN ? AND ?
                     AND is_system_context = 0
                   ORDER BY id ASC""",
                (r["chat_thread_id"], r["row_id"] - 1, r["row_id"] + 1),
            ).fetchall()
            r["context"] = [dict(c) for c in ctx]
            r["content_preview"] = r["content"][:200]
            del r["content"]
            results.append(r)
        return results

    def search_chat_leaf_with_position(self, personal_id: int, query: str,
                                       current_thread_id: str,
                                       current_latest_id: int,
                                       limit: int = 5, actor_id: int = None) -> list[dict]:
        """search_chat_leaf に加え、ヒットした会話が現在スレの何件前かを付与する。"""
        results = self.search_chat_leaf(personal_id, query, limit=limit, actor_id=actor_id)
        for r in results:
            is_same = r["chat_thread_id"] == current_thread_id
            r["is_same_thread"] = is_same
            if is_same:
                gap = current_latest_id - r["row_id"]
                r["messages_ago"] = max(0, gap)
            else:
                r["messages_ago"] = None
        return results

    def get_chat_leaf_context(self, personal_id: int, leaf_id: int, context_size: int = 5) -> dict:
        """指定leaf_idの前後context_size件を返す（映像想起ツール用）"""
        # ターゲット取得
        target = self.conn.execute(
            "SELECT id, chat_thread_id, role, actor_id, content, created_at, weight, weight_reason "
            "FROM chat_leaf WHERE id = ? AND personal_id = ? AND is_system_context = 0",
            (leaf_id, personal_id)
        ).fetchone()
        if not target:
            return {}
        t = dict(target)
        thread_id = t["chat_thread_id"]

        # 前のN件
        before_rows = self.conn.execute(
            "SELECT id, role, actor_id, substr(content,1,300) as content, created_at "
            "FROM chat_leaf "
            "WHERE chat_thread_id = ? AND id < ? AND is_system_context = 0 "
            "ORDER BY id DESC LIMIT ?",
            (thread_id, leaf_id, context_size)
        ).fetchall()

        # 後のN件
        after_rows = self.conn.execute(
            "SELECT id, role, actor_id, substr(content,1,300) as content, created_at "
            "FROM chat_leaf "
            "WHERE chat_thread_id = ? AND id > ? AND is_system_context = 0 "
            "ORDER BY id ASC LIMIT ?",
            (thread_id, leaf_id, context_size)
        ).fetchall()

        return {
            "before": [dict(r) for r in reversed(before_rows)],
            "target": t,
            "after": [dict(r) for r in after_rows],
            "chat_thread_id": thread_id,
        }

    def get_chat_leaf_since(
        self, personal_id: int, keywords: list[str], since_leaf_id: int,
        actor_id: int = None, limit: int = 200,
    ) -> list[dict]:
        """指定leaf_id以降の会話をキーワードで検索して返す（記憶進化判定用）"""
        if not keywords:
            return []
        conditions = " OR ".join("content LIKE ?" for _ in keywords)
        params = [f"%{kw}%" for kw in keywords]
        if actor_id is not None:
            rows = self.conn.execute(
                f"""SELECT id, role, content, chat_thread_id, created_at
                    FROM chat_leaf
                    WHERE personal_id=? AND (actor_id IS NULL OR actor_id=?)
                      AND id > ? AND is_system_context=0
                      AND (weight IS NULL OR weight != 0)
                      AND ({conditions})
                    ORDER BY id ASC LIMIT ?""",
                [personal_id, actor_id, since_leaf_id] + params + [limit],
            ).fetchall()
        else:
            rows = self.conn.execute(
                f"""SELECT id, role, content, chat_thread_id, created_at
                    FROM chat_leaf
                    WHERE personal_id=? AND id > ? AND is_system_context=0
                      AND (weight IS NULL OR weight != 0)
                      AND ({conditions})
                    ORDER BY id ASC LIMIT ?""",
                [personal_id, since_leaf_id] + params + [limit],
            ).fetchall()
        return [dict(r) for r in rows]

    def search_leaf_for_ui(self, personal_id: int, query: str, limit: int = 50, offset: int = 0, mode: str = "or") -> dict:
        """検索UI用: chat_leafを全文検索。user/assistantのみ（system_event除外）。
        mode: "or" = いずれかのキーワードにマッチ, "and" = 全キーワードにマッチ
        Returns: {"results": [...], "total": int, "has_more": bool}
        """
        if not query or not query.strip():
            return {"results": [], "total": 0, "has_more": False}

        # スペースでキーワード分割
        keywords = [kw for kw in query.strip().split() if kw]
        if not keywords:
            return {"results": [], "total": 0, "has_more": False}

        # LIKE条件を構築
        joiner = " AND " if mode == "and" else " OR "
        like_conditions = joiner.join("cl.content LIKE ?" for _ in keywords)
        like_params = [f"%{kw}%" for kw in keywords]
        # COUNT用も同様
        count_conditions = joiner.join("content LIKE ?" for _ in keywords)

        base_where = (
            f"personal_id = ? AND ({count_conditions}) AND is_system_context = 0 "
            "AND deleted_at IS NULL AND role IN ('user', 'assistant')"
        )
        # 総ヒット数
        total_row = self.conn.execute(
            f"SELECT COUNT(*) FROM chat_leaf WHERE {base_where}",
            [personal_id] + like_params,
        ).fetchone()
        total = total_row[0] if total_row else 0

        cl_where = (
            f"cl.personal_id = ? AND ({like_conditions}) AND cl.is_system_context = 0 "
            "AND cl.deleted_at IS NULL AND cl.role IN ('user', 'assistant')"
        )
        # 結果取得（新しい順）
        rows = self.conn.execute(
            f"""SELECT cl.id as leaf_id, cl.chat_thread_id, cl.role, cl.actor_id,
                      substr(cl.content, 1, 300) as content_preview,
                      cl.created_at,
                      c.title as thread_title, c.mode as thread_mode,
                      a.name as actor_name
               FROM chat_leaf cl
               LEFT JOIN chat c ON cl.chat_thread_id = c.id
               LEFT JOIN actor a ON cl.actor_id = a.actor_id
               WHERE {cl_where}
               ORDER BY cl.created_at DESC
               LIMIT ? OFFSET ?""",
            [personal_id] + like_params + [limit, offset],
        ).fetchall()

        results = [dict(r) for r in rows]
        return {"results": results, "total": total, "has_more": (offset + limit) < total}

    # ========== 個性特性 ==========

    def save_personal_trait(
        self,
        trait_id: str,
        personal_id: int,
        trait: str,
        label: str,
        description: str,
        weight: int = 1,
        novelty: int = 1,
        intensity: float = 0.5,
        tags: list = None,
        source: str = "owner",
        update_mode: str = "mixed",
        actor_id: int = None,
        status: str = "active",
    ):
        now = datetime.utcnow().isoformat()
        # SQLite の UNIQUE 制約は NULL 同士を区別できない（NULL != NULL）ため、
        # actor_id IS NULL の重複を手動で防ぐ
        if actor_id is None:
            self.conn.execute(
                "DELETE FROM personal_trait WHERE personal_id = ? AND trait = ? AND actor_id IS NULL",
                (personal_id, trait),
            )
        else:
            self.conn.execute(
                "DELETE FROM personal_trait WHERE personal_id = ? AND trait = ? AND actor_id = ?",
                (personal_id, trait, actor_id),
            )
        self.conn.execute(
            "INSERT INTO personal_trait "
            "(id, personal_id, actor_id, trait, label, description, intensity, weight, novelty, tags, source, "
            "update_mode, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (trait_id, personal_id, actor_id, trait, label, description, intensity, weight, novelty,
             json.dumps(tags or [], ensure_ascii=False), source,
             update_mode, status, now, now),
        )
        self.conn.commit()

    def get_all_personal_trait(self, personal_id: int, actor_id: int = None, include_pending: bool = False) -> list[dict]:
        """個性特性を取得（actor_id=NULLのPersonal共通 + 指定actor_id固有）"""
        if include_pending:
            rows = self.conn.execute(
                "SELECT * FROM personal_trait WHERE personal_id = ? "
                "AND (actor_id IS NULL OR actor_id = ?) ORDER BY weight DESC",
                (personal_id, actor_id),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM personal_trait WHERE personal_id = ? "
                "AND (actor_id IS NULL OR actor_id = ?) AND status = 'active' ORDER BY weight DESC",
                (personal_id, actor_id),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_personal_trait_layered(self, personal_id: int, actor_id: int = None, include_pending: bool = False) -> dict:
        """個性特性をPersonal層/Actor層に分離して取得
        Returns: {"personal": [...], "actor": [...], "pending": [...]}
        """
        status_filter = "" if include_pending else "AND status = 'active'"
        # Personal層（actor_id IS NULL）
        personal_rows = self.conn.execute(
            f"SELECT * FROM personal_trait WHERE personal_id = ? AND actor_id IS NULL {status_filter} ORDER BY weight DESC",
            (personal_id,),
        ).fetchall()
        # Actor層（actor_id = ?）
        actor_rows = []
        if actor_id is not None:
            actor_rows = self.conn.execute(
                f"SELECT * FROM personal_trait WHERE personal_id = ? AND actor_id = ? {status_filter} ORDER BY weight DESC",
                (personal_id, actor_id),
            ).fetchall()
        # pending（include_pending時のみ分離）
        pending_rows = []
        if include_pending:
            pending_rows = [r for r in personal_rows if dict(r).get("status") == "pending"]
            pending_rows += [r for r in actor_rows if dict(r).get("status") == "pending"]
            personal_rows = [r for r in personal_rows if dict(r).get("status") != "pending"]
            actor_rows = [r for r in actor_rows if dict(r).get("status") != "pending"]
        return {
            "personal": [dict(r) for r in personal_rows],
            "actor": [dict(r) for r in actor_rows],
            "pending": [dict(r) for r in pending_rows],
        }

    def get_pending_trait(self, personal_id: int) -> list[dict]:
        """pending状態の個性特性を取得（本体確認用）"""
        rows = self.conn.execute(
            "SELECT * FROM personal_trait WHERE personal_id = ? AND status = 'pending' ORDER BY created_at DESC",
            (personal_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def activate_trait(self, trait_id: str):
        """pendingをactiveに変更"""
        now = datetime.utcnow().isoformat()
        self.conn.execute(
            "UPDATE personal_trait SET status = 'active', updated_at = ? WHERE id = ?",
            (now, trait_id),
        )
        self.conn.commit()

    def reject_pending_trait(self, trait_id: str):
        """pending個性を削除"""
        self.conn.execute("DELETE FROM personal_trait WHERE id = ? AND status = 'pending'", (trait_id,))
        self.conn.commit()

    def get_personal_trait_by_key(self, personal_id: int, trait: str, actor_id: int = None) -> dict | None:
        """trait キーで個性特性を1件取得"""
        if actor_id is not None:
            row = self.conn.execute(
                "SELECT * FROM personal_trait WHERE personal_id = ? AND trait = ? AND actor_id = ?",
                (personal_id, trait, actor_id),
            ).fetchone()
        else:
            row = self.conn.execute(
                "SELECT * FROM personal_trait WHERE personal_id = ? AND trait = ? AND actor_id IS NULL",
                (personal_id, trait),
            ).fetchone()
        return dict(row) if row else None

    def update_personal_trait_mixed(
        self,
        personal_id: int,
        trait: str,
        label: str,
        new_description: str,
        mix_ratio: float,
        new_intensity: float = 0.5,
        source: str = "self",
        reason: str = "",
        actor_id: int = None,
        status: str = "active",
    ) -> dict:
        """
        弱動的ミックス更新（白書準拠）。
        既存traitがあればミックス、なければ新規作成。
        Returns: {"status": "ok"/"rejected_fixed"/"created", "old": ..., "new": ...}
        """
        now = datetime.utcnow().isoformat()
        existing = self.get_personal_trait_by_key(personal_id, trait, actor_id=actor_id)

        if existing:
            # fixed は更新不可
            if existing.get("update_mode") == "fixed":
                return {"status": "rejected_fixed", "trait": trait, "reason": "この個性は固定されており変更できません"}

            # ミックス更新
            old_desc = existing.get("description", "")
            old_intensity = existing.get("intensity", 0.5)
            blended_intensity = old_intensity * (1 - mix_ratio) + new_intensity * mix_ratio

            # history に履歴追加
            history_raw = existing.get("history", "[]")
            try:
                history = json.loads(history_raw) if history_raw else []
            except (json.JSONDecodeError, TypeError):
                history = []
            history.append({
                "old_desc": old_desc,
                "new_desc": new_description,
                "mix_ratio": mix_ratio,
                "reason": reason,
                "source": source,
                "timestamp": now,
            })

            if actor_id is not None:
                self.conn.execute(
                    "UPDATE personal_trait SET description = ?, intensity = ?, "
                    "history = ?, novelty = novelty + 1, updated_at = ? "
                    "WHERE personal_id = ? AND trait = ? AND actor_id = ?",
                    (new_description, blended_intensity,
                     json.dumps(history, ensure_ascii=False), now,
                     personal_id, trait, actor_id),
                )
            else:
                self.conn.execute(
                    "UPDATE personal_trait SET description = ?, intensity = ?, "
                    "history = ?, novelty = novelty + 1, updated_at = ? "
                    "WHERE personal_id = ? AND trait = ? AND actor_id IS NULL",
                    (new_description, blended_intensity,
                     json.dumps(history, ensure_ascii=False), now,
                     personal_id, trait),
                )
            self.conn.commit()
            return {
                "status": "ok",
                "trait": trait,
                "label": label,
                "old_desc": old_desc,
                "new_desc": new_description,
                "old_intensity": old_intensity,
                "new_intensity": blended_intensity,
                "mix_ratio": mix_ratio,
            }
        else:
            # 新規作成
            trait_id = self.get_next_id("pt", personal_id)
            self.save_personal_trait(
                trait_id=trait_id,
                personal_id=personal_id,
                trait=trait,
                label=label,
                description=new_description,
                weight=5,
                novelty=1,
                intensity=new_intensity,
                source=source,
                update_mode="mixed",
                actor_id=actor_id,
                status=status,
            )
            return {
                "status": "created",
                "trait": trait,
                "label": label,
                "old_desc": None,
                "new_desc": new_description,
                "new_intensity": new_intensity,
                "mix_ratio": 1.0,
            }

    def count_non_owner_trait(self, personal_id: int) -> int:
        """オーナー以外が設定した個性特性の数（初回インストール判定用）"""
        row = self.conn.execute(
            "SELECT COUNT(*) as cnt FROM personal_trait WHERE personal_id = ? AND source != 'owner'",
            (personal_id,),
        ).fetchone()
        return row["cnt"] if row else 0

    # ========== 承認管理（settingテーブル利用） ==========

    def save_pending_approval(self, approval_id: str, data: dict):
        """承認待ちデータを保存"""
        self.set_setting(f"pending_approval:{approval_id}", json.dumps(data, ensure_ascii=False))

    def get_pending_approval(self, approval_id: str) -> dict | None:
        """承認待ちデータを取得"""
        raw = self.get_setting(f"pending_approval:{approval_id}", "")
        if not raw:
            return None
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return None

    def get_all_pending_approvals(self) -> list[dict]:
        """未解決の承認待ちデータを全件取得"""
        rows = self.conn.execute(
            "SELECT key, value FROM setting WHERE key LIKE 'pending_approval:%'"
        ).fetchall()
        results = []
        for key, value in rows:
            approval_id = key.replace("pending_approval:", "")
            try:
                data = json.loads(value)
                data["approval_id"] = approval_id
                results.append(data)
            except (json.JSONDecodeError, TypeError):
                pass
        return results

    def resolve_pending_approval(self, approval_id: str):
        """承認待ちデータを削除"""
        self.conn.execute("DELETE FROM setting WHERE key = ?", (f"pending_approval:{approval_id}",))
        self.conn.commit()

    def resolve_pending_approvals_by_trait(self, personal_id: int, trait: str):
        """同じ personal_id + trait の承認待ちを全削除（重複承認クリーンアップ）"""
        rows = self.conn.execute(
            "SELECT key, value FROM setting WHERE key LIKE 'pending_approval:%'"
        ).fetchall()
        for key, value in rows:
            try:
                data = json.loads(value)
                if data.get("personal_id") == personal_id and data.get("trait") == trait:
                    self.conn.execute("DELETE FROM setting WHERE key = ?", (key,))
            except (json.JSONDecodeError, TypeError):
                pass
        self.conn.commit()

    # ========== ユーティリティ ==========

    def get_next_id(self, prefix: str, personal_id: int = None) -> str:
        """次のID（exp_p1_0001形式）を生成。MAXベースで衝突を防止"""
        table_map = {
            "ltm": "long_term_memory",
            "exp": "experience",
            "pt": "personal_trait",
            "mid": "middle_term_memory",
        }
        table = table_map.get(prefix, prefix)
        # 既存IDの最大番号を取得（例: exp_p1_0003 → 3）
        if personal_id is not None:
            pat = f"{prefix}_p{personal_id}_%"
            row = self.conn.execute(
                f"SELECT id FROM {table} WHERE personal_id = ? AND id LIKE ? ORDER BY id DESC LIMIT 1",
                (personal_id, pat),
            ).fetchone()
        else:
            pat = f"{prefix}_%"
            row = self.conn.execute(
                f"SELECT id FROM {table} WHERE id LIKE ? ORDER BY id DESC LIMIT 1",
                (pat,),
            ).fetchone()
        next_num = 1
        if row:
            try:
                # exp_p1_0003 → "0003" → 3 → +1 = 4
                last_part = str(row["id"]).rsplit("_", 1)[-1]
                next_num = int(last_part) + 1
            except (ValueError, IndexError):
                # フォールバック: COUNT+1
                if personal_id is not None:
                    cnt = self.conn.execute(
                        f"SELECT COUNT(*) as cnt FROM {table} WHERE personal_id = ?", (personal_id,)
                    ).fetchone()["cnt"]
                else:
                    cnt = self.conn.execute(f"SELECT COUNT(*) as cnt FROM {table}").fetchone()["cnt"]
                next_num = cnt + 1
        if personal_id is not None:
            return f"{prefix}_p{personal_id}_{next_num:04d}"
        return f"{prefix}_{next_num:04d}"

    # ========== 中期記憶 ==========

    def save_middle_term(self, mid_id: str, personal_id: int, chat_thread_id: str,
                         content: str, abstract: str = "", weight: int = 1,
                         novelty: int = 1, tags: list = None, actor_id: int = None,
                         source_short_ids: list = None):
        now = datetime.utcnow().isoformat()
        self.conn.execute("""
            INSERT OR REPLACE INTO middle_term_memory
            (id, personal_id, actor_id, chat_thread_id, content, abstract, weight, novelty,
             tags, source_short_ids, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """, (mid_id, personal_id, actor_id, chat_thread_id, content, abstract,
              weight, novelty, json.dumps(tags or []), json.dumps(source_short_ids or []),
              now, now))
        self.conn.commit()

    def get_recent_middle_term(self, personal_id: int, actor_id=None, limit: int = 5) -> list[dict]:
        if actor_id is not None:
            rows = self.conn.execute(
                "SELECT * FROM middle_term_memory WHERE personal_id=? AND (actor_id IS NULL OR actor_id=?) ORDER BY created_at DESC LIMIT ?",
                (personal_id, actor_id, limit)
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM middle_term_memory WHERE personal_id=? ORDER BY created_at DESC LIMIT ?",
                (personal_id, limit)
            ).fetchall()
        return [dict(r) for r in rows]

    def get_short_term_by_thread(self, personal_id: int, chat_thread_id: str) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM short_term_memory WHERE personal_id=? AND chat_thread_id=? ORDER BY created_at ASC",
            (personal_id, chat_thread_id)
        ).fetchall()
        return [dict(r) for r in rows]

    def delete_short_term_by_ids(self, ids: list):
        if not ids:
            return
        placeholders = ",".join("?" * len(ids))
        self.conn.execute(f"DELETE FROM short_term_memory WHERE id IN ({placeholders})", ids)
        self.conn.commit()

    # ========== キャッシュ記憶 ==========

    def save_cache(self, cache_id: str, personal_id: int, chat_thread_id: str,
                   content: str, actor_id: int = None):
        now = datetime.utcnow().isoformat()
        self.conn.execute("""
            INSERT OR REPLACE INTO cache_memory
            (id, personal_id, actor_id, chat_thread_id, content, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?)
        """, (cache_id, personal_id, actor_id, chat_thread_id, content, now, now))
        self.conn.commit()

    def get_cache(self, personal_id: int, chat_thread_id: str) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM cache_memory WHERE personal_id=? AND chat_thread_id=?",
            (personal_id, chat_thread_id)
        ).fetchone()
        return dict(row) if row else None

    def update_cache(self, personal_id: int, chat_thread_id: str, content: str, actor_id: int = None):
        now = datetime.utcnow().isoformat()
        existing = self.get_cache(personal_id, chat_thread_id)
        if existing:
            self.conn.execute(
                "UPDATE cache_memory SET content=?, updated_at=? WHERE personal_id=? AND chat_thread_id=?",
                (content, now, personal_id, chat_thread_id)
            )
        else:
            cache_id = f"cache_{chat_thread_id[:8]}_{now[:10].replace('-','')}"
            self.save_cache(cache_id, personal_id, chat_thread_id, content, actor_id=actor_id)
        self.conn.commit()

    # ========== 後回しメモ ==========

    def save_memo(self, personal_id: int, content: str,
                  actor_id: int = None, chat_thread_id: str = None,
                  memo_type: str = "memo") -> int:
        now = datetime.utcnow().isoformat()
        cur = self.conn.execute(
            """INSERT INTO memos (personal_id, actor_id, chat_thread_id, content, memo_type, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)""",
            (personal_id, actor_id, chat_thread_id, content, memo_type, now, now)
        )
        self.conn.commit()
        return cur.lastrowid

    def memo_list(self, personal_id: int, status: str = None) -> list:
        if status:
            rows = self.conn.execute(
                "SELECT * FROM memos WHERE personal_id=? AND status=? ORDER BY created_at DESC",
                (personal_id, status)
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM memos WHERE personal_id=? ORDER BY created_at DESC",
                (personal_id,)
            ).fetchall()
        return [dict(r) for r in rows]

    def update_memo_status(self, memo_id: int, personal_id: int, status: str) -> bool:
        now = datetime.utcnow().isoformat()
        cur = self.conn.execute(
            "UPDATE memos SET status=?, updated_at=? WHERE id=? AND personal_id=?",
            (status, now, memo_id, personal_id)
        )
        self.conn.commit()
        return cur.rowcount > 0

    def update_memo(self, memo_id: int, personal_id: int,
                    content: str = None, memo_type: str = None, status: str = None) -> bool:
        """content / memo_type / status を部分更新する"""
        fields, params = [], []
        if content is not None:
            fields.append("content=?")
            params.append(content)
        if memo_type is not None:
            fields.append("memo_type=?")
            params.append(memo_type)
        if status is not None:
            fields.append("status=?")
            params.append(status)
        if not fields:
            return False
        now = datetime.utcnow().isoformat()
        fields.append("updated_at=?")
        params.extend([now, memo_id, personal_id])
        cur = self.conn.execute(
            f"UPDATE memos SET {', '.join(fields)} WHERE id=? AND personal_id=?",
            params
        )
        self.conn.commit()
        return cur.rowcount > 0

    def delete_memo(self, memo_id: int, personal_id: int) -> bool:
        cur = self.conn.execute(
            "DELETE FROM memos WHERE id=? AND personal_id=?",
            (memo_id, personal_id)
        )
        self.conn.commit()
        return cur.rowcount > 0

    # ========== ナレッジ ==========

    def save_knowledge(self, title: str, content: str, category: str = "guide",
                       is_system: int = 0, personal_id: int = None,
                       knowledge_id: int = None, key: str = None,
                       ktype: str = "knowledge",
                       shortcut: str = None, is_magic: int = 0) -> int:
        """ナレッジを保存。
        - is_system=1: システム（id 1-10000, key=sys_xxx, shortcut=_xxx）
        - is_system=0: ユーザー（id 10001+, key=usr_xxx）
        """
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if knowledge_id is not None and key is not None:
            # 明示的ID+key（システムナレッジ用）: UPSERT
            self.conn.execute(
                "INSERT INTO knowledge (id, key, personal_id, type, title, content, category, is_system, shortcut, is_magic, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET title=?, content=?, category=?, shortcut=?, is_magic=?, updated_at=?",
                (knowledge_id, key, personal_id, ktype, title, content, category, is_system, shortcut, is_magic, now, now,
                 title, content, category, shortcut, is_magic, now)
            )
            self.conn.commit()
            return knowledge_id
        else:
            # ユーザーナレッジ: 10001番以降の自動採番
            row = self.conn.execute("SELECT COALESCE(MAX(id), 10000) FROM knowledge WHERE id >= 10001").fetchone()
            new_id = row[0] + 1
            new_key = key or f"usr_{new_id}"
            self.conn.execute(
                "INSERT INTO knowledge (id, key, personal_id, type, title, content, category, is_system, shortcut, is_magic, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (new_id, new_key, personal_id, ktype, title, content, category, 0, shortcut, is_magic, now, now)
            )
            self.conn.commit()
            return new_id

    def update_knowledge(self, knowledge_id: int, title: str = None, content: str = None,
                         category: str = None, shortcut: str = None, is_magic: int = None) -> bool:
        """ユーザーナレッジを更新（is_system=1 は更新不可）"""
        row = self.conn.execute("SELECT is_system FROM knowledge WHERE id = ?", (knowledge_id,)).fetchone()
        if not row or row[0] == 1:
            return False
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        updates = []
        params = []
        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if content is not None:
            updates.append("content = ?")
            params.append(content)
        if category is not None:
            updates.append("category = ?")
            params.append(category)
        if shortcut is not None:
            updates.append("shortcut = ?")
            params.append(shortcut if shortcut else None)
        if is_magic is not None:
            updates.append("is_magic = ?")
            params.append(int(is_magic))
        if not updates:
            return False
        updates.append("updated_at = ?")
        params.append(now)
        params.append(knowledge_id)
        self.conn.execute(f"UPDATE knowledge SET {', '.join(updates)} WHERE id = ?", params)
        self.conn.commit()
        return True

    def find_knowledge_by_shortcut(self, shortcut: str, lang: str = None) -> dict | None:
        """ショートカットでナレッジを1件検索。
        lang指定時: shortcut_lang（例: _help_en）を先に探し、なければshortcut（_help）にフォールバック"""
        if lang:
            row = self.conn.execute(
                "SELECT id, key, title, content, category, is_system, shortcut, is_magic FROM knowledge WHERE LOWER(shortcut) = LOWER(?)",
                (f"{shortcut}_{lang}",)
            ).fetchone()
            if row:
                return dict(row)
        # フォールバック: 言語なしのベースショートカット
        row = self.conn.execute(
            "SELECT id, key, title, content, category, is_system, shortcut, is_magic FROM knowledge WHERE LOWER(shortcut) = LOWER(?)",
            (shortcut,)
        ).fetchone()
        return dict(row) if row else None

    def get_magic_words(self) -> list:
        """マジックワード一覧（is_magic=1 かつ shortcut が設定されているもの）"""
        rows = self.conn.execute(
            "SELECT id, key, title, shortcut, category, is_system FROM knowledge WHERE is_magic = 1 AND shortcut IS NOT NULL ORDER BY is_system DESC, title"
        ).fetchall()
        return [dict(r) for r in rows]

    def search_knowledge(self, query: str, personal_id: int = None, limit: int = 3) -> list:
        """タイトル or 本文の部分一致でナレッジ検索"""
        sql = "SELECT id, key, title, content, category, is_system FROM knowledge WHERE (title LIKE ? OR content LIKE ?)"
        params = [f"%{query}%", f"%{query}%"]
        if personal_id is not None:
            sql += " AND (personal_id IS NULL OR personal_id = ?)"
            params.append(personal_id)
        sql += " ORDER BY is_system DESC, updated_at DESC LIMIT ?"
        params.append(limit)
        rows = self.conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def list_knowledge(self, personal_id: int = None) -> list:
        """ナレッジ一覧"""
        sql = "SELECT id, key, title, content, type, category, is_system, shortcut, is_magic, created_at, updated_at FROM knowledge"
        params = []
        if personal_id is not None:
            sql += " WHERE (personal_id IS NULL OR personal_id = ?)"
            params.append(personal_id)
        sql += " ORDER BY is_system DESC, updated_at DESC"
        rows = self.conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def delete_knowledge(self, knowledge_id) -> bool:
        """ナレッジ削除。is_system=1は削除不可。idまたはkeyで指定可"""
        # keyで指定された場合
        if isinstance(knowledge_id, str) and not knowledge_id.isdigit():
            cur = self.conn.execute(
                "DELETE FROM knowledge WHERE key = ? AND is_system = 0",
                (knowledge_id,)
            )
        else:
            cur = self.conn.execute(
                "DELETE FROM knowledge WHERE id = ? AND is_system = 0",
                (int(knowledge_id),)
            )
        self.conn.commit()
        return cur.rowcount > 0

    # ========== 呼び方帳（user_address_book） ==========

    def save_user_address_book(self, personal_id: int, actor_id: int = None,
                                speaker_name: str = "", address: str = "",
                                reason: str = "") -> int:
        """呼び方帳にエントリを追加/更新する。
        交換日記風: 「テスト子は『しぇわくん』と呼んでいる（親しみを込めて）」
        memo_type='user_address_book' で既存memosテーブルを利用。
        同じspeaker(personal_id+actor_id)の既存エントリは更新する。
        """
        reason_part = f"（{reason}）" if reason else ""
        content = f"{speaker_name}は「{address}」と呼んでいる{reason_part}"

        # 既存エントリを検索（同じ personal_id + actor_id の user_address_book）
        if actor_id:
            existing = self.conn.execute(
                "SELECT id FROM memos WHERE personal_id=? AND actor_id=? AND memo_type='user_address_book'",
                (personal_id, actor_id)
            ).fetchone()
        else:
            existing = self.conn.execute(
                "SELECT id FROM memos WHERE personal_id=? AND actor_id IS NULL AND memo_type='user_address_book'",
                (personal_id,)
            ).fetchone()

        now = datetime.utcnow().isoformat()
        if existing:
            self.conn.execute(
                "UPDATE memos SET content=?, updated_at=? WHERE id=?",
                (content, now, existing[0])
            )
            self.conn.commit()
            return existing[0]
        else:
            cur = self.conn.execute(
                """INSERT INTO memos (personal_id, actor_id, chat_thread_id, content, memo_type, status, created_at, updated_at)
                   VALUES (?, ?, NULL, ?, 'user_address_book', 'active', ?, ?)""",
                (personal_id, actor_id, content, now, now)
            )
            self.conn.commit()
            return cur.lastrowid

    def get_user_address_book(self) -> list[dict]:
        """全人格の呼び方帳エントリを取得する（人格横断）"""
        rows = self.conn.execute(
            "SELECT * FROM memos WHERE memo_type='user_address_book' AND status='active' ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    # ========== 会議参加者（chat_participant） ==========

    def add_participant(self, chat_thread_id: str, actor_id: int, personal_id: int,
                        engine_id: str = None, model_id: str = None,
                        role: str = "member", join_order: int = 0,
                        color: str = None) -> int:
        """会議スレッドに参加者を追加"""
        now = datetime.utcnow().isoformat()
        cur = self.conn.execute(
            """INSERT OR IGNORE INTO chat_participant
               (chat_thread_id, actor_id, personal_id, engine_id, model_id, role, join_order, color, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (chat_thread_id, actor_id, personal_id, engine_id, model_id, role, join_order, color, now)
        )
        self.conn.commit()
        return cur.lastrowid

    def get_participants(self, chat_thread_id: str) -> list:
        """会議スレッドの参加者一覧を join_order 順で取得"""
        rows = self.conn.execute(
            """SELECT cp.*, a.name as actor_name, p.name as personal_name
               FROM chat_participant cp
               LEFT JOIN actor a ON cp.actor_id = a.actor_id
               LEFT JOIN personal p ON cp.personal_id = p.personal_id
               WHERE cp.chat_thread_id = ?
               ORDER BY cp.join_order""",
            (chat_thread_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def update_participant(self, chat_thread_id: str, actor_id: int,
                           engine_id: str = None, model_id: str = None) -> bool:
        """会議参加者のエンジン/モデルを更新"""
        sets = []
        vals = []
        if engine_id is not None:
            sets.append("engine_id=?")
            vals.append(engine_id)
        if model_id is not None:
            sets.append("model_id=?")
            vals.append(model_id)
        if not sets:
            return False
        vals.extend([chat_thread_id, actor_id])
        cur = self.conn.execute(
            f"UPDATE chat_participant SET {', '.join(sets)} WHERE chat_thread_id=? AND actor_id=?",
            vals
        )
        self.conn.commit()
        return cur.rowcount > 0

    def update_participant_label(self, chat_thread_id: str, actor_id: int, label: str) -> bool:
        """会議参加者のラベル（立場・役割表明）を更新"""
        cur = self.conn.execute(
            "UPDATE chat_participant SET label=? WHERE chat_thread_id=? AND actor_id=?",
            (label or None, chat_thread_id, actor_id)
        )
        self.conn.commit()
        return cur.rowcount > 0

    def remove_participant(self, chat_thread_id: str, actor_id: int) -> bool:
        """会議スレッドから参加者を削除"""
        cur = self.conn.execute(
            "DELETE FROM chat_participant WHERE chat_thread_id=? AND actor_id=?",
            (chat_thread_id, actor_id)
        )
        self.conn.commit()
        return cur.rowcount > 0

    def get_chat_mode(self, chat_thread_id: str) -> str:
        """スレッドのモード取得（single/multi）"""
        row = self.conn.execute(
            "SELECT mode FROM chat WHERE id = ?", (chat_thread_id,)
        ).fetchone()
        return (row["mode"] if row and row["mode"] else "single")

    def set_chat_mode(self, chat_thread_id: str, mode: str):
        """スレッドのモード設定"""
        self.conn.execute(
            "UPDATE chat SET mode = ? WHERE id = ?", (mode, chat_thread_id)
        )
        self.conn.commit()

    def get_meeting_lv(self, chat_thread_id: str) -> int:
        """会議記憶レベル取得（0/1/2）"""
        row = self.conn.execute(
            "SELECT meeting_lv FROM chat WHERE id = ?", (chat_thread_id,)
        ).fetchone()
        return int(row["meeting_lv"]) if row and row["meeting_lv"] is not None else 0

    def set_meeting_lv(self, chat_thread_id: str, level: int):
        """会議記憶レベル設定（0=この会議限り, 1=記憶共有, 2=記憶共有+経験持ち帰り）"""
        self.conn.execute(
            "UPDATE chat SET meeting_lv = ? WHERE id = ?", (max(0, min(2, level)), chat_thread_id)
        )
        self.conn.commit()

    def get_meeting_type(self, chat_thread_id: str) -> str:
        """会議タイプ取得（casual/debate/brainstorm/consultation）"""
        row = self.conn.execute(
            "SELECT meeting_type FROM chat WHERE id = ?", (chat_thread_id,)
        ).fetchone()
        return (row["meeting_type"] if row and row["meeting_type"] else "casual")

    def set_meeting_type(self, chat_thread_id: str, meeting_type: str):
        """会議タイプ設定"""
        valid = ("casual", "debate", "brainstorm", "consultation")
        mt = meeting_type if meeting_type in valid else "casual"
        self.conn.execute(
            "UPDATE chat SET meeting_type = ? WHERE id = ?", (mt, chat_thread_id)
        )
        self.conn.commit()

    # ========== Google認証ユーザー管理 ==========

    def get_or_create_google_user(self, email: str, google_sub: str, display_name: str) -> int:
        """
        Googleログインユーザーのpersonal_idを返す。
        初回ログイン時はpersonalレコードを自動作成。
        """
        row = self.conn.execute(
            "SELECT personal_id FROM google_auth WHERE email=?", (email,)
        ).fetchone()
        if row:
            self.conn.execute(
                "UPDATE google_auth SET last_login_at=CURRENT_TIMESTAMP WHERE email=?",
                (email,)
            )
            self.conn.commit()
            return row["personal_id"]

        # 新規ユーザー: personalレコードを作成
        now = datetime.utcnow().isoformat()
        cur = self.conn.execute(
            "INSERT INTO personal (name, is_unnamed, created_at) VALUES (?, 0, ?)",
            (display_name or email.split("@")[0], now)
        )
        personal_id = cur.lastrowid

        self.conn.execute(
            "INSERT INTO google_auth (email, google_sub, personal_id, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
            (email, google_sub, personal_id, display_name or "", now)
        )
        self.conn.commit()
        print(f"[AUTH] 新規ユーザー登録: {email} → personal_id={personal_id}")
        return personal_id

    def get_google_user(self, email: str) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM google_auth WHERE email=?", (email,)
        ).fetchone()
        return dict(row) if row else None

    # ========== サルベージデータ（有料オプション） ==========

    def save_salvage_data(self, source_name: str, source_path: str, filename: str,
                          content_summary: str, is_file_ref: int, file_type: str, file_size: int,
                          file_hash: str, status: str = "raw") -> int:
        """サルベージデータを保存（同一パスなら更新）
        content_summary: 2000文字以下=全文、2000文字超=先頭2000文字
        is_file_ref: 0=DBに全文あり、1=ファイル参照（source_pathで元ファイルを読む）
        """
        now = datetime.utcnow().isoformat()
        existing = self.conn.execute(
            "SELECT id FROM salvage_data WHERE source_path = ?", (source_path,)
        ).fetchone()
        if existing:
            self.conn.execute(
                """UPDATE salvage_data
                   SET source_name=?, filename=?, content_summary=?, is_file_ref=?, file_type=?, file_size=?,
                       file_hash=?, status=?, updated_at=?
                   WHERE source_path=?""",
                (source_name, filename, content_summary, is_file_ref, file_type, file_size,
                 file_hash, status, now, source_path)
            )
            self.conn.commit()
            return existing["id"]
        else:
            cur = self.conn.execute(
                """INSERT INTO salvage_data
                   (source_name, source_path, filename, content_summary, is_file_ref, file_type, file_size,
                    file_hash, status, scanned_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (source_name, source_path, filename, content_summary, is_file_ref, file_type, file_size,
                 file_hash, status, now, now)
            )
            self.conn.commit()
            return cur.lastrowid

    def list_salvage_data(self, source_name: str = None) -> list:
        """サルベージデータ一覧（content_summary含む。プレビュー用）"""
        if source_name:
            rows = self.conn.execute(
                "SELECT id, source_name, source_path, filename, content_summary, is_file_ref, file_type, file_size, file_hash, status, scanned_at, updated_at FROM salvage_data WHERE source_name=? ORDER BY source_path",
                (source_name,)
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT id, source_name, source_path, filename, content_summary, is_file_ref, file_type, file_size, file_hash, status, scanned_at, updated_at FROM salvage_data ORDER BY source_name, source_path"
            ).fetchall()
        return [dict(r) for r in rows]

    def get_salvage_data(self, data_id: int) -> dict | None:
        """サルベージデータ1件取得"""
        row = self.conn.execute(
            "SELECT * FROM salvage_data WHERE id=?", (data_id,)
        ).fetchone()
        return dict(row) if row else None

    def delete_salvage_data(self, data_id: int) -> bool:
        """サルベージデータ削除"""
        cur = self.conn.execute("DELETE FROM salvage_data WHERE id=?", (data_id,))
        self.conn.commit()
        return cur.rowcount > 0

    def delete_salvage_data_by_source(self, source_name: str) -> int:
        """ソース名でサルベージデータ一括削除"""
        cur = self.conn.execute("DELETE FROM salvage_data WHERE source_name=?", (source_name,))
        self.conn.commit()
        return cur.rowcount

    def rename_salvage_source(self, old_name: str, new_name: str) -> int:
        """ソース名を変更（source_name + source_path を更新）"""
        self.conn.execute(
            "UPDATE salvage_data SET source_name=?, source_path=REPLACE(source_path, ?, ?) WHERE source_name=?",
            (new_name, old_name + "/", new_name + "/", old_name)
        )
        self.conn.commit()
        return self.conn.execute("SELECT changes()").fetchone()[0]

    def get_salvage_sources_summary(self) -> list:
        """データソースごとのサマリ（フォルダ名、件数、合計サイズ、最終スキャン日）"""
        rows = self.conn.execute(
            """SELECT source_name,
                      COUNT(*) as file_count,
                      SUM(file_size) as total_size,
                      MIN(scanned_at) as first_added,
                      MAX(scanned_at) as last_scanned
               FROM salvage_data
               GROUP BY source_name
               ORDER BY source_name"""
        ).fetchall()
        return [dict(r) for r in rows]

    def close(self):
        self.conn.close()
