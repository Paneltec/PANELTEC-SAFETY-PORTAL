"""v58.13.36 — Category-aware SubmissionViewer detail-sections FE smoke.

Asserts against source strings (no jsdom, no browser). Covers:
  · helper `lib/detailViewCategory.js` presence + expected exports
  · `SubmissionViewer.jsx` imports + wiring of the new helper
  · category pill rendered in the header with a stable testid
  · `<Sections>` switch renders pre_start → CHECKLIST-only, hazard/swms
    → HAZARDS + CREW + SIGNATURES + CHECKLIST, permit → HAZARDS +
    SIGNATURES + CHECKLIST
  · partial-re-extract banner keys off `v58_13_35_partial_cache_only`
  · every new section has a distinct testid
  · flash-bug guardrail: no fetch()/api.get inside SubmissionViewer's
    new memoisation blocks
  · version-sync pytest
"""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
HELPER = APP / "frontend/src/lib/detailViewCategory.js"
VIEWER = APP / "frontend/src/components/SubmissionViewer.jsx"


# ─── helper module ───────────────────────────────────────────────────

def test_helper_file_exists():
    assert HELPER.exists()


def test_helper_exports_resolve_category():
    src = HELPER.read_text(encoding="utf-8")
    assert "export function resolveCategory" in src


def test_helper_exports_palette_and_marker_utils():
    src = HELPER.read_text(encoding="utf-8")
    assert "export function paletteForCategory" in src
    assert "export function isPartialCacheOnlyReextract" in src
    assert "export function isMeaningfulValue" in src


def test_helper_resolves_from_snapshot_first():
    src = HELPER.read_text(encoding="utf-8")
    # template_category_snapshot is the first probe in resolveCategory.
    fn = src[src.index("export function resolveCategory"):]
    assert "template_category_snapshot" in fn
    # Must fall back to template_name_snapshot AND work_summary.
    assert "template_name_snapshot" in fn
    assert "work_summary" in fn


def test_helper_recognises_all_expected_categories():
    src = HELPER.read_text(encoding="utf-8")
    # Palette map covers every category token used by <Sections>.
    for tok in ("pre_start", "plant_pre_start", "hazard", "swms",
                "permit", "inspection", "unknown"):
        assert f"{tok}:" in src or f'"{tok}"' in src or f"'{tok}'" in src


def test_helper_keyword_rules_include_ssra_and_prestart():
    src = HELPER.read_text(encoding="utf-8")
    # Explicit SSRA → hazard rule
    assert re.search(r"/\\?bssra\\?b/i.*?hazard", src, re.DOTALL) is not None
    # pre-start → pre_start rule
    assert re.search(r"pre-?start.*?pre_start", src, re.DOTALL) is not None


def test_helper_meaningful_value_skips_none_and_empty():
    """`isMeaningfulValue` must reject `null`, empty strings, and
    the extractor's stringified Python `None` sentinel."""
    src = HELPER.read_text(encoding="utf-8")
    fn = src[src.index("export function isMeaningfulValue"):]
    assert "'none'" in fn.lower() or '"none"' in fn.lower()
    assert "== null" in fn or "=== null" in fn or "v == null" in fn
    # Empty-array and empty-object handling.
    assert "Array.isArray" in fn
    assert "Object.keys" in fn


def test_partial_reextract_marker_matches_v58_13_35_reason():
    src = HELPER.read_text(encoding="utf-8")
    assert "v58_13_35_partial_cache_only" in src


# ─── SubmissionViewer wiring ─────────────────────────────────────────

def test_viewer_imports_helper():
    src = VIEWER.read_text(encoding="utf-8")
    assert "from '../lib/detailViewCategory'" in src
    for sym in ("resolveCategory", "paletteForCategory",
                "isPartialCacheOnlyReextract", "isMeaningfulValue"):
        assert sym in src


def test_viewer_renders_category_pill_in_header():
    src = VIEWER.read_text(encoding="utf-8")
    assert "submission-viewer-type-pill-${category}" in src


def test_viewer_renders_sections_component():
    src = VIEWER.read_text(encoding="utf-8")
    # Sections switch is defined and used.
    assert "export function Sections" in src
    assert "<Sections" in src


