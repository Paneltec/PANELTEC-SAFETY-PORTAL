"""v58.13.102 — Purge Test Data modal viewport-safe restructure +
touch-friendly ack checkbox + auto-focus + sticky footer.

Source-scan tests only. The .101 friction root cause was viewport
height math — a modal with no max-h and no scroll placing the ack
checkbox below the visible viewport on short screens. This test file
pins the restructure so a future refactor can't silently regress it.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

SYSSET_JSX = (FRONTEND / "src" / "pages" / "SystemSettings.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Modal outer container: overflow + a11y ────────────────────────

def test_modal_backdrop_has_overflow_and_a11y():
    """Backdrop container must be scrollable as last-line-of-defence on
    tiny viewports, AND expose ARIA dialog semantics."""
    m = re.search(
        r'data-testid="purge-test-data-modal"[\s\S]{0,20}'  # nothing between the pattern below
        , SYSSET_JSX,
    )
    # Full anchor: overflow-y-auto + role=dialog + aria-modal + aria-labelledby
    m2 = re.search(
        r'className="fixed\s+inset-0\s+z-\[90\][^"]*overflow-y-auto"[\s\S]{0,200}?'
        r'role="dialog"[\s\S]{0,100}?'
        r'aria-modal="true"[\s\S]{0,100}?'
        r'aria-labelledby="purge-modal-title"',
        SYSSET_JSX,
    )
    assert m2, (
        "Modal backdrop missing overflow-y-auto or ARIA dialog attrs "
        "(role/aria-modal/aria-labelledby) — .102 viewport-safety regressed"
    )


def test_h3_title_has_id_matching_aria_labelledby():
    """The h3 must carry `id=\"purge-modal-title\"` to match the
    backdrop's aria-labelledby, otherwise the ARIA linkage is broken."""
    m = re.search(
        r'<h3\s+id="purge-modal-title"',
        SYSSET_JSX,
    )
    assert m, "h3 missing id='purge-modal-title' — aria-labelledby will not resolve"


# ── Inner container: bounded flex column ─────────────────────────

def test_modal_inner_is_bounded_flex_column():
    """Inner container must be a flex column with a max-h cap so it
    never bleeds off the viewport. This is the ROOT fix for the .101
    checkbox-off-screen friction."""
    m = re.search(
        r'data-testid="purge-test-data-modal-inner"[\s\S]{0,300}',
        SYSSET_JSX,
    )
    assert m, "modal inner container missing purge-test-data-modal-inner testid"
    m2 = re.search(
        r'className="[^"]*flex\s+flex-col[^"]*max-h-\[calc\(100vh-2rem\)\][^"]*"[\s\S]{0,80}?'
        r'data-testid="purge-test-data-modal-inner"',
        SYSSET_JSX,
    )
    assert m2, (
        "modal inner container is not `flex flex-col max-h-[calc(100vh-2rem)]` "
        "— the viewport-safety cap is missing"
    )


def test_scroll_region_and_sticky_footer_present():
    """Middle table region must be `flex-1 min-h-0 overflow-y-auto` so
    it scrolls INTERNALLY while header + footer stay put. Footer must
    carry the sticky-footer testid."""
    m = re.search(
        r'className="[^"]*flex-1[^"]*min-h-0[^"]*overflow-y-auto[^"]*"[\s\S]{0,80}?'
        r'data-testid="purge-test-data-modal-scroll"',
        SYSSET_JSX,
    )
    assert m, "scroll region missing flex-1/min-h-0/overflow-y-auto"
    assert 'data-testid="purge-test-data-modal-footer"' in SYSSET_JSX, (
        "sticky footer region missing purge-test-data-modal-footer testid"
    )


def test_footer_has_border_top_and_flex_shrink():
    """Footer must have `border-t` (visual separation from scroll body)
    and NOT be inside the scroll region (i.e. `flex-shrink-0` so it
    keeps its own height)."""
    m = re.search(
        r'className="[^"]*border-t[^"]*flex-shrink-0[^"]*"[\s\S]{0,80}?'
        r'data-testid="purge-test-data-modal-footer"',
        SYSSET_JSX,
    )
    assert m, "footer missing border-t or flex-shrink-0 — sticky behaviour broken"


# ── Ack checkbox: h-5 w-5 + auto-focus + accent ──────────────────

