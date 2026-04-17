from __future__ import annotations
"""
tool_salvage - サルベージ・エンジン
app/user_data/ 配下をスキャンしてDBに取り込む。
APIRouter によるプラグイン構造。
"""
import hashlib
import os
import unicodedata
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# 拡張子ホワイトリスト
ALLOWED_EXTENSIONS = {
    ".txt", ".md", ".json", ".csv", ".log",
    ".py", ".js", ".html", ".css",
    ".yaml", ".yml", ".toml", ".xml",
}

# macOS/Windows が自動生成するスキップ対象
_SKIP_FILENAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
_SKIP_DIR_NAMES = {"__MACOSX", ".Spotlight-V100", ".Trashes", ".fseventsd"}

# スキャン対象のベースディレクトリ（app/ 配下の user_data/）
USER_DATA_DIR = Path(__file__).parent.parent / "user_data"

# 1ファイルあたりの読み込み上限 (bytes)
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

router = APIRouter(prefix="/api/salvage", tags=["salvage"])

# db インスタンスは init_router() で注入される
_db = None

# ナレッジ化のための content_summary 上限
SUMMARY_THRESHOLD = 2000


def init_router(db, get_engine_fn=None):
    """server.py から db インスタンスを受け取る"""
    global _db
    _db = db


def _get_engine(engine_id: str):
    """エンジンインスタンスを遅延取得（server.py の定義後に呼ばれるため安全）"""
    try:
        from server import _get_or_create_engine
        return _get_or_create_engine(engine_id)
    except Exception:
        return None


def _get_db():
    if _db is None:
        raise HTTPException(status_code=500, detail="Salvage DB not initialized")
    return _db


# ========== リクエストモデル ==========

class ScanRequest(BaseModel):
    source_name: str | None = None  # 指定しなければ user_data 直下のフォルダを自動検出


# ========== ディレクトリスキャナー ==========

