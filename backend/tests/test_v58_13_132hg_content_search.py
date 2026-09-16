"""v58.13.132hg — Content-search UX + retry-with-AI + tooltip polish."""
from __future__ import annotations
import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
DOCLIB_PY = APP_ROOT / "backend" / "document_library.py"
DOCLIB_JSX = APP_ROOT / "frontend" / "src" / "pages" / "DocumentLibrary.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_search_query_also_probes_extracted_text():
    src = _read(DOCLIB_PY)
    assert '{"extracted_text": {"$regex": pattern, "$options": "i"}}' in src, \
        "search must also probe extracted_text"


def test_content_snippet_helper_present():
    src = _read(DOCLIB_PY)
    assert "def _content_snippet(doc: dict)" in src
    assert "match.start() - 60" in src
    assert "match.end() + 60" in src


def test_match_field_returns_content_for_extracted_text_hit():
    src = _read(DOCLIB_PY)
    assert 'in _strip_seps(doc.get("extracted_text") or ""):' in src
    assert 'return "content"' in src


def test_results_ranked_filename_above_content():
    src = _read(DOCLIB_PY)
    assert '"filename": 0' in src and '"content": 3' in src, \
        "rank map must put filename above content"


def test_retry_ai_endpoint_admin_only_uses_claude():
    src = _read(DOCLIB_PY)
    assert '@router.post("/files/{file_id}/retry-extract-ai")' in src
    m = re.search(r'async def retry_extract_ai\(.*?return \{"ok": True',
                  src, re.DOTALL)
    assert m, "retry_extract_ai handler not found"
    body = m.group(0)
    assert '_require(user, {"admin"}, action="retry-extract-ai")' in body
    assert 'claude-sonnet-4-5-20250929' in body
    assert '"extract_ai_retry"' in body, "must audit"


def test_frontend_snippet_rendered_when_content_match():
    src = _read(DOCLIB_JSX)
    assert "r.match_field === 'content' && r.snippet" in src, \
        "snippet strip must gate on content match"
    assert "smart-search-snippet-" in src


def test_frontend_content_badge_uses_brand_blue():
    src = _read(DOCLIB_JSX)
    assert "r.match_field === 'content'" in src
    assert 'text-brand-blue bg-brand-blue-soft' in src


def test_frontend_panel_copy_tweak():
    src = _read(DOCLIB_JSX)
    assert "Searches filenames, tags, uploader and inside document contents." in src


def test_frontend_greyed_tooltips_tightened():
    src = _read(DOCLIB_JSX)
    assert "Preview not available for this file type" in src, \
        "Eye tooltip must explain what to do next"
    assert "use the ⬇ Download icon" in src


def test_frontend_retry_ai_button_present():
    src = _read(DOCLIB_JSX)
    assert "file-retry-ai-${f.id}" in src, "retry-ai button testid missing"
    assert "extraction_status === 'failed'" in src
    assert "extraction_engine !== 'missing-binary'" in src, \
        "orphans (missing-binary) must NOT show the retry button"
    assert "~$0.01" in src, "cost hint must appear in confirm dialog"


def test_version_lockstep_pinned_at_132hg():
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
        assert m.group(1) >= "g", f"{key} must be >= .132hg"
