"""Permission enforcement middleware — checks path + method against the
permissions matrix without touching individual route handlers.

This complements the explicit `require_permission(...)` deps used in crud.py,
users.py and email_outbox.py. Anything that's covered there can be left as-is;
this middleware just adds a safety net for the modules we don't want to patch
inline (contractors, renewals, exports, integrations).
"""
from __future__ import annotations
import re
from typing import Optional

import jwt
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from auth import JWT_ALGORITHM, _secret
from db import db
from permissions import _get_overrides, _role_default, PERMISSIONS_SCHEMA

# Map URL prefixes (under /api) to permission resource keys.
PATH_RESOURCE: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^/api/swms(/|$)"),          "swms"),
    (re.compile(r"^/api/pre-starts(/|$)"),    "pre_starts"),
    (re.compile(r"^/api/site-diary(/|$)"),    "site_diary"),
    (re.compile(r"^/api/hazards(/|$)"),       "hazards"),
    (re.compile(r"^/api/incidents(/|$)"),     "incidents"),
    (re.compile(r"^/api/inspections(/|$)"),   "inspections"),
    (re.compile(r"^/api/contractors(/|$)"),   "contractors"),
    (re.compile(r"^/api/renewals(/|$)"),      "renewals"),
    (re.compile(r"^/api/audit-exports(/|$)"), "audit_exports"),
    (re.compile(r"^/api/integrations(/|$)"),  "integrations"),
    (re.compile(r"^/api/users(/|$)"),         "users"),
]

# Routes that already self-enforce or are public.
SKIP_PATHS: list[re.Pattern] = [
    re.compile(r"^/api/auth(/|$)"),
    re.compile(r"^/api/health$"),
    re.compile(r"^/api/whoami$"),
    re.compile(r"^/api/openapi\.json$"),
    re.compile(r"^/api/renew/"),            # public renewal page
    re.compile(r"^/api/files/"),            # public uploads
    re.compile(r"^/api/ask(/|$)"),          # ask intelligence (own checks)
    re.compile(r"^/api/dashboard(/|$)"),    # metrics — open to any logged-in user
    re.compile(r"^/api/email(/|$)"),        # email module enforces itself
    re.compile(r"^/api/ai(/|$)"),
    re.compile(r"^/api/document-library(/|$)"),  # gates writes inside the router
    # Suppliers (Simpro vendor view): readable for everyone, writes gated by
    # the route handlers themselves (`_require_write` and `require_roles`).
    re.compile(r"^/api/suppliers(/|$)"),
    re.compile(r"^/api/integrations/simpro/suppliers(/|$)"),
]


def _resource_for(path: str) -> Optional[str]:
    for pattern in SKIP_PATHS:
        if pattern.search(path):
            return None
    for pattern, resource in PATH_RESOURCE:
        if pattern.search(path):
            return resource
    return None


def _action_for(method: str) -> str:
    return "view" if method.upper() == "GET" else "edit"


async def _user_from_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    return await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})


class PermissionsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # OPTIONS preflight — let CORS handle it.
        if request.method == "OPTIONS":
            return await call_next(request)
        resource = _resource_for(path)
        if not resource:
            return await call_next(request)
        # Need a logged-in user. If no token, let the route's own auth dep reply 401.
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return await call_next(request)
        user = await _user_from_token(auth[7:])
        if not user:
            return await call_next(request)
        action = _action_for(request.method)
        overrides = await _get_overrides(user["id"])
        res_over = overrides.get(resource) or {}
        if action in res_over:
            allowed = bool(res_over[action])
        else:
            allowed = _role_default(user["role"], resource, action)
        if action == "email" and not PERMISSIONS_SCHEMA[resource]["email_supported"]:
            allowed = False
        if not allowed:
            return JSONResponse(
                status_code=403,
                content={"detail": f"Permission denied: {resource}.{action}"},
            )
        return await call_next(request)
