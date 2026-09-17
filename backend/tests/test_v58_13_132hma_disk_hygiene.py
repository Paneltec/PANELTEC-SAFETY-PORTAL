"""v58.13.132hma — Disk hygiene safety net + /app health probe.

Three complementary defences against the recurring
`/app/frontend/node_modules/.cache` blow-up that caused the
`.132hm` login outage:

  A. Cron (/etc/cron.d/paneltec-disk-hygiene, every 5 min) invokes
     the purge script when /app usage >= 85%.
  B. Frontend supervisor prestart hook (via package.json `start`
     script → node scripts/prestart-hygiene.js) clears the cache
     on every dev-server boot.
  C. .env tuning: DISABLE_ESLINT_PLUGIN=true + GENERATE_SOURCEMAP=false
     slow the cache growth rate.

Plus a `disk_low_app` observability warning added to /api/health
so an admin dashboard can surface pending disk pressure before a
100% outage. Does NOT flip the 503 gate — advisory only.
"""
from __future__ import annotations

import re
import stat
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

APP_ROOT = Path(__file__).resolve().parents[2]

# Ship artefacts.
PURGE_SH = Path("/app/scripts/purge_webpack_cache_if_full.sh")
CRON_D = Path("/etc/cron.d/paneltec-disk-hygiene")
LOGROTATE = Path("/etc/logrotate.d/paneltec-disk-hygiene")
PRESTART_JS = APP_ROOT / "frontend" / "scripts" / "prestart-hygiene.js"
PKG_JSON = APP_ROOT / "frontend" / "package.json"
FE_ENV = APP_ROOT / "frontend" / ".env"
SERVER_PY = APP_ROOT / "backend" / "server.py"
VJS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─────────────── A · cron + purge script ───────────────


def test_purge_script_exists_and_executable():
    assert PURGE_SH.is_file(), "purge script missing"
    st = PURGE_SH.stat()
    assert st.st_mode & stat.S_IXUSR, "purge script not executable"
    body = _read(PURGE_SH)
    assert "THRESHOLD=${THRESHOLD:-85}" in body
    assert "/var/log/paneltec-disk-hygiene.log" in body
    assert "/app/frontend/node_modules/.cache" in body


def test_cron_entry_installed_every_5_min():
    assert CRON_D.is_file(), "cron.d entry missing"
    body = _read(CRON_D)
    assert re.search(
        r"^\*/5 \* \* \* \* root /app/scripts/purge_webpack_cache_if_full\.sh",
        body,
        re.M,
    ), "cron schedule not */5 minutes as root"


def test_logrotate_config_installed():
    assert LOGROTATE.is_file(), "logrotate entry missing"
    body = _read(LOGROTATE)
    assert "/var/log/paneltec-disk-hygiene.log" in body
    assert "rotate 7" in body
    assert "daily" in body


# ─────────────── B · prestart hook ───────────────


def test_prestart_hygiene_js_purges_cache():
    assert PRESTART_JS.is_file(), "prestart hook missing"
    body = _read(PRESTART_JS)
    assert "node_modules" in body and "'.cache'" in body
    assert "fs.rmSync" in body


def test_package_json_start_invokes_prestart_hook():
    import json

    pkg = json.loads(_read(PKG_JSON))
    start = pkg["scripts"]["start"]
    assert "node scripts/prestart-hygiene.js" in start
    assert "craco start" in start, "must still boot craco after hygiene"
    # Order matters — hygiene BEFORE craco.
    assert start.index("prestart-hygiene.js") < start.index("craco start")


# ─────────────── C · env tuning ───────────────


def test_frontend_env_disables_eslint_plugin_and_sourcemaps():
    body = _read(FE_ENV)
    assert re.search(r"^DISABLE_ESLINT_PLUGIN=true$", body, re.M)
    assert re.search(r"^GENERATE_SOURCEMAP=false$", body, re.M)
    # Protected variables untouched.
    assert re.search(r"^REACT_APP_BACKEND_URL=", body, re.M)
    assert re.search(r"^WDS_SOCKET_PORT=443$", body, re.M)


# ─────────────── Health · /app probe ───────────────


def test_server_py_pins_disk_app_probe():
    src = _read(SERVER_PY)
    assert 'shutil.disk_usage("/app")' in src
    assert '"disk_app"' in src
    assert '"free_pct"' in src
    assert 'degraded.append("disk_low_app")' in src


def test_health_endpoint_returns_disk_app_block():
    r = requests.get(f"{API}/health", timeout=10)
    assert r.status_code in (200, 503), r.text
    body = r.json()
    disk_app = body.get("checks", {}).get("disk_app")
    assert disk_app is not None, "disk_app check missing from health payload"
    assert disk_app.get("ok") is True
    # Field surface for downstream dashboards.
    for k in ("free_gb", "total_gb", "free_pct", "warn_below_pct"):
        assert k in disk_app, f"disk_app missing field {k}"
    assert disk_app["warn_below_pct"] == 15.0


# ─────────────── Version lockstep ───────────────


def test_version_bumped_to_132hma():
    js, sw = _read(VJS), _read(SW)
    assert re.search(
        r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132hma'", js
    )
    assert re.search(
        r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132hma'", js
    )
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132hma'", sw)
