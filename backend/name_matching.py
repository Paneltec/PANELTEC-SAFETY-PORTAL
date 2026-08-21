"""v58.13.26 — Composite name matcher for Employee ↔ Worker linking.

Extracted from the v58.13.26 Pass 1 diagnostic
(`/app/scripts/diagnostics/v58_13_26_name_overlap.py`). Powers both the
single-record `/link-candidates` endpoint and the new bulk wizard.

Design (approved Pass 1, C-strict):
  * 3-tier composite lookup — email → norm_basic → norm_last_first_initial.
  * NO fuzzy tier. difflib.SequenceMatcher removed from the linker
    entirely — its 0.60-0.79 band was 80% false-positive on live data.
  * Post-normalisation exact match only. Collision guard returns None
    when a tier has >1 worker hits (does not fire on current data —
    zero ambiguous collisions across 121 employees × 68 active workers
    — but the guard stays as defence-in-depth).

Pure functions. No I/O. No FastAPI, no motor, no db imports.
"""
from __future__ import annotations

import re
import string
import unicodedata
from typing import Iterable, Optional

_PUNCT_RE = re.compile(rf"[{re.escape(string.punctuation)}]")
_WS_RE = re.compile(r"\s+")

Tier = str  # "email" | "norm_basic" | "norm_lfi"


def strip_accents(s: str) -> str:
    """NFKD-decompose + drop combining marks. `Ástrid` → `Astrid`."""
    return "".join(
        c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c)
    )


def norm_basic(first: str, last: str) -> str:
    """`lower + strip accents + strip punct + collapse whitespace`, in "first last" form.

    Fixes v58.13.25's case-mismatch bug: workers are 88% ALL-UPPER
    (Simpro import), hr_employees are 100% Mixed-case.
    """
    s = f"{first or ''} {last or ''}"
    s = strip_accents(s).lower()
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


def norm_last_first_initial(first: str, last: str) -> str:
    """`last f` — surname + first-initial only. Absorbs middle-name /
    initial drift (small tier on current data, essentially free)."""
    f = (first or "").strip()
    l = (last or "").strip()
    s = f"{l} {f[:1]}"
    s = strip_accents(s).lower()
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


def _email_key(e: Optional[str]) -> str:
    return (e or "").strip().lower()


def find_matches(
    hr_first: str,
    hr_last: str,
    hr_email: Optional[str],
    workers: Iterable[dict],
) -> Optional[dict]:
    """Composite 3-tier lookup.

    Returns `{"tier": "email"|"norm_basic"|"norm_lfi", "worker": <dict>}`
    on unambiguous match, else `None`.

    `None` is also returned when a tier has >1 worker hits (collision
    guard). We DELIBERATELY do NOT return a fuzzy fallback — see the
    v58.13.26 diagnostic for the 80% false-positive rate in the
    0.60-0.79 band on live data.

    `workers` should already be filtered to active + not-deleted.
    """
    ws = list(workers)

    # Tier 1: email exact (highest confidence).
    he = _email_key(hr_email)
    if he:
        hits = [w for w in ws if _email_key(w.get("email")) == he]
        if len(hits) == 1:
            return {"tier": "email", "worker": hits[0]}
        if len(hits) > 1:
            return None

    # Tier 2: normalised full name.
    nb = norm_basic(hr_first, hr_last)
    if nb:
        hits = [
            w for w in ws
            if norm_basic(w.get("first_name", ""), w.get("last_name", "")) == nb
        ]
        if len(hits) == 1:
            return {"tier": "norm_basic", "worker": hits[0]}
        if len(hits) > 1:
            return None

    # Tier 3: surname + first-initial (drops middle name / nickname).
    lfi = norm_last_first_initial(hr_first, hr_last)
    if lfi:
        hits = [
            w for w in ws
            if norm_last_first_initial(w.get("first_name", ""), w.get("last_name", "")) == lfi
        ]
        if len(hits) == 1:
            return {"tier": "norm_lfi", "worker": hits[0]}
        if len(hits) > 1:
            return None

    return None
