"""v58.13.132au — SmartFill API/CSV dedupe backfill.

Investigation summary (Stephen's XT02AX report, 2026-09-08):
    Fuel Report showed XT02AX Sep 1-8 rollup as 604.75 L / $1,814.25
    across 6 fills, but only 4 unique SmartFill fills happened. The
    other two rows were CSV imports of the same fills already
    stored via the SmartFill API sync. Fleet-wide: 542 excess rows
    (9.85 % of 5,503) across 541 duplicate groups; 539 of those
    groups are the (smartfill_api + smartfill_csv) pair pattern.

Root cause:
    `fleet_fuel.py::_compose_dedupe_hash` hashed the ISO timestamp
    at second precision. SmartFill CSV export records real seconds
    (`06:28:07`); SmartFill Transactions:Read API only exposes
    minute precision (`6:28am` → `06:28:00`). Same fill, different
    hashes, dedupe missed it. `transaction_id` is populated on API
    rows only, so the txn_id fast-path never fired either.

This script does three things (in commit mode):

  1. **Merge + soft-delete twins.** For every group of live rows
     sharing (org_id, registration, card_number, date_iso, litres),
     pick a canonical survivor. Preference order:
        · `smartfill_api` source (has transaction_id, clean minute-
          precision time).
        · Then the row with the most non-null attribution fields.
        · Then oldest `imported_at`.
     For each non-survivor: copy any non-null CSV-only field
     (driver, odometer_km, engine_hours, from_site, description,
     unit_price, job, job_code) onto the survivor if the survivor's
     field is null (mirrors `_FUEL_UPSERT_ENABLED` merge). Then
     soft-delete the non-survivor with
     `deleted_at = now`, `deleted_reason = "dupe_backfill_.132au"`,
     `deleted_by = "system"`, `_backfill_dedupe_survivor_id = <id>`.

  2. **Normalise stored hash on every live row.** Recompute
     `dedupe_hash` using the minute-precision function shipped in
     `.132au`. Persist the new value. This is what future ingests
     will collide against.

  3. **Print before/after totals** for the fleet and the top
     offenders so the ship memo can quote hard numbers.

Rollback:
    `python scripts/rollback_dedupe_v58_13_132au.py --commit`
    un-soft-deletes every row where
    `deleted_reason == 'dupe_backfill_.132au'` (and restores the
    unmerged fields is out-of-scope — merge is non-destructive so
    the survivor keeps everything). Keep this script for at least
    one week post-ship.

Usage:
    python scripts/backfill_dedupe_v58_13_132au.py             # dry-run
    python scripts/backfill_dedupe_v58_13_132au.py --commit    # execute
"""
from __future__ import annotations
import argparse
import asyncio
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from db import db  # noqa: E402
from fleet_fuel import _compose_dedupe_hash  # noqa: E402


DELETED_REASON = "dupe_backfill_.132au"

# Fields we merge from the losing row onto the winner if the winner
# is null. Mirrors `_UPSERT_FILL_FIELDS` in `fleet_fuel.py`.
MERGE_FIELDS = (
    "driver", "from_site", "description", "fuel_type",
    "odometer_km", "engine_hours",
    "unit_price", "job", "job_code",
    # Attribution — only copy if the winner is unmatched.
    "resolved_driver_name", "resolved_driver_worker_id",
)


def _pick_survivor(rows: list[dict]) -> dict:
    """v58.13.132au — Choose the canonical row from a dupe group.

    Preferences (highest wins):
      1. `smartfill_api` source (has transaction_id, minute-precision
         time — the canonical shape going forward).
      2. Most non-null attribution fields (driver + asset_id + etc).
      3. Earliest `imported_at` (be predictable).
    """
    def sort_key(r: dict) -> tuple:
        api = 1 if r.get("source") == "smartfill_api" else 0
        has_txn = 1 if r.get("transaction_id") else 0
        filled = sum(1 for f in MERGE_FIELDS if r.get(f) not in (None, ""))
        # Descending on api / has_txn / filled, ascending on imported_at.
        imported = r.get("imported_at") or ""
        return (-api, -has_txn, -filled, imported)
    return sorted(rows, key=sort_key)[0]


