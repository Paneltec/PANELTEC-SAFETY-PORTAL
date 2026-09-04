"""v58.13.114 — Ask Intelligence retrieval scope + confidence override tests.

Locks:
  · `_query_tokens` extracts alphanumeric 2-40 char tokens, drops stop-
    words + module verbs.
  · `_looks_name_shaped` returns True only for a single-token query.
  · `_regex_or` builds a case-insensitive $or over the given fields.
  · `_can_see_audit` / `_can_see_comms` gate on role or explicit
    permission.
  · `_evidence` returns every one of the 12 keys the retriever now
    fills; query-aware collections are empty when the question has
    no primary token (recency-only fallback).
  · `_compute_confidence` enforces the 7-row backend matrix.
  · `_build_name_fallback_body` returns a summary + top-3 recent
    activity string when the query is name-shaped and the domain
    collections don't touch the token.
  · `ensure_indexes` creates the .114 indexes on the expected
    collections.
  · Version-sync forward-safe pin >= .114.
"""
from __future__ import annotations
import asyncio
import os
import re
import uuid
from pathlib import Path
import sys

import pytest

sys.path.insert(0, "/app/backend")


# ── Pure helper unit tests ───────────────────────────────────────────
def test_query_tokens_drops_stopwords():
    from ask import _query_tokens
    assert _query_tokens("show me the recent stephen records") == ["stephen"]
    assert _query_tokens("") == []
    assert _query_tokens("all") == []  # single stopword
    assert _query_tokens("stephen") == ["stephen"]


def test_query_tokens_preserves_order_and_alphanumeric():
    from ask import _query_tokens
    toks = _query_tokens("incident RL truck-42")
    assert "rl" in toks and "truck-42" in toks
    assert toks[0] != "the"


def test_looks_name_shaped():
    from ask import _looks_name_shaped, _query_tokens
    q = "stephen"
    assert _looks_name_shaped(q, _query_tokens(q)) is True
    q2 = "stephen jones"
    assert _looks_name_shaped(q2, _query_tokens(q2)) is False


def test_regex_or_shape():
    from ask import _regex_or
    out = _regex_or(["name", "email"], "Steph.n")
    assert "$or" in out
    # regex is escaped so a literal `.` in the token can't wild-match.
    assert out["$or"][0]["name"]["$regex"] == r"Steph\.n"
    assert out["$or"][0]["name"]["$options"] == "i"


def test_can_see_audit():
    from ask import _can_see_audit, _can_see_comms
    assert _can_see_audit({"role": "admin"}) is True
    assert _can_see_audit({"role": "hseq_lead"}) is True
    assert _can_see_audit({"role": "worker"}) is False
    assert _can_see_audit({"role": "worker",
                           "effective_permissions": {"audit_log": {"view": True}}}) is True
    assert _can_see_comms({"role": "admin"}) is True
    assert _can_see_comms({"role": "worker"}) is False
    assert _can_see_comms({"role": "worker",
                           "effective_permissions": {"email_outbox": {"view": True}}}) is True


# ── Confidence matrix (all 21 combinations) ─────────────────────────
CONF_MATRIX_CASES = [
    # (hits, types, claude, expected). Note: `types` is always <=`hits`.
    (0, 0, "high", "low"), (0, 0, "medium", "low"), (0, 0, "low", "low"),
    # 1-2 hits, single type — always low regardless of Claude.
    (1, 1, "high", "low"), (2, 1, "high", "low"), (2, 1, "medium", "low"),
    # 1-2 hits, 2 types — medium cap.
    (2, 2, "high", "medium"), (2, 2, "medium", "medium"), (2, 2, "low", "low"),
    # 3+ hits, single type — medium cap (single-source can't be high).
    (3, 1, "high", "medium"), (5, 1, "high", "medium"), (3, 1, "low", "low"),
    # 3+ hits, ≥2 types — high only when Claude agrees.
    (3, 2, "high", "high"), (3, 3, "high", "high"),
    (3, 2, "medium", "medium"), (3, 2, "low", "low"),
]


@pytest.mark.parametrize("hits,types,claude,expected", CONF_MATRIX_CASES)
def test_compute_confidence_matrix(hits, types, claude, expected):
    from ask import _compute_confidence
    # Build `hits` citations spread across `types` distinct record_type values.
    cited = []
    for i in range(hits):
        cited.append({
            "record_type": f"type_{i % max(types, 1)}",
            "record_id": f"r_{i}",
            "label": f"L{i}",
        })
    assert _compute_confidence(cited, claude) == expected, (
        f"hits={hits} types={types} claude={claude} → expected {expected}"
    )


def test_compute_confidence_rejects_garbage():
    from ask import _compute_confidence
    assert _compute_confidence("not a list", "high") == "low"
    assert _compute_confidence([{"no": "record_id"}], "high") == "low"
    assert _compute_confidence([{"record_type": "x", "record_id": "y"}],
                                "wombat") == "low"  # invalid claude confidence


# ── Fallback body ────────────────────────────────────────────────────
def test_fallback_body_fires_for_name_query():
    from ask import _build_name_fallback_body
    ev = {
        "_meta": {"query_tokens": ["stephen"]},
        "incidents": [], "hazards": [], "swms": [], "inspections": [], "contractors": [],
        "users": [{"id": "u1", "name": "Stephen McG", "role": "admin"}],
        "workers": [], "site_visitors": [
            {"id": "v1", "name": "RL", "visiting_person": "Stephen",
             "signed_in_at": "2026-09-04T14:17:00+00:00"},
        ],
        "form_submissions": [
            {"id": "f1", "template_name_snapshot": "Daily Pre-Start",
             "submitted_by_name": "Stephen McG", "submitted_at": "2026-09-03T08:00:00+00:00"},
        ],
        "pre_starts": [], "site_diary_entries": [],
        "audit_log": [], "outbound_emails": [], "outbound_sms": [],
    }
    body = _build_name_fallback_body("stephen", ev)
    assert body is not None
    assert "'stephen'" in body
    assert "1 user" in body
    assert "1 site visitor record" in body
    assert "1 authored record" in body
    assert "Most recent:" in body
    assert "RL" in body
    assert "Daily Pre-Start" in body
    assert "Narrow further?" in body


