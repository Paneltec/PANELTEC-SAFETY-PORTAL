"""v160.3.9.58.2 — Failed-row commit path.

Covers the small tuning bundle:

  1. `ApproveBody.include_failed_rows` defaults to True.
  2. `_build_form_submission` produces a `form_submissions` doc for
     failed rows that carries:
       · `needs_review=True`
       · `error_step` from the dryrun record
       · `gridfs_id` link back to the raw PDF
       · `partial_extraction` (whatever the extractor got before it
         crashed)
       · `worker_match.needs_review=True` (belt-and-braces flag).
  3. Successful (`status="ok"`) rows keep the pre-v58.2 shape — no
     `needs_review`, no `error_step`, no `gridfs_id`.
"""
from __future__ import annotations

import bulk_import_prestarts as bip


class TestApproveBodyDefaults:
    def test_include_failed_rows_defaults_true(self):
        body = bip.ApproveBody()
        assert body.approve is True
        assert body.include_failed_rows is True

    def test_can_be_disabled_explicitly(self):
        body = bip.ApproveBody(approve=True, include_failed_rows=False)
        assert body.include_failed_rows is False


class TestBuildFormSubmission:
    _job = {
        "id": "job-abc",
        "org_id": "org-1",
        "actor_id": "user-1",
    }

    def _ok_rec(self):
        return {
            "status": "ok",
            "template_id": "tpl-1",
            "template_name": "Daily Pre-Start",
            "extracted": {"worker_name": "Alex Barbari", "date": "2026-01-01"},
            "worker_match": {"id": "w-1", "confidence": 0.95,
                             "needs_review": False},
            "site_match": {"id": "s-1"},
            "mapped_fields": [{"label": "", "value": "x"}],
            "mapped_count": 1,
            "template_field_count": 20,
            "unmapped_labels": [],
            "classifier": {"template_name": "Daily Pre-Start", "confidence": 0.9},
            "pdf_hash": "hash-ok",
            "cached": False,
        }

    def _failed_rec(self, error_step="vision"):
        return {
            "status": "failed",
            "reason": "claude: HTTP 500",
            "error_step": error_step,
            "gridfs_id": "507f1f77bcf86cd799439011",
            "pdf_hash": "hash-fail",
            # Partial payload — the extractor might have gotten the
            # date but nothing else before Claude timed out.
            "extracted": {"date": "2026-01-01"},
            "worker_match": None,
            "site_match": None,
        }

    # ── ok path ──

    def test_ok_row_no_needs_review_flag(self):
        doc = bip._build_form_submission(
            self._job, self._ok_rec(), "prestart_001.pdf")
        m = doc["metadata"]
        assert "needs_review" not in m
        assert "error_step" not in m
        assert "gridfs_id" not in m
        assert m["worker_match"]["id"] == "w-1"
        assert m["worker_match"]["needs_review"] is False
        assert doc["template_name_snapshot"] == "Daily Pre-Start"
        assert doc["source"] == "bulk_import"
        assert doc["deleted_at"] is None

    # ── failed path ──

    def test_failed_row_carries_needs_review_and_gridfs(self):
        doc = bip._build_form_submission(
            self._job, self._failed_rec(), "broken.pdf")
        m = doc["metadata"]
        assert m["needs_review"] is True
        assert m["error_step"] == "vision"
        assert m["gridfs_id"] == "507f1f77bcf86cd799439011"
        assert m["failure_reason"] == "claude: HTTP 500"
        # Partial extraction preserved so the reviewer can salvage it.
        assert m["partial_extraction"] == {"date": "2026-01-01"}
        # Worker match placeholder flags for-review.
        assert m["worker_match"]["id"] is None
        assert m["worker_match"]["needs_review"] is True
        # Template snapshot falls back to a distinctive label.
        assert "review" in doc["template_name_snapshot"].lower()

    def test_failed_row_without_gridfs_still_marks_needs_review(self):
        """Storage upload can fail (rare — 5xx from Mongo). The row
        must still be committable — just without the PDF link."""
        rec = self._failed_rec()
        rec["gridfs_id"] = None
        doc = bip._build_form_submission(
            self._job, rec, "broken.pdf")
        m = doc["metadata"]
        assert m["needs_review"] is True
        assert m.get("gridfs_id") is None
        assert m["error_step"] == "vision"

    def test_failed_parse_row_gets_correct_error_step(self):
        doc = bip._build_form_submission(
            self._job, self._failed_rec(error_step="parse"), "broken.pdf")
        assert doc["metadata"]["error_step"] == "parse"

    def test_worker_match_dict_is_copied_not_shared(self):
        """The failed-row branch mutates `worker_match["needs_review"]=True`.
        Two calls in the same run must not stomp on each other's dicts."""
        shared_wm = {"id": None, "confidence": 0.0, "needs_review": False}
        rec_a = self._failed_rec()
        rec_a["worker_match"] = shared_wm
        rec_b = self._failed_rec()
        rec_b["worker_match"] = shared_wm
        doc_a = bip._build_form_submission(self._job, rec_a, "a.pdf")
        doc_b = bip._build_form_submission(self._job, rec_b, "b.pdf")
        # `shared_wm` itself must not have been mutated.
        assert shared_wm["needs_review"] is False
        # Both doc metadata payloads still show needs_review=True.
        assert doc_a["metadata"]["worker_match"]["needs_review"] is True
        assert doc_b["metadata"]["worker_match"]["needs_review"] is True
