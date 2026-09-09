"""v58.13.132bh — Guardrail: the `admin` seed role's display name
is "Admin" (renamed from "Administrator"). Applies at both source
levels — the `SYSTEM_ROLES` Python constant (source of truth,
re-applied at every backend startup via `seed_system_roles()`) AND
the live Mongo document.
"""
from __future__ import annotations
import os
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv

pytestmark = pytest.mark.live_db_writes


@pytest.fixture(scope="module")
def db_sync():
    load_dotenv("/app/backend/.env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def test_system_roles_constant_names_admin_as_admin():
    """The Python `SYSTEM_ROLES` constant must specify
    `name="Admin"` for `role_id="admin"`. If this reverts to
    "Administrator" the next backend restart would rename the DB row
    back."""
    load_dotenv("/app/backend/.env")
    import importlib
    roles_cat = importlib.import_module("roles_catalogue")
    admin = next((r for r in roles_cat.SYSTEM_ROLES if r["role_id"] == "admin"), None)
    assert admin, "SYSTEM_ROLES has no admin entry"
    assert admin["name"] == "Admin", (
        f'SYSTEM_ROLES[admin].name is {admin["name"]!r}, expected "Admin"'
    )


def test_db_admin_role_display_name_is_admin(db_sync):
    """The DB row for `admin` currently has `name="Admin"`."""
    doc = db_sync.roles.find_one({"role_id": "admin"},
                                 {"_id": 0, "name": 1})
    assert doc, "roles.admin not found"
    assert doc.get("name") == "Admin", (
        f'db.roles.admin.name is {doc.get("name")!r}, expected "Admin"'
    )


def test_rename_script_is_idempotent():
    """Re-running the rename script produces a `(no-op — already
    'Admin')` line and no writes."""
    import subprocess, sys
    p = subprocess.run(
        [sys.executable,
         "/app/backend/scripts/rename_admin_role_v58_13_132bh.py",
         "--commit"],
        capture_output=True, text=True, timeout=30,
    )
    assert p.returncode == 0, p.stderr
    assert "(no-op — already 'Admin')" in p.stdout, p.stdout


def test_version_bumped_to_132bh():
    """Monotonic version-letter check — passes on `.132bh` or any
    later letter."""
    from pathlib import Path
    import re
    version_js = Path("/app/frontend/src/lib/version.js").read_text()
    sw_js = Path("/app/frontend/public/service-worker.js").read_text()
    m = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]{1,3})", version_js)
    assert m and m.group(1) >= "bh", (
        f"RUNNING_VERSION letter '{m.group(1) if m else None}' < '.132bh'"
    )
    m2 = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]{1,3})", sw_js)
    assert m2 and m2.group(1) >= "bh", (
        f"service-worker.js CACHE_VERSION letter regressed below '.132bh'"
    )
