"""v58.13.87 — Belt-and-braces outbound-send gate.

Populated by `auth.get_current_user()` on every authenticated HTTP
request. `graph_send_mail()` / `safe_send_sms()` / `tm_send` refuse
to fire if the contextvar is empty — meaning no request context is
on the stack (startup task, worker, cron, scheduler, background
task, seed, test fixture, etc.).

This is the iron-clad rule: **no outbound comm leaves the codebase
without a live authenticated HTTP request on the call stack.**

Design:
  · ContextVar is set inside `get_current_user`, which is a FastAPI
    dependency. Its value scopes to the request task via
    contextvars' per-task inheritance, so all `await`ed code
    reached from that request sees it.
  · `asyncio.create_task(...)` copies the ambient context by
    default — so a task spawned FROM an HTTP handler carries the
    request's user through. That's the correct behaviour: an admin
    click can legitimately fan out to background work.
  · Startup hooks, APScheduler jobs, and standalone scripts run
    OUTSIDE any request context — their contextvar is None. Sends
    from those paths are refused.
  · Pytest sets nothing — pytest tests that need to send must
    call `set_send_context({"id":..., "org_id":...})` explicitly.
"""
from __future__ import annotations
import contextvars
import logging
import traceback
from typing import Optional

log = logging.getLogger("paneltec.send_context")

# ContextVar storing the current authenticated user dict during a
# live HTTP request. `None` means "no request context on the stack".
_current_user_for_sends: contextvars.ContextVar[Optional[dict]] = (
    contextvars.ContextVar("_current_user_for_sends", default=None)
)


def set_send_context(user: Optional[dict]) -> None:
    """Called from `auth.get_current_user()` on every successful auth.
    Tests can also call this to simulate an HTTP request context."""
    _current_user_for_sends.set(user)


def get_send_context() -> Optional[dict]:
    """Returns the user dict set by the current request, or None."""
    return _current_user_for_sends.get()


def has_request_context() -> bool:
    """True iff a live authenticated HTTP request is on the stack."""
    return _current_user_for_sends.get() is not None


def refuse_if_no_request_context(*, provider: str, to, subject: str = "") -> Optional[dict]:
    """Called by `graph_send_mail` / `safe_send_sms` / `tm_send` at the
    top. Returns the standard "blocked" shape when there's no request
    context so callers can short-circuit; returns None to signal the
    send should proceed.

    Also logs at CRITICAL with a full traceback so ops can trace any
    unauthorised send attempts in production.
    """
    if has_request_context():
        return None
    log.critical(
        "SEND REFUSED — no request context. provider=%s to=%s subject=%r\n"
        "stack:\n%s",
        provider, to, (subject or "")[:100],
        "".join(traceback.format_stack(limit=12)),
    )
    return {
        "ok": False,
        "blocked": True,
        "error": "no_request_context",
        "provider": provider,
    }
