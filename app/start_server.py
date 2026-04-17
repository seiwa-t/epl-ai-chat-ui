"""
EPL Chat サーバー起動スクリプト
使い方: python start_server.py  （このファイルをダブルクリックでもOK）

- サーバー起動後に自動でブラウザを開きます
- 停止は Ctrl+C
"""
import os
import sys
import subprocess
import threading
import time
import webbrowser
import shutil

# このスクリプトがある場所 = appディレクトリ
APP_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = os.environ.get("PORT", "8000")
URL = f"http://localhost:{PORT}"


def find_uvicorn():
    """uvicornの実行コマンドを探す（.venv → システム → python -m）"""
    if sys.platform == "win32":
        venv_uvicorn = os.path.join(APP_DIR, ".venv", "Scripts", "uvicorn.exe")
    else:
        venv_uvicorn = os.path.join(APP_DIR, ".venv", "bin", "uvicorn")
    if os.path.exists(venv_uvicorn):
        return [venv_uvicorn]
    if shutil.which("uvicorn"):
        return ["uvicorn"]
    return [sys.executable, "-m", "uvicorn"]


UVICORN_CMD = find_uvicorn()


def open_browser():
    """サーバー起動を待ってからブラウザを開く"""
    import urllib.request
    for _ in range(30):
        time.sleep(1)
        try:
            urllib.request.urlopen(URL, timeout=2)
            print(f"[start] Opening browser: {URL}")
            webbrowser.open(URL)
            return
        except Exception:
            pass
    print("[start] Timeout: server did not start in 30s")


print(f"[start] EPL Chat Server")
print(f"[start] DIR: {APP_DIR}")
print(f"[start] URL: {URL}")
print(f"[start] Starting... (Ctrl+C to stop)")

os.chdir(APP_DIR)
sys.path.insert(0, APP_DIR)

# ブラウザ自動起動（バックグラウンド）
threading.Thread(target=open_browser, daemon=True).start()

try:
    subprocess.run(
        UVICORN_CMD + ["server:app", "--host", "0.0.0.0", "--port", PORT],
        cwd=APP_DIR,
    )
except KeyboardInterrupt:
    print("\n[start] Stopped.")
