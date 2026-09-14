"""v58.13.132fu — Cover logo shift + SubmissionViewer photo/signature fix."""
from __future__ import annotations

from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
COVER_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Cover.jsx"
SV_JSX = APP_ROOT / "frontend" / "src" / "components" / "SubmissionViewer.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_cover_hero_container_mt_reduced():
    """`.132ft` used mt-[12vh] on the hero container. `.132fu` shifts
    the whole hero (including the logo) up ~65 px by dropping the
    top margin to mt-[6vh]."""
    src = _read(COVER_JSX)
    assert 'mt-[6vh]' in src, ".132fu must set the cover hero container to mt-[6vh]"
    # The old mt-[12vh] value survives only in the explanatory
    # comment introduced by .132fu. Make sure it does NOT appear on
    # any actual className.
    import re as _re
    class_matches = _re.findall(r'className="([^"]*)"', src)
    for cls in class_matches:
        assert 'mt-[12vh]' not in cls, (
            f"a className still uses mt-[12vh] — removed in .132fu: {cls!r}")


def test_submission_viewer_file_url_passes_data_and_blob_through():
    src = _read(SV_JSX)
    assert "url.startsWith('data:')" in src, (
        "_fileUrl must recognise data: URLs so signatures aren't prefixed "
        "with the backend host")
    assert "url.startsWith('blob:')" in src, (
        "_fileUrl must recognise blob: URLs too (browser-generated in-memory)")


def test_submission_viewer_photo_reads_file_url_property():
    src = _read(SV_JSX)
    # The persisted photo shape from forms.py has `file_url`, not
    # `.url` or `.src`. The renderer must read `file_url` first (with
    # fallback to `.url` / `.src` for legacy records).
    assert "v?.file_url || v?.url || v?.src" in src, (
        "photo renderer must check v.file_url alongside legacy v.url / v.src")


def test_version_bumped_to_132fu():
    ver = _read(VERSION_JS)
    sw = _read(SW)
    assert "paneltec-v160.3.9.58.13.132fu" in ver
    assert "paneltec-v160.3.9.58.13.132fu" in sw
