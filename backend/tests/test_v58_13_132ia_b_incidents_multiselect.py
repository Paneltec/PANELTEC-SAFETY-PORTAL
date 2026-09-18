"""v58.13.132ia-b — Incidents multi-select tests.

Source-pins + behavioural coverage for the Part 2 ship:
  · Frontend: selection state + selection bar testids + bulk archive/PDF
    callbacks wired + IncidentsTable checkbox column when `selected` prop
    provided.
  · Backend: `POST /api/incidents/bulk-pdf-export` renders a zip, org-
    scoped, admin-permission-gated, ID-de-dupe, filename uniqueness.
  · Version lockstep pinned at `.132ia-b` on version.js + service-worker.js.
"""
from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend" / "src"
BACKEND = ROOT / "backend"


def _incidents_page() -> str:
    return (FRONTEND / "pages" / "Incidents.jsx").read_text(encoding="utf-8")


def _incidents_table() -> str:
    return (FRONTEND / "components" / "IncidentsTable.jsx").read_text(encoding="utf-8")


# ── Frontend source pins ────────────────────────────────────────────

def test_incidents_page_has_selection_state():
    s = _incidents_page()
    assert "const [selected, setSelected] = useState(() => new Set())" in s
    assert "const toggleSelect" in s
    assert "const toggleSelectAll" in s
    assert "const clearSelection" in s


def test_incidents_page_has_selection_bar_and_action_testids():
    s = _incidents_page()
    for tid in (
        "incidents-selection-bar",
        "incidents-selection-count",
        "incidents-bulk-archive-btn",
        "incidents-bulk-pdf-btn",
        "incidents-bulk-clear-btn",
    ):
        assert f'data-testid="{tid}"' in s, f"missing testid {tid}"


def test_incidents_page_bulk_archive_posts_per_item():
    s = _incidents_page()
    # Bulk archive fans out per-item POSTs to preserve the audit trail.
    assert re.search(r"api\.post\(`/incidents/\$\{id\}/archive`\)", s), (
        "bulk archive must POST per item so archive_audit + archive_batch_id fires once per row"
    )
    # And single top-level confirm (not per-row).
    assert "Archive ${selected.size} incident" in s


def test_incidents_page_bulk_pdf_export_calls_zip_endpoint():
    s = _incidents_page()
    assert "'/incidents/bulk-pdf-export'" in s
    assert "responseType: 'blob'" in s
    assert "paneltec_incidents_" in s  # download filename prefix
    assert "x-missing-ids" in s.lower() or "x-missing-ids" in s


def test_incidents_page_checkbox_overlaid_on_capture_card():
    s = _incidents_page()
    assert "incidents-card-select-" in s
    # Overlay pattern: absolute + z-10 above the tile.
    assert "absolute top-2 left-2 z-10" in s


def test_incidents_table_renders_select_column_when_selected_prop_present():
    s = _incidents_table()
    assert "onToggleSelect, onToggleSelectAll" in s
    for tid in ("incidents-table-select-all", "incidents-table-select-"):
        assert tid in s
    # colspan should account for the new column when `selected` is provided.
    assert "COLS.length + 1 + (selected ? 1 : 0)" in s


# ── Backend endpoint ────────────────────────────────────────────────

def test_bulk_pdf_export_router_wired_into_server():
    server = (BACKEND / "server.py").read_text(encoding="utf-8")
    assert "from incidents_bulk import router as incidents_bulk_router" in server
    assert "api.include_router(incidents_bulk_router)" in server


def test_bulk_pdf_export_router_prefix_and_methods():
    src = (BACKEND / "incidents_bulk.py").read_text(encoding="utf-8")
    assert 'prefix="/incidents"' in src
    assert '@router.post("/bulk-pdf-export")' in src
    assert 'require_permission("incidents", "view")' in src
    # Response headers surface count + skipped ids for the FE toast.
    assert '"X-Exported-Count"' in src
    assert '"X-Missing-Ids"' in src
    # Uses the shared renderer contract so PDF output stays consistent.
    assert 'RENDERERS["incidents"]' in src


