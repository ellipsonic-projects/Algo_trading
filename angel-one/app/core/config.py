from __future__ import annotations

from dataclasses import dataclass
import os
from typing import List, Optional

from dotenv import load_dotenv


@dataclass(frozen=True)
class AngelOneConfig:
    api_key: str
    client_code: str
    totp_secret: str
    base_url: str


@dataclass(frozen=True)
class AppConfig:
    env: str
    port: int
    cors_origins: List[str]
    angel: AngelOneConfig
    internal_api_secret: str  # shared secret for Node→Python service calls


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise ValueError(f"Missing required environment variable: {name}")
    return value.strip()


def load_config(dotenv_path: Optional[str] = None) -> AppConfig:
    load_dotenv(dotenv_path=dotenv_path, override=False)

    env = os.getenv("APP_ENV", "development").strip()
    port = int(os.getenv("APP_PORT", "8000"))

    cors_raw = os.getenv("CORS_ORIGINS", "http://localhost:5173")
    cors_origins = [o.strip() for o in cors_raw.split(",") if o.strip()]

    angel = AngelOneConfig(
        api_key=_require_env("ANGEL_API_KEY"),
        client_code=_require_env("ANGEL_CLIENT_CODE"),
        totp_secret=_require_env("ANGEL_TOTP_SECRET"),
        base_url=os.getenv("ANGEL_BASE_URL", "https://apiconnect.angelone.in").strip(),
    )

    internal_api_secret = os.getenv("INTERNAL_API_SECRET", "").strip()

    return AppConfig(
        env=env,
        port=port,
        cors_origins=cors_origins,
        angel=angel,
        internal_api_secret=internal_api_secret,
    )
