"""v58.13.132km — Auto-seed the `shared_reference` flag on `doc_folders`.

Fix scope
---------
Under AU WHS Regulation 344 an employer MUST make SDS available to
workers who handle the chemicals. The v159.0 `_grant()` hardening
locked `documents.view` off for workers, leaving `scope_filter` as
the only visibility surface — which fail-narrows to
`{created_by: uid} OR {assignee_id: uid}`. Admin-uploaded SDS folders
therefore returned empty for every worker on the mobile Docs tab.

`.132km` introduces a `shared_reference:True` flag on `doc_folders`.
Folders carrying that flag bypass the user-level narrowing in
`document_library.py::list_files`. This module runs on every backend
startup to auto-flag well-known reference-library folder names by
regex, respecting a hard blocklist for worker-private classes
(inductions, contracts, medical, discipline, etc.).

The migration is idempotent — safe to run on every boot. Existing
`shared_reference` values are NEVER downgraded; a folder that an
admin manually toggled OFF stays off.

Log line shape:
    [migrate-shared-ref] org=<uuid> seeded=<n> folders=[<names>]
"""
from __future__ import annotations

import logging
import re
from typing import Iterable

from db import db

log = logging.getLogger("paneltec.shared_reference")

# ─── Allow patterns ────────────────────────────────────────────
# Each pattern MUST hit as a substring (case-insensitive) on the
# folder's `name`. The order doesn't matter — a folder is flagged on
# the FIRST hit, then the blocklist is checked and can veto.
_ALLOW_PATTERNS: tuple[str, ...] = (
    r"\bsds\b",
    r"safety[\s_-]*data[\s_-]*sheet",
    r"\bmsds\b",
    r"chemical[\s_-]*register",
    r"\bchemicals?\b",
    r"australian[\s_-]*standard",
    r"\bau[\s_-]*standards?\b",
    r"^standards?$",
    r"\bstandards?\b",
    r"toolbox[\s_-]*(?:talk|meeting)",
    r"^procedures?$",
    r"\bprocedures?\b",
    r"\bsops?\b",
    r"standard[\s_-]*operating[\s_-]*procedure",
    r"emergency[\s_-]*(?:procedure|plan)",
    r"code[\s_-]*of[\s_-]*practice",
    r"codes[\s_-]*of[\s_-]*practice",
    r"\bsigns?\b",
    r"\bsignage\b",
    r"\bposters?\b",
    r"warning[\s_-]*signs?",
    r"\bpolicies\b",
    r"whs[\s_-]*polic",
)
_ALLOW_RE = re.compile("|".join(f"(?:{p})" for p in _ALLOW_PATTERNS), re.IGNORECASE)

# ─── Blocklist — must remain worker-private ────────────────────
# If a folder name hits ANY blocklist pattern, it is NEVER flagged
# even when it also hits an allow pattern. Handles ambiguous cases
# like "SDS Inductions" (blocklist wins per user directive).
_BLOCK_PATTERNS: tuple[str, ...] = (
    r"\binduction",
    r"\bcontract",
    r"\bpersonal\b",
    r"\bpayroll\b",
    r"\bmedical\b",
    r"\bdisciplin",
    r"warning[\s_-]*letter",
    r"\bperformance\b",
    r"\bhr\b",
    r"human[\s_-]*resource",
    r"\bconfidential\b",
    r"signed[\s_-]*swms",
    r"\bprivate\b",
)
_BLOCK_RE = re.compile("|".join(f"(?:{p})" for p in _BLOCK_PATTERNS), re.IGNORECASE)


def _matches(name: str) -> tuple[bool, bool]:
    """Return (allow_hit, block_hit). Blocklist wins over allow-list
    at the caller — this function just reports both signals."""
    if not name:
        return False, False
    allow = bool(_ALLOW_RE.search(name))
    block = bool(_BLOCK_RE.search(name))
    return allow, block


