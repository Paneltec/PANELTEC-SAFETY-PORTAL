"""v58.13.132hh — Sticky Actions column + AI-tag collapse hotfix."""
from __future__ import annotations
import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
DOCLIB_JSX = APP_ROOT / "frontend" / "src" / "pages" / "DocumentLibrary.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_wrapper_uses_overflow_x_auto_not_hidden():
    src = _read(DOCLIB_JSX)
    # The folder-detail file table wrapper must NOT clip its
    # rightmost column with overflow-hidden any more.
    assert 'data-testid="folder-files-table"' in src
    m = re.search(
        r'<div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">\s*\n\s*<table className="w-full text-sm" data-testid="folder-files-table"',
        src,
    )
    assert m, "table wrapper must be overflow-x-auto (not overflow-hidden)"


def test_actions_th_is_sticky_right():
    src = _read(DOCLIB_JSX)
    m = re.search(
        r'<th\s+className="text-right px-4 py-3 sticky right-0 bg-slate-50[^"]*"\s+data-testid="folder-files-th-actions"',
        src,
    )
    assert m, "Actions <th> must be sticky right-0"


def test_actions_td_is_sticky_right():
    src = _read(DOCLIB_JSX)
    m = re.search(
        r'<td\s+className="px-4 py-3 text-right sticky right-0 bg-white[^"]*"\s+data-testid=\{`file-actions-cell-\$\{f\.id\}`\}',
        src,
    )
    assert m, "Actions <td> must be sticky right-0"


def test_ai_tags_collapse_to_three_plus_overflow():
    src = _read(DOCLIB_JSX)
    assert "(f.ai_tags || []).slice(0, 3)" in src, \
        "AI tags must be capped at 3 visible chips"
    assert "(f.ai_tags || []).length > 3" in src, \
        "Overflow indicator must appear when >3 tags"
    assert 'data-testid={`ai-tags-overflow-${f.id}`}' in src, \
        "Overflow chip needs a testid"
    assert "(f.ai_tags || []).slice(3).join(', ')" in src, \
        "Overflow chip must tooltip the hidden tags"


def test_version_lockstep_pinned_at_132hh():
    for path, key in (
        (VERSION_JS, "RUNNING_VERSION"),
        (VERSION_JS, "EXPECTED_CACHE_VERSION"),
        (SW, "CACHE_VERSION"),
    ):
        m = re.search(
            rf"{key}\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
            _read(path),
        )
        assert m
        assert m.group(1) >= "h", f"{key} must be >= .132hh"
