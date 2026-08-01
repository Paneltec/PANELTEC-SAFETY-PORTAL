"""v160.3.9.21 Step 1 — Inspect the Employees XLSX (Active + Archived).
Reports headers, row count, populated/distinct counts per column, PII
classification, and cell-fill notes. Does NOT touch MongoDB."""
from __future__ import annotations
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

import openpyxl  # noqa: E402

SOURCE = BACKEND_ROOT / "scripts" / "data" / "hr_employees_source.xlsx"

# PII classification for the report — will be enforced at API level in Step 2.
PII_FIELDS_HINT = {
    "dob", "date of birth", "birthdate", "d.o.b",
    "phone", "mobile", "telephone", "home phone",
    "address", "street", "city", "postcode", "state",
    "next of kin", "kin", "emergency contact",
    "gender", "sex",
    "indigenous", "aboriginal", "torres strait",
    "terminated", "do not rehire",
    "visa", "passport", "working visa",
    "email", "personal email",
    "payroll number", "tfn", "super",
    "username", "password",
    "rate", "salary", "hourly", "wage",
}


def _norm(v) -> str:
    if v is None: return ""
    s = str(v).strip()
    return s


def _classify_pii(header: str) -> str:
    h = header.lower()
    for hint in PII_FIELDS_HINT:
        if hint in h:
            return "PII"
    return ""


def inspect():
    if not SOURCE.exists():
        print(f"[inspect] source missing: {SOURCE}")
        return 2

    wb = openpyxl.load_workbook(str(SOURCE), data_only=True)
    print(f"[inspect] source={SOURCE} ({SOURCE.stat().st_size} bytes)")
    print(f"[inspect] sheet names: {wb.sheetnames}")

    for sn in wb.sheetnames:
        ws = wb[sn]
        print(f"\n===== SHEET: {sn!r} · max_row={ws.max_row} · max_col={ws.max_column} =====")

        # Auto-detect header row: first row where >=8 non-empty cells and cell A looks like an id/first-name column
        header_row = None
        for row in ws.iter_rows(min_row=1, max_row=min(15, ws.max_row), values_only=False):
            non_empty = sum(1 for c in row if _norm(c.value))
            first = _norm(row[0].value).lower()
            if non_empty >= 8 and first in {"id", "employee id", "employee no", "employee number",
                                             "first name", "firstname", "employeeid"}:
                header_row = row[0].row
                break
        if header_row is None:
            # fallback: first row with >=15 non-empty
            for row in ws.iter_rows(min_row=1, max_row=min(15, ws.max_row), values_only=False):
                non_empty = sum(1 for c in row if _norm(c.value))
                if non_empty >= 15:
                    header_row = row[0].row
                    break
        print(f"[inspect] detected header row: {header_row}")

        # Extract headers.
        headers = []
        if header_row:
            row = next(ws.iter_rows(min_row=header_row, max_row=header_row, values_only=False))
            for c in row:
                headers.append({"col_letter": c.column_letter,
                                "header": _norm(c.value)})
        print(f"[inspect] header count: {len(headers)}")

        # Populated + distinct counts for each header column.
        stats = []
        total_rows = 0
        for row in ws.iter_rows(min_row=(header_row or 0) + 1, max_row=ws.max_row,
                                values_only=False):
            # Skip blank rows.
            if not any(_norm(c.value) for c in row):
                continue
            total_rows += 1
        print(f"[inspect] data rows (non-blank): {total_rows}")

        for h in headers:
            col_letter = h["col_letter"]
            populated = 0
            distinct: set = set()
            examples: list = []
            for row in ws.iter_rows(
                min_row=(header_row or 0) + 1,
                max_row=ws.max_row,
                min_col=openpyxl.utils.column_index_from_string(col_letter),
                max_col=openpyxl.utils.column_index_from_string(col_letter),
                values_only=False,
            ):
                v = _norm(row[0].value)
                if v:
                    populated += 1
                    if v not in distinct and len(examples) < 5:
                        examples.append(v[:60])
                    distinct.add(v)
            stats.append({
                "col": col_letter,
                "header": h["header"],
                "populated": populated,
                "distinct": len(distinct),
                "pii": _classify_pii(h["header"]),
                "examples": examples[:3],
            })

        # Print stats table.
        print("\n[inspect] column stats:")
        for s in stats:
            pii = f"[{s['pii']}]" if s["pii"] else "     "
            hdr = (s["header"] or "<blank>")[:32].ljust(32)
            ex = " · ".join(str(e) for e in s["examples"])
            print(f"  {s['col']:>2}  {pii}  {hdr}  pop={s['populated']:>4}  distinct={s['distinct']:>4}   e.g. {ex}")

        # Emit JSON summary too for a machine-readable report.
        report_path = SOURCE.with_name(f"hr_employees_inspect_{sn.replace(' ', '_')}.json")
        report_path.write_text(json.dumps({
            "sheet": sn,
            "header_row": header_row,
            "total_data_rows": total_rows,
            "columns": stats,
        }, indent=2, default=str))
        print(f"[inspect] JSON summary → {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(inspect())
