from __future__ import annotations

import pyotp

from app.core.totp import generate_totp


def test_generate_totp_matches_pyotp(monkeypatch):
    secret = "JBSWY3DPEHPK3PXP"

    # Freeze time to an exact step boundary
    fixed_time = 1734192000
    monkeypatch.setattr(pyotp.totp.time, "time", lambda: fixed_time)

    expected = pyotp.TOTP(secret).now()
    actual = generate_totp(secret)
    assert actual == expected
