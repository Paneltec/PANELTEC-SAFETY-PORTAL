"""v58.13.132lf — Pod-side NAS client facade.

Sync-looking async API for reading/writing files on the UGREEN NAS
via the LAN agent tunnel. Callers don't need to know about the
underlying poll-queue-drain machinery — they just call
`await nas.put_file(...)` and get bytes back.

Retry policy: 3 attempts with exponential backoff (0.5s → 1s → 2s)
on transient failures (agent disconnected mid-flight). Timeouts:
30s per op for metadata calls, 5 min for large files (`put_file` /
`get_file` with body >1 MB).

NEVER logs body bytes. Path + size only.
"""
from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any, Dict, List, Optional

from nas_ops_service import enqueue_op, wait_for_result

log = logging.getLogger("paneltec.nas.client")

_DEFAULT_TIMEOUT_S = 30.0
_LARGE_FILE_TIMEOUT_S = 5 * 60.0
_LARGE_FILE_THRESHOLD = 1_000_000  # 1 MB


class NasError(RuntimeError):
    """Raised when a NAS op fails on the agent side or times out."""


async def _run(op: str, path: str, body_b64: Optional[str] = None,
                 timeout_s: float = _DEFAULT_TIMEOUT_S,
                 meta: Optional[Dict[str, Any]] = None,
                 retries: int = 2) -> Dict[str, Any]:
    """Enqueue → wait → return result. Retries the whole cycle on
    transient failures. Never raises on timeout — surfaces as
    `NasError`."""
    last_err = None
    delay = 0.5
    for attempt in range(retries + 1):
        row = await enqueue_op(op, path, body_b64, meta=meta)
        settled = await wait_for_result(row["id"], timeout_s=timeout_s)
        status = settled.get("status")
        if status == "done":
            log.info("[nas-client] ok op=%s path=%s attempts=%d",
                       op, path, attempt + 1)
            return settled.get("result") or {}
        if status == "error":
            last_err = settled.get("error") or "unknown error"
            log.warning("[nas-client] agent err op=%s path=%s err=%s",
                          op, path, last_err)
        elif status == "timeout":
            last_err = f"timed out after {timeout_s}s"
            log.warning("[nas-client] timeout op=%s path=%s", op, path)
        else:
            last_err = f"unexpected status {status!r}"
        if attempt < retries:
            await asyncio.sleep(delay)
            delay *= 2
    raise NasError(f"op={op} path={path} failed: {last_err}")


# ── Public API ─────────────────────────────────────────────────
async def put_file(path: str, body: bytes,
                     meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Write bytes to `<NAS_ROOT>/paneltec-files/<path>`. Returns
    `{path, size, sha256, mtime}`."""
    b64 = base64.b64encode(body).decode("ascii")
    timeout = _LARGE_FILE_TIMEOUT_S if len(body) > _LARGE_FILE_THRESHOLD else _DEFAULT_TIMEOUT_S
    return await _run("put_file", path, body_b64=b64,
                        timeout_s=timeout, meta=meta)


async def fetch_and_put(path: str, source_url: str,
                          expected_sha256: str, expected_size: int,
                          meta: Optional[Dict[str, Any]] = None,
                          timeout_s: float = 30 * 60.0,
                          agent_id: Optional[str] = None) -> Dict[str, Any]:
    """v58.13.132lj — streaming transport. Agent downloads directly
    from `source_url` (typically a Dropbox `files_get_temporary_link`
    URL or a pod-served probe blob URL) to a temp file on the NAS,
    verifies sha256, and atomic-renames into
    `<NAS_ROOT>/paneltec-files/<path>`. Body bytes never traverse
    the pod-to-agent HTTP body — signed URL is the transport, HMAC
    signs `path|source_url|expected_sha256|expected_size`.

    v58.13.132mg — `agent_id` param added. If omitted, `enqueue_op`
    falls back to the most-recent-poller default (freshest-wins) —
    which was routing Dropbox-migration ops to a stale Office Pi
    agent that couldn't handle `fetch_and_put`. Callers that care
    which agent runs the op (the Dropbox → NAS migration engine
    passes `958bf283-…` for `ugreen-nas`) MUST thread the id here.

    Default timeout 30 min (bulk-copy jobs will call with longer).
    Returns `{path, size, sha256, mtime}` — same shape as `put_file`."""
    full_meta = dict(meta or {})
    full_meta.update({
        "source_url": source_url,
        "expected_sha256": expected_sha256,
        "expected_size": int(expected_size),
    })
    row = await enqueue_op("fetch_and_put", path, body_b64=None,
                             meta=full_meta, agent_id=agent_id)
    settled = await wait_for_result(row["id"], timeout_s=timeout_s)
    status = settled.get("status")
    if status == "done":
        return settled.get("result") or {}
    if status == "error":
        raise NasError(
            f"fetch_and_put path={path} agent_error="
            f"{settled.get('error') or 'unknown'}"
        )
    raise NasError(
        f"fetch_and_put path={path} timeout after {timeout_s}s "
        f"(op_id={row['id']})"
    )


async def get_file(path: str) -> bytes:
    """Read bytes from `<NAS_ROOT>/paneltec-files/<path>`.
    Raises `NasError` on missing/permission/timeout."""
    result = await _run("get_file", path, timeout_s=_LARGE_FILE_TIMEOUT_S)
    b64 = result.get("body_b64") or ""
    return base64.b64decode(b64) if b64 else b""


async def stat(path: str) -> Dict[str, Any]:
    """Return `{path, size, sha256, mtime, exists}` for a file."""
    return await _run("stat", path)


async def list_dir(path: str) -> List[Dict[str, Any]]:
    """List directory entries: `[{name, is_dir, size, mtime}]`."""
    result = await _run("list_dir", path)
    return result.get("entries") or []


async def delete_file(path: str) -> Dict[str, Any]:
    """Delete a file. Returns `{path, deleted: bool}`."""
    return await _run("delete_file", path)


async def ping() -> Dict[str, Any]:
    """Round-trip ping via the tunnel. Returns
    `{agent_time, nas_free_gb, nas_used_gb, roundtrip_ms}`."""
    import time
    t0 = time.time()
    result = await _run("ping", "/", timeout_s=15.0)
    rtt = (time.time() - t0) * 1000
    result["roundtrip_ms"] = round(rtt, 1)
    return result
