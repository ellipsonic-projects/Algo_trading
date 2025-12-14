from __future__ import annotations

from app.services.order_store import OrderStore


def test_order_store_add_and_list(tmp_path):
    db_path = tmp_path / "orders.sqlite"
    store = OrderStore(db_path=str(db_path))

    store.add(id="1", request={"a": 1}, response={"status": True})
    store.add(id="2", request={"b": 2}, response={"status": False})

    items = store.list(limit=10)
    ids = [i.id for i in items]
    assert "1" in ids
    assert "2" in ids
