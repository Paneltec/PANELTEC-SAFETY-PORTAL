"""v160.3.9.58.13.35 — Bulk-import template inference helper.

Ports the JS `inferTemplateType()` logic from
`frontend/src/lib/preStartsPalette.js` to Python so the Ship-4b
re-extraction script can determine the CORRECT template name for a
misclassified `pre_starts` record purely from its `work_summary`
field (the Simpro-shape "Imported: <zip>::<TEMPLATE> (Nnn) -
<date>.pdf" string), without needing to re-invoke Claude.

Kept as a standalone module so:
  · `bulk_import_prestarts.py` stays untouched (no re-render of the
    running pipeline during the ship);
  · pytest can exercise the inference / resolver in isolation without
    spinning up Mongo or the full bulk-import machinery;
  · downstream tools (audit reports, admin diagnostics) can import
    the same helper.

Public surface
--------------

`infer_template_type_from_row(row) -> str`
    Mirrors the JS export. Returns the best-effort template-type
    string. Prefers `template_name_snapshot`, then `template_name`,
    then parses out the `::<TEMPLATE> (Nnn) - <date>.pdf` segment
    from `work_summary`. Returns "" if nothing usable is present.

`infer_template_type_from_filename(filename) -> str`
    Same regex peel as above, applied to a bare filename string.
    Used by the ZIP-based re-extraction path when we walk the source
    archive directly.

`resolve_against_roster(name, roster) -> (template_id, name, confidence)`
    Given a candidate template-name string and a `{tid: name}` roster
    dict (as returned by `_load_classifier_roster()`), returns the
    best-matching `(template_id, canonical_name, confidence)` tuple.
    Confidence bands:
        1.00  exact case-insensitive match after normalisation
        0.90  full-token substring hit either direction
        0.75  fuzzy token-overlap ≥ 60 %
        0.00  no viable candidate → returns (None, "", 0.0)

`infer_category_from_name(name) -> str`
    Filename-only heuristic used when the roster hit points at a
    `list_forms` entry (which has no `category` field). Applies the
    same keyword rules the pipeline classifier uses:
        · "SSRA"                → "hazard"
        · "SWMS"                → "swms"
        · "Permit"              → "permit"
        · "Pre-Start" / "Checklist" / "Daily Check" / "Inspection"
                                → "pre_start"
        · "Site Diary"          → "site_diary"
        · "Incident"            → "incident"
        · fallthrough           → ""

`resolve_target_category(template_doc, name) -> str`
    Convenience: prefer the DB-stamped `category` from the template
    document; fall back to `infer_category_from_name(name)`.

`should_migrate_out_of_prestarts(category, name) -> bool`
    Thin wrapper mirroring `bulk_import_prestarts._should_write_prestarts_shim`
    inverted — returns True iff the record should be MIGRATED out of
    the `pre_starts` shim into `form_submissions` only.

Confidence floor
----------------

The re-extraction script treats a `resolve_against_roster()` return
with `confidence < ROSTER_RESOLVE_MIN_CONFIDENCE` (0.75 by default,
env-overridable) as "unresolved" and either quarantines the record
(cache-derived mode) or falls back to the Claude classifier (zip
mode).
"""
from __future__ import annotations

import os
import re
from typing import Any, Optional


# ─── Public constants ────────────────────────────────────────────────

ROSTER_RESOLVE_MIN_CONFIDENCE = float(
    os.environ.get("REEXTRACT_ROSTER_MIN_CONFIDENCE") or "0.75"
)


# ─── Filename / work_summary parsing (JS 1:1 port) ───────────────────

# Trailing-suffix regex from `preStartsPalette.js`. Written to match
# the JS behaviour precisely:
#   /\s*\(\d+\)\s*-\s*\d+.*$/
_SUFFIX_ID_DATE = re.compile(r"\s*\(\d+\)\s*-\s*\d+.*$")
_SUFFIX_PDF = re.compile(r"\.pdf.*$", re.IGNORECASE)


