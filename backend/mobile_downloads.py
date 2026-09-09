"""Mobile app APK download endpoints — v58.13.132ah.

Serves the direct-install Android APK produced by EAS Build.
Public (no auth) — workers scanning onboarding cards can't be
authenticated yet.

Endpoints:
  GET /api/mobile/downloads/android/latest.apk   → APK file stream
  GET /api/mobile/downloads/android/version      → metadata JSON

v58.13.132ah — Range-aware delivery.
  Prior `FileResponse` did NOT advertise `Accept-Ranges: bytes`
  or honor `Range:` request headers in this deployment (Cloudflare
  ingress + CORS middleware combination stripped Range on the wire).
  Android's DownloadManager relies on Range requests to resume after
  cellular hiccups; without them, any mid-flight stall (very common
  around 10-15 MB on 4G) freezes the download and looks like the file
  is truncated to ~12.57 MB. Fix: streaming handler that parses
  `Range: bytes=start-end`, replies `206 Partial Content` with a
  proper `Content-Range` header, and always advertises
  `Accept-Ranges: bytes`. Malformed / unsatisfiable ranges → 416.
"""
from __future__ import annotations
import json
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter(tags=["mobile-downloads"])

APK_DIR = Path(__file__).parent / "static" / "downloads"
APK_MANIFEST = APK_DIR / "android_manifest.json"

# 1 MB stream chunks — small enough for smooth flow control on mobile,
# large enough to avoid syscall overhead on desktop.
_CHUNK = 1024 * 1024

# Matches `bytes=<start>-<end?>` where both sides are decimal digits.
# Reject anything else (multi-range, suffix-length, non-numeric).
_RANGE_RE = re.compile(r"^bytes=(\d+)-(\d*)$")


def _read_manifest() -> Optional[dict]:
    if not APK_MANIFEST.exists():
        return None
    try:
        return json.loads(APK_MANIFEST.read_text())
    except Exception:
        return None


def _base_apk_headers(m: dict) -> dict:
    return {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=300",
        "Content-Disposition": 'attachment; filename="Paneltec-Field-App.apk"',
        "X-Paneltec-Version": m.get("version", "unknown"),
        "X-Paneltec-Version-Code": str(m.get("version_code", "unknown")),
        "X-Paneltec-SHA256": m.get("sha256", "unknown"),
    }


def _iter_file(path: Path, start: int, length: int):
    """Yield up to `length` bytes from `path` starting at `start`."""
    with open(path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            chunk = f.read(min(_CHUNK, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@router.get("/mobile/downloads/android/version")
async def android_version():
    m = _read_manifest()
    if not m:
        return JSONResponse(
            status_code=503,
            content={
                "available": False,
                "reason": "no APK published yet",
                "message": "Contact your admin — Android APK build pending.",
            },
        )
    return {"available": True, **m}


@router.get("/mobile/downloads/android/latest.apk")
async def android_latest_apk(request: Request):
    m = _read_manifest()
    if not m:
        raise HTTPException(
            status_code=503,
            detail="No APK published yet — contact your admin.",
        )
    apk_path = APK_DIR / m["filename"]
    if not apk_path.exists():
        raise HTTPException(
            status_code=503,
            detail="APK manifest present but file missing.",
        )

    file_size = apk_path.stat().st_size
    headers = _base_apk_headers(m)
    range_header = request.headers.get("range") or request.headers.get("Range")

    # v58.13.132ah — full-file path (no Range header).
    if not range_header:
        headers["Content-Length"] = str(file_size)
        return StreamingResponse(
            _iter_file(apk_path, 0, file_size),
            status_code=200,
            media_type="application/vnd.android.package-archive",
            headers=headers,
        )

    # v58.13.132ah — Range path. Reject malformed / multi-range
    # / suffix-length requests with 416 so buggy clients get a
    # clear signal rather than the full body.
    match = _RANGE_RE.match(range_header.strip())
    if not match:
        return JSONResponse(
            status_code=416,
            content={"detail": f"Malformed Range header: {range_header!r}"},
            headers={"Content-Range": f"bytes */{file_size}",
                     "Accept-Ranges": "bytes"},
        )
    start = int(match.group(1))
    end_raw = match.group(2)
    end = int(end_raw) if end_raw else file_size - 1

    # Unsatisfiable: start past EOF, end < start, or end past EOF.
    if start >= file_size or end < start:
        return JSONResponse(
            status_code=416,
            content={"detail": "Range not satisfiable"},
            headers={"Content-Range": f"bytes */{file_size}",
                     "Accept-Ranges": "bytes"},
        )
    # Clamp end to EOF (tolerated per RFC 7233).
    if end >= file_size:
        end = file_size - 1

    length = end - start + 1
    headers["Content-Length"] = str(length)
    headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    return StreamingResponse(
        _iter_file(apk_path, start, length),
        status_code=206,
        media_type="application/vnd.android.package-archive",
        headers=headers,
    )
