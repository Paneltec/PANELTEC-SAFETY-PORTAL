"""v58.13.132af — Android APK direct-install endpoints.

Public (no-auth) endpoints — workers scanning onboarding cards
can't be authenticated. Verify:
  · /version returns valid manifest JSON with expected keys.
  · /latest.apk returns application/vnd.android.package-archive,
    non-zero size, magic bytes `PK\\x03\\x04` (valid ZIP → APK).
"""
from __future__ import annotations

import pytest
import requests

pytestmark = pytest.mark.live_db_writes

BASE = "http://localhost:8001"


@pytest.mark.live_db_writes
def test_android_download_endpoints():
    # 1. Version endpoint returns valid manifest.
    r = requests.get(f"{BASE}/api/mobile/downloads/android/version", timeout=10)
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["available"] is True
    for k in ("filename", "version", "version_code", "size_bytes",
              "sha256", "built_at", "eas_build_id"):
        assert k in m, f"manifest missing {k}"
    assert m["version_code"] == 135
    assert m["version"] == "1.0.4"
    assert m["size_bytes"] > 10 * 1024 * 1024  # APK > 10 MB
    assert len(m["sha256"]) == 64
    # v58.13.132al — sha256 must differ from every prior broken build
    # (.132af `954e40…`, .132ag `d3b584…`, .132ai `68022d…`) to prove
    # a fresh crash-instrumented APK was hosted.
    assert m["sha256"] not in {
        "954e4076748eef7fc30f47b5c69d877ea542eb3855c935bb279a6dae9a567de7",
        "d3b584fd38310b46743c1958be4ee6874bbfe32dfc47eb02efeffda6c1532c3c",
        "68022d29b266bf5ecb49b457839eee669cf53530b68ddb6ad46bea8f594a52e7",
    }

    # 2. APK download works — stream first 4 bytes and verify magic.
    r = requests.get(
        f"{BASE}/api/mobile/downloads/android/latest.apk",
        headers={"Range": "bytes=0-1023"},  # partial content — 1 KB
        timeout=15,
    )
    # FastAPI FileResponse honors Range → 206; some setups return 200.
    assert r.status_code in (200, 206), r.text[:200]
    assert r.headers["content-type"] == "application/vnd.android.package-archive"
    assert 'filename="Paneltec-Field-App.apk"' in r.headers.get("content-disposition", "")
    assert r.headers["x-paneltec-version"] == m["version"]
    assert r.headers["x-paneltec-version-code"] == str(m["version_code"])
    assert r.headers["x-paneltec-sha256"] == m["sha256"]
    body = r.content
    assert body[:4] == b"PK\x03\x04", f"not a valid ZIP: {body[:8]!r}"
