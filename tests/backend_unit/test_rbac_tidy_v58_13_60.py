"""v58.13.60 — RBAC tidy bundle (P2/P3 fixes).

Guards for the four safe fixes shipped in this bundle. P1 (the
`custom_precast_panel_employee` role + its 2 assigned users) was
DEFERRED per user choice (option C) — separate ship candidate.

Fixes verified here:
  1. Legacy-role backfill: 3 test users now carry `role_id` FK.
  2. Simpro sync bookkeeping: `app_state.simpro_position_role_sync`
     row exists and the sync endpoint updates it on every run.
  3. 6 test-artifact roles archived (`is_active=False`).
  4. Forward-safe version-sync (moved past .59).
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path


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


def _db():
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=5000)
    return c[os.environ.get("DB_NAME", "test_database")]


def _skip_no_db(fn):
    def wrapper():
        if not os.environ.get("MONGO_URL"):
            import pytest
            pytest.skip("MONGO_URL not set")
        try:
            asyncio.run(fn())
        except Exception as e:  # noqa: BLE001
            if 'ServerSelectionTimeoutError' in type(e).__name__:
                import pytest
                pytest.skip(f"DB unreachable — {e}")
            raise
    wrapper.__name__ = fn.__name__
    return wrapper


# ── 1. Legacy-role backfill ─────────────────────────────────────────


@_skip_no_db
async def test_no_active_user_lacks_role_id_fk():
    db = _db()
    n = await db.users.count_documents({
        "deleted_at": None, "is_archived": {"$ne": True},
        "role": {"$exists": True, "$ne": None},
        "$or": [{"role_id": None}, {"role_id": {"$exists": False}}],
    })
    assert n == 0, (
        f"{n} active users still have legacy `role` string but no "
        "`role_id` FK — v58.13.60 backfill regression"
    )


# ── 2. Simpro sync bookkeeping ──────────────────────────────────────


@_skip_no_db
async def test_simpro_bookkeeping_row_exists():
    db = _db()
    st = await db.app_state.find_one({"_id": "simpro_position_role_sync"})
    assert st is not None, (
        "app_state.simpro_position_role_sync row missing — "
        "v58.13.60 seed skipped or reverted"
    )
    # Structure check: the fields the endpoint will write must exist
    # (either populated post-run, or None-sentinelled from the seed).
    for k in ("last_run_at", "last_run_status",
              "last_run_created_count", "last_run_updated_count"):
        assert k in st, f"bookkeeping row missing key {k!r}"


def test_sync_endpoint_writes_bookkeeping_row():
    src = (_BACKEND / "roles_catalogue.py").read_text(encoding="utf-8")
    block = src.split("async def sync_roles_from_simpro_positions", 1)[1]
    # The write must live INSIDE the sync function body.
    assert '"simpro_position_role_sync"' in block[:4000], (
        "sync function does not update the bookkeeping row"
    )
    assert '"last_run_created_count"' in block[:4000]
    assert '"last_run_status"' in block[:4000]


# ── 3. Test-artifact roles archived ─────────────────────────────────


@_skip_no_db
async def test_test_artifact_roles_are_archived():
    import re as _re
    db = _db()
    async for r in db.roles.find(
        {"role_id": {"$regex": r"^custom_(cachebust|fallback_test)_"}},
        {"_id": 0, "role_id": 1, "is_active": 1, "archive_reason": 1},
    ):
        assert r.get("is_active") is False, (
            f"test-artifact role {r['role_id']!r} still active — "
            "v58.13.60 archive regression"
        )
        assert r.get("archive_reason"), (
            f"{r['role_id']!r} archived but no archive_reason recorded"
        )


@_skip_no_db
async def test_no_user_is_assigned_to_archived_test_artifact_role():
    """Sanity: our archive migration must not have severed any live
    role assignment. If this ever trips, roll the archive back."""
    db = _db()
    archived = []
    async for r in db.roles.find(
        {"role_id": {"$regex": r"^custom_(cachebust|fallback_test)_"},
         "is_active": False},
        {"_id": 0, "role_id": 1},
    ):
        archived.append(r["role_id"])
    for rid in archived:
        u = await db.users.count_documents({
            "role_id": rid, "deleted_at": None,
        })
        assert u == 0, (
            f"archived test-artifact role {rid!r} still has {u} live "
            "user assignments — RBAC would be broken for them"
        )


# ── 4. Version-sync (forward-safe) ──────────────────────────────────


def test_version_sync_moved_past_v58_13_59():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.59'" not in v_js
    assert "'paneltec-v160.3.9.58.13.59'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.59'" not in sw_js
    assert "v160.3.9.58.13.60" in v_js
