"""
plugin - オプションツールのプラグイン管理
各オプションツールの有効/無効を一元管理する。
将来の有料ライセンスチェックのフックポイント。
"""

# 利用可能なオプションツール一覧
_AVAILABLE_TOOLS = {
    "salvage": {
        "label": "サルベージ・エンジン",
        "description": "ローカルファイルをスキャンしてAIに同期",
        "setting_key": "plugin:salvage:enabled",
        "default_enabled": True,
    },
}


def is_enabled(tool_name: str, db=None) -> bool:
    """オプションツールが有効かどうかを判定する。

    判定順序:
    1. ツール名が _AVAILABLE_TOOLS に存在するか
    2. DB設定(setting)に明示的な有効/無効があればそれを使う
    3. なければデフォルト値を返す

    将来の拡張:
    - ライセンスキーの検証
    - ユーザー単位の有効/無効
    """
    tool_info = _AVAILABLE_TOOLS.get(tool_name)
    if tool_info is None:
        return False

    # DB設定があればそちらを優先
    if db is not None:
        try:
            val = db.get_setting(tool_info["setting_key"], "")
            if val == "true":
                return True
            if val == "false":
                return False
        except Exception:
            pass

    return tool_info.get("default_enabled", False)


def list_tools() -> list[dict]:
    """利用可能なオプションツール一覧を返す"""
    return [
        {"name": name, **info}
        for name, info in _AVAILABLE_TOOLS.items()
    ]
