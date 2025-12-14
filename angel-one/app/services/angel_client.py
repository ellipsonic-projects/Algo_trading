from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from SmartApi import SmartConnect  # type: ignore

from app.core.totp import generate_totp


@dataclass
class AngelSession:
    jwt_token: str
    refresh_token: str
    feed_token: str
    client_code: str


class AngelClient:
    def __init__(self, *, api_key: str, client_code: str, totp_secret: str) -> None:
        self._api_key = api_key
        self._client_code = client_code
        self._totp_secret = totp_secret
        self._smart = SmartConnect(api_key=self._api_key)
        self._session: Optional[AngelSession] = None

    @property
    def is_logged_in(self) -> bool:
        return self._session is not None

    def login(self, mpin: str) -> Dict[str, Any]:
        totp = generate_totp(self._totp_secret)
        data = self._smart.generateSession(self._client_code, mpin, totp)

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

    def order_book(self) -> Dict[str, Any]:
        self._require_session()

        fn = getattr(self._smart, "orderBook", None)
        if callable(fn):
            result = fn()
            if not isinstance(result, dict):
                raise RuntimeError("Unexpected order book response from SmartAPI")
            return result

        raw_post = getattr(self._smart, "_postRequest", None)
        if callable(raw_post):
            result = raw_post("api.order.book", {})
            if not isinstance(result, dict):
                raise RuntimeError("Unexpected order book response from SmartAPI")
            return result

        raise RuntimeError("orderBook is not supported by the installed SmartAPI client")

    def cancel_order(self, *, order_id: str, variety: str = "NORMAL") -> Dict[str, Any]:
        self._require_session()
        oid = order_id.strip()
        if not oid:
            raise RuntimeError("Invalid order id")

        fn = getattr(self._smart, "cancelOrder", None)
        if callable(fn):
            try:
                result = fn(order_id=oid, variety=variety)
            except TypeError:
                result = fn(oid, variety)
            if not isinstance(result, dict):
                raise RuntimeError("Unexpected cancel order response from SmartAPI")
            return result

        raw_post = getattr(self._smart, "_postRequest", None)
        if callable(raw_post):
            result = raw_post("api.order.cancel", {"orderid": oid, "variety": variety})
            if not isinstance(result, dict):
                raise RuntimeError("Unexpected cancel order response from SmartAPI")
            return result

        raise RuntimeError("cancelOrder is not supported by the installed SmartAPI client")

    def positions(self) -> Dict[str, Any]:
        self._require_session()

        for name in ("position", "positions", "getPosition"):
            fn = getattr(self._smart, name, None)
            if callable(fn):
                result = fn()
                if not isinstance(result, dict):
                    raise RuntimeError("Unexpected positions response from SmartAPI")
                return result

        raw_post = getattr(self._smart, "_postRequest", None)
        if callable(raw_post):
            result = raw_post("api.position", {})
            if not isinstance(result, dict):
                raise RuntimeError("Unexpected positions response from SmartAPI")
            return result

        raise RuntimeError("positions are not supported by the installed SmartAPI client")

    def get_ltp(self, *, exchange: str, tradingsymbol: str, symboltoken: str) -> Dict[str, Any]:
        self._require_session()

        ex = exchange.strip().upper()
        ts = tradingsymbol.strip()
        token = symboltoken.strip()
        if not ex or not ts or not token:
            raise RuntimeError("Invalid ltp request")

        fn = getattr(self._smart, "ltpData", None)
        if fn is None:
            raise RuntimeError("ltpData is not supported by the installed SmartAPI client")

        result = fn(exchange=ex, tradingsymbol=ts, symboltoken=token)
        if not isinstance(result, dict):
            raise RuntimeError("Unexpected ltp response")

        data: Any = result.get("data")
        ltp: Optional[float] = None
        if isinstance(data, dict):
            v = data.get("ltp")
            if isinstance(v, (int, float)):
                ltp = float(v)
            elif isinstance(v, str):
                try:
                    ltp = float(v)
                except ValueError:
                    ltp = None
        if ltp is None:
            raise RuntimeError("LTP was missing")

        return {"exchange": ex, "tradingsymbol": ts, "symboltoken": token, "ltp": ltp}

    def get_index_ltp(self, *, underlying: str) -> Dict[str, Any]:
        self._require_session()

        und = underlying.strip().upper()
        if und not in {"NIFTY", "BANKNIFTY", "SENSEX"}:
            raise RuntimeError("Unsupported underlying")

        search = self.search(exchange="NSE", query=und)
        raw: Any = search.get("data")
        if not isinstance(raw, list):
            raw = []

        candidates: List[Dict[str, Any]] = [x for x in raw if isinstance(x, dict)]

        def score(x: Dict[str, Any]) -> int:
            ts = str(x.get("tradingsymbol") or x.get("tradingSymbol") or x.get("symbol") or "").upper()
            name = str(x.get("name") or x.get("companyname") or x.get("symbolname") or "").upper()
            s = 0
            if und in ts:
                s += 3
            if und in name:
                s += 2
            if "INDEX" in ts or "INDEX" in name:
                s += 3
            if ts.endswith("-INDEX"):
                s += 3
            return s

        candidates = sorted(candidates, key=score, reverse=True)
        if not candidates:
            raise RuntimeError("Unable to find index symbol")

        best = candidates[0]
        tradingsymbol = str(best.get("tradingsymbol") or best.get("tradingSymbol") or best.get("symbol") or "")
        symboltoken = str(best.get("symboltoken") or best.get("token") or best.get("symbolToken") or "")
        if not tradingsymbol or not symboltoken:
            raise RuntimeError("Unable to find index token")

        fn = getattr(self._smart, "ltpData", None)
        if fn is None:
            raise RuntimeError("ltpData is not supported by the installed SmartAPI client")

        result = fn(exchange="NSE", tradingsymbol=tradingsymbol, symboltoken=symboltoken)
        if not isinstance(result, dict):
            raise RuntimeError("Unexpected ltp response")

        data: Any = result.get("data")
        ltp: Optional[float] = None
        if isinstance(data, dict):
            v = data.get("ltp")
            if isinstance(v, (int, float)):
                ltp = float(v)
            elif isinstance(v, str):
                try:
                    ltp = float(v)
                except ValueError:
                    ltp = None
        if ltp is None:
            raise RuntimeError("LTP was missing")

        return {"underlying": und, "exchange": "NSE", "tradingsymbol": tradingsymbol, "symboltoken": symboltoken, "ltp": ltp}

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
