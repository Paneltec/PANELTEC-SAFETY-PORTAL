"""v160.3.0 — Canonical cert-kind slugs + fuzzy name matching.

Templates opt into qualification gating by listing one or more slugs
on `form_templates.required_certifications` (module-level list of
strings). At form-open time the mobile client calls
`GET /api/forms/templates/{id}/access-check` — that endpoint uses
the helpers here to resolve slugs to the calling worker's
`worker_certifications` rows and decide whether the worker can
proceed.

Adding a new slug: append to `KINDS` below with (slug, label,
aliases). Aliases are matched case-insensitively after removing
`_-. ` and trailing "cert/certificate/induction/licence/license"
noise words — anything the human-typed cert-name in the database
looks like should land inside `aliases`.

Rationale for keeping this in code (not a DB collection):
  1. Slugs are a small, stable vocabulary curated by us — treating
     them like an enum keeps them versionable + reviewable in git.
  2. Fuzzy matching runs O(1) per cert row so it's cheap to keep in
     Python.
  3. Templates reference slugs; slugs resolve to human names via
     `KIND_LABELS` — DB migrations don't have to rewrite anything if
     the human label changes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterable, Optional


@dataclass(frozen=True)
class CertKind:
    slug: str
    label: str
    aliases: tuple[str, ...] = field(default_factory=tuple)


# NOTE — order here is stable ONLY for display purposes; the slugs are
# the persisted identifiers.
KINDS: tuple[CertKind, ...] = (
    CertKind("white_card", "White Card (Construction Induction)",
             aliases=("white card", "whitecard", "white_card_induction",
                      "general construction induction", "csi")),
    CertKind("first_aid", "First Aid",
             aliases=("first aid", "first_aid", "first_aid_cert",
                      "first aid certificate", "hltaid011", "hltaid012")),
    CertKind("cpr", "CPR",
             aliases=("cpr", "cpr cert", "hltaid009")),
    CertKind("working_at_heights", "Working at Heights",
             aliases=("working at heights", "heights", "wah",
                      "working_at_heights")),
    CertKind("confined_space", "Confined Space Entry",
             aliases=("confined space card", "confined space",
                      "confined space entry", "riiwhs202")),
    CertKind("traffic_control", "Traffic Control",
             aliases=("traffic control", "tc", "riiwhs205",
                      "traffic management")),
    CertKind("hr_licence", "Heavy Rigid Licence",
             aliases=("hr license", "hr licence", "heavy rigid",
                      "hr")),
    CertKind("mr_licence", "Medium Rigid Licence",
             aliases=("mr license", "mr licence", "medium rigid",
                      "mr")),
    CertKind("ewp_licence", "Elevated Work Platform",
             aliases=("ewp", "ewp licence", "boom lift", "scissor lift",
                      "wp licence")),
    CertKind("forklift_licence", "Forklift",
             aliases=("forklift", "lf", "lf licence", "forklift licence")),
    CertKind("dogging", "Dogging",
             aliases=("dogging", "dg", "riihrw302")),
    CertKind("basic_rigging", "Basic Rigging",
             aliases=("basic rigging", "rigging", "rb", "riihrw301")),
    CertKind("taswater_induction", "TasWater Induction",
             aliases=("taswater", "taswater induction", "tas water")),
    CertKind("tasrail_induction", "TasRail Induction",
             aliases=("tas rail", "tasrail", "tasrail induction",
                      "rail corridor")),
    CertKind("airport_induction", "Airport Induction",
             aliases=("airport", "airport induction", "aerodrome")),
)

KINDS_BY_SLUG: dict[str, CertKind] = {k.slug: k for k in KINDS}
KIND_LABELS: dict[str, str] = {k.slug: k.label for k in KINDS}
ALL_SLUGS: frozenset[str] = frozenset(KINDS_BY_SLUG)

# Precomputed lookup: normalised alias → slug. Aliases are stored
# already-normalised so the runtime check is a dict.get on the caller's
# normalised name.
_NOISE_SUFFIXES = ("cert", "certificate", "induction", "licence",
                   "license", "card", "training", "trained")


def _normalise(raw: str) -> str:
    """Case-fold + strip separators + drop trailing noise words."""
    if not raw:
        return ""
    s = raw.strip().lower()
    for ch in ("_", "-", ".", ",", "/", "\\"):
        s = s.replace(ch, " ")
    # Collapse whitespace.
    s = " ".join(s.split())
    # Trim trailing noise words repeatedly (e.g. "first aid certificate" → "first aid").
    changed = True
    while changed:
        changed = False
        for w in _NOISE_SUFFIXES:
            if s.endswith(" " + w):
                s = s[: -(len(w) + 1)].rstrip()
                changed = True
    return s


_ALIAS_INDEX: dict[str, str] = {}
for _k in KINDS:
    # The slug itself + the label + every alias is a candidate.
    for cand in (_k.slug, _k.label, *_k.aliases):
        n = _normalise(cand)
        if n and n not in _ALIAS_INDEX:
            _ALIAS_INDEX[n] = _k.slug


def slug_for_name(name: str) -> Optional[str]:
    """Given a human cert name (as stored on `worker_certifications.name`),
    return the canonical slug or None if we can't confidently map it.

    Never guesses — a substring match only fires when the DB name has
    exactly one non-ambiguous slug hit. This defends against renaming a
    cert on a worker record from silently swapping which template gate
    it satisfies.
    """
    if not name:
        return None
    n = _normalise(name)
    if not n:
        return None
    if n in _ALIAS_INDEX:
        return _ALIAS_INDEX[n]
    # Fallback: contains-match with a single hit only.
    hits = {slug for alias, slug in _ALIAS_INDEX.items()
            if alias and alias in n}
    return next(iter(hits)) if len(hits) == 1 else None


# ─────────────────────────── Status resolution ─────────────────────────

# Warning window before expiry.
EXPIRING_SOON_DAYS = 30


def _parse_expiry(raw) -> Optional[date]:
    """Accept `YYYY-MM-DD` string, ISO datetime, or python date/datetime."""
    if not raw:
        return None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, str):
        try:
            return date.fromisoformat(raw[:10])
        except ValueError:
            return None
    return None


def cert_status(expiry_date, today: Optional[date] = None) -> str:
    """Return one of: `valid`, `expiring_soon`, `expired`, `no_expiry`."""
    today = today or date.today()
    exp = _parse_expiry(expiry_date)
    if exp is None:
        return "no_expiry"
    if exp <= today:
        return "expired"
    delta_days = (exp - today).days
    if delta_days <= EXPIRING_SOON_DAYS:
        return "expiring_soon"
    return "valid"


# Statuses that satisfy a gate. `expired` and `missing` do NOT satisfy.
SATISFYING_STATUSES: frozenset[str] = frozenset({"valid", "expiring_soon", "no_expiry"})


def summarise_worker_certs(cert_docs: Iterable[dict]) -> dict[str, dict]:
    """Group a worker's active certs by resolved slug.

    Returns:
        { slug: {"status": str, "expiry_date": str|None, "raw_name": str} }
    where only certs that resolved to a known slug appear. When the
    same slug appears twice (e.g. renewed First Aid), the row with the
    latest expiry wins — same tiebreaker the v160.2.6-cleanup dedupe
    uses so the two features stay coherent.
    """
    out: dict[str, dict] = {}
    for c in cert_docs:
        slug = slug_for_name(c.get("name") or "")
        if not slug:
            continue
        status = cert_status(c.get("expiry_date"))
        exp_str = c.get("expiry_date")
        # Prefer the row with the latest expiry; string ISO order = chronological.
        prev = out.get(slug)
        prev_key = (prev.get("expiry_date") or "") if prev else ""
        curr_key = exp_str or ""
        if not prev or curr_key > prev_key:
            out[slug] = {
                "status": status,
                "expiry_date": exp_str,
                "raw_name": c.get("name"),
            }
    return out
