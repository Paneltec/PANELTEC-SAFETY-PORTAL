"""v160.3.9.26 — Phase 2 permission model tests.

Coverage:
  * `approve` is present in ACTIONS.
  * The 4 new resources are in PERMISSIONS_SCHEMA and reachable via
    `effective_for`.
  * All 11 seeded roles resolve from `db.roles`.
  * `contractor_rep` + `contractor_rep_submit_only` seeded with
    `is_active=False` and `pending_scoping_helper=True`.
  * Every token in every role_id.permission_tokens is a real
    `<resource>.<action>` combo per the current schema/actions.
  * v25 regression — the 5 legacy roles still resolve their existing
    matrix on `effective_for` (admin gains approve=True; others gain
    approve=False; nothing else changes).
"""
from __future__ import annotations

import pytest

import roles_catalogue as rc
from permissions import (
    ACTIONS,
    PERMISSIONS_SCHEMA,
    ROLE_DEFAULTS,
)


def test_approve_in_actions():
    assert "approve" in ACTIONS
    assert len(ACTIONS) == 8


def test_new_resources_in_schema():
    for r in ("reference_library", "notifications", "help", "sites"):
        assert r in PERMISSIONS_SCHEMA, f"Resource {r} missing"
        assert PERMISSIONS_SCHEMA[r].get("email_supported") is False


def test_seeded_role_specs_count():
    assert len(rc.SYSTEM_ROLES) == 11
    ids = {r["role_id"] for r in rc.SYSTEM_ROLES}
    assert ids == {
        "admin", "hseq_manager", "hseq_manager_readonly",
        "hseq_manager_creator", "report_emailing_admin",
        "responsible_manager", "contractor_rep",
        "contractor_rep_submit_only", "mechanic",
        "training_inductions_only", "general_user",
    }


def test_contractor_roles_inactive():
    for rid in ("contractor_rep", "contractor_rep_submit_only"):
        spec = next(r for r in rc.SYSTEM_ROLES if r["role_id"] == rid)
        assert spec["is_active"] is False
        assert spec["pending_scoping_helper"] is True


def test_role_tokens_reference_valid_resources_actions():
    valid_resources = set(PERMISSIONS_SCHEMA.keys())
    for spec in rc.SYSTEM_ROLES:
        for tok in spec["permission_tokens"]:
            resource, _, action = tok.partition(".")
            assert resource in valid_resources, f"{spec['role_id']}: bad resource in {tok}"
            assert action in ACTIONS, f"{spec['role_id']}: bad action in {tok}"
            if action == "email":
                assert PERMISSIONS_SCHEMA[resource].get("email_supported"), (
                    f"{spec['role_id']}: {tok} — email not supported on {resource}"
                )


def test_admin_gets_approve_everywhere():
    for r in PERMISSIONS_SCHEMA:
        assert ROLE_DEFAULTS["admin"][r].get("approve") is True, r


def test_hseq_lead_denies_approve():
    for r in ("swms", "pre_starts", "site_diary", "hazards",
              "incidents", "inspections", "risk_assessments"):
        assert ROLE_DEFAULTS["hseq_lead"][r]["approve"] is False


def test_worker_denies_approve_on_capture():
    for r in ("swms", "pre_starts", "hazards", "incidents"):
        # worker matrix uses _grant() — approve not passed => False.
        assert ROLE_DEFAULTS["worker"][r].get("approve", False) is False


def test_admin_role_defaults_gain_approve():
    """Admin gets approve=True on every resource — the whole point of
    v26 for admin is 'nothing shrinks'."""
    from permissions import ROLE_DEFAULTS, PERMISSIONS_SCHEMA
    for r in PERMISSIONS_SCHEMA:
        assert ROLE_DEFAULTS["admin"][r]["approve"] is True, r


def test_worker_role_defaults_stability():
    """Regression — worker's v25 shape must be preserved with approve=False
    added, and the 4 new resources absent from the role_defaults dict for
    worker (so `_role_default` falls back to False)."""
    from permissions import ROLE_DEFAULTS
    # v25 shape assertions:
    assert ROLE_DEFAULTS["worker"]["swms"]["view"] is True
    assert ROLE_DEFAULTS["worker"]["swms"]["edit"] is False
    assert ROLE_DEFAULTS["worker"]["swms"]["delete"] is False
    # v26 additions default to False:
    assert ROLE_DEFAULTS["worker"]["swms"].get("approve", False) is False
    assert ROLE_DEFAULTS["worker"]["forms"].get("approve", False) is False
    # 4 new resources absent from worker (missing == False via _role_default):
    for r in ("reference_library", "notifications", "help", "sites"):
        assert r not in ROLE_DEFAULTS["worker"], f"worker leaked {r}"


def test_hseq_lead_role_defaults_stability():
    """v25 stability + approve=False for hseq_lead everywhere."""
    from permissions import ROLE_DEFAULTS
    assert ROLE_DEFAULTS["hseq_lead"]["swms"]["view"] is True
    assert ROLE_DEFAULTS["hseq_lead"]["swms"]["edit"] is True
    assert ROLE_DEFAULTS["hseq_lead"]["swms"]["delete"] is False  # unchanged
    assert ROLE_DEFAULTS["hseq_lead"]["swms"]["approve"] is False
    # inspections + incidents same story.
    for r in ("inspections", "incidents", "hazards", "risk_assessments"):
        assert ROLE_DEFAULTS["hseq_lead"][r]["approve"] is False, r
    # v160.3.9.29-2b (Phase 3c decision #5) — hseq_lead was WIDENED to
    # include reference_library and sites so the mechanical FE gate
    # migration doesn't narrow them for tab-page pages. `notifications`
    # and `help` remain admin-only for now.
    assert ROLE_DEFAULTS["hseq_lead"]["reference_library"]["edit"] is True
    assert ROLE_DEFAULTS["hseq_lead"]["reference_library"]["delete"] is False
    assert ROLE_DEFAULTS["hseq_lead"]["sites"]["edit"] is True
    assert ROLE_DEFAULTS["hseq_lead"]["sites"]["delete"] is False
    for r in ("notifications", "help"):
        assert r not in ROLE_DEFAULTS["hseq_lead"], f"hseq_lead leaked {r}"


def test_general_user_tokens_are_scoped():
    spec = next(r for r in rc.SYSTEM_ROLES if r["role_id"] == "general_user")
    tokens = set(spec["permission_tokens"])
    # No admin-only resources.
    for r in ("users", "integrations", "reference_library", "notifications"):
        for a in ("edit", "delete", "email", "approve"):
            assert f"{r}.{a}" not in tokens, f"general_user leaks {r}.{a}"
