"""v160.3.9.16 — CS Incident (Issue List) XLSX ingestion."""
from __future__ import annotations
import argparse, asyncio, hashlib, json, re, sys, uuid
from datetime import datetime, timezone, date, time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
from dotenv import load_dotenv
load_dotenv(BACKEND_ROOT / ".env")

import openpyxl  # noqa: E402
from openpyxl.utils import get_column_letter  # noqa: E402
from db import db  # noqa: E402

DEFAULT_PATH = BACKEND_ROOT / "scripts" / "data" / "cs_incident_source.xlsx"

# XLSX column letter → canonical field name. Duplicate header names get
# `_2` / `_3` suffixes in insertion order so nothing gets clobbered.
COLUMN_MAP = {
    "A": "issue_number", "B": "issue_type", "C": "date_of_issue",
    "D": "business_unit", "E": "company", "F": "project_text",
    "G": "status", "H": "identified_by", "I": "entered_by",
    "J": "details_of_nonconformity", "K": "responsible_manager",
    "L": "closeout_manager", "M": "date_closed", "N": "description",
    "O": "department", "P": "location", "Q": "location_2",
    "R": "incident_categories", "S": "shift_length",
    "T": "hours_into_shift", "U": "injury_severity",
    "V": "hazard_description", "W": "injured_employee",
    "X": "injured_employee_free_text", "Y": "employment_status",
    "Z": "immediate_action", "AA": "was_first_aid_provided",
    "AB": "first_aid_description", "AC": "injury_nature",
    "AD": "injury_agency", "AE": "injury_mechanism",
    "AF": "environment_report_description", "AG": "near_miss_description",
    "AH": "theft_description", "AI": "plant_description",
    "AJ": "security_description", "AK": "property_description",
    "AL": "process_description", "AM": "drug_alcohol_info",
    "AN": "other_description", "AO": "actual_incident_category",
    "AP": "potential_incident_category", "AQ": "alert_generated",
    "AR": "date_preapproved", "AS": "date_reviewed",
    "AT": "source_of_nonconformity", "AU": "immediate_action_2",
    "AV": "is_injury_near_miss", "AW": "is_environmental_near_miss",
    "AX": "is_plant_near_miss", "AY": "is_other_near_miss",
    "AZ": "work_activity_performed", "BA": "sources_of_hazard",
    "BB": "primary_hazard", "BC": "erosion_and_sediment",
    "BD": "erosion_release_source", "BE": "type_erosion",
    "BF": "receiving_environment_erosion", "BG": "hazard_report_type",
    "BH": "land_contamination", "BI": "contaminant_type",
    "BJ": "contaminant_name", "BK": "contaminant_volume_released",
    "BL": "spill_area_impacted", "BM": "spill_recovered",
    "BN": "spill_volume_recovered", "BO": "contaminated_material_remediated",
    "BP": "disposal_method", "BQ": "water_contamination_discharge",
    "BR": "contaminant_type_2", "BS": "contaminant_name_2",
    "BT": "volume_released", "BU": "area_impacted",
    "BV": "recovered", "BW": "contaminant_remediated",
    "BX": "disposal_method_2", "BY": "flora_affected",
    "BZ": "fauna_affected", "CA": "solid_or_other_waste_effects",
    "CB": "waste_type", "CC": "estimated_volume_l",
    "CD": "disposal_method_3", "CE": "archaeological_or_cultural",
    "CF": "indigenous", "CG": "site_name", "CH": "known_site",
    "CI": "date_of_entry", "CJ": "time_of_issue",
    "CK": "date_reported", "CL": "identified_hazards",
    "CM": "employee_reporting", "CN": "supervisor",
    "CO": "immediate_action_3",
}

