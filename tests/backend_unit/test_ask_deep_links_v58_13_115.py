"""v58.13.115 — Ask Intelligence citation deep-link regression tests.

Locks:
  · `_build_deep_link` maps every supported record_type to a relative
    frontend path (parametrised matrix).
  · Unsupported record_types return `(None, "unknown_type")`.
  · `audit_log` returns `(None, "no_detail_page")`.
  · Missing record_id returns `(None, "missing_id")`.
  · `form_submission` uses the parent `template_id` from the evidence
    bundle; returns `(None, "no_template_id")` when unavailable.
  · `_enrich_citations` never mutates the incoming citation shape;
    it only appends `deep_link` + optional `deep_link_reason`.
  · Routes are backed by real registrations in `frontend/src/App.js`
    (spot-check for /app/swms/:id, /app/contractors/:id, and
    /app/admin/visitors).
  · Frontend `ProofChip` renders a `<Link>` when `deep_link` set,
    plain `<div>` with tooltip when null.
  · `AdminVisitors` reads `?open=<id>` on mount and opens the
    drawer via `setDrawerId`.
  · Version-sync forward-safe pin >= .115.
"""
from __future__ import annotations
import re
from pathlib import Path
import sys

import pytest

sys.path.insert(0, "/app/backend")


# ── Deep-link mapping matrix ────────────────────────────────────────
DEEP_LINK_CASES = [
    ("swms",           "s1",  "/app/swms/s1"),
    ("contractor",     "c1",  "/app/contractors/c1"),
    ("site_visitor",   "v1",  "/app/admin/visitors?open=v1"),
    ("incident",       "i1",  "/app/incidents?open=i1"),
    ("hazard",         "h1",  "/app/hazards?open=h1"),
    ("inspection",     "n1",  "/app/inspections?open=n1"),
    ("pre_start",      "p1",  "/app/pre-starts?open=p1"),
    ("site_diary",     "d1",  "/app/site-diary?open=d1"),
    ("user",           "u1",  "/app/settings/users?open=u1"),
    ("worker",         "w1",  "/app/settings/workers?open=w1"),
    ("outbound_email", "e1",  "/app/outbox?open=e1&kind=email"),
    ("outbound_sms",   "m1",  "/app/outbox?open=m1&kind=sms"),
]


@pytest.mark.parametrize("record_type,rid,expected", DEEP_LINK_CASES)
def test_deep_link_matrix(record_type, rid, expected):
    from ask import _build_deep_link
    link, reason = _build_deep_link(record_type, rid, {})
    assert link == expected, f"{record_type} → {link} (expected {expected})"
    assert reason is None


def test_deep_link_audit_log_null():
    from ask import _build_deep_link
    link, reason = _build_deep_link("audit_log", "a1", {})
    assert link is None
    assert reason == "no_detail_page"


def test_deep_link_missing_id():
    from ask import _build_deep_link
    link, reason = _build_deep_link("swms", "", {})
    assert link is None
    assert reason == "missing_id"


def test_deep_link_unknown_type():
    from ask import _build_deep_link
    link, reason = _build_deep_link("wombat", "x1", {})
    assert link is None
    assert reason == "unknown_type"


def test_deep_link_form_submission_needs_template_id():
    from ask import _build_deep_link
    # No matching row in the bundle — must be null with the exact reason.
    link, reason = _build_deep_link("form_submission", "f1", {"form_submissions": []})
    assert link is None
    assert reason == "no_template_id"
    # WITH the row in the bundle — links to /forms/templates/<template>/submissions.
    ev = {"form_submissions": [{"id": "f1", "template_id": "tmpl_xyz",
                                 "template_name_snapshot": "Daily Pre-Start"}]}
    link2, reason2 = _build_deep_link("form_submission", "f1", ev)
    assert link2 == "/app/forms/templates/tmpl_xyz/submissions?open=f1"
    assert reason2 is None


def test_deep_link_form_submission_missing_template_id_falls_back():
    """A row exists but has no template_id — must degrade to null (not crash)."""
    from ask import _build_deep_link
    ev = {"form_submissions": [{"id": "f2", "template_id": None,
                                 "template_name_snapshot": "?"}]}
    link, reason = _build_deep_link("form_submission", "f2", ev)
    assert link is None
    assert reason == "no_template_id"


