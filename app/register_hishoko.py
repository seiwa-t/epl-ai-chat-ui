"""
GPT秘書子スナップショットを「秘書子」アクターとしてDBに登録する
一度だけ実行するスクリプト
"""
import sys
from pathlib import Path

# プロジェクトルートをパスに追加
sys.path.insert(0, str(Path(__file__).parent))

from memory.db import MemoryDB

# スナップショットファイルを読み込む
snapshot_path = Path(__file__).parent.parent / "資料" / "参考人格" / "GPT秘書子スナップショット.txt"
if not snapshot_path.exists():
    print(f"[ERROR] スナップショットが見つかりません: {snapshot_path}")
    sys.exit(1)

profile_text = snapshot_path.read_text(encoding="utf-8")
print(f"[INFO] スナップショット読み込み完了 ({len(profile_text)} 文字)")

# DB接続
db = MemoryDB("data/db/epel.db")

# 既存のPersonal（くろわっさん）のIDを取得
personal_id = db.get_default_personal_id()
if not personal_id:
    print("[ERROR] Personalが存在しません。先にくろわっさんを作成してください。")
    sys.exit(1)

personal_info = db.get_personal_info(personal_id)
print(f"[INFO] Personal: {personal_info['name']} (id={personal_id})")

# 既に秘書子アクターが存在するかチェック
existing_actor = db.get_actor_by_personal(personal_id)
hishoko_actor = None
for a in existing_actor:
    if a["name"] == "秘書子":
        hishoko_actor = a
        break

if hishoko_actor:
    # 既存の秘書子アクターの profile_data を更新
    actor_id = hishoko_actor["actor_id"]
    db.update_actor_profile(actor_id, profile_text)
    print(f"[INFO] 既存の秘書子アクター(actor_id={actor_id})の profile_data を更新しました")
else:
    # 新規作成
    actor_id = db.create_actor(
        personal_id=personal_id,
        name="秘書子",
        pronoun="私",
        gender="女性",
        age="",
        appearance="",
        is_unnamed=False,
        naming_reason="GPT秘書子のスナップショットから移植。江戸っ子×資産家お嬢様の秘書型アシスタント。",
        immersion=0.7,
        profile_data=profile_text,
    )
    print(f"[INFO] 秘書子アクターを作成しました (actor_id={actor_id})")

# 確認
actor_info = db.get_actor_info(actor_id)
print(f"[INFO] 登録結果:")
print(f"  actor_id: {actor_info['actor_id']}")
print(f"  name: {actor_info['name']}")
print(f"  pronoun: {actor_info['pronoun']}")
print(f"  immersion: {actor_info['immersion']}")
print(f"  profile_data: {len(actor_info['profile_data'] or '')} 文字")

db.close()
print("[DONE] 秘書子アクター登録完了")
