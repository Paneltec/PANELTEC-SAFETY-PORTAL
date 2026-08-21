"""
v58.13.26 Pass 1 — READ-ONLY diagnostic for name overlap between
`hr_employees` and `workers` collections.

Objective:
  - Explain why v58.13.25 auto-suggest (SequenceMatcher >= 0.75) yielded 0 hits.
  - Characterise mismatch patterns (case, order, middle names, disjoint sets).
  - Sweep thresholds 0.75 / 0.60 / 0.50 / 0.40 on raw + normalised names.
  - Spot-check 5 candidate pairs at >= 0.60 for plausibility.
  - Recommend UX: A (bulk wizard), B (browse-only), C (hybrid).

Guardrails:
  - READ-ONLY. Uses only pymongo `.find()` / `.count_documents()`.
  - Never mutates either collection.
  - PII masked: first initial + first 2 chars of surname + '***' (or 'R. S.' minimal).
  - Runs outside backend reload dir (`/app/scripts/diagnostics/`).

Usage:
  python3 /app/scripts/diagnostics/v58_13_26_name_overlap.py
"""

from __future__ import annotations

import os
import re
import string
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from typing import Iterable

from pymongo import MongoClient

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
THRESHOLDS = [0.75, 0.60, 0.50, 0.40]
SPOT_CHECK_N = 5


# ---------------------------------------------------------------------------
# PII helpers
# ---------------------------------------------------------------------------
def mask(first: str, last: str) -> str:
    """R. Sm*** — first initial + 2 chars of surname + ***."""
    f = (first or "").strip()
    l = (last or "").strip()
    fi = (f[:1] + ".") if f else "?."
    lp = (l[:2] + "***") if l else "?***"
    return f"{fi} {lp}"


# ---------------------------------------------------------------------------
# Normalisation strategies
# ---------------------------------------------------------------------------
_PUNCT_RE = re.compile(rf"[{re.escape(string.punctuation)}]")
_WS_RE = re.compile(r"\s+")


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )


def norm_basic(first: str, last: str) -> str:
    """lower + strip accents + strip punct + collapse ws, 'first last' form."""
    s = f"{first or ''} {last or ''}"
    s = _strip_accents(s).lower()
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


def norm_swap(first: str, last: str) -> str:
    """'last first' form after basic normalisation — for reversed-order rosters."""
    s = f"{last or ''} {first or ''}"
    s = _strip_accents(s).lower()
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


def norm_last_first_initial(first: str, last: str) -> str:
    """'last f' — surname + first-initial only (drops middle names & nicknames)."""
    f = (first or "").strip()
    l = (last or "").strip()
    s = f"{l} {f[:1]}"
    s = _strip_accents(s).lower()
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


# ---------------------------------------------------------------------------
# Data load
# ---------------------------------------------------------------------------
def load(db):
    hr_docs = list(
        db["hr_employees"].find(
            {},
            {"_id": 0, "first_name": 1, "last_name": 1, "username": 1, "email": 1},
        )
    )
    # Active workers only (mirror what linker would consider)
    wk_docs = list(
        db["workers"].find(
            {"deleted_at": {"$in": [None]}, "active": True},
            {"_id": 0, "first_name": 1, "last_name": 1, "email": 1},
        )
    )
    return hr_docs, wk_docs


# ---------------------------------------------------------------------------
# Pattern characterisation
# ---------------------------------------------------------------------------
def characterise(docs, label):
    n = len(docs)
    empty_first = sum(1 for d in docs if not (d.get("first_name") or "").strip())
    empty_last = sum(1 for d in docs if not (d.get("last_name") or "").strip())
    has_middle = 0
    has_punct = 0
    has_case_variation = 0
    contains_comma = 0
    contains_paren = 0
    all_upper = 0
    all_lower = 0
    for d in docs:
        f = (d.get("first_name") or "").strip()
        l = (d.get("last_name") or "").strip()
        combined = f"{f} {l}".strip()
        if len(f.split()) > 1 or " " in f:
            has_middle += 1
        if any(ch in string.punctuation for ch in combined):
            has_punct += 1
        if combined and combined == combined.upper():
            all_upper += 1
        elif combined and combined == combined.lower():
            all_lower += 1
        else:
            has_case_variation += 1
        if "," in combined:
            contains_comma += 1
        if "(" in combined or ")" in combined:
            contains_paren += 1
    print(f"\n[{label}] n={n}")
    print(f"  empty first_name  : {empty_first}")
    print(f"  empty last_name   : {empty_last}")
    print(f"  multi-word first  : {has_middle}  (potential middle name / initial)")
    print(f"  punctuation in name: {has_punct}")
    print(f"  ALL-UPPER cases   : {all_upper}")
    print(f"  all-lower cases   : {all_lower}")
    print(f"  Mixed-case cases  : {has_case_variation}")
    print(f"  comma present     : {contains_comma}  (suggests 'Last, First' form)")
    print(f"  parens present    : {contains_paren}  (nicknames?)")


