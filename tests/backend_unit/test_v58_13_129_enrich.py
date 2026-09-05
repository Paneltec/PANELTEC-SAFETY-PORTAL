"""v58.13.129 — Locks for enrich_asset_names script."""
from __future__ import annotations
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


SCRIPT = _read("backend/scripts/enrich_asset_names_v58_13_129.py")


def test_script_present_and_shape():
    assert "name_enriched_v129" in SCRIPT
    assert "name_before_v129" in SCRIPT
    assert "asset_type_before_v129" in SCRIPT
    assert "name_enriched_at" in SCRIPT
    assert "--reverse" in SCRIPT
    assert "--commit" in SCRIPT
    # Selection rule: date DESC, tie-break length DESC
    assert 'lambda p: (p.get("date_completed") or "", len(p.get("description") or ""))' in SCRIPT
    assert "reverse=True" in SCRIPT


def test_never_overwrite_existing_name():
    # Filter targets only null/empty names + not-yet-enriched.
    assert '{"name": None}, {"name": ""}' in SCRIPT
    assert '"name_enriched_v129": {"$ne": True}' in SCRIPT


def test_asset_type_never_overwrites_more_specific():
    # Q2 rule: cur_at empty → fill; canonical-match → in-place recase;
    # otherwise leave cur_at alone.
    assert "if not cur_at:" in SCRIPT
    assert "elif normalize_asset_type(cur_at) == pm_st_canon:" in SCRIPT


def test_reverse_path_present():
    assert 'mode=REVERSE' in SCRIPT
    assert '"name_enriched_v129": ""' in SCRIPT
    assert '"name_before_v129": ""' in SCRIPT


def test_version_bumped_to_129_everywhere():
    # v58.13.130 ratchets the pin forward. Accept .129 or any newer
    # .13.129+ ship (same pattern as the .124 / .128 / .128a pins).
    import re as _re
    _CANONICAL = {
        "frontend/src/lib/version.js": r"export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)",
        "frontend/public/service-worker.js": r"const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)",
        "mobile/src/lib/version.ts": r"export const MOBILE_BUNDLE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)",
    }
    for f, pat in _CANONICAL.items():
        m = _re.search(pat, _read(f))
        assert m and int(m.group(1)) >= 129, f"{f} not at .129 or newer"