async def _descendant_ids(org_id: str, root_ids: Iterable[str]) -> set[str]:
    """BFS over `doc_folders.parent_folder_id` to collect every
    descendant of the given roots (INCLUDING the roots themselves).
    Bounded by folder-count so on a corrupt cycle we bail after
    100k iterations rather than looping forever."""
    seen: set[str] = set(root_ids)
    frontier: list[str] = list(seen)
    safety = 0
    while frontier and safety < 100_000:
        safety += 1
        cursor = db.doc_folders.find(
            {"org_id": org_id, "deleted_at": None,
             "parent_folder_id": {"$in": frontier}},
            {"_id": 0, "id": 1},
        )
        next_frontier: list[str] = []
        async for c in cursor:
            cid = c.get("id")
            if cid and cid not in seen:
                seen.add(cid)
                next_frontier.append(cid)
        frontier = next_frontier
    return seen


async def seed_shared_reference_flags_on_startup() -> dict:
    """Idempotent auto-seed. Runs on backend startup.

    · Scans every non-deleted `doc_folders` row grouped by `org_id`.
    · Matches names against `_ALLOW_RE`; vetoes with `_BLOCK_RE`.
    · For each matched root, expands to include descendant folders
      (recursive) so `SDS → Diesel → 10w40 SDS` all inherit the flag.
    · Applies `shared_reference:True` to any folder that isn't
      already flagged. Never downgrades (an admin who explicitly
      toggled OFF is respected).
    · Logs a per-org report + returns a summary for tests.
    """
    report = {"orgs_scanned": 0, "seeded": 0,
              "ambiguous": [], "by_org": {}}

    # Gather all folders once, group by org — cheap; total row count
    # is small (< 200 across our largest org today per the .132km
    # diagnostic).
    all_folders = await db.doc_folders.find(
        {"deleted_at": None},
        {"_id": 0, "id": 1, "org_id": 1, "name": 1,
         "parent_folder_id": 1, "shared_reference": 1},
    ).to_list(50_000)

    by_org: dict[str, list[dict]] = {}
    for f in all_folders:
        by_org.setdefault(f.get("org_id") or "_none", []).append(f)

    for org_id, folders in by_org.items():
        if org_id == "_none":
            continue
        report["orgs_scanned"] += 1
        matched_roots: list[dict] = []
        for f in folders:
            name = (f.get("name") or "").strip()
            allow, block = _matches(name)
            if allow and block:
                report["ambiguous"].append({
                    "org_id": org_id, "id": f.get("id"), "name": name,
                    "resolution": "blocklist_wins",
                })
                continue
            if allow and not block:
                matched_roots.append(f)

        if not matched_roots:
            report["by_org"][org_id] = {"seeded_new": 0,
                                          "already_flagged": 0,
                                          "root_folder_names": []}
            continue

        # Expand to descendants
        root_ids = [f["id"] for f in matched_roots]
        subtree = await _descendant_ids(org_id, root_ids)

        # Only flag folders that aren't already True; never downgrade.
        result = await db.doc_folders.update_many(
            {"org_id": org_id, "id": {"$in": list(subtree)},
             "deleted_at": None,
             "$or": [{"shared_reference": False},
                     {"shared_reference": {"$exists": False}}]},
            {"$set": {"shared_reference": True}},
        )
        seeded_new = int(result.modified_count or 0)
        already = len(subtree) - seeded_new
        report["seeded"] += seeded_new
        root_names = sorted({(f.get("name") or "").strip() for f in matched_roots})
        report["by_org"][org_id] = {
            "seeded_new": seeded_new,
            "already_flagged": max(0, already),
            "root_folder_names": root_names,
            "subtree_size": len(subtree),
        }
        log.info(
            "[migrate-shared-ref] org=%s seeded=%d already=%d subtree=%d roots=%s",
            org_id, seeded_new, max(0, already), len(subtree), root_names,
        )

    if report["ambiguous"]:
        log.info("[migrate-shared-ref] ambiguous_cases=%d (blocklist wins) — %s",
                 len(report["ambiguous"]), report["ambiguous"])

    log.info("[migrate-shared-ref] summary: orgs_scanned=%d total_seeded=%d",
             report["orgs_scanned"], report["seeded"])
    return report
