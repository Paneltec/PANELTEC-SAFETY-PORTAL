"""v160.3.9.21 — HR Employees (Active + Archived) XLSX ingestion.

Hardening applied per approved Step-2 rules:
  - Skip any header cell that is null / empty / all-whitespace, so the
    trailing AR blank column (and future rogue columns) never becomes
    a real field. Uses `[c for c in headers if c and c.strip()]`.
  - Parse `-[ARCHIVED]:{uuid}` sentinel out of the Payroll number column.
    Real payroll_number becomes null; the uuid is stored in
    `archived_uuid` metadata for reference.
  - Detect a leaked plaintext password in the Notes column (case-insensitive
    substring match on "password is"). The raw notes value is REDACTED
    out of the stored document, `security_flag` is set to
    `leaked_password_in_notes`, and a `security_flag_detected` audit row
    is emitted at ingest time so we have a permanent record of when
    and where the leak was found.
  - Sparse: empty cells are omitted (dropped rather than stored as "").

Runs as a script (`python scripts/import_hr_employees.py`) OR is imported
by the `/api/hr/employees/reimport` endpoint.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
from dotenv import load_dotenv
load_dotenv(BACKEND_ROOT / ".env")

import openpyxl  # noqa: E402
from db import db  # noqa: E402

DEFAULT_PATH = BACKEND_ROOT / "scripts" / "data" / "hr_employees_source.xlsx"
SOURCE_URL = (
    "https://customer-assets-wrfwihn1.emergentagent.net/job_safety-pic-analyzer/"
    "artifacts/2yni9nok_6a686676a577e-spreadsheet.xlsx"
)

# Canonical XLSX header → Mongo field. Headers not in this map are
# preserved but slugified (defensive — future spreadsheets may add cols).
HEADER_MAP = {
    "employee id":                     "employee_id",
    "first name":                      "first_name",
    "last name":                       "last_name",
    "middle name":                     "middle_name",
    "business unit":                   "business_unit",
    "email":                           "email",
    "username":                        "username",
    "date of birth":                   "date_of_birth",
    "date employee added":             "date_employee_added",
    "payroll number":                  "payroll_number",
    "phone number":                    "phone_number",
    "mobile number":                   "mobile_number",
    "fax number":                      "fax_number",
    "address line 1":                  "address_line_1",
    "address line 2":                  "address_line_2",
    "suburb":                          "suburb",
    "postcode":                        "postcode",
    "state":                           "state",
    "country":                         "country",
    "employment status":               "employment_status",
    "agreement":                       "agreement",
    "rate due date":                   "rate_due_date",
    "rate type":                       "rate_type",
    "manager":                         "manager",
    "category":                        "category",
    "bonus type":                      "bonus_type",
    "bonus due date":                  "bonus_due_date",
    "allowance":                       "allowance",
    "allowance amount":                "allowance_amount",
    "allowance expiry date":           "allowance_expiry_date",
    "vehicle type":                    "vehicle_type",
    "terminated employee":             "terminated_employee",
    "do not rehire":                   "do_not_rehire",
    "indigenous":                      "indigenous",
    "working visa":                    "working_visa",
    "gender":                          "gender",
    "notes":                           "notes",
    "next of kin first name":          "next_of_kin_first_name",
    "next of kin last name":           "next_of_kin_last_name",
    "next of kin relationship":        "next_of_kin_relationship",
    "next of kin phone number":        "next_of_kin_phone_number",
    "next of kin secondary phone number": "next_of_kin_secondary_phone_number",
    "archived":                        "archived",
}

DATE_FIELDS = {
    "date_of_birth", "date_employee_added", "rate_due_date",
    "bonus_due_date", "allowance_expiry_date",
}

# `-[ARCHIVED]:{uuid}` sentinel — Simpro's convention for retired staff.
_ARCHIVED_UUID_RE = re.compile(r"-\[ARCHIVED\]:([0-9a-fA-F-]{20,40})", re.I)
_LEAKED_PWD_RE = re.compile(r"password\s+(is|:)", re.I)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(header: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (header or "").strip().lower())
    return s.strip("_") or "unknown"


def _ensure_source_downloaded(path: Path) -> None:
    if path.exists() and path.stat().st_size > 0:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    import urllib.request
    print(f"[import-hr] fetching source → {path}")
    req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "paneltec-import/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        path.write_bytes(resp.read())
    print(f"[import-hr] downloaded {path.stat().st_size} bytes")


def _clean(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        s = str(v)
        return s[:-2] if s.endswith(".0") else s
    return str(v).strip()


def _parse_date(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d", "%d/%m/%y"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.date().isoformat() if fmt in ("%d/%m/%Y", "%Y-%m-%d",
                                                     "%d/%m/%y") else dt.isoformat()
        except ValueError:
            continue
    return s


def _detect_header_row(ws) -> int:
    for row in ws.iter_rows(min_row=1, max_row=15, values_only=False):
        first = _clean(row[0].value).lower()
        non_empty = sum(1 for c in row if _clean(c.value))
        if first == "employee id" and non_empty >= 8:
            return row[0].row
    return 6  # fall back to the known layout


def _content_hash(doc: dict) -> str:
    keep = {k: doc.get(k) for k in ("employee_id", "first_name", "last_name",
                                     "email", "username", "business_unit",
                                     "archived", "manager", "content_flag",
                                     "security_flag")}
    return hashlib.sha256(json.dumps(keep, sort_keys=True,
                                     ensure_ascii=False,
                                     default=str).encode()).hexdigest()


def parse_workbook(path: Path) -> tuple[list[dict], list[dict]]:
    """Return (rows, security_flag_notes).
    `security_flag_notes` carries per-employee flags for the ingest audit.
    """
    wb = openpyxl.load_workbook(str(path), data_only=True)
    ws = wb.active
    hdr = _detect_header_row(ws)

    # Build column-letter → mongo-field map from the header row, silently
    # dropping empty header cells (kills the trailing AR blank).
    header_row = next(ws.iter_rows(min_row=hdr, max_row=hdr, values_only=False))
    cols: dict[str, str] = {}
    for cell in header_row:
        h = _clean(cell.value)
        if not h or not h.strip():
            continue  # user's extra rule — skip null/empty header cells.
        key = HEADER_MAP.get(h.lower(), _slugify(h))
        cols[cell.column_letter] = key

    rows: list[dict] = []
    security_flags: list[dict] = []

    for row in ws.iter_rows(min_row=hdr + 1, max_row=ws.max_row, values_only=False):
        by_letter = {c.column_letter: c for c in row}
        eid_cell = by_letter.get(next(iter(cols.keys())))
        # Blank rows: no employee_id at all → skip.
        if not eid_cell or not _clean(eid_cell.value):
            continue

        doc: dict = {
            "id": str(uuid.uuid4()),
            "deleted_at": None,
        }
        raw_notes = None
        raw_payroll = None
        for letter, field in cols.items():
            cell = by_letter.get(letter)
            if not cell or cell.value in (None, ""):
                continue
            if field in DATE_FIELDS:
                iso = _parse_date(cell.value)
                if iso:
                    doc[field] = iso
                continue
            s = _clean(cell.value)
            if not s:
                continue
            if field == "payroll_number":
                raw_payroll = s
                continue  # dealt with below
            if field == "notes":
                raw_notes = s
                continue  # dealt with below
            doc[field] = s

        # Payroll sentinel — `-[ARCHIVED]:{uuid}` means "archived, no payroll".
        if raw_payroll:
            m = _ARCHIVED_UUID_RE.search(raw_payroll)
            if m:
                doc["archived_uuid"] = m.group(1)
                # Keep only the human-readable prefix if any survived; else null.
                cleaned = _ARCHIVED_UUID_RE.sub("", raw_payroll).strip(" -")
                if cleaned:
                    doc["payroll_number"] = cleaned
            else:
                doc["payroll_number"] = raw_payroll

        # Notes leaked-password detection.
        if raw_notes:
            if _LEAKED_PWD_RE.search(raw_notes):
                doc["security_flag"] = "leaked_password_in_notes"
                doc["notes"] = "[REDACTED — security flag: possible plaintext password in Notes]"
                security_flags.append({
                    "employee_id": doc.get("employee_id"),
                    "flag": "leaked_password_in_notes",
                    "sample": raw_notes[:120],
                })
            else:
                doc["notes"] = raw_notes

        rows.append(doc)

    return rows, security_flags


async def ensure_indexes():
    await db.hr_employees.create_index("employee_id", unique=True)
    await db.hr_employees.create_index("last_name")
    await db.hr_employees.create_index("business_unit")
    await db.hr_employees.create_index("archived")
    await db.hr_employees_audit.create_index("employee_id")
    await db.hr_employees_audit.create_index("actor_id")
    await db.hr_employees_audit.create_index("at")


from _ingest_utils import merge_safe_upsert, detect_schema_shrink  # noqa: E402


async def upsert_rows(rows: list[dict], actor_id: str,
                       security_flags: list[dict]) -> dict:
    inserted = updated = unchanged = 0
    now = _now()
    for row in rows:
        row["content_hash"] = _content_hash(row)
        eid = row.get("employee_id")
        if not eid:
            continue
        existing = await db.hr_employees.find_one({"employee_id": eid}, {"_id": 0})
        # Merge-safe: incoming empties never wipe existing fields (v160.3.9.21b)
        outcome = await merge_safe_upsert(
            collection=db.hr_employees,
            audit_collection=db.hr_employees_audit,
            key_field="employee_id",
            incoming=row, existing=existing,
            actor_id=actor_id, content_hash=row["content_hash"],
        )
        if outcome == "inserted": inserted += 1
        elif outcome == "updated": updated += 1
        else: unchanged += 1

    # Emit one `security_flag_detected` audit row per finding so the
    # trail is permanent regardless of what the UI displays later.
    for f in security_flags:
        await db.hr_employees_audit.insert_one({
            "id": str(uuid.uuid4()),
            "employee_id": f.get("employee_id"),
            "action": "security_flag_detected",
            "at": now, "actor_id": actor_id,
            "extra": {"flag": f["flag"], "sample": f["sample"]},
        })

    return {"inserted": inserted, "updated": updated, "unchanged": unchanged,
            "security_flags": len(security_flags)}


async def _resolve_actor_id(explicit):
    if explicit:
        return explicit
    u = await db.users.find_one({"email": "stephen@paneltec.com.au"},
                                 {"_id": 0, "id": 1})
    return u["id"] if u else "system"


async def main(args):
    path = Path(args.path).resolve()
    _ensure_source_downloaded(path)
    if not path.exists():
        print(f"[import-hr] missing: {path}")
        return 2
    print(f"[import-hr] source={path} ({path.stat().st_size} bytes)")
    await ensure_indexes()
    rows, security_flags = parse_workbook(path)
    print(f"[import-hr] {len(rows)} rows parsed")
    if security_flags:
        print(f"[import-hr] ⚠ {len(security_flags)} security flag(s) detected:")
        for f in security_flags:
            print(f"  employee_id={f['employee_id']} flag={f['flag']} "
                  f"sample={f['sample'][:80]!r}")
    actor = await _resolve_actor_id(args.actor_id)
    dropped = await detect_schema_shrink(
        collection=db.hr_employees, audit_collection=db.hr_employees_audit,
        incoming_rows=rows, actor_id=actor,
        ignore_fields={"security_flag", "archived_uuid"})
    if dropped:
        print(f"[import-hr] ⚠ schema shrink — {len(dropped)} column(s) missing: {dropped}")
        print("[import-hr] existing values will be PRESERVED (merge-safe upsert).")
    stats = await upsert_rows(rows, actor, security_flags)
    print(f"[import-hr] inserted={stats['inserted']} updated={stats['updated']} "
          f"unchanged={stats['unchanged']} security_flags={stats['security_flags']}")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--path", default=str(DEFAULT_PATH))
    p.add_argument("--actor-id")
    sys.exit(asyncio.run(main(p.parse_args())))
