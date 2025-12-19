from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import httpx


SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"


@dataclass(frozen=True)
class IndexOptionContract:
    exchange: str
    underlying: str
    expiry: str  # ISO date (YYYY-MM-DD)
    strike: float
    lot_size: int
    option_type: str  # CE/PE
    tradingsymbol: str
    symboltoken: str


_MONTHS: Dict[str, int] = {
    "JAN": 1,
    "FEB": 2,
    "MAR": 3,
    "APR": 4,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AUG": 8,
    "SEP": 9,
    "OCT": 10,
    "NOV": 11,
    "DEC": 12,
}


def _parse_expiry_to_iso(value: str) -> Optional[str]:
    v = value.strip()
    if not v:
        return None

    # Many rows have: 26DEC2025
    if len(v) == 9 and v[:2].isdigit() and v[2:5].isalpha() and v[5:].isdigit():
        day = int(v[:2])
        mon = _MONTHS.get(v[2:5].upper())
        year = int(v[5:])
        if mon is None:
            return None
        try:
            return datetime(year, mon, day, tzinfo=timezone.utc).date().isoformat()
        except ValueError:
            return None

    # Sometimes expiry may already be ISO
    try:
        return datetime.fromisoformat(v).date().isoformat()
    except ValueError:
        return None


def _parse_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        if value.is_integer():
            return int(value)
        return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return int(float(s))
        except ValueError:
            return None
    return None


def _normalize_strike(value: float) -> float:
    # In OpenAPIScripMaster, strikes are sometimes scaled by 100 (e.g. 2450000 instead of 24500).
    # Keep it conservative: only scale down when value is clearly too large AND divisible by 100.
    v = float(value)
    for _ in range(2):
        if v >= 100000.0 and abs(v % 100.0) < 1e-9:
            v = v / 100.0
            continue
        break
    return v


def _parse_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _parse_option_type(symbol: str) -> Optional[str]:
    s = symbol.strip().upper()
    if s.endswith("CE"):
        return "CE"
    if s.endswith("PE"):
        return "PE"
    return None


def parse_index_option_contract(row: Dict[str, Any]) -> Optional[IndexOptionContract]:
    exchange = str(row.get("exch_seg") or "").strip().upper()
    if exchange not in {"NFO", "BFO"}:
        return None

    inst_type = str(row.get("instrumenttype") or "").strip().upper()
    # Index options
    if inst_type != "OPTIDX":
        return None

    underlying = str(row.get("name") or "").strip().upper()
    if underlying not in {"NIFTY", "BANKNIFTY", "SENSEX"}:
        return None

    tradingsymbol = str(row.get("symbol") or "").strip()
    if not tradingsymbol:
        return None

    symboltoken = str(row.get("token") or "").strip()
    if not symboltoken:
        return None

    expiry_raw = str(row.get("expiry") or "").strip()
    expiry = _parse_expiry_to_iso(expiry_raw)
    if expiry is None:
        return None

    strike = _parse_float(row.get("strike"))
    if strike is None:
        return None

    lot_size = _parse_int(row.get("lotsize"))
    if lot_size is None or lot_size <= 0:
        return None

    strike = _normalize_strike(strike)

    option_type = _parse_option_type(tradingsymbol)
    if option_type is None:
        return None

    return IndexOptionContract(
        exchange=exchange,
        underlying=underlying,
        expiry=expiry,
        strike=strike,
        lot_size=lot_size,
        option_type=option_type,
        tradingsymbol=tradingsymbol,
        symboltoken=symboltoken,
    )


def _dedupe_sorted(values: Iterable[Any]) -> List[Any]:
    seen = set()
    out: List[Any] = []
    for v in values:
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return sorted(out)