def sample_names(docs, label, k=10):
    print(f"\n[{label}] sample of {min(k, len(docs))} names (PII masked):")
    for d in docs[:k]:
        f = (d.get("first_name") or "").strip()
        l = (d.get("last_name") or "").strip()
        raw_first_shape = f"len(first)={len(f)}"
        raw_last_shape = f"len(last)={len(l)}"
        # Reveal case/order shape without revealing content
        case_shape = (
            "UPPER" if f.isupper() and l.isupper()
            else "lower" if f.islower() and l.islower()
            else "Mixed"
        )
        print(
            f"  {mask(f, l):<15} | first has space? {' ' in f!s:<5} | "
            f"case={case_shape:<5} | {raw_first_shape}, {raw_last_shape}"
        )


# ---------------------------------------------------------------------------
# Threshold sweep
# ---------------------------------------------------------------------------
def sweep(hr_docs, wk_docs, key_fn, label):
    """
    For each hr_employee, find the best worker match under `key_fn` using
    SequenceMatcher.ratio(). Tally how many employees have a best-match ratio
    at or above each threshold.
    """
    hr_keys = [(d, key_fn(d.get("first_name", ""), d.get("last_name", ""))) for d in hr_docs]
    wk_keys = [(d, key_fn(d.get("first_name", ""), d.get("last_name", ""))) for d in wk_docs]

    best_ratios = []
    best_pairs_by_hr = []  # (hr_doc, wk_doc, ratio, hr_key, wk_key)
    exact_matches = 0

    # exact-key matches first (fast)
    wk_key_set = {k for _, k in wk_keys if k}
    for hr_doc, hr_k in hr_keys:
        if hr_k and hr_k in wk_key_set:
            exact_matches += 1

    # ratio-based
    for hr_doc, hr_k in hr_keys:
        if not hr_k:
            best_ratios.append(0.0)
            best_pairs_by_hr.append((hr_doc, None, 0.0, hr_k, None))
            continue
        best_r = 0.0
        best_w = None
        best_wk = None
        for wk_doc, wk_k in wk_keys:
            if not wk_k:
                continue
            r = SequenceMatcher(None, hr_k, wk_k).ratio()
            if r > best_r:
                best_r = r
                best_w = wk_doc
                best_wk = wk_k
        best_ratios.append(best_r)
        best_pairs_by_hr.append((hr_doc, best_w, best_r, hr_k, best_wk))

    print(f"\n[{label}] exact-key matches: {exact_matches} / {len(hr_keys)}")
    print(f"[{label}] threshold sweep (# hr_employees whose BEST match >= T):")
    for t in THRESHOLDS:
        n = sum(1 for r in best_ratios if r >= t)
        pct = (100.0 * n / len(best_ratios)) if best_ratios else 0.0
        print(f"    T>={t:.2f}  : {n:>3} / {len(best_ratios)}  ({pct:5.1f}%)")

    return best_pairs_by_hr


def spot_check(pairs, label, threshold=0.60, k=SPOT_CHECK_N):
    print(f"\n[{label}] spot-check {k} best pairs at ratio >= {threshold} (PII masked):")
    filtered = [p for p in pairs if p[2] >= threshold]
    filtered.sort(key=lambda x: -x[2])
    if not filtered:
        print("    (none — nothing to spot-check at this threshold)")
        return
    for i, (hr, wk, r, hk, wk_k) in enumerate(filtered[:k], 1):
        hr_masked = mask(hr.get("first_name", ""), hr.get("last_name", ""))
        wk_masked = mask(wk.get("first_name", ""), wk.get("last_name", "")) if wk else "—"
        # Reveal minimal structural hints so we can judge plausibility
        hr_flen = len((hr.get("first_name") or "").strip())
        hr_llen = len((hr.get("last_name") or "").strip())
        wk_flen = len((wk.get("first_name") or "").strip()) if wk else 0
        wk_llen = len((wk.get("last_name") or "").strip()) if wk else 0
        # Also compare surname exact match (case-insensitive) as a plausibility hint
        hr_l = (hr.get("last_name") or "").strip().lower()
        wk_l = (wk.get("last_name") or "").strip().lower() if wk else ""
        surname_exact = hr_l == wk_l and bool(hr_l)
        first_exact = ((hr.get("first_name") or "").strip().lower() ==
                       ((wk.get("first_name") or "").strip().lower() if wk else ""))
        print(
            f"  {i}. ratio={r:.3f}  hr={hr_masked}  wk={wk_masked}  "
            f"| surname_exact={surname_exact}  first_exact={first_exact}  "
            f"| lens hr(f={hr_flen},l={hr_llen}) wk(f={wk_flen},l={wk_llen})"
        )


