"""v160.3.9.28.1 — Regression tests for the Phase 3b list-gate fix.

The Phase 3b brief required list GETs currently open to authenticated
users to narrow via `scope_filter`, not reject with 403. v28 shipped
`require_permission(...,"view")` deps on `/api/contractors` and
`/api/documents/folders/{id}/files` — both of which 403'd for workers
because `worker.contractors.view = worker.documents.view = False` in
ROLE_DEFAULTS.

v28.1 removed those deps and relies purely on `scope_filter` for
narrowing. These tests lock the fix in.
"""
from __future__ import annotations

import os

import requests


API = os.environ.get("VITE_BACKEND_URL") or os.environ.get(
    "REACT_APP_BACKEND_URL"
) or "http://localhost:8001"
API = API.rstrip("/") + "/api"


def _hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


def test_v28_1_contractors_list_worker_no_longer_403(tokens):
    """POST-v28.1: worker gets 200 (list of contractors), not 403."""
    r = requests.get(f"{API}/contractors", headers=_hdr(tokens["worker"]), timeout=10)
    assert r.status_code == 200, (
        f"GET /contractors as worker → HTTP {r.status_code} "
        f"(expected 200 after v28.1 regression fix). Body: {r.text[:200]}"
    )
    assert isinstance(r.json(), list)


def test_v28_1_contractors_list_admin_still_200(tokens):
    r = requests.get(f"{API}/contractors", headers=_hdr(tokens["admin"]), timeout=10)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_v28_1_contractors_list_unauthenticated_still_401():
    r = requests.get(f"{API}/contractors", timeout=10)
    assert r.status_code == 401, (
        f"unauth GET /contractors → HTTP {r.status_code} (expected 401)"
    )


def test_v28_1_contractors_writes_still_gated(tokens):
    """Regression control: v28.1 SKIP_PATHS + explicit route-level
    require_permission means writes must STILL 403 for workers."""
    r = requests.post(f"{API}/contractors", headers=_hdr(tokens["worker"]),
                      json={"name": "regression-probe"}, timeout=10)
    assert r.status_code == 403, (
        f"POST /contractors as worker → HTTP {r.status_code} "
        f"(expected 403 — writes gated by route-level require_permission)"
    )
    assert "contractors" in (r.json() or {}).get("detail", "")
