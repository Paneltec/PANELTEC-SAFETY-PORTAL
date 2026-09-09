"""v58.13.132bn — Guardrails for the Mobile App Modules matrix
tightening.

Coverage:
  1. Zero legacy tokens in `org_settings.mobile_modules_overrides`
     or `orgs.mobile_modules` across the whole DB.
  2. Backfill script is idempotent (dry-run reports 0 rewrites
     both pre- and post-commit).
  3. `MobileModulesSection.jsx` renders exactly 4 core-role columns
     (validated statically via a regex on the source file).
  4. Legacy subtitle string ("4 legacy categories + N live roles")
     is gone.
  5. Version bumped monotonically.
"""
from __future__ import annotations
import os, re
import pytest
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv

pytestmark = pytest.mark.live_db_writes

CORE_ROLES = {"admin", "paneltec_civil", "viatec_traffic", "external_contractor"}
LEGACY_TOKENS = {"worker", "supervisor", "foreman", "contractor", "hseq"}


@pytest.fixture(scope="module")
def db_sync():
    load_dotenv("/app/backend/.env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def test_no_legacy_tokens_in_mobile_modules_overrides(db_sync):
    offenders = []
    for s in db_sync.org_settings.find(
        {"mobile_modules_overrides": {"$exists": True}},
        {"_id": 0, "org_id": 1, "mobile_modules_overrides": 1},
    ):
        for k in (s.get("mobile_modules_overrides") or {}):
            if k in LEGACY_TOKENS:
                offenders.append(f"{s.get('org_id')}: mobile_modules_overrides[{k!r}]")
    for o in db_sync.orgs.find(
        {"mobile_modules": {"$exists": True}},
        {"_id": 0, "id": 1, "mobile_modules": 1},
    ):
        for k in (o.get("mobile_modules") or {}):
            if k in LEGACY_TOKENS:
                offenders.append(f"{o.get('id')}: mobile_modules[{k!r}]")
    assert not offenders, "\n  " + "\n  ".join(offenders)


def test_backfill_is_idempotent():
    import subprocess, sys
    p = subprocess.run(
        [sys.executable,
         "/app/backend/scripts/backfill_mobile_modules_v58_13_132bn.py"],
        capture_output=True, text=True, timeout=30,
    )
    assert p.returncode == 0, p.stderr
    assert "0 docs need rewrite" in p.stdout, p.stdout


def test_frontend_renders_four_core_role_columns():
    src = Path("/app/frontend/src/components/settings/MobileModulesSection.jsx").read_text()
    m = re.search(
        r"CORE_ROLE_ORDER\s*=\s*\[([^\]]+)\]",
        src,
    )
    assert m, "CORE_ROLE_ORDER not found in MobileModulesSection.jsx"
    ids = re.findall(r"'([a-z_]+)'", m.group(1))
    assert ids == ["admin", "paneltec_civil", "viatec_traffic", "external_contractor"], \
        f"CORE_ROLE_ORDER wrong: {ids}"


def test_legacy_subtitle_string_gone():
    src = Path("/app/frontend/src/components/settings/MobileModulesSection.jsx").read_text()
    assert "4 legacy categories" not in src, \
        "Legacy '4 legacy categories + N live roles' subtitle still present"
    assert "4 core roles" in src, "Updated subtitle copy '4 core roles' not found"


def test_admin_chip_present():
    src = Path("/app/frontend/src/components/settings/MobileModulesSection.jsx").read_text()
    assert 'data-testid="mobile-modules-admin-chip"' in src, \
        "Admin 'sees every module' chip not rendered"
    assert "Sees every module" in src


def test_version_bumped_to_132bn():
    version_js = Path("/app/frontend/src/lib/version.js").read_text()
    sw_js = Path("/app/frontend/public/service-worker.js").read_text()
    m = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]{1,3})", version_js)
    assert m and m.group(1) >= "bn", f"version regressed: {m and m.group(1)}"
    m2 = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]{1,3})", sw_js)
    assert m2 and m2.group(1) >= "bn"
