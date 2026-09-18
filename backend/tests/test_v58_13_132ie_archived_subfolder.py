"""v58.13.132ie — Archived subfolder on worker cert-family tabs.

Source pins + behavioural tests for:
  · Backend `list_certs` auto-archive sweep (idempotent update_many on
    fetch when `expiry_date < today` AND `archived_at IS NULL`).
  · Backend archive/restore endpoints under
    `/workers/certifications/{cert_id}/(archive|restore)`.
  · Frontend shared helpers (splitByArchived, useArchivedOpen,
    archiveCert, restoreCert).
  · 3 cert-family panels (CertificationsPanel in Workers.jsx,
    LicencesPanel, InductionsPanel) wire the split + archive UI.
  · Version lockstep .132ie.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def _r(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Backend source pins ─────────────────────────────────────────────

def test_backend_worker_certifications_has_auto_archive_sweep():
    src = _r(BACKEND / "worker_certifications.py")
    # Auto-archive block inside list_certs.
    assert 'await db.worker_certifications.update_many(' in src
    assert '"archived_at": None,' in src
    assert '"expiry_date": {"$lt": today_iso, "$ne": None},' in src
    assert '"archived_reason": "auto_expired"' in src


def test_backend_archive_and_restore_endpoints_present():
    src = _r(BACKEND / "worker_certifications.py")
    assert '@router.post("/certifications/{cert_id}/archive")' in src
    assert '@router.post("/certifications/{cert_id}/restore")' in src
    # Both routes call the same scope-gate helper.
    assert 'async def _archive_gate(' in src
    # Restore clears archived_at back to None.
    assert '"archived_at": None, "archived_reason": None,' in src
    # Both routes hit the permissions matrix.
    assert 'require_permission("certifications", "edit")' in src


# ── Frontend source pins ────────────────────────────────────────────

def test_shared_archive_helpers_exported():
    src = _r(FRONTEND / "src" / "lib" / "certArchiveHelpers.js")
    for name in ("splitByArchived", "useArchivedOpen", "archiveCert", "restoreCert"):
        assert f"export function {name}" in src or f"export async function {name}" in src, name
    # LocalStorage key uses per-panel + per-worker scope.
    assert "`paneltec:archive:open:${panel}:${workerId}`" in src


def test_licences_panel_has_archived_split_and_action_testids():
    src = _r(FRONTEND / "src" / "components" / "workers" / "LicencesPanel.jsx")
    assert "splitByArchived" in src
    assert "useArchivedOpen" in src
    # Section-level testids for the archived accordion.
    for tid in (
        "section-licences-archived",
        "section-licences-archived-toggle",
        "section-licences-archived-body",
    ):
        assert tid in src, f"missing {tid}"
    # Per-row testid prefixes.
    assert "licence-archive-" in src
    assert "licence-restore-" in src


def test_inductions_panel_has_archived_split_and_action_testids():
    src = _r(FRONTEND / "src" / "components" / "workers" / "InductionsPanel.jsx")
    assert "splitByArchived" in src
    assert "useArchivedOpen" in src
    for tid in (
        "section-inductions-archived",
        "section-inductions-archived-toggle",
        "section-inductions-archived-body",
    ):
        assert tid in src, f"missing {tid}"
    assert "induction-archive-" in src
    assert "induction-restore-" in src


def test_certifications_panel_in_workers_page_has_archived_accordion():
    src = _r(FRONTEND / "src" / "pages" / "Workers.jsx")
    # Import + hook wired.
    assert "useArchivedOpen('certifications', workerId)" in src
    # Section testids.
    for tid in (
        "section-certifications-archived",
        "section-certifications-archived-toggle",
        "section-certifications-archived-body",
    ):
        assert tid in src, f"missing {tid}"
    # Per-row archive + restore testid prefixes.
    assert "cert-archive-" in src
    assert "cert-restore-" in src
    # Active-only filter on the main table.
    assert "rows.filter((c) => !c.archived_at)" in src


# ── Behavioural: archive + restore + auto-archive round-trip ───────

@pytest.mark.asyncio
async def test_archive_restore_and_auto_archive_roundtrip(monkeypatch):
    """Seed 4 certs (fresh / expired-unarchived / expired-already-
    archived / archived-manually). Hit GET → assert the expired-
    unarchived row got auto-archived. Hit archive on the fresh row →
    it moves. Hit restore on any archived row → it flips back."""
    import worker_certifications as wc

    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    next_month = (date.today() + timedelta(days=30)).isoformat()

    # Seed store.
    docs = {
        "fresh": {
            "id": "fresh", "org_id": "org-1", "worker_id": "wk-1",
            "name": "Fresh cert", "expiry_date": next_month,
            "archived_at": None, "deleted_at": None, "issuer": "",
        },
        "expired_unarchived": {
            "id": "expired_unarchived", "org_id": "org-1", "worker_id": "wk-1",
            "name": "Expired unarchived", "expiry_date": yesterday,
            "archived_at": None, "deleted_at": None, "issuer": "",
        },
        "expired_already_archived": {
            "id": "expired_already_archived", "org_id": "org-1", "worker_id": "wk-1",
            "name": "Old archived", "expiry_date": yesterday,
            "archived_at": "2025-01-01T00:00:00Z",
            "archived_reason": "auto_expired",
            "deleted_at": None, "issuer": "",
        },
        "manual_archived": {
            "id": "manual_archived", "org_id": "org-1", "worker_id": "wk-1",
            "name": "Manually archived", "expiry_date": next_month,
            "archived_at": "2026-02-01T00:00:00Z",
            "archived_reason": "manual",
            "deleted_at": None, "issuer": "",
        },
    }
    worker_doc = {"id": "wk-1", "org_id": "org-1", "deleted_at": None,
                  "company_id": None, "user_id": None, "email": None}

    class FakeCursor:
        def __init__(self, matched):
            self._m = matched

        def sort(self, *_a, **_kw):
            return self

        async def to_list(self, _n):
            return list(self._m)

        def __aiter__(self):
            async def gen():
                for r in self._m:
                    yield r
            return gen()

    def _match(doc, flt):
        for k, v in flt.items():
            if k == "$or":
                if not any(_match(doc, sub) for sub in v):
                    return False
                continue
            if isinstance(v, dict):
                # {"$lt": x, "$ne": y} / {"$ne": z}
                dv = doc.get(k)
                if "$lt" in v and not (dv is not None and dv < v["$lt"]):
                    return False
                if "$ne" in v and dv == v["$ne"]:
                    return False
                if "$in" in v and dv not in v["$in"]:
                    return False
                continue
            if doc.get(k) != v:
                return False
        return True

    class FakeCertsColl:
        def find(self, flt, projection=None):
            return FakeCursor([d for d in docs.values() if _match(d, flt)])

        async def find_one(self, flt, projection=None):
            for d in docs.values():
                if _match(d, flt):
                    return dict(d)
            return None

        async def update_many(self, flt, update):
            hit = 0
            for d in docs.values():
                if _match(d, flt):
                    d.update(update.get("$set", {}))
                    hit += 1
            return type("R", (), {"modified_count": hit})()

        async def update_one(self, flt, update):
            for d in docs.values():
                if _match(d, flt):
                    d.update(update.get("$set", {}))
                    return
            return None

    class FakeWorkersColl:
        async def find_one(self, flt, projection=None):
            if flt.get("id") == "wk-1" and flt.get("org_id") == "org-1":
                return dict(worker_doc)
            return None

    class FakeDb:
        worker_certifications = FakeCertsColl()
        workers = FakeWorkersColl()

    monkeypatch.setattr(wc, "db", FakeDb())

    # Bypass auth + permission gate + module gate.
    from auth import get_current_user
    import permissions as _perm

    async def fake_user():
        return {"id": "u1", "org_id": "org-1", "role": "admin",
                "email": "admin@example.com"}

    async def fake_user_from_req(request, creds=None):
        return {"id": "u1", "org_id": "org-1", "role": "admin",
                "email": "admin@example.com"}

    async def fake_can(*_a, **_kw):
        return True

    monkeypatch.setattr(_perm, "can", fake_can)
    # require_module invokes `get_current_user(request, creds=None)`
    # directly (not via Depends) — monkeypatch it at both surfaces.
    monkeypatch.setattr(_perm, "get_current_user", fake_user_from_req)
    import auth as _auth
    monkeypatch.setattr(_auth, "get_current_user", fake_user_from_req)
    monkeypatch.setattr(_perm, "is_mobile_client", lambda *a, **kw: False)
    # Scope helper is a plain call; stub to no-op.
    import permissions_scope
    monkeypatch.setattr(permissions_scope, "require_scoped_access",
                        lambda *a, **kw: None)

    app = FastAPI()
    # Router already has prefix="/workers"; mount under /api.
    app.include_router(wc.router, prefix="/api")
    app.dependency_overrides[get_current_user] = fake_user
    client = TestClient(app)

    # 1) Hit list → the on-fetch sweep should auto-archive the
    #    "expired_unarchived" row. Total returned is still 4 (deleted
    #    rows would be filtered out, but archived rows are surfaced).
    r = client.get("/api/workers/wk-1/certifications")
    assert r.status_code == 200, r.text
    ids = [row["id"] for row in r.json()]
    assert set(ids) == {"fresh", "expired_unarchived",
                        "expired_already_archived", "manual_archived"}
    # Expired-unarchived is now archived.
    assert docs["expired_unarchived"]["archived_at"] is not None
    assert docs["expired_unarchived"]["archived_reason"] == "auto_expired"
    # Fresh row untouched.
    assert docs["fresh"]["archived_at"] is None

    # 2) Manual archive on the fresh row.
    r = client.post("/api/workers/certifications/fresh/archive")
    assert r.status_code == 200, r.text
    assert docs["fresh"]["archived_at"] is not None
    assert docs["fresh"]["archived_reason"] == "manual"

    # 3) Restore the manually-archived row.
    r = client.post("/api/workers/certifications/manual_archived/restore")
    assert r.status_code == 200, r.text
    assert docs["manual_archived"]["archived_at"] is None
    assert docs["manual_archived"]["archived_reason"] is None


# ── Version pin ─────────────────────────────────────────────────────

def test_version_pin_v132ie():
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132ie'" in v
    assert "EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ie'" in v
    sw = _r(FRONTEND / "public" / "service-worker.js")
    assert "CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ie'" in sw
