"""v58.13.132hb — Doc Library search separator normalisation.

Locks in:
  · The `_normalised_pattern` helper is present and inserts
    `[ _-]*` between every non-separator character of the query so
    `SF_22`, `SF-22`, `SF 22`, `SF22` all resolve to the same DB
    regex.
  · `_match_field` normalisation matches so the UI label agrees
    with what actually hit.
  · Version-file lockstep to .132hb.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND = APP_ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

DOCLIB_PY = BACKEND / "document_library.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _normalised_pattern(needle: str) -> str:
    """Verbatim copy of the helper in `document_library.search`.
    The source-pin tests below (see `test_normaliser_source_pinned`)
    guarantee the real implementation stays in lockstep with this
    reference."""
    seps = set(" _-")
    core = [ch for ch in needle if ch not in seps]
    if not core:
        return re.escape(needle)
    return "[ _-]*".join(re.escape(c) for c in core)

FILENAME = "2025_SF-22_Bomb_Threat_Report V10.0.docx"


def _matches(q: str, haystack: str) -> bool:
    return re.search(_normalised_pattern(q), haystack, re.I) is not None


def test_variant_sf_underscore_22_matches_sf_hyphen_22():
    assert _matches("SF_22", FILENAME)


def test_variant_sf_hyphen_22_matches_sf_hyphen_22():
    assert _matches("SF-22", FILENAME)


def test_variant_sf_space_22_matches_sf_hyphen_22():
    assert _matches("SF 22", FILENAME)


def test_variant_sf22_no_separator_matches_sf_hyphen_22():
    assert _matches("SF22", FILENAME)


def test_variant_lowercase_sf_underscore_22_matches():
    assert _matches("sf_22", FILENAME)


def test_variant_multiple_underscores_matches():
    assert _matches("SF__22", FILENAME)


def test_negative_control_sf99_does_not_match_sf22():
    assert not _matches("SF-99", FILENAME)
    assert not _matches("SF 99", FILENAME)
    assert not _matches("SF_99", FILENAME)


def test_negative_control_unlikelyword_does_not_match():
    assert not _matches("unlikelyword", FILENAME)


def test_pattern_stable_across_separator_variants():
    variants = ["SF_22", "SF-22", "SF 22", "SF22"]
    patterns = {_normalised_pattern(v) for v in variants}
    assert len(patterns) == 1, \
        f"Expected all 4 variants to normalise identically, got: {patterns}"


def test_match_field_normalises_separators():
    src = _read(DOCLIB_PY)
    # Extract the full _match_field function body — terminates at
    # the next top-level def or blank-line-then-def.
    m = re.search(
        r'def _match_field\(doc: dict\) -> str:\n'
        r'(?:.+\n|\n)+?(?=\n    (?:def |results = ))',
        src,
    )
    assert m, "_match_field not found or terminator missing"
    body = m.group(0)
    assert "_strip_seps" in body, \
        "_match_field must normalise separators (missing _strip_seps)"
    # _strip_seps must apply to: needle + filename + each tag + uploader.
    # That's 4 haystack applications + 1 needle-normalisation call.
    assert body.count("_strip_seps(") >= 5, \
        f"_match_field must apply _strip_seps to needle + all 3 fields (got {body.count('_strip_seps(')})"


def test_search_endpoint_still_scoped_by_org_and_deleted_at():
    src = _read(DOCLIB_PY)
    m = re.search(
        r'@router\.get\("/search"\).*?^async def search\(.*?return \{',
        src, re.DOTALL | re.M,
    )
    assert m, "search handler not found"
    body = m.group(0)
    assert '"org_id": org_id' in body
    assert '"deleted_at": None' in body


def test_normaliser_source_pinned():
    """The reference `_normalised_pattern` used by the tests above
    must stay byte-for-byte equivalent to the real helper inside
    `document_library.search`. Otherwise the test suite would
    happily pass while the endpoint diverges. This guards the
    coupling."""
    src = _read(DOCLIB_PY)
    for line in (
        "def _normalised_pattern(needle: str) -> str:",
        'seps = set(" _-")',
        "core = [ch for ch in needle if ch not in seps]",
        "if not core:",
        "return re.escape(needle)",
        'return "[ _-]*".join(re.escape(c) for c in core)',
    ):
        assert line in src, f"Reference-drift: missing in real source: {line!r}"


def test_version_lockstep_pinned_at_132hb():
    running = re.search(
        r"RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
        _read(VERSION_JS),
    )
    expected = re.search(
        r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
        _read(VERSION_JS),
    )
    cache = re.search(
        r"CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
        _read(SW),
    )
    for m, label in ((running, "RUNNING_VERSION"),
                     (expected, "EXPECTED_CACHE_VERSION"),
                     (cache, "CACHE_VERSION")):
        assert m, f"{label} not pinned to .132h?"
        assert m.group(1) >= "b", f"{label} must be >= .132hb (got .132h{m.group(1)})"
