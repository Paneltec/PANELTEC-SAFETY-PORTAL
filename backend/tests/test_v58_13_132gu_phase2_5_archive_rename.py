"""v58.13.132gu — Phase 2.5 Workers "Inactive" → "Archive" rename.

Pins:
  · UI strings in Workers.jsx flipped from "Inactive"/"Delete" to
    "Archived"/"Archive" (workers list only).
  · Row-action icon swapped from Trash2 → ArchiveIcon (fluentui
    Archive20Regular).
  · Row-action + confirm palette shifted from rose (destructive)
    to amber (archive).
  · Toast message "removed" → "archived".
  · Backend DB codes UNCHANGED (soft_deleted / restored / etc.);
    frontend-only translation lives in workerActionLabels.js.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
WORKERS = APP_ROOT / "frontend" / "src" / "pages" / "Workers.jsx"
LABELS = APP_ROOT / "frontend" / "src" / "lib" / "workerActionLabels.js"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Workers list wording — flipped ─────────────────────────────

def test_row_action_button_labelled_archive():
    src = _read(WORKERS)
    # The action button in the workers-list row action cluster
    # must have title="Archive" (not "Delete") and render the
    # ArchiveIcon (not Trash2).
    m = re.search(
        r'setConfirmDelete\(w\.id\)\}\s*title="Archive"\s*data-testid=\{`delete-\$\{w\.id\}`\}[\s\S]{0,300}<ArchiveIcon\s*/>',
        src,
    )
    assert m, "Workers-list row action must be title=Archive with <ArchiveIcon/>"


def test_row_action_confirm_uses_archive_wording():
    src = _read(WORKERS)
    # Inline confirm chip must read "Archive?" not "Delete?".
    assert (
        '<span className="text-[10px] font-semibold text-amber-900 '
        'uppercase tracking-wider">Archive?</span>'
    ) in src
    # And the confirm chip must be amber, not rose.
    assert "bg-amber-50 border border-amber-300" in src


def test_row_action_button_uses_amber_palette():
    src = _read(WORKERS)
    # No more rose destructive palette on the workers-list row
    # action button after the rename.
    m = re.search(
        r'setConfirmDelete\(w\.id\)\}\s*title="Archive"[\s\S]{0,200}bg-amber-50 text-amber-800 hover:bg-amber-100',
        src,
    )
    assert m, "Row action button must use amber palette"


def test_show_archived_toggle_label():
    src = _read(WORKERS)
    # Testid stays stable, only the visible label + tooltip flip.
    assert 'data-testid="show-inactive-toggle"' in src
    assert 'title="Include archived workers"' in src
    assert "Show archived" in src
    assert re.search(r"Show inactive\s*</label>", src) is None, (
        "Old 'Show inactive' label must be removed from the Workers page"
    )


def test_status_pill_tooltip_relabelled():
    src = _read(WORKERS)
    # The tombstone status pill tooltip on inactive rows must now
    # say "Archived …" instead of "Soft-deleted …" / "Deactivated".
    assert "`Archived ${w.deleted_at}`" in src
    assert "'Archived'" in src
    assert "Soft-deleted" not in src, (
        "Legacy 'Soft-deleted' tooltip must be gone from Workers.jsx"
    )


def test_inactive_badge_now_reads_archived():
    src = _read(WORKERS)
    # testid `worker-inactive` retained; visible text is Archived.
    assert 'data-testid="worker-inactive"' in src
    assert re.search(
        r'data-testid="worker-inactive"[\s\S]{0,300}>Archived<',
        src,
    ), "worker-inactive badge must display 'Archived'"
    # No stray "Inactive" chip text left.
    assert re.search(
        r'data-testid="worker-inactive"[\s\S]{0,300}>Inactive<',
        src,
    ) is None


def test_archive_toast_wording():
    src = _read(WORKERS)
    assert "`${fullName(w)} archived`" in src
    assert "`${fullName(w)} removed`" not in src


def test_archive_icon_imported_from_fluentui():
    src = _read(WORKERS)
    assert "Archive20Regular as ArchiveIcon" in src


# ─── Frontend action-code display translation ──────────────────

def test_action_translation_map_covers_workers_codes():
    src = _read(LABELS)
    # The map must translate every DB code the workers backend
    # currently emits into user-visible "Archived worker" /
    # "Restored worker" wording.
    for code, expected in (
        ("soft_deleted", "Archived worker"),
        ("deleted", "Archived worker"),
        ("deactivated", "Archived worker"),
        ("marked_inactive", "Archived worker"),
        ("restored", "Restored worker"),
        ("reactivated", "Restored worker"),
    ):
        assert re.search(
            rf"{code}:\s*'{re.escape(expected)}'", src
        ), f"missing translation for {code!r} → {expected!r}"


def test_humanise_worker_action_export():
    src = _read(LABELS)
    assert "export function humaniseWorkerAction" in src
    assert "export const WORKER_ACTION_LABELS" in src


# ─── Backend action codes must remain untouched ────────────────

def test_backend_action_codes_not_renamed():
    """Regression pin: Phase 2.5 is UI-only. The Workers backend
    must still emit the legacy DB codes so historical audit rows
    and grep queries stay valid."""
    workers_be = APP_ROOT / "backend" / "workers.py"
    if not workers_be.exists():
        # Fall back to server.py grep — the codes are emitted from
        # whichever module owns the DELETE endpoint.
        workers_be = APP_ROOT / "backend" / "server.py"
    text = _read(workers_be)
    # At least one of these historical codes MUST still appear —
    # renaming them would break audit-log continuity.
    assert (
        '"soft_deleted"' in text
        or '"deleted"' in text
        or "'soft_deleted'" in text
        or "'deleted'" in text
    )
    # And the new "archived" code must NOT be introduced on the
    # backend (Phase 2.5 is a UI rename only).
    assert '"archived"' not in text.lower().replace("archive_audit", "")


# ─── Version pins ─────────────────────────────────────────────

def test_version_bumped_to_132gu():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gu'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gu'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gu'", sw)
