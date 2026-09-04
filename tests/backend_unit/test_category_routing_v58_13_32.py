"""v58.13.32 — Category-aware routing pytests.

Covers `_should_write_prestarts_shim(category, template_name)` — the
pure helper the promotion block now consults instead of the legacy
name-based substring gate.

Six scenarios (matching the ship brief):
  1. category=pre_start          → shim (regression guard for v58.13.29)
  2. category=plant_pre_start    → shim
  3. category=hazard             → NO shim (new — was polluting pre_starts)
  4. category=permit             → NO shim
  5. category=swms               → NO shim
  6. unknown category            → backward-compat name-based fallback
     (unknown but name says pre-start → shim; else → no shim)

Placed under /app/tests/backend_unit/ per v58.13.10.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

_BACKEND = Path("/app/backend")
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from bulk_import_prestarts import _should_write_prestarts_shim  # noqa: E402


# ---------------------------------------------------------------------------
# 1-2. Pre-start categories — shim written
# ---------------------------------------------------------------------------
def test_prestart_category_writes_shim():
    assert _should_write_prestarts_shim("pre_start", "Daily Pre-Start") is True


def test_plant_prestart_category_writes_shim():
    assert _should_write_prestarts_shim(
        "plant_pre_start", "Plant Pre-Start Checklist (Heavy Equipment)"
    ) is True


# ---------------------------------------------------------------------------
# 3-5. Non-pre-start categories — shim SUPPRESSED
# ---------------------------------------------------------------------------
def test_hazard_category_does_not_write_shim():
    """The 3 231 SSRA rows that currently pollute pre_starts came in
    with category=hazard. This gate stops future ones."""
    assert _should_write_prestarts_shim(
        "hazard", "Construction & Excavation SSRA"
    ) is False


def test_permit_category_does_not_write_shim():
    assert _should_write_prestarts_shim(
        "permit", "Excavation Permit NDD"
    ) is False


def test_swms_category_does_not_write_shim():
    assert _should_write_prestarts_shim(
        "swms", "SWMS - Concrete Cutting"
    ) is False


# ---------------------------------------------------------------------------
# 6. Unknown / missing category — legacy name-based fallback
# ---------------------------------------------------------------------------
def test_no_category_but_prestart_name_still_writes_shim():
    """Pre-v58.10.3 cache rows never had `category` stamped. Legacy
    name-based check kicks in so we don't accidentally drop them."""
    assert _should_write_prestarts_shim(
        None, "Daily Pre-Start"
    ) is True
    assert _should_write_prestarts_shim(
        "", "Weekly Pre Start"
    ) is True  # "pre start" variant matched
    assert _should_write_prestarts_shim(
        "", "Vehicle Pre-Use Checklist"
    ) is True  # "checklist" fallback matched


def test_no_category_and_ssra_name_does_not_write_shim():
    """The backward-compat fallback should NOT catch SSRA-named rows —
    they don't contain "pre-start" or "checklist" and lose the shim
    even without category."""
    assert _should_write_prestarts_shim(
        None, "Construction & Excavation SSRA"
    ) is False
    assert _should_write_prestarts_shim(
        "", "Viatec Traffic Solutions SSRA"
    ) is False


def test_completely_empty_inputs_do_not_write_shim():
    assert _should_write_prestarts_shim(None, None) is False
    assert _should_write_prestarts_shim("", "") is False


# ---------------------------------------------------------------------------
# Case-insensitive matching
# ---------------------------------------------------------------------------
def test_category_matching_is_case_insensitive():
    assert _should_write_prestarts_shim("HAZARD", "X") is False
    assert _should_write_prestarts_shim(" Pre_Start ", "X") is True
    assert _should_write_prestarts_shim("HAZARD", "Daily Pre-Start") is False
    # Category always wins over the name-fallback path.
    assert _should_write_prestarts_shim(
        "hazard", "Daily Pre-Start"  # name says pre-start, category says hazard
    ) is False


# ---------------------------------------------------------------------------
# Regression: unknown category ("random") with a non-pre-start name
# ---------------------------------------------------------------------------
def test_unknown_category_random_name_does_not_write_shim():
    assert _should_write_prestarts_shim(
        "some_new_category", "Random Form Name"
    ) is False


# ---------------------------------------------------------------------------
# Version-sync
# ---------------------------------------------------------------------------
def test_version_sync_current():
    import re
    running = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+[a-z]*)'", running)
    assert m
    current = m.group(1)
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile
