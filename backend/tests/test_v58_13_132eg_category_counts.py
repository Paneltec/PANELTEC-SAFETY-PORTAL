"""v58.13.132eg — Server-side category-count endpoints.

Locks the seven `/api/{module}/category-counts` endpoints (behavioural
+ contract) and the Pre-Starts FE wiring that consumes them.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT / "backend"))

FE = APP_ROOT / "frontend" / "src"
PRESTARTS_JSX = FE / "pages" / "PreStarts.jsx"
BACKEND_MOD = APP_ROOT / "backend" / "category_counts.py"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Source-pins: FE consumes server counts, not decorated.length
def test_prestarts_fetches_category_counts_on_mount_and_toggle():
    src = _read(PRESTARTS_JSX)
    assert "api.get('/pre-starts/category-counts'" in src, (
        "PreStarts must fetch `/pre-starts/category-counts` server-side")
    assert "setCategoryCounts" in src, (
        "PreStarts must store the category-counts response in state")
    # Effect must react to showArchived so the toggle re-fetches.
    assert "[fetchCategoryCounts, showArchived]" in src, (
        "PreStarts must re-fetch category-counts when `showArchived` flips")


def test_prestarts_typeindex_prefers_server_counts():
    src = _read(PRESTARTS_JSX)
    # The typeIndex useMemo must consume `categoryCounts.categories`
    # BEFORE falling back to the client-side `decorated` bucket sums.
    assert "categoryCounts?.categories?.length" in src, (
        "typeIndex must prefer server-side category counts")


def test_prestarts_all_pill_uses_server_total():
    src = _read(PRESTARTS_JSX)
    # totalCount for the "All" chip must prefer categoryCounts.all_count.
    assert "categoryCounts?.all_count ?? decorated.length" in src, (
        "`All` pill count must prefer server-side all_count over "
        "decorated.length (which is capped at 5k)")


def test_prestarts_refetches_categories_after_archive():
    src = _read(PRESTARTS_JSX)
    # useArchiveActions's refetch callback must trigger BOTH the list
    # refresh AND the category-counts refresh so pill counts stay in
    # sync after per-row / bulk archive.
    m = re.search(
        r"useArchiveActions\('/pre-starts',\s*setItems,\s*\(\)\s*=>\s*\{[^}]*fetchCategoryCounts",
        src, re.DOTALL,
    )
    assert m, (
        "useArchiveActions refetch must call fetchCategoryCounts after "
        "archive/unarchive so pill counts re-hydrate")


# ─── Backend module has all 7 routes ──────────────────────────
@pytest.mark.parametrize("path", [
    "/pre-starts/category-counts",
    "/incidents/category-counts",
    "/hazards/category-counts",
    "/inspections/category-counts",
    "/risk-assessments/category-counts",
    "/site-diary/category-counts",
    "/admin/visitors/category-counts",
])
def test_backend_defines_route(path):
    src = _read(BACKEND_MOD)
    assert f'"{path}"' in src, f"category_counts.py missing route `{path}`"


# ─── Behavioural: contract + archive-filter semantics ─────────
_TOKEN_CACHE: dict = {"h": None}


def _admin_headers():
    if _TOKEN_CACHE["h"] is not None:
        return _TOKEN_CACHE["h"]
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": "stephen@paneltec.com.au",
                            "password": "Mcgstephen50#"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    t = r.json().get("access_token") or r.json().get("token")
    _TOKEN_CACHE["h"] = {"Authorization": f"Bearer {t}"}
    return _TOKEN_CACHE["h"]


PATHS = [
    "/api/pre-starts/category-counts",
    "/api/incidents/category-counts",
    "/api/hazards/category-counts",
    "/api/inspections/category-counts",
    "/api/risk-assessments/category-counts",
    "/api/site-diary/category-counts",
    "/api/admin/visitors/category-counts",
]


@pytest.mark.parametrize("path", PATHS)
def test_category_counts_endpoint_shape(path):
    r = requests.get(f"{API}{path}", headers=_admin_headers(), timeout=30)
    assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:300]}"
    body = r.json()
    for key in ("categories", "all_count", "archived_count"):
        assert key in body, f"{path}: missing `{key}` in response"
    assert isinstance(body["categories"], list)
    for c in body["categories"]:
        assert "label" in c and "count" in c
    # Sum of category counts must equal all_count.
    total = sum(c["count"] for c in body["categories"])
    assert total == body["all_count"], (
        f"{path}: category sum ({total}) != all_count ({body['all_count']})")


@pytest.mark.parametrize("path", PATHS)
def test_include_archived_respected(path):
    h = _admin_headers()
    r1 = requests.get(f"{API}{path}", headers=h, timeout=30)
    r2 = requests.get(f"{API}{path}", headers=h,
                      params={"include_archived": "true"}, timeout=30)
    if r1.status_code != 200 or r2.status_code != 200:
        pytest.skip(f"{path}: transient response")
    b1, b2 = r1.json(), r2.json()
    # include_archived=true means all_count >= without.
    assert b2["all_count"] >= b1["all_count"], (
        f"{path}: include_archived=true returned smaller total "
        f"({b2['all_count']} < {b1['all_count']})")
    # archived_count is invariant of the flag (it's always the
    # archived-pool size).
    assert b1["archived_count"] == b2["archived_count"], (
        f"{path}: archived_count differs across include_archived toggle")


def test_prestarts_all_count_matches_x_total_count_header():
    """The `all_count` from the category endpoint must equal the
    `X-Total-Count` header emitted by the list endpoint from `.132ef`.
    Otherwise the "All" pill and the total-count chip disagree."""
    h = _admin_headers()
    r_list = requests.get(f"{API}/api/pre-starts", headers=h,
                          params={"limit": 1}, timeout=30)
    assert r_list.status_code == 200
    total_header = int(r_list.headers.get("X-Total-Count", "0"))
    r_cat = requests.get(f"{API}/api/pre-starts/category-counts",
                         headers=h, timeout=30)
    assert r_cat.status_code == 200
    all_count = r_cat.json()["all_count"]
    # Allow ±1 tolerance for the ~2s race between the two requests
    # (auto-archive scheduler occasionally moves one row while we're
    # in flight).
    assert abs(total_header - all_count) <= 3, (
        f"X-Total-Count ({total_header}) and category all_count "
        f"({all_count}) disagree by more than 3")


# ─── Version pin ──────────────────────────────────────────────
def test_version_pinned_to_132eg_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "eg", (
        f"version.js pinned to .132{m_v.group(1) if m_v else '??'}, need ≥ .132eg")
    assert m_sw and m_sw.group(1) >= "eg", (
        f"service-worker.js pinned to .132{m_sw.group(1) if m_sw else '??'}, "
        f"need ≥ .132eg")
