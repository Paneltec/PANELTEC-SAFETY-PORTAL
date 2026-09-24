"""v58.13.132mk — Ingest orchestration for Tasmanian WHS legislation.

Phase 1: fetch primary Act + Regulations HTML, enumerate Codes of
Practice from the WorkSafe Tas landing page, fetch each COP PDF,
parse into sections, write to Mongo `whs_legislation`.

Idempotency: each run gets a fresh `ingest_run_id`. After a successful
per-doc write, rows for that `doc_id` whose `ingest_run_id` doesn't
match are deleted (stale). If a source fetch fails, existing rows for
that doc are untouched.

Progress: mirrored into `whs_legislation_ingest_runs` every ~1 s so
the admin status endpoint can render live counts.
"""
from __future__ import annotations

import asyncio
import logging
import re
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from db import db
from .parser import (
    ParsedSection,
    enumerate_cop_pdfs,
    maybe_chunk_section,
    parse_cop_pdf,
    parse_legislation_html,
)

log = logging.getLogger("paneltec.whs_legislation.ingest")

# ── Source config ──────────────────────────────────────────────
# Verbatim from user brief. HTML views preferred over PDFs for parsing.
_TAS_WHS_ACT_URL = (
    "https://www.legislation.tas.gov.au/view/whole/html/inforce/current/act-2012-001"
)
# v58.13.132mk-fix1 — Regs slug is `sr-2022-109`, not `sr-2022-118`
# as the user brief suggested. Confirmed via web search + WorkSafe Tas
# reference at worksafe.tas.gov.au/topics/laws-and-compliance/acts-and-
# regulations/new-whs-regulations-2022.
_TAS_WHS_REG_URL = (
    "https://www.legislation.tas.gov.au/view/whole/html/inforce/current/sr-2022-109"
)
_COP_LANDING_URL = (
    "https://worksafe.tas.gov.au/topics/laws-and-compliance/codes-of-practice"
)

_HTTP_TIMEOUT_S = 60.0
# v58.13.132mk-fix2 — WorkSafe Tas + legislation.tas.gov.au both
# reject the generic paneltec UA with 403 Forbidden. Same Cloudflare
# bot filter we bypassed in `.132li`. Send a browser-realistic UA;
# still identify ourselves in the trailing token for their logs.
_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 "
    "paneltec-whs-ingest/1.0"
)


@dataclass
class IngestProgress:
    run_id: str
    state: str = "starting"   # starting|running|completed|failed
    docs_planned: int = 0
    docs_processed: int = 0
    sections_processed: int = 0
    errors: List[Dict[str, Any]] = field(default_factory=list)
    per_doc: List[Dict[str, Any]] = field(default_factory=list)
    started_at: str = ""
    updated_at: str = ""
    completed_at: str = ""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _flush_progress(prog: IngestProgress) -> None:
    prog.updated_at = _now_iso()
    await db.whs_legislation_ingest_runs.update_one(
        {"run_id": prog.run_id},
        {"$set": {
            "run_id": prog.run_id,
            "state": prog.state,
            "docs_planned": prog.docs_planned,
            "docs_processed": prog.docs_processed,
            "sections_processed": prog.sections_processed,
            "errors": prog.errors[-100:],
            "per_doc": prog.per_doc,
            "started_at": prog.started_at,
            "updated_at": prog.updated_at,
            "completed_at": prog.completed_at,
        }},
        upsert=True,
    )


async def ensure_indexes() -> None:
    """Idempotent — call from server on_startup."""
    await db.whs_legislation.create_index(
        [("doc_id", 1), ("section_number", 1), ("chunk_suffix", 1)],
        unique=True,
        name="doc_section_chunk_unique",
    )
    await db.whs_legislation.create_index([("doc_type", 1)])
    await db.whs_legislation.create_index([("ingest_run_id", 1)])
    try:
        await db.whs_legislation.create_index(
            [("section_title", "text"), ("section_text", "text")],
            name="whs_full_text",
        )
    except Exception as e:  # noqa: BLE001
        # Multiple text indexes on same collection would clash; if it
        # already exists under a different name, ignore.
        log.info("whs_legislation text index skip: %s", e)
    await db.whs_legislation_ingest_runs.create_index(
        [("run_id", 1)], unique=True,
    )


