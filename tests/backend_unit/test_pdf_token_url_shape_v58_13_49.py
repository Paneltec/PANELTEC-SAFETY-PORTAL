"""v58.13.49 — CS Incidents PDF popup fix (URL-shape alignment).

Guards the fix by asserting the `POST /api/pdf-token` response now
returns a URL of the query-param shape (`/api/{path}/{id}/pdf?
token=<jwt>`) — same as the mirrored form_submission branch that has
been in production for months. Not the legacy JWT-in-path shape
(`/api/files/pdf/<jwt>.pdf`) which was empirically failing to render
inline in popups.
"""
from __future__ import annotations

import os
import sys
import re
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

_BACKEND = Path("/app/backend")
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

import pdf_routes  # noqa: E402


def _fake_request():
    req = MagicMock()
    req.headers = {"host": "example.com"}
    req.url = MagicMock(scheme="https", netloc="example.com")
    req.client = MagicMock()
    req.client.host = "1.2.3.4"
    return req


@pytest.mark.asyncio
async def test_mint_pdf_token_returns_query_param_url(monkeypatch):
    """Regression: the response `url` must be of the resource-path
    query-param shape, NOT the JWT-in-path shape.
    """
    # Mock db.<collection>.find_one to succeed.
    coll = MagicMock()
    coll.find_one = AsyncMock(return_value={"id": "cs-42"})

    class _DB:
        def __getitem__(self, name):
            return coll

    monkeypatch.setattr(pdf_routes, "db", _DB())
    monkeypatch.setattr(pdf_routes, "can",
                        AsyncMock(return_value=True))

    body = pdf_routes.PdfTokenIn(resource="cs_incidents",
                                  record_id="cs-42", action="view")
    user = {"id": "u-1", "org_id": "org-1"}
    result = await pdf_routes.mint_pdf_token(
        body=body, request=_fake_request(), user=user)

    assert "url" in result
    url = result["url"]
    # New query-param shape.
    assert "/api/cs-incidents/cs-42/pdf?token=" in url, (
        f"Expected query-param URL shape, got: {url}"
    )
    # NOT the legacy JWT-in-path shape.
    assert "/api/files/pdf/" not in url, (
        f"Legacy JWT-in-path URL shape leaked: {url}. v58.13.49 "
        "aligned this on the query-param shape."
    )
    # `path` mirrors `url` (minus host).
    assert result["path"].startswith("/api/cs-incidents/cs-42/pdf?token=")


@pytest.mark.asyncio
async def test_mint_pdf_token_download_action_carries_download_flag(monkeypatch):
    coll = MagicMock()
    coll.find_one = AsyncMock(return_value={"id": "h-1"})

    class _DB:
        def __getitem__(self, name):
            return coll

    monkeypatch.setattr(pdf_routes, "db", _DB())
    monkeypatch.setattr(pdf_routes, "can",
                        AsyncMock(return_value=True))

    body = pdf_routes.PdfTokenIn(resource="hazards",
                                  record_id="h-1", action="download")
    result = await pdf_routes.mint_pdf_token(
        body=body, request=_fake_request(),
        user={"id": "u-1", "org_id": "org-1"})

    assert re.search(r"\?token=[^&]+&download=1$", result["url"])


def test_legacy_jwt_in_path_endpoint_removed_v58_13_50():
    """v58.13.50 retired the legacy `/files/pdf/{token}.pdf` handler.
    All in-flight tokens minted before v58.13.49 have expired
    (90 s TTL), so no popup mid-deploy could still be pointing at it.
    Removing it shrinks the attack surface and eliminates the
    Cloudflare `.pdf`-in-path rendering regression once and for all.
    """
    routes = {r.path for r in pdf_routes.router.routes if hasattr(r, "path")}
    assert "/files/pdf/{token}.pdf" not in routes, (
        "Legacy `/files/pdf/{token}.pdf` endpoint reappeared — v58.13.50 "
        "retired it. If you need to reintroduce, document why the "
        "URL-shape mismatch from v58.13.49 has been resolved."
    )


def test_new_url_shape_hits_build_registered_route():
    """The query-param URL shape is served by `_build("cs_incidents",
    "cs-incidents")`. This test asserts the route is registered so
    a future refactor can't drop it and leave `mint_pdf_token`
    handing out 404 URLs."""
    routes = [r for r in pdf_routes.router.routes if hasattr(r, "path")]
    paths = {r.path for r in routes}
    assert "/cs-incidents/{record_id}/pdf" in paths, (
        "`_build('cs_incidents', 'cs-incidents')` no longer registered "
        "— mint_pdf_token would return URLs pointing at nothing."
    )
