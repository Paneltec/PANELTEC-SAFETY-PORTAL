"""v58.13.132u — Cleanup + fuel sort polish tests."""
from __future__ import annotations
import os
import sys

import pytest

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"

DROPPED_COLLECTIONS = frozenset({
    "form_templates_backup_v160_1_6",
    "form_templates_backup_v160_2_2",
    "form_templates_backup_v160_2_3",
    "form_templates_backup_v160_2_6cat",
    "form_templates_backup_v160_3_0",
    "form_templates_backup_v160_3_0_apply",
    "form_templates_backup_v160_3_0_ungate_incidents",
})


def _fresh_db():
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return c[os.environ["DB_NAME"]]


# ─── Drop verification / idempotency ─────────────────────────
@pytest.mark.asyncio
async def test_form_template_backups_dropped():
    db = _fresh_db()
    names = set(await db.list_collection_names())
    still_present = DROPPED_COLLECTIONS & names
    assert not still_present, f"orphan backup collections still exist: {still_present}"


@pytest.mark.asyncio
async def test_form_templates_current_untouched():
    """The live `form_templates` collection must not have been
    affected by the backup-drops."""
    db = _fresh_db()
    n = await db.form_templates.count_documents({})
    assert n >= 100, (
        f"live form_templates dropped from ~139 to {n} — backup-drop "
        "hit the wrong collection"
    )


# ─── Sort verification ───────────────────────────────────────
@pytest.mark.asyncio
async def test_reports_sort_dpl_desc_then_price_then_null_sink():
    """Combined sort invariants (single aggregation call — module-
    singleton event-loop constraint).
      1. Rows sorted by `dpl desc` primary.
      2. Ties broken by `total_price desc`.
      3. Null-dpl rows sink to the bottom."""
    import fleet_fuel_reports  # noqa: WPS433
    result = await fleet_fuel_reports._aggregate(
        org_id=ORG_ID, scope="vehicle", period="monthly",
        from_date=None, to_date=None,
    )
    rows = result["rows"]
    assert len(rows) >= 2

    # (1) dpl desc — nulls treated as -1 to sort last.
    dpls = [r["dpl"] if r["dpl"] is not None else -1 for r in rows]
    assert dpls == sorted(dpls, reverse=True), "rows not sorted by dpl desc"

    # (2) tiebreak by total_price desc within dpl tie.
    for i in range(len(rows) - 1):
        if rows[i]["dpl"] == rows[i + 1]["dpl"]:
            assert rows[i]["total_price"] >= rows[i + 1]["total_price"], (
                f"tiebreak violation at {i}"
            )

    # (3) null-dpl rows appear only after all non-null-dpl rows.
    seen_null = False
    for r in rows:
        if r["dpl"] is None:
            seen_null = True
        elif seen_null:
            pytest.fail(
                f"non-null dpl {r['dpl']} appears AFTER a null-dpl row"
            )
