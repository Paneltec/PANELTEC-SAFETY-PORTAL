"""v58.13.132p0 — Shared SMS parser for Paneltec's whiteboard-issued
job SMS.

Locked contract — Phase 1 of the 5-phase mobile job flow rebuild.
Every worker gets their own SMS (no crew concept until on-site
sign-on). The whiteboard is a black box that dispatches SMS; the
mobile app parses SMS itself (Phase 2 receiver). This module is the
SINGLE parser used by:

  · Web admin's "Issue Today's Job" form (paste-SMS pre-fill).
  · `POST /api/mobile/sms/parse` — used by the future mobile SMS
    receiver.

Contract — the SMS decomposes into exactly SEVEN fields:

    truck       str        e.g. "Cappellotto 2 - Volvo - XT48AK"
    date        str        ISO YYYY-MM-DD (parses DD-MM-YY, DD/MM/YY,
                            DD-MM-YYYY, YYYY-MM-DD, ISO datetimes)
    site_name   str        line 3 of a positional SMS
    address     str        line 4 (contains AU state + postcode)
    customer    str        line 5 (short, no comma)
    staff       list[str]  parsed from a "Staff: A, B, C" line, or a
                            standalone comma-separated UPPERCASE name
                            line, or a "with: A, B, C" line
    notes       str        everything after the staff line, joined
                            with newlines (or single-block)

The parser is DELIBERATELY lenient — Stephen's whiteboard SMS format
is not machine-generated, so we accept:
  · positional 7-line SMS (the canonical shape)
  · labeled SMS ("Truck: …", "Date: …", "Staff: …")
  · mixed (label prefix optional; positional order preserved)
  · extra blank lines, trailing whitespace, curly quotes

NO task, NO supervisor, NO start_time, NO truck_reg-split. Anything
that looks like those tokens is silently swept into `notes` if it
doesn't match one of the seven canonical fields.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import List, Optional


# ─────────────── Public model ───────────────

@dataclass
class ParsedSms:
    truck: Optional[str] = None
    date: Optional[str] = None           # ISO YYYY-MM-DD
    site_name: Optional[str] = None
    address: Optional[str] = None
    customer: Optional[str] = None
    staff: List[str] = field(default_factory=list)
    notes: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "truck": self.truck,
            "date": self.date,
            "site_name": self.site_name,
            "address": self.address,
            "customer": self.customer,
            "staff": list(self.staff),
            "notes": self.notes,
        }


# ─────────────── Date parsing ───────────────

_DATE_PATTERNS = (
    # ISO first — cheap & unambiguous.
    ("%Y-%m-%d",),
    ("%Y/%m/%d",),
    # DD-MM-YY / DD-MM-YYYY (Stephen's SMS uses DD-MM-YY).
    ("%d-%m-%y",),
    ("%d-%m-%Y",),
    ("%d/%m/%y",),
    ("%d/%m/%Y",),
    ("%d.%m.%y",),
    ("%d.%m.%Y",),
)


def _try_iso_datetime(raw: str) -> Optional[str]:
    """Handle ISO 8601 with time component — extract just the date."""
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.date().isoformat()
    except Exception:
        return None


def _parse_date(raw: str) -> Optional[str]:
    """Return YYYY-MM-DD or None. Robust to whitespace + several
    Aussie-style formats. Two-digit years land in 2000-2069 (Y2069
    problem is not ours)."""
    s = (raw or "").strip().strip(".,")
    if not s:
        return None
    iso = _try_iso_datetime(s)
    if iso:
        return iso
    for (fmt,) in _DATE_PATTERNS:
        try:
            d = datetime.strptime(s, fmt).date()
            # For 2-digit years, Python's default rollover happens
            # around 1969/2068 — good enough for civil-contracting SMS.
            return d.isoformat()
        except Exception:
            continue
    return None


# ─────────────── Line classifiers ───────────────

_STATE_TOKENS = ("TAS", "NSW", "VIC", "QLD", "SA", "WA", "NT", "ACT")
_AU_POSTCODE_RX = re.compile(r"\b\d{4}\b")
_AU_STATE_RX = re.compile(r"\b(?:TAS|NSW|VIC|QLD|SA|WA|NT|ACT)\b")

_LABEL_PATTERNS = {
    "truck":     re.compile(r"^\s*(?:truck|vehicle|plant)\s*[:\-]\s*(.+)$", re.I),
    "date":      re.compile(r"^\s*(?:date|day)\s*[:\-]\s*(.+)$", re.I),
    "site":      re.compile(r"^\s*(?:site|job\s*site|location)\s*[:\-]\s*(.+)$", re.I),
    "address":   re.compile(r"^\s*(?:address|addr)\s*[:\-]\s*(.+)$", re.I),
    "customer":  re.compile(r"^\s*(?:customer|client|for)\s*[:\-]\s*(.+)$", re.I),
    "staff":     re.compile(r"^\s*(?:staff(?:\s*on\s*(?:this\s*)?job)?|workers?|crew|with)\s*[:\-]\s*(.+)$", re.I),
    "notes":     re.compile(r"^\s*(?:notes?|remarks?|comments?|special\s*instructions?)\s*[:\-]\s*(.+)$", re.I),
}

_DATE_LOOSE_RX = re.compile(
    r"^\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})\s*$",
)


def _looks_like_address(line: str) -> bool:
    if _AU_STATE_RX.search(line) and _AU_POSTCODE_RX.search(line):
        return True
    # Comma AND number → likely a full street address.
    return "," in line and any(c.isdigit() for c in line)


def _looks_like_staff_names(line: str) -> bool:
    """Comma-separated tokens that read like SHOUTY names.

    Stephen's SMS uses `DANIEL BUTLER, JARROD TARGETT, JASON DONNELLAN`
    — all caps, spaces inside each name. We accept 2+ tokens where
    every token is a two-part name in title-case or upper-case.
    """
    if "," not in line:
        return False
    parts = [p.strip() for p in line.split(",") if p.strip()]
    if len(parts) < 2:
        return False
    for p in parts:
        # Must be at least first + last, letters and spaces only.
        if not re.match(r"^[A-Za-z][A-Za-z .'\-]{1,50}$", p):
            return False
        if len(p.split()) < 1:
            return False
    return True


def _split_staff(raw: str) -> List[str]:
    return [
        s.strip()
        for s in re.split(r"[,;]|(?:\s{2,}|\n)", raw or "")
        if s and s.strip()
    ]


# ─────────────── Main entry point ───────────────

def parse_sms(text: str) -> ParsedSms:
    """Parse `text` into a `ParsedSms`. Never raises; missing fields
    stay None (or empty list for staff).

    Strategy:
      1. Normalise: strip curly quotes, collapse windows line endings,
         drop leading/trailing blank lines. Preserve inner blank lines.
      2. Extract any LABELED lines first — those win over positional
         guessing.
      3. Fill unlabeled slots positionally in the canonical order:
         truck → date → site → address → customer → staff → notes.
      4. Anything left over gets appended to `notes`.
    """
    if not text or not text.strip():
        return ParsedSms()

    # Normalise.
    norm = (
        text.replace("\r\n", "\n")
            .replace("\r", "\n")
            .replace("\u2018", "'").replace("\u2019", "'")
            .replace("\u201c", '"').replace("\u201d", '"')
    )
    lines = [ln.rstrip() for ln in norm.split("\n")]
    # Drop leading/trailing blanks but keep inner blanks (so notes
    # paragraphs survive).
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return ParsedSms()

    out = ParsedSms()
    consumed: set = set()

    # Pass 1 — labeled lines (highest priority).
    for i, ln in enumerate(lines):
        stripped = ln.strip()
        if not stripped:
            continue
        for key, rx in _LABEL_PATTERNS.items():
            m = rx.match(stripped)
            if not m:
                continue
            value = m.group(1).strip()
            if key == "truck" and not out.truck:
                out.truck = value
                consumed.add(i)
            elif key == "date" and not out.date:
                out.date = _parse_date(value) or value  # keep raw as
                # fallback so the FE can still show it while the user
                # corrects the format.
                consumed.add(i)
            elif key == "site" and not out.site_name:
                out.site_name = value
                consumed.add(i)
            elif key == "address" and not out.address:
                out.address = value
                consumed.add(i)
            elif key == "customer" and not out.customer:
                out.customer = value
                consumed.add(i)
            elif key == "staff" and not out.staff:
                out.staff = _split_staff(value)
                consumed.add(i)
            elif key == "notes" and not out.notes:
                out.notes = value
                consumed.add(i)
            break

    # Pass 2 — positional fill on remaining lines. Canonical order:
    # truck, date, site_name, address, customer, staff, notes.
    remaining = [
        (i, ln.strip()) for i, ln in enumerate(lines)
        if i not in consumed and ln.strip()
    ]

    # Truck first (unless label already set).
    def _pop_first() -> Optional[tuple]:
        if remaining:
            return remaining.pop(0)
        return None

    if not out.truck:
        head = _pop_first()
        if head:
            out.truck = head[1]

    # Date next.
    if not out.date:
        if remaining and _DATE_LOOSE_RX.match(remaining[0][1]):
            _, val = remaining.pop(0)
            out.date = _parse_date(val) or val
        else:
            # Look ahead for the first line that IS a date.
            for j, (_, cand) in enumerate(remaining):
                iso = _parse_date(cand)
                if iso:
                    out.date = iso
                    remaining.pop(j)
                    break

    # Site name.
    if not out.site_name:
        head = _pop_first()
        if head:
            out.site_name = head[1]

    # Address — prefer a line that looks like an address; else next.
    if not out.address:
        addr_idx = None
        for j, (_, cand) in enumerate(remaining):
            if _looks_like_address(cand):
                addr_idx = j
                break
        if addr_idx is not None:
            _, val = remaining.pop(addr_idx)
            out.address = val

    # Customer.
    if not out.customer:
        head = _pop_first()
        if head:
            out.customer = head[1]

    # Staff — look for a staff-shaped line anywhere in remaining;
    # else if the next line looks like names, take it.
    if not out.staff:
        staff_idx = None
        for j, (_, cand) in enumerate(remaining):
            if _looks_like_staff_names(cand):
                staff_idx = j
                break
        if staff_idx is not None:
            _, val = remaining.pop(staff_idx)
            out.staff = _split_staff(val)

    # Notes — everything left over, joined with newlines.
    if remaining and not out.notes:
        out.notes = "\n".join(x[1] for x in remaining)
    elif remaining and out.notes:
        extra = "\n".join(x[1] for x in remaining)
        out.notes = f"{out.notes}\n{extra}"

    return out


# ─────────────── Convenience helpers ───────────────

def today_iso_sydney() -> str:
    """Return today's date in Australia/Sydney timezone as YYYY-MM-DD."""
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("Australia/Sydney")).strftime("%Y-%m-%d")


def coerce_date(raw: Optional[str]) -> Optional[str]:
    """Public helper for callers that just need to coerce a date-ish
    string to ISO. Returns None on failure."""
    if not raw:
        return None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw.isoformat()
    return _parse_date(str(raw))
