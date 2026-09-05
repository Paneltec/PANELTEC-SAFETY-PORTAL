"""Shared conftest for `/app/tests/backend_unit/`.

These tests import backend modules directly (pure schema / helper
validation). They live OUTSIDE `/app/backend/` on purpose so any new
test file we add cannot retrigger `uvicorn --reload-dir /app/backend`
and orphan long-running background tasks (see the v58.13.10 postmortem
in `frontend/src/lib/version.js`).

Setup:
    · Prepend `/app/backend` to `sys.path` so `import asset_service`
      resolves.
    · Load `/app/backend/.env` so `db.py` can read `MONGO_URL` on
      import (backend modules import `db` transitively).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND = Path("/app/backend")
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

# Load /app/backend/.env before any backend module is imported.
_env_path = _BACKEND / ".env"
if _env_path.exists():
    for line in _env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), v)


# ── v58.13.125 — session-scoped TEST-v58.* pollution sweep ──────────
import pytest


@pytest.fixture(scope="session", autouse=True)
def _sweep_test_pollution_at_session_end():
    """Belt-and-braces guarantee that no TEST-v58.* asset survives a
    pytest session, regardless of which fixture created it or which
    test errored before the yield-teardown could run. Best-effort —
    failures here must not tank the summary."""
    yield  # tests run here
    try:
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _sweep():
            url = os.environ.get("MONGO_URL")
            dbn = os.environ.get("DB_NAME")
            if not url or not dbn:
                return
            c = AsyncIOMotorClient(url)
            d = c[dbn]
            q = {"name": {"$regex": r"^TEST-v58\.", "$options": "i"}}
            ids = [a["id"] async for a in d.assets.find(q, {"_id": 0, "id": 1})]
            if not ids:
                c.close()
                return
            n_sched = (await d.asset_service_schedules.delete_many(
                {"asset_id": {"$in": ids}})).deleted_count
            n_asset = (await d.assets.delete_many({"id": {"$in": ids}})).deleted_count
            print(
                f"\n[conftest.v125] session-end sweep: purged {n_asset} "
                f"TEST-v58.* assets + {n_sched} cascaded schedules",
                file=sys.stderr,
            )
            c.close()

        asyncio.run(_sweep())
    except Exception as e:  # pragma: no cover — best-effort
        print(f"[conftest.v125] session-end sweep failed (non-fatal): {e}",
              file=sys.stderr)
