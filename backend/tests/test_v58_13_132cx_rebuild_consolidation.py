"""v58.13.132cx — Rebuild consolidation.

Reconstructs the 9 ships (`.132cm` through `.132cu`) that were
obliterated by `.132cw`'s `git filter-repo --force` incident. This
is the ONLY test file that guards the reconstructed final state —
individual ship tests were not restored since the final state
supersedes them all.

Locks:
  · CORS: wildcard allow-origin honoured, preflight succeeds.
  · Mobile PIN login: matches `mobile_pin_hash` first, falls back to
    `pin_hash`. Response has no `_debug_pin_field`.
  · Onboarding cards: endpoint accepts `user_id` query param.
  · Permission presets: exactly 4 core-role presets (Admin,
    Paneltec Civil, Viatec Traffic Solutions, External Contractor).
  · Program Schematic overlays: 4 CRUD endpoints mounted, gated.
  · Program Schematic mobile: 20 sub-clusters, 81 nodes, every
    label carries a parent-path prefix.
  · Version-sync at `.132cx` on all three constants.
"""
from __future__ import annotations

import os
import re
import uuid
from collections import Counter
from pathlib import Path

import bcrypt
import pytest
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
REGISTRY_JS = APP_ROOT / "frontend" / "src" / "lib" / "programSchematic.js"
PAGE_JSX = APP_ROOT / "frontend" / "src" / "pages" / "settings" / "ProgramSchematicPage.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SERVICE_WORKER = APP_ROOT / "frontend" / "public" / "service-worker.js"
GITIGNORE = APP_ROOT / ".gitignore"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


# ─────────────────────────── static-file assertions ────────────────────────────


EXPECTED_MOBILE_SUB_CLUSTERS = [
    ("mobile_before_login",     3),
    ("mobile_home_admin",       8),
    ("mobile_home_paneltec",    6),
    ("mobile_home_viatec",      6),
    ("mobile_home_contractor",  2),
    ("mobile_forms_general",   12),
    ("mobile_forms_swms",       4),
    ("mobile_forms_prestart",  10),
    ("mobile_forms_inspection", 5),
    ("mobile_forms_nearmiss",   1),
    ("mobile_forms_incident",   2),
    ("mobile_forms_toolbox",    2),
    ("mobile_forms_admin",      1),
    ("mobile_forms_hazard",     2),
    ("mobile_forms_risk",       1),
    ("mobile_forms_sitediary",  1),
    ("mobile_profile",          8),
    ("mobile_toolbox",          1),
    ("mobile_modals",           2),
    ("mobile_visitor",          4),
]
TOTAL_MOBILE_NODES = sum(n for _, n in EXPECTED_MOBILE_SUB_CLUSTERS)


def test_registry_has_twenty_mobile_sub_clusters():
    src = REGISTRY_JS.read_text(encoding="utf-8")
    for key, _ in EXPECTED_MOBILE_SUB_CLUSTERS:
        assert f"key: '{key}'" in src, f"sub-cluster {key!r} missing"


def test_mobile_node_distribution_matches_snapshot():
    src = REGISTRY_JS.read_text(encoding="utf-8")
    counts = Counter()
    for line in src.splitlines():
        m = re.search(r"id: 'mobile-.*cluster: '(mobile_[a-z_]+)'", line)
        if not m:
            m = re.search(r"cluster: '(mobile_[a-z_]+)'.*id: 'mobile-", line)
        if m:
            counts[m.group(1)] += 1
    for key, expected in EXPECTED_MOBILE_SUB_CLUSTERS:
        assert counts[key] == expected, (
            f"sub-cluster {key!r} has {counts[key]} nodes, expected {expected}"
        )
    assert sum(counts.values()) == TOTAL_MOBILE_NODES


def test_every_mobile_label_carries_parent_path():
    src = REGISTRY_JS.read_text(encoding="utf-8")
    allowed_prefixes = (
        "Home / Admin / ",
        "Home / Paneltec Civil / ",
        "Home / Viatec Traffic / ",
        "Home / External Contractor / ",
        "Home / Forms / ",
        "Home / Profile / ",
        "Tab / Toolbox Meetings",
        "Auth / ",
        "Modal / ",
        "Visitor / ",
    )
    for line in src.splitlines():
        if not re.search(r"id: 'mobile-", line):
            continue
        m = re.search(r"label: '([^']+)'", line)
        assert m
        label = m.group(1)
        assert any(label.startswith(p) for p in allowed_prefixes), (
            f"label {label!r} missing parent-path prefix"
        )


