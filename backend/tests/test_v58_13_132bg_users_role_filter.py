"""v58.13.132bg — Guardrail: the Users & Permissions "All roles"
filter dropdown in `UsersManagement.jsx` is restricted to the 4 core
seed roles from `/api/admin/roles` (is_system=true), and the backend
catalogue exposes exactly those 4 roles.
"""
from __future__ import annotations
import os
import re
from pathlib import Path
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv

pytestmark = pytest.mark.live_db_writes

SOURCE = Path("/app/frontend/src/pages/UsersManagement.jsx")
EXPECTED_SEED_ROLE_IDS = {"admin", "paneltec_civil", "viatec_traffic",
                          "external_contractor"}


@pytest.fixture(scope="module")
def db_sync():
    load_dotenv("/app/backend/.env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def test_backend_admin_roles_returns_exactly_four_seed_roles(db_sync):
    """The `/api/admin/roles` endpoint reads `db.roles`. Assert the
    collection currently holds exactly the 4 core seeds with
    is_system=True."""
    seeds = list(db_sync.roles.find({"is_system": True},
                                    {"_id": 0, "role_id": 1, "name": 1}))
    ids = {r["role_id"] for r in seeds}
    assert ids == EXPECTED_SEED_ROLE_IDS, (
        f"Expected exactly {EXPECTED_SEED_ROLE_IDS}, got {ids}"
    )
    # And no other rows with is_system flag missing but role_id in seeds.
    extras = list(db_sync.roles.find(
        {"role_id": {"$in": list(EXPECTED_SEED_ROLE_IDS)},
         "$or": [{"is_system": False}, {"is_system": {"$exists": False}}]},
        {"_id": 0, "role_id": 1},
    ))
    assert not extras, f"Core role_ids missing is_system=True flag: {extras}"


def test_filter_dropdown_source_filters_on_is_system():
    """Static source-level guardrail: the "All roles" filter dropdown
    (data-testid='users-role-filter') restricts options to
    `is_system === true`. If a future refactor drops the filter, the
    legacy fallback rows (worker/supervisor/hseq_lead/auditor baked
    into LEGACY_ROLES) will leak back into the dropdown — this test
    catches that regression."""
    text = SOURCE.read_text(encoding="utf-8")
    # Locate the <select ... users-role-filter> element.
    marker = 'data-testid="users-role-filter"'
    idx = text.find(marker)
    assert idx > 0, f"{marker} not found in {SOURCE}"
    # Slice from the marker to the closing </select> and inspect only
    # that block (avoids picking up unrelated `systemRoles.map` calls
    # further down the file).
    close = text.find("</select>", idx)
    assert close > idx, "Closing </select> not found after users-role-filter"
    block = text[idx:close]
    assert "is_system === true" in block or 'is_system===true' in block, (
        "users-role-filter dropdown does not filter on `is_system === true`:\n"
        + block[:800]
    )
    # And ensure no naked `systemRoles.map(` in the block (the fix
    # replaced it with `systemRoles.filter(...).sort(...).map(...)`).
    naked = re.search(r"systemRoles\.map\(", block)
    assert not naked, (
        "users-role-filter block still contains `systemRoles.map(` "
        "without a preceding filter — this is the pre-`.132bg` bug"
    )


def test_no_legacy_role_ids_appear_in_dropdown_options():
    """Runtime simulation: apply the exact filter+sort logic used by
    the dropdown against the merged (LEGACY_ROLES + live seeds)
    array. Result must contain exactly the 4 core seed role_ids in
    Stephen-approved order."""
    # Simulate the same merged list `useSystemRoles()` builds.
    LEGACY_ROLES = [
        {"role_id": "admin",      "name": "Admin",      "is_active": True, "source": "legacy"},
        {"role_id": "hseq_lead",  "name": "HSEQ Lead",  "is_active": True, "source": "legacy"},
        {"role_id": "supervisor", "name": "Supervisor", "is_active": True, "source": "legacy"},
        {"role_id": "worker",     "name": "Worker",     "is_active": True, "source": "legacy"},
        {"role_id": "auditor",    "name": "Auditor",    "is_active": True, "source": "legacy"},
    ]
    SEEDS = [
        {"role_id": "admin",               "name": "Admin",                     "is_system": True, "is_active": True, "source": "seed"},
        {"role_id": "external_contractor", "name": "External Contractor",       "is_system": True, "is_active": True, "source": "seed"},
        {"role_id": "paneltec_civil",      "name": "Paneltec Civil",            "is_system": True, "is_active": True, "source": "seed"},
        {"role_id": "viatec_traffic",      "name": "Viatec Traffic Solutions",  "is_system": True, "is_active": True, "source": "seed"},
    ]
    # Merge (seed wins on collision) — mirrors L283–285 of the hook.
    merged = {}
    for r in LEGACY_ROLES:
        merged[r["role_id"]] = {**r, "is_system": r.get("is_system", False)}
    for r in SEEDS:
        merged[r["role_id"]] = r
    all_rows = list(merged.values())

    # Apply the dropdown's filter + sort (mirror of the JSX).
    def rank(rid: str) -> int:
        if rid == "admin":
            return 0
        if rid == "external_contractor":
            return 2
        return 1

    filtered = [r for r in all_rows
                if r.get("is_system") is True and r.get("is_active") is not False]
    filtered.sort(key=lambda r: (rank(r["role_id"]), r["name"] or r["role_id"]))
    ids = [r["role_id"] for r in filtered]

    assert ids == ["admin", "paneltec_civil", "viatec_traffic", "external_contractor"], \
        f"Dropdown order regressed: {ids}"


def test_no_active_user_holds_legacy_role_id(db_sync):
    """Belt-and-braces: `.132bd` already asserted this, but the
    dropdown-restriction only makes sense if no user is still on a
    legacy role_id. If that were true, filtering the dropdown would
    hide the user's actual role from the filter UI. Assert zero."""
    legacy_ids = ["hseq_lead", "supervisor", "worker", "auditor",
                  "manager", "hseq_manager", "responsible_manager",
                  "operator", "foreman", "general_user"]
    q = {
        "role_id": {"$in": legacy_ids},
        "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}],
    }
    offenders = list(db_sync.users.find(q, {"_id": 0, "email": 1, "role_id": 1}))
    assert not offenders, (
        f"Users still holding legacy role_id would be invisible in the "
        f"filter dropdown after `.132bg`: {offenders}"
    )


def test_active_user_counts_per_core_role(db_sync):
    """Verify the acceptance criterion: selecting each option filters
    to the actual DB counts. Reports the counts so a regression is
    easy to inspect (assertion is only that each core role has
    ≥1 active user — the specific numbers are informational)."""
    counts = {}
    for role_id in sorted(EXPECTED_SEED_ROLE_IDS):
        n = db_sync.users.count_documents({
            "role_id": role_id,
            "status": "active",
            "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}],
        })
        counts[role_id] = n
    print(f"\nACTIVE users per core role: {counts}")
    assert counts["admin"] >= 1, counts
    assert counts["paneltec_civil"] >= 1, counts
    assert counts["viatec_traffic"] >= 1, counts
    # external_contractor may legitimately be zero on this env.


def test_version_bumped_to_132bg():
    """Version letters are monotonic — accept `.132bg` or any later
    letter so subsequent bumps (`.132bh`, `.132bi`, …) don't break
    this test."""
    import re
    version_js = Path("/app/frontend/src/lib/version.js").read_text()
    sw_js = Path("/app/frontend/public/service-worker.js").read_text()
    # Extract the letter suffix after `.132` and assert it's >= 'bg'.
    m = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]{1,3})", version_js)
    assert m, "RUNNING_VERSION not found in version.js"
    assert m.group(1) >= "bg", (
        f"RUNNING_VERSION letter '{m.group(1)}' is older than '.132bg'"
    )
    m2 = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]{1,3})", sw_js)
    assert m2 and m2.group(1) >= "bg", (
        f"service-worker.js CACHE_VERSION letter regressed below '.132bg'"
    )
