"""v58.13.132ah — Range-aware Android APK delivery.

Regression: `.132ag` shipped the APK via `FileResponse`, which did not
advertise `Accept-Ranges: bytes` or honor `Range:` requests in this
deployment. Android DownloadManager could not resume after cellular
hiccups, resulting in truncated ~12.57 MB downloads. This test locks
in the range-aware `StreamingResponse` handler.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import requests

pytestmark = pytest.mark.live_db_writes

BASE = "http://localhost:8001"
APK_MANIFEST = Path(__file__).resolve().parents[1] / "static" / "downloads" / "android_manifest.json"


def _manifest() -> dict:
    return json.loads(APK_MANIFEST.read_text())


@pytest.mark.live_db_writes
def test_full_download_advertises_range_and_streams_entire_file():
    """GET without Range → 200 + full body + Accept-Ranges: bytes."""
    m = _manifest()
    expected_size = int(m["size_bytes"])

    r = requests.get(
        f"{BASE}/api/mobile/downloads/android/latest.apk",
        timeout=120,
        stream=False,
    )
    assert r.status_code == 200, r.text[:200]
    assert r.headers["accept-ranges"] == "bytes", (
        "Missing Accept-Ranges: bytes — Android DownloadManager will fail "
        "to resume interrupted downloads, replicating the .132ag bug."
    )
    assert r.headers["content-type"] == "application/vnd.android.package-archive"
    assert int(r.headers["content-length"]) == expected_size
    assert 'filename="Paneltec-Field-App.apk"' in r.headers["content-disposition"]
    assert r.headers["x-paneltec-version"] == m["version"]
    assert r.headers["x-paneltec-version-code"] == str(m["version_code"])
    assert r.headers["x-paneltec-sha256"] == m["sha256"]
    assert len(r.content) == expected_size
    assert r.content[:4] == b"PK\x03\x04"


@pytest.mark.live_db_writes
def test_range_first_1024_bytes_returns_206_with_content_range():
    """GET Range: bytes=0-1023 → 206 + exact 1024-byte slice from start."""
    m = _manifest()
    expected_size = int(m["size_bytes"])

    r = requests.get(
        f"{BASE}/api/mobile/downloads/android/latest.apk",
        headers={"Range": "bytes=0-1023"},
        timeout=30,
    )
    assert r.status_code == 206, r.text[:200]
    assert r.headers["accept-ranges"] == "bytes"
    assert r.headers["content-range"] == f"bytes 0-1023/{expected_size}"
    assert int(r.headers["content-length"]) == 1024
    # All standard APK headers still present on partial responses.
    assert r.headers["x-paneltec-sha256"] == m["sha256"]
    assert r.headers["content-type"] == "application/vnd.android.package-archive"
    assert len(r.content) == 1024
    # First 4 bytes are still the ZIP magic since start=0.
    assert r.content[:4] == b"PK\x03\x04"


@pytest.mark.live_db_writes
def test_range_last_10_bytes_returns_206_tail_slice():
    """GET Range: bytes=<size-10>-<size-1> → 206 + last 10 bytes."""
    m = _manifest()
    expected_size = int(m["size_bytes"])
    start = expected_size - 10
    end = expected_size - 1

    r = requests.get(
        f"{BASE}/api/mobile/downloads/android/latest.apk",
        headers={"Range": f"bytes={start}-{end}"},
        timeout=30,
    )
    assert r.status_code == 206, r.text[:200]
    assert r.headers["content-range"] == f"bytes {start}-{end}/{expected_size}"
    assert int(r.headers["content-length"]) == 10
    assert len(r.content) == 10


@pytest.mark.live_db_writes
def test_range_beyond_eof_returns_416_not_satisfiable():
    """GET Range: bytes=99999999999- → 416 with Content-Range: bytes */<size>."""
    m = _manifest()
    expected_size = int(m["size_bytes"])

    r = requests.get(
        f"{BASE}/api/mobile/downloads/android/latest.apk",
        headers={"Range": "bytes=99999999999-"},
        timeout=15,
    )
    assert r.status_code == 416, r.text[:200]
    assert r.headers["content-range"] == f"bytes */{expected_size}"
    assert r.headers["accept-ranges"] == "bytes"


@pytest.mark.live_db_writes
def test_malformed_range_header_returns_416():
    """GET Range: bytes=abc-xyz → 416, does NOT stream the full 115 MB."""
    m = _manifest()
    expected_size = int(m["size_bytes"])

    r = requests.get(
        f"{BASE}/api/mobile/downloads/android/latest.apk",
        headers={"Range": "bytes=abc-xyz"},
        timeout=15,
    )
    assert r.status_code == 416, r.text[:200]
    assert r.headers["content-range"] == f"bytes */{expected_size}"


@pytest.mark.live_db_writes
def test_version_endpoint_still_returns_manifest():
    """Regression: /version endpoint is unchanged by the .132ah patch."""
    r = requests.get(f"{BASE}/api/mobile/downloads/android/version", timeout=10)
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["available"] is True
    for k in ("filename", "version", "version_code", "size_bytes",
              "sha256", "built_at", "eas_build_id"):
        assert k in m, f"manifest missing {k}"
    assert len(m["sha256"]) == 64