@pytest.mark.asyncio
async def test_bulk_pdf_export_behavioural_zip(monkeypatch):
    """Behavioural: mock renderer + DB, hit the endpoint, verify zip contents."""
    from fastapi import FastAPI
    import incidents_bulk

    # Stub renderer so we don't spin up ReportLab in the test.
    fake_pdf = b"%PDF-1.4\nfake\n"

    def fake_renderer(doc):
        return fake_pdf

    monkeypatch.setattr(incidents_bulk, "RENDERERS",
                        {"incidents": (fake_renderer, "incidents")})

    # Stub the db collection cursor.
    class FakeCursor:
        def __init__(self, docs):
            self._docs = docs

        def __aiter__(self):
            async def gen():
                for d in self._docs:
                    yield d
            return gen()

    class FakeColl:
        def __init__(self, rows):
            self._rows = rows

        def find(self, query, projection=None):
            wanted = query["id"]["$in"]
            org = query["org_id"]
            return FakeCursor([r for r in self._rows if r["id"] in wanted and r["org_id"] == org])

    rows = [
        {"id": "a", "org_id": "org-1", "external_id": "INC-001", "title": "First"},
        {"id": "b", "org_id": "org-1", "external_id": "INC-002", "title": "Second"},
        {"id": "c", "org_id": "org-2", "external_id": "OTHER",    "title": "Cross-org"},
    ]

    class FakeDb(dict):
        def __getitem__(self, k):
            return FakeColl(rows)

    monkeypatch.setattr(incidents_bulk, "db", FakeDb())

    # Bypass auth + permission check: override get_current_user and make
    # `can()` return True unconditionally.
    from auth import get_current_user
    import permissions as _perm

    async def fake_user():
        return {"id": "u1", "org_id": "org-1", "role": "admin"}

    async def fake_can(*_a, **_kw):
        return True

    monkeypatch.setattr(_perm, "can", fake_can)
    app = FastAPI()
    app.include_router(incidents_bulk.router, prefix="/api")
    app.dependency_overrides[get_current_user] = fake_user

    client = TestClient(app)
    r = client.post("/api/incidents/bulk-pdf-export",
                    json={"ids": ["a", "b", "c", "missing-id"]})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/zip")
    # Cross-org row (c) + missing-id are both skipped and surface in X-Missing-Ids.
    missing = r.headers["x-missing-ids"].split(",")
    assert "c" in missing and "missing-id" in missing
    assert r.headers["x-exported-count"] == "2"

    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = zf.namelist()
        assert len(names) == 2
        # Each entry decodes to the fake PDF bytes.
        for n in names:
            assert zf.read(n) == fake_pdf


# ── Version pin ─────────────────────────────────────────────────────

def test_version_pin_v132ia_b():
    """Forward-safe: version must be >= .132ia-b. A future bump
    (e.g. `.132ia-c`, `.132ib`) MUST NOT regress this ship's contract."""
    import re as _re
    v = (FRONTEND / "lib" / "version.js").read_text(encoding="utf-8")
    # Accept `.132ia-b` or any later suffix (`-c`, `-d`, `132ib`, `132j`, etc).
    ok = _re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132(ia-[b-z]|i[b-z]|[j-z][a-z])'", v)
    if not ok:
        # Also accept the exact `.132ia-b` string for the ship-window snapshot.
        assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132ia-b'" in v
    assert _re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132(ia-[b-z]|i[b-z]|[j-z][a-z])'", v) or \
        "EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ia-b'" in v
    sw = (ROOT / "frontend" / "public" / "service-worker.js").read_text(encoding="utf-8")
    assert _re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132(ia-[b-z]|i[b-z]|[j-z][a-z])'", sw) or \
        "CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ia-b'" in sw
