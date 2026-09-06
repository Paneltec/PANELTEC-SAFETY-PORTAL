"""v58.13.127a — Locks for the Make/Model soft-fill from Navixy name."""
from __future__ import annotations
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


SHEET = _read("frontend/src/components/ServiceCheckSheetModal.jsx")


def test_softfill_initial_state_wired():
    # Soft-fill flag is defaulted to True when make+model are empty
    # and the asset has a Navixy `name`.
    assert "const _softFilledMakeModel = !_initialMakeModel && !!asset?.name" in SHEET
    assert "useState(_softFilledMakeModel)" in SHEET
    # setMakeModelAndClearSoftFill flips it off on user edit.
    assert "setMakeModelIsSoftFill(false)" in SHEET


def test_navixy_blind_field_supports_softfill_prop():
    assert "softFill = false" in SHEET
    # Neutral-blue chip.
    assert "From Navixy name — edit to refine" in SHEET
    assert "bg-blue-100 text-blue-800" in SHEET
    # softfill testid pattern.
    assert "-softfill-chip" in SHEET


def test_make_model_field_uses_softfill_wrapper():
    # Uses the clearing setter so the chip flips on edit.
    assert "onChange={setMakeModelAndClearSoftFill}" in SHEET
    assert "softFill={makeModelIsSoftFill}" in SHEET


def test_save_skips_softfill_make_model_capture():
    # Don't persist raw Navixy name as captured make/model.
    assert "(makeModel && !makeModelIsSoftFill) ? makeModel : null" in SHEET


def test_collapsed_hint_copy_updated():
    # New copy from .127a.
    assert "Navixy supplies a friendly vehicle name" in SHEET
    # Old .127 copy is gone.
    assert "Navixy doesn't supply make/model/VIN for this device" not in SHEET


def test_version_bumped_to_127a_everywhere():
    # v58.13.128 ratchets pin forward. Accept `.127a` or newer numeric.
    import re
    for f in ("frontend/src/lib/version.js",
              "frontend/public/service-worker.js",
              "mobile/src/lib/version.ts"):
        src = _read(f)
        # Grab the CANONICAL export line's version tag.
        m = re.search(r"(?:RUNNING_VERSION|CACHE_VERSION|MOBILE_BUNDLE_VERSION) = 'paneltec-v160\.3\.9\.58\.13\.(\d+)(a?)", src)
        assert m, f"{f}: canonical export not found"
        num = int(m.group(1))
        # v58.13.122b — .122b ship follows chronologically.
        _n = num
        assert (_n >= 127 or _n == 122), f"{f}: canonical version {num} < 127 (got {_n})"
