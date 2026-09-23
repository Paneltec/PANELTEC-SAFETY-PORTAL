"""v58.13.132lf — Pod-side NAS operations queue.

Bi-directional file API layered on top of the existing agent poll
tunnel (`.132kw`). The agent already polls `/api/backup/agent/pending`
every N seconds; we piggyback new NAS operations on that same poll
response and receive results via a new `/api/backup/agent/nas-op-result`
endpoint.

Rationale: the UGREEN NAS agent runs behind NAT and has no inbound
port. A true bi-directional tunnel would need WebSockets; deferred to
Phase 2a.1. For now, the poll-based queue-and-drain pattern gives us
identical semantics with a 0-60s worst-case latency (agent drains the
queue back-to-back until empty on each poll, then idles at
PANELTEC_POLL cadence).

Public surface (imported by `nas_client.py`):
    async def enqueue_op(op, path, body_b64=None, ttl_s=30) -> op_dict
    async def wait_for_result(op_id, timeout_s) -> op_dict
    async def next_ops_for_agent(agent_id, limit=8) -> list[op_dict]
    async def store_agent_result(op_id, agent_id, result) -> bool

Auth (belt-and-braces):
  · Agent token — existing sha256-hashed bearer token per agent.
  · HMAC-SHA256 signature over each op's canonical payload with
    `NAS_AGENT_SHARED_SECRET`. Agent verifies before executing.
    Protects against a compromised agent token being used to
    inject arbitrary NAS writes without also stealing the HMAC
    secret from the agent's docker-compose env.

Storage: MongoDB collection `nas_ops`, indexed on `(agent_id, status,
enqueued_at)`. Bounded-lifetime — rows self-expire after 24h via a
TTL index.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db import db

log = logging.getLogger("paneltec.nas")

_HMAC_SECRET_ENV = "NAS_AGENT_SHARED_SECRET"
_TTL_INDEX_NAME = "nas_ops_ttl"
_STATUS_INDEX_NAME = "nas_ops_agent_status"


# ── HMAC helpers ───────────────────────────────────────────────
def _canonical(op: str, path: str, body_b64: str, enqueued_at: str) -> bytes:
    """Deterministic byte-string that agent + pod both sign/verify.
    Order matters — keep it stable across pod restarts."""
    return f"{op}|{path}|{body_b64 or ''}|{enqueued_at}".encode("utf-8")


def _canonical_fetch(path: str, source_url: str, expected_sha256: str,
                       expected_size: int, enqueued_at: str) -> bytes:
    """v58.13.132lj — canonical for the streaming `fetch_and_put`
    op. Body bytes never appear in the signature or the JSON
    payload — instead we sign the source_url the agent will pull
    from, plus expected sha256 + size so the agent knows what it
    should end up with. Order: op|path|url|sha|size|enqueued_at."""
    return (
        f"fetch_and_put|{path}|{source_url}|{expected_sha256}|"
        f"{expected_size}|{enqueued_at}"
    ).encode("utf-8")


def _sign(payload: bytes) -> str:
    secret = os.environ.get(_HMAC_SECRET_ENV, "").strip()
    if not secret:
        raise RuntimeError(
            f"{_HMAC_SECRET_ENV} missing — set it in backend/.env "
            f"AND in the agent's docker-compose env"
        )
    return hmac.new(
        secret.encode("utf-8"), payload, hashlib.sha256
    ).hexdigest()


def verify_hmac(op: str, path: str, body_b64: str,
                  enqueued_at: str, expected: str) -> bool:
    """Constant-time compare. Use this in the agent's op-verify path."""
    try:
        actual = _sign(_canonical(op, path, body_b64, enqueued_at))
    except RuntimeError:
        return False
    return hmac.compare_digest(actual, expected)


# ── index bootstrap ────────────────────────────────────────────
async def ensure_indexes() -> None:
    # TTL — auto-purge rows 24h after `enqueued_at`.
    await db.nas_ops.create_index(
        [("enqueued_at_ts", 1)],
        name=_TTL_INDEX_NAME,
        expireAfterSeconds=24 * 3600,
    )
    await db.nas_ops.create_index(
        [("agent_id", 1), ("status", 1), ("enqueued_at", 1)],
        name=_STATUS_INDEX_NAME,
    )


