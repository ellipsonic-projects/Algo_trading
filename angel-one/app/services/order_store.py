from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import sqlite3
from typing import Any, Dict, List


@dataclass(frozen=True)
class OrderAttempt:
    id: str
    user_id: str
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
            # Create table if not exists with user_id
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS order_attempts (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  request_json TEXT NOT NULL,
                  response_json TEXT NOT NULL
                )
                """
            )
            # Safe migration pipeline: Check if user_id column is missing in legacy schema
            cursor = conn.execute("PRAGMA table_info(order_attempts)")
            columns = [row["name"] for row in cursor.fetchall()]
            if "user_id" not in columns:
                conn.execute("ALTER TABLE order_attempts ADD COLUMN user_id TEXT")
                # Quarantine legacy unowned rows rather than arbitrarily assigning ownership
                conn.execute(
                    "UPDATE order_attempts SET user_id = '__QUARANTINED_LEGACY__' WHERE user_id IS NULL OR user_id = ''"
                )
            # Create composite index for tenant-scoped time-ordered lookups
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_order_attempts_user_created ON order_attempts (user_id, created_at DESC)"
            )

    def add(self, *, id: str, user_id: str, request: Dict[str, Any], response: Dict[str, Any]) -> OrderAttempt:
        if not user_id or not user_id.strip():
            raise ValueError("user_id is required for recording an order attempt")
        created_at = datetime.now(timezone.utc).isoformat()
        attempt = OrderAttempt(id=id, user_id=user_id.strip(), created_at=created_at, request=request, response=response)

        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO order_attempts (id, user_id, created_at, request_json, response_json) VALUES (?, ?, ?, ?, ?)",
                (attempt.id, attempt.user_id, attempt.created_at, json.dumps(attempt.request), json.dumps(attempt.response)),
            )

        return attempt

    def list(self, *, user_id: str, limit: int = 50) -> List[OrderAttempt]:
        if not user_id or not user_id.strip():
            raise ValueError("user_id is required for listing order attempts")
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, user_id, created_at, request_json, response_json FROM order_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
                (user_id.strip(), limit),
            ).fetchall()

        attempts: List[OrderAttempt] = []
        for r in rows:
            attempts.append(
                OrderAttempt(
                    id=str(r["id"]),
                    user_id=str(r["user_id"]),
                    created_at=str(r["created_at"]),
                    request=json.loads(str(r["request_json"])),
                    response=json.loads(str(r["response_json"])),
                )
            )
        return attempts

    def clear(self, *, user_id: str) -> int:
        if not user_id or not user_id.strip():
            raise ValueError("user_id is required for clearing order attempts")
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(1) AS c FROM order_attempts WHERE user_id = ?", (user_id.strip(),)).fetchone()
            count = int(row["c"]) if row is not None else 0
            conn.execute("DELETE FROM order_attempts WHERE user_id = ?", (user_id.strip(),))
        return count

    def delete_single(self, *, id: str, user_id: str) -> bool:
        if not user_id or not user_id.strip():
            raise ValueError("user_id is required for deleting an order attempt")
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM order_attempts WHERE id = ? AND user_id = ?", (id, user_id.strip()))
            return cursor.rowcount > 0

    @staticmethod
    def to_dict(attempt: OrderAttempt) -> Dict[str, Any]:
        return asdict(attempt)

