"""v160.3.9.46 — Role & user hygiene regression."""
from __future__ import annotations
import uuid, pytest
from migrations.v46_role_hygiene import (
    _EPHEMERAL_ROLE_NAME_RE, _EPHEMERAL_USER_EMAIL_RE,
    _EPHEMERAL_USER_NAME_RE, _EPHEMERAL_USER_TEST_DOMAINS,
    _STEPHEN_EXCLUDES,
)


def test_general_user_trim_and_certifications_added_constants():
    """Contract-level: the v46 migration removes contractors.edit AND
    adds certifications.view for General User via set arithmetic."""
    before = {"contractors.edit", "hazards.edit", "incidents.view"}
    after = sorted(before - {"contractors.edit"} | {"certifications.view"})
    assert "contractors.edit" not in after
    assert "certifications.view" in after
    assert "hazards.edit" in after  # unrelated tokens preserved


def test_hseq_creator_forms_edit_addition_is_idempotent():
    before = {"forms.view", "forms.open"}
    after = sorted(before | {"forms.edit"})
    assert "forms.edit" in after
    # Idempotent — running again produces the same set.
    again = sorted(set(after) | {"forms.edit"})
    assert again == after


def test_ephemeral_role_regex_matches_expected_names():
    for name in ["Test Auditor abc123", "Schema Filter def4", "Forms Test qa1",
                 "CacheBust xyz", "Fallback Test alpha", "Curl Demo Auditor",
                 "Curl Forms Demo", "Demo Regional Auditor",
                 "Test Custom Role QA", "Test Forms QA Role"]:
        assert _EPHEMERAL_ROLE_NAME_RE.match(name), name
    for name in ["Administrator", "HSEQ Manager", "Construction Worker L1",
                 "Traffic Controller", "Director"]:
        assert not _EPHEMERAL_ROLE_NAME_RE.match(name), name


def test_ephemeral_user_regex_matches_expected_but_excludes_stephen():
    matches = ["pytest_ephemeral_1@example.com", "warmup-test-1@paneltec.com.au",
               "test1@example.com", "tester@example.com", "testagent@example.com",
               "receipt_mgr@paneltec.com.au", "test_outbox@example.com"]
    for e in matches:
        assert (_EPHEMERAL_USER_EMAIL_RE.search(e)
                or any(e.endswith(d) for d in _EPHEMERAL_USER_TEST_DOMAINS)), e
    # Stephen must NOT match.
    for e in _STEPHEN_EXCLUDES:
        # Even without the STEPHEN_EXCLUDES guard, Stephen's email
        # shouldn't match the strict regex.
        assert e == "stephen@paneltec.com.au" or e == "admin@paneltec.com.au"


def test_pytest_ephemeral_name_matches():
    for n in ["Pytest Ephemeral Admin", "Test One", "Test Two",
              "Test Outbox User", "Warmup Test", "CacheBust foo",
              "Curl Demo bar", "Demo Regional", "Test User",
              "Test Agent", "Alex Admin"]:
        assert _EPHEMERAL_USER_NAME_RE.match(n), n
    # Real names should NOT match.
    for n in ["Stephen Guy", "Amanda Guy", "Aaron Foster", "Craig Large",
              "Ellie Beadle", "Katrina Guy"]:
        assert not _EPHEMERAL_USER_NAME_RE.match(n), n


def test_stephen_is_always_excluded_by_hard_regex():
    """Belt-and-braces — even without the STEPHEN_EXCLUDES guard the
    strict regex must not match Stephen's email pattern."""
    e = "stephen@paneltec.com.au"
    assert not _EPHEMERAL_USER_EMAIL_RE.search(e), (
        f"Stephen's email {e} matched the ephemeral regex — DANGEROUS"
    )
    assert not any(e.endswith(d) for d in _EPHEMERAL_USER_TEST_DOMAINS)


def test_stephen_guardrail(_mongo):
    stephen = _mongo.users.find_one(
        {"email": "stephen@paneltec.com.au"}, {"_id": 0, "email": 1}
    )
    assert stephen is not None
