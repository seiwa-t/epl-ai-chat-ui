#!/bin/bash
# ============================================================
# EPL AI Chat UI — Mac セットアップ & 起動スクリプト
# ダブルクリックで実行できます
# ============================================================
cd "$(dirname "$0")"

echo "============================================"
echo "  EPL AI Chat UI セットアップ"
echo "============================================"
echo ""

# ── 1. Python3 チェック ──
if command -v python3 &>/dev/null; then
    PY=$(command -v python3)
    PY_VER=$($PY --version 2>&1)
    echo "[OK] $PY_VER ($PY)"
else
    echo "[!] Python3 が見つかりません。"
    echo ""
    echo "インストール方法を選んでください:"
    echo "  1) Homebrew でインストール（推奨）"
    echo "  2) 公式サイトからダウンロード"
    echo ""
    read -p "選択 (1/2): " choice

    if [ "$choice" = "1" ]; then
        # Homebrew チェック
        if ! command -v brew &>/dev/null; then
            echo ""
            echo "[i] Homebrew をインストールします..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            # Apple Silicon の場合 PATH に追加
            if [ -f /opt/homebrew/bin/brew ]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            fi
        fi
        echo ""
        echo "[i] Python をインストールしています..."
        brew install python3
        PY=$(command -v python3)
    else
        echo ""
        echo "以下のURLからダウンロードしてインストールしてください:"
        echo "  https://www.python.org/downloads/"
        echo ""
        echo "インストール後にこのスクリプトをもう一度ダブルクリックしてください。"
        read -p "Enterで終了..."
        exit 0
    fi

    if ! command -v python3 &>/dev/null; then
        echo "[ERROR] Python3 のインストールに失敗しました。"
        read -p "Enterで終了..."
        exit 1
    fi
    PY=$(command -v python3)
    echo "[OK] $($PY --version 2>&1)"
fi

# ── 2. venv セットアップ ──
VENV_DIR="app/.venv"
if [ ! -d "$VENV_DIR" ]; then
    echo ""
    echo "[i] 仮想環境を作成しています..."
    $PY -m venv "$VENV_DIR"
    if [ $? -ne 0 ]; then
        echo "[ERROR] 仮想環境の作成に失敗しました。"
        read -p "Enterで終了..."
        exit 1
    fi
    echo "[OK] 仮想環境を作成しました"
fi

# ── 3. pip install ──
PIP="$VENV_DIR/bin/pip"
VENV_PY="$VENV_DIR/bin/python"

# requirements.txt があればそれを使う、なければ直接指定
if [ -f "app/requirements.txt" ]; then
    REQ="app/requirements.txt"
elif [ -f "requirements.txt" ]; then
    REQ="requirements.txt"
else
    REQ=""
fi

# uvicorn が入ってなければインストール
if [ ! -f "$VENV_DIR/bin/uvicorn" ]; then
    echo ""
    echo "[i] 依存パッケージをインストールしています..."
    if [ -n "$REQ" ]; then
        $PIP install -r "$REQ" -q
    else
        $PIP install uvicorn fastapi httpx pyyaml anthropic openai google-genai -q
    fi
    if [ $? -ne 0 ]; then
        echo "[WARN] 一部のパッケージのインストールに問題がありました。"
    else
        echo "[OK] パッケージインストール完了"
    fi
fi

# ── 4. 起動 ──
echo ""
echo "============================================"
echo "  サーバーを起動します"
echo "  Ctrl+C で停止"
echo "============================================"
echo ""
$VENV_PY start_server.py