def _read_text_auto(file_path: Path) -> str:
    """エンコーディング自動検出でテキスト読み込み（日本語ファイル対応）"""
    for enc in ("utf-8", "utf-8-sig", "cp932", "shift_jis", "euc-jp", "latin-1"):
        try:
            return file_path.read_text(encoding=enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return ""


def _is_skip_path(file_path: Path) -> bool:
    """macOS/Windows の自動生成ファイル・ディレクトリをスキップ判定"""
    # ファイル名チェック
    if file_path.name in _SKIP_FILENAMES:
        return True
    # ドットファイル / macOSリソースフォーク (._xxx)
    if file_path.name.startswith(".") or file_path.name.startswith("._"):
        return True
    # 親ディレクトリにスキップ対象が含まれるか
    for part in file_path.parts:
        if part in _SKIP_DIR_NAMES or part.startswith("."):
            return True
    return False


def _normalize_name(name: str) -> str:
    """macOS NFD → NFC 正規化（濁点分離問題の解消）"""
    return unicodedata.normalize("NFC", name)


def _scan_directory(base_dir: Path, source_name: str, user_data_root: Path) -> list[dict]:
    """指定ディレクトリを再帰スキャンし、ホワイトリスト拡張子のファイル情報を返す"""
    results = []
    if not base_dir.exists() or not base_dir.is_dir():
        return results

    for file_path in sorted(base_dir.rglob("*")):
        if not file_path.is_file():
            continue
        if _is_skip_path(file_path):
            continue
        if file_path.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue
        file_size = file_path.stat().st_size
        if file_size > MAX_FILE_SIZE:
            continue

        try:
            content = _read_text_auto(file_path)
        except Exception:
            content = ""

        file_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        # user_data/ からの相対パス（DB保存用）、NFC正規化
        rel_path = _normalize_name(
            str(file_path.relative_to(user_data_root)).replace("\\", "/")
        )
        filename = _normalize_name(file_path.name)

        # 2段構え: 2000文字以下→DB全文保存、超→先頭2000文字のみDB（全文はファイル参照）
        is_file_ref = 1 if len(content) > 2000 else 0
        content_summary = content[:2000] if is_file_ref else content

        results.append({
            "source_name": source_name,
            "source_path": rel_path,
            "filename": filename,
            "content_summary": content_summary,
            "is_file_ref": is_file_ref,
            "file_type": file_path.suffix.lower(),
            "file_size": file_size,
            "file_hash": file_hash,
        })

    return results


# ========== エンドポイント ==========

@router.post("/scan")
async def scan_files(req: ScanRequest = None):
    """user_data/ 配下をスキャンしてDBに取り込む"""
    db = _get_db()
    req = req or ScanRequest()

    if not USER_DATA_DIR.exists():
        USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
        return JSONResponse({"status": "ok", "scanned": 0, "message": "user_data/ created (empty)"})

    # source_name 指定あり → そのサブフォルダだけスキャン
    if req.source_name:
        target = USER_DATA_DIR / req.source_name
        if not target.exists() or not target.is_dir():
            raise HTTPException(status_code=404, detail=f"Source not found: {req.source_name}")
        sources = [(req.source_name, target)]
    else:
        # user_data/ 直下のフォルダを全スキャン
        # フォルダがなければ user_data/ 自体を "default" として扱う
        subdirs = [d for d in sorted(USER_DATA_DIR.iterdir())
                   if d.is_dir() and d.name not in _SKIP_DIR_NAMES and not d.name.startswith(".")]
        if subdirs:
            sources = [(_normalize_name(d.name), d) for d in subdirs]
        else:
            sources = [("default", USER_DATA_DIR)]

    total_scanned = 0
    total_new = 0
    total_updated = 0

    for source_name, source_dir in sources:
        files = _scan_directory(source_dir, source_name, USER_DATA_DIR)
        # 既存データのハッシュマップを事前構築（N+1回避）
        existing_list = db.list_salvage_data(source_name)
        existing_map = {e["source_path"]: e for e in existing_list}

        for f in files:
            existing = existing_map.get(f["source_path"])

            if existing and existing.get("file_hash") == f["file_hash"]:
                # 変更なし → スキップ
                continue

            db.save_salvage_data(
                source_name=f["source_name"],
                source_path=f["source_path"],
                filename=f["filename"],
                content_summary=f["content_summary"],
                is_file_ref=f["is_file_ref"],
                file_type=f["file_type"],
                file_size=f["file_size"],
                file_hash=f["file_hash"],
                status="raw",
            )
            if existing:
                total_updated += 1
            else:
                total_new += 1
            total_scanned += 1

    return JSONResponse({
        "status": "ok",
        "scanned": total_scanned,
        "new": total_new,
        "updated": total_updated,
    })


@router.get("/data")
async def list_data(source_name: str = None):
    """スキャン済みデータ一覧（content_summary含む。プレビュー表示用）"""
    db = _get_db()
    items = db.list_salvage_data(source_name)
    return JSONResponse({"status": "ok", "data": items})


@router.get("/data/{data_id}")
async def get_data(data_id: int, full: bool = False):
    """スキャン済みデータ1件取得。full=true の場合、ファイル参照データは元ファイルから全文読み込み"""
    db = _get_db()
    item = db.get_salvage_data(data_id)
    if not item:
        raise HTTPException(status_code=404, detail="Data not found")
    # full=true かつ is_file_ref=1 → 元ファイルから全文読み込み
    if full and item.get("is_file_ref"):
        file_path = USER_DATA_DIR / item["source_path"]
        if file_path.exists():
            item["full_content"] = _read_text_auto(file_path)
    return JSONResponse({"status": "ok", "data": item})


@router.delete("/data/{data_id}")
async def delete_data(data_id: int):
    """スキャン済みデータ1件削除"""
    db = _get_db()
    ok = db.delete_salvage_data(data_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Data not found")
    return JSONResponse({"status": "ok"})


@router.post("/source/{source_name}/rename")
async def rename_source(source_name: str, req: Request):
    """ソース名を変更（DB + フォルダ名）"""
    db = _get_db()
    body = await req.json()
    new_name = (body.get("new_name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name required")
    # フォルダ名も変更（重複時は _1, _2... で回避）
    old_dir = USER_DATA_DIR / source_name
    final_name = new_name
    new_dir = USER_DATA_DIR / final_name
    counter = 1
    while new_dir.exists() and new_dir != old_dir:
        final_name = f"{new_name}_{counter}"
        new_dir = USER_DATA_DIR / final_name
        counter += 1
    if old_dir.exists():
        old_dir.rename(new_dir)
    # DB更新: source_name と source_path を更新
    db.rename_salvage_source(source_name, final_name)
    return JSONResponse({"status": "ok", "name": final_name})


@router.delete("/source/{source_name}")
async def delete_source(source_name: str):
    """ソース単位で一括削除（DB + フォルダ）"""
    db = _get_db()
    count = db.delete_salvage_data_by_source(source_name)
    # フォルダも削除
    import shutil
    source_dir = USER_DATA_DIR / source_name
    if source_dir.exists() and source_dir.is_dir():
        shutil.rmtree(source_dir, ignore_errors=True)
    return JSONResponse({"status": "ok", "deleted": count})


@router.get("/status")
async def get_status():
    """サルベージ全体のステータス"""
    db = _get_db()
    sources = db.get_salvage_sources_summary()

    total_files = sum(s.get("file_count", 0) for s in sources)
    total_size = sum(s.get("total_size", 0) for s in sources)

    # user_data/ ディレクトリの存在確認
    user_data_exists = USER_DATA_DIR.exists()

    return JSONResponse({
        "status": "ok",
        "enabled": True,
        "user_data_exists": user_data_exists,
        "sources": sources,
        "total_files": total_files,
        "total_size": total_size,
    })


# ========== ナレッジフォームからデータソースへ保存 ==========

class SaveAsDataRequest(BaseModel):
    title: str
    content: str


@router.post("/save_as_data")
async def save_as_data(req: SaveAsDataRequest):
    """ナレッジフォームの内容をデータソースとしてファイル保存 + DB登録"""
    db = _get_db()
    title = req.title.strip()
    content = req.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="content required")

    # フォルダ名: 件名あり→件名、件名なし→日時
    from datetime import datetime as _dt
    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in title).strip()[:50]
    if not safe_name:
        safe_name = "import_" + _dt.now().strftime("%Y%m%d_%H%M%S")

    # 1保存 = 1データソース（フォルダ）
    source_dir = USER_DATA_DIR / safe_name
    counter = 1
    while source_dir.exists():
        source_dir = USER_DATA_DIR / f"{safe_name}_{counter}"
        counter += 1
    source_dir.mkdir(parents=True, exist_ok=True)
    source_name = source_dir.name

    # ファイル保存
    file_path = source_dir / "content.txt"
    file_path.write_text(content, encoding="utf-8")

    # DB にも登録（スキャン相当）
    file_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    is_file_ref = 1 if len(content) > SUMMARY_THRESHOLD else 0
    content_summary = content[:SUMMARY_THRESHOLD] if is_file_ref else content
    rel_path = str(file_path.relative_to(USER_DATA_DIR)).replace("\\", "/")

    db.save_salvage_data(
        source_name=source_name,
        source_path=rel_path,
        filename=file_path.name,
        content_summary=content_summary,
        is_file_ref=is_file_ref,
        file_type=".txt",
        file_size=len(content.encode("utf-8")),
        file_hash=file_hash,
        status="raw",
    )

    return JSONResponse({
        "status": "ok",
        "source_name": source_name,
        "file": str(file_path.name),
        "size": len(content),
    })


# ========== 複数ファイルを1データソースにまとめて保存 ==========

class BatchFileItem(BaseModel):
    filename: str
    content: str

class BatchSaveRequest(BaseModel):
    source_name: str = ""
    files: list[BatchFileItem]

@router.post("/save_batch")
async def save_batch(req: BatchSaveRequest):
    """複数ファイルを1つのデータソース（フォルダ）にまとめて保存"""
    db = _get_db()
    if not req.files:
        raise HTTPException(status_code=400, detail="files required")

    from datetime import datetime as _dt
    raw_name = req.source_name.strip() if req.source_name else ""
    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in raw_name).strip()[:50]
    if not safe_name:
        safe_name = "import_" + _dt.now().strftime("%Y%m%d_%H%M%S")

    source_dir = USER_DATA_DIR / safe_name
    counter = 1
    while source_dir.exists():
        source_dir = USER_DATA_DIR / f"{safe_name}_{counter}"
        counter += 1
    source_dir.mkdir(parents=True, exist_ok=True)
    source_name = source_dir.name

    saved = 0
    for f in req.files:
        content = f.content.strip()
        if not content:
            continue
        # ファイル名の安全化
        fname = "".join(c if c.isalnum() or c in "-_. " else "_" for c in f.filename).strip()
        if not fname:
            fname = f"file_{saved + 1}.txt"
        file_path = source_dir / fname
        # 同名ファイルの重複回避
        fc = 1
        while file_path.exists():
            stem = fname.rsplit(".", 1)[0] if "." in fname else fname
            ext = "." + fname.rsplit(".", 1)[1] if "." in fname else ".txt"
            file_path = source_dir / f"{stem}_{fc}{ext}"
            fc += 1
        file_path.write_text(content, encoding="utf-8")

        file_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        is_file_ref = 1 if len(content) > SUMMARY_THRESHOLD else 0
        content_summary = content[:SUMMARY_THRESHOLD] if is_file_ref else content
        rel_path = str(file_path.relative_to(USER_DATA_DIR)).replace("\\", "/")
        file_ext = "." + file_path.suffix.lstrip(".") if file_path.suffix else ".txt"

        db.save_salvage_data(
            source_name=source_name,
            source_path=rel_path,
            filename=file_path.name,
            content_summary=content_summary,
            is_file_ref=is_file_ref,
            file_type=file_ext,
            file_size=len(content.encode("utf-8")),
            file_hash=file_hash,
            status="raw",
        )
        saved += 1

    return JSONResponse({
        "status": "ok",
        "source_name": source_name,
        "file_count": saved,
    })


