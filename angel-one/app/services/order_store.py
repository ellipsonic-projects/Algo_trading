from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import sqlite3
from typing import Any, Dict, List


@dataclass(frozen=True)
class OrderAttempt:
    id: str
    created_at: str
    request: Dict[str, Any]
    response: Dict[str, Any]


class OrderStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS order_attempts (
                  id TEXT PRIMARY KEY,
                  created_at TEXT NOT NULL,
                  request_json TEXT NOT NULL,
                  response_json TEXT NOT NULL
                )
                """
            )

    def add(self, *, id: str, request: Dict[str, Any], response: Dict[str, Any]) -> OrderAttempt:
        created_at = datetime.now(timezone.utc).isoformat()
        attempt = OrderAttempt(id=id, created_at=created_at, request=request, response=response)

        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO order_attempts (id, created_at, request_json, response_json) VALUES (?, ?, ?, ?)",
                (attempt.id, attempt.created_at, json.dumps(attempt.request), json.dumps(attempt.response)),
            )

        return attempt

    def list(self, *, limit: int = 50) -> List[OrderAttempt]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, created_at, request_json, response_json FROM order_attempts ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()

        attempts: List[OrderAttempt] = []
        for r in rows:
            attempts.append(
                OrderAttempt(
                    id=str(r["id"]),
                    created_at=str(r["created_at"]),
                    request=json.loads(str(r["request_json"])),
                    response=json.loads(str(r["response_json"])),
                )
            )
        return attempts

    def clear(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(1) AS c FROM order_attempts").fetchone()
            count = int(row["c"]) if row is not None else 0
            conn.execute("DELETE FROM order_attempts")
        return count

    @staticmethod
    def to_dict(attempt: OrderAttempt) -> Dict[str, Any]:
        return asdict(attempt)
