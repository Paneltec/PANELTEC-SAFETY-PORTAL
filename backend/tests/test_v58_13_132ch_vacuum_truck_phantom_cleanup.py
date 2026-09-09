"""v58.13.132ch — Vacuum Truck phantom cleanup · pytests."""
from __future__ import annotations
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"
MIN = "132ch"


def _read(p): return p.read_text(encoding="utf-8")


def test_phantom_cleanup_script_exists():
    p = BACKEND / "scripts" / "soft_delete_vacuum_truck_phantoms_v58_13_132ch.py"
    assert p.exists()
    s = _read(p)
    assert "--commit" in s and "--dry-run" in s
    assert "PHANTOMS" in s
    # All 6 target regos.
    for rego in ("E77VP", "FM7193", "WV1503", "XT16AB", "XT44DL"):
        assert f'"{rego}"' in s, f"phantom rego {rego} missing from script"
    # Row 18 (rego=None, name="Other").
    assert '"rego_serial": None' in s
    assert '"name": "Other"' in s
    # Idempotency: never overwrite an existing deleted_at.
    assert '"deleted_at": None' in s
    # Provenance breadcrumbs.
    assert "_phantom_deleted_at" in s
    assert "v58_13_132ch_phantom_cleanup" in s


def test_categories_pipeline_guardrail_matches_register_default():
    """Both `/fleet/register` (default) and `/fleet/categories`
    must filter on `deleted_at:null`. The .132ch bonus fix adds an
    explanatory comment; assert the comment + the filter are both
    in place so a future refactor doesn't silently drop it."""
    src = _read(BACKEND / "fleet.py")
    # Find the get_categories aggregation.
    idx = src.index("async def get_categories")
    block = src[idx: idx + 4000]
    assert '"deleted_at": None' in block, "categories aggregation must exclude soft-deleted"
    assert "v58.13.132ch" in block, "guardrail comment pinning the .132ch reasoning"


def test_three_way_version_sync_at_132ch():
    vjs = _read(FRONTEND / "src" / "lib" / "version.js")
    sw = _read(FRONTEND / "public" / "service-worker.js")
    def _tok(s, pat):
        m = re.search(pat, s, re.M); assert m; return m.group(1)
    run = _tok(vjs, r"^export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    exp = _tok(vjs, r"^export const EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    swv = _tok(sw,  r"^const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'")
    assert run == exp == swv, f"drift: run={run} exp={exp} sw={swv}"
    assert run >= MIN
