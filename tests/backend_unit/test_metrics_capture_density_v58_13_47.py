"""v58.13.47 — Capture-density telemetry backend contract.

Handler-level tests (mocked DB) — matches the pattern used by every
other file in `tests/backend_unit/` (see `test_bulk_link_v58_13_26.py`).
We deliberately avoid `starlette.testclient.TestClient` here because
Motor's asyncio driver creates its client on module-import and
TestClient spins up a new event loop per request → "got Future
attached to a different loop" for anything that touches the shared
`db` handle.

Live-endpoint smoke was verified via curl during the ship — anon
POST to `/api/metrics/capture-density` returns `{"ok": true}` with
http=200.

Placed under /app/tests/backend_unit/ per v58.13.10.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

_BACKEND = Path("/app/backend")
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

import metrics_routes  # noqa: E402
from metrics_routes import (  # noqa: E402
    CaptureDensityPing,
    capture_density_ping,
    ensure_indexes,
    _TTL_SECONDS,
    _COLLECTION,
)


def _fake_request(host: str = "10.0.0.1", ua: str = "pytest-ua"):
    """Minimal FastAPI Request shim — only the attributes the
    handler touches."""
    req = MagicMock()
    req.client = MagicMock()
    req.client.host = host
    req.headers = {"user-agent": ua}
    return req


def _install_fake_db(monkeypatch):
    """Replace `metrics_routes.db[<collection>]` with an AsyncMock
    so `insert_one`/`create_index` return awaitables. Returns the
    collection mock so callers can assert calls."""
    coll = MagicMock()
    coll.insert_one = AsyncMock(return_value=MagicMock(inserted_id="ok"))
    coll.create_index = AsyncMock(return_value="idx")

    class _DB:
        def __getitem__(self, name):
            assert name == _COLLECTION
            return coll

    monkeypatch.setattr(metrics_routes, "db", _DB())
    return coll


# ─── Basic write path ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_post_minimal_body_writes_row(monkeypatch):
    coll = _install_fake_db(monkeypatch)
    body = CaptureDensityPing.model_validate({
        "page": "cs-incidents", "mode": "compact",
    })
    result = await capture_density_ping(
        body=body, request=_fake_request(),
        x_session_id=None, user=None,
    )
    assert result == {"ok": True}
    coll.insert_one.assert_called_once()
    doc = coll.insert_one.call_args.args[0]
    assert doc["page"] == "cs-incidents"
    assert doc["mode"] == "compact"
    assert doc["user_id"] is None
    assert isinstance(doc["ts"], datetime), (
        "`ts` MUST be a BSON date, not an ISO string — TTL indexes "
        "only work on date types."
    )


@pytest.mark.asyncio
async def test_post_full_body_writes_row(monkeypatch):
    coll = _install_fake_db(monkeypatch)
    body = CaptureDensityPing.model_validate({
        "page": "pre-starts",
        "mode": "comfortable",
        "previous_mode": "auto",
        "effective_mode": "comfortable",
        "item_count": 9182,
        "ts": 1_700_000_000_000,
        "event": "setMode",
    })
    result = await capture_density_ping(
        body=body, request=_fake_request(),
        x_session_id="sess-42",
        user={"id": "u-1", "org_id": "o-1"},
    )
    assert result == {"ok": True}
    doc = coll.insert_one.call_args.args[0]
    assert doc["previous_mode"] == "auto"
    assert doc["effective_mode"] == "comfortable"
    assert doc["item_count"] == 9182
    assert doc["client_ts_ms"] == 1_700_000_000_000
    assert doc["session_id"] == "sess-42"
    assert doc["user_id"] == "u-1"
    assert doc["org_id"] == "o-1"


def test_pydantic_ignores_unknown_fields():
    """Contract: `extra="ignore"` drops junk silently."""
    body = CaptureDensityPing.model_validate({
        "page": "incidents",
        "mode": "spacious",
        "extra_junk": "should be dropped silently",
        "nested": {"also": "dropped"},
    })
    dumped = body.model_dump()
    assert "extra_junk" not in dumped
    assert "nested" not in dumped
    assert dumped["page"] == "incidents"
    assert dumped["mode"] == "spacious"


def test_pydantic_accepts_garbage_mode():
    """Analytics tolerates dirty data — `mode` is Optional[str],
    NO enum validation, so any value round-trips."""
    body = CaptureDensityPing.model_validate({
        "page": "hazards", "mode": "definitely-not-a-real-mode",
    })
    assert body.mode == "definitely-not-a-real-mode"


@pytest.mark.asyncio
async def test_handler_returns_ok_false_on_db_failure(monkeypatch):
    """Analytics NEVER throws. A DB blow-up returns
    `{ok: false, reason: 'insert-failed'}` with HTTP 200 (the route
    itself doesn't raise so FastAPI serializes normally)."""
    coll = MagicMock()
    coll.insert_one = AsyncMock(side_effect=RuntimeError("mongo down"))

    class _DB:
        def __getitem__(self, name):
            return coll

    monkeypatch.setattr(metrics_routes, "db", _DB())
    body = CaptureDensityPing.model_validate(
        {"page": "err", "mode": "compact"})
    result = await capture_density_ping(
        body=body, request=_fake_request(),
        x_session_id=None, user=None,
    )
    assert result == {"ok": False, "reason": "insert-failed"}


# ─── Index contract ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ensure_indexes_creates_ttl_and_compound(monkeypatch):
    coll = _install_fake_db(monkeypatch)
    await ensure_indexes()
    calls = coll.create_index.call_args_list
    # First call: TTL on `ts`.
    assert calls[0].args == ("ts",)
    assert calls[0].kwargs == {"expireAfterSeconds": _TTL_SECONDS}
    # Second call: compound (page ASC, ts DESC).
    assert calls[1].args == ([("page", 1), ("ts", -1)],)


def test_ttl_seconds_matches_30_days():
    """Sanity: the constant matches the docstring / user brief."""
    assert _TTL_SECONDS == 30 * 24 * 60 * 60
