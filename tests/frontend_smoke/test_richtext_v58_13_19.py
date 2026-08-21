"""v58.13.19 — Rich-text editor + checklist link picker frontend smoke.

Static grep only. Placed under `/app/tests/frontend_smoke/` per the
v58.13.10 hard rule (never `/app/backend/`). Verifies structural
invariants without spinning up a JS runtime:
  · RichTextEditor + ChecklistLinkPicker component files exist with
    the expected exports and toolbar shape.
  · Plain / Rich toggle wired into ScheduleEditor with plain default
    in code + localStorage key.
  · Rich → Plain confirm dialog present with `hasHtmlTags` guard.
  · Read-only description preview in ServiceSchedulesTab gated on
    `s.description_html` and uses `dangerouslySetInnerHTML` on the
    already-bleached value.
  · ChecklistLinkPicker fetches from `/forms/templates` (the actual
    route Forms.jsx uses).
  · v58.13.10 flash-bug guardrail: picker item + toolbar-trigger
    handlers call `e.stopPropagation()`.
  · Forms.jsx consumes `?template_id=<id>` and opens PreviewModal.
  · Version-sync guardrail still passes.
"""
from __future__ import annotations
from pathlib import Path

APP = Path("/app")
RTE = APP / "frontend/src/components/RichTextEditor.jsx"
PICKER = APP / "frontend/src/components/ChecklistLinkPicker.jsx"
ASSET_TABS = APP / "frontend/src/components/AssetServiceTabs.jsx"
FORMS = APP / "frontend/src/pages/Forms.jsx"


def test_rte_component_exists_and_has_8_toolbar_buttons():
    src = RTE.read_text(encoding="utf-8")
    assert "export default function RichTextEditor(" in src
    for tid in ("rte-bold", "rte-italic", "rte-underline",
                "rte-ul", "rte-ol", "rte-h3", "rte-link", "rte-checklist"):
        assert f'`${{testid}}-{tid.split("-", 1)[1]}`' in src, (
            f"missing toolbar testid slot for {tid}"
        )
    # The content-editable surface itself.
    assert 'contentEditable' in src
    # execCommand-based commands. `cmd()` helper wraps
    # `document.execCommand(name, false, arg)` and is invoked by each
    # toolbar button.
    assert "document.execCommand(name, false, arg)" in src
    assert "cmd('bold')" in src
    assert "cmd('italic')" in src
    assert "cmd('underline')" in src
    assert "cmd('insertUnorderedList')" in src
    assert "cmd('insertOrderedList')" in src
    # Paste-scrubber walks the DOM.
    assert "scrubPastedHtml" in src or "KEEP_TAGS" in src


def test_checklist_picker_fetches_correct_route_and_stops_propagation():
    src = PICKER.read_text(encoding="utf-8")
    assert "export default function ChecklistLinkPicker(" in src
    # Endpoint — matches what Forms.jsx uses.
    assert "api.get('/forms/templates')" in src
    # Backdrop close pattern (v58.13.10 flash-bug).
    assert "e.target === e.currentTarget" in src
    # Item-click stops propagation + prevents default.
    assert "e.stopPropagation()" in src
    assert "e.preventDefault()" in src
    # `onPick(templateId, templateName)` contract.
    assert "onPick(t.id, t.name)" in src
    # UI states.
    for tid in ("checklist-picker-loading", "checklist-picker-empty",
                "checklist-picker-list", "checklist-picker-search",
                "checklist-picker-close", "checklist-picker-cancel"):
        assert f'data-testid="{tid}"' in src, f"missing testid {tid}"


def test_toggle_wired_into_schedule_editor_with_plain_default():
    src = ASSET_TABS.read_text(encoding="utf-8")
    # Imports.
    assert "import RichTextEditor from './RichTextEditor'" in src
    assert "import ChecklistLinkPicker from './ChecklistLinkPicker'" in src
    # localStorage key.
    assert "paneltec_schedule_desc_editor_mode" in src
    # Toggle testids.
    for tid in ("sch-desc-mode-toggle", "sch-desc-mode-plain",
                "sch-desc-mode-rich"):
        assert f'data-testid="{tid}"' in src, f"missing testid {tid}"
    # Plain default: `loadEditorMode` returns 'plain' unless
    # localStorage returned 'rich'.
    assert "return v === 'rich' ? 'rich' : 'plain'" in src, (
        "loadEditorMode must default to plain"
    )
    # RichTextEditor mount path.
    assert "<RichTextEditor" in src
    # Legacy plain textarea preserved (data-testid unchanged from
    # pre-v58.13.19 so any existing e2e that clicks it still works).
    assert 'data-testid="sch-description-html"' in src


def test_rich_to_plain_confirm_with_html_detection():
    src = ASSET_TABS.read_text(encoding="utf-8")
    # Detection helper.
    assert "hasHtmlTags" in src
    # Strip helper.
    assert "stripToPlain" in src
    # Confirm dialog testids.
    for tid in ("sch-desc-plain-confirm", "sch-desc-plain-confirm-ok",
                "sch-desc-plain-confirm-cancel"):
        assert f'data-testid="{tid}"' in src, f"missing testid {tid}"
    # Silent-swap-when-empty behaviour (the popup is gated on the
    # hasHtmlTags check).
    assert "hasHtmlTags(form.description_html)" in src


def test_readonly_preview_in_service_schedules_tab():
    src = ASSET_TABS.read_text(encoding="utf-8")
    # Conditional on description_html.
    assert "s.description_html && (" in src
    # dangerouslySetInnerHTML on the bleached value.
    assert "dangerouslySetInnerHTML={{ __html: s.description_html }}" in src
    # Preview testid.
    assert 'data-testid={`schedule-desc-preview-${s.id}`}' in src


def test_forms_page_consumes_template_id_query_param():
    src = FORMS.read_text(encoding="utf-8")
    # New useEffect keyed on template_id.
    assert "params.get('template_id')" in src
    # Opens the preview modal (setPreviewT), not the fill-out modal
    # (which would be setFillTemplate).
    # Regex-lite: the block must reference setPreviewT after reading
    # template_id.
    idx = src.find("params.get('template_id')")
    assert idx > 0
    assert "setPreviewT" in src[idx: idx + 800], (
        "template_id handler must open PreviewModal via setPreviewT"
    )
    # Replaces URL to prevent re-trigger.
    assert "navigate('/app/forms', { replace: true })" in src[idx: idx + 800]


def test_version_sync_still_green():
    """Re-assert the three canonical files agree on the CURRENT
    RUNNING_VERSION (read dynamically so this test survives future
    bumps). Full guardrail is at test_version_sync_v58_13_13.py."""
    import re
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'", running)
    assert m, "RUNNING_VERSION export not found"
    current = m.group(1)
    assert f"'{current}'" in sw, f"service-worker CACHE_VERSION != {current}"
    assert f"'{current}'" in mobile, f"mobile MOBILE_BUNDLE_VERSION != {current}"
