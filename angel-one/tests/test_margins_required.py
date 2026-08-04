import os
from typing import Any, Dict
from fastapi.testclient import TestClient

def _build_client() -> TestClient:
    os.environ["INTERNAL_API_SECRET"] = "test-internal-secret"
    os.environ["ANGEL_API_KEY"] = "test"
    os.environ["ANGEL_CLIENT_CODE"] = "test"
    os.environ["ANGEL_TOTP_SECRET"] = "test"

    from app.main import app
    from app.services.session_manager import session_manager
    from app.services.angel_client import AngelSession

    # Bootstrap active mock session for the test user ID
    client = session_manager.create_session("test-user-id", client_code="test", api_key="test")
    client._session = AngelSession(
        jwt_token="mock-jwt",
        refresh_token="mock-refresh",
        feed_token="mock-feed",
        client_code="test"
    )

    return TestClient(app)

client = _build_client()
headers = {
    "X-Internal-Token": "test-internal-secret",
    "X-User-Id": "test-user-id"
}

def test_required_margin_rejects_non_positive_quantity() -> None:
    res = client.post(
        "/angel/margins/required",
        headers=headers,
        json={
            "exchange": "NSE",
            "tradingsymbol": "TCS",
            "symboltoken": "11536",
            "transactiontype": "BUY",
            "producttype": "INTRADAY",
            "quantity": 0,
            "ordertype": "MARKET",
        },
    )
    assert res.status_code == 400
    assert "Quantity must be > 0" in res.text


def test_required_margin_rejects_invalid_transactiontype() -> None:
    res = client.post(
        "/angel/margins/required",
        headers=headers,
        json={
            "exchange": "NSE",
            "tradingsymbol": "TCS",
            "symboltoken": "11536",
            "transactiontype": "HOLD",
            "producttype": "INTRADAY",
            "quantity": 1,
            "ordertype": "MARKET",
        },
    )
    assert res.status_code == 400
    assert "Invalid transactiontype" in res.text
