"""Anthropic-backed replacement for emergentintegrations.llm.chat (self-hosting only)."""
from __future__ import annotations

import base64
import os
from typing import List, Optional

import httpx

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
MAX_TOKENS = int(os.environ.get("AI_MAX_TOKENS", "8000"))


class ImageContent:
    def __init__(self, image_base64: str):
        self.image_base64 = image_base64


class UserMessage:
    def __init__(self, text: str = "", file_contents: Optional[List[ImageContent]] = None):
        self.text = text
        self.file_contents = file_contents or []


def _media_type(b64: str) -> str:
    try:
        head = base64.b64decode(b64[:32] + "==")[:12]
    except Exception:  # noqa: BLE001
        return "image/jpeg"
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head.startswith(b"GIF8"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


class LlmChat:
    def __init__(self, api_key: Optional[str] = None, session_id: str = "",
                 system_message: str = ""):
        # The app passes EMERGENT_LLM_KEY; when self-hosting that holds your
        # own Anthropic key. ANTHROPIC_API_KEY wins if both are set.
        self.api_key = os.environ.get("ANTHROPIC_API_KEY") or api_key or ""
        self.system_message = system_message or ""
        self.model = os.environ.get("AI_MODEL", "claude-sonnet-4-5-20250929")
        self.history: list = []

    def with_model(self, provider: str, model: str) -> "LlmChat":
        if os.environ.get("AI_MODEL"):
            return self
        self.model = model
        return self

    async def send_message(self, message: UserMessage) -> str:
        if not self.api_key:
            raise RuntimeError("No AI key set. Add ANTHROPIC_API_KEY to the stack settings.")
        content: list = []
        for img in message.file_contents or []:
            b64 = img.image_base64.split(",", 1)[-1]
            content.append({"type": "image", "source": {
                "type": "base64", "media_type": _media_type(b64), "data": b64}})
        content.append({"type": "text", "text": message.text or ""})
        self.history.append({"role": "user", "content": content})
        body = {"model": self.model, "max_tokens": MAX_TOKENS, "messages": self.history}
        if self.system_message:
            body["system"] = self.system_message
        async with httpx.AsyncClient(timeout=180) as c:
            r = await c.post(ANTHROPIC_URL, json=body, headers={
                "x-api-key": self.api_key, "anthropic-version": ANTHROPIC_VERSION,
                "content-type": "application/json"})
        if r.status_code >= 400:
            raise RuntimeError(f"Anthropic API error {r.status_code}: {r.text[:300]}")
        data = r.json()
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        self.history.append({"role": "assistant", "content": text})
        return text
