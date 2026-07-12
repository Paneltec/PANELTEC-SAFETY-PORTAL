"""v160.3.4 — Re-dry-run against the 5 real Simpro ZIPs.

Usage (from /app):
    cd /app/backend && python -m scripts.dryrun_v160_3_4

Reads:  /tmp/simpro_test/z{0..4}.zip
Writes: /app/memory/SIMPRO_DRYRUN_v160.3.4.md

Steps:
  1. Auto-identify a worker per ZIP (v160.3.3 identifier)
  2. Run `_plan_zip` on each — collect counts + unmatched groups
  3. Aggregate cross-ZIP totals, auto-taxonomy candidates and coverage %
  4. Render a markdown report

NO writes. Read-only. Task D (live commit) is held for GO LIVE.
"""
from __future__ import annotations

import asyncio
import io
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# Make backend importable when run from /app/backend.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import db  # noqa: E402
from simpro_zip_import import (  # noqa: E402
    _identify_worker, _plan_zip,
)

ZIP_DIR = Path("/tmp/simpro_test")
OUT_PATH = Path("/app/memory/SIMPRO_DRYRUN_v160.3.4.md")


async def _resolve_org_id() -> str:
    """Return the Paneltec org_id — the one carrying the Simpro tenant."""
    row = await db.orgs.find_one({}, {"_id": 0, "id": 1, "name": 1},
                                  sort=[("created_at", 1)])
    if not row:
        raise SystemExit("No orgs in DB")
    return row["id"]


