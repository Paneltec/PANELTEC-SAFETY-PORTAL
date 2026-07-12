"""v160.3.4a — Task D · Live import of 5 real Simpro ZIPs.

Usage (from /app/backend):
    set -a && source .env && set +a
    python -m scripts.live_import_v160_3_4

Steps:
  1. Identify each ZIP → worker
  2. Dry-run each → collect combined unmatched suggestion groups
  3. Persist auto_accept_default groups into cert_kinds + licence_mapping
  4. Re-plan every ZIP so newly-accepted slugs are now recognised
  5. Commit each ZIP with dry_run=0 (writes GridFS + cert rows + snapshot)
  6. Emit per-worker report + snapshot IDs to /app/memory/SIMPRO_LIVE_v160.3.4.md

Rollback: each worker's commit records a `worker_import_snapshots` row
capturing pre-state cert/HR IDs. To roll back: delete cert rows with
IDs listed in `post_ids.new_cert_ids`, delete HR docs in `new_hr_doc_ids`,
delete unmatched docs in `new_unmatched_ids`, and restore worker's
photo_url from `pre_state.photo_url`.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import db  # noqa: E402
from models import new_id, now_iso  # noqa: E402
from simpro_zip_import import (  # noqa: E402
    _commit_zip, _fs_bucket, _identify_worker, _plan_zip,
)

ZIP_DIR = Path("/tmp/simpro_test")
OUT_PATH = Path("/app/memory/SIMPRO_LIVE_v160.3.4.md")


async def _resolve_admin() -> tuple[str, str]:
    """Return (org_id, admin_user_id). Prefer Stephen for audit trail."""
    admin = await db.users.find_one({"email": "stephen@paneltec.com.au"},
                                      {"_id": 0, "id": 1, "org_id": 1})
    if not admin:
        admin = await db.users.find_one({"role": "admin"},
                                          {"_id": 0, "id": 1, "org_id": 1})
    if not admin:
        raise SystemExit("No admin user available")
    return admin["org_id"], admin["id"]


async def _accept_suggestions(suggestions: list[dict], admin_id: str) -> tuple[list[str], list[str]]:
    """Inline replica of the /accept-suggestions endpoint logic."""
    created, merged = [], []
    ts = now_iso()
    for s in suggestions:
        slug, label = s.get("slug"), s.get("label")
        variants = s.get("simpro_variants") or []
        if not slug or not label:
            continue
        existing = await db.cert_kinds.find_one({"slug": slug})
        if existing:
            merged_variants = list({*(existing.get("simpro_variants") or []), *variants})
            await db.cert_kinds.update_one(
                {"slug": slug},
                {"$set": {"simpro_variants": merged_variants, "updated_at": ts}},
            )
            merged.append(slug)
        else:
            await db.cert_kinds.insert_one({
                "slug": slug, "name": label, "category": None,
                "requires_expiry": None, "simpro_variants": variants,
                "source_count": len(variants), "source": "auto_taxonomy",
                "created_by": admin_id, "created_at": ts, "updated_at": ts,
            })
            created.append(slug)
        for v in variants:
            if not v:
                continue
            await db.simpro_licence_mapping.update_one(
                {"simpro_licence_name_raw": v},
                {"$set": {"cert_kind_slug": slug, "map_status": "auto_taxonomy",
                          "updated_at": ts},
                 "$setOnInsert": {"created_at": ts}},
                upsert=True,
            )
    return created, merged


async def main() -> None:
    zips = sorted(ZIP_DIR.glob("z*.zip"))
    if not zips:
        raise SystemExit("No z*.zip in /tmp/simpro_test/")
    org_id, admin_id = await _resolve_admin()
    fs = _fs_bucket()
    print(f"[live] org={org_id} admin={admin_id} zips={len(zips)}")

    # ── STEP 1+2 — identify + dry-run each ZIP
    per_zip = []
    combined_groups: dict[str, dict] = {}
    for zpath in zips:
        raw = zpath.read_bytes()
        matched, score, _ = await _identify_worker(raw, org_id)
        if not matched:
            per_zip.append({"zip": zpath.name, "raw": raw, "worker": None,
                             "error": "no worker match"})
            continue
        plan = await _plan_zip(raw, matched["id"], org_id)
        per_zip.append({
            "zip": zpath.name, "raw": raw,
            "worker_id": matched["id"],
            "worker_name": f'{matched.get("first_name","")} {matched.get("last_name","")}'.strip(),
            "score": score,
            "predicted_counts": plan["counts"],
            "unmatched_groups": plan["unmatched_groups"],
        })
        for g in plan["unmatched_groups"]:
            slug = g.get("suggested_slug")
            if not slug:
                continue
            prev = combined_groups.get(slug)
            if not prev:
                combined_groups[slug] = {**g,
                                          "sample_filenames": list(g["sample_filenames"])}
            else:
                prev["count"] += g["count"]
                for f in g["sample_filenames"]:
                    if f not in prev["sample_filenames"] and len(prev["sample_filenames"]) < 6:
                        prev["sample_filenames"].append(f)
    # Re-compute auto_accept_default after combining counts.
    for g in combined_groups.values():
        g["auto_accept_default"] = bool(
            g.get("existing_slug_hit") is None
            and (g["count"] >= 3 or (g.get("confidence") or 0) >= 0.85)
        )

    # ── STEP 3 — persist accepted suggestions
    to_accept = [
        {"slug": g["suggested_slug"],
         "label": g["suggested_label"],
         "simpro_variants": [
             f.replace(".pdf", "").replace(".PDF", "")
             for f in g["sample_filenames"]
         ]}
        for g in combined_groups.values()
        if g["suggested_slug"]
        and not g.get("existing_slug_hit")
        and g["auto_accept_default"]
    ]
    print(f"[live] accepting {len(to_accept)} new cert_kinds…")
    created, merged = await _accept_suggestions(to_accept, admin_id)
    print(f"[live] created={len(created)} merged={len(merged)}")

    # ── STEP 4+5 — re-plan and commit each ZIP
    results = []
    for z in per_zip:
        if not z.get("worker_id"):
            results.append(z)
            continue
        try:
            fresh_plan = await _plan_zip(z["raw"], z["worker_id"], org_id)
            commit = await _commit_zip(z["raw"], fresh_plan, z["worker_id"],
                                         org_id, admin_id, fs)
            results.append({
                **z,
                "post_plan_counts": fresh_plan["counts"],
                "commit_counts": commit["counts"],
                "snapshot_id": commit.get("snapshot_id"),
                "photo": commit.get("photo"),
                "new_cert_ids_sample": [c["id"] for c in commit["created_certs"][:3]],
            })
            print(f"[live] {z['zip']} → {z['worker_name']} · "
                   f"{commit['counts']} · snap={commit.get('snapshot_id')}")
        except Exception as e:  # pragma: no cover
            results.append({**z, "error": str(e)})
            print(f"[live] {z['zip']} FAILED: {e}")

    # ── Report
    now = datetime.now(timezone.utc).isoformat()
    lines: list[str] = []
    lines.append("# v160.3.4a — Simpro ZIP Live Import (Task D · GO LIVE)\n\n")
    lines.append(f"**Generated**: {now}\n\n")
    lines.append(f"**Admin**: `{admin_id}` · **Org**: `{org_id}`\n\n")
    lines.append(f"**Auto-taxonomy step**: created {len(created)} new cert_kinds · merged {len(merged)}.\n\n")
    lines.append("---\n\n## Per-worker results\n\n")
    lines.append("| ZIP | Worker | Predicted (dry-run) | Committed (actual) | Photo | Snapshot |\n")
    lines.append("|---|---|---|---|:---:|---|\n")
    for r in results:
        w = r.get("worker_name") or "—"
        pc = r.get("predicted_counts") or {}
        cc = r.get("commit_counts") or {}
        pred = (f"total={pc.get('total_files',0)}, attach={pc.get('attach',0)}, "
                 f"create={pc.get('create',0)}, hr={pc.get('hr_folder',0)}, "
                 f"unm={pc.get('unmatched',0)}")
        actual = (f"attached={cc.get('attached',0)}, created={cc.get('created',0)}, "
                    f"hr={cc.get('hr_docs',0)}, unmatched={cc.get('unmatched',0)}")
        photo = "✅" if r.get("photo") else "—"
        snap = f"`{r.get('snapshot_id','—')}`"
        err = r.get("error")
        if err:
            actual = f"ERROR: {err}"
        lines.append(f"| `{r['zip']}` | {w} | {pred} | {actual} | {photo} | {snap} |\n")
    lines.append("\n---\n\n## Rollback\n\n")
    lines.append("Each `snapshot_id` above resolves to a `worker_import_snapshots` row "
                  "with `pre_state` (previous cert/HR IDs + photo) and `post_ids` "
                  "(newly-created IDs).  Delete `post_ids.new_cert_ids`, "
                  "`new_hr_doc_ids` and `new_unmatched_ids`, then reset the worker's "
                  "`photo_url` back to `pre_state.photo_url` to fully undo an import.\n")

    OUT_PATH.write_text("".join(lines))
    print(f"[live] wrote {OUT_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