def _peel_template_from_after_marker(after: str) -> str:
    """Given the string AFTER the `::` marker in a work_summary,
    strip the Simpro-appended id/date/`.pdf` suffix and return the
    bare template name."""
    after = _SUFFIX_ID_DATE.sub("", after)
    after = _SUFFIX_PDF.sub("", after)
    return after.strip()


def infer_template_type_from_row(row: Optional[dict]) -> str:
    """Python port of `preStartsPalette.js::inferTemplateType(row)`.

    Rules (in JS order):
      1. `row.template_name_snapshot` present → return it trimmed.
      2. `row.template_name` present → return it trimmed.
      3. Otherwise parse `row.work_summary`. Look for `::`; if absent,
         return "". Take the tail after `::`, strip the trailing
         ` (Nnn) - <date>.pdf.*` suffix, return the trimmed remainder.

    Empty / non-dict input → "". Never raises.
    """
    if not row or not isinstance(row, dict):
        return ""
    snap = row.get("template_name_snapshot")
    if snap:
        return str(snap).strip()
    name = row.get("template_name")
    if name:
        return str(name).strip()
    ws = row.get("work_summary") or ""
    if not ws:
        return ""
    idx = ws.find("::")
    if idx == -1:
        return ""
    return _peel_template_from_after_marker(ws[idx + 2:])


def infer_template_type_from_filename(filename: Optional[str]) -> str:
    """Peel a bare Simpro filename (no `Imported: <zip>::` prefix)
    down to its template-name segment. Used by the ZIP-source path
    when we walk `<zip>` directly and only have the child PDF's
    filename to work with."""
    if not filename:
        return ""
    # Strip the leading path if present.
    base = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return _peel_template_from_after_marker(base)


# ─── Roster resolver ─────────────────────────────────────────────────

_WS_RE = re.compile(r"\s+")
_PUNCT_RE = re.compile(r"[^a-z0-9]+")


def _normalise_name(s: str) -> str:
    """Lowercase, strip, collapse whitespace. Preserves separator
    tokens (spaces / hyphens / slashes) for the substring pass."""
    return _WS_RE.sub(" ", (s or "").strip().lower())


def _tokenise(s: str) -> set[str]:
    """Alnum tokens only, for the fuzzy fallback."""
    normed = _PUNCT_RE.sub(" ", (s or "").lower())
    return {t for t in normed.split() if t}


def resolve_against_roster(
    name: str, roster: dict[str, str],
) -> tuple[Optional[str], str, float]:
    """Return `(template_id, canonical_name, confidence)` for the
    best roster hit against `name`.

    Confidence bands:
        1.00  exact case-insensitive match after whitespace collapse
        0.90  full-string substring hit either direction
        0.75  token-overlap ≥ 60 % (fuzzy fallback)
        0.00  no viable candidate → returns (None, "", 0.0)

    Ties break by the roster's insertion order (dicts are ordered in
    Py3.7+).
    """
    if not name or not roster:
        return None, "", 0.0
    target = _normalise_name(name)
    if not target:
        return None, "", 0.0

    # Pass 1: exact normalised match.
    for tid, tname in roster.items():
        if _normalise_name(tname) == target:
            return tid, tname, 1.0

    # Pass 2: substring hit either direction. Prefer LONGER canonical
    # names (more specific match wins).
    best: tuple[Optional[str], str, float, int] = (None, "", 0.0, -1)
    for tid, tname in roster.items():
        cname = _normalise_name(tname)
        if not cname:
            continue
        if target in cname or cname in target:
            score = 0.90
            length = len(cname)
            if length > best[3]:
                best = (tid, tname, score, length)
    if best[0] is not None:
        return best[0], best[1], best[2]

    # Pass 3: fuzzy token overlap.
    target_toks = _tokenise(name)
    if not target_toks:
        return None, "", 0.0
    best_ratio = 0.0
    best_hit: tuple[Optional[str], str] = (None, "")
    for tid, tname in roster.items():
        cand_toks = _tokenise(tname)
        if not cand_toks:
            continue
        overlap = target_toks & cand_toks
        if not overlap:
            continue
        # Jaccard-ish ratio: intersection / smaller-side.
        denom = min(len(target_toks), len(cand_toks))
        ratio = len(overlap) / denom
        if ratio > best_ratio:
            best_ratio = ratio
            best_hit = (tid, tname)
    if best_ratio >= 0.6:
        return best_hit[0], best_hit[1], 0.75

    return None, "", 0.0


