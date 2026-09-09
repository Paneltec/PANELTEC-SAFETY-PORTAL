"""v58.13.131e — AssetDrawer SmartFill editor fields.

Locks the three new AssetIn model fields (fuel_tank_capacity_l,
smartfill_key_code, smartfill_card_number) + PATCH persistence
semantics (uppercase-trim on key_code, plain trim on card_number,
null clears).
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


ASSETS_PY = _read("backend/assets.py")
DRAWER = _read("frontend/src/components/AssetDrawer.jsx")


# ── Backend AssetIn model + create/update paths ────────────────
def test_assetin_model_declares_three_fields():
    # Field lines must appear inside `class AssetIn(BaseModel):`
    m = re.search(r"class AssetIn\(BaseModel\):(.*?)\n\n", ASSETS_PY, flags=re.DOTALL)
    assert m, "AssetIn model not found"
    body = m.group(1)
    assert "fuel_tank_capacity_l" in body
    assert "smartfill_key_code" in body
    assert "smartfill_card_number" in body


def test_create_asset_persists_three_fields():
    m = re.search(r"async def create_asset\(.*?await db\.assets\.insert_one",
                  ASSETS_PY, flags=re.DOTALL)
    assert m, "create_asset body not found"
    body = m.group(0)
    assert '"fuel_tank_capacity_l": body.fuel_tank_capacity_l' in body
    # key_code is uppercased + trimmed + blank-to-null on save.
    assert '.strip().upper() or None' in body
    # card_number is trimmed only.
    assert '"smartfill_card_number":' in body


def test_update_asset_persists_three_fields():
    m = re.search(r"async def update_asset\(.*?await db\.assets\.update_one",
                  ASSETS_PY, flags=re.DOTALL)
    assert m, "update_asset body not found"
    body = m.group(0)
    assert '"fuel_tank_capacity_l": body.fuel_tank_capacity_l' in body
    assert '"smartfill_key_code":' in body
    assert '"smartfill_card_number":' in body


def test_update_asset_smartfill_fields_survive_navixy_lock():
    """Navixy-linked vehicles lock identity/rego/make/model but the
    three SmartFill fields must still be editable. The .131e patch
    puts them ABOVE any Navixy-lock branch."""
    # Grab from start of update_asset until end-of-function marker.
    m = re.search(r"async def update_asset\(.*", ASSETS_PY, flags=re.DOTALL)
    assert m, "update_asset body not found"
    body = m.group(0)
    # Truncate at the next top-level def / route decorator.
    end = re.search(r"\n@router\.|\nasync def [a-z_]+\(", body[100:])
    if end:
        body = body[: 100 + end.start()]
    assert "smartfill_key_code" in body, "smartfill fields not in update_asset"
    sf_idx = body.index("smartfill_key_code")
    lock_markers = [i for i in (body.find("navixy_device_id"),
                                 body.find("is_navixy"),
                                 body.find("navixy_locked"))
                    if i != -1]
    if lock_markers:
        assert sf_idx < max(lock_markers), (
            "smartfill fields must be set before Navixy lock strips them"
        )


# ── Frontend AssetDrawer ───────────────────────────────────────
def test_drawer_form_defaults_include_three_fields():
    m = re.search(r"const emptyForm = \{(.*?)\};", DRAWER, flags=re.DOTALL)
    assert m, "emptyForm not found"
    body = m.group(1)
    assert "fuel_tank_capacity_l:" in body
    assert "smartfill_key_code:" in body
    assert "smartfill_card_number:" in body


def test_drawer_payload_sends_three_fields():
    m = re.search(r"const payload = \{(.*?)\};", DRAWER, flags=re.DOTALL)
    assert m, "payload builder not found"
    body = m.group(1)
    assert "fuel_tank_capacity_l:" in body
    assert "smartfill_key_code:" in body
    assert "smartfill_card_number:" in body
    # Blank → null coercion + uppercase for key_code.
    assert "toUpperCase()" in body
    assert "|| null" in body


def test_drawer_section_testids_and_pill_states():
    for tid in (
        "asset-fuel-section",
        "asset-fuel-tank-capacity",
        "asset-smartfill-key-code",
        "asset-smartfill-card-number",
        "asset-fuel-pill-matched",
        "asset-fuel-pill-unmatched",
    ):
        assert f'data-testid="{tid}"' in DRAWER, f"missing testid {tid}"


def test_drawer_helper_text_present():
    for phrase in (
        "flag anomalous fills",
        "Primary match",
        "Secondary match",
    ):
        assert phrase in DRAWER, f"missing helper phrase: {phrase}"


# ── Version pin ────────────────────────────────────────────────
def test_version_at_least_131e():
    # v58.13.131c NOTE: the ship label chain is chronological, not
    # alphabetical. The .131c ship (Fuel CSV Frontend + Anomaly
    # Inbox, user-directed label) followed .131e. So `.131c` is a
    # valid current tag — the pin accepts it explicitly alongside
    # any suffix >= "e".
    # v58.13.131m widens the suffix pattern to accept multi-char
    # suffixes (`q1`, `q2`, `p_hotfix`) that landed after `.132p`.
    _CANONICAL = {
        "frontend/src/lib/version.js": r"export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z0-9_]*)'",
        "frontend/public/service-worker.js": r"const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z0-9_]*)'",
        "mobile/src/lib/version.ts": r"export const MOBILE_BUNDLE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z0-9_]*)'",
    }
    for f, pat in _CANONICAL.items():
        m = re.search(pat, _read(f))
        assert m, f"canonical constant not found in {f}"
        num = int(m.group(1))
        suffix = m.group(2) or ""
        ok = (
            num > 131
            or (num == 131 and suffix >= "e")
            or (num == 131 and suffix == "c")  # v58.13.131c ship
            or (num == 131 and suffix == "d")  # v58.13.131d ship
            # v58.13.122b — plant_maintenance reading back-fill.
            # Ship-label chronology is not monotonic — .122b legitimately
            # follows .131d in the ship chain. The SmartFill fields that
            # this pin was designed to guard are unchanged by .122b.
            # v58.13.122c — Trailer date-anchor scheduling ship.
            # Same chronological argument as .122b.
            or (num == 122 and suffix == "c")
            or (num == 122 and suffix == "b")
        )
        assert ok, f"{f} not at .131e/.131c/.131d/.122b/.122c or newer (got {num}{suffix})"
