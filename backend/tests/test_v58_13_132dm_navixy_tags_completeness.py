"""v58.13.132dm — Sidebar TAG filter completeness.

The `.132dj` `list_with_tags` endpoint only surfaced tags observed on
LINKED vehicles. Tags defined in Navixy but not attached to any of our
tracked vehicles were invisible. `.132dm` extends the endpoint to also
include the full universe of tags from Navixy `/v2/tag/list`, with a
per-tag `count` of linked vehicles (0 for unlinked tags).
"""
from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest
from pymongo import MongoClient

# Shared session-scope event loop (see backend/tests/conftest.py).
# Prevents Motor "Event loop is closed" flakes when async tests run
# back-to-back within the same module.
from tests.conftest import run_async  # noqa: E402

APP_ROOT = Path(__file__).resolve().parents[2]
TAGS_MOD = APP_ROOT / "backend" / "fleet_navixy_tags.py"
REGISTER_JSX = APP_ROOT / "frontend" / "src" / "pages" / "FleetRegister.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Backend: distinct_tags shape upgrade ────────────────────────

def test_response_shape_declares_label_count():
    """Source-pin: `.132dm` marker + object shape in payload builder."""
    src = TAGS_MOD.read_text(encoding="utf-8")
    assert "132dm" in src
    # `distinct_tags` now carries `{label, count}` per row.
    assert '"label": lbl' in src or "'label': lbl" in src
    assert '"count": label_counts' in src or "'count': label_counts" in src
    # New source-marker chip for downgraded fallback path.
    assert "tag_list_source" in src


@pytest.mark.live_db_writes
def test_union_includes_unlinked_tags(caplog):
    """6 tags in Navixy + 4 attached to linked vehicles → all 6 appear,
    with 2 showing `count: 0`."""
    import sys
    sys.path.insert(0, str(APP_ROOT / "backend"))
    from fleet_navixy_tags import get_navixy_tags, _CACHE
    _CACHE.clear()

    org_id = f"pytest-org-{uuid.uuid4().hex[:6]}"
    db_sync = _mongo()
    seeded = [
        {"id": f"asset-A-{org_id}", "org_id": org_id,
         "navixy_device_id": 2001, "name": "Truck A",
         "scan_token": f"scan-A-{org_id}"},
        {"id": f"asset-B-{org_id}", "org_id": org_id,
         "navixy_device_id": 2002, "name": "Truck B",
         "scan_token": f"scan-B-{org_id}"},
        {"id": f"asset-C-{org_id}", "org_id": org_id,
         "navixy_device_id": 2003, "name": "Truck C",
         "scan_token": f"scan-C-{org_id}"},
        {"id": f"asset-D-{org_id}", "org_id": org_id,
         "navixy_device_id": 2004, "name": "Truck D",
         "scan_token": f"scan-D-{org_id}"},
    ]
    db_sync.assets.insert_many(seeded)
    try:
        fake_cfg = {"api_base_url": "https://navixy.example.com",
                    "session_hash": "hash-x"}
        tag_resp = type("R", (), {})()
        tag_resp.json = lambda: {"list": [
            {"id": 1, "name": "Tippers Under 10 Yarder"},
            {"id": 2, "name": "Traffic Dept"},
            {"id": 3, "name": "Plumber Vehicle"},
            {"id": 4, "name": "Vac Truck Dumping"},
            {"id": 5, "name": "Company Vehicle"},
            # Two extra tags defined in Navixy but attached to
            # nothing linked to our Fleet.
            {"id": 6, "name": "Site Ute"},
            {"id": 7, "name": "Trailer"},
        ]}
        trk_resp = type("R", (), {})()
        trk_resp.json = lambda: {"list": [
            {"id": 2001, "tag_bindings": [1]},  # Tippers
            {"id": 2002, "tag_bindings": [2]},  # Traffic
            {"id": 2003, "tag_bindings": [2]},  # Traffic
            {"id": 2004, "tag_bindings": [3]},  # Plumber
            # A tracker not linked to any asset carries tag 4 — the
            # tag should still surface via `/tag/list`.
            {"id": 9999, "tag_bindings": [4]},
        ]}
        posts = [tag_resp, trk_resp]

        async def fake_post(*a, **k):
            return posts.pop(0)

        with patch("fleet_navixy_tags._navixy_cfg", new=AsyncMock(return_value=fake_cfg)), \
             patch("fleet_navixy_tags.httpx.AsyncClient") as mc:
            mc.return_value.__aenter__.return_value.post = fake_post
            user = {"org_id": org_id, "id": "u", "role_id": "admin"}
            out = run_async(get_navixy_tags(user=user))

        # Shape.
        assert isinstance(out["distinct_tags"], list)
        assert all(isinstance(t, dict) and "label" in t and "count" in t
                   for t in out["distinct_tags"])
        by_label = {t["label"]: t["count"] for t in out["distinct_tags"]}
        # All 7 tags from Navixy surface.
        assert set(by_label.keys()) == {
            "Tippers Under 10 Yarder", "Traffic Dept", "Plumber Vehicle",
            "Vac Truck Dumping", "Company Vehicle", "Site Ute", "Trailer",
        }
        # Counts derived from LINKED vehicles only.
        assert by_label["Tippers Under 10 Yarder"] == 1  # asset-A
        assert by_label["Traffic Dept"] == 2             # asset-B, C
        assert by_label["Plumber Vehicle"] == 1          # asset-D
        # Unlinked tags surface with count 0.
        assert by_label["Vac Truck Dumping"] == 0
        assert by_label["Company Vehicle"] == 0
        assert by_label["Site Ute"] == 0
        assert by_label["Trailer"] == 0
        # Source marker: /tag/list succeeded → "navixy_and_linked".
        assert out["tag_list_source"] == "navixy_and_linked"
    finally:
        db_sync.assets.delete_many({"org_id": org_id})