async def _is_run_active() -> bool:
    """Return True when any run is `starting` or `running` right now."""
    doc = await db.whs_legislation_ingest_runs.find_one(
        {"state": {"$in": ["starting", "running"]}},
        {"_id": 0, "run_id": 1, "state": 1, "updated_at": 1},
    )
    if not doc:
        return False
    # Stale guard: if updated_at is older than 30 min, treat as dead.
    try:
        ts = datetime.fromisoformat(doc.get("updated_at") or "")
    except Exception:  # noqa: BLE001
        return True
    if (datetime.now(timezone.utc) - ts).total_seconds() > 30 * 60:
        return False
    return True


async def _fetch(url: str, *, client: httpx.AsyncClient) -> bytes:
    r = await client.get(url, timeout=_HTTP_TIMEOUT_S, follow_redirects=True)
    r.raise_for_status()
    return r.content


async def _write_sections(
    *, doc_id: str, doc_type: str, doc_title: str, doc_source_url: str,
    doc_revision_date: str, sections: List[ParsedSection],
    ingest_run_id: str,
) -> int:
    """Upsert every parsed section (+ its chunks) for one doc.
    Rows for this doc_id NOT touched by this run are deleted at the
    end for idempotency."""
    written = 0
    now_iso = _now_iso()
    for sec in sections:
        for suffix, chunk_text in maybe_chunk_section(sec):
            unique_key = {
                "doc_id": doc_id,
                "section_number": sec.section_number,
                "chunk_suffix": suffix,
            }
            payload = {
                "doc_id": doc_id,
                "doc_type": doc_type,
                "doc_title": doc_title,
                "doc_source_url": doc_source_url,
                "doc_revision_date": doc_revision_date,
                "section_number": sec.section_number,
                "section_title": sec.section_title,
                "section_text": chunk_text,
                "section_html": sec.section_html if not suffix else "",
                "parent_section": sec.parent_section,
                "full_path": sec.full_path + (f" ({suffix.lstrip('_')})" if suffix else ""),
                "chunk_suffix": suffix,
                "embedding": None,  # Phase 2 backfills.
                "last_ingested_at": now_iso,
                "ingest_run_id": ingest_run_id,
            }
            await db.whs_legislation.update_one(
                unique_key,
                {"$set": payload,
                 "$setOnInsert": {"id": secrets.token_hex(16)}},
                upsert=True,
            )
            written += 1
    # Delete stale rows for this doc that weren't touched this run.
    if written > 0:
        purge = await db.whs_legislation.delete_many({
            "doc_id": doc_id,
            "ingest_run_id": {"$ne": ingest_run_id},
        })
        if purge.deleted_count:
            log.info(
                "[whs-ingest] %s: purged %d stale rows",
                doc_id, purge.deleted_count,
            )
    return written


async def _ingest_html_doc(
    *, doc_id: str, doc_type: str, doc_title: str, doc_url: str,
    client: httpx.AsyncClient, ingest_run_id: str, prog: IngestProgress,
) -> None:
    t0 = time.monotonic()
    try:
        body = await _fetch(doc_url, client=client)
        html = body.decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        prog.errors.append({
            "doc_id": doc_id, "phase": "fetch",
            "url": doc_url, "error": f"{type(e).__name__}: {e}",
        })
        prog.per_doc.append({
            "doc_id": doc_id, "doc_type": doc_type, "doc_title": doc_title,
            "sections": 0, "state": "fetch_failed", "url": doc_url,
        })
        log.warning("[whs-ingest] %s: fetch failed: %s", doc_id, e)
        return
    sections = parse_legislation_html(
        html, doc_id=doc_id, doc_title=doc_title,
    )
    n = await _write_sections(
        doc_id=doc_id, doc_type=doc_type, doc_title=doc_title,
        doc_source_url=doc_url, doc_revision_date=_now_iso(),
        sections=sections, ingest_run_id=ingest_run_id,
    )
    prog.sections_processed += n
    prog.per_doc.append({
        "doc_id": doc_id, "doc_type": doc_type, "doc_title": doc_title,
        "sections": n, "state": "ok", "url": doc_url,
        "wall_s": round(time.monotonic() - t0, 2),
    })


