"""v58.13.132mg — Parse SDS-style expiry codes embedded in filenames.

Legacy naming convention on SDS/technical documents used to append the
expiry as part of the filename. Real examples (verbatim from Stephen's
Tasmania Dropbox tree):

  Rage_Gold_3Exp1.8.24.pdf              → 2024-08-01 (past, Australian DMY)
  HPL_4000_3Exp25.2.26.pdf              → 2026-02-25
  KBS_RUSTBLAST_3Exp23.8.26.pdf         → 2026-08-23
  LOCTITELB8150EXP012029.pdf            → 2029-01-01 (MMYYYY)
  DIESELBIOCIDE4IN1EXP0528.pdf          → 2028-05-01 (MMYY → 20YY)
  HHS2000EXP2029.pdf                    → 2029-12-31 (year-only, EoY fallback)
  bp-butaneEXP042025.pdf                → 2025-04-01 (past)
  HyspinAWS46EXP032029.pdf              → 2029-03-01
  POWERSPRAYGLUEPLUSEXP042029.pdf       → 2029-04-01
  JotacoteQDEXP062028.pdf               → 2028-06-01 (QD prefix stripped too)

Locale note: user is in Tasmania, Australia — dotted dates are DD.MM.YY
or DD.MM.YYYY. Never MDY. The EXPmmyyyy compact form is always MM/YYYY
(never DDMMYY) — the safer of the two ambiguous 6-digit readings, and
what all sampled real files use.

If the parsed date lands >20 years in the future OR >20 years in the
past → treat as unparseable (garbled input, not a legitimate expiry).

Returns `ParsedExpiry(clean_name, expires_at, raw_code)`. Callers can
use `clean_name` where they'd otherwise use `display_filename(name)`
from `.132mf`; the two are stackable (this parser strips the expiry
code but leaves the hex prefix alone; `display_filename` strips the
hex prefix but leaves the expiry code alone).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone, timedelta
from typing import Optional

log = logging.getLogger("paneltec.filename_expiry")

# ── Regex patterns ────────────────────────────────────────────────
# The order matters: try the dotted DMY pattern first (has explicit
# separators), fall back to the compact EXPddd pattern.
#
# DOTTED_RE matches optional cycle-prefix `_3` (year-cycle marker),
# the Exp / EXP token, then a DMY date with . / or -.
_DOTTED_RE = re.compile(
    r"[_\- ]?(?:\d+)?Exp"
    r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})",
    re.IGNORECASE,
)
# COMPACT_RE matches the `EXP` token optionally preceded by a `QD`
# or digit prefix (e.g. `4IN1`, `QD`) and followed by 4, 6, or 8
# digits. No leading boundary — real filenames run `EXP` directly
# after a lowercase word (e.g. `bp-butaneEXP042025`).
_COMPACT_RE = re.compile(
    r"(?:QD)?EXP(\d{4,8})",
    re.IGNORECASE,
)
# v58.13.132mh — MONTHNAME form.  `Exp Nov 2021` / `Exp February 2022`
# used consistently on TasWater Induction PDFs. English month name
# (short or full), followed by a 4-digit year in 20xx.
_MONTHNAME_RE = re.compile(
    r"Exp[\s_\-]+"
    r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|"
    r"Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|"
    r"Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
    r"[\s_\-]+(20\d{2})",
    re.IGNORECASE,
)
_MONTH_NUM = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
# v58.13.132mk-a (bundled .132mj) — Space-separated DD MM YYYY.
# Real examples from Licences & Tickets folder:
#   CPR - MLinford - EXP 21 11 2026.pdf         → 2026-11-21
#   TasWater LOTO - ML - EXP 28 08 2028.pdf     → 2028-08-28
#   MVC Induction - ML - EXP 14 01 2027.pdf     → 2027-01-14
#   TasRail Track Safety - ML - EXP 30 07 2028  → 2028-07-30
#   Class C Licence - ML - EXP 02 03 2028.pdf   → 2028-03-02
# Australian order (DD MM YYYY). Invalid combos (day 32, month 13,
# 29 Feb non-leap) fall through as unparseable via date() ValueError.
_SPACED_DMY_RE = re.compile(
    r"EXP\s+(\d{1,2})\s+(\d{1,2})\s+(20\d{2})",
    re.IGNORECASE,
)
# STRIP_RE removes the expiry clause + separator artefacts.
# Three variants: (a) dotted DMY (which can have a `_3` cycle prefix
# — strip that too), (b) compact EXP (only strip a `QD` prefix
# or explicit `_N`/`-N` separator; digits directly-attached to the
# product code stay), (c) monthname EXP, and now (d) spaced DMY.
# Match longest first via alternation.
_STRIP_JUNK_RE = re.compile(
    r"(?:[_\- ]?(?:E|e)xp\s+\d{1,2}\s+\d{1,2}\s+20\d{2})"
    r"|(?:[_\- ]?(?:E|e)xp[\s_\-]+"
    r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|"
    r"Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|"
    r"Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\s_\-]+20\d{2})"
    r"|(?:(?:[_\- ]\d+)?[_\- ]?(?:QD)?(?:E|e)xp[\d.\-/]*)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ParsedExpiry:
    clean_name: str
    expires_at: Optional[str]   # ISO date `YYYY-MM-DD` or None
    raw_code: Optional[str]     # the matched substring, for audit

    def to_dict(self) -> dict:
        return {"clean_name": self.clean_name,
                "expires_at": self.expires_at,
                "raw_code": self.raw_code}


def _sanity_ok(d: date, *, today: Optional[date] = None) -> bool:
    """Reject dates >20 years in either direction as garbled."""
    today = today or datetime.now(timezone.utc).date()
    return abs((d - today).days) <= 20 * 366


def _parse_dotted(name: str, *, today: Optional[date] = None
                    ) -> Optional[tuple[date, str]]:
    m = _DOTTED_RE.search(name)
    if not m:
        return None
    dd, mm, yy = m.group(1), m.group(2), m.group(3)
    try:
        d, mo = int(dd), int(mm)
        y = int(yy)
        if y < 100:      # 2-digit year → assume 20xx
            y += 2000
        parsed = date(y, mo, d)
    except (ValueError, TypeError):
        return None
    if not _sanity_ok(parsed, today=today):
        return None
    return parsed, m.group(0)


def _parse_compact(name: str, *, today: Optional[date] = None
                     ) -> Optional[tuple[date, str]]:
    m = _COMPACT_RE.search(name)
    if not m:
        return None
    digits = m.group(1)
    try:
        if len(digits) == 4:        # YYYY (year only)
            y = int(digits)
            parsed = date(y, 12, 31)
        elif len(digits) == 6:      # MMYYYY
            mo, y = int(digits[:2]), int(digits[2:])
            parsed = date(y, mo, 1)
        elif len(digits) == 8:      # DDMMYYYY (rare)
            d, mo, y = int(digits[:2]), int(digits[2:4]), int(digits[4:])
            parsed = date(y, mo, d)
        else:
            return None
    except (ValueError, TypeError):
        return None
    # 4-digit YY at end of MMYY: also try MMYY -> 20YY promotion
    if not _sanity_ok(parsed, today=today) and len(digits) == 4:
        try:
            mo, y = int(digits[:2]), 2000 + int(digits[2:])
            parsed = date(y, mo, 1)
        except (ValueError, TypeError):
            return None
    if not _sanity_ok(parsed, today=today):
        return None
    return parsed, m.group(0)


def _parse_monthname(name: str, *, today: Optional[date] = None
                       ) -> Optional[tuple[date, str]]:
    m = _MONTHNAME_RE.search(name)
    if not m:
        return None
    mon_key = m.group(1)[:3].lower()
    year = int(m.group(2))
    try:
        parsed = date(year, _MONTH_NUM[mon_key], 1)
    except (ValueError, KeyError):
        return None
    if not _sanity_ok(parsed, today=today):
        return None
    return parsed, m.group(0)


def _parse_spaced_dmy(name: str, *, today: Optional[date] = None
                        ) -> Optional[tuple[date, str]]:
    """v58.13.132mk-a (bundled .132mj) — `EXP DD MM YYYY` licence-ticket form.
    Australian day-month-year, space-separated. Rejects day/month/year
    combos that datetime.date() itself rejects (e.g. 32 01, 05 13,
    29 02 non-leap)."""
    m = _SPACED_DMY_RE.search(name)
    if not m:
        return None
    try:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        parsed = date(y, mo, d)
    except (ValueError, TypeError):
        return None
    if not _sanity_ok(parsed, today=today):
        return None
    return parsed, m.group(0)


def parse_filename_expiry(name: Optional[str],
                             *, today: Optional[date] = None,
                             ) -> ParsedExpiry:
    """Parse SDS-style expiry codes. Returns ParsedExpiry with
    `clean_name` always set (equal to input if no code found).

    Idempotent: parsing an already-clean name returns the same
    name with `expires_at=None`.
    """
    if not isinstance(name, str) or not name:
        return ParsedExpiry(name or "", None, None)

    # Strip .ext first so date detection doesn't confuse the
    # extension. We re-attach it at the end.
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""

    dotted = _parse_dotted(stem, today=today)
    compact = _parse_compact(stem, today=today) if not dotted else None
    monthname = (
        _parse_monthname(stem, today=today)
        if not (dotted or compact) else None
    )
    # v58.13.132mk-a — spaced_dmy tried last so it doesn't collide
    # with monthname (`Exp Nov 2021`) or compact (`EXP042025`).
    spaced_dmy = (
        _parse_spaced_dmy(stem, today=today)
        if not (dotted or compact or monthname) else None
    )
    hit = dotted or compact or monthname or spaced_dmy

    if not hit:
        return ParsedExpiry(name, None, None)

    parsed_date, raw_code = hit
    # Strip the whole expiry clause + any trailing / leading
    # separator artefacts.
    clean_stem = _STRIP_JUNK_RE.sub("", stem)
    clean_stem = re.sub(r"[_\- ]+$", "", clean_stem)
    clean_stem = re.sub(r"^[_\- ]+", "", clean_stem)
    clean = f"{clean_stem}.{ext}" if ext else clean_stem
    return ParsedExpiry(clean, parsed_date.isoformat(), raw_code)


def expiry_bucket(iso_date: Optional[str],
                    *, today: Optional[date] = None,
                    ) -> str:
    """Categorise a parsed expiry into buckets for badge colours.
    Returns one of `expired`, `expiring_soon` (≤6 months), `ok`
    (>6 months), or `unknown` (None input)."""
    if not iso_date:
        return "unknown"
    try:
        d = date.fromisoformat(iso_date)
    except ValueError:
        return "unknown"
    today = today or datetime.now(timezone.utc).date()
    if d < today:
        return "expired"
    if d <= today + timedelta(days=183):
        return "expiring_soon"
    return "ok"
