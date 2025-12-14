from __future__ import annotations

import pyotp


def generate_totp(secret: str) -> str:
    cleaned = secret.replace(" ", "").strip()
    return pyotp.TOTP(cleaned).now()
