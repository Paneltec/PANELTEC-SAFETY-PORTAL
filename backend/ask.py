"""Ask Intelligence — Claude Sonnet 4.5 with grounded evidence over org records.

Evidence bundle: last 90 days of incidents, open hazards, recent SWMS, inspection
corrective-actions, plus contractor compliance summary. Capped to ~30 per entity.
"""
from __future__ import annotations
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ai import CLAUDE_MODEL, _claude_json, _emergent_key
from auth import get_current_user
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/ask", tags=["ask"])

_briefing_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL = 3600  # 1 hour

ASK_SYSTEM = """You are Paneltec Civil's compliance analyst. Answer the user's question
ONLY using the JSON evidence bundle provided in the user message. Cite specific
record IDs and titles inline. If the evidence does not support an answer, say so.

You MUST respond with ONLY this JSON shape (no prose, no fences):
{
  "title": "...",
  "body": "...",
  "confidence": "high|medium|low",
  "cited_evidence": [
    { "record_type": "incident|hazard|swms|inspection|contractor",
      "record_id": "...", "label": "..." }
  ]
}
Keep body to 2-4 sentences. Pick 2-5 cited records.
"""


class AskIn(BaseModel):
    question: str = Field(min_length=3)
    workspace_id: Optional[str] = None


async def _evidence(org_id: str, workspace_id: Optional[str]) -> dict:
    ninety_days_ago = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    ws_filter: dict = {}
    if workspace_id:
        ws_filter["workspace_id"] = workspace_id

    def base(extra=None):
        q = {"org_id": org_id, "deleted_at": None, **ws_filter}
        if extra:
            q.update(extra)
        return q

    incidents = await db.incidents.find(base({"occurred_at": {"$gte": ninety_days_ago}}),
                                        {"_id": 0, "id": 1, "title": 1, "category": 1,
                                         "occurred_at": 1, "description": 1, "follow_up_status": 1}).limit(30).to_list(30)
    hazards = await db.hazards.find(base({"status": {"$in": ["open", "in_progress"]}}),
                                    {"_id": 0, "id": 1, "title": 1, "severity": 1,
                                     "controls": 1, "status": 1}).limit(30).to_list(30)
    swms = await db.swms.find(base(),
                              {"_id": 0, "id": 1, "title": 1, "status": 1, "updated_at": 1}).sort("updated_at", -1).limit(30).to_list(30)
    inspections = await db.inspections.find(base(),
                                            {"_id": 0, "id": 1, "template_name": 1, "date": 1,
                                             "corrective_actions": 1}).sort("date", -1).limit(20).to_list(20)
    contractors = await db.contractors.find({"org_id": org_id, "deleted_at": None},
                                            {"_id": 0, "id": 1, "name": 1, "status": 1, "documents": 1}).limit(30).to_list(30)
    # compress contractor docs to status counts
    for c in contractors:
        docs = c.get("documents") or []
        c["doc_counts"] = {
            "valid": sum(1 for d in docs if d.get("status") == "valid"),
            "expiring_soon": sum(1 for d in docs if d.get("status") == "expiring_soon"),
            "expired": sum(1 for d in docs if d.get("status") == "expired"),
            "pending": sum(1 for d in docs if d.get("status") == "pending"),
        }
        c.pop("documents", None)

    return {
        "incidents": incidents, "hazards": hazards, "swms": swms,
        "inspections": inspections, "contractors": contractors,
    }


@router.post("")
async def ask(body: AskIn, user: dict = Depends(get_current_user)):
    evidence = await _evidence(user["org_id"], body.workspace_id)
    user_text = (f"Question: {body.question}\n\nEvidence (JSON):\n"
                 f"{json.dumps(evidence, ensure_ascii=False)[:24000]}")
    answer = await _claude_json(ASK_SYSTEM, user_text)
    answer.setdefault("title", "Answer")
    answer.setdefault("body", "")
    answer.setdefault("confidence", "medium")
    answer.setdefault("cited_evidence", [])

    # Store in history (best-effort)
    await db.ask_history.insert_one({
        "id": new_id(), "org_id": user["org_id"], "user_id": user["id"],
        "question": body.question, "workspace_id": body.workspace_id,
        "answer": answer, "created_at": now_iso(),
    })
    return answer


@router.get("/briefing")
async def briefing(workspace_id: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    cache_key = f"{user['org_id']}::{workspace_id or '*'}"
    now = time.time()
    if cache_key in _briefing_cache:
        ts, val = _briefing_cache[cache_key]
        if now - ts < CACHE_TTL:
            return val

    question = "What most needs management attention this week, what should we do, and what evidence proves it?"
    evidence = await _evidence(user["org_id"], workspace_id)
    user_text = (f"Question: {question}\n\nEvidence (JSON):\n"
                 f"{json.dumps(evidence, ensure_ascii=False)[:24000]}")
    try:
        answer = await _claude_json(ASK_SYSTEM, user_text)
    except HTTPException:
        # Fall back gracefully — caller will still get a useful payload
        answer = {
            "title": "Briefing temporarily unavailable",
            "body": "The AI briefing service is busy. Try again in a minute.",
            "confidence": "low", "cited_evidence": [], "fallback": True,
        }
    answer.setdefault("cited_evidence", [])
    answer["cached_at"] = now_iso()
    _briefing_cache[cache_key] = (now, answer)
    return answer


@router.get("/history")
async def history(limit: int = Query(10, ge=1, le=50), user: dict = Depends(get_current_user)):
    docs = await db.ask_history.find(
        {"org_id": user["org_id"], "user_id": user["id"]},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)
    return docs
