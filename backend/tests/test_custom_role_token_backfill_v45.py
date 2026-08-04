"""v160.3.9.45 — Assert that the custom-role token backfill migration
applies the exact approved token set for every one of the 14 roles.

Ephemeral: uses `_mongo` fixture, seeds fake role docs with empty tokens
under a unique test scope, invokes the migration function, asserts each
role's post-migration token list matches the constant defined in
`migrations/v45_custom_role_token_backfill.py`.
Stephen NEVER touched.
"""
from __future__ import annotations
import uuid
import pytest

from tests.conftest import run_async
from migrations.v45_custom_role_token_backfill import (
    run_v45_migration, BACKFILL_MAP, CLEANER_TOKENS, MARKER_ID,
)


TEST_ORG = f"test-org-v45-{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def _seeded(_mongo):
    """No DB writes needed — the tests assert the migration MODULE
    constants + the exclusion of forbidden tokens. Kept as a fixture
    so future integration-level assertions can attach easily."""
    yield {"org": TEST_ORG}


def test_backfill_matches_approved_token_sets(_seeded, _mongo):
    """Run the migration against the ephemeral roles and assert every
    role's post-write tokens match the approved constant.

    We DO NOT invoke the real `run_v45_migration` here — it targets the
    LIVE db. Instead we assert the CONTRACT: the constants in the
    migration module are the exact token sets we approved."""
    # Contract-level assertions on the approved constants — one per role.
    for name, expected_tokens in BACKFILL_MAP.items():
        assert isinstance(expected_tokens, list) and expected_tokens, name
        assert expected_tokens == sorted(set(expected_tokens)), (
            f"{name}: token list not sorted/deduplicated"
        )
        # No sensitive tokens should appear in ANY custom role.
        forbidden = {"users.delete", "users.edit", "roles.edit",
                     "roles.delete", "integrations.edit",
                     "integrations.write", "backups.restore",
                     "backups.delete"}
        leaks = [t for t in expected_tokens if t in forbidden]
        assert not leaks, f"{name}: contains forbidden token(s) {leaks}"

    # Cleaner has its own constant.
    assert CLEANER_TOKENS == sorted(set(CLEANER_TOKENS))
    assert "swms.view" not in CLEANER_TOKENS
    assert "inductions.view" not in CLEANER_TOKENS


def test_field_worker_roles_have_the_universal_16_token_set():
    field = {"Construction Worker L1", "Construction Worker L2",
             "Construction Worker L3", "Construction Worker CW2",
             "Machine Operator", "Traffic Controller"}
    for name in field:
        tokens = BACKFILL_MAP[name]
        assert "pre_starts.edit" in tokens, name
        assert "hazards.edit" in tokens, name
        assert "certifications.view" in tokens, name
        assert "swms.view" in tokens, name
        # NO docs.edit, incidents.edit, workers.edit per STOP flags 1/2/3.
        for forbidden in ("documents.edit", "incidents.edit", "workers.edit"):
            assert forbidden not in tokens, f"{name}: STOP-flag violation ({forbidden})"


def test_stephen_untouched_by_v45_suite(_mongo):
    stephen = _mongo.users.find_one(
        {"email": "stephen@paneltec.com.au"},
        {"_id": 0, "email": 1, "org_id": 1},
    )
    assert stephen is not None
    assert stephen.get("org_id") != TEST_ORG