# ========== データソースフォルダを開く ==========

@router.post("/open_folder")
async def open_root_folder():
    """エクスプローラー / Finder でデータソースのルートフォルダを開く"""
    import subprocess, sys
    USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
    folder_abs = str(USER_DATA_DIR.resolve())
    if sys.platform == "win32":
        subprocess.Popen(["explorer", folder_abs])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", folder_abs])
    else:
        subprocess.Popen(["xdg-open", folder_abs])
    return JSONResponse({"status": "ok", "path": folder_abs})


@router.post("/open_folder/{source_name}")
async def open_folder(source_name: str):
    """エクスプローラー / Finder でデータソースフォルダを開く"""
    import subprocess, sys
    folder = USER_DATA_DIR / source_name
    if not folder.exists() or not folder.is_dir():
        raise HTTPException(status_code=404, detail="folder not found")
    folder_abs = str(folder.resolve())
    if sys.platform == "win32":
        subprocess.Popen(["explorer", folder_abs])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", folder_abs])
    else:
        subprocess.Popen(["xdg-open", folder_abs])
    return JSONResponse({"status": "ok", "path": folder_abs})


# ========== ナレッジ化（エンジン分析 → knowledge テーブル） ==========

_KNOWLEDGIZE_PROMPT = """You are a knowledge extraction assistant. Analyze the following data and extract useful knowledge.

Rules:
- Extract 1-3 knowledge items from the text
- Each item should have a clear title and concise content
- Focus on facts, insights, patterns, or actionable information
- Respond in the same language as the input text
- Output as JSON array: [{{"title": "...", "content": "...", "perspective": "..."}}]
- perspective: a short label for the angle of analysis (e.g. "technical", "business", "relationship", "insight")

Data source: {source_name} / {filename}

--- BEGIN DATA ---
{content}
--- END DATA ---

Extract knowledge items as JSON array:"""