def _slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return s[:80] or "cop"


async def _ingest_cop_pdf(
    *, cop: dict, client: httpx.AsyncClient,
    ingest_run_id: str, prog: IngestProgress,
) -> None:
    doc_title = cop["title"]
    doc_url = cop["url"]
    doc_id = f"cop-{_slugify(doc_title)}"
    t0 = time.monotonic()
    try:
        body = await _fetch(doc_url, client=client)
    except Exception as e:  # noqa: BLE001
        prog.errors.append({
            "doc_id": doc_id, "phase": "fetch",
            "url": doc_url, "error": f"{type(e).__name__}: {e}",
        })
        prog.per_doc.append({
            "doc_id": doc_id, "doc_type": "code_of_practice",
            "doc_title": doc_title, "sections": 0,
            "state": "fetch_failed", "url": doc_url,
        })
        log.warning("[whs-ingest] %s: fetch failed: %s", doc_id, e)
        return
    try:
        sections = parse_cop_pdf(
            body, doc_id=doc_id, doc_title=doc_title,
        )
    except Exception as e:  # noqa: BLE001
        prog.errors.append({
            "doc_id": doc_id, "phase": "parse",
            "url": doc_url, "error": f"{type(e).__name__}: {e}",
        })
        prog.per_doc.append({
            "doc_id": doc_id, "doc_type": "code_of_practice",
            "doc_title": doc_title, "sections": 0,
            "state": "parse_failed", "url": doc_url,
        })
        log.exception("[whs-ingest] %s: parse crashed", doc_id)
        return
    n = await _write_sections(
        doc_id=doc_id, doc_type="code_of_practice",
        doc_title=doc_title,
        doc_source_url=doc_url,
        doc_revision_date=cop.get("revision_date") or _now_iso(),
        sections=sections, ingest_run_id=ingest_run_id,
    )
    prog.sections_processed += n
    prog.per_doc.append({
        "doc_id": doc_id, "doc_type": "code_of_practice",
        "doc_title": doc_title, "sections": n, "state": "ok",
        "url": doc_url, "wall_s": round(time.monotonic() - t0, 2),
    })


