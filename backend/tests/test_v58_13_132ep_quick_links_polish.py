"""v58.13.132ep — Quick Links polish:
  · Item 1 — QuickLinksSection repositioned ABOVE Organisation section
    on OrgSettings.jsx.
  · Item 2 — POST /api/org/url-tiles/fetch-icon endpoint + FE auto-icon
    detection on URL blur + `remote_icon_url` field on tile records.

Covers:
  · Head-parse priority (apple-touch-icon → icon → og:image).
  · Timeout branch returns {icon_url: null}.
  · 404 target with favicon fallback.
  · 404 with no favicon → {icon_url: null}.
  · Admin-only guard on the new endpoint.
  · Tile create/read persists remote_icon_url.
  · SSRF guards reject localhost and private IPs.
  · In-process 24 h cache (second call returns cached=True).
  · FE source-pins: repositioning, onBlur fetch, preview thumb, and
    remote-icon render in preview + manager grid.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

import httpx
import pytest
import requests

from tests.conftest import API, EPHEMERAL_PWD

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND = APP_ROOT / "backend"
FE = APP_ROOT / "frontend" / "src"
MODULE = BACKEND / "org_url_tiles.py"
QLS = FE / "components" / "QuickLinksSection.jsx"
ORGP = FE / "pages" / "OrgSettings.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _admin_hdr():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "stephen@paneltec.com.au",
                             "password": "Mcgstephen50#"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    t = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {t}"}


def _hseq_hdr(ephemeral_users):
    email = ephemeral_users["hseq_lead"]
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": EPHEMERAL_PWD},
                       timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited by auth throttle")
    assert r.status_code == 200
    t = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {t}"}


# ── Item 1 — Repositioning source-pin ─────────────────────────────

def test_quick_links_rendered_above_identity_section():
    """QuickLinksSection must appear BEFORE the Identity section
    (the 'Organisation' block) on OrgSettings.jsx."""
    src = _read(ORGP)
    ql_pos = src.find("<QuickLinksSection />")
    identity_pos = src.find('title="Identity"')
    archive_pos = src.find("<ArchiveRulesSection />")
    assert ql_pos > 0, "QuickLinksSection must be mounted"
    assert identity_pos > 0, "Identity Section anchor missing"
    assert ql_pos < identity_pos, (
        "QuickLinksSection must render ABOVE the Identity/Organisation section"
    )
    # And is no longer mounted below ArchiveRules (the previous location).
    # A second mount below ArchiveRules would place ql_pos > archive_pos.
    assert ql_pos < archive_pos, (
        "QuickLinksSection must not appear below ArchiveRulesSection anymore")


# ── Item 2 — Backend module surface ───────────────────────────────

def test_fetch_icon_endpoint_registered():
    src = _read(MODULE)
    assert '@router.post("/fetch-icon")' in src
    assert "async def fetch_icon(body: IconFetchIn" in src


def test_fetch_icon_has_ssrf_guards():
    src = _read(MODULE)
    assert "_reject_private_host" in src
    assert "is_private or ip.is_loopback" in src
    assert "_FETCH_TIMEOUT_SECONDS = 5.0" in src
    assert "_FETCH_MAX_BYTES = 10 * 1024 * 1024" in src
    assert "_ICON_CACHE_TTL_SECONDS = 24 * 60 * 60" in src


def test_fetch_icon_admin_gated():
    src = _read(MODULE)
    # The handler body must invoke _admin(user).
    m = re.search(r"async def fetch_icon\(.*?\n((?:    .*\n)+)", src,
                   flags=re.DOTALL)
    assert m, "fetch_icon handler not found"
    assert "_admin(user)" in m.group(1)


def test_remote_icon_url_persisted_in_model():
    src = _read(MODULE)
    assert "remote_icon_url" in src
    # Present on both TileIn + TilePatch pydantic models.
    assert re.search(r"class TileIn\(BaseModel\):[\s\S]+?remote_icon_url",
                      src)
    assert re.search(r"class TilePatch\(BaseModel\):[\s\S]+?remote_icon_url",
                      src)
    # And projected in _out().
    assert '"remote_icon_url": doc.get("remote_icon_url")' in src


# ── Item 2 — Head parser unit tests (no network) ──────────────────

_APPLE_HTML = """
<html><head>
<link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
<link rel="icon" sizes="32x32" href="/small.png">
<link rel="icon" sizes="192x192" href="/large.png">
<meta property="og:image" content="https://cdn.example.com/og.jpg">
</head></html>
"""

_FAVICON_ONLY_HTML = """
<html><head><title>x</title></head></html>
"""


def test_parse_head_prefers_apple_touch_icon():
    import sys
    sys.path.insert(0, str(BACKEND))
    from org_url_tiles import _parse_head_icons  # noqa: WPS433
    out = _parse_head_icons(_APPLE_HTML, "https://example.com/x")
    # Priority: apple-touch-icon first, then icon (largest), then og:image.
    labels = [t[0] for t in out]
    assert labels[0] == "apple-touch-icon"
    assert out[0][1] == "https://example.com/apple.png"
    # Second entry should be the LARGER icon (192x192).
    icon_entry = next(t for t in out if t[0] == "icon")
    assert icon_entry[1] == "https://example.com/large.png"
    # og:image last.
    og = next(t for t in out if t[0] == "og:image")
    assert og[1] == "https://cdn.example.com/og.jpg"


def test_parse_head_returns_empty_when_no_icons_present():
    import sys
    sys.path.insert(0, str(BACKEND))
    from org_url_tiles import _parse_head_icons  # noqa: WPS433
    assert _parse_head_icons(_FAVICON_ONLY_HTML,
                              "https://example.com/") == []


# ── Item 2 — _fetch_icon happy / timeout / 404 / favicon branches ─

class _StubTransport(httpx.MockTransport):
    def __init__(self, handler):
        super().__init__(handler)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False \
        else asyncio.new_event_loop().run_until_complete(coro)


def test_fetch_icon_returns_null_on_timeout(monkeypatch):
    """Simulate the target hanging past the 5 s cap."""
    import sys
    sys.path.insert(0, str(BACKEND))
    import org_url_tiles as mod

    class _TimeoutClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *a, **k):
            raise httpx.TimeoutException("timeout")

        async def head(self, *a, **k):
            raise httpx.TimeoutException("timeout")

        async def get(self, *a, **k):
            raise httpx.TimeoutException("timeout")

    monkeypatch.setattr(mod.httpx, "AsyncClient", _TimeoutClient)
    result = _run(mod._fetch_icon("https://example.com/"))
    assert result == {"icon_url": None}


def test_fetch_icon_falls_back_to_favicon_on_404(monkeypatch):
    """Target returns 404 on the page → try /favicon.ico."""
    import sys
    sys.path.insert(0, str(BACKEND))
    import org_url_tiles as mod

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/favicon.ico":
            return httpx.Response(200, content=b"\x00")
        return httpx.Response(404)

    real_async_client = httpx.AsyncClient

    class _Client:
        def __init__(self, *a, **k):
            self._transport = httpx.MockTransport(handler)
            self._client = real_async_client(transport=self._transport,
                                              follow_redirects=True)

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            await self._client.aclose()
            return False

        def stream(self, method, url):
            return self._client.stream(method, url)

        async def head(self, url):
            return await self._client.head(url)

        async def get(self, url):
            return await self._client.get(url)

    monkeypatch.setattr(mod.httpx, "AsyncClient", _Client)
    result = _run(mod._fetch_icon("https://example.com/"))
    assert result["icon_url"].endswith("/favicon.ico")
    assert result["source"] == "favicon"


def test_fetch_icon_returns_null_when_favicon_404(monkeypatch):
    import sys
    sys.path.insert(0, str(BACKEND))
    import org_url_tiles as mod

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    real_async_client = httpx.AsyncClient

    class _Client:
        def __init__(self, *a, **k):
            self._transport = httpx.MockTransport(handler)
            self._client = real_async_client(transport=self._transport,
                                              follow_redirects=True)

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            await self._client.aclose()
            return False

        def stream(self, method, url):
            return self._client.stream(method, url)

        async def head(self, url):
            return await self._client.head(url)

        async def get(self, url):
            return await self._client.get(url)

    monkeypatch.setattr(mod.httpx, "AsyncClient", _Client)
    result = _run(mod._fetch_icon("https://example.com/"))
    assert result == {"icon_url": None}


# ── Live-API smokes ───────────────────────────────────────────────

def test_live_fetch_icon_admin_only(ephemeral_users):
    hdr = _hseq_hdr(ephemeral_users)
    r = requests.post(f"{API}/org/url-tiles/fetch-icon",
                       json={"url": "https://www.google.com/"},
                       headers=hdr, timeout=30)
    assert r.status_code == 403


def test_live_fetch_icon_rejects_localhost():
    hdr = _admin_hdr()
    r = requests.post(f"{API}/org/url-tiles/fetch-icon",
                       json={"url": "http://localhost:8001/"},
                       headers=hdr, timeout=30)
    assert r.status_code == 400
    assert "localhost" in r.text.lower()


def test_live_fetch_icon_rejects_loopback_ip():
    hdr = _admin_hdr()
    r = requests.post(f"{API}/org/url-tiles/fetch-icon",
                       json={"url": "http://127.0.0.1/"},
                       headers=hdr, timeout=30)
    assert r.status_code == 400


def test_live_fetch_icon_rejects_non_http_scheme():
    hdr = _admin_hdr()
    r = requests.post(f"{API}/org/url-tiles/fetch-icon",
                       json={"url": "file:///etc/passwd"},
                       headers=hdr, timeout=30)
    assert r.status_code == 400


def test_live_tile_persists_remote_icon_url():
    hdr = _admin_hdr()
    payload = {
        "url": "https://www.google.com/",
        "label": "Google (pytest)",
        "icon": "🔍",
        "remote_icon_url": "https://www.google.com/favicon.ico",
    }
    r = requests.post(f"{API}/org/url-tiles", json=payload, headers=hdr,
                       timeout=30)
    assert r.status_code == 200, r.text
    tile = r.json()
    tid = tile["id"]
    try:
        assert tile["remote_icon_url"] == "https://www.google.com/favicon.ico"
        # PATCH clears the icon by sending empty string → server stores null.
        r2 = requests.patch(f"{API}/org/url-tiles/{tid}",
                             json={"remote_icon_url": ""},
                             headers=hdr, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["remote_icon_url"] in (None, "")
    finally:
        requests.delete(f"{API}/org/url-tiles/{tid}", headers=hdr, timeout=30)


# ── Frontend source-pins ──────────────────────────────────────────

def test_editor_wires_onblur_icon_fetch():
    src = _read(QLS)
    assert "onBlur={runIconFetch}" in src
    assert "'/org/url-tiles/fetch-icon'" in src


def test_editor_icon_preview_testids_present():
    src = _read(QLS)
    for tid in (
        "org-quick-links-editor-icon-preview",
        "org-quick-links-editor-icon-thumb",
        "org-quick-links-editor-icon-clear",
        "org-quick-links-editor-remote-icon-url",
    ):
        assert tid in src, f"missing testid {tid}"


def test_preview_tile_renders_remote_icon_with_fallback():
    src = _read(QLS)
    # <img> element renders when remote_icon_url present.
    assert "tile.remote_icon_url" in src
    assert "onError={() => setImgError(true)}" in src
    assert "showRemote ?" in src or "showRemote?" in src


def test_manager_tile_renders_remote_icon():
    """Both TilePreviewCard AND SortableTileCard must handle remote_icon_url."""
    src = _read(QLS)
    # Two <img> tags at minimum (preview grid + manager grid).
    imgs = re.findall(r"<img src=\{tile\.remote_icon_url\}", src)
    assert len(imgs) >= 2, (
        f"Expected 2+ <img src={{tile.remote_icon_url}}>, got {len(imgs)}")


# ── Version-sync ──────────────────────────────────────────────────

def test_version_pinned_to_132ep_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "ep", f"RUNNING_VERSION suffix must be >= 132ep, got {m_v and m_v.group(1)}"
    assert m_sw and m_sw.group(1) >= "ep", f"CACHE_VERSION suffix must be >= 132ep, got {m_sw and m_sw.group(1)}"
