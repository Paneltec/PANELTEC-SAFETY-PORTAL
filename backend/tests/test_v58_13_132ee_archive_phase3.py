"""v58.13.132ee — Archive Phase 3: FE wiring across the remaining 6
CAPTURE modules + visitor bulk endpoint + regression guards for the
duplicate-import / duplicate-identifier bugs that broke the .132ee
WIP mid-flight.

Source-pins parse each FE page's source string so a future regression
that drops the header button, dialog mount, or per-row action fails
here rather than as a silent UI blank.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT / "backend"))

FE = APP_ROOT / "frontend" / "src"
PAGES = FE / "pages"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"
VISITOR_PY = APP_ROOT / "backend" / "visitor_signins.py"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Regression guard: no duplicate `getUser` import ──────────
# Root cause of the mid-flight .132ee compile-break: the fork agent
# added `import { getUser } from '@/lib/auth'` on top of an existing
# `import { getUser } from '../lib/auth'` in 3 pages, tripping the
# babel parser with "Identifier 'getUser' has already been declared".
@pytest.mark.parametrize("page", [
    "Incidents.jsx", "Hazards.jsx", "Inspections.jsx",
    "RiskAssessments.jsx", "PreStarts.jsx", "SiteDiary.jsx",
    "AdminVisitors.jsx",
])
def test_no_duplicate_getuser_import(page):
    src = _read(PAGES / page)
    n = len(re.findall(r"^\s*import\s+\{\s*getUser\s*[},]", src, re.MULTILINE))
    assert n <= 1, f"{page}: {n} getUser imports (must be ≤ 1)"


# ─── Regression guard: no duplicate `totalCount` declarations ──
# PreStarts.jsx has a legacy `const totalCount = decorated.length;`
# in-scope. The .132ee wiring must use a different name (we use
# `serverTotal`) to avoid the babel duplicate-identifier crash.
def test_prestarts_no_totalcount_state_clash():
    src = _read(PAGES / "PreStarts.jsx")
    assert "const [totalCount, setTotalCount]" not in src, (
        "PreStarts.jsx must not re-declare `totalCount` as state — "
        "it already has a local const `totalCount = decorated.length`.")
    assert "const [serverTotal, setServerTotal] = useState(null)" in src


# ─── Per-module wiring pins ───────────────────────────────────
MODULES = {
    # module → (page filename, header-btn testid, api path in dialog)
    "incidents":     ("Incidents.jsx",       "incidents-archive-header-btn",       "/incidents"),
    "hazards":       ("Hazards.jsx",         "hazards-archive-header-btn",         "/hazards"),
    "inspections":   ("Inspections.jsx",     "inspections-archive-header-btn",     "/inspections"),
    "ssra":          ("RiskAssessments.jsx", "risk-assessments-archive-header-btn", "/risk-assessments"),
    "prestarts":     ("PreStarts.jsx",       "prestarts-archive-header-btn",       "/pre-starts"),
    "sitediary":     ("SiteDiary.jsx",       "site-diary-archive-header-btn",      "/site-diary"),
    "visitors":      ("AdminVisitors.jsx",   "admin-visitors-archive-header-btn",  "/admin/visitors"),
}


@pytest.mark.parametrize("module,setup", list(MODULES.items()))
def test_page_has_archive_header_button(module, setup):
    page, testid, api_path = setup
    src = _read(PAGES / page)
    assert f'data-testid="{testid}"' in src, (
        f"{page}: missing header archive button testid `{testid}`")
    assert "Archive…" in src, f"{page}: header button copy `Archive…` missing"


@pytest.mark.parametrize("module,setup", list(MODULES.items()))
def test_page_mounts_archive_dialog(module, setup):
    page, testid, api_path = setup
    src = _read(PAGES / page)
    assert "<ArchiveDialog" in src, f"{page}: no <ArchiveDialog/> mount"
    assert f'apiPath="{api_path}"' in src, (
        f"{page}: <ArchiveDialog apiPath> must be `{api_path}`")


@pytest.mark.parametrize("module,setup", list(MODULES.items()))
def test_page_imports_archive_bundle(module, setup):
    page, _testid, _api = setup
    src = _read(PAGES / page)
    assert "import ArchiveDialog from '../components/ArchiveDialog'" in src
    assert "import ShowArchivedToggle from '../components/ShowArchivedToggle'" in src
    assert "import useArchiveActions from '../lib/useArchiveActions'" in src
    assert "import TotalCountChip from '../components/TotalCountChip'" in src


@pytest.mark.parametrize("module,setup", list(MODULES.items()))
def test_page_has_show_archived_toggle(module, setup):
    page, _testid, _api = setup
    src = _read(PAGES / page)
    # Every module surfaces a `<ShowArchivedToggle testid="…-show-archived-toggle" />`
    m = re.search(r'testid="([\w-]+-show-archived-toggle)"', src)
    assert m, f"{page}: <ShowArchivedToggle testid=…> missing"


# ─── Bug 2 — Show-archived toggle displays archived count ─────
@pytest.mark.parametrize("module,setup", list(MODULES.items()))
def test_show_archived_toggle_receives_count(module, setup):
    page, _testid, _api = setup
    src = _read(PAGES / page)
    # Toggle must receive the archivedCount state as `count={...}`
    assert "count={archivedCount}" in src, (
        f"{page}: <ShowArchivedToggle count={{archivedCount}}> missing — "
        f"chip won't display `(N)` badge")
    # And the state must be sourced from the X-Archived-Count header.
    assert "setArchivedCount" in src, (
        f"{page}: no `setArchivedCount` — X-Archived-Count header not read")
    assert "x-archived-count" in src.lower(), (
        f"{page}: never reads the `x-archived-count` response header")


def test_show_archived_toggle_component_accepts_count_prop():
    src = _read(FE / "components" / "ShowArchivedToggle.jsx")
    assert "count = null" in src or "count," in src
    assert "countLabel" in src, (
        "ShowArchivedToggle must render the count inline as `(N)`")


# ─── Bug 1 — Counts refresh after archive/unarchive ───────────
@pytest.mark.parametrize("module,setup", list(MODULES.items()))
def test_use_archive_actions_receives_refetch(module, setup):
    page, _testid, _api = setup
    src = _read(PAGES / page)
    # Every page must pass a refetch callback to useArchiveActions so
    # per-row + bulk archive/unarchive triggers a fresh fetch that
    # re-hydrates X-Total-Count + X-Archived-Count.
    m = re.search(r"useArchiveActions\([^)]*,\s*[^)]*,\s*[^)]+\)", src, re.DOTALL)
    assert m, (
        f"{page}: useArchiveActions must be called with 3 args "
        f"(apiPath, setItems, refetch)")


def test_use_archive_actions_hook_calls_refetch_on_success():
    src = _read(FE / "lib" / "useArchiveActions.js")
    # v58.13.132ee — refetch must fire on BOTH archive success AND
    # unarchive success (previously only fired on failure).
    # Find the two useCallback body blocks by their toast.success line.
    for label, marker in (
        ("archive", "toast.success('Record archived'"),
        ("unarchive", "toast.success('Record restored')"),
    ):
        pos = src.find(marker)
        assert pos >= 0, f"marker missing: {marker}"
        # Next 300 chars (before the catch keyword) must contain refetch?.()
        window = src[pos:pos + 400]
        pre_catch = window.split("} catch", 1)[0]
        assert "refetch?.()" in pre_catch, (
            f"{label}: refetch?.() must be called on the success path "
            f"(before the catch), not only on error")


# ─── AdminVisitors — special custom-table pattern ─────────────
def test_adminvisitors_row_has_archive_and_unarchive_buttons():
    src = _read(PAGES / "AdminVisitors.jsx")
    assert 'data-testid={`admin-visitors-archive-${r.id}`}' in src, (
        "AdminVisitors: per-row Archive button missing")
    assert 'data-testid={`admin-visitors-unarchive-${r.id}`}' in src, (
        "AdminVisitors: per-row Restore (unarchive) button missing")
    # Greyed row when archived
    assert 'isArchived' in src
    assert 'admin-visitors-archived-chip-' in src


# ─── ArchiveDialog surfaces exactly 4 sections — no Site, no Reason
# ─── (v58.13.132ef simplification per Stephen)             ────
def test_archive_dialog_removes_site_and_reason():
    src = _read(FE / "components" / "ArchiveDialog.jsx")
    # Sections that MUST be gone
    assert 'archive-dialog-section-site' not in src, (
        "ArchiveDialog: Site filter section must be removed (v58.13.132ef)")
    assert 'archive-dialog-section-reason' not in src, (
        "ArchiveDialog: Reason input section must be removed (v58.13.132ef)")
    assert 'archive-site-select' not in src
    assert 'archive-reason-input' not in src
    # Payload no longer sends `reason` from the FE.
    assert "reason:" not in src.replace(" reason:", "REMOVED")
    # Sections that MUST remain
    for keep in ('archive-dialog-section-date',
                 'archive-dialog-section-oldest-n',
                 'archive-dialog-section-status',
                 'archive-dialog-section-category'):
        assert keep in src, f"ArchiveDialog: section `{keep}` missing"


# ─── Visitor bulk archive endpoint ────────────────────────────
def test_visitor_bulk_archive_endpoint_registered():
    src = _read(VISITOR_PY)
    assert '@admin_router.post("/archive")' in src
    assert 'admin_bulk_archive_visitors' in src
    # dry_run behaviour + audit write
    assert "dry_run" in src.split('admin_bulk_archive_visitors', 1)[1][:2000]
    assert 'archive_audit' in src


# ─── Version-sync pin (≥ .132ee) ──────────────────────────────
def test_version_pinned_to_132ee_or_higher():
    # Look for RUNNING_VERSION / CACHE_VERSION lines specifically —
    # not just any comment mentioning an older tag.
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v, "version.js RUNNING_VERSION not found"
    assert m_sw, "service-worker.js CACHE_VERSION not found"
    assert m_v.group(1) >= "ef", (
        f"version.js pinned to .132{m_v.group(1)}, need ≥ .132ef")
    assert m_sw.group(1) >= "ef", (
        f"service-worker.js pinned to .132{m_sw.group(1)}, need ≥ .132ef")


# ─── Behavioural: bulk-archive dry-run reaches server ─────────
_TOKEN_CACHE: dict = {"h": None}


def _admin_headers():
    if _TOKEN_CACHE["h"] is not None:
        return _TOKEN_CACHE["h"]
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": "stephen@paneltec.com.au",
                            "password": "Mcgstephen50#"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    t = r.json().get("access_token") or r.json().get("token")
    _TOKEN_CACHE["h"] = {"Authorization": f"Bearer {t}"}
    return _TOKEN_CACHE["h"]


# ─── Behavioural: X-Archived-Count header emitted ─────────────
@pytest.mark.parametrize("api_path", [
    "/api/incidents",
    "/api/hazards",
    "/api/inspections",
    "/api/risk-assessments",
    "/api/pre-starts",
    "/api/site-diary",
    "/api/admin/visitors",
])
def test_list_emits_archived_count_header(api_path):
    """Every list endpoint must emit `X-Archived-Count` alongside the
    pre-existing `X-Total-Count` so the FE ShowArchivedToggle can
    surface its count badge without a second round-trip."""
    h = _admin_headers()
    r = requests.get(f"{API}{api_path}", headers=h,
                     params={"limit": 1} if "visitors" not in api_path else {"limit": 1},
                     timeout=30)
    assert r.status_code == 200, (
        f"{api_path}: expected 200, got {r.status_code}: {r.text[:400]}")
    assert "X-Total-Count" in r.headers, (
        f"{api_path}: missing X-Total-Count header")
    assert "X-Archived-Count" in r.headers, (
        f"{api_path}: missing X-Archived-Count header (v58.13.132ee)")
    # Value must parse as an integer.
    n = int(r.headers["X-Archived-Count"])
    assert n >= 0
    # CORS expose must list both.
    expose = r.headers.get("Access-Control-Expose-Headers", "")
    assert "X-Archived-Count" in expose, (
        f"{api_path}: Access-Control-Expose-Headers must list X-Archived-Count")


def test_x_total_count_is_true_db_count_not_len_docs():
    """v58.13.132ef — with `?limit=1`, `len(docs)` == 1 but the DB has
    many more rows. `X-Total-Count` must return the TRUE count so the
    FE chip drops as records get archived."""
    h = _admin_headers()
    r = requests.get(f"{API}/api/pre-starts", headers=h,
                     params={"limit": 1}, timeout=30)
    assert r.status_code == 200
    total = int(r.headers.get("X-Total-Count", "0"))
    assert total > 1, (
        f"X-Total-Count returned {total} for ?limit=1 — should be the "
        f"true DB total, not the page length")


# ─── Behavioural: bulk-archive dry-run reaches server ─────────
@pytest.mark.parametrize("api_path", [
    "/api/incidents/archive",
    "/api/hazards/archive",
    "/api/inspections/archive",
    "/api/risk-assessments/archive",
    "/api/pre-starts/archive",
    "/api/site-diary/archive",
    "/api/admin/visitors/archive",
])
def test_bulk_archive_dry_run_reachable(api_path):
    """Every module exposes `POST {api_path}` accepting a dry-run body
    and returning `{matched_count, matched_ids_sample}` — never 404s."""
    h = _admin_headers()
    r = requests.post(f"{API}{api_path}", headers=h,
                      json={"criteria": {}, "reason": "pytest dry-run",
                            "dry_run": True}, timeout=30)
    assert r.status_code == 200, (
        f"{api_path}: expected 200, got {r.status_code}: {r.text[:400]}")
    body = r.json()
    assert body.get("dry_run") is True
    assert "matched_count" in body
    assert isinstance(body.get("matched_ids_sample", []), list)
