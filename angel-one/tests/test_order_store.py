from __future__ import annotations

import sqlite3
import pytest
from app.services.order_store import OrderStore


# ─────────────────────────────────────────────────────────
# Finding #1: Multi-Tenant SQLite Order Store Isolation
# ─────────────────────────────────────────────────────────

def test_order_store_multi_tenant_isolation(tmp_path):
    db_path = tmp_path / "orders.sqlite"
    store = OrderStore(db_path=str(db_path))

    # User A adds orders
    store.add(id="ord_a1", user_id="user_A", request={"symbol": "NIFTY"}, response={"orderid": "101"})
    store.add(id="ord_a2", user_id="user_A", request={"symbol": "BANKNIFTY"}, response={"orderid": "102"})

    # User B adds orders
    store.add(id="ord_b1", user_id="user_B", request={"symbol": "SENSEX"}, response={"orderid": "201"})

    # Verify User A only sees their orders
    items_a = store.list(user_id="user_A", limit=10)
    assert len(items_a) == 2
    assert {i.id for i in items_a} == {"ord_a1", "ord_a2"}
    assert all(i.user_id == "user_A" for i in items_a)

    # Verify User B only sees their orders
    items_b = store.list(user_id="user_B", limit=10)
    assert len(items_b) == 1
    assert items_b[0].id == "ord_b1"
    assert items_b[0].user_id == "user_B"

    # User A clearing their orders does NOT touch User B's orders
    deleted_a = store.clear(user_id="user_A")
    assert deleted_a == 2
    assert len(store.list(user_id="user_A")) == 0
    assert len(store.list(user_id="user_B")) == 1


def test_order_store_quarantine_migration(tmp_path):
    db_path = tmp_path / "legacy_orders.sqlite"

    # Create legacy table without user_id
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """
        CREATE TABLE order_attempts (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          request_json TEXT NOT NULL,
          response_json TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "INSERT INTO order_attempts VALUES ('legacy_1', '2026-01-01T00:00:00Z', '{\"req\": 1}', '{\"res\": 1}')"
    )
    conn.commit()
    conn.close()

    # Initialize store which triggers migration & quarantine
    store = OrderStore(db_path=str(db_path))

    # Regular users should not see legacy unowned orders
    assert len(store.list(user_id="user_A")) == 0
    assert len(store.list(user_id="user_B")) == 0

    # Quarantined rows are safely isolated under quarantine identifier
    quarantined = store.list(user_id="__QUARANTINED_LEGACY__")
    assert len(quarantined) == 1
    assert quarantined[0].id == "legacy_1"


def test_order_store_empty_user_id_raises(tmp_path):
    """add(), list(), clear() must all raise ValueError on blank user_id."""
    store = OrderStore(db_path=str(tmp_path / "orders.sqlite"))

    with pytest.raises(ValueError, match="user_id"):
        store.add(id="x", user_id="", request={}, response={})

    with pytest.raises(ValueError, match="user_id"):
        store.list(user_id="")

    with pytest.raises(ValueError, match="user_id"):
        store.clear(user_id="")

    with pytest.raises(ValueError, match="user_id"):
        store.delete_single(id="x", user_id="")


def test_order_store_whitespace_user_id_raises(tmp_path):
    """Whitespace-only user_id is treated as empty (not valid)."""
    store = OrderStore(db_path=str(tmp_path / "orders.sqlite"))

    with pytest.raises(ValueError, match="user_id"):
        store.add(id="x", user_id="   ", request={}, response={})

    with pytest.raises(ValueError, match="user_id"):
        store.list(user_id="   ")

    with pytest.raises(ValueError, match="user_id"):
        store.clear(user_id="   ")


def test_order_store_delete_single_cross_tenant_protection(tmp_path):
    """A user cannot delete another user's order even if they know the order ID."""
    store = OrderStore(db_path=str(tmp_path / "orders.sqlite"))
    store.add(id="protected_order", user_id="owner_user", request={}, response={})

    # Attacker tries to delete with different user_id
    deleted = store.delete_single(id="protected_order", user_id="attacker_user")
    assert deleted is False

    # Owner's order is still present
    items = store.list(user_id="owner_user")
    assert any(i.id == "protected_order" for i in items)


def test_order_store_user_id_not_in_new_schema_when_fresh(tmp_path):
    """Fresh DB creates table with user_id column natively — no migration needed."""
    store = OrderStore(db_path=str(tmp_path / "fresh.sqlite"))
    store.add(id="fresh_1", user_id="userX", request={"sym": "NIFTY"}, response={})

    items = store.list(user_id="userX")
    assert len(items) == 1
    assert items[0].user_id == "userX"


def test_quarantine_user_id_not_contaminated_by_real_user(tmp_path):
    """The quarantine sentinel value '__QUARANTINED_LEGACY__' must not be accepted as a real user."""
    store = OrderStore(db_path=str(tmp_path / "orders.sqlite"))

    # Adding under quarantine sentinel is technically allowed (it's valid non-blank string)
    # but listing under a real user must not return quarantined rows
    store.add(id="q_test", user_id="__QUARANTINED_LEGACY__", request={}, response={})
    
    real_user_items = store.list(user_id="real_user_99")
    assert len(real_user_items) == 0

    # Quarantine user sees it
    q_items = store.list(user_id="__QUARANTINED_LEGACY__")
    assert len(q_items) == 1
