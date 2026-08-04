from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.core.config import load_config
from app.services.angel_client import AngelClient
from app.services.instrument_master import InstrumentMasterCache
from app.services.order_store import OrderStore
from app.services.session_manager import session_manager


BASE_DIR = Path(__file__).resolve().parent.parent


class PlaceOrderRequest(BaseModel):
    payload: Dict[str, Any] = Field(default_factory=dict)


class SimpleOrderRequest(BaseModel):
    exchange: str
    tradingsymbol: str
    symboltoken: str
    transactiontype: str
    producttype: str
    quantity: int
    ordertype: str = "MARKET"
    price: Optional[float] = None
    triggerprice: Optional[float] = None
    variety: str = "NORMAL"


class CancelOrderRequest(BaseModel):
    variety: str = "NORMAL"


class ExitPositionRequest(BaseModel):
    exchange: str
    tradingsymbol: str
    symboltoken: str
    quantity: int
    producttype: str = "INTRADAY"
    transactiontype: str


class LoginRequest(BaseModel):
    client_code: str
    api_key: str
    mpin: str
    totp: str


class RefreshRequest(BaseModel):
    client_code: str
    api_key: str
    refresh_token: str


class LtpRequest(BaseModel):
    exchange: str
    tradingsymbol: str
    symboltoken: str


class RequiredMarginRequest(BaseModel):
    exchange: str
    tradingsymbol: str
    symboltoken: str
    transactiontype: str
    producttype: str
    quantity: int
    ordertype: str = "MARKET"
    price: Optional[float] = None


app = FastAPI(title="Angel One Trading Backend", version="0.2.0")

cfg = load_config(dotenv_path=str(BASE_DIR / ".env"))
app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = OrderStore(db_path=str(BASE_DIR / "orders.sqlite"))
instruments = InstrumentMasterCache()


def require_internal_token(
    x_internal_token: str = Header(default="", alias="X-Internal-Token"),
) -> None:
    """FastAPI dependency that authenticates internal Node→Python service calls."""
    secret = cfg.internal_api_secret
    if not secret:
        raise HTTPException(status_code=500, detail="INTERNAL_API_SECRET is not configured on server")
    if x_internal_token != secret:
        raise HTTPException(status_code=403, detail="Forbidden: missing or invalid internal token")


def require_user_id(
    x_user_id: str = Header(default="", alias="X-User-Id"),
) -> str:
    """FastAPI dependency that extracts the User ID for multi-tenant isolation."""
    uid = x_user_id.strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Missing X-User-Id header")
    return uid


def get_user_client(user_id: str) -> AngelClient:
    """Helper to locate the user's active broker session or raise 401."""
    client = session_manager.get_session(user_id)
    if not client or not client.is_logged_in:
        raise HTTPException(status_code=401, detail="Broker connection session not active")
    return client


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True}


