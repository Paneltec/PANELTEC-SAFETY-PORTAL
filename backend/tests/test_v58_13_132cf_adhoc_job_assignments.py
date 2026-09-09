"""v58.13.132cf — Ad-hoc Job Assignments overhaul · pytests.

Locks the .132cf contract for the Ad-hoc Job Assignments ship:
  · Page rename (title + sidebar label).
  · Backend picker sources from `users` filtered by 3 target role_ids,
    excluding `admin`.
  · Sydney TZ on `_today_iso()`.
  · Strict admin-only across create + parse-pdf + admin_list.
  · Assignment doc carries worker+assigner snapshot + preamble + pdf_id.
  · `parse-pdf` endpoint registered + 400 on non-PDF + 403 for non-admin.
  · FE: role-filter row (3 target role_ids + `all`), calendar Popover,
    ±day arrows, Today button, PDF dropzone with `pdf-file-input`,
    preamble textarea with `maxLength=500`, Worker header row, AI-parsed
    pills.
  · Version-sync forward-safe pin ≥ .132cf on all three constants.
"""
from __future__ import annotations
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"

MIN = "132cf"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Backend ────────────────────────────────────────────────────────

def test_backend_today_iso_uses_sydney_tz():
    src = _read(BACKEND / "mobile_daily_jobs.py")
    assert 'ZoneInfo("Australia/Sydney")' in src
    assert "def _today_iso()" in src
    assert "SYDNEY_TZ" in src


def test_backend_require_admin_is_strict():
    """Both routers must gate on role == 'admin' only (no manager/
    hseq_lead/owner/permissive gates)."""
    for f in ["mobile_daily_jobs.py", "mobile_daily_jobs_admin.py"]:
        src = _read(BACKEND / f)
        # No permissive set literal any more.
        assert '"admin", "manager", "hseq_lead"' not in src, f"permissive gate leaked in {f}"
        assert '"manager"' not in src, f"manager gate leaked in {f}"


def test_backend_picker_targets_users_by_role_id():
    src = _read(BACKEND / "mobile_daily_jobs_admin.py")
    assert "ADHOC_TARGET_ROLE_IDS" in src
    assert '"paneltec_civil"' in src
    assert '"viatec_traffic"' in src
    assert '"external_contractor"' in src
    assert "db.users.count_documents" in src, "picker must source from users, not workers"


def test_backend_create_snapshots_worker_and_assigner():
    src = _read(BACKEND / "mobile_daily_jobs.py")
    for f in ["worker_name", "worker_phone", "worker_role_id",
              "assigned_by_id", "assigned_by_name", "preamble",
              "pdf_id", "pdf_url", "date_local", "date_utc"]:
        assert f'"{f}"' in src, f"snapshot field {f!r} missing from create_daily_job"


def test_backend_parse_pdf_endpoint_present():
    src = _read(BACKEND / "mobile_daily_jobs.py")
    assert '@router.post("/mobile/daily-jobs/parse-pdf")' in src
    assert "async def parse_pdf" in src
    assert "_PDF_PARSE_CACHE" in src
    assert "PDF_SYSTEM" in src
    assert "AsyncIOMotorGridFSBucket" in src, "PDFs must be stored in GridFS (not on pod)"
    assert "job_pdfs" in src, "GridFS bucket name pin"
    assert 'MAX_PDF_BYTES' in src


def test_backend_pdf_download_endpoint_present():
    src = _read(BACKEND / "mobile_daily_jobs.py")
    assert '@router.get("/mobile/daily-jobs/pdf/{pdf_id}")' in src
    assert "StreamingResponse" in src


def test_backend_admin_list_reads_snapshot_fields():
    src = _read(BACKEND / "mobile_daily_jobs_admin.py")
    # New path returns docs directly (with snapshot fields already
    # present); the legacy JOIN path is retained only for pre-.132cf
    # rows that were written without the snapshot.
    assert 'if not d.get("worker_name")' in src, "legacy-row enrichment path missing"


# ── Frontend ──────────────────────────────────────────────────────

PAGE = FRONTEND / "src" / "pages" / "AdminAssignDailyJobs.jsx"


def test_frontend_title_renamed():
    src = _read(PAGE)
    assert "Ad-hoc Job Assignments" in src
    # Old runtime page title must be gone. Comments referencing the
    # historical name are permitted (git-log utility).
    body = "\n".join(l for l in src.splitlines() if not l.strip().startswith("//"))
    assert "Assign Daily Jobs" not in body, "runtime title must be renamed"


def test_sidebar_label_renamed():
    src = _read(FRONTEND / "src" / "components" / "layout" / "AppShell.jsx")
    assert "label: 'Ad-hoc Jobs'" in src
    assert "testid: 'nav-assign-daily-jobs'" in src  # kept


def test_frontend_role_filter_chips_are_three_roles_plus_all():
    src = _read(PAGE)
    # The chip renders `data-testid={`role-filter-${r}`}`, so check
    # the array of role keys is present + the template literal.
    assert "'paneltec_civil'" in src and "'viatec_traffic'" in src and "'external_contractor'" in src
    assert re.search(r"data-testid=\{`role-filter-\$\{r\}`\}", src)
    assert "'all'" in src
    # Legacy `foreman` chip must not appear as a runtime label.
    body = "\n".join(l for l in src.splitlines() if not l.strip().startswith("//"))
    assert "foreman" not in body.lower(), "legacy foreman chip must be dropped"


def test_frontend_shadcn_calendar_popover_wired():
    src = _read(PAGE)
    assert "from '@/components/ui/calendar'" in src
    assert "from '@/components/ui/popover'" in src
    assert 'data-testid="date-picker-btn"' in src
    assert 'data-testid="date-prev-btn"' in src
    assert 'data-testid="date-next-btn"' in src
    assert 'data-testid="date-today-btn"' in src


def test_frontend_sydney_today_helper():
    src = _read(PAGE)
    assert "sydneyTodayIso" in src
    assert "Australia/Sydney" in src


def test_frontend_pdf_dropzone_wired():
    src = _read(PAGE)
    assert 'data-testid="pdf-dropzone"' in src
    assert 'data-testid="pdf-file-input"' in src
    assert "/mobile/daily-jobs/parse-pdf" in src
    assert "handlePdfUpload" in src
    assert 'accept="application/pdf,.pdf"' in src


def test_frontend_preamble_textarea():
    src = _read(PAGE)
    assert 'data-testid="preamble-input"' in src
    assert "maxLength={500}" in src
    assert "You have been assigned the job attached. Please review before starting." in src


def test_frontend_worker_header_row_and_role_chip():
    src = _read(PAGE)
    assert 'data-testid="worker-row-header"' in src
    assert 'data-testid="worker-header-name"' in src
    assert 'data-testid="worker-header-role-chip"' in src
    # Per-row role chip in the list.
    assert re.search(r'data-testid=\{`worker-role-chip-\$\{w\.id\}`\}', src)


def test_frontend_ai_parsed_pills_present():
    src = _read(PAGE)
    assert re.search(r'data-testid=\{`ai-parsed-pill-\$\{field\}`\}', src)
    assert "prefilledFields" in src


# ── Version-sync ──────────────────────────────────────────────────

def test_three_way_version_sync_at_132cf():
    vjs = _read(FRONTEND / "src" / "lib" / "version.js")
    sw = _read(FRONTEND / "public" / "service-worker.js")

    def _tok(s, pattern):
        m = re.search(pattern, s, re.M)
        assert m, f"pattern not found: {pattern}"
        return m.group(1)

    run = _tok(vjs, r"^export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    exp = _tok(vjs, r"^export const EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    swv = _tok(sw,  r"^const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    assert run == exp == swv, f"version drift: run={run} exp={exp} sw={swv}"
    assert run >= MIN