# ── enqueue / wait / drain / result ────────────────────────────
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _default_agent_id() -> Optional[str]:
    """Pick the most-recently-seen agent as the target. In a
    single-site deployment (Paneltec) there's exactly one agent.
    If we ever multi-tenant this, callers will need to pass
    `agent_id` explicitly."""
    doc = await db.bk_agents.find_one(
        {}, {"_id": 0, "id": 1, "name": 1, "last_seen_at": 1},
        sort=[("last_seen_at", -1)],
    )
    return (doc or {}).get("id")


async def enqueue_op(
    op: str,
    path: str,
    body_b64: Optional[str] = None,
    agent_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Enqueue a single op and return the created row. Does NOT wait.

    Args:
        op:       one of `put_file` / `get_file` / `list_dir` /
                    `delete_file` / `stat` / `ping`.
        path:     NAS-relative path (e.g. `orgs/{org_id}/{...}`).
                    Enforced-server-side to sit under
                    `paneltec-files/` root by the agent.
        body_b64: base64 body bytes for `put_file`. None otherwise.
        agent_id: target agent (defaults to most-recent poller).
        meta:     optional dict to attach for observability.
    """
    aid = agent_id or await _default_agent_id()
    if not aid:
        raise RuntimeError(
            "no NAS agent registered — run the install flow first"
        )
    now = _now_iso()
    now_ts = datetime.now(timezone.utc)
    # v58.13.132lj — dispatch on op for the canonical signature.
    # `fetch_and_put` signs source_url + expected sha/size instead
    # of body_b64 (which is always empty for the streaming path).
    if op == "fetch_and_put":
        m = meta or {}
        signature = _sign(_canonical_fetch(
            path, m.get("source_url", ""),
            m.get("expected_sha256", ""),
            int(m.get("expected_size", 0)),
            now,
        ))
    else:
        signature = _sign(_canonical(op, path, body_b64 or "", now))
    doc = {
        "id": str(uuid.uuid4()),
        "agent_id": aid,
        "op": op,
        "path": path,
        "body_b64": body_b64,
        "hmac": signature,
        "meta": meta or {},
        "status": "queued",
        "result": None,
        "error": None,
        "enqueued_at": now,
        "enqueued_at_ts": now_ts,
        "picked_at": None,
        "finished_at": None,
    }
    await db.nas_ops.insert_one(doc)
    log.info("[nas-client] enqueued op=%s path=%s id=%s", op, path, doc["id"])
    return doc


async def wait_for_result(
    op_id: str,
    timeout_s: float = 30.0,
    poll_interval_s: float = 0.5,
) -> Dict[str, Any]:
    """Block until the op completes / errors / times out. Returns
    the final row. Never raises on timeout — check `status`."""
    deadline = time.time() + timeout_s
    while True:
        row = await db.nas_ops.find_one({"id": op_id}, {"_id": 0})
        if not row:
            return {"id": op_id, "status": "gone", "error": "row expired"}
        if row.get("status") in {"done", "error"}:
            return row
        if time.time() >= deadline:
            row["status"] = "timeout"
            return row
        await asyncio.sleep(poll_interval_s)


async def next_ops_for_agent(agent_id: str,
                              limit: int = 8) -> List[Dict[str, Any]]:
    """Called by the agent-pending handler. Atomically claims up to
    `limit` queued ops for this agent and flips them to `in_flight`.
    The op body includes the HMAC — agent MUST verify before executing."""
    claimed: List[Dict[str, Any]] = []
    # No need for a $findAndModify batch — small counts, low
    # contention (single agent).
    async for row in db.nas_ops.find(
        {"agent_id": agent_id, "status": "queued"},
        {"_id": 0},
        sort=[("enqueued_at", 1)],
    ).limit(limit):
        r = await db.nas_ops.update_one(
            {"id": row["id"], "status": "queued"},
            {"$set": {"status": "in_flight", "picked_at": _now_iso()}},
        )
        if r.modified_count == 1:
            row["status"] = "in_flight"
            claimed.append(row)
    return claimed


async def store_agent_result(
    op_id: str,
    agent_id: str,
    status: str,           # "done" | "error"
    result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
) -> bool:
    """Called by the agent-result endpoint. Marks the op as done/error.
    Returns True if the row was found and updated."""
    if status not in {"done", "error"}:
        raise ValueError(f"invalid status {status!r}")
    r = await db.nas_ops.update_one(
        {"id": op_id, "agent_id": agent_id,
         "status": {"$in": ["queued", "in_flight"]}},
        {"$set": {
            "status": status,
            "result": result,
            "error": error,
            "finished_at": _now_iso(),
        }},
    )
    return bool(r.modified_count)
