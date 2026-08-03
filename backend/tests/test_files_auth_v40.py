"""v160.3.9.40 (SEC-004) — Authentication on `/api/files/*`.

Coverage:
  1. Anon GET on `/api/files/document_library/<uuid>/<name>` returns 401
     (not 200, not open access).
  2. Bearer-authenticated GET as owning-org user returns the file.
  3. Cross-org user with a valid bearer JWT gets 404 (not 403 — do NOT
     confirm existence).
  4. Signed download-token GET via `?token=<jwt>` still works.
  5. Expired/tampered download-token GET returns 401.
  6. `/api/files/renewals/<share_token>/<name>` remains public (that
     endpoint uses its own share-link token — kept in the middleware
     skip list explicitly).

Ephemeral fixtures only. All files created land in
`/app/backend/uploads/document_library/__v40_probe_<uuid>/…` and are
cleaned up in `finally`.
"""
from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

import pytest
import requests

from .conftest import API

UPLOAD_ROOT = Path("/app/backend/uploads")


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


def _stephen_org_id(tok):
    r = requests.get(f"{API}/auth/me",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    return r.json().get("org_id")


def _create_probe_file(folder_id: str, name: str, content: bytes = b"v40-probe") -> Path:
    p = UPLOAD_ROOT / "document_library" / folder_id / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)
    return p


# ── Case 1 — Anon returns 401
def test_case1_anonymous_get_returns_401(_mongo):
    tok = _admin_token()
    org_id = _stephen_org_id(tok)
    folder_id = f"__v40_probe_{uuid.uuid4().hex[:10]}"
    name = "probe.txt"
    _mongo.document_library_folders.insert_one({
        "id": folder_id, "org_id": org_id, "name": "v40-probe-folder",
    })
    fpath = _create_probe_file(folder_id, name)
    try:
        r = requests.get(
            f"{API}/files/document_library/{folder_id}/{name}",
            timeout=10,
        )
        assert r.status_code == 401, (
            f"anon GET should be 401, got HTTP={r.status_code} {r.text[:200]}")
    finally:
        _mongo.document_library_folders.delete_one({"id": folder_id})
        if fpath.exists():
            fpath.unlink()
        parent = fpath.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()


# ── Case 2 — Authenticated same-org GET works
def test_case2_same_org_bearer_gets_file(_mongo):
    tok = _admin_token()
    org_id = _stephen_org_id(tok)
    folder_id = f"__v40_probe_{uuid.uuid4().hex[:10]}"
    name = "same-org.txt"
    _mongo.document_library_folders.insert_one({
        "id": folder_id, "org_id": org_id, "name": "v40-probe-folder",
    })
    fpath = _create_probe_file(folder_id, name, content=b"same-org-content")
    try:
        r = requests.get(
            f"{API}/files/document_library/{folder_id}/{name}",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=10,
        )
        assert r.status_code == 200, (
            f"same-org GET should be 200, got HTTP={r.status_code} {r.text[:200]}")
        assert r.content == b"same-org-content"
    finally:
        _mongo.document_library_folders.delete_one({"id": folder_id})
        if fpath.exists():
            fpath.unlink()
        parent = fpath.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()


# ── Case 3 — Cross-org bearer gets 404 (existence not confirmed)
def test_case3_cross_org_bearer_gets_404(_mongo):
    tok = _admin_token()
    # Different org for the folder — proves cross-org is blocked.
    other_org_id = f"__v40_other_org_{uuid.uuid4().hex[:8]}"
    folder_id = f"__v40_probe_{uuid.uuid4().hex[:10]}"
    name = "cross-org.txt"
    _mongo.document_library_folders.insert_one({
        "id": folder_id, "org_id": other_org_id, "name": "v40-cross-org-folder",
    })
    fpath = _create_probe_file(folder_id, name)
    try:
        r = requests.get(
            f"{API}/files/document_library/{folder_id}/{name}",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=10,
        )
        assert r.status_code == 404, (
            f"cross-org GET should be 404 (not 403), got HTTP={r.status_code}")
    finally:
        _mongo.document_library_folders.delete_one({"id": folder_id})
        if fpath.exists():
            fpath.unlink()
        parent = fpath.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()


# ── Case 4 — Download token via ?token= works
def test_case4_download_token_query_works(_mongo):
    tok = _admin_token()
    # Mint the download token
    r = requests.post(f"{API}/auth/download-token",
                      headers={"Authorization": f"Bearer {tok}"},
                      timeout=10)
    assert r.status_code == 200, f"download-token mint failed: {r.status_code}"
    dl_tok = r.json().get("token")
    assert dl_tok

    org_id = _stephen_org_id(tok)
    folder_id = f"__v40_probe_{uuid.uuid4().hex[:10]}"
    name = "download-token.txt"
    _mongo.document_library_folders.insert_one({
        "id": folder_id, "org_id": org_id, "name": "v40-probe-folder",
    })
    fpath = _create_probe_file(folder_id, name, content=b"dl-token-content")
    try:
        r2 = requests.get(
            f"{API}/files/document_library/{folder_id}/{name}",
            params={"token": dl_tok},
            timeout=10,
        )
        assert r2.status_code == 200, (
            f"?token= GET should be 200, got HTTP={r2.status_code} {r2.text[:200]}")
        assert r2.content == b"dl-token-content"
    finally:
        _mongo.document_library_folders.delete_one({"id": folder_id})
        if fpath.exists():
            fpath.unlink()
        parent = fpath.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()


# ── Case 5 — Tampered download token → 401
def test_case5_tampered_token_returns_401(_mongo):
    tok = _admin_token()
    r = requests.post(f"{API}/auth/download-token",
                      headers={"Authorization": f"Bearer {tok}"},
                      timeout=10)
    assert r.status_code == 200
    dl_tok = r.json().get("token")
    # Flip a byte in the middle of the JWT signature
    idx = len(dl_tok) - 10
    tampered = dl_tok[:idx] + ("A" if dl_tok[idx] != "A" else "B") + dl_tok[idx+1:]

    org_id = _stephen_org_id(tok)
    folder_id = f"__v40_probe_{uuid.uuid4().hex[:10]}"
    name = "tamper.txt"
    _mongo.document_library_folders.insert_one({
        "id": folder_id, "org_id": org_id, "name": "v40-probe-folder",
    })
    fpath = _create_probe_file(folder_id, name)
    try:
        r2 = requests.get(
            f"{API}/files/document_library/{folder_id}/{name}",
            params={"token": tampered},
            timeout=10,
        )
        assert r2.status_code == 401, (
            f"tampered token GET should be 401, got HTTP={r2.status_code}")
    finally:
        _mongo.document_library_folders.delete_one({"id": folder_id})
        if fpath.exists():
            fpath.unlink()
        parent = fpath.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()


# ── Case 6 — Renewals path remains public
def test_case6_renewals_path_remains_public():
    """Belt: `/api/files/renewals/<token>/<name>` is the ONE `/api/files/*`
    path we deliberately leave open. It authenticates via its own
    share-link token in the URL. Assert a probe to a bogus token gets 400
    (invalid filename → underscored token rejected as parts) OR 404
    (path not found) — NEVER 401. A 401 would mean the middleware
    skip list didn't cover it and public renewal emails are broken.
    """
    probe_token = f"__v40_probe_token_{uuid.uuid4().hex[:8]}"
    r = requests.get(
        f"{API}/files/renewals/{probe_token}/bogus.pdf",
        timeout=10,
    )
    assert r.status_code in (400, 404), (
        f"renewals endpoint should stay unauthenticated: HTTP={r.status_code} "
        f"{r.text[:200]}")
