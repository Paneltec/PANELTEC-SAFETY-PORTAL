"""v160.3.9.13 — Master Risks XLSX ingestion.

Reads `/app/backend/scripts/data/master_risks_source.xlsx`, parses each
data row into a `master_risks` document, preserves the source cell fill
colour (per-row severity indicator) and upserts by `risk_id`.

Idempotent:
    · Same `risk_id` + same content hash → skipped.
    · Same `risk_id` + differing content → updated in place; the delta is
      logged into `master_risks_audit`.
    · New `risk_id` → inserted.

Run:
    cd /app/backend && python -m scripts.import_master_risks

Optional args:
    --path /abs/path.xlsx     Override the source file location.
    --actor-id <uuid>         Attribution for `imported_by`; defaults to
                              the seeded admin user for stephen@paneltec.
    --dry-run                 Parse and diff, but write nothing.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
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

DEFAULT_PATH = BACKEND_ROOT / "scripts" / "data" / "master_risks_source.xlsx"

# Header row index (1-based) in the workbook — confirmed via inspection.
HEADER_ROW = 6

# Column letter → snake_case field name we persist.
# Header row (row 6) values:
#   A=Risk ID (numeric 1-168, one per row — the actual unique key)
#   B=Classification   C=Activity          D=Hazard aspect
#   E=Unwanted event   F=Risk score (U)    G=Mandatory controls
#   H=Other controls   I=Risk score (C)    J=Legal & other refs
#   K=SWMS reference
# `E-18` / `H-13` etc. live in F (uncontrolled) and I (controlled) — those
# are the coloured severity scores, NOT the row's identifier.
COLUMN_MAP = {
    "A": "risk_id",
    "B": "classification",
    "C": "activity",
    "D": "hazard_aspect",
    "E": "unwanted_event",
    "F": "risk_score_uncontrolled",
    "G": "mandatory_controls",
    "H": "other_controls",
    "I": "risk_score_controlled",
    "J": "legal_references",
    "K": "swms_reference",
}

# The severity code column (F) — values like `E-18`, `H-13`, `M-9`, `L-5`.
# The leading letter maps to a severity band.
SEVERITY_BY_PREFIX = {"E": "extreme", "H": "high", "M": "medium", "L": "low"}
SEVERITY_CODE_RE = re.compile(r"^\s*([EHMLehml])-(\d+)\s*$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        # Numeric cells (e.g., source_row) → string, no trailing .0.
        s = str(v)
        if s.endswith(".0"):
            s = s[:-2]
        return s
    return str(v).strip()


def _fill_hex(cell) -> str | None:
    """Return the cell's foreground fill as a plain hex string, or None.

    openpyxl surfaces XLSX fills as an 8-char ARGB string like ``FFFF0000``
    (opaque red). We drop the alpha byte and skip the two default fills
    that mean "no colour": ``FFFFFFFF`` (pure white) and ``00000000``
    (transparent).
    """
    try:
        rgb = cell.fill.fgColor.rgb
    except Exception:
        return None
    if not rgb or rgb in ("FFFFFFFF", "00000000"):
        return None
    if isinstance(rgb, str) and len(rgb) == 8:
        return "#" + rgb[2:].upper()
    if isinstance(rgb, str) and len(rgb) == 6:
        return "#" + rgb.upper()
    return None


def _extract_severity(score_val: str) -> str | None:
    """Severity band derived from the letter prefix of a Risk score cell."""
    if not score_val:
        return None
    m = SEVERITY_CODE_RE.match(score_val)
    if not m:
        return None
    return SEVERITY_BY_PREFIX.get(m.group(1).upper())


def _content_hash(doc: dict) -> str:
    """Stable hash of the persisted content (excludes bookkeeping fields)."""
    subset = {
        k: doc.get(k) for k in (
            "risk_id", "severity", "classification", "activity",
            "hazard_aspect", "unwanted_event", "risk_score_uncontrolled",
            "risk_score_controlled", "mandatory_controls", "other_controls",
            "legal_references", "swms_reference", "fill_hex",
            "fill_hex_controlled",
        )
    }
    canon = json.dumps(subset, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def parse_workbook(path: Path) -> list[dict]:
    """Parse the XLSX into a list of candidate documents."""
    wb = openpyxl.load_workbook(str(path), data_only=True)
    ws = wb.active
    rows: list[dict] = []

    for row in ws.iter_rows(min_row=HEADER_ROW + 1, max_row=ws.max_row,
                             values_only=False):
        cell_by_col = {c.column_letter: c for c in row}

        # A whole-blank row means we hit the end of the data island.
        if not any(_clean(c.value) for c in row):
            continue

        # Column A carries the row's unique numeric Risk ID.
        a_cell = cell_by_col.get("A")
        risk_id = _clean(a_cell.value) if a_cell else ""
        if not risk_id:
            continue

        # F is the uncontrolled severity code cell — drives severity + fill.
        f_cell = cell_by_col.get("F")
        i_cell = cell_by_col.get("I")
        f_val = _clean(f_cell.value) if f_cell else ""
        i_val = _clean(i_cell.value) if i_cell else ""

        doc = {
            "id": str(uuid.uuid4()),
            "risk_id": risk_id,
            "severity": _extract_severity(f_val),
            "fill_hex": _fill_hex(f_cell) if f_cell else None,
            "fill_hex_controlled": _fill_hex(i_cell) if i_cell else None,
            "risk_score_uncontrolled": f_val,
            "risk_score_controlled": i_val,
            "classification": _clean(cell_by_col.get("B").value) if cell_by_col.get("B") else "",
            "activity": _clean(cell_by_col.get("C").value) if cell_by_col.get("C") else "",
            "hazard_aspect": _clean(cell_by_col.get("D").value) if cell_by_col.get("D") else "",
            "unwanted_event": _clean(cell_by_col.get("E").value) if cell_by_col.get("E") else "",
            "mandatory_controls": _clean(cell_by_col.get("G").value) if cell_by_col.get("G") else "",
            "other_controls": _clean(cell_by_col.get("H").value) if cell_by_col.get("H") else "",
            "legal_references": _clean(cell_by_col.get("J").value) if cell_by_col.get("J") else "",
            "swms_reference": _clean(cell_by_col.get("K").value) if cell_by_col.get("K") else "",
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


async def upsert_master_risks(rows: list[dict], actor_id: str,
                              dry_run: bool = False) -> dict:
    """Idempotent upsert. Returns counters {inserted, updated, unchanged}."""
    inserted, updated, unchanged = 0, 0, 0
    changes: list[dict] = []
    now = _now_iso()

    for row in rows:
        row["content_hash"] = _content_hash(row)
        existing = await db.master_risks.find_one({"risk_id": row["risk_id"]},
                                                  {"_id": 0})
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
                await db.master_risks.replace_one(
                    {"risk_id": row["risk_id"]}, row, upsert=True)
                await db.master_risks_audit.insert_one({
                    "id": str(uuid.uuid4()),
                    "risk_id": row["risk_id"],
                    "action": "update",
                    "at": now,
                    "actor_id": actor_id,
                    "before_hash": existing.get("content_hash"),
                    "after_hash": row["content_hash"],
                })
            updated += 1
            changes.append({"risk_id": row["risk_id"], "action": "update"})
        else:
            row["created_at"] = now
            row["imported_by"] = actor_id
            row["imported_at"] = now
            if not dry_run:
                await db.master_risks.insert_one(row)
                await db.master_risks_audit.insert_one({
                    "id": str(uuid.uuid4()),
                    "risk_id": row["risk_id"],
                    "action": "insert",
                    "at": now,
                    "actor_id": actor_id,
                    "after_hash": row["content_hash"],
                })
            inserted += 1
            changes.append({"risk_id": row["risk_id"], "action": "insert"})

    return {"inserted": inserted, "updated": updated, "unchanged": unchanged,
            "changes": changes}


async def ensure_indexes() -> None:
    await db.master_risks.create_index("risk_id", unique=True)
    await db.master_risks.create_index("severity")
    await db.master_risks.create_index("classification")
    await db.master_risks.create_index([("activity", "text"),
                                         ("hazard_aspect", "text"),
                                         ("unwanted_event", "text"),
                                         ("mandatory_controls", "text"),
                                         ("other_controls", "text")])
    await db.master_risks_audit.create_index("risk_id")
    await db.master_risks_audit.create_index("at")


async def main(args) -> int:
    path = Path(args.path).resolve()
    if not path.exists():
        print(f"[import] source file missing: {path}", file=sys.stderr)
        return 2
    print(f"[import] source={path} ({path.stat().st_size} bytes)")

    print("[import] ensure indexes")
    await ensure_indexes()

    rows = parse_workbook(path)
    print(f"[import] parsed {len(rows)} rows from workbook")
    if not rows:
        print("[import] nothing to import — parser returned 0 rows")
        return 3

    # Distribution snapshot.
    from collections import Counter
    sev_dist = Counter(r["severity"] for r in rows)
    cls_dist = Counter(r["classification"] for r in rows)
    print(f"[import] severity distribution: {dict(sev_dist)}")
    print(f"[import] classification distribution (top 5): "
          f"{cls_dist.most_common(5)}")

    actor_id = await _resolve_actor_id(args.actor_id)
    print(f"[import] actor_id={actor_id}, dry_run={args.dry_run}")

    stats = await upsert_master_risks(rows, actor_id, dry_run=args.dry_run)
    print(f"[import] result → inserted={stats['inserted']}, "
          f"updated={stats['updated']}, unchanged={stats['unchanged']}")

    total_persisted = await db.master_risks.count_documents(
        {"deleted_at": None})
    print(f"[import] master_risks live rows after run: {total_persisted}")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--path", default=str(DEFAULT_PATH))
    p.add_argument("--actor-id")
    p.add_argument("--dry-run", action="store_true")
    sys.exit(asyncio.run(main(p.parse_args())))
