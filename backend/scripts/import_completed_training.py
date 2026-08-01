"""v160.3.9.18 — My Completed Training XLSX ingestion.

Empty columns are omitted from persisted docs (sparse schema, CS-Incident
pattern). Dates parsed defensively from `dd/mm/yyyy`, `dd/mm/yyyy HH:MM:SS`
or ISO; stored as ISO strings.
"""
from __future__ import annotations
import argparse, asyncio, hashlib, json, sys, uuid
from datetime import datetime, timezone, date
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
from dotenv import load_dotenv
load_dotenv(BACKEND_ROOT / ".env")

import openpyxl  # noqa: E402
from db import db  # noqa: E402

DEFAULT_PATH = BACKEND_ROOT / "scripts" / "data" / "completed_training_source.xlsx"

COLUMN_MAP = {
    "A": "competency", "B": "issue_date", "C": "expiry_date",
    "D": "business_unit", "E": "created_by", "F": "licence_number",
    "G": "card_number", "H": "certificate_number", "I": "issuer",
    "J": "notes", "K": "date_entered", "L": "description",
}
DATE_FIELDS = {"issue_date", "expiry_date"}
DATETIME_FIELDS = {"date_entered"}


def _now(): return datetime.now(timezone.utc).isoformat()


def _clean(v) -> str:
    if v is None: return ""
    if isinstance(v, (int, float)):
        s = str(v)
        return s[:-2] if s.endswith(".0") else s
    return str(v).strip()


def _parse_date(v):
    """Return ISO string (`YYYY-MM-DD` for dates, ISO 8601 for datetimes).

    Defensive parser: accepts datetime/date objects, `dd/mm/yyyy`,
    `dd/mm/yyyy HH:MM:SS`, `d/m/yyyy` variants, and already-ISO strings.
    Returns None when unparseable.
    """
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d",
                "%d-%m-%Y %H:%M:%S", "%d-%m-%Y"):
        try:
            dt = datetime.strptime(s, fmt)
            # Bare date formats → yyyy-mm-dd; anything with time → full ISO.
            if fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
                return dt.date().isoformat()
            return dt.isoformat()
        except ValueError:
            continue
    return None


def _detect_header_row(ws) -> int:
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 30),
                             values_only=False):
        # Anchor on "Company category" — wait, this is completed training,
        # anchor on "Competency" instead. But header col A is "Competency"
        # AND cell values later contain "Competency" too? No — data rows
        # have values like "CPR", "First Aid" etc. Safe to anchor on A.
        if _clean(row[0].value).lower() == "competency":
            return row[0].row
    return 6


def _content_hash(doc: dict) -> str:
    # Dedup key per user decision: composite across a stable subset.
    subset = {k: doc.get(k, "") for k in (
        "competency", "issue_date", "expiry_date",
        "certificate_number", "description",
    )}
    return hashlib.sha256(
        json.dumps(subset, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def parse_workbook(path: Path) -> tuple[list[dict], set[str]]:
    wb = openpyxl.load_workbook(str(path), data_only=True)
    ws = wb.active
    header_row = _detect_header_row(ws)
    rows: list[dict] = []
    populated: set[str] = set()
    for row in ws.iter_rows(min_row=header_row + 1, max_row=ws.max_row,
                             values_only=False):
        cell = {c.column_letter: c for c in row}
        # A row is "real" if Competency (col A) is non-empty.
        comp = _clean(cell.get("A").value) if cell.get("A") else ""
        if not comp:
            continue
        doc: dict = {"id": str(uuid.uuid4()), "deleted_at": None}
        for letter, field in COLUMN_MAP.items():
            c = cell.get(letter)
            if not c or c.value in (None, ""):
                continue
            if field in DATE_FIELDS or field in DATETIME_FIELDS:
                iso = _parse_date(c.value)
                if iso:
                    doc[field] = iso
                    populated.add(field)
            else:
                s = _clean(c.value)
                if s:
                    doc[field] = s
                    populated.add(field)
        rows.append(doc)
    return rows, populated


async def _resolve_actor_id(explicit):
    if explicit: return explicit
    u = await db.users.find_one({"email": "stephen@paneltec.com.au"},
                                 {"_id": 0, "id": 1})
    return u["id"] if u else "system"


async def ensure_indexes():
    await db.completed_training.create_index("content_hash", unique=True)
    await db.completed_training.create_index("expiry_date")
    await db.completed_training.create_index("business_unit")
    await db.completed_training.create_index("issuer")
    await db.completed_training_audit.create_index("id")


async def upsert_rows(rows, actor_id, dry_run=False):
    inserted = updated = unchanged = 0
    now = _now()
    for row in rows:
        row["content_hash"] = _content_hash(row)
        existing = await db.completed_training.find_one(
            {"content_hash": row["content_hash"]}, {"_id": 0})
        if existing:
            unchanged += 1
            continue
        row["created_at"] = now
        row["imported_by"] = actor_id
        row["imported_at"] = now
        if not dry_run:
            await db.completed_training.insert_one(row)
            await db.completed_training_audit.insert_one({
                "id": str(uuid.uuid4()),
                "content_hash": row["content_hash"],
                "action": "insert", "at": now, "actor_id": actor_id,
            })
        inserted += 1
    return {"inserted": inserted, "updated": updated, "unchanged": unchanged}


async def main(args) -> int:
    path = Path(args.path).resolve()
    if not path.exists():
        print(f"[import] missing: {path}", file=sys.stderr); return 2
    print(f"[import] source={path} ({path.stat().st_size} bytes)")
    await ensure_indexes()
    rows, populated = parse_workbook(path)
    print(f"[import] parsed {len(rows)} rows; {len(populated)} populated columns")
    if not rows: return 3
    actor = await _resolve_actor_id(args.actor_id)
    stats = await upsert_rows(rows, actor, dry_run=args.dry_run)
    print(f"[import] inserted={stats['inserted']} unchanged={stats['unchanged']}")
    total = await db.completed_training.count_documents({"deleted_at": None})
    print(f"[import] live rows: {total}")
    print(f"[import] populated fields: {sorted(populated)}")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--path", default=str(DEFAULT_PATH))
    p.add_argument("--actor-id")
    p.add_argument("--dry-run", action="store_true")
    sys.exit(asyncio.run(main(p.parse_args())))
