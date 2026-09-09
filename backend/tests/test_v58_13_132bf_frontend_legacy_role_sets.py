"""v58.13.132bf — Guardrail: no active reads of legacy role-set constants
(WRITE_ROLES / EDIT_ROLES / ELEVATED_ROLES / IMPORT_ROLES /
DELETE_FOLDER_ROLES) remain across `frontend/src/`. Stale declarations
that are explicitly `void`'d are tolerated (dead code, safe).
"""
from __future__ import annotations
import re
import subprocess
from pathlib import Path

FRONTEND_SRC = Path("/app/frontend/src")

LEGACY_NAMES = ("WRITE_ROLES", "EDIT_ROLES", "ELEVATED_ROLES",
                "IMPORT_ROLES", "DELETE_FOLDER_ROLES")

# Match an active read: `<NAME>.has(` or `<NAME>.size` NOT prefixed
# by `//` on the same line. Line-level detection: we split each line
# at `//` (JS single-line comment) and only search the code portion.
READ_RE = re.compile(
    r"\b(?:" + "|".join(LEGACY_NAMES) + r")\.(?:has|size)\b"
)


def _strip_line_comment(line: str) -> str:
    """Return the substring of `line` before any `//` comment marker
    that isn't inside a string. Cheap heuristic — good enough for
    grep-style detection in this codebase (no lines with `//` inside
    a string literal use these constants)."""
    # Look for `//` not preceded by `:` (skip URLs) — cheap heuristic.
    idx = line.find("//")
    if idx == -1:
        return line
    # If the `//` is inside a string, we'd need a real parser; but
    # for this codebase the constants never appear in string literals
    # containing `//`, so a straight cut is safe.
    return line[:idx]


def _walk_source_files():
    for path in FRONTEND_SRC.rglob("*"):
        if path.suffix not in (".js", ".jsx", ".ts", ".tsx"):
            continue
        # Skip generated / third-party / test dirs.
        if any(p in path.parts for p in ("node_modules", "build", "dist", "coverage")):
            continue
        yield path


def test_no_active_reads_of_legacy_role_sets():
    """Every `<NAME>.has(` / `<NAME>.size` outside a `//` comment must
    be gone. Stale `const <NAME> = new Set([...])` declarations are
    tolerated as long as they're `void`'d (checked separately)."""
    offenders: list[str] = []
    for path in _walk_source_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for lineno, raw in enumerate(text.splitlines(), start=1):
            code = _strip_line_comment(raw)
            if READ_RE.search(code):
                offenders.append(f"{path.relative_to(FRONTEND_SRC)}:{lineno}: {raw.strip()}")
    assert not offenders, (
        "Legacy role-set constants are being ACTIVELY READ in "
        "frontend/src — migrate to useCan():\n  "
        + "\n  ".join(offenders)
    )


def test_every_declaration_is_paired_with_void_reference():
    """A `const <NAME> = new Set([...])` declaration is only tolerated
    if the same file explicitly `void`'s the identifier (marker that
    the consumer has migrated to useCan but left the constant behind
    intentionally for reference). Any un-`void`'d declaration is a
    ticking time-bomb."""
    decl_re = re.compile(
        r"^const (" + "|".join(LEGACY_NAMES) + r") = new Set\("
    )
    orphans: list[str] = []
    for path in _walk_source_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        names_declared = set()
        for line in text.splitlines():
            m = decl_re.match(line)
            if m:
                names_declared.add(m.group(1))
        for name in names_declared:
            if f"void {name}" not in text:
                orphans.append(f"{path.relative_to(FRONTEND_SRC)}: {name} declared but never `void`'d")
    assert not orphans, (
        "Un-`void`'d legacy declarations (either use them via useCan "
        "or delete them):\n  " + "\n  ".join(orphans)
    )


def test_documentlibrary_uses_usecan_for_folder_page():
    """`.132bf` specific: DocumentLibraryFolder (folder detail view)
    must gate on `useCan('documents', 'edit')`, not on
    `WRITE_ROLES.has(user?.role)`.
    """
    path = FRONTEND_SRC / "pages" / "DocumentLibrary.jsx"
    text = path.read_text(encoding="utf-8")
    # The folder detail component is `DocumentLibraryFolder`. Slice from
    # its declaration to end-of-file so we only assert against that
    # component, not the list-page component above it.
    idx = text.find("export function DocumentLibraryFolder(")
    assert idx > 0, "DocumentLibraryFolder component not found"
    body = text[idx:]
    # Assert the useCan gate is present in the component body.
    assert "useCan()('documents', 'edit')" in body \
        or "useCan()(\"documents\", \"edit\")" in body \
        or "documents', 'edit')" in body, \
        "DocumentLibraryFolder does not gate on documents.edit via useCan"
    # And ensure no active WRITE_ROLES.has(...) in that component body.
    active_reads = []
    for lineno, raw in enumerate(body.splitlines(), start=1):
        code = _strip_line_comment(raw)
        if READ_RE.search(code):
            active_reads.append(f"L~{lineno}: {raw.strip()}")
    assert not active_reads, (
        "DocumentLibraryFolder still contains active legacy reads:\n  "
        + "\n  ".join(active_reads)
    )