def _needs_merge(winner: dict, loser: dict) -> dict:
    """Return {field: value} of non-null values to copy from loser
    onto winner where winner's copy is null / empty string."""
    updates: dict = {}
    for f in MERGE_FIELDS:
        val = loser.get(f)
        if val is None or (isinstance(val, str) and not val.strip()):
            continue
        cur = winner.get(f)
        is_missing = cur is None or (isinstance(cur, str) and not cur.strip())
        if is_missing:
            updates[f] = val
    return updates


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--org-id", default=None,
                    help="Optional: restrict to a single org_id.")
    args = ap.parse_args()

    q = {"deleted_at": None}
    if args.org_id:
        q["org_id"] = args.org_id

    now_iso = datetime.now(timezone.utc).isoformat()
    total_live = await db.fuel_transactions.count_documents(q)
    print(f"live rows in scope: {total_live}  commit={args.commit}")

    # ── 1. Group by (org_id, registration, card_number, date_iso, litres) ──
    groups: dict[tuple, list[dict]] = defaultdict(list)
    async for r in db.fuel_transactions.find(q):
        key = (
            r.get("org_id"),
            r.get("registration"),
            r.get("card_number"),
            r.get("date_iso"),
            round(r.get("litres") or 0, 3),
        )
        groups[key].append(r)

    dupe_groups = {k: v for k, v in groups.items() if len(v) > 1}
    excess_rows = sum(len(v) - 1 for v in dupe_groups.values())
    api_csv_groups = sum(
        1 for v in dupe_groups.values()
        if {r.get("source") for r in v} >= {"smartfill_api", "smartfill_csv"}
    )
    print(f"dupe groups: {len(dupe_groups)}   excess rows: {excess_rows}   "
          f"api+csv pairs: {api_csv_groups}")

    # Before-litres per top-offender rego (all-time).
    per_reg_before = defaultdict(lambda: [0, 0.0, 0.0])  # [rows, L, $]
    for k, rows in groups.items():
        reg = k[1] or "None"
        for r in rows:
            per_reg_before[reg][0] += 1
            per_reg_before[reg][1] += r.get("litres") or 0
            per_reg_before[reg][2] += r.get("total_price") or 0

    # ── 2. Plan merges + soft-deletes for each dupe group ─────────
    plan_soft_delete: list[tuple[dict, dict, dict]] = []  # (loser, winner, merge_updates)
    for k, rows in dupe_groups.items():
        winner = _pick_survivor(rows)
        for loser in rows:
            if loser["id"] == winner["id"]:
                continue
            merge_updates = _needs_merge(winner, loser)
            plan_soft_delete.append((loser, winner, merge_updates))

    print(f"planned soft-deletes: {len(plan_soft_delete)}")
    fields_to_fill = sum(1 for _, _, u in plan_soft_delete if u)
    print(f"  of which will carry over ≥1 non-null field: {fields_to_fill}")

    # ── 3. Plan hash normalisation on all live rows ────────────────
    hash_updates: list[tuple[str, str]] = []  # (id, new_hash)
    hash_changed = 0
    async for r in db.fuel_transactions.find(q, {
        "id": 1, "org_id": 1, "card_number": 1, "key_code": 1,
        "registration": 1, "timestamp": 1, "litres": 1, "dedupe_hash": 1,
    }):
        new_hash = _compose_dedupe_hash(
            card_number=r.get("card_number") or "",
            key_code=r.get("key_code") or "",
            registration=r.get("registration") or "",
            timestamp=r.get("timestamp") or "",
            litres=r.get("litres") or 0.0,
        )
        old_hash = r.get("dedupe_hash")
        if new_hash and new_hash != old_hash:
            hash_updates.append((r["id"], new_hash))
            hash_changed += 1
    print(f"hash normalisations needed: {hash_changed}")

    if not args.commit:
        # Dry-run: preview the top-10 impact.
        print("\n=== DRY-RUN: top 10 dupe-impact regos (all-time before) ===")
        # Ranked by excess-rows-in-group (loose proxy).
        excess_by_reg = defaultdict(int)
        excess_l_by_reg = defaultdict(float)
        for k, rows in dupe_groups.items():
            reg = k[1] or "None"
            excess_by_reg[reg] += len(rows) - 1
            excess_l_by_reg[reg] += (len(rows) - 1) * (rows[0].get("litres") or 0)
        for reg, cnt in sorted(excess_by_reg.items(),
                               key=lambda x: -excess_l_by_reg[x[0]])[:10]:
            print(f"  {reg}: {cnt} excess rows, "
                  f"{excess_l_by_reg[reg]:.1f} L over-counted")
        print("\n(dry-run — no writes) run with --commit to apply")
        return

    # ── 4. COMMIT ──────────────────────────────────────────────────
    soft_deleted = 0
    merged_fields_total = 0
    hashes_written = 0

    # Perform merges first so the survivor is enriched before we
    # touch the loser (though the operations are independent).
    for loser, winner, merge_updates in plan_soft_delete:
        if merge_updates:
            merge_updates_with_meta = {
                **merge_updates,
                "_dedupe_backfill_merged_at": now_iso,
                "_dedupe_backfill_merged_from": loser["id"],
                "updated_at": now_iso,
            }
            await db.fuel_transactions.update_one(
                {"id": winner["id"], "org_id": winner["org_id"]},
                {"$set": merge_updates_with_meta},
            )
            merged_fields_total += len(merge_updates)

        await db.fuel_transactions.update_one(
            {"id": loser["id"], "org_id": loser["org_id"]},
            {"$set": {
                "deleted_at": now_iso,
                "deleted_reason": DELETED_REASON,
                "deleted_by": "system",
                "_backfill_dedupe_survivor_id": winner["id"],
                "updated_at": now_iso,
            }},
        )
        soft_deleted += 1

    # Now re-hash surviving live rows.
    for row_id, new_hash in hash_updates:
        # Only touch rows that are still live (loser rows were soft-
        # deleted above; the partial unique index excludes them, so
        # writing wouldn't be a collision — but skip for cleanliness).
        result = await db.fuel_transactions.update_one(
            {"id": row_id, "deleted_at": None},
            {"$set": {"dedupe_hash": new_hash, "updated_at": now_iso}},
        )
        if result.modified_count:
            hashes_written += 1

    print(f"\nCOMMIT complete:")
    print(f"  soft-deleted: {soft_deleted}")
    print(f"  merged non-null fields onto survivors: {merged_fields_total}")
    print(f"  hash normalisations written: {hashes_written}")

    # ── 5. Post-commit before/after summary ────────────────────────
    post_live = await db.fuel_transactions.count_documents(q)
    print(f"\nrow count: {total_live} → {post_live}  (delta {post_live - total_live})")

    for reg_probe in ("XT02AX", "XT16AB"):
        pre_rows, pre_l, pre_p = per_reg_before.get(reg_probe, [0, 0.0, 0.0])
        after_q = {"deleted_at": None, "registration": reg_probe}
        if args.org_id:
            after_q["org_id"] = args.org_id
        after_cur = db.fuel_transactions.find(after_q)
        n = 0; l = 0.0; p = 0.0
        async for r in after_cur:
            n += 1; l += r.get("litres") or 0; p += r.get("total_price") or 0
        print(f"  {reg_probe}: rows {pre_rows}→{n}   litres {pre_l:.1f}→{l:.1f}   $ {pre_p:.2f}→{p:.2f}")

    # Fleet-wide last 7 days delta.
    from_date = "2026-09-01"
    to_date = "2026-09-08"
    pre_7d = [0, 0.0, 0.0]
    for k, rows in groups.items():
        for r in rows:
            di = r.get("date_iso") or ""
            if from_date <= di <= to_date:
                pre_7d[0] += 1
                pre_7d[1] += r.get("litres") or 0
                pre_7d[2] += r.get("total_price") or 0
    post_7d = [0, 0.0, 0.0]
    q_7d = {"deleted_at": None,
            "date_iso": {"$gte": from_date, "$lte": to_date}}
    if args.org_id:
        q_7d["org_id"] = args.org_id
    async for r in db.fuel_transactions.find(q_7d):
        post_7d[0] += 1
        post_7d[1] += r.get("litres") or 0
        post_7d[2] += r.get("total_price") or 0
    print(f"  fleet {from_date}..{to_date}: rows {pre_7d[0]}→{post_7d[0]}   "
          f"litres {pre_7d[1]:.1f}→{post_7d[1]:.1f}   "
          f"$ {pre_7d[2]:.2f}→{post_7d[2]:.2f}")


if __name__ == "__main__":
    asyncio.run(main())
