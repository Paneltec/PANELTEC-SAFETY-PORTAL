"""v58.13.132hq — Editable worker-company dropdown + CRUD + backfill.

Extends the two-value `simpro_company_id` derived `company_label`
into an editable list keyed on a `worker_companies` collection.
Same shape as `.132gv`'s induction_types pattern.

Seeds `Paneltec`, `Viatec`, `Walker Designs` on startup for every
org that has workers. Backfills existing worker rows: Simpro
company_id "2" → Paneltec, "3" → Viatec, everything else →
default (Paneltec).

FE renders a multi-select company-chip filter in the Workers
toolbar.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
WC_PY = APP_ROOT / "backend" / "worker_companies.py"
WORKERS_PY = APP_ROOT / "backend" / "workers.py"
SERVER_PY = APP_ROOT / "backend" / "server.py"
WORKERS_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Workers.jsx"
VJS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login() -> dict:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=30,
    )
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ─────────────── Backend module wiring ───────────────


def test_worker_companies_module_pinned():
    src = _read(WC_PY)
    assert 'router = APIRouter(prefix="/worker-companies"' in src, (
        "prefix must NOT collide with /workers/{id} greedy match"
    )
    for op in ("list_companies", "create_company", "rename_company",
                "delete_company", "_seed_defaults", "get_default_company_for_org",
                "backfill_worker_company_ids_on_startup"):
        assert f"async def {op}" in src or f"def {op}" in src, f"missing: {op}"
    # Seed defaults matches user spec.
    assert 'DEFAULT_WORKER_COMPANIES = ["Paneltec", "Viatec", "Walker Designs"]' in src


def test_server_wires_router_and_backfill():
    src = _read(SERVER_PY)
    assert "worker_companies_router" in src
    assert "backfill_worker_company_ids_on_startup" in src


def test_worker_model_carries_company_fields():
    src = _read(WORKERS_PY)
    # WorkerPatch surface.
    assert "worker_company_id: Optional[str]" in src
    assert "worker_company_name: Optional[str]" in src
    # _serialise prefers explicit snapshot over Simpro-derived label.
    assert 'if doc.get("worker_company_name"):' in src


# ─────────────── Live: CRUD + seed ───────────────


def test_seed_defaults_present_live():
    h = _login()
    r = requests.get(f"{API}/worker-companies", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    names = {c["name"] for c in body.get("items", [])}
    assert {"Paneltec", "Viatec", "Walker Designs"} <= names, (
        f"missing seed defaults, got {names}"
    )


def test_all_workers_backfilled_live():
    """Post startup, no worker in the org may have a null
    `worker_company_name`. Simpro-2 rows → Paneltec, Simpro-3 →
    Viatec, other → default (Paneltec)."""
    h = _login()
    r = requests.get(f"{API}/workers?limit=500", headers=h, timeout=20)
    body = r.json()
    workers = body if isinstance(body, list) else body.get("items", [])
    missing = [w for w in workers if not w.get("worker_company_name")]
    assert not missing, (
        f"{len(missing)} workers missing worker_company_name after backfill: "
        f"{[w.get('first_name') for w in missing[:5]]}"
    )
    # Spot-check the Simpro-derived mapping preserved.
    for w in workers:
        sid = str(w.get("simpro_company_id") or "")
        wcn = w.get("worker_company_name")
        if sid == "2":
            assert wcn == "Paneltec", (
                f"Simpro-2 worker {w.get('first_name')!r} → {wcn!r} (expected Paneltec)"
            )
        elif sid == "3":
            assert wcn == "Viatec", (
                f"Simpro-3 worker {w.get('first_name')!r} → {wcn!r} (expected Viatec)"
            )


def test_crud_lifecycle_live():
    """Admin can create, rename, and soft-delete a company. Rename
    does NOT cascade to existing workers (snapshot semantics)."""
    h = _login()
    tag = uuid.uuid4().hex[:6].upper()
    name1 = f"TestCo-{tag}"
    name2 = f"RenamedCo-{tag}"
    # Create.
    r = requests.post(f"{API}/worker-companies", json={"name": name1},
                        headers=h, timeout=15)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    try:
        # Duplicate → 409.
        r2 = requests.post(f"{API}/worker-companies", json={"name": name1},
                            headers=h, timeout=15)
        assert r2.status_code == 409
        # Rename.
        r3 = requests.patch(f"{API}/worker-companies/{cid}",
                            json={"name": name2}, headers=h, timeout=15)
        assert r3.status_code == 200, r3.text
        assert r3.json()["name"] == name2
    finally:
        # Cleanup.
        r4 = requests.delete(f"{API}/worker-companies/{cid}", headers=h, timeout=15)
        assert r4.status_code == 204


def test_worker_patch_accepts_company_id_live():
    h = _login()
    # Grab any worker + first company.
    workers = requests.get(f"{API}/workers?limit=1", headers=h, timeout=15).json()
    workers = workers if isinstance(workers, list) else workers.get("items", [])
    if not workers:
        pytest.skip("no workers in tenant")
    wid = workers[0]["id"]
    orig_id = workers[0].get("worker_company_id")
    orig_name = workers[0].get("worker_company_name")
    companies = requests.get(f"{API}/worker-companies", headers=h, timeout=15).json()["items"]
    # Pick a company DIFFERENT from the worker's current one.
    target = next((c for c in companies if c["id"] != orig_id), companies[0])
    try:
        r = requests.patch(f"{API}/workers/{wid}", json={
            "worker_company_id": target["id"],
            "worker_company_name": target["name"],
        }, headers=h, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["worker_company_id"] == target["id"]
        assert body["worker_company_name"] == target["name"]
        assert body["company_label"] == target["name"]
    finally:
        # Restore.
        requests.patch(f"{API}/workers/{wid}", json={
            "worker_company_id": orig_id,
            "worker_company_name": orig_name,
        }, headers=h, timeout=15)


# ─────────────── FE toolbar ───────────────


def test_frontend_renders_company_filter_chips():
    src = _read(WORKERS_JSX)
    assert "data-testid=\"worker-company-filter\"" in src
    assert "GET /worker-companies" in src or "'/worker-companies'" in src
    assert "companyFilter" in src
    assert "worker-company-chip-" in src
    # Filter applied inside the memoised `filtered` list.
    assert "companyFilter.size > 0" in src


# ─────────────── Version lockstep ───────────────


def test_version_bumped_to_132hq():
    """v58.13.132hs — Forward-safe pin. Any ship at .132hq or later
    is acceptable so subsequent ships don't retroactively break
    this ship's version-lockstep guard."""
    js, sw = _read(VJS), _read(SW)
    # Anything from `.132hq` onward is fine — verify the file references
    # a `.132h` tail at or beyond the `q` sub-letter, OR any later
    # subletter (r, s, t, …).
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[q-z]", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[q-z]", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[q-z]", sw)
