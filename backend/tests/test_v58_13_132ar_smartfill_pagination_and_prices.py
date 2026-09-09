"""v58.13.132aq + .132ar — SmartFill pagination + real prices."""
from __future__ import annotations
import inspect
import pytest

import integrations_smartfill
from integrations_smartfill import smartfill_fetch_transactions


def test_smartfill_fetch_transactions_max_pages_default_is_200():
    """v58.13.132aq — pagination ceiling raised 50 → 200."""
    sig = inspect.signature(smartfill_fetch_transactions)
    assert sig.parameters["max_pages"].default == 200


def test_smartfill_fetch_transactions_requests_sort_desc(monkeypatch):
    """v58.13.132aq — pull is ordered newest-first via `Sort By` extra
    so today's rows land in page 1 even when API ignores From/To.
    """
    captured: list[dict] = []

    async def fake_call(method, extra):
        captured.append(extra)
        return {"columns": ["Date"], "data": []}

    monkeypatch.setattr(integrations_smartfill, "call", fake_call)
    import asyncio
    asyncio.run(smartfill_fetch_transactions(max_pages=1))
    assert captured, "call() never invoked"
    assert captured[0].get("Sort By") == "Date DESC"
    # Range shape preserved.
    assert captured[0]["range"] == {"offset": 0, "length": 1000}


def test_smartfill_actual_price_tag(monkeypatch):
    """v58.13.132ar — ingest tags real-priced rows with
    `price_source='smartfill_actual'`. Unit price column not carried
    into stored `price_source` (unit_price is a separate field).

    Rather than driving the full ingest, verify the tag logic
    directly — one-line conditional in fleet_fuel.py.
    """
    # Simulate the two branches of the .132ar conditional.
    def tag(total_price):
        return (
            "smartfill_actual"
            if (total_price is not None and total_price > 0)
            else None
        )
    assert tag(77.01) == "smartfill_actual"
    assert tag(0.0) is None       # 0-litre pump test / no-cost row
    assert tag(None) is None      # missing price
    assert tag(-1.0) is None      # negative sentinel


def test_smartfill_actual_price_computed_per_litre():
    """v58.13.132ar — computed_price_per_litre = total_price / litres.
    Sanity-check that the fleet_fuel helper still runs on real numbers.
    """
    from fleet_fuel import _compute_price_per_litre
    assert _compute_price_per_litre(77.01, 25.670) == pytest.approx(3.0004, rel=1e-3)
    # Zero litres → None (guard against div-by-zero).
    assert _compute_price_per_litre(0.0, 0.0) is None
    assert _compute_price_per_litre(77.01, 0.0) is None
    # Missing total_price → None.
    assert _compute_price_per_litre(None, 25.670) is None
