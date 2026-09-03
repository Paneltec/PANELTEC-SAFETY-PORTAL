"""v58.13.91 — Safe wrapper for /api/admin/* mutation endpoints.

The reason this exists — v58.13.78 pattern:
==========================================
Cloudflare returns 520 ("origin sent invalid response") when the
FastAPI process closes a connection with malformed / partial HTTP
headers. That happens when an unhandled exception escapes the
endpoint AFTER any bytes have been written to the socket, or when
a middleware upstream of FastAPI's default 500 handler crashes.

v58.13.78 fixed this for `/api/pre-starts` by wrapping `_list_impl`.
v58.13.91 generalises the pattern for every mutation endpoint under
`/api/admin/*` — the class of endpoint most likely to be caught in
the tail of a CF-fronted 520 loop when it fails.

Contract:
==========
* `HTTPException` passes through untouched — FastAPI needs those to
  produce the 4xx/423/etc. responses the frontend already renders.
* Any other `Exception` is caught, logged with:
    - endpoint name (function `__qualname__`)
    - request path
    - actor user id (best-effort, via `send_context` ContextVar)
    - error ref (uuid) — same ref returned to the client so support
      can grep the log
    - full stack trace
  and returned as a well-formed
    `JSONResponse(status_code=500, content={"detail": "internal_error",
                                            "error_ref": "<uuid>"})`.
* The wrapper never touches the response BODY on success — the
  endpoint's original return value is passed through.

Usage:
======
    from admin_safe_wrapper import safe_admin_endpoint

    @router.patch("/some-thing")
    @safe_admin_endpoint
    async def my_handler(...):
        ...

Order matters: `@safe_admin_endpoint` must go BELOW `@router.<verb>`
so it wraps the endpoint function BEFORE FastAPI's dependency
machinery inspects the signature. FastAPI reads
`__signature__`/`__wrapped__` via `functools.wraps`, so the wrapper
preserves the original signature and FastAPI still sees the correct
body / dependency annotations.
"""
from __future__ import annotations

import functools
import logging
import traceback
import types
import uuid
from typing import Any, Callable

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("paneltec.admin_safe")


def _actor_id_best_effort() -> str | None:
    """Try the v58.13.87 ContextVar first; fall back to `None` so the
    wrapper never itself raises. Import lazily to dodge any import
    cycle."""
    try:
        from send_context import get_send_context  # type: ignore
        ctx = get_send_context()
        if isinstance(ctx, dict):
            return ctx.get("id")
    except Exception:  # noqa: BLE001
        return None
    return None


def safe_admin_endpoint(func: Callable[..., Any]) -> Callable[..., Any]:
    """Wrap an /api/admin/* mutation endpoint in a top-level
    try/except that always returns a well-formed JSON response on
    unhandled exceptions. See module docstring for rationale."""

    async def _wrapped_body(*args: Any, **kwargs: Any):
        try:
            return await func(*args, **kwargs)
        except HTTPException:
            # v58.13.91 — Pass through untouched. FastAPI's default
            # handler renders these as the intended 4xx/423/etc.
            # responses; wrapping them would turn a 403 into a 500
            # and break the frontend's per-status branches.
            raise
        except Exception as exc:  # noqa: BLE001
            error_ref = uuid.uuid4().hex[:12]
            # Best-effort request/actor context — none of these
            # lookups may themselves raise, or we'd trip the same
            # CF 520 the wrapper is meant to prevent.
            path = None
            for a in args:
                if isinstance(a, Request):
                    path = a.url.path
                    break
            if path is None:
                req = kwargs.get("request")
                if isinstance(req, Request):
                    path = req.url.path
            actor_id = _actor_id_best_effort()
            log.error(
                "admin_endpoint_crash endpoint=%s path=%s actor=%s "
                "error_ref=%s exc=%s.%s: %s\n%s",
                getattr(func, "__qualname__", "<?>"),
                path or "<unknown>",
                actor_id or "<none>",
                error_ref,
                exc.__class__.__module__,
                exc.__class__.__qualname__,
                str(exc)[:500],
                traceback.format_exc(),
            )
            return JSONResponse(
                status_code=500,
                content={
                    "detail": "internal_error",
                    "error_ref": error_ref,
                    # Frontend can surface a short hint without leaking
                    # the stack. The full trace lives in the server log
                    # under this `error_ref` string.
                    "hint": "The server crashed while processing this admin action. "
                            f"Please contact support with error_ref={error_ref}.",
                },
            )

    # v58.13.91 — CRITICAL: FastAPI's `get_typed_signature()` resolves
    # string annotations (produced by `from __future__ import
    # annotations` in the wrapped module) via `eval(annotation,
    # callable.__globals__)`. If we just returned `_wrapped_body`,
    # `_wrapped_body.__globals__` would be THIS module's globals —
    # not the wrapped module's — so `body: SafeModeUpdate` would
    # fail to resolve and FastAPI would fall back to Query, 422'ing
    # every request. Same bug class as the v58.13.88 slowapi +
    # PEP 563 collision.
    #
    # Fix: create a new function with the SAME code object but a
    # MERGED globals dict — start from the wrapped function's
    # module globals (so FastAPI can resolve `SafeModeUpdate`,
    # `SessionTimeoutUpdate`, etc.), then layer on the names the
    # wrapper's code object actually references at runtime
    # (`uuid`, `traceback`, `Request`, `HTTPException`,
    # `JSONResponse`, `log`, `_actor_id_best_effort`).
    #
    # We build a fresh dict (never mutate `func.__globals__` — the
    # wrapped module's namespace is not ours to change).
    merged_globals = dict(func.__globals__)
    for _name in (
        "uuid", "traceback", "Request", "HTTPException",
        "JSONResponse", "log", "_actor_id_best_effort",
    ):
        merged_globals[_name] = globals()[_name]

    rebound = types.FunctionType(
        _wrapped_body.__code__,
        merged_globals,
        name=_wrapped_body.__name__,
        argdefs=_wrapped_body.__defaults__,
        closure=_wrapped_body.__closure__,
    )
    rebound.__kwdefaults__ = _wrapped_body.__kwdefaults__
    functools.update_wrapper(rebound, func)
    return rebound
