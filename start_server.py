"""
EPL Chat サーバー起動スクリプト
使い方: python start_server.py  （ダブルクリックでもOK）

- サーバー起動後に自動でブラウザを開きます
- Ctrl+C 1回: 再起動
- Ctrl+C 2回（1秒以内）: 停止
"""
import os
import sys
import subprocess
import threading
import time
import webbrowser
import shutil

# app/ ディレクトリ（このスクリプトと同階層）
APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")
PORT = os.environ.get("PORT", "8000")
URL = f"http://localhost:{PORT}"


def find_uvicorn():
    """uvicornの実行コマンドを探す（.venv → システム → python -m）"""
    # 1. .venv 内の uvicorn
    if sys.platform == "win32":
        venv_uvicorn = os.path.join(APP_DIR, ".venv", "Scripts", "uvicorn.exe")
    else:
        venv_uvicorn = os.path.join(APP_DIR, ".venv", "bin", "uvicorn")
    if os.path.exists(venv_uvicorn):
        return [venv_uvicorn]

    # 2. システムにインストール済みの uvicorn
    if shutil.which("uvicorn"):
        return ["uvicorn"]

    # 3. python -m uvicorn（フォールバック）
    return [sys.executable, "-m", "uvicorn"]

def _get_build_sig():
    """gitハッシュからビルドシグネチャを生成"""
    try:
        import hashlib, glob
        # app/ 以下の主要ファイルの更新時刻をハッシュ化
        targets = sorted(glob.glob(os.path.join(APP_DIR, "**", "*.py"), recursive=True))
        targets += sorted(glob.glob(os.path.join(APP_DIR, "static", "js", "*.js")))
        targets += sorted(glob.glob(os.path.join(APP_DIR, "static", "css", "*.css")))
        h = hashlib.md5()
        for f in targets:
            h.update(str(os.path.getmtime(f)).encode())
        return h.hexdigest()[:6]
    except Exception:
        return "------"

_BUILD_SIG = _get_build_sig()

BANNER = f"""
   _____ ____  _____ _     ___
  | ____|  _ \\| ____| |   / _ \\
  |  _| | |_) |  _| | |  | | | |
  | |___|  __/| |___| |__| |_| |
  |_____|_|   |_____|_____\\___/  OS  v0.1.0-beta  [{_BUILD_SIG}]

  --- Emotional Processing Layer ---
"""
print(BANNER)

# ========== 初回セットアップ ==========

# 1. .venv が無ければ作成 + 依存パッケージインストール
VENV_DIR = os.path.join(APP_DIR, ".venv")
REQUIREMENTS = os.path.join(APP_DIR, "requirements.txt")

if not os.path.exists(VENV_DIR):
    print("  [setup] Creating virtual environment...")
    subprocess.run([sys.executable, "-m", "venv", VENV_DIR], check=True)
    # venv 内の pip でインストール
    if sys.platform == "win32":
        pip = os.path.join(VENV_DIR, "Scripts", "pip.exe")
    else:
        pip = os.path.join(VENV_DIR, "bin", "pip")
    print("  [setup] Installing dependencies...")
    subprocess.run([pip, "install", "-r", REQUIREMENTS], check=True)
    print("  [setup] Ready.")
    print()

# 2. config.yaml が無ければ config.yaml.default からコピー
CONFIG_PATH = os.path.join(APP_DIR, "config.yaml")
CONFIG_DEFAULT = os.path.join(APP_DIR, "config.yaml.default")

if not os.path.exists(CONFIG_PATH):
    if os.path.exists(CONFIG_DEFAULT):
        shutil.copy2(CONFIG_DEFAULT, CONFIG_PATH)
        print(f"  [setup] config.yaml generated.")
        print(f"  [setup] Set your API key in the browser or: {CONFIG_PATH}")
        print()
    else:
        print(f"  [setup] WARNING: config.yaml.default not found.")
        print(f"  [setup] Create config.yaml from config.yaml.example.")
        print()


def open_browser():
    """サーバー起動を待ってからブラウザを開く"""
    import urllib.request
    # EPL_RESET=1 なら ?reset=1 を付けて localStorage クリア
    reset = os.environ.get("EPL_RESET", "")
    open_url = f"{URL}?reset=1" if reset == "1" else URL
    for _ in range(30):
        time.sleep(1)
        try:
            urllib.request.urlopen(URL, timeout=2)
            print(f"[start] Opening browser: {open_url}")
            webbrowser.open(open_url)
            return
        except Exception:
            pass
    print("[start] Timeout: server did not start in 30s")


UVICORN_CMD = find_uvicorn()


def run_server():
    """サーバープロセスを起動して返す"""
    return subprocess.Popen(
        UVICORN_CMD + ["server:app", "--host", "0.0.0.0", "--port", PORT],
        cwd=APP_DIR,
    )


print(f"  DIR: {APP_DIR}")
print(f"  URL: {URL}")
print(f"  Ctrl+C: restart / Ctrl+C x2: stop")
print()

os.chdir(APP_DIR)
sys.path.insert(0, APP_DIR)

# ブラウザ自動起動（初回のみ）
threading.Thread(target=open_browser, daemon=True).start()

last_interrupt = 0

while True:
    proc = run_server()
    try:
        proc.wait()
        # プロセスが自発的に終了した場合（クラッシュ等）
        print(f"\n[start] Server exited (code={proc.returncode}). Restarting in 2s...")
        time.sleep(2)
    except KeyboardInterrupt:
        now = time.time()
        if now - last_interrupt < 1.0:
            # 2回目のCtrl+C（1秒以内）→ 停止
            print("\n[start] Stopped.")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
            break
        else:
            # 1回目のCtrl+C → 再起動
            last_interrupt = now
            print("\n[start] Restarting... (Ctrl+C again within 1s to stop)")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
            time.sleep(0.5)
