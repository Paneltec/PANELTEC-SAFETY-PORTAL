"""AI endpoints via emergentintegrations (Claude Sonnet 4.5).

Three endpoints:
  POST /api/ai/swms-draft      — structured SWMS JSON from job description
  POST /api/ai/diary-structure — structured site diary JSON from raw notes
  POST /api/ai/hazard-vision   — classify a hazard photo (multipart upload)

All return strict JSON. On any LLM failure we raise 503 — the frontend then
falls back to manual entry.
"""
import base64
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Form
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

from auth import get_current_user
from models import DiaryStructureIn, SwmsDraftIn

router = APIRouter(prefix="/ai", tags=["ai"])

CLAUDE_MODEL = "claude-sonnet-4-5-20250929"
UPLOAD_DIR = Path(__file__).parent / "uploads" / "hazards"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def _emergent_key() -> str:
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Emergent LLM key not configured")
    return key


async def _claude_json(system: str, user_text: str, image_b64: Optional[str] = None,
                       image_mime: str = "image/jpeg") -> dict:
    """Call Claude Sonnet 4.5 and parse strict JSON from its reply."""
    chat = LlmChat(
        api_key=_emergent_key(),
        session_id=str(uuid.uuid4()),
        system_message=system,
    ).with_model("anthropic", CLAUDE_MODEL)

    file_contents = []
    if image_b64:
        file_contents.append(ImageContent(image_base64=image_b64))

    msg = UserMessage(text=user_text, file_contents=file_contents or None)
    try:
        reply = await chat.send_message(msg)
    except Exception as exc:  # pragma: no cover - network failure path
        raise HTTPException(status_code=503, detail=f"LLM call failed: {exc}") from exc

    text = reply if isinstance(reply, str) else getattr(reply, "content", str(reply))
    # Try direct JSON, then a fenced ```json block, then any {...} blob.
    for candidate in (text, *(m.group(1) for m in JSON_FENCE_RE.finditer(text))):
        try:
            return json.loads(candidate)
        except Exception:
            continue
    brace = re.search(r"\{.*\}", text, re.DOTALL)
    if brace:
        try:
            return json.loads(brace.group(0))
        except Exception:
            pass
    raise HTTPException(status_code=503, detail=f"AI returned non-JSON output: {text[:200]}")


SWMS_SYSTEM = """You are an expert Australian WHS (Work Health & Safety) consultant for civil construction.
Given a plain-English job description, draft a Safe Work Method Statement (SWMS) as STRICT JSON.

You MUST respond with ONLY a JSON object — no prose, no markdown fences, no explanations.
The JSON schema is exactly:
{
  "tasks": [ { "step": "1", "description": "..." }, ... ],
  "hazards": [ { "label": "...", "risk": "low|medium|high" }, ... ],
  "controls": [ { "label": "...", "method": "elimination|substitution|engineering|administrative|ppe" }, ... ],
  "ppe": [ "hard hat", "hi-vis", ... ]
}
Aim for 4-7 tasks, 4-7 hazards, 4-8 controls, 4-6 PPE items.
Use Australian WHS terminology (SafeWork NSW / Comcare).
"""


@router.post("/swms-draft")
async def swms_draft(body: SwmsDraftIn, user: dict = Depends(get_current_user)):
    user_text = f"Job description: {body.job_description}"
    if body.location:
        user_text += f"\nLocation/context: {body.location}"
    data = await _claude_json(SWMS_SYSTEM, user_text)
    # normalise shape
    data.setdefault("tasks", [])
    data.setdefault("hazards", [])
    data.setdefault("controls", [])
    data.setdefault("ppe", [])
    return data


DIARY_SYSTEM = """You are a site-diary AI for civil construction. Convert raw site notes
into STRICT JSON with this schema (no markdown, no prose, no fences):
{
  "activities": [ "..." ],
  "delays": [ "..." ],
  "deliveries": [ "..." ],
  "visitors": [ "..." ],
  "weather": "string description",
  "safety_observations": [ "..." ]
}
If a section has no content, return an empty array (or empty string for weather).
"""


@router.post("/diary-structure")
async def diary_structure(body: DiaryStructureIn, user: dict = Depends(get_current_user)):
    data = await _claude_json(DIARY_SYSTEM, f"Raw site notes:\n{body.raw_notes}")
    for k in ("activities", "delays", "deliveries", "visitors", "safety_observations"):
        data.setdefault(k, [])
    data.setdefault("weather", "")
    return data


HAZARD_SYSTEM = """You are a workplace-safety vision AI for Australian civil construction.
Look at the image and identify any visible hazards. Return STRICT JSON only (no prose, no fences):
{
  "identified_hazards": [ "..." ],
  "suggested_controls": [ "..." ],
  "severity": "low|medium|high|critical",
  "summary": "one-sentence plain-English summary"
}
Pick severity conservatively — if a person could be seriously injured, choose 'high' or 'critical'.
"""


@router.post("/hazard-vision")
async def hazard_vision(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 8MB)")

    # Save to disk so we can serve back via /api/files/hazards/<name>
    ext = (Path(file.filename or "photo.jpg").suffix or ".jpg").lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        ext = ".jpg"
    name = f"{uuid.uuid4()}{ext}"
    save_path = UPLOAD_DIR / name
    save_path.write_bytes(raw)
    photo_url = f"/api/files/hazards/{name}"

    mime = file.content_type or "image/jpeg"
    b64 = base64.b64encode(raw).decode("ascii")

    analysis = await _claude_json(
        HAZARD_SYSTEM,
        "Analyse the attached hazard photo and respond with JSON only.",
        image_b64=b64,
        image_mime=mime,
    )
    analysis.setdefault("identified_hazards", [])
    analysis.setdefault("suggested_controls", [])
    analysis.setdefault("severity", "medium")
    analysis.setdefault("summary", "")
    analysis["photo_url"] = photo_url
    return analysis
