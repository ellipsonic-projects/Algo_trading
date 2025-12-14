from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from SmartApi import SmartConnect  # type: ignore

from app.core.totp import generate_totp


@dataclass
class AngelSession:
    jwt_token: str
    refresh_token: str
    feed_token: str
    client_code: str


class AngelClient:
    def __init__(self, *, api_key: str, client_code: str, password: str, totp_secret: str) -> None:
        self._api_key = api_key
        self._client_code = client_code
        self._password = password
        self._totp_secret = totp_secret
        self._smart = SmartConnect(api_key=self._api_key)
        self._session: Optional[AngelSession] = None

    @property
    def is_logged_in(self) -> bool:
        return self._session is not None

    def login(self) -> Dict[str, Any]:
        totp = generate_totp(self._totp_secret)
        data = self._smart.generateSession(self._client_code, self._password, totp)

        if not isinstance(data, dict):
            raise RuntimeError("Unexpected login response from SmartAPI")

        if not data.get("status"):
            message = data.get("message") or "SmartAPI login failed"
            raise RuntimeError(str(message))

        tokens = data.get("data") or {}
        jwt_token = str(tokens.get("jwtToken") or "")
        refresh_token = str(tokens.get("refreshToken") or "")
        feed_token = str(self._smart.getfeedToken() or "")

        if not jwt_token:
            raise RuntimeError("SmartAPI login succeeded but jwtToken was missing")

        self._session = AngelSession(
            jwt_token=jwt_token,
            refresh_token=refresh_token,
            feed_token=feed_token,
            client_code=self._client_code,
        )

        return {
            "status": True,
            "message": "Angel One login successful",
            "client_code": self._client_code,
        }

    def get_profile(self) -> Dict[str, Any]:
        self._require_session()
        profile = self._smart.getProfile(self._session.refresh_token)  # type: ignore[arg-type]
        if not isinstance(profile, dict):
            raise RuntimeError("Unexpected profile response from SmartAPI")
        return profile

    def search(self, *, exchange: str, query: str) -> Dict[str, Any]:
        self._require_session()
        # SmartAPI provides searchScrip in some versions. Use getattr for compatibility.
        fn = getattr(self._smart, "searchScrip", None)
        if fn is None:
            raise RuntimeError("search is not supported by the installed SmartAPI client")
        result = fn(exchange=exchange, searchscrip=query)
        if not isinstance(result, dict):
            raise RuntimeError("Unexpected search response from SmartAPI")
        return result

    def place_order(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._require_session()

        clean_payload: Dict[str, Any] = {k: v for k, v in payload.items() if v is not None}

        raw_post = getattr(self._smart, "_postRequest", None)
        if callable(raw_post):
            try:
                full = raw_post("api.order.placefullresponse", clean_payload)
                if isinstance(full, dict):
                    return full
                if full is None:
                    return {"status": False, "message": "SmartAPI returned empty response"}
                return {"status": True, "data": {"orderid": str(full)}}
            except Exception:
                placed = raw_post("api.order.place", clean_payload)
                if isinstance(placed, dict):
                    return placed
                if placed is None:
                    return {"status": False, "message": "SmartAPI returned empty response"}
                return {"status": True, "data": {"orderid": str(placed)}}

        place_full = getattr(self._smart, "placeOrderFullResponse", None)
        if callable(place_full):
            result = place_full(payload)
            if isinstance(result, dict):
                return result
            if result is None:
                return {"status": False, "message": "SmartAPI returned empty response"}
            return {"status": True, "data": {"orderid": str(result)}}

        result = self._smart.placeOrder(payload)
        if isinstance(result, dict):
            return result
        if result is None:
            return {"status": False, "message": "SmartAPI returned empty response"}
        return {"status": True, "data": {"orderid": str(result)}}

    def _require_session(self) -> None:
        if self._session is None:
            raise RuntimeError("Not logged in. Call /angel/login first.")

    def logout(self) -> Dict[str, Any]:
        if self._session is None:
            return {"status": True, "message": "Already logged out"}

        terminate = getattr(self._smart, "terminateSession", None)
        try:
            if callable(terminate):
                terminate(self._session.client_code)
        finally:
            self._session = None

        return {"status": True, "message": "Logged out"}
