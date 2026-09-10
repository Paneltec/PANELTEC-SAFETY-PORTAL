"""v58.13.132dd — Schematic Mobile section re-bake.

Locks the mobile section against the new `.132cz`/`.132dc` UI shape
(8-screen mockup + 7-tab bar), replacing the `.132cu`/`.132cx`
20-cluster/81-node lock which was rendered stale by the Expo
rewrite.

Locks:
  · SCHEMATIC_CLUSTERS has 10 mobile sub-clusters (down from 20).
  · SCHEMATIC_NODES has 43 mobile-* rows (down from 81).
  · Per-cluster distribution matches the read-only audit.
  · Every mobile-* label carries a full parent-path prefix
    (Home / …, Auth / …, Tab / …, Visitor / …).
  · The legacy `.132cu` cluster keys (mobile_before_login,
    mobile_home_admin/paneltec/viatec/contractor,
    mobile_forms_*, mobile_toolbox, mobile_modals) are all gone
    from the static registry — surviving overlays in Mongo that
    reference them are orphans, tracked in `.132de` prune ship.
  · FE MOBILE_SUB_CLUSTER_ORDER + CLUSTER_ACCENT + CLUSTER_ICON
    all wire the 10 new keys.
  · Three-way version sync at .132dd (mobile lags .132dc, hook
    escape hatch enabled for this ship).
"""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
REGISTRY_JS = APP_ROOT / "frontend" / "src" / "lib" / "programSchematic.js"
PAGE_JSX = APP_ROOT / "frontend" / "src" / "pages" / "settings" / "ProgramSchematicPage.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SERVICE_WORKER = APP_ROOT / "frontend" / "public" / "service-worker.js"


EXPECTED_SUB_CLUSTERS = [
    ("mobile_auth",     3),
    ("mobile_tabs",     7),
    ("mobile_home",     8),
    ("mobile_job",      2),
    ("mobile_prestart", 2),
    ("mobile_records",  6),
    ("mobile_profile",  8),
    ("mobile_askai",    1),
    ("mobile_stub",     2),
    ("mobile_visitor",  4),
]
TOTAL_MOBILE_NODES = sum(n for _, n in EXPECTED_SUB_CLUSTERS)
LEGACY_CLUSTER_KEYS_MUST_BE_ABSENT = [
    "mobile_before_login",
    "mobile_home_admin", "mobile_home_paneltec",
    "mobile_home_viatec", "mobile_home_contractor",
    "mobile_forms_general", "mobile_forms_swms",
    "mobile_forms_prestart", "mobile_forms_inspection",
    "mobile_forms_nearmiss", "mobile_forms_incident",
    "mobile_forms_toolbox", "mobile_forms_admin",
    "mobile_forms_hazard", "mobile_forms_risk",
    "mobile_forms_sitediary",
    "mobile_toolbox", "mobile_modals",
]


def test_registry_has_ten_mobile_sub_clusters():
    src = REGISTRY_JS.read_text(encoding="utf-8")
    for key, _ in EXPECTED_SUB_CLUSTERS:
        assert f"key: '{key}'" in src, f"sub-cluster {key!r} missing"


def test_legacy_cluster_keys_gone_from_registry():
    src = REGISTRY_JS.read_text(encoding="utf-8")
    for legacy in LEGACY_CLUSTER_KEYS_MUST_BE_ABSENT:
        assert f"key: '{legacy}'" not in src, (
            f"legacy `.132cu`/`.132cx` cluster {legacy!r} still in registry "
            f"— must be removed for .132dd"
        )


def test_mobile_node_distribution_matches_audit():
    src = REGISTRY_JS.read_text(encoding="utf-8")
    counts = Counter()
    for line in src.splitlines():
        m = re.search(r"id: 'mobile-.*cluster: '(mobile_[a-z_]+)'", line)
        if not m:
            m = re.search(r"cluster: '(mobile_[a-z_]+)'.*id: 'mobile-", line)
        if m:
            counts[m.group(1)] += 1
    for key, expected in EXPECTED_SUB_CLUSTERS:
        assert counts[key] == expected, (
            f"sub-cluster {key!r} has {counts[key]} nodes, expected {expected}"
        )
    assert sum(counts.values()) == TOTAL_MOBILE_NODES, (
        f"expected {TOTAL_MOBILE_NODES} mobile screens, "
        f"got {sum(counts.values())}"
    )


def test_every_mobile_label_carries_parent_path():
    src = REGISTRY_JS.read_text(encoding="utf-8")
    allowed_prefixes = (
        "Home / My Work / ",
        "Home / Profile / ",
        "Home / Ad-hoc Job ",
        "Home / Signed-On ",
        "Home / Job Detail ",
        "Home / Action ",
        "Home / Intelligence ",
        "Home / Today",
        "Home / Notification ",
        "Home / Signed-On ",
        "Home / Screen ",
        "Home / ",
        "Auth / ",
        "Tab / ",
        "Visitor / ",
    )
    for line in src.splitlines():
        if not re.search(r"id: 'mobile-", line):
            continue
        m = re.search(r"label: '([^']+)'", line)
        assert m, f"label missing on: {line.strip()[:120]}"
        label = m.group(1)
        assert any(label.startswith(p) for p in allowed_prefixes), (
            f"label {label!r} missing parent-path prefix"
        )


def test_stub_tabs_marked_stub_in_desc():
    """Outbox + Fleet placeholder tabs must carry the STUB marker
    so the schematic reader knows they're empty-state screens."""
    src = REGISTRY_JS.read_text(encoding="utf-8")
    for stub_id in ("mobile-stub-outbox", "mobile-stub-fleet"):
        lines = [l for l in src.splitlines() if f"id: '{stub_id}'" in l]
        assert len(lines) == 1, f"expected 1 line for {stub_id}, got {len(lines)}"
        assert "STUB" in lines[0], f"{stub_id} missing STUB marker"


def test_page_wires_ten_sub_clusters():
    src = PAGE_JSX.read_text(encoding="utf-8")
    for key, _ in EXPECTED_SUB_CLUSTERS:
        assert f"'{key}'" in src, f"sub-cluster {key!r} not wired in FE"
    for legacy in LEGACY_CLUSTER_KEYS_MUST_BE_ABSENT:
        assert f"'{legacy}'" not in src, (
            f"legacy cluster {legacy!r} still wired in FE — remove it"
        )
    assert 'data-testid="schematic-mobile-section"' in src


def test_page_wires_accents_and_icons_for_new_clusters():
    src = PAGE_JSX.read_text(encoding="utf-8")
    for key in [k for k, _ in EXPECTED_SUB_CLUSTERS]:
        assert re.search(rf"{key}:\s+'[a-zA-Z0-9]+'", src), (
            f"accent wiring for {key!r} missing (should be single-quoted "
            f"hue in CLUSTER_ACCENT / CLUSTER_ICON)"
        )


def _tail(s: str) -> str:
    m = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]+)", s)
    assert m, s
    return m.group(1)


def test_three_way_sync_at_132dd_or_later():
    vjs = VERSION_JS.read_text(encoding="utf-8")
    swjs = SERVICE_WORKER.read_text(encoding="utf-8")
    running = re.search(r"RUNNING_VERSION = '([^']+)'", vjs).group(1)
    expected = re.search(r"EXPECTED_CACHE_VERSION = '([^']+)'", vjs).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'", swjs,
                      re.MULTILINE).group(1)
    assert running == expected == cache
    assert _tail(running) >= "dd"
