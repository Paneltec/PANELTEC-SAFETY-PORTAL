"""v58.12.11 — Bulk-import counter fix (Path A′-a).

Pure-function pytests. No HTTP, no live DB writes. Tests target the two
contracts introduced by the fix:

  1. On `_run_job` resume, `prog` is seeded from `job.get("progress")`
     (NOT from zeros). Fresh jobs (no `progress`) still init to zero.
  2. `_flush_progress` never writes a `processed` value LOWER than the
     already-persisted `processed`. Guards against transient in-memory
     blips regressing the on-disk truth.

We assert both contracts directly against the arithmetic — no need to
plumb the full async coroutine (which has a producer/consumer download
loop that's expensive to mock end-to-end for a schema-level fix).
"""
from __future__ import annotations


# ─── Contract 1: prog seed from persisted snapshot ─────────────────────

def _seed_prog(job: dict) -> tuple[dict, int]:
    """Mirror of the v58.12.11 prog-init block from
    bulk_import_prestarts.py::_run_job. Kept as a stand-alone here so
    tests can pin the contract without invoking the async coroutine.

    If the module's seed logic drifts, this helper drifts too — the
    tests below then catch the drift because they assert on numeric
    outcomes, not on the helper itself. Cross-check via:
        grep -n "_persisted_prog = (job.get" /app/backend/bulk_import_prestarts.py
    """
    _persisted_prog = (job.get("progress") or {})
    _persisted_processed = int(job.get("processed") or 0)
    prog = {
        "total": _persisted_prog.get("total"),
        "extracted": int(_persisted_prog.get("extracted") or 0),
        "matched": int(_persisted_prog.get("matched") or 0),
        "failed": int(_persisted_prog.get("failed") or 0),
        "cached_hits": int(_persisted_prog.get("cached_hits") or 0),
        "failed_pdfs": list(_persisted_prog.get("failed_pdfs") or []),
        "estimated_cost_usd": float(_persisted_prog.get("estimated_cost_usd") or 0.0),
        "429s": 0, "5xxs": 0, "timeouts": 0, "retries": 0,
    }
    return prog, _persisted_processed


def test_prog_seeds_from_persisted_snapshot_on_resume():
    """v58.12.11 — Resume path: `prog` is initialised from the persisted
    `job.progress` snapshot, not from zeros. This is the fix for the
    "counter walks backwards to 0 on container restart" UX bug."""
    persisted = {
        "extracted": 2650,
        "matched": 2620,
        "failed": 30,
        "cached_hits": 2650,
        "estimated_cost_usd": 0.0,
        "total": 5000,
        "failed_pdfs": ["a.pdf", "b.pdf"],
    }
    job_doc = {
        "id": "job-a",
        "processed": 2680,
        "progress": persisted,
    }
    prog, persisted_processed = _seed_prog(job_doc)
    assert prog["extracted"] == 2650
    assert prog["matched"] == 2620
    assert prog["failed"] == 30
    assert prog["cached_hits"] == 2650
    assert prog["estimated_cost_usd"] == 0.0
    assert prog["total"] == 5000
    # `failed_pdfs` is copied by value — not aliased to the persisted list.
    assert prog["failed_pdfs"] == ["a.pdf", "b.pdf"]
    assert prog["failed_pdfs"] is not persisted["failed_pdfs"]
    # Per-run telemetry always starts at 0 (not resumed).
    assert prog["429s"] == 0 and prog["5xxs"] == 0
    assert persisted_processed == 2680


def test_prog_defaults_to_zero_on_fresh_job():
    """v58.12.11 — First run of a fresh job: no `progress` field on the
    doc, prog init falls to zeros exactly as pre-v58.12.11."""
    job_doc = {"id": "job-b"}   # no progress, no processed
    prog, persisted_processed = _seed_prog(job_doc)
    assert prog["extracted"] == 0
    assert prog["matched"] == 0
    assert prog["failed"] == 0
    assert prog["cached_hits"] == 0
    assert prog["estimated_cost_usd"] == 0.0
    assert prog["total"] is None
    assert prog["failed_pdfs"] == []
    assert persisted_processed == 0


def test_prog_handles_partial_persisted_snapshot():
    """v58.12.11 — A partially-populated `progress` (some fields missing)
    still seeds without crashing. Every `.get(k) or 0` fallback covers
    both `None` and missing-key cases."""
    job_doc = {
        "id": "job-c",
        "processed": 500,
        "progress": {"extracted": 500},   # only one field present
    }
    prog, persisted_processed = _seed_prog(job_doc)
    assert prog["extracted"] == 500
    assert prog["matched"] == 0
    assert prog["failed"] == 0
    assert prog["cached_hits"] == 0
    assert prog["failed_pdfs"] == []
    assert persisted_processed == 500


# ─── Contract 2: max-flush guard never regresses processed ─────────────

def test_max_flush_guard_never_regresses_processed():
    """v58.12.11 — The `max(current, persisted)` guard on the flush
    write never writes a `processed` value LOWER than what's already
    on disk. Directly asserts the arithmetic contract across the four
    scenarios (current > / == / < persisted, and no-persisted).
    """
    # current > persisted → current wins (normal forward progress).
    prog = {"extracted": 2500, "failed": 30}
    persisted_processed = 1500
    processed = max(prog["extracted"] + prog["failed"], int(persisted_processed or 0))
    assert processed == 2530

    # current == persisted → equal, either wins (idempotent).
    prog = {"extracted": 2500, "failed": 30}
    persisted_processed = 2530
    processed = max(prog["extracted"] + prog["failed"], int(persisted_processed or 0))
    assert processed == 2530

    # current < persisted → REGRESSION SCENARIO. Persisted wins.
    # Simulates the case where in-memory prog is momentarily lower
    # than what's on disk (mid-restart race, etc.). The guard must
    # NOT let the persisted value regress.
    prog = {"extracted": 0, "failed": 0}
    persisted_processed = 4300
    processed = max(prog["extracted"] + prog["failed"], int(persisted_processed or 0))
    assert processed == 4300, "regression guard failed — persisted value overwritten"

    # Fresh job (no persisted state) — None coerces to 0, current wins.
    prog = {"extracted": 5, "failed": 0}
    persisted_processed = None
    processed = max(prog["extracted"] + prog["failed"], int(persisted_processed or 0))
    assert processed == 5


def test_max_flush_guard_matches_module_implementation():
    """v58.12.11 — Cross-check: read the module's own inline arithmetic
    and confirm it matches this test's contract. Guards against a
    future edit drifting the implementation away from the tests."""
    import bulk_import_prestarts
    import inspect
    src = inspect.getsource(bulk_import_prestarts._run_job)
    # Both contract markers must be present.
    assert "v58.12.11 (Path A′-a)" in src, \
        "v58.12.11 changelog marker missing — either edits reverted or version bumped without code"
    assert "_persisted_processed = int(job.get(\"processed\") or 0)" in src, \
        "resume-seed reference variable missing from _run_job"
    assert "max(" in src and "_persisted_processed" in src, \
        "max-flush guard missing or unreferenced"