async def main() -> None:
    if not ZIP_DIR.exists():
        raise SystemExit(f"Test-ZIP directory missing: {ZIP_DIR}")
    zips = sorted(ZIP_DIR.glob("z*.zip"))
    if not zips:
        raise SystemExit(f"No z*.zip files in {ZIP_DIR}")

    org_id = await _resolve_org_id()
    print(f"[dryrun] org_id={org_id}  zips={len(zips)}")

    per_zip: list[dict] = []
    agg_counts: dict[str, int] = defaultdict(int)
    # slug → aggregate group across all ZIPs
    combined_groups: dict[str, dict] = {}

    for zpath in zips:
        raw = zpath.read_bytes()
        matched, score, tokens = await _identify_worker(raw, org_id)
        if not matched:
            per_zip.append({
                "zip": zpath.name, "worker": None,
                "score": score, "tokens": tokens,
                "counts": {}, "unmatched_groups": [],
                "error": "No confident worker match (<0.5)",
            })
            continue
        try:
            plan = await _plan_zip(raw, matched["id"], org_id)
        except Exception as e:  # pragma: no cover
            per_zip.append({
                "zip": zpath.name,
                "worker": f'{matched.get("first_name","")} {matched.get("last_name","")}'.strip(),
                "score": score, "counts": {}, "unmatched_groups": [],
                "error": str(e),
            })
            continue
        counts = plan.get("counts") or {}
        per_zip.append({
            "zip": zpath.name,
            "worker": f'{matched.get("first_name","")} {matched.get("last_name","")}'.strip(),
            "worker_id": matched["id"],
            "score": score,
            "counts": counts,
            "unmatched_groups": plan.get("unmatched_groups") or [],
        })
        for k, v in counts.items():
            agg_counts[k] += v
        for g in plan.get("unmatched_groups") or []:
            slug = g.get("suggested_slug") or "__no_suggestion__"
            entry = combined_groups.setdefault(slug, {
                "suggested_slug": g.get("suggested_slug"),
                "suggested_label": g.get("suggested_label"),
                "confidence": g.get("confidence"),
                "existing_slug_hit": g.get("existing_slug_hit"),
                "count": 0,
                "sample_filenames": [],
                "auto_accept_default": g.get("auto_accept_default", False),
            })
            entry["count"] += g["count"]
            for f in g["sample_filenames"]:
                if f not in entry["sample_filenames"] and len(entry["sample_filenames"]) < 6:
                    entry["sample_filenames"].append(f)

    # Overall coverage %
    total_files = sum((z["counts"].get("total_files") or 0) for z in per_zip)
    unmatched_files = sum((z["counts"].get("unmatched") or 0) for z in per_zip)
    would_be_matched_via_auto = sum(
        g["count"]
        for slug, g in combined_groups.items()
        if slug != "__no_suggestion__" and (
            g["existing_slug_hit"] is not None or g.get("auto_accept_default")
        )
    )
    matched_files = total_files - unmatched_files
    projected_matched = matched_files + would_be_matched_via_auto
    projected_unmatched = unmatched_files - would_be_matched_via_auto
    coverage_before = (matched_files / total_files * 100) if total_files else 0.0
    coverage_after = (projected_matched / total_files * 100) if total_files else 0.0

    # ── Render markdown
    now = datetime.now(timezone.utc).isoformat()
    lines: list[str] = []
    lines.append("# v160.3.4 — Simpro ZIP Re-Dry-Run (Auto-Taxonomy Preview)\n")
    lines.append(f"**Generated**: {now}\n")
    lines.append(f"**Org**: `{org_id}`\n")
    lines.append(f"**ZIPs scanned**: {len(zips)} — {[z.name for z in zips]}\n")
    lines.append("**Mode**: READ-ONLY dry-run · **NO writes** to Mongo, GridFS or Simpro.\n")
    lines.append("---\n")
    lines.append("## Executive summary\n")
    lines.append("| Metric | Before (v160.3.3) | After auto-accept (v160.3.4) |\n")
    lines.append("|---|---:|---:|\n")
    lines.append(f"| Total files across 5 ZIPs | {total_files} | {total_files} |\n")
    lines.append(f"| Matched to a cert_kind | {matched_files} | {projected_matched} |\n")
    lines.append(f"| Unmatched | **{unmatched_files}** | **{projected_unmatched}** |\n")
    lines.append(f"| Coverage % | {coverage_before:.1f}% | **{coverage_after:.1f}%** |\n")

    new_kinds = [g for slug, g in combined_groups.items()
                  if slug != "__no_suggestion__" and g["existing_slug_hit"] is None]
    routed_to_existing = [g for slug, g in combined_groups.items()
                           if g.get("existing_slug_hit")]
    lines.append(f"| Would-create new cert_kinds | 0 | **{len(new_kinds)}** |\n")
    lines.append(f"| Routed to existing (fuzzy hit ≥ 0.80) | 0 | {len(routed_to_existing)} |\n")
    lines.append("\n---\n")

    lines.append("## Per-ZIP breakdown\n")
    lines.append("| ZIP | Worker | Score | Total | Attach | Create | HR | Unmatched |\n")
    lines.append("|---|---|---:|---:|---:|---:|---:|---:|\n")
    for z in per_zip:
        c = z.get("counts", {}) or {}
        lines.append(
            f"| `{z['zip']}` | {z.get('worker') or '—'} | "
            f"{z.get('score', 0):.2f} | {c.get('total_files', 0)} | "
            f"{c.get('attach', 0)} | {c.get('create', 0)} | "
            f"{c.get('hr_folder', 0)} | {c.get('unmatched', 0)} |\n"
        )
    lines.append("\n---\n")

    lines.append("## Proposed new cert_kinds (auto-accept default candidates)\n")
    lines.append("Rows with `auto_accept_default: true` (count ≥ 3 OR confidence ≥ 0.85) "
                  "would be checked by default in the UI.\n\n")
    if new_kinds:
        lines.append("| Suggested slug | Label | Files | Confidence | Auto-accept default | Sample filenames |\n")
        lines.append("|---|---|---:|---:|:---:|---|\n")
        for g in sorted(new_kinds, key=lambda x: -x["count"]):
            samples = ", ".join(f"`{s}`" for s in g["sample_filenames"][:3])
            lines.append(
                f"| `{g['suggested_slug']}` | {g['suggested_label']} | "
                f"{g['count']} | {g['confidence']:.2f} | "
                f"{'✅' if g.get('auto_accept_default') else '—'} | {samples} |\n"
            )
    else:
        lines.append("_None._\n")
    lines.append("\n---\n")

    lines.append("## Routed-to-existing (dedupe against catalogue)\n")
    lines.append("Suggestions that fuzzy-hit an existing `cert_kinds` slug (≥ 0.80). "
                  "These do **not** create a new kind — files are attached to the existing slug.\n\n")
    if routed_to_existing:
        lines.append("| Suggested slug | Existing hit | Files | Confidence |\n")
        lines.append("|---|---|---:|---:|\n")
        for g in sorted(routed_to_existing, key=lambda x: -x["count"]):
            lines.append(
                f"| `{g['suggested_slug']}` | `{g['existing_slug_hit']}` | "
                f"{g['count']} | {g['confidence']:.2f} |\n"
            )
    else:
        lines.append("_None._\n")
    lines.append("\n---\n")

    no_suggest = combined_groups.get("__no_suggestion__")
    lines.append("## Files still unmatched after auto-taxonomy\n")
    if no_suggest and no_suggest["count"] > 0:
        lines.append(f"**{no_suggest['count']} file(s)** could not produce a usable slug "
                      "(all filename tokens were noise / dates / initials).\n\n")
        for s in no_suggest["sample_filenames"]:
            lines.append(f"  - `{s}`\n")
        lines.append("\nThese land in the per-worker **Unmatched Documents** triage tab "
                      "for manual reclassification.\n")
    else:
        lines.append("_None — every unmatched file produced a usable slug candidate._\n")
    lines.append("\n---\n")

    lines.append("## Notes\n")
    lines.append("- **Task D (live commit) is held pending explicit `GO LIVE` approval.** "
                  "This dry-run performs zero writes.\n")
    lines.append("- Existing `worker_certifications` rows are **never overwritten** by ZIP import — "
                  "matched files attach to existing cert rows (updating `doc_file_id` only), "
                  "and unmatched-after-auto-taxonomy files land in `worker_unmatched_documents` "
                  "(soft-delete + 30d GridFS retention).\n")
    lines.append("- Coverage target for auto-taxonomy pass: **≥ 90%** — "
                  f"actual: **{coverage_after:.1f}%**.\n")

    OUT_PATH.write_text("".join(lines))
    print(f"[dryrun] wrote {OUT_PATH}")
    print(f"[dryrun] coverage before={coverage_before:.1f}% after={coverage_after:.1f}%")
    print(f"[dryrun] new_kinds={len(new_kinds)} routed_to_existing={len(routed_to_existing)}")


if __name__ == "__main__":
    asyncio.run(main())