def test_sections_switch_covers_all_branches():
    src = VIEWER.read_text(encoding="utf-8")
    # hazard AND swms → HAZARDS + CREW + SIGNATURES + CHECKLIST
    assert re.search(
        r"category === 'hazard' \|\| category === 'swms'", src)
    # permit → HAZARDS + SIGNATURES + CHECKLIST (no CREW)
    assert "category === 'permit'" in src


def test_hazard_swms_branch_renders_crew_section():
    src = VIEWER.read_text(encoding="utf-8")
    hazard_block_start = src.index("category === 'hazard' || category === 'swms'")
    permit_block_start = src.index("category === 'permit'")
    hazard_block = src[hazard_block_start:permit_block_start]
    assert "submission-viewer-section-hazards" in hazard_block
    assert "submission-viewer-section-crew" in hazard_block
    assert "submission-viewer-section-signatures" in hazard_block


def test_permit_branch_omits_crew_section():
    src = VIEWER.read_text(encoding="utf-8")
    permit_block_start = src.index("category === 'permit'")
    # Anchor on the return statement that follows the permit branch.
    permit_block = src[permit_block_start:permit_block_start + 900]
    assert "submission-viewer-section-hazards" in permit_block
    assert "submission-viewer-section-signatures" in permit_block
    # Crew intentionally NOT in permit branch.
    assert "submission-viewer-section-crew" not in permit_block


def test_prestart_branch_is_checklist_only():
    src = VIEWER.read_text(encoding="utf-8")
    # The final (fall-through) return is the checklist-only branch;
    # it renders neither Hazards nor Crew nor Signatures.
    # Locate the last data-testid="submission-viewer-sections-${category}"
    idx = src.rindex("submission-viewer-sections-${category}")
    tail = src[idx:idx + 400]
    assert "submission-viewer-section-checklist" in tail or "{checklist}" in tail
    assert "submission-viewer-section-hazards" not in tail
    assert "submission-viewer-section-crew" not in tail


def test_checklist_section_falls_back_to_field_index_label():
    """When `fields[i].label` is empty (imported records), the
    CHECKLIST must synthesise a `Field N` label instead of rendering
    a bare em-dash."""
    src = VIEWER.read_text(encoding="utf-8")
    assert re.search(r"Field \$\{i \+ 1\}", src)


def test_partial_reextract_banner_present_with_testid():
    src = VIEWER.read_text(encoding="utf-8")
    assert 'data-testid="submission-viewer-partial-reextract-banner"' in src
    # Banner is gated on the marker helper.
    assert "partialReextract" in src


def test_viewer_uses_memo_for_category_and_fields():
    """Flash-bug guardrail (v58.13.10): the new category / meaningful
    fields computation MUST be memoised so opening the modal doesn't
    trigger repeated re-renders + flicker."""
    src = VIEWER.read_text(encoding="utf-8")
    assert "useMemo" in src
    assert "resolveCategory(r)" in src
    # meaningful-fields filter is memoised too.
    assert re.search(r"useMemo\(.*?filter\(", src, re.DOTALL) is not None


def test_viewer_new_sections_do_not_fetch():
    """Flash-bug guardrail: no api calls / fetch inside the sections."""
    src = VIEWER.read_text(encoding="utf-8")
    sections_start = src.index("export function Sections")
    # Confine to the Sections helpers block (through the default export).
    sections_block = src[
        src.index("function Section({"):src.index("export default function")]
    for banned in ("api.get(", "api.post(", "fetch(", "axios.",
                   "useEffect("):
        assert banned not in sections_block, \
            f"Sections block must not call {banned!r} (flash-bug)."
    del sections_start


def test_viewer_pre_start_pill_uses_paneltec_blue():
    """The PRE-START pill must render in the brand primary blue
    (#2C6BFF) per the ship brief."""
    src = HELPER.read_text(encoding="utf-8")
    assert "#2C6BFF" in src


# ─── version-sync ────────────────────────────────────────────────────

def test_version_sync_current():
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'",
                  running)
    assert m
    current = m.group(1)
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile
