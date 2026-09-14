"""v58.13.132gd — Platform manual follow-ups.

Covers:
  · GET /api/docs/manual.docx — admin-only, PIN-gated, streams
    the current `docs/paneltec_group_platform_manual.docx`.
  · Source pins for regenerate_manual.py (openapi collector,
    permission matrix subprocess, archive_lifecycle diagram).
  · scripts/check_manual_drift.py — parses the manual anchor and
    exits 0 when in tolerance, 2 when drifted.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BE = APP_ROOT / "backend"
FRONTEND = APP_ROOT / "frontend"
SCRIPTS = APP_ROOT / "scripts"
DOCS = APP_ROOT / "docs"

MANUAL_DOCX = DOCS / "paneltec_group_platform_manual.docx"
MANUAL_MD = DOCS / "paneltec_group_platform_manual.md"
REGEN = SCRIPTS / "regenerate_manual.py"
DRIFT = SCRIPTS / "check_manual_drift.py"
DOCS_MANUAL_PY = BE / "docs_manual.py"
MY_PROFILE_FE = FRONTEND / "src" / "pages" / "MyProfile.jsx"
VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW = FRONTEND / "public" / "service-worker.js"

ADMIN_PIN = "3310"  # standing rule — see memory/test_credentials.md


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login() -> dict:
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ─── Source pins ───────────────────────────────────────────────

def test_docs_manual_endpoint_registered():
    server = _read(BE / "server.py")
    assert "from docs_manual import router as docs_manual_router" in server
    assert "api.include_router(docs_manual_router)" in server


def test_docs_manual_module_pin_gate_and_streaming():
    src = _read(DOCS_MANUAL_PY)
    # Admin gate + PIN header signature.
    assert 'if (user or {}).get("role") != "admin":' in src
    assert 'x_admin_console_pin: str = Header(default="")' in src
    # Reuses the shared lockout dance.
    assert "_check_lockout(user[\"id\"])" in src
    assert "_record_failure(user[\"id\"])" in src
    assert "_reset_attempts(user[\"id\"])" in src
    # Response shape.
    assert "FileResponse" in src
    assert "paneltec_group_platform_manual.docx" in src


def test_regenerate_manual_carries_openapi_and_matrix_and_lifecycle():
    src = _read(REGEN)
    # OpenAPI collector fetches with auth + WAF-safe UA.
    assert "def collect_openapi(" in src
    assert "auth/login" in src
    assert "User-Agent" in src
    # Permission matrix subprocess.
    assert "def collect_permission_matrix(" in src
    assert "subprocess.check_output" in src
    assert 'sys.path.insert(0, r' in src
    # Archive lifecycle diagram spec.
    assert '"slug": "archive_lifecycle"' in src


def test_frontend_download_manual_card_present():
    src = _read(MY_PROFILE_FE)
    assert "function ManualDownloadCard(" in src
    assert 'data-testid="profile-manual-card"' in src
    assert 'data-testid="profile-manual-download-open"' in src
    assert 'data-testid="profile-manual-pin-modal"' in src
    # PinField receives the testId prop; the rendered <input> has
    # data-testid={testId} — so the string is the prop value here.
    assert 'testId="profile-manual-pin-input"' in src
    assert 'data-testid="profile-manual-pin-submit"' in src
    # PIN goes through the admin-console-pin header.
    assert "'X-Admin-Console-Pin': pin" in src
    # Endpoint used.
    assert "/docs/manual.docx" in src


def test_check_manual_drift_present():
    src = _read(DRIFT)
    assert "TOLERANCE" in src
    assert "def _parse_manual_counts(" in src
    assert "if drift_flag:" in src


def test_manual_artefacts_exist_and_include_lifecycle():
    assert MANUAL_MD.exists(), "regenerate the manual first"
    assert MANUAL_DOCX.exists(), "regenerate the manual first"
    assert (DOCS / "diagrams" / "archive_lifecycle.png").exists()
    md = _read(MANUAL_MD)
    assert "diagrams/archive_lifecycle.png" in md
    assert "Appendix F · Role × resource permission matrix" in md
    # openapi.json anchor line landed.
    assert "`/api/openapi.json`" in md


# ─── Behavioural: endpoint round-trip ─────────────────────────

def test_download_manual_requires_admin_pin_header():
    h = _login()
    r = requests.get(f"{API}/docs/manual.docx", headers=h, timeout=30)
    assert r.status_code == 401, r.text
    assert "X-Admin-Console-Pin" in r.text


def test_download_manual_wrong_pin_rejected():
    """We do NOT issue wrong-PIN attempts against Stephen's account
    (standing rule). Instead, we assert the source pin that ensures
    the failure path is wired to `_record_failure` — verified in
    `test_docs_manual_module_pin_gate_and_streaming`."""
    pytest.skip("Stephen guard — negative path covered by source pins.")


def test_download_manual_streams_bytes_with_correct_headers():
    if not MANUAL_DOCX.exists():
        pytest.skip("manual not generated in this environment")
    h = _login()
    r = requests.get(
        f"{API}/docs/manual.docx",
        headers={**h, "X-Admin-Console-Pin": ADMIN_PIN},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").endswith(
        "wordprocessingml.document")
    disp = r.headers.get("content-disposition", "")
    assert 'attachment' in disp
    assert "paneltec_group_platform_manual.docx" in disp
    # Docx is a zip — first 4 bytes are the PKZIP magic.
    assert r.content[:2] == b"PK", "response body is not a docx zip"
    assert len(r.content) > 100_000, (
        f"docx too small ({len(r.content)}b) — regenerated?")


def test_non_admin_gets_403():
    """A worker fixture cannot reach the endpoint at all."""
    r = requests.post(f"{API}/auth/login",
                        json={"email": "worker_stephen@paneltec.com.au",
                              "password": "WorkerTest123!"},
                        timeout=30)
    if r.status_code != 200:
        pytest.skip("worker fixture unavailable")
    worker_h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r2 = requests.get(f"{API}/docs/manual.docx",
                        headers={**worker_h,
                                  "X-Admin-Console-Pin": ADMIN_PIN},
                        timeout=30)
    assert r2.status_code == 403, r2.text


def test_drift_check_reports_clean_on_freshly_regenerated_manual():
    out = subprocess.check_output(
        [sys.executable, str(DRIFT)], timeout=30, cwd=str(APP_ROOT),
    ).decode()
    assert "within tolerance" in out, out


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132gd():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gd'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gd'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gd'", sw)
