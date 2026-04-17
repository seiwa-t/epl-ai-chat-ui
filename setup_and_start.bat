@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ============================================
echo   EPL AI Chat UI セットアップ
echo ============================================
echo.

:: ── 1. Python チェック ──
where python >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
    echo [OK] %PY_VER%
    goto :VENV
)
where python3 >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%v in ('python3 --version 2^>^&1') do set PY_VER=%%v
    echo [OK] %PY_VER%
    goto :VENV
)

echo [!] Python が見つかりません。
echo.
echo 以下のURLからダウンロードしてインストールしてください:
echo   https://www.python.org/downloads/
echo.
echo ★重要: インストール時に「Add Python to PATH」にチェックを入れてください
echo.
echo インストール後にこのファイルをもう一度ダブルクリックしてください。
pause
exit /b 1

:: ── 2. venv セットアップ ──
:VENV
set VENV_DIR=app\.venv
if exist "%VENV_DIR%\Scripts\python.exe" goto :DEPS

echo.
echo [i] 仮想環境を作成しています...
python -m venv "%VENV_DIR%"
if %errorlevel% neq 0 (
    echo [ERROR] 仮想環境の作成に失敗しました。
    pause
    exit /b 1
)
echo [OK] 仮想環境を作成しました

:: ── 3. pip install ──
:DEPS
set PIP=%VENV_DIR%\Scripts\pip.exe
set VENV_PY=%VENV_DIR%\Scripts\python.exe

:: uvicorn が入ってなければインストール
if exist "%VENV_DIR%\Scripts\uvicorn.exe" goto :START

echo.
echo [i] 依存パッケージをインストールしています...
if exist "app\requirements.txt" (
    "%PIP%" install -r app\requirements.txt -q
) else if exist "requirements.txt" (
    "%PIP%" install -r requirements.txt -q
) else (
    "%PIP%" install uvicorn fastapi httpx pyyaml anthropic openai google-genai python-jose duckduckgo_search -q
)
if %errorlevel% neq 0 (
    echo [WARN] 一部のパッケージのインストールに問題がありました。
) else (
    echo [OK] パッケージインストール完了
)

:: ── 4. 起動 ──
:START
echo.
echo ============================================
echo   サーバーを起動します
echo   Ctrl+C で停止
echo ============================================
echo.
"%VENV_PY%" start_server.py
pause