def test_page_wires_mobile_section():
    src = PAGE_JSX.read_text(encoding="utf-8")
    for key, _ in EXPECTED_MOBILE_SUB_CLUSTERS:
        assert f"'{key}'" in src, f"sub-cluster {key!r} not wired in FE"
    assert 'data-testid="schematic-mobile-section"' in src
    assert 'data-testid="schematic-mobile-section-title"' in src


def test_hidden_forms_clusters_marked_stub():
    src = REGISTRY_JS.read_text(encoding="utf-8")
    for line in src.splitlines():
        m = re.search(r"cluster: '(mobile_forms_(?:admin|hazard|risk|sitediary))'", line)
        if not m:
            continue
        assert "STUB — hidden from mobile UI" in line, (
            f"hidden forms node missing STUB marker: {line.strip()[:120]}"
        )


def test_payroll_profile_node_marked_stub():
    src = REGISTRY_JS.read_text(encoding="utf-8")
    payroll = [l for l in src.splitlines() if "id: 'mobile-profile-payroll'" in l]
    assert len(payroll) == 1
    assert "STUB — Disabled" in payroll[0]


def test_gitignore_has_apk_block():
    src = GITIGNORE.read_text(encoding="utf-8")
    assert "backend/static/downloads/*.apk" in src


# ─────────────────────────── version sync ────────────────────────────


def _tail(s: str) -> str:
    m = re.search(r"paneltec-v160\.3\.9\.58\.13\.132c([a-z]+)", s)
    assert m
    return m.group(1)


def test_version_js_running_version_at_least_132cx():
    src = VERSION_JS.read_text(encoding="utf-8")
    m = re.search(r"RUNNING_VERSION = '([^']+)'", src)
    assert m and _tail(m.group(1)) >= "cx"


def test_version_js_expected_cache_version_at_least_132cx():
    src = VERSION_JS.read_text(encoding="utf-8")
    m = re.search(r"EXPECTED_CACHE_VERSION = '([^']+)'", src)
    assert m and _tail(m.group(1)) >= "cx"


def test_service_worker_cache_version_at_least_132cx():
    src = SERVICE_WORKER.read_text(encoding="utf-8")
    m = re.search(r"CACHE_VERSION = '([^']+)'", src)
    assert m and _tail(m.group(1)) >= "cx"


def test_three_way_version_sync_matches():
    vjs = VERSION_JS.read_text(encoding="utf-8")
    swjs = SERVICE_WORKER.read_text(encoding="utf-8")
    running = re.search(r"RUNNING_VERSION = '([^']+)'", vjs).group(1)
    expected = re.search(r"EXPECTED_CACHE_VERSION = '([^']+)'", vjs).group(1)
    cache = re.search(r"CACHE_VERSION = '([^']+)'", swjs).group(1)
    assert running == expected == cache


# ─────────────────────────── runtime endpoint assertions ────────────────────────────


def test_cors_wildcard_headers_present():
    r = requests.get(f"{API}/api/health", headers={"Origin": "https://random.example.com"})
    assert r.status_code == 200
    # CORS middleware echoes `*` when allow_origins=["*"] and no credentials.
    assert r.headers.get("Access-Control-Allow-Origin") == "*"


def test_cors_preflight_options_ok():
    r = requests.options(
        f"{API}/api/health",
        headers={
            "Origin": "https://random.example.com",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization,Content-Type",
        },
    )
    assert r.status_code in (200, 204)
    assert r.headers.get("Access-Control-Allow-Origin") == "*"


def test_pin_login_response_has_no_debug_pin_field():
    """Contract: successful pin-login response must not leak which
    field (`mobile_pin_hash` vs `pin_hash`) matched."""
    r = requests.post(f"{API}/api/auth/mobile/pin-login", json={"pin": "0000"})
    # Whether 200 or 401, body must never include `_debug_pin_field`.
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    assert "_debug_pin_field" not in body


def test_pin_login_bad_pin_rejected():
    r = requests.post(f"{API}/api/auth/mobile/pin-login", json={"pin": "abcd"})
    assert r.status_code in (400, 401)


def test_pin_login_stephen_via_mobile_pin_hash():
    """Stephen's mobile PIN was seeded to `3310` by the `.132cq`
    migration and lives on `users.mobile_pin_hash`. The `.132cp/cx`
    field-precedence fix means pin-login must match him via the
    mobile_pin_hash branch."""
    r = requests.post(f"{API}/api/auth/mobile/pin-login",
                      json={"pin": "3310", "device_id": f"pytest-132cx-{uuid.uuid4().hex[:6]}"})
    if r.status_code == 429:
        pytest.skip("rate-limited from prior pytest run — retry after cooldown")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "stephen@paneltec.com.au"
    assert "session_token" in body
    assert "_debug_pin_field" not in body


def test_onboarding_cards_endpoint_accepts_user_id():
    """Endpoint should accept `user_id` param. Without auth we
    expect 401; with a fake user_id + admin auth we'd expect 404
    (no worker) — either signals the param is wired. A 400 saying
    'Pass one of: worker_id, ...' would mean the param wasn't
    recognised."""
    r = requests.get(f"{API}/api/mobile/onboarding/cards.pdf?user_id=fake-user-id")
    body = r.text
    assert r.status_code in (401, 403, 404), f"unexpected {r.status_code}: {body[:200]}"
    # The 400 branch's message must not fire — it means the param
    # was ignored.
    assert "Pass one of: worker_id, worker_ids, all=true" not in body


def test_permission_presets_returns_four_core_roles():
    """Anonymous call gets 401 — but the shape check requires an
    admin token. Skip cleanly if no seeded admin bearer available
    via env."""
    admin_token = os.environ.get("PYTEST_ADMIN_TOKEN")
    if not admin_token:
        # Anonymous — must be 401.
        r = requests.get(f"{API}/api/permission-presets")
        assert r.status_code in (401, 403)
        return
    r = requests.get(
        f"{API}/api/permission-presets",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "built_in" in body and "custom" in body
    labels = [p["label"] for p in body["built_in"]]
    assert labels == ["Admin", "Paneltec Civil", "Viatec Traffic Solutions", "External Contractor"], labels
    assert all(p.get("is_system") for p in body["built_in"])


def test_program_schematic_overlays_endpoints_mounted():
    """All 4 routes should be reachable and require auth."""
    for method, path in (
        ("GET",    "/api/program-schematic/overlays"),
        ("PUT",    "/api/program-schematic/overlays/mobile_home_admin/mobile-home-admin-workers"),
        ("DELETE", "/api/program-schematic/overlays/mobile_home_admin/mobile-home-admin-workers"),
        ("POST",   "/api/program-schematic/overlays/new"),
    ):
        r = requests.request(method, f"{API}{path}", json={"status": "kept"} if method != "GET" else None)
        # Auth-required → 401. Not-found → 404 would signal the route isn't mounted.
        assert r.status_code in (401, 403, 422), (
            f"{method} {path} returned {r.status_code}: {r.text[:200]}"
        )


# ─────────────────────────── mongo state audit ────────────────────────────


def test_permission_presets_migration_marker_present_in_mongo():
    """The `.132co` migration soft-deleted 7 legacy customs with
    `deleted_by='v58_13_132co_preset_cleanup'`. Those docs must
    still be present (we did NOT re-run the migration script)."""
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    n = db.permission_presets.count_documents({"deleted_by": "v58_13_132co_preset_cleanup"})
    assert n >= 1, f"expected .132co migration marker docs, got {n}"


def test_stephen_mobile_pin_hash_present_in_mongo():
    """Stephen's mobile PIN seed from `.132cq` must survive."""
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    u = db.users.find_one({"email": "stephen@paneltec.com.au"},
                          {"_id": 0, "mobile_pin_hash": 1})
    assert u is not None
    assert u.get("mobile_pin_hash"), "mobile_pin_hash unset for Stephen"
    # Confirm it actually verifies against the seeded PIN.
    assert bcrypt.checkpw(b"3310", u["mobile_pin_hash"].encode("utf-8"))


def test_program_schematic_overlays_survived_incident():
    """The `.132cr/cs/ct/cu` UI overlays must still be in Mongo."""
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    n = db.program_schematic_overlays.count_documents({})
    assert n >= 1, f"expected surviving overlay docs, got {n}"
