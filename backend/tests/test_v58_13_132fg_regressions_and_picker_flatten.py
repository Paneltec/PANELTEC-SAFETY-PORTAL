"""v58.13.132fg — Comprehensive fix ship.

Sub-commit 1 (Section C regressions):
  · C2 — Induction card modal wasn't opening in some browsers.
    Root cause: WorkerInductionsCard rendered a native <button>
    that contained FilePresenceChip's inner <button>. Nested
    interactive elements are invalid HTML — browsers reparent
    the tree and the outer click is swallowed. Fix: outer element
    is now a <div role="button"> with an onKeyDown handler for
    keyboard access. Same pattern the Section component
    already uses (see v160.3.6b).
  · C1 — "No option to add records to a worker profile" fixed
    as a side effect of C2 — empty induction slots use the same
    click handler as populated ones; the swallowed click was
    blocking the "add" flow too.
  · C3 — Photo alignment slider audit. Slider VERIFIED working
    in headless Chromium (both onChange fires AND
    style.object-position updates). Defensive `onInput` twin
    added to the range input for robustness against
    input-event-ordering quirks in extension-heavy browsers.

Sub-commit 2 (Section G — approvals picker flatten):
  · Removed the "Admins" / "Users" grouping. Every web user is
    an admin, grouping was noise.
  · Single alphabetical list.
  · Replaced "Select all admins" + "Select all" with a single
    "Select everyone" button. "Clear all" preserved.
  · Search field, empty-warning, self-missing hint all preserved.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
QLS = FE / "components" / "QuickLinksSection.jsx"
IND_CARD = FE / "components" / "WorkerInductionsCard.jsx"
WORKERS_PAGE = FE / "pages" / "Workers.jsx"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Section C2 / C1: induction card is now a <div role="button"> ─

def test_induction_card_no_longer_native_button():
    """v58.13.132fg root-cause fix. The outer induction card
    element must NOT be a native <button> because it contains
    FilePresenceChip's inner <button> (nested interactive
    elements are invalid HTML and cause Chrome to reparent the
    tree, swallowing the outer click)."""
    src = _read(IND_CARD)
    # Old pattern GONE: no outer <button type="button"
    # onClick={...openCard...}>.
    assert not re.search(
        r"<button\s+key=\{c\.column_key\}\s+type=\"button\"\s+onClick=\{\(\) => openCard",
        src), ("outer induction card must be a <div role=\"button\">, "
                "never a native <button>")
    # New pattern PRESENT: <div role="button" tabIndex={0} onClick={...openCard...}>
    assert re.search(
        r'<div\s+key=\{c\.column_key\}\s+role="button"\s+tabIndex=\{0\}',
        src), "outer card must render as <div role=\"button\" tabIndex={0}>"
    # Keyboard access preserved via onKeyDown.
    assert re.search(
        r"onKeyDown=\{\(e\) => \{[\s\S]{0,200}"
        r"if \(e\.key === 'Enter' \|\| e\.key === ' '\)[\s\S]{0,200}"
        r"openCard\(c, cell\)",
        src), "onKeyDown must open the card on Enter or Space"
    # Focus-visible ring for accessibility.
    assert "focus-visible:ring-2" in src


def test_induction_card_click_handler_unchanged():
    """openCard fires with the same args as before — regression
    guard for the click path itself."""
    src = _read(IND_CARD)
    assert "onClick={() => openCard(c, cell)}" in src
    # openCard still branches on cell.cert_id (view vs add mode).
    assert re.search(
        r"const openCard = \(col, cell\) => \{[\s\S]{0,500}"
        r"if \(cell\?\.cert_id\)[\s\S]{0,100}"
        r"mode: 'view'[\s\S]{0,500}"
        r"mode: 'add'",
        src)


# ── Section C3 defensive: slider has onInput twin ────────────────

def test_photo_slider_has_oninput_twin():
    """Defensive belt-and-braces — the range slider now dispatches
    both onChange AND onInput. Some browser/extension combos have
    been reported to drop the onChange event when the user drags
    the handle rapidly. onInput fires continuously during drag."""
    src = _read(WORKERS_PAGE)
    m = re.search(
        r'type="range"[\s\S]{0,400}'
        r'onChange=\{\(e\) => onChangeOffsetY\(Number\(e\.target\.value\)\)\}\s*'
        r'onInput=\{\(e\) => onChangeOffsetY\(Number\(e\.target\.value\)\)\}',
        src)
    assert m, ("range input must have BOTH onChange + onInput "
                "wired to the same setter")


# ── Section G: picker is flat ─────────────────────────────────────

def test_picker_role_grouping_removed():
    src = _read(QLS)
    # Old group headings GONE.
    assert "org-quick-links-editor-group-admins" not in src
    assert "org-quick-links-editor-group-users" not in src
    # Old bulk button testid GONE.
    assert "org-quick-links-editor-select-all-admins" not in src
    assert 'data-testid="org-quick-links-editor-select-all"' not in src
    # Old handler names GONE.
    assert "selectAllAdmins" not in src
    assert "const selectAll = " not in src
    # Old copy GONE.
    assert "Select all admins" not in src
    # Old split predicates GONE.
    assert "sorted.filter((u) => u.is_admin)" not in src
    assert "sorted.filter((u) => !u.is_admin)" not in src


def test_picker_has_select_everyone_and_clear():
    src = _read(QLS)
    # New "Select everyone" button + handler.
    assert "org-quick-links-editor-select-everyone" in src
    assert "Select everyone" in src
    assert re.search(r"const selectEveryone = \(\) => setAllowedUserIds", src)
    # Clear all preserved.
    assert "org-quick-links-editor-clear-all" in src
    assert re.search(r"const clearAll = \(\) => setAllowedUserIds\(\[\]\)", src)


def test_picker_admin_pill_gone_from_row():
    """Row-level admin pill (`text-violet-600 admin`) is no longer
    rendered. Every user is an admin, so the pill was noise."""
    src = _read(QLS)
    # This exact JSX block was the admin pill.
    assert not re.search(
        r'{u\.is_admin && \(\s*<span[^>]*text-violet-600[^>]*>\s*admin\s*</span>',
        src, re.DOTALL), "admin pill must be removed from user row"


def test_picker_still_sorted_alphabetically():
    src = _read(QLS)
    assert re.search(
        r"const sorted = \[\.\.\.eligibleUsers\]\.sort\(\(a, b\) =>\s*"
        r"\(a\.name \|\| ''\)\.localeCompare\(b\.name \|\| ''\)\);",
        src), "picker must keep alphabetical sort"


def test_picker_preflight_warnings_preserved():
    """`emptyWhileOn` + `selfMissing` warnings survive the flatten."""
    src = _read(QLS)
    assert "org-quick-links-editor-empty-warning" in src
    assert "org-quick-links-editor-self-missing-hint" in src
    assert "Tick at least yourself before saving" in src
    assert "you haven't ticked yourself" in src