# ---------------------------------------------------------------------------
# Overlap check
# ---------------------------------------------------------------------------
def set_overlap(hr_docs, wk_docs, key_fn, label):
    hr_set = {key_fn(d.get("first_name", ""), d.get("last_name", "")) for d in hr_docs}
    wk_set = {key_fn(d.get("first_name", ""), d.get("last_name", "")) for d in wk_docs}
    hr_set.discard("")
    wk_set.discard("")
    inter = hr_set & wk_set
    print(f"\n[{label}] set-based overlap (exact after normalisation):")
    print(f"  |hr_keys|={len(hr_set)}  |wk_keys|={len(wk_set)}  |intersection|={len(inter)}")


def email_overlap(hr_docs, wk_docs):
    hr_emails = {
        (d.get("email") or "").strip().lower()
        for d in hr_docs
        if (d.get("email") or "").strip()
    }
    wk_emails = {
        (d.get("email") or "").strip().lower()
        for d in wk_docs
        if (d.get("email") or "").strip()
    }
    inter = hr_emails & wk_emails
    print(
        f"\n[email overlap] |hr_emails|={len(hr_emails)}  "
        f"|wk_emails|={len(wk_emails)}  |intersection|={len(inter)}"
    )
    return len(inter)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 78)
    print("v58.13.26 Pass 1 — Name overlap diagnostic (READ-ONLY)")
    print("=" * 78)
    print(f"MONGO_URL={MONGO_URL}  DB_NAME={DB_NAME}")

    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    hr_total = db["hr_employees"].count_documents({})
    wk_total = db["workers"].count_documents({})
    wk_active = db["workers"].count_documents(
        {"deleted_at": {"$in": [None]}, "active": True}
    )
    print(
        f"\nCounts: hr_employees={hr_total}  workers(all)={wk_total}  "
        f"workers(active,not-deleted)={wk_active}"
    )

    hr_docs, wk_docs = load(db)
    print(f"Loaded hr={len(hr_docs)}  wk_active={len(wk_docs)}")

    # 1) Sample + characterisation
    sample_names(hr_docs, "hr_employees", k=10)
    sample_names(wk_docs, "workers (active)", k=10)
    characterise(hr_docs, "hr_employees")
    characterise(wk_docs, "workers (active)")

    # 2) Email overlap (strongest signal if it exists)
    email_overlap(hr_docs, wk_docs)

    # 3) Set-based (exact-after-normalisation) overlaps under three keys
    set_overlap(hr_docs, wk_docs, norm_basic, "norm_basic (first last)")
    set_overlap(hr_docs, wk_docs, norm_swap, "norm_swap (last first)")
    set_overlap(hr_docs, wk_docs, norm_last_first_initial, "norm_last_first_initial")

    # 4) Threshold sweep on raw (what v58.13.25 used) vs normalised
    def raw_key(f, l):
        return f"{(f or '').strip()} {(l or '').strip()}".strip()

    raw_pairs = sweep(hr_docs, wk_docs, raw_key, "RAW ('first last', no normalisation)")
    basic_pairs = sweep(hr_docs, wk_docs, norm_basic, "NORM_BASIC (lower+strip+punct)")
    swap_pairs = sweep(hr_docs, wk_docs, norm_swap, "NORM_SWAP (last first)")
    lfi_pairs = sweep(hr_docs, wk_docs, norm_last_first_initial, "NORM_LAST_FIRST_INITIAL")

    # 5) Spot-check plausibility at >= 0.60 for the two most likely strategies
    spot_check(basic_pairs, "NORM_BASIC", threshold=0.60, k=SPOT_CHECK_N)
    spot_check(lfi_pairs, "NORM_LAST_FIRST_INITIAL", threshold=0.60, k=SPOT_CHECK_N)

    # 6) Distribution of best ratios under norm_basic
    print("\n[NORM_BASIC] distribution of BEST match ratios (histogram):")
    buckets = Counter()
    for _, _, r, _, _ in basic_pairs:
        b = round(r, 1)
        buckets[b] += 1
    for b in sorted(buckets):
        bar = "#" * buckets[b]
        print(f"  {b:.1f}  {buckets[b]:>3}  {bar}")

    print("\n" + "=" * 78)
    print("End of diagnostic. See stdout for numbers; recommendation in report.")
    print("=" * 78)


if __name__ == "__main__":
    main()
