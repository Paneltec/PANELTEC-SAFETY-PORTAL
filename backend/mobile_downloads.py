"""Mobile app APK download endpoints — v58.13.132ah.

Serves the direct-install Android APK produced by EAS Build.
Public (no auth) — workers scanning onboarding cards can't be
authenticated yet.

Endpoints:
  GET  /api/mobile/downloads/android/latest.apk     → APK file stream
  GET  /api/mobile/downloads/android/version        → metadata JSON
  POST /api/mobile/downloads/android/ingest-from-eas → v58.13.132ix
       admin-only. Fetches the latest FINISHED Android build from
       EAS on the stephenguy account's paneltec-civil-field project,
       downloads the signed APK artifact, and writes it to disk +
       updates android_manifest.json. Requires `EXPO_TOKEN` env var
       (unset by default in this pod — the admin op must export it
       into backend/.env and restart backend before calling).

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
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from auth import get_current_user
from db import db

log = logging.getLogger("paneltec.mobile_downloads")

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


# ─────────────────────── v58.13.132ix — Ingest from EAS ───────────────────────

_EAS_GRAPHQL = "https://api.expo.dev/graphql"
_EAS_APP_SLUG = "paneltec-civil-field"
_EAS_ACCOUNT = "stephenguy"

# v58.13.132ix hotfix (post-cda0f65) — the correct EAS GraphQL entry
# point is `me { accounts { ... } }`; the earlier `accountByName` call
# failed with GRAPHQL_VALIDATION_FAILED. Two-step:
#   1. me → accounts → apps → find the app whose `slug` matches
#      `_EAS_APP_SLUG`. Grab its `id`.
#   2. app.byId(appId) → builds(...) → newest FINISHED with artifact.
_ME_APPS_QUERY = """
query MeAccountsApps {
  me {
    accounts {
      id
      name
      apps(limit: 50, offset: 0) {
        id
        slug
      }
    }
  }
}
"""

_APP_BUILDS_QUERY = """
query AppBuilds($appId: String!) {
  app {
    byId(appId: $appId) {
      builds(
        limit: 5
        offset: 0
        filter: { platform: ANDROID, status: FINISHED, distribution: INTERNAL }
      ) {
        id
        status
        platform
        appVersion
        appBuildVersion
        completedAt
        gitCommitHash
        artifacts { buildUrl }
      }
    }
  }
}
"""


@router.post("/mobile/downloads/android/ingest-from-eas")
async def android_ingest_from_eas(user: dict = Depends(get_current_user)):
    """v58.13.132ix — Admin-only. Pull the latest FINISHED internal
    Android build from EAS, download its APK artifact, and drop it in
    APK_DIR with a refreshed android_manifest.json.

    Reads `EXPO_TOKEN` from the process env. If unset, returns 501 with
    an instruction to add it to backend/.env (not committed).

    Never overwrites the existing on-disk APK/manifest until the new
    file is fully downloaded + sha256'd, so a mid-flight failure leaves
    the previous binary intact and the endpoint keeps serving it.

    v58.13.132p2a — Thin HTTP wrapper around
    :func:`_ingest_latest_finished_android`, which is also called by
    the periodic `eas_apk_ingest_watchdog` scheduler job."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin only")

    log.warning("apk_ingest.invoked by user_id=%s email=%s",
                user.get("id"), user.get("email"))

    result = await _ingest_latest_finished_android(
        source="admin_button",
        actor_user_id=user.get("id"),
    )

    if not result.get("ok"):
        code = result.get("http_status") or 502
        raise HTTPException(status_code=code, detail=result.get("reason") or "ingest failed")
    return {
        "ok": True,
        "manifest": result["manifest"],
        "message": result.get("message", ""),
    }


