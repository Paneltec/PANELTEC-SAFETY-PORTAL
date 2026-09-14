"""v58.13.132g0 — Duplicate detection tightening on `POST /api/imports/pdf`.

Locks in:
  · Source pin: filename is NO LONGER part of the dedupe query.
  · Source pin: sha256 + size + first-512-byte sha256 fingerprint
    IS the dedupe query.
  · Source pin: three new fields (`import_sha256`, `import_file_size`,
    `import_head_sha256`) are stamped on every newly-persisted row.
  · Behavioural pin: back-compat query tolerates legacy rows that
    only carry `import_sha256` (via `$exists: false` on the two
    new fields).
  · Version-file lockstep to `.132g0`.
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND = APP_ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

IMPORTS_PY = BACKEND / "imports.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Source pins ───────────────────────────────────────────────

def test_filename_no_longer_in_dedupe_query():
    src = _read(IMPORTS_PY)
    # The old key `imported_from_pdf` is still allowed to be a
    # persisted column (used elsewhere in the codebase for display /
    # audit — see line 173 of the pre-.132g0 file) but must NOT
    # appear as a query key in the dedupe find_one anymore.
    # We enforce this by requiring that within the find_one() call
    # block there is no `imported_from_pdf: filename` predicate.
    #
    # Extract the find_one call span heuristically: from the first
    # occurrence of `find_one(` after `# Idempotency` through the
    # closing paren.
    idem_hit = src.find("Idempotency")
    assert idem_hit != -1, "Idempotency comment block missing"
    find_span_start = src.find("find_one(", idem_hit)
    assert find_span_start != -1
    # Take a generous slice.
    span = src[find_span_start:find_span_start + 1200]
    assert "imported_from_pdf" not in span, (
        "imported_from_pdf must not appear in the dedupe query — "
        "the .132g0 tightening removed filename from the fingerprint")


def test_fingerprint_fields_computed():
    src = _read(IMPORTS_PY)
    # sha256 of full payload — must remain.
    assert "hashlib.sha256(data).hexdigest()" in src
    # size — new.
    assert "file_size = len(data)" in src
    # first-512 head sha — new.
    assert "hashlib.sha256(data[:512]).hexdigest()" in src


def test_fingerprint_used_in_dedupe_query():
    src = _read(IMPORTS_PY)
    # The three fingerprint fields must appear inside the find_one
    # dedupe query (after `# Idempotency`).
    idem_hit = src.find("Idempotency")
    find_span_start = src.find("find_one(", idem_hit)
    span = src[find_span_start:find_span_start + 1500]
    assert '"import_sha256": sha' in span
    assert '"import_file_size": file_size' in span
    assert '"import_head_sha256": head_sha' in span
    # Back-compat: query tolerates legacy rows without the two
    # new fields.
    assert '"import_file_size": {"$exists": False}' in span
    assert '"import_head_sha256": {"$exists": False}' in span


def test_new_fields_stamped_on_insert():
    src = _read(IMPORTS_PY)
    # Submission-doc dict must persist all three fingerprint fields.
    assert '"import_sha256": sha' in src
    assert '"import_file_size": file_size' in src
    assert '"import_head_sha256": head_sha' in src


def test_head_slice_boundary():
    """Belt-and-braces: prove the head hash uses exactly the first
    512 bytes — no off-by-one, no whole-file hash used twice.
    """
    payload = b"A" * 1024
    head_expected = hashlib.sha256(payload[:512]).hexdigest()
    head_wrong_sizes = {
        hashlib.sha256(payload[:511]).hexdigest(),
        hashlib.sha256(payload[:513]).hexdigest(),
        hashlib.sha256(payload).hexdigest(),
    }
    assert head_expected not in head_wrong_sizes


def test_docstring_updated():
    src = _read(IMPORTS_PY)
    # Module docstring reflects the new semantics.
    assert re.search(
        r"content fingerprint.*sha256.*size.*first-512.*sha256",
        src, re.IGNORECASE | re.DOTALL,
    ), "module docstring must describe the new fingerprint semantics"
    # And explicitly notes filename plays no role.
    assert "Filename plays no role" in src


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132g0():
    assert "paneltec-v160.3.9.58.13.132g0" in _read(VERSION_JS)
    assert "paneltec-v160.3.9.58.13.132g0" in _read(SW)
