"""v58.13.132di — Three-item lock:
  1. Permissions Matrix "Preview as role" 500 toast — SCOPE_KEYS
     now accepts `external_contractor`.
  2. Program Schematic overlay Edit-mode buttons wired to
     `.132cr` CRUD (`GET/PUT/DELETE` at `/api/program-schematic/overlays`).
  3. Orphan overlay prune migration is idempotent + soft-only.
"""
from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
PREVIEW_MOD = APP_ROOT / "backend" / "mobile_preview.py"
SCHEMATIC_JSX = APP_ROOT / "frontend" / "src" / "pages" / "settings" / "ProgramSchematicPage.jsx"
PRUNE_SCRIPT = APP_ROOT / "backend" / "scripts" / "prune_orphan_schematic_overlays_v58_13_132di.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _pin_login():
    r = requests.post(f"{API}/api/auth/mobile/pin-login",
                      json={"pin": "3310", "device_id": "pytest-132di"})
    if r.status_code != 200:
        pytest.skip(f"PIN login unavailable ({r.status_code})")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def _mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Item 1: SCOPE_KEYS admits external_contractor ─────────────

def test_scope_keys_include_external_contractor():
    src = PREVIEW_MOD.read_text(encoding="utf-8")
    assert '"external_contractor"' in src
    from mobile_preview import SCOPE_KEYS, SCOPE_META
    assert "external_contractor" in SCOPE_KEYS
    assert SCOPE_META["external_contractor"]["matches"] == ("contractor",)


def test_preview_user_accepts_all_four_scopes():
    hdr = _pin_login()
    for scope in ("paneltec_civil", "viatec_traffic", "admin",
                  "external_contractor"):
        r = requests.get(f"{API}/api/mobile/preview-user",
                         headers=hdr, params={"scope": scope})
        assert r.status_code == 200, f"scope={scope} failed: {r.text}"
        body = r.json()
        assert body.get("preview") is True
        # admin scope → admin role_id; the other three → worker persona.
        expected_role = "admin" if scope == "admin" else "worker"
        assert body["user"]["role_id"] == expected_role


def test_preview_user_still_rejects_unknown_scope():
    hdr = _pin_login()
    r = requests.get(f"{API}/api/mobile/preview-user",
                     headers=hdr, params={"scope": "bogus_scope"})
    assert r.status_code == 400
    assert "scope must be one of" in r.json()["detail"]


# ─── Item 2: FE overlay Edit-mode wiring ───────────────────────

def test_frontend_overlay_edit_mode_wired():
    src = SCHEMATIC_JSX.read_text(encoding="utf-8")
    # Admin toggle button.
    assert 'data-testid="schematic-overlay-edit-toggle"' in src
    assert 'data-testid="schematic-overlay-toolbar"' in src
    # 3 status buttons rendered per tile in edit mode.
    for status in ("kept", "dropped", "added"):
        assert f"'{status}'" in src, f"missing status {status!r}"
    # Per-tile edit-bar testid template.
    assert re.search(r"schematic-tile-editbar-\$", src), (
        "schematic-tile-editbar-<id> testid missing"
    )
    # Wired to the .132cr CRUD.
    assert "'/program-schematic/overlays'" in src or '"/program-schematic/overlays"' in src
    assert "api.put(" in src and "/program-schematic/overlays/${clusterKey}/${nodeKey}" in src
    assert "api.delete(" in src and "/program-schematic/overlays/${clusterKey}/${nodeKey}" in src
    # Admin gate.
    assert "useCan()" in src or "useCan(" in src
    assert "'users'" in src and "'edit'" in src
    # Overlay-status attribute for downstream testing.
    assert 'data-overlay-status={status}' in src


@pytest.mark.live_db_writes
def test_overlay_crud_roundtrip_via_api():
    hdr = _pin_login()
    db = _mongo()
    tag_cluster = "capture"
    tag_node = f"pytest-132di-{uuid.uuid4().hex[:6]}"
    # PUT (create).
    r1 = requests.put(
        f"{API}/api/program-schematic/overlays/{tag_cluster}/{tag_node}",
        headers=hdr, json={"status": "dropped"},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["status"] == "dropped"
    # GET grouped.
    r2 = requests.get(f"{API}/api/program-schematic/overlays", headers=hdr)
    assert r2.status_code == 200
    assert r2.json().get(tag_cluster, {}).get(tag_node, {}).get("status") == "dropped"
    # PUT (upsert change).
    r3 = requests.put(
        f"{API}/api/program-schematic/overlays/{tag_cluster}/{tag_node}",
        headers=hdr, json={"status": "added", "custom_label": "Pytest"},
    )
    assert r3.status_code == 200
    assert r3.json()["status"] == "added"
    assert r3.json()["custom_label"] == "Pytest"
    # DELETE (soft).
    r4 = requests.delete(
        f"{API}/api/program-schematic/overlays/{tag_cluster}/{tag_node}",
        headers=hdr,
    )
    assert r4.status_code == 200 and r4.json()["deleted"] is True
    # Vanishes from grouped list.
    r5 = requests.get(f"{API}/api/program-schematic/overlays", headers=hdr)
    assert tag_node not in r5.json().get(tag_cluster, {})
    # Cleanup — hard-remove the pytest row so the collection stays tidy.
    db.program_schematic_overlays.delete_many(
        {"cluster_key": tag_cluster, "node_key": tag_node},
    )


# ─── Item 3: prune migration is idempotent + soft-only ─────────

def test_prune_script_is_idempotent_and_soft():
    src = PRUNE_SCRIPT.read_text(encoding="utf-8")
    # Retired cluster keys the migration targets.
    for key in ("mobile", "mobile_home_admin", "mobile_home_paneltec",
                "mobile_home_viatec", "mobile_modals"):
        assert f'"{key}"' in src, f"retired key {key!r} not in script"
    # SOFT delete only — no `delete_one` / `delete_many` calls.
    assert "delete_many" not in src
    assert "delete_one" not in src
    # Uses update_many with $set deleted_at.
    assert "update_many" in src
    assert '"deleted_at":' in src
    # Idempotent — filter includes `deleted_at: None` so already-pruned
    # rows aren't touched.
    assert '"deleted_at": None' in src


@pytest.mark.live_db_writes
def test_prune_left_zero_live_orphans():
    db = _mongo()
    retired = {"mobile", "mobile_home_admin", "mobile_home_paneltec",
               "mobile_home_viatec", "mobile_modals"}
    n_live = db.program_schematic_overlays.count_documents(
        {"deleted_at": None, "cluster_key": {"$in": list(retired)}},
    )
    assert n_live == 0, (
        f"expected 0 live orphans after prune, saw {n_live}"
    )
    # And 14 soft-deleted rows survive as history (>= 14; running the
    # migration again is a no-op so this cannot regress).
    n_soft = db.program_schematic_overlays.count_documents(
        {"deleted_at": {"$ne": None}, "cluster_key": {"$in": list(retired)}},
    )
    assert n_soft >= 14, f"expected ≥14 soft-deleted rows, saw {n_soft}"


# ─── Version sync ─────────────────────────────────────────────

def test_three_way_sync_at_132di_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "di"