async def _ingest_latest_finished_android(
    *,
    source: str,
    actor_user_id: Optional[str] = None,
) -> dict:
    """Pure ingest routine — safe to call from HTTP handlers AND from
    the APScheduler background job.

    Returns a structured dict. Never raises.

        {"ok": True,  "manifest": {...}, "action": "ingested|no-op|same-build",
         "message": str, "build_id": str, "version": str}

        {"ok": False, "reason": str, "http_status": int}

    v58.13.132p2a — factored out of the admin endpoint so the
    `eas_apk_ingest_watchdog` scheduler can call it without going
    through HTTP + fake auth.

    `source` is stamped onto the audit-log row so we can tell which
    ingests were manual vs. scheduled.
    """
    token = os.environ.get("EXPO_TOKEN")
    if not token:
        # Not a hard error for the scheduler — surface it clearly so
        # the tick logs a warning and moves on.
        return {
            "ok": False, "http_status": 501,
            "reason": (
                "EXPO_TOKEN not set in backend env. Add it to "
                "backend/.env then `sudo supervisorctl restart backend`."
            ),
        }

    # 1. Query EAS for the latest FINISHED Android build id.
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        try:
            r1 = await client.post(
                _EAS_GRAPHQL,
                headers={"Authorization": f"Bearer {token}",
                         "Content-Type": "application/json"},
                json={"query": _ME_APPS_QUERY},
            )
        except httpx.HTTPError as exc:
            return {"ok": False, "http_status": 502,
                    "reason": f"EAS unreachable: {exc}"}
        if r1.status_code != 200:
            return {"ok": False, "http_status": 502,
                    "reason": f"EAS GraphQL (me) HTTP {r1.status_code}: {r1.text[:200]}"}
        p1 = r1.json()
        if "errors" in p1:
            return {"ok": False, "http_status": 502,
                    "reason": f"EAS GraphQL (me) error: {p1['errors']!r}"}
        accounts = ((p1.get("data") or {}).get("me") or {}).get("accounts") or []
        app_id: Optional[str] = None
        for acc in accounts:
            if acc.get("name") and acc["name"].lower() != _EAS_ACCOUNT.lower():
                continue
            for a in acc.get("apps") or []:
                if a.get("slug") == _EAS_APP_SLUG:
                    app_id = a.get("id")
                    break
            if app_id:
                break
        if not app_id:
            return {"ok": False, "http_status": 502,
                    "reason": f"EAS app slug {_EAS_APP_SLUG!r} not visible "
                              f"on account {_EAS_ACCOUNT!r}"}

        try:
            r2 = await client.post(
                _EAS_GRAPHQL,
                headers={"Authorization": f"Bearer {token}",
                         "Content-Type": "application/json"},
                json={"query": _APP_BUILDS_QUERY,
                      "variables": {"appId": app_id}},
            )
        except httpx.HTTPError as exc:
            return {"ok": False, "http_status": 502,
                    "reason": f"EAS unreachable: {exc}"}
        if r2.status_code != 200:
            return {"ok": False, "http_status": 502,
                    "reason": f"EAS GraphQL (builds) HTTP {r2.status_code}: {r2.text[:200]}"}
        payload = r2.json()
        if "errors" in payload:
            return {"ok": False, "http_status": 502,
                    "reason": f"EAS GraphQL (builds) error: {payload['errors']!r}"}
        target = ((payload.get("data") or {}).get("app") or {}).get("byId") or {}
        builds = target.get("builds") or []
        pick = next(
            (b for b in builds
             if b.get("status") == "FINISHED"
             and (b.get("artifacts") or {}).get("buildUrl")),
            None,
        )
        if not pick:
            return {"ok": False, "http_status": 404,
                    "reason": "No FINISHED internal Android build with an "
                              "artifact URL found on the last 5 builds."}

        build_id = pick["id"]
        artifact_url = pick["artifacts"]["buildUrl"]
        app_version = pick.get("appVersion") or "unknown"
        app_build_version = pick.get("appBuildVersion") or "unknown"
        completed_at = pick.get("completedAt") or _now_iso()
        git_sha = pick.get("gitCommitHash") or ""

        # Same-build short-circuit — cheap idempotency for the
        # scheduler (avoids re-downloading 141 MB every 5 min).
        current = _read_manifest() or {}
        if current.get("eas_build_id") == build_id:
            return {
                "ok": True, "action": "same-build",
                "manifest": current, "build_id": build_id,
                "version": app_version,
                "message": f"Latest FINISHED build {build_id} is already on disk. No-op.",
            }

        # Version-code monotonicity guard (belt-and-braces).
        try:
            new_code = int(app_build_version)
            cur_code = int(current.get("version_code") or 0)
        except (TypeError, ValueError):
            new_code, cur_code = None, None
        if new_code is not None and cur_code is not None and new_code < cur_code:
            return {
                "ok": False, "http_status": 409,
                "reason": (
                    f"Refusing to downgrade — EAS latest build "
                    f"versionCode {new_code} < manifest {cur_code}. "
                    f"If this is intentional, delete android_manifest.json "
                    f"and re-run."
                ),
            }

        # 2. Download the APK to a temp file first, hash it, then swap.
        APK_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"paneltec-field-app-eas-{build_id}.apk"
        final_path = APK_DIR / filename
        tmp_path = APK_DIR / f".{filename}.partial"

        sha = hashlib.sha256()
        total = 0
        try:
            async with client.stream("GET", artifact_url) as resp:
                if resp.status_code != 200:
                    return {"ok": False, "http_status": 502,
                            "reason": f"EAS artifact HTTP {resp.status_code}"}
                with open(tmp_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(1024 * 512):
                        f.write(chunk)
                        sha.update(chunk)
                        total += len(chunk)
        except httpx.HTTPError as exc:
            tmp_path.unlink(missing_ok=True)
            return {"ok": False, "http_status": 502,
                    "reason": f"APK download failed: {exc}"}

    if total < 5_000_000:  # sanity — a real APK is >5MB
        tmp_path.unlink(missing_ok=True)
        return {"ok": False, "http_status": 502,
                "reason": f"Downloaded artifact suspiciously small ({total} bytes)"}

    sha256 = sha.hexdigest()

    # 3. Atomic swap onto final path, rewrite manifest.
    tmp_path.replace(final_path)

    manifest = {
        "filename": filename,
        "version": app_version,
        "version_code": int(app_build_version) if str(app_build_version).isdigit() else app_build_version,
        "size_bytes": total,
        "sha256": sha256,
        "built_at": completed_at,
        "eas_build_id": build_id,
        "bundle_id": "com.emergent.whscompliance.fv5aib",
        "git_commit": git_sha,
        "synced_at": _now_iso(),
        "synced_by_user_id": actor_user_id,
        "synced_by_source": source,
    }
    APK_MANIFEST.write_text(json.dumps(manifest, indent=2))

    # 4. Audit trail (best-effort).
    try:
        await db.mobile_downloads_manifest.insert_one({
            **manifest,
            "artifact_url": artifact_url,
            "created_at": _now_iso(),
        })
    except Exception as exc:  # noqa: BLE001
        log.warning("apk_ingest.audit_log_failed: %s", exc)

    log.warning("apk_ingest.done source=%s user_id=%s build_id=%s "
                "version=%s size_mb=%.1f sha256=%s",
                source, actor_user_id, build_id, app_version,
                total / (1024 * 1024), sha256)

    return {
        "ok": True, "action": "ingested",
        "manifest": manifest, "build_id": build_id,
        "version": app_version,
        "message": (
            f"Fresh APK from EAS build {build_id} written to disk. "
            f"/api/mobile/downloads/android/latest.apk now serves "
            f"version {app_version} (build {app_build_version})."
        ),
    }



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