@pytest.mark.live_db_writes
def test_graceful_fallback_when_tag_list_fails(caplog):
    """`/tag/list` fails but `/tracker/list` succeeds → distinct_tags
    falls back to linked-only discovery + source marker is
    `linked_only` + a warning is logged."""
    import sys
    sys.path.insert(0, str(APP_ROOT / "backend"))
    from fleet_navixy_tags import get_navixy_tags, _CACHE
    _CACHE.clear()

    org_id = f"pytest-org-{uuid.uuid4().hex[:6]}"
    db_sync = _mongo()
    seeded = [
        {"id": f"asset-X-{org_id}", "org_id": org_id,
         "navixy_device_id": 3001, "name": "Truck X",
         "scan_token": f"scan-X-{org_id}"},
    ]
    db_sync.assets.insert_many(seeded)
    try:
        fake_cfg = {"api_base_url": "https://navixy.example.com",
                    "session_hash": "hash-x"}
        # `/tag/list` will blow up but `/tracker/list` succeeds.
        # Tracker binding uses a NUMERIC tag_id we can't resolve to a
        # label without /tag/list — so linked-only builds `items=[]`
        # and `distinct_tags=[]`. But `tag_list_source == "linked_only"`
        # and the endpoint stays HTTP 200.
        trk_resp = type("R", (), {})()
        trk_resp.json = lambda: {"list": [
            {"id": 3001, "tag_bindings": [1]},
        ]}
        posts = [None, trk_resp]  # first call will raise via side_effect
        call_count = {"n": 0}

        async def fake_post(*a, **k):
            call_count["n"] += 1
            if call_count["n"] == 1:
                import httpx
                raise httpx.HTTPError("simulated /tag/list 5xx")
            return trk_resp

        with patch("fleet_navixy_tags._navixy_cfg", new=AsyncMock(return_value=fake_cfg)), \
             patch("fleet_navixy_tags.httpx.AsyncClient") as mc:
            mc.return_value.__aenter__.return_value.post = fake_post
            user = {"org_id": org_id, "id": "u", "role_id": "admin"}
            out = run_async(get_navixy_tags(user=user))

        # Endpoint stayed HTTP 200 with a valid shape.
        assert out["connected"] is True
        assert out["error"] is None
        assert out["tag_list_source"] == "linked_only"
        # Warning logged about the /tag/list failure.
        assert any(
            "/tag/list" in r.message and "linked" in r.message.lower()
            for r in caplog.records
        )
        # distinct_tags is a list of {label, count} objects (possibly
        # empty because we can't resolve numeric tag_ids without
        # /tag/list; the important part is the shape).
        assert isinstance(out["distinct_tags"], list)
        for t in out["distinct_tags"]:
            assert isinstance(t, dict)
            assert "label" in t and "count" in t
    finally:
        db_sync.assets.delete_many({"org_id": org_id})


# ─── Frontend: sidebar renders zero-count tags dimmed ────────────

def test_frontend_zero_count_dim_and_empty_state():
    src = REGISTER_JSX.read_text(encoding="utf-8")
    # Sidebar reads count from the API-supplied object.
    assert "entry.label" in src or "entry.count" in src or "apiCount" in src
    # Dim style for zero-count tags.
    assert "text-slate-400 hover:bg-slate-50" in src
    # Empty-state hint testid.
    assert "fleet-tag-zero-hint" in src
    # Dropdown handles new object shape.
    assert "(0)" in src


# ─── Version sync ────────────────────────────────────────────────

def test_three_way_sync_at_132dm_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dm"
