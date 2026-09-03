"""v58.13.88 — Rate limiting for auth + bulk-import endpoints.

`slowapi` in-memory limiter. Keyed by `X-Forwarded-For` first (Emergent
edge always forwards) with `request.client.host` fallback. On 429:
returns `{ok:false, error:"rate_limit_exceeded", retry_after_seconds,
message}` + standard `Retry-After` header.

Redis upgrade path when we cluster the pod:
  `Limiter(key_func=_key, storage_uri="redis://...")`
"""
from __future__ import annotations
import logging
from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

log = logging.getLogger("paneltec.ratelimit")


def _ip_key(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return (request.client.host if request.client else "unknown")


def _user_or_ip_key(request: Request) -> str:
    # Bulk-import is authenticated so we can prefer user id, falling back
    # to IP if the token can't be decoded early (shouldn't happen — dep
    # runs first).
    user = getattr(request.state, "current_user", None) or {}
    return user.get("id") or _ip_key(request)


limiter = Limiter(key_func=_ip_key, default_limits=[])
user_limiter = Limiter(key_func=_user_or_ip_key, default_limits=[])


async def _429_response(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    detail = str(getattr(exc, "detail", "")) or ""
    # slowapi packages "N per M seconds" — derive Retry-After.
    retry_after = 60
    try:
        parts = detail.split()
        if "per" in parts:
            num = parts[parts.index("per") + 1]
            unit = parts[parts.index("per") + 2] if len(parts) > parts.index("per") + 2 else "minute"
            n = int(num)
            unit = unit.lower()
            retry_after = n if unit.startswith("second") else (
                n * 60 if unit.startswith("minute") else n * 3600
            )
    except Exception:  # noqa: BLE001
        pass
    log.info("rate_limit.429 path=%s key=%s detail=%s",
             request.url.path, _ip_key(request), detail)
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(retry_after)},
        content={
            "ok": False,
            "error": "rate_limit_exceeded",
            "retry_after_seconds": retry_after,
            "message": (
                f"You've made too many attempts. Try again in "
                f"{retry_after} seconds."
            ),
        },
    )
