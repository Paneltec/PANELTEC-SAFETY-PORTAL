"""v58.13.130a — Quick Log Service technician picker uses the shared
TechnicianPicker (searchable autocomplete + tech-only role narrowing),
matching the Service Check Sheet's UX.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


PICKER = _read("frontend/src/components/TechnicianPicker.jsx")
TABS = _read("frontend/src/components/AssetServiceTabs.jsx")
SHEET = _read("frontend/src/components/ServiceCheckSheetModal.jsx")


# ── Shared component exists and shape is right ──────────────────
def test_shared_picker_component_exists_and_exports():
    assert "export function TechnicianPicker(" in PICKER
    assert "export default TechnicianPicker" in PICKER


def test_shared_picker_emits_expected_testids():
    for suffix in ("-select", "-freetext", "-freetext-toggle",
                   "-back-to-picker", "-opt-"):
        assert f'data-testid={{`${{testidPrefix}}{suffix}' in PICKER \
            or f'data-testid={{`${{testidPrefix}}{suffix}${{t.id}}`}}' in PICKER, (
                f"picker missing testid suffix {suffix}"
            )


def test_shared_picker_autoflips_on_empty_and_legacy_value():
    # Two useEffect blocks — one for empty list, one for legacy value.
    assert 'list.length === 0 && mode !== \'freetext\'' in PICKER
    assert 'list.length > 0' in PICKER
    # Legacy fallback: non-empty name that doesn't match any row.
    assert '!list.some(' in PICKER


# ── RecordEditor (Quick Log Service) rewired ────────────────────
def test_record_editor_imports_shared_picker():
    assert "from './TechnicianPicker'" in TABS
    assert "TechnicianPicker" in TABS


def test_record_editor_fetches_from_fleet_technicians():
    """The `/workers/directory` fetch inside RecordEditor must be
    gone and replaced with the narrower `/fleet/technicians`."""
    # Locate the RecordEditor function body.
    idx = TABS.index("export function RecordEditor(")
    body = TABS[idx:]
    # Old fetch string must not appear inside RecordEditor.
    # It's still allowed elsewhere in the file (ScheduleEditor uses it).
    old_fetch = "'/workers/directory'"
    assert body.count(old_fetch) == 0, (
        "RecordEditor still fetches /workers/directory — must use /fleet/technicians"
    )
    assert "'/fleet/technicians'" in body


def test_record_editor_renders_picker_with_effective_techs():
    idx = TABS.index("export function RecordEditor(")
    body = TABS[idx:]
    assert '<TechnicianPicker' in body
    assert 'technicians={effectiveTechs}' in body
    assert 'testidPrefix="rec-tech"' in body
    # onChange sets both id and name on the form.
    m = re.search(
        r"onChange=\{\(\{ id, name \}\) => setForm\(\(f\) => \(\{[^}]*technician_id: id \|\| ''[^}]*technician_name: name \|\| ''",
        body, flags=re.DOTALL,
    )
    assert m, "picker onChange must write both technician_id + technician_name"


def test_record_editor_old_select_block_gone():
    idx = TABS.index("export function RecordEditor(")
    body = TABS[idx:]
    # Old `<select data-testid="rec-tech-select">` and its option
    # rendering must be gone; the picker emits the testid via
    # template literal now.
    assert 'data-testid="rec-tech-select"' not in body, (
        "old <select> testid still present as a literal — should be templated"
    )
    # `rec-tech-opt-` was the option-level testid inside the old
    # select. Only the picker renders it now (via template literal
    # `${testidPrefix}-opt-${t.id}`), so it must NOT appear as a
    # plain string literal in RecordEditor.
    assert 'rec-tech-opt-' not in body, (
        "old `rec-tech-opt-` option-testid literal still present"
    )


def test_record_editor_position_hint_preserved():
    """The zero-match hint under the Technician field must survive."""
    idx = TABS.index("export function RecordEditor(")
    body = TABS[idx:]
    assert 'data-testid="technician-position-hint-no-match"' in body
    assert "No workers listed with this position" in body


# ── ServiceCheckSheetModal now delegates to the shared picker ───
def test_check_sheet_imports_and_uses_shared_picker():
    assert "from './TechnicianPicker'" in SHEET
    assert "<TechnicianPicker" in SHEET
    assert 'testidPrefix="sheet-technician"' in SHEET


def test_check_sheet_inline_datalist_gone():
    assert 'id="sheet-technician-datalist"' not in SHEET
    assert 'list="sheet-technician-datalist"' not in SHEET
    # Old freetext toggle button literal is gone (picker emits it via template).
    assert 'data-testid="sheet-technician-freetext-toggle"' not in SHEET


def test_check_sheet_technician_mode_state_retired():
    """The `technicianMode` local state should be gone — the picker
    manages its own picker↔freetext toggle now."""
    assert "const [technicianMode" not in SHEET
    assert "setTechnicianMode(" not in SHEET


def test_check_sheet_buildpayload_single_find_contract():
    """buildPayload's tech resolution must:
      · id-first, then case-insensitive name match on the list,
      · fall through to freetext via `|| technicianName`.
    """
    m = re.search(
        r"const tech = technicians\.find\((.*?)\);",
        SHEET, flags=re.DOTALL,
    )
    assert m, "single-find shape not present in buildPayload"
    body = m.group(1)
    assert "t.id === technicianId" in body
    assert "t.name.toLowerCase() === technicianName.toLowerCase()" in body


# ── Version sync forward-safe pin ────────────────────────────────
def test_version_sync_at_least_130a():
    """Accept `.130a` exactly OR any numerically newer `.131+` ship."""
    _CANONICAL = {
        "frontend/src/lib/version.js": r"export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z]?)'",
        "frontend/public/service-worker.js": r"const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z]?)'",
        "mobile/src/lib/version.ts": r"export const MOBILE_BUNDLE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z]?)'",
    }
    for f, pat in _CANONICAL.items():
        m = re.search(pat, _read(f))
        assert m, f"canonical constant not found in {f}"
        num = int(m.group(1))
        suffix = m.group(2) or ""
        # v58.13.122b — .122b ship (plant_maintenance reading back-fill)
        # follows chronologically but its numeric label is < 130. The
        # .130a feature this pin guards is unchanged by .122b.
        assert (num > 130 or (num == 130 and suffix >= "a")
                or (num == 122 and suffix in {"b", "c"})), (
            f"{f} not at .130a or newer (got {num}{suffix})"
        )