def test_ack_checkbox_is_touch_friendly():
    """Ack checkbox must be `h-5 w-5` (20 px, touch-target) with
    `accent-rose-600` so the tick is instantly visible."""
    m = re.search(
        r'type="checkbox"[\s\S]{0,400}?className="[^"]*h-5\s+w-5[^"]*accent-rose-600[^"]*"[\s\S]{0,200}?'
        r'data-testid="purge-ack"',
        SYSSET_JSX,
    )
    assert m, (
        "ack checkbox is not h-5 w-5 accent-rose-600 — still using the "
        "default browser size (~13 px), too small on mobile"
    )


def test_ack_checkbox_has_ref():
    """Auto-focus depends on `ref={ackRef}`. Without it the useEffect
    can't call `.focus()`."""
    assert re.search(
        r'const\s+ackRef\s*=\s*React\.useRef\(null\)',
        SYSSET_JSX,
    ), "ackRef useRef missing"
    m = re.search(
        r'ref=\{ackRef\}[\s\S]{0,300}?data-testid="purge-ack"',
        SYSSET_JSX,
    )
    assert m, "ack checkbox missing ref={ackRef} — auto-focus won't work"


def test_auto_focus_effect_gated_correctly():
    """Auto-focus effect must be gated on `open && dry && dry.grand_total > 0
    && !ack && ackRef.current` so it doesn't fire when there's nothing to
    ack, doesn't refocus after the user ticks, and doesn't NPE on the ref."""
    m = re.search(
        r'React\.useEffect\(\s*\(\)\s*=>\s*\{[\s\S]{0,300}?'
        r'if\s*\(\s*open\s*&&\s*dry\s*&&\s*dry\.grand_total\s*>\s*0\s*&&\s*!ack\s*&&\s*ackRef\.current\s*\)[\s\S]{0,200}?'
        r'ackRef\.current\.focus\(',
        SYSSET_JSX,
    )
    assert m, "auto-focus useEffect gate is missing or wrong"


# ── Ack label conditional highlight ──────────────────────────────

def test_ack_label_highlights_when_unticked():
    """Label wrapper must switch to rose-50 background when
    `!ack && dry.grand_total > 0` so it visually pops."""
    m = re.search(
        r"!ack\s*&&\s*dry\.grand_total\s*>\s*0\s*\?\s*'bg-rose-50\s+border-rose-300[^']*'\s*:\s*'bg-slate-50",
        SYSSET_JSX,
    )
    assert m, (
        "ack label does not conditionally switch background — the "
        ".102 'scream at me' highlight is missing"
    )


# ── Safety gate regression guard ─────────────────────────────────

def test_delete_button_still_gated_on_ack():
    """The .101 test file already pinned this. Re-pin here because the
    .102 restructure moved the button; a mis-typed refactor could
    silently drop the ack from the disabled expression."""
    m = re.search(
        r'onClick=\{confirmDelete\}\s+disabled=\{!ack\s*\|\|\s*busy\s*\|\|\s*dry\.grand_total\s*===\s*0\}',
        SYSSET_JSX,
    )
    assert m, "Delete button ack-gate weakened by the .102 restructure"


def test_ack_required_hint_still_present_in_footer():
    """The .101 hint must still render on `!ack && dry.grand_total > 0
    && !busy`, and must live inside the sticky footer region."""
    footer_match = re.search(
        r'data-testid="purge-test-data-modal-footer"[\s\S]{0,3000}?</div>\s*\)\}',
        SYSSET_JSX,
    )
    assert footer_match, "sticky footer region not found"
    footer_body = footer_match.group(0)
    m = re.search(
        r'!ack\s*&&\s*dry\.grand_total\s*>\s*0\s*&&\s*!busy[\s\S]{0,400}?'
        r'data-testid="purge-ack-required-hint"',
        footer_body,
    )
    assert m, (
        ".101 ack-required hint is no longer inside the sticky footer "
        "OR has lost its gate"
    )


# ── Version-sync forward-safe pin >= 102 ─────────────────────────

def _tail(text, name):
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m, f"could not read tail of {name}"
    return int(m.group(1))


def test_running_version_gte_102():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 102


def test_cache_version_gte_102():
    assert _tail(SW_JS, "CACHE_VERSION") >= 102


def test_mobile_bundle_version_gte_102():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 102
