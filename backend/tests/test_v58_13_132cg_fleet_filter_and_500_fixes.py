"""v58.13.132cg — Fleet filter + Permissions 500 + vac_truck merge · pytests."""
from __future__ import annotations
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"
MIN = "132cg"


def _read(p): return p.read_text(encoding="utf-8")


# ── Issue 1: sub_type filter canonicalisation ──────────────────────

def test_fleet_register_uses_canonical_taxonomy_for_sub_type():
    src = _read(BACKEND / "fleet.py")
    assert "from asset_taxonomy import CANONICAL_ASSET_TYPE_MAP" in src, \
        "sub_type filter must reuse the same map as /fleet/categories"
    assert "raw_variants" in src
    # Case-insensitive fallback also present.
    assert '"$options": "i"' in src
    assert "import re" in src


# ── Issue 2: vac_truck migration script ────────────────────────────

def test_vac_truck_migration_script_exists():
    p = BACKEND / "scripts" / "merge_vac_truck_into_vacuum_truck_v58_13_132cg.py"
    assert p.exists()
    s = _read(p)
    assert "--commit" in s and "--dry-run" in s
    assert 'FROM_VALUE = "vac_truck"' in s
    assert 'TO_VALUE = "Vacuum Truck"' in s
    assert "_asset_type_normalised_at" in s


# ── Issue 4: Permissions Presets KeyError fix ──────────────────────

def test_permission_presets_custom_out_is_defensive():
    src = _read(BACKEND / "permission_presets.py")
    # No more bare doc["key"] on the read path.
    m = re.search(r"def _custom_out\(doc: dict\) -> dict:[\s\S]{0,900}?\n\}\s*\n", src)
    body = m.group(0) if m else ""
    # Fall back to a coarse slice if regex missed.
    if not body:
        idx = src.index("def _custom_out(doc: dict) -> dict:")
        body = src[idx: idx + 1200]
    assert 'doc["key"]' not in body, "bare doc['key'] must be replaced with .get() to avoid KeyError → 500"
    assert 'doc.get("key")' in body
    assert '_slugify(' in body, "must fall back to a slug when key is missing"


# ── Version-sync three-way lockstep ────────────────────────────────

def test_three_way_version_sync_at_132cg():
    vjs = _read(FRONTEND / "src" / "lib" / "version.js")
    sw = _read(FRONTEND / "public" / "service-worker.js")
    def _tok(s, pat):
        m = re.search(pat, s, re.M)
        assert m, pat
        return m.group(1)
    run = _tok(vjs, r"^export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    exp = _tok(vjs, r"^export const EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    swv = _tok(sw,  r"^const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    assert run == exp == swv, f"drift: run={run} exp={exp} sw={swv}"
    assert run >= MIN