class KnowledgizeRequest(BaseModel):
    source_name: str
    engine: str = "gemini"  # gemini / claude / openai
    data_ids: list[int] | None = None  # None = all files in source


@router.post("/knowledgize")
async def knowledgize(req: KnowledgizeRequest):
    """データソースをエンジンで分析してナレッジ化"""
    import json as _json

    db = _get_db()

    engine = _get_engine(req.engine)
    if not engine:
        raise HTTPException(status_code=400, detail=f"Engine '{req.engine}' not configured (API key missing?)")

    # 対象データ取得
    if req.data_ids:
        items = [db.get_salvage_data(did) for did in req.data_ids]
        items = [i for i in items if i]
    else:
        items = db.list_salvage_data(req.source_name)

    if not items:
        raise HTTPException(status_code=404, detail="No data found")

    created = 0
    errors = []

    for item in items:
        # 全文取得: is_file_ref なら元ファイルから読む
        if item.get("is_file_ref"):
            file_path = USER_DATA_DIR / item["source_path"]
            if file_path.exists():
                content = _read_text_auto(file_path)
            else:
                content = item.get("content_summary", "")
        else:
            content = item.get("content_summary", "") or item.get("content", "")

        if not content.strip():
            continue

        # プロンプト構築
        prompt = _KNOWLEDGIZE_PROMPT.format(
            source_name=item.get("source_name", ""),
            filename=item.get("filename", ""),
            content=content[:50000],  # エンジンの入力上限に配慮
        )

        try:
            response = await engine.send_message(
                system_prompt="You are a knowledge extraction assistant. Always respond with valid JSON.",
                messages=[{"role": "user", "content": prompt}],
            )
            # JSON抽出（レスポンスからJSON部分だけ取り出す）
            text = response.strip()
            # ```json ... ``` で囲まれてる場合
            if "```" in text:
                text = text.split("```json")[-1].split("```")[0] if "```json" in text else text.split("```")[1].split("```")[0]
            knowledge_items = _json.loads(text.strip())
            if not isinstance(knowledge_items, list):
                knowledge_items = [knowledge_items]

            for ki in knowledge_items:
                title = ki.get("title", "").strip()
                content_k = ki.get("content", "").strip()
                perspective = ki.get("perspective", "").strip()
                if title and content_k:
                    db.save_knowledge(
                        title=title,
                        content=content_k,
                        category=perspective or "salvage",
                    )
                    created += 1

        except Exception as e:
            errors.append({"file": item.get("filename", ""), "error": str(e)})
            print(f"[SALVAGE] knowledgize error for {item.get('filename')}: {e}")

    return JSONResponse({
        "status": "ok",
        "created": created,
        "errors": errors,
    })
