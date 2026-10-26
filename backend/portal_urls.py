"""Deployment-specific URLs used by organisation settings and PDF reports."""
import os


def configured_portal_url() -> str:
    """Prefer an explicit public URL, then the self-hosted frontend settings.

    An unconfigured deployment has no report link; never send staff or
    report recipients to an unrelated development environment.
    """
    for name in ("PUBLIC_APP_URL", "FRONTEND_PUBLIC_URL", "PUBLIC_URL"):
        value = (os.environ.get(name) or "").strip().rstrip("/")
        if value:
            return value
    return ""


def report_portal_url(org: dict | None = None) -> str:
    """Keep the organisation's chosen report link ahead of server defaults."""
    return ((org or {}).get("portal_url") or "").strip().rstrip("/") or configured_portal_url()
