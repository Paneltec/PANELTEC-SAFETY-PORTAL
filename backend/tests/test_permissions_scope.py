"""v160.3.9.28 — Pure-function tests for the record-level scoping helper.

Every branch of `scope_filter`, `can_access_record`, and
`require_scoped_access` is exercised. No DB access.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from permissions_scope import (
    can_access_record,
    require_scoped_access,
    scope_filter,
)


ADMIN     = {"id": "u-admin", "email": "a@x", "role": "admin"}
HSEQ      = {"id": "u-hseq",  "email": "h@x", "role": "hseq_lead"}
HSEQ_MGR  = {"id": "u-hm",    "email": "hm@x", "role_id": "hseq_manager"}
SUPER     = {"id": "u-sup",   "email": "s@x", "role": "supervisor"}
WORKER    = {"id": "u-worker","email": "w@x", "role": "worker"}
GEN_USER  = {"id": "u-gu",    "email": "gu@x", "role_id": "general_user", "role": "worker"}
CONTR     = {"id": "u-c",     "email": "c@x", "role_id": "contractor_rep", "company_id": "co-42"}
CONTR_NO_ORG = {"id": "u-c2", "email": "c2@x", "role_id": "contractor_rep"}


# ── scope_filter — privileged short-circuit ─────────────────────

@pytest.mark.parametrize("u", [ADMIN, HSEQ, HSEQ_MGR, SUPER])
@pytest.mark.parametrize("r", ["workers", "contractors", "documents", "notifications", "hr", "certifications"])
def test_scope_filter_privileged_returns_empty(u, r):
    assert scope_filter(u, r) == {}


# ── scope_filter — contractor_rep ───────────────────────────────

def test_scope_filter_contractor_rep_contractors():
    assert scope_filter(CONTR, "contractors") == {"id": "co-42"}


@pytest.mark.parametrize("r", ["workers", "hr", "certifications", "documents"])
def test_scope_filter_contractor_rep_child_resources(r):
    assert scope_filter(CONTR, r) == {"company_id": "co-42"}


def test_scope_filter_contractor_rep_no_org_id_fails_closed():
    filt = scope_filter(CONTR_NO_ORG, "workers")
    assert filt == {"__scope_no_match__": True}


def test_scope_filter_contractor_rep_unknown_resource_no_narrowing():
    assert scope_filter(CONTR, "swms") == {}


# ── scope_filter — general_user / worker ────────────────────────

def test_scope_filter_general_user_workers_prefers_or():
    filt = scope_filter(WORKER, "workers")
    assert "$or" in filt
    assert {"user_id": "u-worker"} in filt["$or"]
    assert {"email": "w@x"} in filt["$or"]


def test_scope_filter_general_user_documents():
    filt = scope_filter(GEN_USER, "documents")
    assert filt == {"$or": [{"created_by": "u-gu"}, {"assignee_id": "u-gu"}]}


def test_scope_filter_general_user_notifications():
    filt = scope_filter(WORKER, "notifications")
    assert filt == {"$or": [{"created_by": "u-worker"}, {"to": "w@x"}]}


def test_scope_filter_general_user_contractors_no_narrowing():
    # Non-contractor_rep non-privileged users see org-wide register
    # (matches pre-v28 behaviour).
    assert scope_filter(WORKER, "contractors") == {}


def test_scope_filter_general_user_hr_fails_closed():
    # HR is admin-only; if this branch ever fires, no PII should leak.
    assert scope_filter(WORKER, "hr") == {"__scope_no_match__": True}


def test_scope_filter_general_user_certifications_fails_closed():
    assert scope_filter(WORKER, "certifications") == {"__scope_no_match__": True}


def test_scope_filter_user_without_id_or_email_fails_closed():
    naked = {"role": "worker"}
    assert scope_filter(naked, "workers") == {"__scope_no_match__": True}
    assert scope_filter(naked, "documents") == {"__scope_no_match__": True}


# ── can_access_record ───────────────────────────────────────────

@pytest.mark.parametrize("u", [ADMIN, HSEQ, HSEQ_MGR, SUPER])
def test_can_access_record_privileged_always_true(u):
    assert can_access_record(u, "workers", {"user_id": "someone-else"}) is True


def test_can_access_record_none_record_is_false():
    assert can_access_record(WORKER, "workers", None) is False


def test_can_access_record_worker_own_by_user_id():
    assert can_access_record(WORKER, "workers", {"user_id": "u-worker"}) is True


def test_can_access_record_worker_own_by_email_fallback():
    assert can_access_record(WORKER, "workers", {"email": "W@X"}) is True


def test_can_access_record_worker_someone_else_false():
    assert can_access_record(WORKER, "workers", {"user_id": "u-other", "email": "z@x"}) is False


def test_can_access_record_contractor_rep_matches_company():
    assert can_access_record(CONTR, "workers", {"company_id": "co-42"}) is True
    assert can_access_record(CONTR, "workers", {"company_id": "co-99"}) is False


def test_can_access_record_contractor_rep_own_contractor():
    assert can_access_record(CONTR, "contractors", {"id": "co-42"}) is True
    assert can_access_record(CONTR, "contractors", {"id": "co-99"}) is False


def test_can_access_record_contractor_rep_missing_company_id_false():
    assert can_access_record(CONTR_NO_ORG, "contractors", {"id": "any"}) is False


def test_can_access_record_documents_owner_or_assignee():
    assert can_access_record(GEN_USER, "documents", {"created_by": "u-gu"}) is True
    assert can_access_record(GEN_USER, "documents", {"assignee_id": "u-gu"}) is True
    assert can_access_record(GEN_USER, "documents", {"created_by": "someone"}) is False


def test_can_access_record_notifications_recipient_list_contains_email():
    doc = {"created_by": "sender", "to": ["w@x", "other@x"]}
    assert can_access_record(WORKER, "notifications", doc) is True


def test_can_access_record_hr_and_certifications_fail_closed_for_general_user():
    assert can_access_record(WORKER, "hr", {"any": "field"}) is False
    assert can_access_record(WORKER, "certifications", {"any": "field"}) is False


# ── require_scoped_access ───────────────────────────────────────

def test_require_scoped_access_ok_no_raise():
    require_scoped_access(WORKER, "workers", {"user_id": "u-worker"})


def test_require_scoped_access_raises_403_with_detail():
    with pytest.raises(HTTPException) as ei:
        require_scoped_access(WORKER, "workers", {"user_id": "someone-else"})
    assert ei.value.status_code == 403
    assert ei.value.detail == "Permission denied: workers.scope"