BOOL_FIELDS = {
    "was_first_aid_provided", "alert_generated",
    "is_injury_near_miss", "is_environmental_near_miss",
    "is_plant_near_miss", "is_other_near_miss",
    "erosion_and_sediment", "land_contamination", "spill_recovered",
    "contaminated_material_remediated", "water_contamination_discharge",
    "recovered", "contaminant_remediated", "flora_affected",
    "fauna_affected", "solid_or_other_waste_effects",
    "archaeological_or_cultural", "indigenous", "known_site",
}
NUMBER_FIELDS = {"issue_number", "shift_length", "hours_into_shift"}
# Datetime columns whose XLSX cells may already be datetime objects.
DATE_FIELDS = {"date_of_issue", "date_closed", "date_of_entry",
               "date_reported", "date_preapproved", "date_reviewed"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        s = str(v)
        return s[:-2] if s.endswith(".0") else s
    return str(v).strip()


def _bool_or_none(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    s = str(v).strip().lower()
    if s in {"yes", "y", "true", "t", "1", "✓", "✔"}:
        return True
    if s in {"no", "n", "false", "f", "0"}:
        return False
    return None


def _num_or_none(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, (int, float)):
        return v
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return None


def _date_or_none(v):
    """Return ISO 8601 string for a date/datetime cell; None otherwise."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    # Try to parse common string forms encountered in the workbook.
    s = str(v).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d",
                "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).isoformat()
        except ValueError:
            continue
    return s  # keep the original string so the UI can still show something


def _detect_header_row(ws) -> int:
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 30),
                             values_only=False):
        v = _clean(row[0].value).lower()
        if v == "issue number":
            return row[0].row
    return 4


def _content_hash(doc: dict) -> str:
    subset = {k: v for k, v in doc.items()
              if k not in {"id", "created_at", "updated_at",
                           "imported_at", "imported_by", "content_hash",
                           "deleted_at"}}
    return hashlib.sha256(
        json.dumps(subset, sort_keys=True, ensure_ascii=False, default=str)
        .encode()).hexdigest()


def parse_workbook(path: Path) -> tuple[list[dict], set[str]]:
    """Return (rows, populated_field_names)."""
    wb = openpyxl.load_workbook(str(path), data_only=True)
    ws = wb.active
    header_row = _detect_header_row(ws)
    rows: list[dict] = []
    populated: set[str] = set()
    for row in ws.iter_rows(min_row=header_row + 1, max_row=ws.max_row,
                             values_only=False):
        cell_by = {c.column_letter: c for c in row}
        a = _clean(cell_by.get("A").value) if cell_by.get("A") else ""
        if not a:
            continue

        doc: dict = {
            "id": str(uuid.uuid4()),
            "deleted_at": None,
        }
        for letter, field in COLUMN_MAP.items():
            cell = cell_by.get(letter)
            if not cell or cell.value in (None, ""):
                continue
            raw = cell.value
            if field in BOOL_FIELDS:
                b = _bool_or_none(raw)
                if b is None:
                    continue
                doc[field] = b
            elif field in DATE_FIELDS:
                d = _date_or_none(raw)
                if d:
                    doc[field] = d
            elif field in NUMBER_FIELDS:
                n = _num_or_none(raw)
                if n is not None:
                    doc[field] = n
            else:
                s = _clean(raw)
                if s:
                    doc[field] = s
            if field in doc:
                populated.add(field)
        rows.append(doc)
    return rows, populated


async def _resolve_actor_id(explicit):
    if explicit:
        return explicit
    u = await db.users.find_one({"email": "stephen@paneltec.com.au"},
                                 {"_id": 0, "id": 1})
    return u["id"] if u else "system"


async def ensure_indexes() -> None:
    await db.cs_incident_issues.create_index("issue_number", unique=True)
    await db.cs_incident_issues.create_index("date_of_issue")
    await db.cs_incident_issues.create_index("business_unit")
    await db.cs_incident_issues.create_index("status")
    await db.cs_incident_issues_audit.create_index("issue_number")


from _ingest_utils import merge_safe_upsert, detect_schema_shrink  # noqa: E402


async def upsert_rows(rows, actor_id, dry_run=False):
    inserted = updated = unchanged = 0
    for row in rows:
        row["content_hash"] = _content_hash(row)
        existing = await db.cs_incident_issues.find_one(
            {"issue_number": row["issue_number"]}, {"_id": 0})
        if dry_run:
            if existing and existing.get("content_hash") == row["content_hash"]:
                unchanged += 1
            elif existing:
                updated += 1
            else:
                inserted += 1
            continue
        # Merge-safe: incoming empties never wipe existing fields (v160.3.9.21b)
        outcome = await merge_safe_upsert(
            collection=db.cs_incident_issues,
            audit_collection=db.cs_incident_issues_audit,
            key_field="issue_number",
            incoming=row, existing=existing,
            actor_id=actor_id, content_hash=row["content_hash"],
        )
        if outcome == "inserted": inserted += 1
        elif outcome == "updated": updated += 1
        else: unchanged += 1
    return {"inserted": inserted, "updated": updated, "unchanged": unchanged}


async def main(args) -> int:
    path = Path(args.path).resolve()
    if not path.exists():
        print(f"[import] missing: {path}", file=sys.stderr); return 2
    print(f"[import] source={path} ({path.stat().st_size} bytes)")
    await ensure_indexes()
    rows, populated = parse_workbook(path)
    print(f"[import] parsed {len(rows)} rows; {len(populated)} populated columns")
    if not rows:
        return 3
    actor = await _resolve_actor_id(args.actor_id)
    dropped = await detect_schema_shrink(
        collection=db.cs_incident_issues,
        audit_collection=db.cs_incident_issues_audit,
        incoming_rows=rows, actor_id=actor)
    if dropped:
        print(f"[import] ⚠ schema shrink — {len(dropped)} column(s) missing: {dropped}")
        print("[import] existing values will be PRESERVED (merge-safe upsert).")
    stats = await upsert_rows(rows, actor, dry_run=args.dry_run)
    print(f"[import] inserted={stats['inserted']} updated={stats['updated']} "
          f"unchanged={stats['unchanged']}")
    total = await db.cs_incident_issues.count_documents({"deleted_at": None})
    print(f"[import] live rows: {total}")
    print(f"[import] populated fields (first 30): "
          f"{sorted(populated)[:30]}")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--path", default=str(DEFAULT_PATH))
    p.add_argument("--actor-id")
    p.add_argument("--dry-run", action="store_true")
    sys.exit(asyncio.run(main(p.parse_args())))
