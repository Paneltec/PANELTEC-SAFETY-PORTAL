"""v58.13.83 — Source-pin tests for the two Prod Readiness Audit REDs.

B8: CORS lockdown in `backend/server.py`.
C12: `/api/health` real dependency probes.

Also asserts forward-safe version-sync `>= 83` on all three canonical
version-string files, matching the ship-guard pattern used by every
ship since v58.13.60.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

SERVER_PY = (BACKEND / "server.py").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Fix B8 — CORS lockdown ─────────────────────────────────────

def test_cors_safe_fallback_pins_prod_and_preview_hosts():
    assert "https://whs-compliance.emergent.host" in SERVER_PY
    assert "https://whs-compliance.preview.emergentagent.com" in SERVER_PY


def test_cors_wildcard_env_is_ignored_with_warning():
    # The star literal must appear inside the ignore branch with a
    # `log.warning(...)` companion — proving `CORS_ORIGINS="*"` no
    # longer becomes the effective allow list.
    assert '_cors_env_raw == "*"' in SERVER_PY
    assert "CORS_ORIGINS='*' ignored" in SERVER_PY
    # And crucially: no `os.environ.get("CORS_ORIGINS", "*").split(",")`
    # legacy line still floating around.
    assert 'os.environ.get("CORS_ORIGINS", "*").split(",")' not in SERVER_PY


def test_cors_methods_are_locked_down():
    # `allow_methods=["*"]` gone; explicit verbs enumerated.
    # (The regex tolerates the whitespace / newline the file happens
    # to use.)
    assert re.search(r'allow_methods=\[\s*"GET"\s*,\s*"POST"', SERVER_PY)
    # Guard against a regression back to the wildcard.
    assert 'allow_methods=["*"]' not in SERVER_PY


def test_cors_headers_are_locked_down():
    assert re.search(r'allow_headers=\[\s*"Authorization"', SERVER_PY)
    assert 'allow_headers=["*"]' not in SERVER_PY


def test_cors_allow_credentials_stays_false():
    # Bearer auth: credentials must remain False to keep the specific-
    # origin list compatible with browser preflight.
    assert re.search(r"allow_credentials\s*=\s*False", SERVER_PY)


def test_cors_dev_localhost_is_env_gated():
    # localhost:3000 only added when ENV in dev/development/local.
    assert 'os.environ.get("ENV"' in SERVER_PY
    assert "http://localhost:3000" in SERVER_PY


# ── Fix C12 — /api/health real dependency probes ───────────────

def test_health_endpoint_pings_mongo():
    # Handler must run db.command("ping") under asyncio.wait_for.
    # Find the health() handler body.
    m = re.search(r'async def health\(\):[\s\S]+?(?=\n@|\Z)', SERVER_PY)
    assert m, "health handler not found"
    body = m.group(0)
    assert '_db.command("ping")' in body
    assert "asyncio.wait_for" in body


def test_health_endpoint_probes_gridfs():
    m = re.search(r'async def health\(\):[\s\S]+?(?=\n@|\Z)', SERVER_PY)
    body = m.group(0)
    assert 'fs.files' in body
    assert "estimated_document_count" in body


def test_health_endpoint_probes_disk():
    m = re.search(r'async def health\(\):[\s\S]+?(?=\n@|\Z)', SERVER_PY)
    body = m.group(0)
    assert "shutil.disk_usage" in body
    assert "free_gb" in body


def test_health_endpoint_probes_soft_deps():
    m = re.search(r'async def health\(\):[\s\S]+?(?=\n@|\Z)', SERVER_PY)
    body = m.group(0)
    assert "shutil.which" in body
    for tool in ("soffice", "tesseract", "pdftotext"):
        assert tool in body


def test_health_endpoint_returns_503_on_critical_failure():
    m = re.search(r'async def health\(\):[\s\S]+?(?=\n@|\Z)', SERVER_PY)
    body = m.group(0)
    assert "status_code=503" in body
    assert "critical_fail" in body


def test_health_endpoint_returns_200_when_only_soft_deps_missing():
    m = re.search(r'async def health\(\):[\s\S]+?(?=\n@|\Z)', SERVER_PY)
    body = m.group(0)
    # Soft-dep failures push to `degraded[]` — not to critical_fail.
    assert "degraded.append" in body
    # And the response body carries the degraded list.
    assert '"degraded": degraded' in body


def test_health_endpoint_has_a_soft_wall_clock_bound():
    # Every awaited critical probe carries an asyncio.wait_for timeout.
    m = re.search(r'async def health\(\):[\s\S]+?(?=\n@|\Z)', SERVER_PY)
    body = m.group(0)
    # Two `asyncio.wait_for(...)` calls: mongo + gridfs. Disk is sync.
    assert body.count("asyncio.wait_for") >= 2


# ── Version-sync (forward-safe pin >= 83) ──────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_83():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 83


def test_cache_version_gte_83():
    assert _tail(SW_JS, "CACHE_VERSION") >= 83


def test_mobile_bundle_version_gte_83():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 83
