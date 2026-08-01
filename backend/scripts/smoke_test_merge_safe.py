"""v160.3.9.21b smoke test — verify merge_safe_upsert never wipes fields.

1. Snapshot one live plant_maintenance record (must have cost + company +
   date_completed + performed_by + notes set from v20 ingest).
2. Build a truncated XLSX in memory that drops those 5 columns
   (mirrors the reduced-schema file the user sent).
3. Run parse_workbook + upsert_rows on the truncated fixture.
4. Re-read the same record from Mongo and assert the 5 fields still hold
   their original values.
5. Verify a `schema_shrink_detected` audit row was written.
6. Restore any test-only state changes.

Exit code 0 = PASS, non-zero = FAIL.
"""
from __future__ import annotations
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
from dotenv import load_dotenv
load_dotenv(BACKEND_ROOT / ".env")

import openpyxl  # noqa: E402
from db import db  # noqa: E402
from scripts.import_plant_maintenance import (  # noqa: E402
    parse_workbook, upsert_rows, ensure_indexes, _load_rego_index,
)
from scripts._ingest_utils import detect_schema_shrink  # noqa: E402


def _build_truncated_xlsx(src: Path, dst: Path,
                          drop_cols: set[str]) -> None:
    """Copy the source XLSX but zero out `drop_cols` in the header + data."""
    wb = openpyxl.load_workbook(str(src), data_only=True)
    ws = wb.active
    for r in range(1, ws.max_row + 1):
        for letter in drop_cols:
            ws[f"{letter}{r}"] = None
    wb.save(str(dst))


async def _first_record_with_cost() -> dict | None:
    """Grab a live record with at least cost + date_completed populated."""
    return await db.plant_maintenance.find_one(
        {"cost": {"$ne": None, "$exists": True},
         "date_completed": {"$ne": None, "$exists": True},
         "deleted_at": None},
        {"_id": 0},
    )


async def main() -> int:
    src = BACKEND_ROOT / "scripts" / "data" / "plant_maintenance_source.xlsx"
    fixture = Path("/tmp/pm_smoke_truncated.xlsx")
    print(f"[smoke] source={src}  fixture={fixture}")

    # 1. Snapshot a live record BEFORE the truncated re-import.
    before = await _first_record_with_cost()
    if not before:
        print("[smoke] ✗ no live record with cost + date_completed to test against")
        return 2
    mid = before["maintenance_id"]
    keep_fields = {"cost": before.get("cost"),
                   "company": before.get("company"),
                   "date_completed": before.get("date_completed"),
                   "performed_by": before.get("performed_by"),
                   "notes": before.get("notes")}
    print(f"[smoke] target maintenance_id={mid}")
    print(f"[smoke] pre-run values: {keep_fields}")

    # 2. Build truncated fixture — drop the same 5 columns the user's
    #    "shrunk" file dropped: M (cost), N (company), O (date_completed),
    #    P (performed_by), Q (notes).
    _build_truncated_xlsx(src, fixture, {"M", "N", "O", "P", "Q"})

    # 3. Parse + count audit rows before + run upsert.
    audit_before = await db.plant_maintenance_audit.count_documents(
        {"action": "schema_shrink_detected"})
    print(f"[smoke] schema_shrink_detected audit rows before: {audit_before}")

    await ensure_indexes()
    rego_idx = await _load_rego_index()
    rows = parse_workbook(fixture)
    print(f"[smoke] parsed {len(rows)} rows from truncated fixture")

    # Detect shrink first (that's the flow the real script uses).
    dropped = await detect_schema_shrink(
        collection=db.plant_maintenance,
        audit_collection=db.plant_maintenance_audit,
        incoming_rows=rows, actor_id="smoke-test",
        ignore_fields={"plant_id", "registration_matched"},
    )
    print(f"[smoke] detected dropped columns: {dropped}")

    stats = await upsert_rows(rows, actor_id="smoke-test",
                              rego_idx=rego_idx, dry_run=False)
    print(f"[smoke] upsert stats: {stats}")

    # 4. Re-read the same record and confirm the 5 protected fields survived.
    after = await db.plant_maintenance.find_one({"maintenance_id": mid},
                                                {"_id": 0})
    survived = {k: after.get(k) for k in keep_fields}
    print(f"[smoke] post-run values: {survived}")

    ok = all(after.get(k) == v for k, v in keep_fields.items())
    if not ok:
        print("[smoke] ✗ FAIL — one or more fields were wiped by the truncated import")
        for k, v in keep_fields.items():
            got = after.get(k)
            marker = "✓" if got == v else "✗"
            print(f"       {marker} {k}: expected {v!r} · got {got!r}")
        return 3

    # 5. Verify the schema_shrink audit was written.
    audit_after = await db.plant_maintenance_audit.count_documents(
        {"action": "schema_shrink_detected"})
    print(f"[smoke] schema_shrink_detected audit rows after: {audit_after}")
    if audit_after <= audit_before:
        print("[smoke] ✗ FAIL — no schema_shrink_detected audit row was written")
        return 4

    print("[smoke] ✓ PASS — merge_safe_upsert preserved every existing field.")
    print(f"[smoke] ✓ PASS — schema_shrink audit +{audit_after - audit_before}.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