# ─── Category inference ──────────────────────────────────────────────

# Keyword rules — order matters (earlier = stronger).
_CATEGORY_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("ssra", "hazard"),
    ("safe work method statement", "swms"),
    ("swms", "swms"),
    ("permit", "permit"),
    ("hot work", "permit"),
    ("excavation permit", "permit"),
    ("risk assessment", "hazard"),
    ("site diary", "site_diary"),
    ("incident", "incident"),
    ("near miss", "near_miss"),
    ("toolbox", "toolbox"),
    ("hazard report", "hazard"),
    ("pre-start", "pre_start"),
    ("pre start", "pre_start"),
    ("prestart", "pre_start"),
    ("daily check", "pre_start"),
    ("pre-use", "pre_start"),
    ("pre use", "pre_start"),
    ("checklist", "pre_start"),
    ("inspection", "pre_start"),
    ("plant", "plant_pre_start"),
)


def infer_category_from_name(name: Optional[str]) -> str:
    """Keyword-driven category inference for names lacking a
    `form_templates.category` (specifically `list_forms` hits).

    Returns "" when nothing matches — caller decides whether to
    default to `pre_start` or skip.
    """
    if not name:
        return ""
    low = (name or "").lower()
    for kw, cat in _CATEGORY_KEYWORDS:
        if kw in low:
            return cat
    return ""


def resolve_target_category(
    template_doc: Optional[dict], name: str,
) -> str:
    """Preferred category resolution:
      1. `template_doc.category` when the template comes from
         `form_templates` (stamped, canonical).
      2. `infer_category_from_name(name)` when the template comes
         from `list_forms` (no `category` field).
    """
    if template_doc and (template_doc.get("category") or "").strip():
        return str(template_doc["category"]).strip().lower()
    return infer_category_from_name(name)


def should_migrate_out_of_prestarts(
    category: Optional[str], name: Optional[str],
) -> bool:
    """Inverse of `bulk_import_prestarts._should_write_prestarts_shim`.

    True iff the record's CORRECT home is `form_submissions` only —
    i.e. it should be MIGRATED out of the `pre_starts` shim.

    Kept as an independent implementation (not importing the
    pipeline module) so the re-extraction script has no side effect
    on the running pipeline's import graph.
    """
    cat = (category or "").strip().lower()
    if cat in ("pre_start", "plant_pre_start"):
        return False
    if cat in ("hazard", "swms", "permit"):
        return True
    # Backward-compat name-based fallback (mirrors the pipeline).
    low = (name or "").lower()
    if "pre-start" in low or "pre start" in low or "checklist" in low:
        return False
    # Unknown / anything else — be conservative, don't migrate. The
    # re-extraction script logs this as `action=noop_unresolved` and
    # leaves the record in place with `template_name_snapshot` stamped.
    return False


# ─── Test-friendly accessors ─────────────────────────────────────────

# Explicit re-exports so `from bulk_import_template_inference import *`
# stays tight.
__all__ = (
    "ROSTER_RESOLVE_MIN_CONFIDENCE",
    "infer_template_type_from_row",
    "infer_template_type_from_filename",
    "resolve_against_roster",
    "infer_category_from_name",
    "resolve_target_category",
    "should_migrate_out_of_prestarts",
)
