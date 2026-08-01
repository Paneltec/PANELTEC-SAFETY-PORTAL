"""v160.3.9.14 — List Forms XLSX ingestion.

Mirrors `scripts/import_master_risks.py`. Reads
`/app/backend/scripts/data/list_forms_source.xlsx`, parses each data row
into a `list_forms` document and upserts by `list_form_id`.

Header row is auto-detected — the source workbook has a title band and a
"Filters applied:" region above the data, so we scan for the row whose
first cell literally equals "Id".

Run:
    cd /app/backend && python -m scripts.import_list_forms
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv
load_dotenv(BACKEND_ROOT / ".env")

import openpyxl  # noqa: E402

from db import db  # noqa: E402

DEFAULT_PATH = BACKEND_ROOT / "scripts" / "data" / "list_forms_source.xlsx"

# Column letter → snake_case field.
COLUMN_MAP = {
    "A": "list_form_id",
    "B": "name",
    "C": "description",
    "D": "form_group_raw",
    "E": "public_enabled_raw",
    "F": "mobile_enabled_raw",
    "G": "asset_enabled_raw",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        s = str(v)
        return s[:-2] if s.endswith(".0") else s
    return str(v).strip()


def _yes_no(v) -> bool:
    return _clean(v).strip().lower() == "yes"


def _parse_group(raw: str) -> list[str]:
    if not raw:
        return []
    # The source uses commas with optional spaces; canonicalise to the
    # exact two known values (case-insensitive) so filters stay clean.
    known = {"operations": "Operations", "administration": "Administration"}
    out: list[str] = []
    for chunk in re.split(r"[,;/]", raw):
        c = chunk.strip().lower()
        if not c:
            continue
        out.append(known.get(c, chunk.strip()))
    # De-dupe while preserving order.
    seen: set[str] = set()
    return [x for x in out if not (x in seen or seen.add(x))]


def _detect_header_row(ws) -> int:
    """Return the 1-based row index whose first cell is "Id"."""
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 30),
                             values_only=False):
        v = _clean(row[0].value)
        if v.lower() == "id":
            return row[0].row
    return 1  # fall back — caller is expected to sanity-check its output


def _content_hash(doc: dict) -> str:
    subset = {k: doc.get(k) for k in (
        "list_form_id", "name", "description", "form_group",
        "public_enabled", "mobile_enabled", "asset_enabled",
    )}
    return hashlib.sha256(
        json.dumps(subset, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def parse_workbook(path: Path) -> list[dict]:
    wb = openpyxl.load_workbook(str(path), data_only=True)
    ws = wb.active
    header_row = _detect_header_row(ws)
    rows: list[dict] = []
    for row in ws.iter_rows(min_row=header_row + 1, max_row=ws.max_row,
                             values_only=False):
        cell = {c.column_letter: c for c in row}
        list_form_id = _clean(cell.get("A").value) if cell.get("A") else ""
        if not list_form_id:
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "list_form_id": list_form_id,
            "name": _clean(cell.get("B").value) if cell.get("B") else "",
            "description": _clean(cell.get("C").value) if cell.get("C") else "",
            "form_group": _parse_group(
                _clean(cell.get("D").value) if cell.get("D") else ""),
            "public_enabled": _yes_no(cell.get("E").value) if cell.get("E") else False,
            "mobile_enabled": _yes_no(cell.get("F").value) if cell.get("F") else False,
            "asset_enabled": _yes_no(cell.get("G").value) if cell.get("G") else False,
            "deleted_at": None,
        }
        rows.append(doc)
    return rows


async def _resolve_actor_id(explicit: str | None) -> str:
    if explicit:
        return explicit
    u = await db.users.find_one({"email": "stephen@paneltec.com.au"},
                                 {"_id": 0, "id": 1})
    return u["id"] if u else "system"


async def ensure_indexes() -> None:
    await db.list_forms.create_index("list_form_id", unique=True)
    await db.list_forms.create_index("form_group")
    await db.list_forms.create_index("name")
    await db.list_forms_audit.create_index("list_form_id")
    await db.list_forms_audit.create_index("at")


async def upsert_list_forms(rows: list[dict], actor_id: str,
                             dry_run: bool = False) -> dict:
    inserted, updated, unchanged = 0, 0, 0
    now = _now_iso()
    for row in rows:
        row["content_hash"] = _content_hash(row)
        existing = await db.list_forms.find_one(
            {"list_form_id": row["list_form_id"]}, {"_id": 0})
        if existing and existing.get("content_hash") == row["content_hash"]:
            unchanged += 1
            continue
        if existing:
            row["id"] = existing["id"]
            row["created_at"] = existing.get("created_at", now)
            row["imported_by"] = actor_id
            row["imported_at"] = now
            row["updated_at"] = now
            if not dry_run:
                await db.list_forms.replace_one(
                    {"list_form_id": row["list_form_id"]}, row, upsert=True)
                await db.list_forms_audit.insert_one({
                    "id": str(uuid.uuid4()),
                    "list_form_id": row["list_form_id"],
                    "action": "update", "at": now, "actor_id": actor_id,
                    "before_hash": existing.get("content_hash"),
                    "after_hash": row["content_hash"],
                })
            updated += 1
        else:
            row["created_at"] = now
            row["imported_by"] = actor_id
            row["imported_at"] = now
            if not dry_run:
                await db.list_forms.insert_one(row)
                await db.list_forms_audit.insert_one({
                    "id": str(uuid.uuid4()),
                    "list_form_id": row["list_form_id"],
                    "action": "insert", "at": now, "actor_id": actor_id,
                    "after_hash": row["content_hash"],
                })
            inserted += 1
    return {"inserted": inserted, "updated": updated, "unchanged": unchanged}


async def main(args) -> int:
    path = Path(args.path).resolve()
    if not path.exists():
        print(f"[import] source file missing: {path}", file=sys.stderr)
        return 2
    print(f"[import] source={path} ({path.stat().st_size} bytes)")
    await ensure_indexes()
    rows = parse_workbook(path)
    print(f"[import] parsed {len(rows)} rows")
    if not rows:
        print("[import] nothing to import")
        return 3

    from collections import Counter
    group_dist = Counter()
    for r in rows:
        for g in r["form_group"]:
            group_dist[g] += 1
    pub_yes = sum(1 for r in rows if r["public_enabled"])
    mob_yes = sum(1 for r in rows if r["mobile_enabled"])
    ast_yes = sum(1 for r in rows if r["asset_enabled"])
    print(f"[import] form_group distribution: {dict(group_dist)}")
    print(f"[import] enabled counts — public={pub_yes}/{len(rows)}, "
          f"mobile={mob_yes}/{len(rows)}, asset={ast_yes}/{len(rows)}")

    actor_id = await _resolve_actor_id(args.actor_id)
    stats = await upsert_list_forms(rows, actor_id, dry_run=args.dry_run)
    print(f"[import] result → inserted={stats['inserted']}, "
          f"updated={stats['updated']}, unchanged={stats['unchanged']}")
    total = await db.list_forms.count_documents({"deleted_at": None})
    print(f"[import] list_forms live rows after run: {total}")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--path", default=str(DEFAULT_PATH))
    p.add_argument("--actor-id")
    p.add_argument("--dry-run", action="store_true")
    sys.exit(asyncio.run(main(p.parse_args())))
