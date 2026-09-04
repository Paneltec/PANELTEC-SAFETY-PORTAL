"""v58.13.109 — Regression-lock for the Precast Panel role's
permission-token equivalence with Construction Worker L1.

CANONICAL STORAGE PATH — verified during this ship:
  Collection:  `db.roles`
  Key:         `role_id` (e.g. `custom_precast_panel_employee`,
                          `custom_construction_worker_l1`)
  Field:       `permission_tokens: list[str]` where each token is a
                          `"{resource}.{action}"` pair matching the
                          `PERMISSIONS_SCHEMA` × `ACTIONS` product
                          in `backend/permissions.py`.

The `permissions` field the brief called out as "empty on all roles"
is a red-herring: no such field is stored on role rows. The Roles UI
dumps `permission_tokens[]` under that label — the underlying store
uses the singular canonical name above. See
`backend/scripts/backfill_broken_role_tokens_v58_4.py` for the
established seed pattern this test locks in for Precast Panel.

Guards enforced:
  · Both roles have exactly 16 tokens.
  · The two token sets are IDENTICAL (byte-for-byte after sort).
  · Every expected daily-loop token is present in the Precast set
    (spot-check for the six most-load-bearing tokens).
"""
from __future__ import annotations
import asyncio
import os
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
load_dotenv(str(BACKEND / ".env"))

PRECAST_ROLE_ID = "custom_precast_panel_employee"
WORKER_L1_ROLE_ID = "custom_construction_worker_l1"

# Load-bearing tokens the field-worker daily loop depends on. Kept as a
# spot-check so a regression that pruned the set to (say) view-only
# without also updating this list fails loudly.
EXPECTED_TOKENS_CORE = {
    "pre_starts.open", "pre_starts.view", "pre_starts.edit",
    "hazards.open",    "hazards.view",    "hazards.edit",
}


def _sync_db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _load_tokens(role_id: str) -> list[str]:
    doc = _sync_db().roles.find_one({"role_id": role_id}, {"_id": 0, "permission_tokens": 1})
    assert doc is not None, f"role {role_id!r} not found in db.roles"
    return sorted(doc.get("permission_tokens") or [])


def test_canonical_storage_path_is_db_roles_permission_tokens():
    """Sanity — the storage-path assumption in this test file is real."""
    doc = _sync_db().roles.find_one(
        {"role_id": PRECAST_ROLE_ID},
        {"_id": 0, "permission_tokens": 1},
    )
    assert doc is not None, f"{PRECAST_ROLE_ID} missing from db.roles"
    assert "permission_tokens" in doc, (
        "permission_tokens field is the canonical storage; "
        "if this fails the role schema drifted — check the memo "
        "memory/v58_13_109_permissions_storage_trace.md"
    )
    assert isinstance(doc["permission_tokens"], list)


def test_precast_panel_has_16_tokens():
    tokens = _load_tokens(PRECAST_ROLE_ID)
    assert len(tokens) == 16, f"expected 16 tokens; got {len(tokens)}: {tokens!r}"


def test_precast_panel_tokens_match_construction_worker_l1_exactly():
    """Bit-for-bit equivalence. If either role drifts (someone adds a
    token to L1 without mirroring to Precast, or vice versa) this
    fails with a symmetric-difference diff so the drift is obvious."""
    precast = set(_load_tokens(PRECAST_ROLE_ID))
    worker_l1 = set(_load_tokens(WORKER_L1_ROLE_ID))
    only_in_precast = precast - worker_l1
    only_in_worker_l1 = worker_l1 - precast
    assert precast == worker_l1, (
        f"Precast Panel and Construction Worker L1 token sets have drifted.\n"
        f"  only in Precast:  {sorted(only_in_precast)}\n"
        f"  only in L1:       {sorted(only_in_worker_l1)}"
    )


def test_precast_panel_carries_core_daily_loop_tokens():
    """Spot-check: every load-bearing daily-loop token is present.
    Catches the specific case where a re-seed narrowed both roles by
    the same amount (test above would still pass) but broke the
    intended field-worker capability."""
    tokens = set(_load_tokens(PRECAST_ROLE_ID))
    missing = EXPECTED_TOKENS_CORE - tokens
    assert not missing, f"Precast Panel is missing core daily-loop tokens: {missing}"
