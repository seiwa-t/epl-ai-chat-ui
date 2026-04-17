"""
Google OAuth2 認証モジュール
"""
import os
import time
import secrets
import httpx
from typing import Optional
from fastapi import Request, HTTPException
from fastapi.responses import RedirectResponse
from jose import jwt, JWTError

# ========== 設定 ==========

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30
SESSION_COOKIE = "epel_session"


def get_auth_config(config: dict) -> dict:
    return config.get("auth", {})


def get_jwt_secret(config: dict) -> str:
    secret = get_auth_config(config).get("jwt_secret", "")
    if not secret:
        raise RuntimeError("auth.jwt_secret が config.yaml に設定されていません")
    return secret


def get_allowed_emails(config: dict) -> list:
    return get_auth_config(config).get("allowed_emails", [])


def get_google_client_id(config: dict) -> str:
    return get_auth_config(config).get("google_client_id", "")


def get_google_client_secret(config: dict) -> str:
    return get_auth_config(config).get("google_client_secret", "")


def get_redirect_uri(config: dict) -> str:
    base = get_auth_config(config).get("base_url", "http://localhost:8000")
    return f"{base}/auth/google/callback"


# ========== JWT ==========

def create_session_token(email: str, personal_id: int, secret: str) -> str:
    payload = {
        "sub": email,
        "pid": personal_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + JWT_EXPIRE_DAYS * 86400,
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def decode_session_token(token: str, secret: str) -> Optional[dict]:
    try:
        return jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None


# ========== セッション取得 ==========

def get_current_user(request: Request, config: dict) -> Optional[dict]:
    """
    Cookieからセッションを取得。
    戻り値: {"email": str, "personal_id": int} or None
    """
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    secret = get_auth_config(config).get("jwt_secret", "")
    if not secret:
        return None
    payload = decode_session_token(token, secret)
    if not payload:
        return None
    return {"email": payload["sub"], "personal_id": payload["pid"]}


def require_login(request: Request, config: dict) -> dict:
    """ログイン必須。未ログインなら401を返す（API用）"""
    user = get_current_user(request, config)
    if not user:
        raise HTTPException(status_code=401, detail="ログインが必要です")
    return user


# ========== Google OAuth フロー ==========

def build_google_auth_url(config: dict, state: str) -> str:
    client_id = get_google_client_id(config)
    redirect_uri = get_redirect_uri(config)
    params = (
        f"client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&scope=openid%20email%20profile"
        f"&state={state}"
        f"&access_type=offline"
    )
    return f"{GOOGLE_AUTH_URL}?{params}"


async def exchange_code_for_token(code: str, config: dict) -> dict:
    client_id = get_google_client_id(config)
    client_secret = get_google_client_secret(config)
    redirect_uri = get_redirect_uri(config)

    async with httpx.AsyncClient() as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
    resp.raise_for_status()
    return resp.json()


async def get_google_userinfo(access_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"}
        )
    resp.raise_for_status()
    return resp.json()
