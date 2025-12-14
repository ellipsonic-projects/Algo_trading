from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.core.config import load_config
from app.services.angel_client import AngelClient
from app.services.instrument_master import InstrumentMasterCache
from app.services.order_store import OrderStore


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


app = FastAPI(title="Angel One Trading Backend", version="0.1.0")

cfg = load_config(dotenv_path=str(BASE_DIR / ".env"))
app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

angel = AngelClient(
    api_key=cfg.angel.api_key,
    client_code=cfg.angel.client_code,
    password=cfg.angel.mpin,
    totp_secret=cfg.angel.totp_secret,
)

store = OrderStore(db_path=str(BASE_DIR / "orders.sqlite"))
instruments = InstrumentMasterCache()


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True}


@app.post("/angel/login")
def angel_login() -> Dict[str, Any]:
    try:
        return angel.login()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/angel/profile")
def angel_profile() -> Dict[str, Any]:
    try:
        return angel.get_profile()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/angel/search")
def angel_search(query: str, exchange: str = "NSE") -> Dict[str, Any]:
    try:
        return angel.search(exchange=exchange, query=query)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "Not logged in" in msg:
            raise HTTPException(status_code=401, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@app.get("/instruments/index-options")
def index_options(
    exchange: str,
    underlying: str,
    expiry: Optional[str] = None,
    strike: Optional[float] = None,
    option_type: Optional[str] = None,
) -> Dict[str, Any]:
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
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/market/index-ltp")
def index_ltp(underlying: str) -> Dict[str, Any]:
    try:
        tradingsymbol, symboltoken = instruments.get_index_spot(underlying=underlying)
        return angel.get_ltp(exchange="NSE", tradingsymbol=tradingsymbol, symboltoken=symboltoken)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "Not logged in" in msg:
            raise HTTPException(status_code=401, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@app.get("/angel/orders")
def list_orders(limit: int = 50) -> Dict[str, Any]:
    attempts = store.list(limit=limit)
    return {"items": [store.to_dict(a) for a in attempts]}


@app.delete("/angel/orders")
def clear_orders() -> Dict[str, Any]:
    deleted = store.clear()
    return {"deleted": deleted}


@app.post("/angel/logout")
def angel_logout() -> Dict[str, Any]:
    try:
        return angel.logout()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/angel/orders")
def place_order(req: PlaceOrderRequest) -> Dict[str, Any]:
    attempt_id = str(uuid4())
    try:
        response = angel.place_order(req.payload)
    except Exception as e:  # noqa: BLE001
        response = {"status": False, "error": str(e)}

    attempt = store.add(id=attempt_id, request=req.payload, response=response)
    return {"item": store.to_dict(attempt)}


@app.post("/angel/orders/simple")
def place_simple_order(req: SimpleOrderRequest) -> Dict[str, Any]:
    attempt_id = str(uuid4())

    producttype = req.producttype
    ex = req.exchange.strip().upper()
    if ex in {"NFO", "BFO"}:
        # Derivatives do not accept DELIVERY. Use carryforward for positional trades.
        if producttype == "DELIVERY":
            producttype = "CARRYFORWARD"

    payload: Dict[str, Any] = {
        "variety": "NORMAL",
        "tradingsymbol": req.tradingsymbol,
        "symboltoken": req.symboltoken,
        "transactiontype": req.transactiontype,
        "exchange": req.exchange,
        "ordertype": "MARKET",
        "producttype": producttype,
        "duration": "DAY",
        "price": "0",
        "squareoff": "0",
        "stoploss": "0",
        "quantity": str(req.quantity),
    }

    try:
        response = angel.place_order(payload)
    except Exception as e:  # noqa: BLE001
        response = {"status": False, "error": str(e)}

    attempt = store.add(id=attempt_id, request=payload, response=response)
    return {"item": store.to_dict(attempt)}
