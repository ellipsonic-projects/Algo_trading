from __future__ import annotations

import os
import pytest

from app.core.config import load_config


def test_load_config_requires_env_vars(monkeypatch):
    monkeypatch.delenv("ANGEL_API_KEY", raising=False)
    monkeypatch.delenv("ANGEL_CLIENT_CODE", raising=False)
    monkeypatch.delenv("ANGEL_PASSWORD", raising=False)
    monkeypatch.delenv("ANGEL_TOTP_SECRET", raising=False)

    with pytest.raises(ValueError):
        load_config(dotenv_path=None)


def test_load_config_parses_cors_origins(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "ANGEL_API_KEY=key",
                "ANGEL_CLIENT_CODE=code",
                "ANGEL_PASSWORD=pass",
                "ANGEL_TOTP_SECRET=secret",
                "CORS_ORIGINS=http://a,http://b",
            ]
        )
    )

    # Ensure process env doesn't interfere
    monkeypatch.setenv("CORS_ORIGINS", "")

    cfg = load_config(dotenv_path=str(env_file))
    assert cfg.angel.api_key == "key"
    assert cfg.cors_origins == ["http://a", "http://b"]