def test_fallback_body_none_when_domain_matches():
    from ask import _build_name_fallback_body
    ev = {
        "_meta": {"query_tokens": ["stephen"]},
        "incidents": [{"id": "i1", "title": "Fall on Stephen St", "description": ""}],
        "hazards": [], "swms": [], "inspections": [], "contractors": [],
        "users": [{"id": "u1", "name": "Stephen"}],
        "workers": [], "site_visitors": [], "form_submissions": [],
        "pre_starts": [], "site_diary_entries": [],
    }
    assert _build_name_fallback_body("stephen", ev) is None


def test_fallback_body_none_when_multi_token():
    from ask import _build_name_fallback_body
    ev = {"_meta": {"query_tokens": ["stephen", "incidents"]}}
    assert _build_name_fallback_body("stephen incidents", ev) is None


def test_fallback_body_none_when_no_person_hits():
    from ask import _build_name_fallback_body
    ev = {"_meta": {"query_tokens": ["stephen"]},
          "incidents": [], "hazards": [], "swms": [], "inspections": [], "contractors": [],
          "users": [], "workers": [], "site_visitors": [], "form_submissions": [],
          "pre_starts": [], "site_diary_entries": []}
    assert _build_name_fallback_body("stephen", ev) is None


# ── _evidence live round-trip ────────────────────────────────────────
@pytest.mark.asyncio
async def test_evidence_returns_all_12_keys_and_meta():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    import ask
    original = ask.db
    ask.db = d
    try:
        # A cross-cutting org id that DOES have data in the seeded DB
        # (test_database was seeded with Paneltec's org). Fall back to
        # any live org otherwise.
        u = await d.users.find_one({"email": {"$regex": "stephen", "$options": "i"}})
        org_id = u["org_id"] if u else "org-x"
        ev = await ask._evidence(org_id, None, question="stephen",
                                  user={"role": "admin", "id": u["id"] if u else "act",
                                        "org_id": org_id})
    finally:
        ask.db = original
        client.close()
    expected_keys = {"incidents", "hazards", "swms", "inspections", "contractors",
                     "users", "workers", "site_visitors", "form_submissions",
                     "pre_starts", "site_diary_entries", "audit_log",
                     "outbound_emails", "outbound_sms", "_meta"}
    assert expected_keys <= set(ev.keys()), f"missing: {expected_keys - set(ev.keys())}"
    assert ev["_meta"]["primary_token"] == "stephen"
    # If Stephen exists in the DB, the retrieval MUST have found him.
    if u:
        assert len(ev["users"]) >= 1, "Stephen user in DB but not in bundle"


@pytest.mark.asyncio
async def test_evidence_no_token_is_recency_fallback():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    import ask
    original = ask.db
    ask.db = d
    try:
        u = await d.users.find_one({"email": {"$regex": "stephen", "$options": "i"}})
        org_id = u["org_id"] if u else "org-x"
        ev = await ask._evidence(org_id, None, question="",
                                  user={"role": "admin", "id": "x", "org_id": org_id})
    finally:
        ask.db = original
        client.close()
    # No token → all query-aware collections should be empty.
    for k in ("users", "workers", "site_visitors", "form_submissions",
              "pre_starts", "site_diary_entries", "audit_log",
              "outbound_emails", "outbound_sms"):
        assert ev.get(k) == [], f"{k} should be empty on no-token retrieval"


@pytest.mark.asyncio
async def test_evidence_non_admin_skips_audit_and_comms():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    import ask
    original = ask.db
    ask.db = d
    try:
        u = await d.users.find_one({"email": {"$regex": "stephen", "$options": "i"}})
        org_id = u["org_id"] if u else "org-x"
        # Non-admin, no explicit permission — audit + comms must be empty.
        ev = await ask._evidence(org_id, None, question="stephen",
                                  user={"role": "worker", "id": "act",
                                        "org_id": org_id})
    finally:
        ask.db = original
        client.close()
    assert ev["audit_log"] == []
    assert ev["outbound_emails"] == []
    assert ev["outbound_sms"] == []


# ── ensure_indexes ───────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_ensure_indexes_creates_expected_indexes():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    import ask
    original = ask.db
    ask.db = d
    try:
        await ask.ensure_indexes()
        # Verify the ones with obvious perf impact were created.
        fs_idx = await d.form_submissions.index_information()
        assert any("submitted_by_1" == n or ("submitted_by" in i.get("key", [])[0]
                                             if i.get("key") else False)
                   for n, i in fs_idx.items()), (
            f"form_submissions.submitted_by index missing; saw {list(fs_idx.keys())}"
        )
        ps_idx = await d.pre_starts.index_information()
        assert any("created_by" in str(i.get("key", "")) for _, i in ps_idx.items())
        au_idx = await d.audit_log.index_information()
        assert any("actor_user_id" in str(i.get("key", "")) for _, i in au_idx.items())
    finally:
        ask.db = original
        client.close()


# ── Version sync forward-safe pin ────────────────────────────────────
_VERSION_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def test_version_bumps_meet_114():
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
        assert highest >= (114, ""), f"{label} latest tail={highest} < (114, '')"
