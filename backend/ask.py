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
from pymongo import ReturnDocument

from ai import CLAUDE_MODEL, _claude_json, _emergent_key
from auth import get_current_user
from permissions import require_module
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/ask", tags=["ask"], dependencies=[Depends(require_module("ask_intel"))])  # v160.0.9

# v159.1 — Ask Intelligence gate. Non-admin/hseq callers must have the
# `ask_intel` mobile module toggled on for their role. Admins bypass.
PRIVILEGED_ASK_ROLES = {"admin", "hseq_lead"}


async def require_ask_access(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") in PRIVILEGED_ASK_ROLES:
        return user
    doc = await db.org_settings.find_one(
        {"org_id": user["org_id"]}, {"_id": 0, "mobile_modules": 1},
    )
    row = (((doc or {}).get("mobile_modules") or {}).get(user.get("role") or "") or {})
    if not row.get("ask_intel"):
        raise HTTPException(403, "Permission denied: ask_intel module disabled for your role")
    return user


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
async def ask(body: AskIn, user: dict = Depends(require_ask_access)):
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
async def briefing(workspace_id: Optional[str] = Query(None), user: dict = Depends(require_ask_access)):
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


# ────────────────────── Ask suggested questions (CRUD) ──────────────────────

DEFAULT_SUGGESTIONS = [
    ("Which contractors have docs expiring this month?", "contractors"),
    ("What are the recurring incident categories last quarter?", "incidents"),
    ("Show me open hazards by severity.", "hazards"),
    ("Which inspections are overdue?", "inspections"),
]

WRITE_ROLES = {"admin", "hseq_lead"}


def _require_write(user: dict):
    if user.get("role") not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Permission denied: ask_suggestions.edit")


async def _seed_default_suggestions(org_id: str, created_by: str) -> None:
    """Lazy-seed the default suggestions for an org the first time the list is
    fetched and the collection has no active rows for that org."""
    has_any = await db.ask_suggestions.find_one(
        {"org_id": org_id, "deleted_at": None}, {"_id": 1}
    )
    if has_any:
        return
    docs = []
    for i, (question, category) in enumerate(DEFAULT_SUGGESTIONS):
        docs.append({
            "id": new_id(), "org_id": org_id,
            "question": question, "category": category,
            "sort_order": (i + 1) * 10,
            "created_at": now_iso(), "updated_at": now_iso(),
            "created_by": created_by, "deleted_at": None,
        })
    if docs:
        await db.ask_suggestions.insert_many(docs)


class SuggestionIn(BaseModel):
    question: str = Field(min_length=3, max_length=240)
    category: Optional[str] = Field(default=None, max_length=40)


class SuggestionPatch(BaseModel):
    question: Optional[str] = Field(default=None, min_length=3, max_length=240)
    category: Optional[str] = Field(default=None, max_length=40)
    sort_order: Optional[int] = Field(default=None, ge=0, le=100000)


def _serialise(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "question": doc["question"],
        "category": doc.get("category"),
        "sort_order": doc.get("sort_order", 0),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


@router.get("/suggestions")
async def list_suggestions(user: dict = Depends(require_ask_access)):
    await _seed_default_suggestions(user["org_id"], user["id"])
    cursor = db.ask_suggestions.find(
        {"org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    ).sort([("sort_order", 1), ("created_at", 1)])
    docs = await cursor.to_list(200)
    return [_serialise(d) for d in docs]


@router.post("/suggestions", status_code=201)
async def create_suggestion(body: SuggestionIn, user: dict = Depends(get_current_user)):
    _require_write(user)
    # Auto-increment sort_order: max existing + 10
    last = await db.ask_suggestions.find_one(
        {"org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "sort_order": 1},
        sort=[("sort_order", -1)],
    )
    next_order = ((last or {}).get("sort_order") or 0) + 10
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "question": body.question.strip(),
        "category": (body.category or "").strip() or None,
        "sort_order": next_order,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by": user["id"], "deleted_at": None,
    }
    await db.ask_suggestions.insert_one(doc)
    return _serialise(doc)


@router.patch("/suggestions/{suggestion_id}")
async def update_suggestion(
    suggestion_id: str,
    body: SuggestionPatch,
    user: dict = Depends(get_current_user),
):
    _require_write(user)
    update: dict = {"updated_at": now_iso()}
    if body.question is not None:
        update["question"] = body.question.strip()
    if body.category is not None:
        update["category"] = body.category.strip() or None
    if body.sort_order is not None:
        update["sort_order"] = int(body.sort_order)
    if len(update) == 1:
        raise HTTPException(status_code=400, detail="No editable fields supplied")
    result = await db.ask_suggestions.find_one_and_update(
        {"id": suggestion_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": update},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return _serialise(result)


@router.delete("/suggestions/{suggestion_id}", status_code=204)
async def delete_suggestion(
    suggestion_id: str,
    user: dict = Depends(get_current_user),
):
    _require_write(user)
    result = await db.ask_suggestions.update_one(
        {"id": suggestion_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": now_iso(), "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return None
