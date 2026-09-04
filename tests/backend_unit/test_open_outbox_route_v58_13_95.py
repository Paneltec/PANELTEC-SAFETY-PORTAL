"""v58.13.95 — "Open Outbox" CTA route fix.

Root cause: `CommsSafeMode.jsx` linked "Open Outbox" to
`/app/email/outbox`, a route that has never been registered in
`App.js`. React Router's catch-all bounced the unknown path to `/`,
which for a mid-hydration session lands on Cover/Login — the
"takes me to a new login" symptom.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

SAFE_MODE_JSX = (FRONTEND / "src" / "pages" / "CommsSafeMode.jsx").read_text(encoding="utf-8")
APP_JS = (FRONTEND / "src" / "App.js").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


def test_open_outbox_cta_uses_canonical_route():
    """The Open Outbox CTA links to the real `/app/outbox` route."""
    m = re.search(
        r'<Link\s+to="([^"]+)"\s+data-testid="open-outbox-cta"',
        SAFE_MODE_JSX,
    )
    assert m, "open-outbox-cta Link not found"
    assert m.group(1) == "/app/outbox", (
        f"open-outbox-cta links to {m.group(1)!r} — expected "
        f"/app/outbox. Anything else falls into the catch-all "
        f"`<Route path='*'>` and redirects users to Cover/Login."
    )


def test_no_stale_email_outbox_path_anywhere_in_frontend():
    """Belt-and-braces: no ACTIVE routing construct in `frontend/src`
    may reference the phantom `/app/email/outbox` path. Historical
    references in the `version.js` changelog block (which
    intentionally cites the broken path as part of the fix
    narrative) are exempt — they are prose, not routing."""
    # Match actual routing constructs: `<Link to="/app/email/outbox"`,
    # `to="/app/email/outbox"` in NavLink/Navigate, `navigate("/app/
    # email/outbox")`, `href="/app/email/outbox"`.
    active_patterns = [
        r'\bto="/app/email/outbox"',
        r"\bto='/app/email/outbox'",
        r'\bnavigate\(\s*[\'"]/app/email/outbox[\'"]\s*[,)]',
        r'\bhref="/app/email/outbox"',
        r'\bpath="/app/email/outbox"',
    ]
    hits = []
    src = FRONTEND / "src"
    for path in list(src.rglob("*.jsx")) + list(src.rglob("*.js")):
        if not path.is_file():
            continue
        s = path.read_text(encoding="utf-8", errors="ignore")
        for pat in active_patterns:
            if re.search(pat, s):
                hits.append(f"{path.relative_to(ROOT)}: matches {pat}")
                break
    assert not hits, (
        f"`/app/email/outbox` is not a registered route. Found "
        f"active routing references in: {hits}"
    )


def test_canonical_outbox_route_is_registered():
    """`/app/outbox` is registered in App.js and mounts <Outbox />."""
    assert re.search(
        r'<Route\s+path="outbox"\s+element=\{<Outbox\s*/>\}',
        APP_JS,
    ), "canonical outbox route is missing from App.js"


# ── Version-sync forward-safe pin >= 95 ─────────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_95():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 95


def test_cache_version_gte_95():
    assert _tail(SW_JS, "CACHE_VERSION") >= 95


def test_mobile_bundle_version_gte_95():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 95
