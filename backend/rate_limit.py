"""v58.13.88 — Rate limiting for auth + bulk-import endpoints.

`slowapi` in-memory limiter. Keyed by `X-Forwarded-For` first (Emergent
edge always forwards) with `request.client.host` fallback. On 429:
returns `{ok:false, error:"rate_limit_exceeded", retry_after_seconds,
message}` + standard `Retry-After` header.

v58.13.109 — Test-mode bypass. When any of these signals is present at
module load, both `limiter` and `user_limiter` are flipped to
`enabled=False` — slowapi treats every `@limiter.limit(...)` decorator
as a pass-through so pytest and CI don't 429 on the 5/min login limit:

  • `TEST_MODE_BYPASS_RATE_LIMIT=true` — explicit opt-in from an
    ephemeral test runner or a local dev session that's replaying
    the login flow many times.
  • `ENV=test` — CI convention.
  • `PYTEST_CURRENT_TEST` — set by pytest itself for every collected
    test; catches ad-hoc `pytest` invocations that forgot the env
    var.

GUARDRAIL: If `ENV=prod` (or `IS_PROD=true`), bypass is REFUSED and
the module logs a critical warning even when the other signals are
present. Prod always rate-limits. There is no way to talk this out of
that stance — the guardrail is checked LAST so any conflicting env
combo (e.g. `ENV=prod` + `TEST_MODE_BYPASS_RATE_LIMIT=true`) still
lands on "prod wins".

Redis upgrade path when we cluster the pod:
  `Limiter(key_func=_key, storage_uri="redis://...")`
"""
from __future__ import annotations
import logging
import os
from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

log = logging.getLogger("paneltec.ratelimit")


def _is_prod() -> bool:
    """Prod-side detection. `ENV=prod` OR `IS_PROD=true` (matches the
    convention used by `integrations_textmagic.safe_send_sms` and the
    startup env-gate)."""
    env = (os.environ.get("ENV") or "").strip().lower()
    if env == "prod":
        return True
    return (os.environ.get("IS_PROD") or "").strip().lower() == "true"


def _bypass_signals_present() -> bool:
    """True when any test-mode signal is present. Prod guard NOT checked
    here — that's the caller's responsibility so the module-level init
    logs the guardrail-refused case explicitly."""
    if (os.environ.get("TEST_MODE_BYPASS_RATE_LIMIT") or "").strip().lower() == "true":
        return True
    if (os.environ.get("ENV") or "").strip().lower() == "test":
        return True
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    return False


def _resolve_bypass() -> bool:
    """Compose bypass decision. Prod always wins."""
    if not _bypass_signals_present():
        return False
    if _is_prod():
        log.critical(
            "rate_limit.bypass_refused_in_prod signals_present=true "
            "ENV=%r IS_PROD=%r — rate limits STAY ON.",
            os.environ.get("ENV"), os.environ.get("IS_PROD"),
        )
        return False
    log.info(
        "rate_limit.bypass_enabled reason=%s",
        "TEST_MODE_BYPASS_RATE_LIMIT" if (os.environ.get("TEST_MODE_BYPASS_RATE_LIMIT") or "").strip().lower() == "true"
        else "ENV=test" if (os.environ.get("ENV") or "").strip().lower() == "test"
        else "PYTEST_CURRENT_TEST",
    )
    return True


_BYPASS_ACTIVE = _resolve_bypass()


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


limiter = Limiter(key_func=_ip_key, default_limits=[], enabled=not _BYPASS_ACTIVE)
user_limiter = Limiter(key_func=_user_or_ip_key, default_limits=[], enabled=not _BYPASS_ACTIVE)


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
