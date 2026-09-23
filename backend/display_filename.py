"""v58.13.132mf — Display-only filename cleaner (backend twin).

Mirror of `frontend/src/lib/displayFilename.js`. Strips the 12- or
13-hex-char + dash prefix that legacy imports stamped onto stored
filenames. Applied at the response boundary — in `Content-Disposition`
headers and in ZIP entry arcnames — so downloads land on the user's
machine with clean names.

The stored `doc_files.filename` value in Mongo is NEVER touched by
this helper. Storage lookups continue to key off the prefixed name.

Examples:
  "6373ef3a0ba47-Bostik_PVC_Pipe_Cement.pdf"
    -> "Bostik_PVC_Pipe_Cement.pdf"
  "66d54481a3402-BruteForce.pdf"
    -> "BruteForce.pdf"
  "Report_v2.pdf"
    -> "Report_v2.pdf"                (unchanged)
  ""  / None
    -> input unchanged                (defensive)

The regex requires the trailing dash so filenames that start with
hex-looking words (e.g. "abcdef.pdf") are not mistakenly stripped.
"""
from __future__ import annotations

import re

_HEX_PREFIX_RE = re.compile(r"^[0-9a-f]{12,13}-", re.IGNORECASE)


def display_filename(name: str | None) -> str | None:
    if not isinstance(name, str) or not name:
        return name
    return _HEX_PREFIX_RE.sub("", name)


def display_zip_arcname(path: str | None) -> str | None:
    """Strip the hex prefix only from the last path segment of a
    ZIP arcname. Folder names are left alone — the prefix pattern
    only applies to legacy imported *files*."""
    if not isinstance(path, str) or not path:
        return path
    if "/" not in path:
        return display_filename(path)
    head, _, tail = path.rpartition("/")
    return f"{head}/{display_filename(tail)}"