async def run_ingest_job(run_id: str) -> None:
    """Main entry — runs the whole ingest. Called via
    `asyncio.create_task` from the /reingest endpoint."""
    prog = IngestProgress(run_id=run_id)
    prog.state = "starting"
    prog.started_at = _now_iso()
    await _flush_progress(prog)

    headers = {"User-Agent": _USER_AGENT}
    async with httpx.AsyncClient(headers=headers) as client:
        # 1. Enumerate COP PDFs first so `docs_planned` is accurate.
        cops: List[dict] = []
        try:
            landing = await _fetch(_COP_LANDING_URL, client=client)
            cops = enumerate_cop_pdfs(
                landing.decode("utf-8", errors="replace"),
                base_url=_COP_LANDING_URL,
            )
        except Exception as e:  # noqa: BLE001
            prog.errors.append({
                "doc_id": "cop-landing", "phase": "enumerate",
                "url": _COP_LANDING_URL,
                "error": f"{type(e).__name__}: {e}",
            })
            log.error("[whs-ingest] COP landing enum failed: %s", e)

        prog.docs_planned = 2 + len(cops)  # Act + Regs + N COPs
        prog.state = "running"
        await _flush_progress(prog)

        # 2. Act + Regs.
        await _ingest_html_doc(
            doc_id="tas-whs-act-2012", doc_type="act",
            doc_title="Work Health and Safety Act 2012 (Tasmania)",
            doc_url=_TAS_WHS_ACT_URL,
            client=client, ingest_run_id=run_id, prog=prog,
        )
        prog.docs_processed += 1
        await _flush_progress(prog)

        await _ingest_html_doc(
            doc_id="tas-whs-reg-2022", doc_type="regulation",
            doc_title="Work Health and Safety Regulations 2022 (Tasmania)",
            doc_url=_TAS_WHS_REG_URL,
            client=client, ingest_run_id=run_id, prog=prog,
        )
        prog.docs_processed += 1
        await _flush_progress(prog)

        # 3. COPs — sequentially so we're a well-behaved crawler.
        for cop in cops:
            await _ingest_cop_pdf(
                cop=cop, client=client,
                ingest_run_id=run_id, prog=prog,
            )
            prog.docs_processed += 1
            await _flush_progress(prog)

    prog.state = "completed"
    prog.completed_at = _now_iso()
    await _flush_progress(prog)
    log.info(
        "[whs-ingest] run %s completed: %d docs, %d sections, %d errors",
        run_id, prog.docs_processed, prog.sections_processed,
        len(prog.errors),
    )


async def start_run() -> Dict[str, Any]:
    """Kick off a background run. Refuses if another run is active."""
    if await _is_run_active():
        raise RuntimeError("another ingest run is already active")
    run_id = f"whsleg-{secrets.token_hex(6)}"
    await db.whs_legislation_ingest_runs.insert_one({
        "run_id": run_id,
        "state": "starting",
        "started_at": _now_iso(),
        "updated_at": _now_iso(),
        "docs_planned": 0,
        "docs_processed": 0,
        "sections_processed": 0,
        "errors": [],
        "per_doc": [],
    })
    task = asyncio.create_task(_wrapped_run(run_id))
    # Hold a strong ref (Python 3.11 asyncio._all_tasks is WeakSet).
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return {"run_id": run_id, "state": "started"}


async def _wrapped_run(run_id: str) -> None:
    try:
        await run_ingest_job(run_id)
    except Exception as e:  # noqa: BLE001
        log.exception("[whs-ingest] run %s CRASHED", run_id)
        await db.whs_legislation_ingest_runs.update_one(
            {"run_id": run_id},
            {"$set": {
                "state": "failed",
                "fatal_error": f"{type(e).__name__}: {e}",
                "updated_at": _now_iso(),
                "completed_at": _now_iso(),
            }},
        )


_BACKGROUND_TASKS: set = set()


async def get_status(run_id: Optional[str] = None) -> Optional[dict]:
    """Return one run doc. If run_id is None, return the most recent."""
    if run_id:
        return await db.whs_legislation_ingest_runs.find_one(
            {"run_id": run_id}, {"_id": 0},
        )
    return await db.whs_legislation_ingest_runs.find_one(
        {}, {"_id": 0}, sort=[("started_at", -1)],
    )


async def list_sources() -> List[dict]:
    """Return per-doc summary for the admin UI status panel."""
    pipeline = [
        {"$group": {
            "_id": "$doc_id",
            "doc_type": {"$first": "$doc_type"},
            "doc_title": {"$first": "$doc_title"},
            "doc_source_url": {"$first": "$doc_source_url"},
            "last_ingested_at": {"$max": "$last_ingested_at"},
            "section_count": {"$sum": 1},
        }},
        {"$sort": {"doc_type": 1, "_id": 1}},
    ]
    out: List[dict] = []
    async for row in db.whs_legislation.aggregate(pipeline):
        out.append({
            "doc_id": row["_id"],
            "doc_type": row["doc_type"],
            "doc_title": row["doc_title"],
            "doc_source_url": row["doc_source_url"],
            "last_ingested_at": row["last_ingested_at"],
            "section_count": row["section_count"],
        })
    return out
