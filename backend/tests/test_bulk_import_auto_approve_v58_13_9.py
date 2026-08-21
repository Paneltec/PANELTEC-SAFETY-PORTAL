"""v58.13.9 — Auto-approve dry-runs with zero new Claude work.

Pure-function pytests. Contract: `_should_auto_approve_dry_run(mode, prog)`
is True iff mode=='dry_run' AND every extracted PDF was a cache hit AND
zero vision failures AND at least one PDF was processed. Any other shape
must remain gated behind the manual `/approve` endpoint.

No HTTP, no live DB writes — the predicate is a pure function; the two
sites that mutate DB state around it (`_run_job` Step 7 and the manual
approve handler) are integration-tested elsewhere.
"""
from __future__ import annotations

from bulk_import_prestarts import _should_auto_approve_dry_run


# ─── Positive: 100% cache-hits AND zero failures → auto-approve ────────

def test_pure_cache_hits_zero_fails_auto_approves():
    prog = {"extracted": 20, "cached_hits": 20, "failed": 0}
    assert _should_auto_approve_dry_run("dry_run", prog) is True


def test_larger_pure_cache_hits_still_auto_approves():
    # Same shape at a much larger scale — the predicate must not silently
    # cap.
    prog = {"extracted": 2650, "cached_hits": 2650, "failed": 0}
    assert _should_auto_approve_dry_run("dry_run", prog) is True


# ─── Negative: any single new extraction → manual gate ─────────────────

def test_one_new_extraction_stays_manual():
    prog = {"extracted": 20, "cached_hits": 19, "failed": 0}
    assert _should_auto_approve_dry_run("dry_run", prog) is False


def test_all_new_extractions_stays_manual():
    prog = {"extracted": 20, "cached_hits": 0, "failed": 0}
    assert _should_auto_approve_dry_run("dry_run", prog) is False


# ─── Negative: any single vision failure → manual gate ─────────────────

def test_one_vision_failure_stays_manual():
    # Even with 100% cache hits AMONG the extracted PDFs, a single
    # failed extraction means the reviewer must eyeball the failed-row
    # PDF before we commit — do not auto-approve.
    prog = {"extracted": 20, "cached_hits": 20, "failed": 1}
    assert _should_auto_approve_dry_run("dry_run", prog) is False


# ─── Negative: degenerate / boundary cases ─────────────────────────────

def test_zero_extracted_stays_manual():
    # 0 processed PDFs is a corrupt / empty archive — must not silently
    # kick a full_run that has nothing to commit.
    prog = {"extracted": 0, "cached_hits": 0, "failed": 0}
    assert _should_auto_approve_dry_run("dry_run", prog) is False


def test_missing_prog_keys_stays_manual():
    # Freshly-restored / partially-populated progress dict — the
    # predicate treats missing keys as zero, so extracted==0 → False.
    assert _should_auto_approve_dry_run("dry_run", {}) is False


# ─── Negative: full_run mode never auto-approves (it's already the
#              approved side of the gate) ─────────────────────────────

def test_full_run_never_auto_approves():
    prog = {"extracted": 20, "cached_hits": 20, "failed": 0}
    assert _should_auto_approve_dry_run("full_run", prog) is False


def test_unknown_mode_never_auto_approves():
    prog = {"extracted": 20, "cached_hits": 20, "failed": 0}
    assert _should_auto_approve_dry_run("bogus_mode", prog) is False