# ── _enrich_citations behaviour ─────────────────────────────────────
def test_enrich_citations_shape():
    from ask import _enrich_citations
    cited = [
        {"record_type": "swms", "record_id": "s1", "label": "SWMS 1"},
        {"record_type": "audit_log", "record_id": "a1", "label": "Login by X"},
        {"record_type": "wombat", "record_id": "z1", "label": "Weird"},
    ]
    out = _enrich_citations(cited, {})
    assert len(out) == 3
    # Real link + no reason field.
    assert out[0]["deep_link"] == "/app/swms/s1"
    assert "deep_link_reason" not in out[0]
    # No detail page → reason surfaced.
    assert out[1]["deep_link"] is None
    assert out[1]["deep_link_reason"] == "no_detail_page"
    assert out[2]["deep_link"] is None
    assert out[2]["deep_link_reason"] == "unknown_type"
    # Original label + id preserved verbatim.
    for src, enr in zip(cited, out):
        assert enr["record_type"] == src["record_type"]
        assert enr["record_id"] == src["record_id"]
        assert enr["label"] == src["label"]


def test_enrich_citations_skips_non_dicts():
    from ask import _enrich_citations
    out = _enrich_citations([None, "junk", {"record_type": "swms", "record_id": "s1"}], {})
    assert len(out) == 1
    assert out[0]["deep_link"] == "/app/swms/s1"


# ── Route validity — spot check 3 mapped paths against App.js ───────
APP_JS = Path("/app/frontend/src/App.js").read_text()


@pytest.mark.parametrize("route_source_pattern", [
    r'path=[\'"]swms/:id[\'"]',
    r'path=[\'"]contractors/:id[\'"]',
    r'path=[\'"]admin/visitors[\'"]',
])
def test_deep_link_routes_registered_in_app_js(route_source_pattern):
    assert re.search(route_source_pattern, APP_JS), (
        f"Expected route registration missing in App.js: {route_source_pattern}"
    )


# ── Frontend ProofChip + AdminVisitors source-pins ──────────────────
ASK_JSX = Path("/app/frontend/src/pages/Ask.jsx").read_text()
VISITORS_JSX = Path("/app/frontend/src/pages/AdminVisitors.jsx").read_text()


def test_ask_page_renders_link_for_deep_link():
    # ProofChip wraps in <Link to={c.deep_link}> when deep_link truthy.
    assert "from 'react-router-dom'" in ASK_JSX
    assert re.search(r"<Link\s+to=\{c\.deep_link\}", ASK_JSX)


def test_ask_page_renders_plain_when_no_deep_link():
    # Fallback branch: div with `cursor-not-allowed` + tooltip logic.
    assert "cursor-not-allowed" in ASK_JSX
    assert "deep_link_reason" in ASK_JSX
    assert "no_detail_page" in ASK_JSX  # tooltip mapping


def test_history_panel_removed_in_115a():
    # v58.13.115a — Recent Questions panel removed. The `.115`
    # history-cites contract is superseded: fresh-answer citations
    # remain clickable, but there's no history panel to render them
    # into anymore.
    assert 'data-testid=`history-cites-' not in ASK_JSX
    assert '"Recent questions"' not in ASK_JSX
    assert "Recent questions" not in ASK_JSX
    # And the Clear-history control replaced it.
    assert 'data-testid="ask-clear-history"' in ASK_JSX


def test_visitors_reads_open_query_param():
    assert "useSearchParams" in VISITORS_JSX
    assert re.search(r"searchParams\.get\(['\"]open['\"]\)", VISITORS_JSX)
    # On open param present → setDrawerId + strip param from URL.
    assert "setDrawerId(openParam)" in VISITORS_JSX
    assert 'next.delete(\'open\')' in VISITORS_JSX or 'next.delete("open")' in VISITORS_JSX


# ── Version sync forward-safe pin ────────────────────────────────────
_VERSION_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def test_version_bumps_meet_115():
    for label, path in (
        ("frontend/version.js", "/app/frontend/src/lib/version.js"),
        ("service-worker.js", "/app/frontend/public/service-worker.js"),
        ("mobile/version.ts", "/app/mobile/src/lib/version.ts"),
    ):
        blob = Path(path).read_text()
        tails = [(int(m.group(1)), m.group(2))
                 for m in _VERSION_TAIL_RE.finditer(blob)]
        assert tails, f"{label} has no version tail"
        highest = max(tails)
        assert highest >= (115, ""), f"{label} latest tail={highest} < (115, '')"