@app.get("/angel/session-status", dependencies=[Depends(require_internal_token)])
def angel_session_status(user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    """Check if the broker session is currently active for a specific user."""
    client = session_manager.get_session(user_id)
    return {"connected": client is not None and client.is_logged_in}


@app.post("/angel/login", dependencies=[Depends(require_internal_token)])
def angel_login(req: LoginRequest, user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    """Logs in and stores a user-scoped AngelClient session in memory."""
    client = session_manager.get_session(user_id)
    if client and client.is_logged_in:
        info = client.get_session_info()
        info["message"] = "Angel One login successful (Reused active session)"
        return info

    client = session_manager.create_session(user_id, client_code=req.client_code, api_key=req.api_key)
    try:
        return client.login(req.mpin, req.totp)
    except Exception as e:
        session_manager.remove_session(user_id)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/angel/refresh", dependencies=[Depends(require_internal_token)])
def angel_refresh(req: RefreshRequest, user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    """Refreshes the user's JWT using their stored refresh token."""
    client = session_manager.get_session(user_id)
    if not client:
        client = session_manager.create_session(user_id, client_code=req.client_code, api_key=req.api_key)
    try:
        return client.refresh_session(req.refresh_token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/angel/session-tokens", dependencies=[Depends(require_internal_token)])
def get_session_tokens(user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    """Retrieves session credentials for the Node.js backend."""
    client = get_user_client(user_id)
    return client.get_session_info()


@app.post("/angel/logout", dependencies=[Depends(require_internal_token)])
def angel_logout(user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    """Closes the user's active session and removes it from the manager."""
    client = get_user_client(user_id)
    try:
        res = client.logout()
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        session_manager.remove_session(user_id)


@app.get("/angel/profile", dependencies=[Depends(require_internal_token)])
def angel_profile(user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    try:
        return client.get_profile()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/angel/search", dependencies=[Depends(require_internal_token)])
def angel_search(query: str, exchange: str = "NSE", user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    try:
        return client.search(exchange=exchange, query=query)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/market/candles", dependencies=[Depends(require_internal_token)])
def market_candles(
    exchange: str,
    symboltoken: str,
    interval: str = "FIVE_MINUTE",
    lookback_minutes: int = 375,
    date: Optional[str] = None,
    user_id: str = Depends(require_user_id),
) -> Dict[str, Any]:
    client = get_user_client(user_id)
    try:
        ist = timezone(timedelta(hours=5, minutes=30))
        if date:
            target_date = datetime.strptime(date, "%Y-%m-%d").date()
            from_dt = datetime.combine(target_date, time(9, 15)).replace(tzinfo=ist)
            to_dt = datetime.combine(target_date, time(15, 30)).replace(tzinfo=ist)
        else:
            now_ist = datetime.now(ist)
            to_dt = min(now_ist, now_ist.replace(hour=15, minute=30, second=0, microsecond=0))
            from_dt = to_dt - timedelta(minutes=max(1, lookback_minutes))
            if from_dt >= to_dt:
                from_dt = to_dt - timedelta(minutes=max(1, lookback_minutes))

        candles = client.get_candles(
            exchange=exchange,
            symboltoken=symboltoken,
            interval=interval,
            from_dt=from_dt,
            to_dt=to_dt,
        )
        return {"items": candles}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/market/ltp", dependencies=[Depends(require_internal_token)])
def market_ltp(exchange: str, tradingsymbol: str, symboltoken: str, user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    try:
        return client.get_ltp(exchange=exchange, tradingsymbol=tradingsymbol, symboltoken=symboltoken)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/angel/margins", dependencies=[Depends(require_internal_token)])
def angel_margins(user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    try:
        return client.margins()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/angel/margins/required", dependencies=[Depends(require_internal_token)])
def required_margin(req: RequiredMarginRequest, user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    qty = int(req.quantity)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be > 0")

    tx = req.transactiontype.strip().upper()
    if tx not in {"BUY", "SELL"}:
        raise HTTPException(status_code=400, detail="Invalid transactiontype")

    ordertype = req.ordertype.strip().upper()
    if ordertype not in {"MARKET", "LIMIT", "SL", "SL-L"}:
        raise HTTPException(status_code=400, detail="Unsupported order type")

    price: Optional[float] = req.price
    if ordertype in {"MARKET", "SL"}:
        price = 0.0
    if ordertype in {"LIMIT", "SL-L"} and (price is None or price <= 0):
        raise HTTPException(status_code=400, detail="This order type requires a valid price")

    payload: Dict[str, Any] = {
        "exchange": req.exchange,
        "tradingsymbol": req.tradingsymbol,
        "symboltoken": req.symboltoken,
        "transactiontype": tx,
        "producttype": req.producttype,
        "quantity": str(qty),
        "ordertype": ordertype,
        "price": str(price if price is not None else 0),
    }

    try:
        return client.required_margin(payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/angel/orderbook", dependencies=[Depends(require_internal_token)])
def angel_orderbook(user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    try:
        return client.order_book()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/angel/orders/{order_id}/cancel", dependencies=[Depends(require_internal_token)])
def angel_cancel_order(order_id: str, req: CancelOrderRequest = CancelOrderRequest(), user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    try:
        return client.cancel_order(order_id=order_id, variety=req.variety)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/angel/positions", dependencies=[Depends(require_internal_token)])
def angel_positions(user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    try:
        return client.positions()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/angel/positions/exit", dependencies=[Depends(require_internal_token)])
def angel_exit_position(req: ExitPositionRequest, user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    tx = req.transactiontype.strip().upper()
    if tx not in {"BUY", "SELL"}:
        raise HTTPException(status_code=400, detail="Invalid transactiontype")
    qty = int(req.quantity)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be > 0")

    payload: Dict[str, Any] = {
        "variety": "NORMAL",
        "tradingsymbol": req.tradingsymbol,
        "symboltoken": req.symboltoken,
        "transactiontype": tx,
        "exchange": req.exchange,
        "ordertype": "MARKET",
        "producttype": req.producttype,
        "duration": "DAY",
        "price": "0",
        "squareoff": "0",
        "stoploss": "0",
        "quantity": str(qty),
    }

    try:
        response = client.place_order(payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    attempt = store.add(id=str(uuid4()), request=payload, response=response)
    return {"item": store.to_dict(attempt)}


@app.get("/instruments/index-options", dependencies=[Depends(require_internal_token)])
def index_options(
    exchange: str,
    underlying: str,
    expiry: Optional[str] = None,
    strike: Optional[float] = None,
    option_type: Optional[str] = None,
) -> Dict[str, Any]:
    # Instrument cache queries do not depend on the user's active session
    try:
        expiries, strikes, contracts = instruments.get_index_options(exchange=exchange, underlying=underlying, expiry=expiry)

        filtered = contracts
        if expiry is not None:
            filtered = [c for c in filtered if c.expiry == expiry]
        if strike is not None:
            filtered = [c for c in filtered if c.strike == float(strike)]
        if option_type is not None:
            ot = option_type.strip().upper()
            filtered = [c for c in filtered if c.option_type == ot]

        return {
            "expiries": expiries,
            "strikes": strikes,
            "contracts": [
                {
                    "exchange": c.exchange,
                    "underlying": c.underlying,
                    "expiry": c.expiry,
                    "strike": c.strike,
                    "lot_size": c.lot_size,
                    "option_type": c.option_type,
                    "tradingsymbol": c.tradingsymbol,
                    "symboltoken": c.symboltoken,
                }
                for c in filtered
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/market/index-ltp", dependencies=[Depends(require_internal_token)])
def index_ltp(underlying: str, user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    und = underlying.strip().upper()
    primary_ex = "BSE" if und == "SENSEX" else "MCX" if und == "CRUDEOILM" else "NSE"
    search_ex = primary_ex

    try:
        tradingsymbol, symboltoken = instruments.get_index_spot(underlying=und)
        try:
            return client.get_ltp(exchange=primary_ex, tradingsymbol=tradingsymbol, symboltoken=symboltoken)
        except Exception:
            pass

        search = client.search(exchange=search_ex, query=und)
        raw: Any = search.get("data")
        if not isinstance(raw, list):
            raw = []

        candidates = [x for x in raw if isinstance(x, dict)]
        if not candidates:
            raise RuntimeError("Unable to find index symbol")

        def pick(d: Dict[str, Any], *keys: str) -> str:
            for k in keys:
                v = d.get(k)
                if isinstance(v, str) and v.strip():
                    return v.strip()
            return ""

        def score(x: Dict[str, Any]) -> int:
            ts = pick(x, "tradingsymbol", "tradingSymbol", "symbol").upper()
            name = pick(x, "name", "companyname", "symbolname").upper()
            s = 0
            if und in ts:
                s += 3
            if und in name:
                s += 2
            if "INDEX" in ts or "INDEX" in name:
                s += 3
            if ts.endswith("-INDEX"):
                s += 4
            return s

        best = sorted(candidates, key=score, reverse=True)[0]
        best_ts = pick(best, "tradingsymbol", "tradingSymbol", "symbol")
        best_token = pick(best, "symboltoken", "symbolToken", "token")
        if not best_ts or not best_token:
            raise RuntimeError("Unable to find index token")

        return client.get_ltp(exchange=primary_ex, tradingsymbol=best_ts, symboltoken=best_token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/angel/orders", dependencies=[Depends(require_internal_token)])
def list_orders(limit: int = 50) -> Dict[str, Any]:
    # Order database store remains independent
    attempts = store.list(limit=limit)
    return {"items": [store.to_dict(a) for a in attempts]}


@app.delete("/angel/orders", dependencies=[Depends(require_internal_token)])
def clear_orders() -> Dict[str, Any]:
    deleted = store.clear()
    return {"deleted": deleted}


@app.post("/angel/orders", dependencies=[Depends(require_internal_token)])
def place_order(req: PlaceOrderRequest, user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    attempt_id = str(uuid4())
    try:
        response = client.place_order(req.payload)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Broker placement failed: {e}")

    attempt = store.add(id=attempt_id, request=req.payload, response=response)
    return {"item": store.to_dict(attempt)}


@app.post("/angel/orders/simple", dependencies=[Depends(require_internal_token)])
def place_simple_order(req: SimpleOrderRequest, user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    client = get_user_client(user_id)
    attempt_id = str(uuid4())

    qty = int(req.quantity)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be > 0")

    tx = req.transactiontype.strip().upper()
    if tx not in {"BUY", "SELL"}:
        raise HTTPException(status_code=400, detail="Invalid transactiontype")

    producttype = req.producttype
    ex = req.exchange.strip().upper()
    if ex in {"NFO", "BFO"}:
        if producttype == "DELIVERY":
            producttype = "CARRYFORWARD"

    ordertype = req.ordertype.strip().upper()
    if ordertype not in {"MARKET", "LIMIT", "SL", "SL-L"}:
        raise HTTPException(status_code=400, detail="Unsupported order type")

    price: Optional[float] = req.price
    trigger: Optional[float] = req.triggerprice
    if ordertype == "MARKET":
        price = 0.0
        trigger = None
    elif ordertype == "LIMIT":
        if price is None or price <= 0:
            raise HTTPException(status_code=400, detail="LIMIT requires price")
        trigger = None
    elif ordertype == "SL":
        if trigger is None or trigger <= 0:
            raise HTTPException(status_code=400, detail="SL requires triggerprice")
        price = 0.0
    elif ordertype == "SL-L":
        if trigger is None or trigger <= 0:
            raise HTTPException(status_code=400, detail="SL-L requires triggerprice")
        if price is None or price <= 0:
            raise HTTPException(status_code=400, detail="SL-L requires price")

    payload: Dict[str, Any] = {
        "variety": req.variety,
        "tradingsymbol": req.tradingsymbol,
        "symboltoken": req.symboltoken,
        "transactiontype": tx,
        "exchange": ex,
        "ordertype": ordertype,
        "producttype": producttype,
        "duration": "DAY",
        "price": str(price if price is not None else 0),
        "triggerprice": str(trigger) if trigger is not None else None,
        "squareoff": "0",
        "stoploss": "0",
        "quantity": str(qty),
    }

    try:
        response = client.place_order(payload)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Broker placement failed: {e}")

    attempt = store.add(id=attempt_id, request=payload, response=response)
    return {"item": store.to_dict(attempt)}


@app.websocket("/ws/broker-stream")
async def websocket_broker_stream(websocket: WebSocket, token: str = "", userId: str = ""):
    """Secure private WebSocket endpoint streaming ticks and order events to Node.js backend."""
    await websocket.accept()
    secret = cfg.internal_api_secret
    if not secret or token != secret:
        await websocket.close(code=4003, reason="Forbidden: invalid internal token")
        return

    if not userId.strip():
        await websocket.close(code=4000, reason="Missing userId")
        return

    client = session_manager.get_session(userId)
    if not client or not client.is_logged_in:
        await websocket.close(code=4001, reason="Broker session not active")
        return

    info = client.get_session_info()
    jwt_token = info.get("jwt_token")
    feed_token = info.get("feed_token")
    client_code = info.get("client_code")
    api_key = info.get("api_key")
    logger = logging.getLogger("uvicorn.error")
    logger.info(f"[FastAPI WS] Accepted internal socket for user: {userId}")

    loop = asyncio.get_running_loop()
    from app.services.websocket_manager import UserWebSocketConnection
    conn = UserWebSocketConnection(userId, websocket, loop)
    await conn.start(jwt_token, feed_token, client_code, api_key)

    try:
        while True:
            # Handle subscriptions from Node.js
            data = await websocket.receive_json()
            action = data.get("action")
            exchange_type = data.get("exchangeType")
            tokens = data.get("tokens")

            if not action or exchange_type is None or not isinstance(tokens, list):
                continue

            if action == "subscribe":
                conn.subscribe(int(exchange_type), tokens)
            elif action == "unsubscribe":
                conn.unsubscribe(int(exchange_type), tokens)

    except WebSocketDisconnect:
        logger.info(f"[FastAPI WS] Internal socket disconnected for user: {userId}")
    except Exception as e:
        logger.error(f"[FastAPI WS] Internal connection error for user {userId}: {e}")
    finally:
        await conn.stop()