class InstrumentMasterCache:
    def __init__(
        self,
        *,
        url: str = SCRIP_MASTER_URL,
        ttl: timedelta = timedelta(hours=6),
        fetcher: Optional[Callable[[str], Sequence[Dict[str, Any]]]] = None,
    ) -> None:
        self._url = url
        self._ttl = ttl
        self._lock = Lock()
        self._fetched_at: Optional[datetime] = None
        self._contracts: List[IndexOptionContract] = []
        self._index_spot: Dict[str, Tuple[str, str]] = {}
        self._fetcher = fetcher

    def get_index_spot(self, *, underlying: str) -> Tuple[str, str]:
        self.refresh_if_needed()
        und = underlying.strip().upper()
        if und not in {"NIFTY", "BANKNIFTY", "SENSEX"}:
            raise RuntimeError("Unsupported underlying")
        spot = self._index_spot.get(und)
        if spot is None:
            raise RuntimeError("Index spot token not found in instrument master")
        return spot

    def _index_spot_score(self, *, underlying: str, tradingsymbol: str, name: str, instrumenttype: str) -> int:
        ts = tradingsymbol.strip().upper()
        nm = name.strip().upper()
        it = instrumenttype.strip().upper()

        s = 0
        if underlying in ts:
            s += 3
        if underlying in nm:
            s += 2
        if "INDEX" in it:
            s += 3
        if ts.endswith("-INDEX"):
            s += 4
        if "NIFTY" in ts and underlying == "NIFTY":
            s += 1
        return s

    def _is_fresh(self) -> bool:
        if self._fetched_at is None:
            return False
        return datetime.now(timezone.utc) - self._fetched_at < self._ttl

    def refresh_if_needed(self) -> None:
        with self._lock:
            if self._is_fresh():
                return

            rows = self._download_rows()
            contracts: List[IndexOptionContract] = []
            best_index: Dict[str, Tuple[int, str, str]] = {}
            for r in rows:
                c = parse_index_option_contract(r)
                if c is not None:
                    contracts.append(c)

                und = str(r.get("name") or "").strip().upper()
                if und not in {"NIFTY", "BANKNIFTY", "SENSEX"}:
                    continue

                exch = str(r.get("exch_seg") or "").strip().upper()
                # NIFTY/BANKNIFTY spot are on NSE, SENSEX spot is on BSE.
                if und == "SENSEX":
                    if exch != "BSE":
                        continue
                else:
                    if exch != "NSE":
                        continue

                tradingsymbol = str(r.get("symbol") or "").strip()
                symboltoken = str(r.get("token") or "").strip()
                if not tradingsymbol or not symboltoken:
                    continue

                inst_type = str(r.get("instrumenttype") or "").strip()
                score = self._index_spot_score(underlying=und, tradingsymbol=tradingsymbol, name=str(r.get("name") or ""), instrumenttype=inst_type)
                prev = best_index.get(und)
                if prev is None or score > prev[0]:
                    best_index[und] = (score, tradingsymbol, symboltoken)

            self._contracts = contracts
            self._index_spot = {k: (v[1], v[2]) for k, v in best_index.items()}
            self._fetched_at = datetime.now(timezone.utc)

    def _download_rows(self) -> Sequence[Dict[str, Any]]:
        if self._fetcher is not None:
            return self._fetcher(self._url)

        with httpx.Client(timeout=30.0) as client:
            res = client.get(self._url)
            res.raise_for_status()
            data = res.json()
            if not isinstance(data, list):
                raise RuntimeError("Unexpected scrip master format")
            return [x for x in data if isinstance(x, dict)]

    def get_index_options(
        self,
        *,
        exchange: str,
        underlying: str,
        expiry: Optional[str] = None,
    ) -> Tuple[List[str], List[float], List[IndexOptionContract]]:
        self.refresh_if_needed()

        ex = exchange.strip().upper()
        und = underlying.strip().upper()

        filtered = [c for c in self._contracts if c.exchange == ex and c.underlying == und]

        expiries = _dedupe_sorted(c.expiry for c in filtered)

        filtered_for_strikes = filtered
        if expiry is not None:
            filtered_for_strikes = [c for c in filtered if c.expiry == expiry]

        strikes = _dedupe_sorted(c.strike for c in filtered_for_strikes)

        return expiries, strikes, filtered
