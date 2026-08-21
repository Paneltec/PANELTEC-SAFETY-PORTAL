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
