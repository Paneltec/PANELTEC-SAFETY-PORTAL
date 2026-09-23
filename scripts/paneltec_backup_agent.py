#!/usr/bin/env python3
"""Paneltec Civil — LAN backup agent.

Runs on a small always-on box on the customer's LAN (a UGREEN NAS
Docker container is the reference target, a Raspberry Pi / Synology /
QNAP also work). Every ``PANELTEC_POLL`` seconds it:

1.  Calls ``GET /api/backup/agent/pending`` on the Civil Hub with its
    Agent bearer token.
2.  If the Hub reports a snapshot newer than the last one this agent
    delivered, downloads the ZIP from
    ``GET /api/backup/snapshots/<id>/data`` and writes it to
    ``PANELTEC_LOCAL_DIR`` (bind-mounted host folder — the default
    docker-compose lands it in the NAS's shared backup folder).
3.  Optionally ships the same bytes to any enabled SMB destinations
    the Hub returned (using ``pysmb`` if it's installed — the
    docker-compose installs it best-effort). SMB failures never block
    the local write.
4.  Reports the outcome to ``POST /api/backup/agent/report`` along
    with a fresh ``disk_usage`` snapshot and any mDNS-discovered
    ``_smb._tcp`` services (best-effort, only if ``zeroconf`` is
    installed).

The Hub embeds the agent's token and hub URL at download time by
substituting the ``__AGENT_TOKEN__`` / ``__HUB_URL__`` placeholders
below. If those are still literal after substitution (e.g. someone
ran the script directly from disk without going through
``/api/backup/agent/install.py``), we fall back to reading the
matching env vars from the docker-compose template.

This file MUST stay importable without the optional deps — the
docker-compose retries pip up to 3× but if pypi is unreachable we
still want ``import requests`` to fail fast with a clear log line.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import shutil
import socket
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ── Constants populated by the Hub at download time ───────────────
# `backup_service.py:1313-1314` does `source.replace("__HUB_URL__", …)`
# and `source.replace("__AGENT_TOKEN__", …)` when serving this file
# via /api/backup/agent/install.py. If either placeholder is still
# present when the script starts (someone bypassed that path) we fall
# back to env vars — the docker-compose sets `HUB_URL` and
# `AGENT_TOKEN` explicitly anyway.
HUB_URL_TEMPLATE = "__HUB_URL__"
AGENT_TOKEN_TEMPLATE = "__AGENT_TOKEN__"

HUB_URL = (
    HUB_URL_TEMPLATE
    if not HUB_URL_TEMPLATE.startswith("__")
    else os.environ.get("HUB_URL", "").rstrip("/")
)
AGENT_TOKEN = (
    AGENT_TOKEN_TEMPLATE
    if not AGENT_TOKEN_TEMPLATE.startswith("__")
    else os.environ.get("AGENT_TOKEN", "")
)

LOCAL_DIR = Path(os.environ.get("PANELTEC_LOCAL_DIR", "/data"))
POLL_SECONDS = int(os.environ.get("PANELTEC_POLL", "60") or "60")
# How long to look back for the "already delivered" check on cold
# start. We persist the last-delivered-id on disk in a small state
# file so restarts don't re-download an existing snapshot.
STATE_FILE = LOCAL_DIR / ".paneltec-agent-state.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-5s | paneltec-agent | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("paneltec-agent")


# ── Optional dependencies (fail soft; never block local delivery) ─
try:
    import requests
except ImportError:  # pragma: no cover — docker-compose retries this
    log.error("FATAL: `requests` is not installed. Aborting.")
    sys.exit(2)

try:
    from smb.SMBConnection import SMBConnection  # pysmb
    _HAS_SMB = True
except Exception:
    _HAS_SMB = False
    log.info("pysmb not available — SMB destinations will be skipped.")

try:
    from zeroconf import ServiceBrowser, ServiceStateChange, Zeroconf
    _HAS_ZEROCONF = True
except Exception:
    _HAS_ZEROCONF = False


# =====================================================================
# Small helpers
# =====================================================================
def _load_state() -> Dict[str, Any]:
    try:
        return json.loads(STATE_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_state(state: Dict[str, Any]) -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=2))
    except OSError as e:
        log.warning("could not persist agent state: %s", e)


def _headers() -> Dict[str, str]:
    return {"Authorization": f"Agent {AGENT_TOKEN}"}


def _disk_usage_for(path: Path) -> Dict[str, int]:
    """Snapshot of the local backup folder's disk. Powers the Hub UI's
    'X GB free of Y TB' gauge in the LAN status card."""
    try:
        du = shutil.disk_usage(str(path))
        return {"total": du.total, "used": du.used, "free": du.free}
    except OSError as e:
        log.warning("disk_usage failed for %s: %s", path, e)
        return {}


def _mdns_discover(timeout: float = 4.0) -> List[Dict[str, Any]]:
    """Best-effort mDNS scan for `_smb._tcp` services so the Hub UI can
    show the operator any NAS shares on their LAN without them having
    to SSH anywhere. Returns [] if zeroconf isn't installed."""
    if not _HAS_ZEROCONF:
        return []
    found: List[Dict[str, Any]] = []

    def _on_change(zc, service_type, name, state_change):
        if state_change is not ServiceStateChange.Added:
            return
        info = zc.get_service_info(service_type, name, timeout=1500)
        if not info:
            return
        addrs = [socket.inet_ntoa(a) for a in (info.addresses or [])]
        found.append({
            "name": name,
            "server": info.server,
            "addresses": addrs,
            "port": info.port,
            "type": service_type,
        })

    zc = Zeroconf()
    try:
        ServiceBrowser(zc, "_smb._tcp.local.", handlers=[_on_change])
        time.sleep(timeout)
    finally:
        try:
            zc.close()
        except Exception:
            pass
    return found


# =====================================================================
# Hub HTTP wrappers
# =====================================================================
def hub_pending() -> Optional[Dict[str, Any]]:
    """Ask the Hub what (if anything) we should be shipping right now."""
    try:
        r = requests.get(
            f"{HUB_URL}/api/backup/agent/pending",
            headers=_headers(),
            timeout=30,
        )
    except requests.RequestException as e:
        log.warning("pending: network error: %s", e)
        return None
    if r.status_code == 401:
        log.error("pending: 401 unauthorised — token rotated? Sleeping.")
        return None
    if not r.ok:
        log.warning("pending: %s %s", r.status_code, r.text[:200])
        return None
    return r.json()


# ── Cooldown state for hub_download — v58.13.132ll ──────────
# Guards against infinite disk-churn when a snapshot's payload is
# permanently corrupted on the hub. After 3 consecutive sha256
# mismatches we park the snapshot_id for 10 min so the outer poll
# loop doesn't re-download the same broken bytes every 60s.
_SNAPSHOT_SHA_FAILS: Dict[str, int] = {}      # snap_id → consecutive fails
_SNAPSHOT_COOLDOWN: Dict[str, float] = {}     # snap_id → unix ts to resume


def _resumable_get_stream(
    url: str,
    dst_part: Path,
    expected_size: int = 0,
    expected_sha256: Optional[str] = None,
    headers_extra: Optional[Dict[str, str]] = None,
    log_tag: str = "dl",
    max_retries: int = 10,
    max_sha_retries: int = 3,
) -> Tuple[int, str]:
    """v58.13.132lk — Resumable streaming download.
    v58.13.132ll — Hardened against three regressions surfaced by
    the first .132lk snapshot pull:

      * FastAPI's default HEAD-on-a-GET-route returns 405 with a
        31-byte JSON body. If the caller HEAD-probed and passed
        that 31 as ``expected_size``, our old early-break
        ``have >= expected_size`` accepted a 573 MB partial as
        "success" on retry #2. Fix: **always trust the first GET
        response's Content-Length over any caller-supplied
        expected_size that disagrees materially**. Log the
        correction so operators see it.
      * On sha256 mismatch we used to raise immediately. Now we
        wipe the ``.part``, retry the full download up to
        ``max_sha_retries`` times, and only THEN raise. Prevents
        the "sha fails → next poll starts over → sha fails
        again" infinite disk-churn loop.
      * ``expected_size <= 0`` fast-path (HEAD was 405, no
        Content-Length available) — helper now discovers size
        from the FIRST successful GET's Content-Length header.

    Returns ``(bytes_written, sha256_hex)``. Raises RuntimeError
    only on hard failure (max_retries hit OR max_sha_retries hit).
    """
    import time as _time
    backoff = [2, 5, 15, 30, 60]
    ua_header = {"User-Agent": "Mozilla/5.0 paneltec-agent"}
    if headers_extra:
        ua_header.update(headers_extra)

    dst_part.parent.mkdir(parents=True, exist_ok=True)

    sha_attempts = 0
    while True:   # OUTER loop — sha mismatch retries
        # HEAD probe if caller didn't give us a size AND we haven't
        # locked one in from a prior GET.
        if expected_size <= 0:
            try:
                head = requests.head(
                    url, headers=ua_header,
                    timeout=(15, 60), allow_redirects=True,
                )
                if head.status_code < 400:
                    cl = head.headers.get("Content-Length")
                    if cl and cl.isdigit():
                        expected_size = int(cl)
            except Exception as e:   # noqa: BLE001
                log.debug("[%s] HEAD probe failed (non-fatal): %s",
                             log_tag, e)

        last_err: Optional[str] = None
        for attempt in range(max_retries):
            have = dst_part.stat().st_size if dst_part.exists() else 0
            if expected_size > 0 and have >= expected_size:
                break

            # Rehash whatever's already on disk so sha stays
            # correct across resumes.
            h = _hashlib.sha256()
            if have > 0:
                with dst_part.open("rb") as fh:
                    while True:
                        b = fh.read(1024 * 1024)
                        if not b:
                            break
                        h.update(b)

            req_headers = dict(ua_header)
            if have > 0 and expected_size > 0:
                req_headers["Range"] = f"bytes={have}-{expected_size - 1}"
                log.info("[%s] attempt %d/%d  RESUME @ byte %d/%d",
                           log_tag, attempt + 1, max_retries, have,
                           expected_size)
            else:
                log.info("[%s] attempt %d/%d  fresh GET (have=%d expect=%d)",
                           log_tag, attempt + 1, max_retries, have,
                           expected_size)

            try:
                with requests.get(
                    url,
                    stream=True,
                    headers=req_headers,
                    timeout=(30, 900),
                ) as r:
                    if r.status_code not in (200, 206):
                        raise RuntimeError(
                            f"HTTP {r.status_code} at byte {have}"
                        )

                    # v58.13.132ll — trust GET Content-Length over
                    # any caller-supplied bogus size. For a 200
                    # response C-L is total size; for a 206 it's
                    # the size of THIS range (end-start+1), so we
                    # only overwrite from 200s.
                    if r.status_code == 200:
                        cl = r.headers.get("Content-Length")
                        if cl and cl.isdigit():
                            true_size = int(cl)
                            if expected_size == 0:
                                log.info("[%s] locked size=%d "
                                            "from GET Content-Length",
                                            log_tag, true_size)
                                expected_size = true_size
                            elif (
                                true_size > 0
                                and abs(true_size - expected_size)
                                    / true_size > 0.10
                            ):
                                log.warning(
                                    "[%s] caller expected_size=%d "
                                    "disagrees with GET C-L=%d by >10%%; "
                                    "trusting server",
                                    log_tag, expected_size, true_size,
                                )
                                expected_size = true_size

                    # Server ignored our Range request?
                    if have > 0 and r.status_code == 200:
                        log.warning("[%s] server ignored Range — "
                                       "wiping .part, restarting from 0",
                                       log_tag)
                        dst_part.unlink()
                        have = 0
                        h = _hashlib.sha256()

                    mode = "ab" if have > 0 else "wb"
                    with dst_part.open(mode) as fh:
                        for chunk in r.iter_content(chunk_size=1 << 16):
                            if not chunk:
                                continue
                            fh.write(chunk)
                            h.update(chunk)
                            have += len(chunk)

                if expected_size > 0 and have < expected_size:
                    raise RuntimeError(
                        f"stream ended at byte {have}, "
                        f"expected {expected_size}"
                    )
                break   # network-attempt success
            except (
                requests.exceptions.ChunkedEncodingError,
                requests.exceptions.ConnectionError,
                requests.exceptions.Timeout,
                requests.exceptions.SSLError,
                requests.exceptions.ReadTimeout,
                RuntimeError,
            ) as e:
                last_err = f"{type(e).__name__}: {e}"
                wait = backoff[attempt] if attempt < len(backoff) else 60
                log.warning(
                    "[%s] attempt %d/%d failed at byte %d: %s"
                    " — retry in %ds",
                    log_tag, attempt + 1, max_retries, have,
                    last_err, wait,
                )
                _time.sleep(wait)
        else:
            raise RuntimeError(
                f"{log_tag} exceeded {max_retries} network retries "
                f"(last_err={last_err})"
            )

        # ── SHA verify ─────────────────────────────────────
        got_sha = h.hexdigest()
        if not expected_sha256 or got_sha == expected_sha256:
            return have, got_sha

        # sha mismatch — likely from a corrupted partial we
        # appended over. Wipe and try the full download again.
        sha_attempts += 1
        log.error(
            "[%s] SHA MISMATCH after %d bytes  got=%s… expected=%s… "
            "(sha_attempt %d/%d)",
            log_tag, have, got_sha[:12], expected_sha256[:12],
            sha_attempts, max_sha_retries,
        )
        try:
            dst_part.unlink()
        except OSError:
            pass
        if sha_attempts >= max_sha_retries:
            raise RuntimeError(
                f"{log_tag} sha mismatch after {max_sha_retries} "
                f"full-cycle retries (got={got_sha[:12]}… "
                f"expected={expected_sha256[:12]}…)"
            )
        # Wait a bit before retrying to let any edge state clear.
        _time.sleep(30)
        # Loop back to top with a clean .part.


def hub_download(snapshot_id: str, dst: Path) -> Optional[int]:
    """Stream the snapshot ZIP to disk. Returns bytes written on
    success or None on any failure. v58.13.132lk — resumable
    Range downloads. v58.13.132ll — cooldown after 3 sha-mismatch
    full-cycles to stop infinite disk-churn on a broken pipe."""
    import time as _t
    now_ts = _t.time()
    cool_until = _SNAPSHOT_COOLDOWN.get(snapshot_id, 0.0)
    if now_ts < cool_until:
        log.warning(
            "hub_download %s SKIPPED — snapshot in cooldown for "
            "another %.0fs (repeated sha mismatches)",
            snapshot_id, cool_until - now_ts,
        )
        return None

    url = f"{HUB_URL}/api/backup/snapshots/{snapshot_id}/data"
    tmp = dst.with_suffix(dst.suffix + ".part")
    try:
        # HEAD to get Content-Length + X-Snapshot-SHA256. If the
        # hub doesn't implement HEAD (pre-.132ll) it returns 405 —
        # we detect and fall through with expected_size=0 so the
        # helper discovers size from the first GET Content-Length.
        exp_size = 0
        exp_sha: Optional[str] = None
        try:
            head = requests.head(url, headers=_headers(),
                                    timeout=(15, 60),
                                    allow_redirects=True)
            if head.status_code < 400:
                cl = head.headers.get("Content-Length")
                if cl and cl.isdigit():
                    exp_size = int(cl)
                exp_sha = head.headers.get("X-Snapshot-SHA256") or None
            elif head.status_code == 405:
                log.info("hub_download %s: HEAD not supported "
                            "(hub pre-.132ll) — will learn size from "
                            "first GET",
                            snapshot_id)
            else:
                log.warning("hub_download %s HEAD returned %d — "
                               "falling back to GET-only",
                               snapshot_id, head.status_code)
        except Exception as e:   # noqa: BLE001
            log.warning("hub_download %s HEAD errored (%s) — "
                           "falling back to GET-only", snapshot_id, e)

        written, _got_sha = _resumable_get_stream(
            url=url,
            dst_part=tmp,
            expected_size=exp_size,
            expected_sha256=exp_sha,
            headers_extra=_headers(),
            log_tag=f"snap-{snapshot_id[:8]}",
        )
        tmp.replace(dst)
        # Success — clear any prior cooldown.
        _SNAPSHOT_COOLDOWN.pop(snapshot_id, None)
        _SNAPSHOT_SHA_FAILS.pop(snapshot_id, None)
        return written
    except RuntimeError as e:
        msg = str(e)
        if "sha mismatch" in msg:
            n = _SNAPSHOT_SHA_FAILS.get(snapshot_id, 0) + 1
            _SNAPSHOT_SHA_FAILS[snapshot_id] = n
            if n >= 3:
                cool = 600.0   # 10 min
                _SNAPSHOT_COOLDOWN[snapshot_id] = _t.time() + cool
                log.error(
                    "hub_download %s: %d consecutive sha mismatches — "
                    "cooling down for %.0fs to break the retry loop",
                    snapshot_id, n, cool,
                )
        log.error("download %s failed: %s", snapshot_id, msg)
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass
        return None
    except Exception as e:  # noqa: BLE001 — log full trace
        log.error("download %s crashed: %s\n%s",
                  snapshot_id, e, traceback.format_exc())
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass
        return None


def hub_report(payload: Dict[str, Any]) -> bool:
    try:
        r = requests.post(
            f"{HUB_URL}/api/backup/agent/report",
            headers=_headers(),
            json=payload,
            timeout=30,
        )
    except requests.RequestException as e:
        log.warning("report: network error: %s", e)
        return False
    if not r.ok:
        log.warning("report: %s %s", r.status_code, r.text[:200])
        return False
    return True


# =====================================================================
# SMB destination writes (best-effort; local write is authoritative)
# =====================================================================
def _ship_to_smb(dest: Dict[str, Any], local_zip: Path,
                 snapshot_id: str) -> Dict[str, Any]:
    """Copy a locally-downloaded snapshot to one SMB destination. All
    exceptions are caught so a bad destination can never take out the
    local-first delivery path."""
    result = {
        "destination_id": dest.get("id"),
        "target_path": None,
        "bytes_written": None,
        "status": "fail",
        "error": None,
    }
    if not _HAS_SMB:
        result["error"] = "pysmb not installed"
        return result
    host = dest.get("host") or ""
    share = dest.get("share") or ""
    prefix = (dest.get("path_prefix") or "").strip("/")
    user = dest.get("username") or "guest"
    pw = dest.get("password") or ""
    if not host or not share:
        result["error"] = "destination missing host/share"
        return result

    remote_name = f"{prefix}/{local_zip.name}" if prefix else local_zip.name
    result["target_path"] = f"//{host}/{share}/{remote_name}"

    conn = None
    try:
        conn = SMBConnection(user, pw,
                             socket.gethostname(),
                             host,
                             use_ntlm_v2=True)
        if not conn.connect(host, 445, timeout=30):
            result["error"] = f"SMBConnection.connect({host}:445) → False"
            return result
        # Best-effort mkdir chain for path_prefix subfolders.
        parts = [p for p in prefix.split("/") if p]
        cur = ""
        for p in parts:
            cur = f"{cur}/{p}" if cur else p
            try:
                conn.createDirectory(share, cur)
            except Exception:
                pass  # already exists — fine
        with local_zip.open("rb") as fh:
            conn.storeFile(share, remote_name, fh)
        result["bytes_written"] = local_zip.stat().st_size
        result["status"] = "ok"
    except Exception as e:  # noqa: BLE001
        result["error"] = str(e)[:250]
        log.warning("SMB ship to %s failed: %s",
                    result["target_path"], result["error"])
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
    return result


# =====================================================================
# Main loop
# =====================================================================
# ── v58.13.132lf — bi-directional NAS file ops ────────────────
# The Hub piggy-backs `nas_ops` on every `/agent/pending` poll. Each
# op is signed with HMAC-SHA256 over its canonical payload using
# `NAS_AGENT_SHARED_SECRET` (same secret in the Hub's backend/.env).
# We verify the signature before touching disk, execute locally
# against `<NAS_ROOT>/paneltec-files/…`, and POST the result to
# `/agent/nas-op-result`. Never trust the op — validate every path
# stays under the root prefix (path-traversal defence).

import hashlib as _hashlib
import hmac as _hmac
import base64 as _base64

_NAS_HMAC_SECRET = os.environ.get("NAS_AGENT_SHARED_SECRET", "").strip()
_NAS_ROOT = Path(os.environ.get(
    "NAS_ROOT", os.environ.get("PANELTEC_LOCAL_DIR", "/data"),
)) / "paneltec-files"


def _nas_canonical(op: str, path: str, body_b64: str,
                     enqueued_at: str) -> bytes:
    return f"{op}|{path}|{body_b64 or ''}|{enqueued_at}".encode("utf-8")


def _nas_canonical_fetch(path: str, source_url: str,
                            expected_sha256: str, expected_size: int,
                            enqueued_at: str) -> bytes:
    """v58.13.132lj — streaming-op canonical. Must match the pod's
    `nas_ops_service._canonical_fetch()`."""
    return (
        f"fetch_and_put|{path}|{source_url}|{expected_sha256}|"
        f"{expected_size}|{enqueued_at}"
    ).encode("utf-8")


def _nas_verify_hmac(op_row: Dict[str, Any]) -> bool:
    if not _NAS_HMAC_SECRET:
        log.warning("[nas-ops] NAS_AGENT_SHARED_SECRET missing — "
                       "refusing to execute op id=%s", op_row.get("id"))
        return False
    op = op_row.get("op") or ""
    if op == "fetch_and_put":
        m = op_row.get("meta") or {}
        payload = _nas_canonical_fetch(
            op_row.get("path", ""),
            m.get("source_url", ""),
            m.get("expected_sha256", ""),
            int(m.get("expected_size", 0)),
            op_row.get("enqueued_at", ""),
        )
    else:
        payload = _nas_canonical(
            op, op_row.get("path", ""),
            op_row.get("body_b64") or "",
            op_row.get("enqueued_at", ""),
        )
    expected = _hmac.new(
        _NAS_HMAC_SECRET.encode("utf-8"),
        payload,
        _hashlib.sha256,
    ).hexdigest()
    return _hmac.compare_digest(expected, op_row.get("hmac") or "")


def _nas_safe_path(rel: str) -> Path:
    """Resolve `rel` under `_NAS_ROOT` and ensure the result stays
    inside the root — protects against `..` traversal and absolute
    paths in op payloads."""
    p = (_NAS_ROOT / rel.lstrip("/")).resolve()
    root = _NAS_ROOT.resolve()
    try:
        p.relative_to(root)
    except ValueError:
        raise ValueError(f"path traversal blocked: {rel!r}")
    return p


def _nas_disk_usage() -> Dict[str, Any]:
    """du snapshot for the NAS ROOT (Ugreen 14 TB volume typically)."""
    _NAS_ROOT.mkdir(parents=True, exist_ok=True)
    du = shutil.disk_usage(str(_NAS_ROOT))
    return {
        "free_gb": round(du.free / (1024 ** 3), 2),
        "used_gb": round(du.used / (1024 ** 3), 2),
        "total_gb": round(du.total / (1024 ** 3), 2),
    }


def _nas_execute(op_row: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a single verified op locally. Never raises — returns
    an `{"status": "done"|"error", "result"|"error"}` dict."""
    op = op_row.get("op")
    path = op_row.get("path") or ""
    try:
        if op == "ping":
            return {"status": "done", "result": {
                "agent_time": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                              time.gmtime()),
                **_nas_disk_usage(),
            }}

        if op == "stat":
            fp = _nas_safe_path(path)
            if not fp.exists():
                return {"status": "done", "result": {
                    "path": path, "exists": False,
                }}
            st = fp.stat()
            sha = ""
            if fp.is_file():
                h = _hashlib.sha256()
                with fp.open("rb") as fh:
                    for chunk in iter(lambda: fh.read(65536), b""):
                        h.update(chunk)
                sha = h.hexdigest()
            return {"status": "done", "result": {
                "path": path, "exists": True,
                "size": st.st_size, "sha256": sha,
                "mtime": int(st.st_mtime), "is_dir": fp.is_dir(),
            }}

        if op == "list_dir":
            fp = _nas_safe_path(path)
            if not fp.exists():
                return {"status": "error",
                        "error": f"not found: {path!r}"}
            if not fp.is_dir():
                return {"status": "error",
                        "error": f"not a directory: {path!r}"}
            entries = []
            for child in sorted(fp.iterdir()):
                cst = child.stat()
                entries.append({
                    "name": child.name,
                    "is_dir": child.is_dir(),
                    "size": cst.st_size if child.is_file() else 0,
                    "mtime": int(cst.st_mtime),
                })
            return {"status": "done",
                    "result": {"path": path, "entries": entries}}

        if op == "put_file":
            fp = _nas_safe_path(path)
            fp.parent.mkdir(parents=True, exist_ok=True)
            body = _base64.b64decode(op_row.get("body_b64") or "")
            fp.write_bytes(body)
            st = fp.stat()
            sha = _hashlib.sha256(body).hexdigest()
            # Sidecar meta for later reconciliation (source_id from
            # Dropbox etc. when Phase 2b runs).
            meta = op_row.get("meta") or {}
            if meta:
                mp = fp.with_name(fp.name + ".meta.json")
                try:
                    mp.write_text(json.dumps(meta, indent=2))
                except OSError as e:
                    log.warning("[nas-ops] meta sidecar write failed "
                                   "%s: %s", mp, e)
            return {"status": "done", "result": {
                "path": path, "size": st.st_size, "sha256": sha,
                "mtime": int(st.st_mtime),
            }}

        if op == "get_file":
            fp = _nas_safe_path(path)
            if not fp.exists() or not fp.is_file():
                return {"status": "error",
                        "error": f"not a file: {path!r}"}
            body = fp.read_bytes()
            return {"status": "done", "result": {
                "path": path, "size": len(body),
                "sha256": _hashlib.sha256(body).hexdigest(),
                "body_b64": _base64.b64encode(body).decode("ascii"),
            }}

        if op == "delete_file":
            fp = _nas_safe_path(path)
            if not fp.exists():
                return {"status": "done", "result": {
                    "path": path, "deleted": False,
                    "reason": "not found",
                }}
            if fp.is_dir():
                return {"status": "error",
                        "error": f"refusing to delete directory: {path!r}"}
            fp.unlink()
            # Best-effort sidecar cleanup.
            side = fp.with_name(fp.name + ".meta.json")
            try:
                if side.exists():
                    side.unlink()
            except OSError:
                pass
            return {"status": "done",
                    "result": {"path": path, "deleted": True}}

        if op == "fetch_and_put":
            # v58.13.132lj — streaming transport.
            # v58.13.132lk — now uses the shared resumable helper so
            # Cloudflare-cut streams resume via HTTP Range instead of
            # silently stalling in `_nas_execute`'s except-guard.
            m = op_row.get("meta") or {}
            source_url = m.get("source_url") or ""
            expected_sha = m.get("expected_sha256") or ""
            expected_size = int(m.get("expected_size") or 0)
            if not source_url:
                return {"status": "error",
                        "error": "fetch_and_put missing meta.source_url"}
            fp = _nas_safe_path(path)
            fp.parent.mkdir(parents=True, exist_ok=True)
            tmp = fp.with_name(fp.name + ".part")
            try:
                written, got_sha = _resumable_get_stream(
                    url=source_url,
                    dst_part=tmp,
                    expected_size=expected_size,
                    expected_sha256=expected_sha or None,
                    log_tag=f"nas-fetch-{path[-40:]}",
                )
            except RuntimeError as e:
                try:
                    if tmp.exists():
                        tmp.unlink()
                except OSError:
                    pass
                return {"status": "error", "error": str(e)}
            except Exception as e:   # noqa: BLE001
                try:
                    if tmp.exists():
                        tmp.unlink()
                except OSError:
                    pass
                return {"status": "error",
                        "error": f"download failed: {type(e).__name__}: {e}"}

            # Atomic rename into place.
            tmp.replace(fp)
            # Sidecar meta for reconciliation.
            side_meta = {k: v for k, v in m.items() if k not in (
                "source_url", "expected_sha256", "expected_size",
            )}
            if side_meta:
                mp = fp.with_name(fp.name + ".meta.json")
                try:
                    mp.write_text(json.dumps(side_meta, indent=2))
                except OSError as e:
                    log.warning("[nas-ops] meta sidecar write failed "
                                   "%s: %s", mp, e)
            st = fp.stat()
            return {"status": "done", "result": {
                "path": path, "size": st.st_size,
                "sha256": got_sha, "mtime": int(st.st_mtime),
            }}

        return {"status": "error",
                "error": f"unknown op: {op!r}"}
    except Exception as e:  # noqa: BLE001 — errors go over the wire
        return {"status": "error", "error": f"{type(e).__name__}: {e}"}


def _nas_report(op_id: str, outcome: Dict[str, Any]) -> None:
    try:
        r = requests.post(
            f"{HUB_URL}/api/backup/agent/nas-op-result",
            headers={**_headers(), "Content-Type": "application/json"},
            json={"op_id": op_id, **outcome},
            timeout=30,
        )
        if r.status_code != 200:
            log.warning("[nas-ops] result POST HTTP %s body=%s",
                          r.status_code, r.text[:200])
    except requests.RequestException as e:
        log.warning("[nas-ops] result POST failed: %s", e)


def _drain_nas_ops(ops: List[Dict[str, Any]]) -> None:
    if not ops:
        return
    log.info("[nas-ops] draining %d op(s)", len(ops))
    for op_row in ops:
        op_id = op_row.get("id")
        op = op_row.get("op")
        path = op_row.get("path")
        if not _nas_verify_hmac(op_row):
            log.warning("[nas-ops] HMAC verify FAILED op=%s path=%s "
                           "id=%s — refusing", op, path, op_id)
            _nas_report(op_id, {"status": "error",
                                  "error": "hmac verify failed"})
            continue
        outcome = _nas_execute(op_row)
        log.info("[nas-ops] executed op=%s path=%s status=%s",
                    op, path, outcome.get("status"))
        _nas_report(op_id, outcome)


def _one_pass(state: Dict[str, Any]) -> None:
    pending = hub_pending()
    if not pending:
        return

    # v58.13.132lf — drain any queued NAS ops before we consider
    # snapshot work. Ops are executed back-to-back (with a re-poll
    # between drains) so a batch of writes coming from the Hub
    # doesn't have to wait for the next idle poll.
    _drain_nas_ops(pending.get("nas_ops") or [])

    snap = pending.get("snapshot")
    dests = pending.get("destinations") or []
    if not snap:
        # No snapshot exists yet on the Hub. Still send a heartbeat
        # so the Hub UI shows this agent as alive.
        hub_report({
            "snapshot_id": "none",
            "status": "ok",
            "disk_usage": _disk_usage_for(LOCAL_DIR),
            "mdns_services": _mdns_discover(),
        })
        return

    snap_id = snap.get("id")
    if not snap_id:
        log.warning("pending returned snapshot without id: %s", snap)
        return

    last_delivered = state.get("last_delivered_snapshot_id")
    local_zip = LOCAL_DIR / f"paneltec-civil-{snap_id}.zip"

    if snap_id == last_delivered and local_zip.exists():
        # Nothing new. Heartbeat only.
        hub_report({
            "snapshot_id": "none",
            "status": "ok",
            "disk_usage": _disk_usage_for(LOCAL_DIR),
        })
        return

    log.info("new snapshot %s (%s bytes) — downloading", snap_id, snap.get("size"))
    written = hub_download(snap_id, local_zip)
    if written is None:
        hub_report({
            "snapshot_id": snap_id,
            "status": "fail",
            "error": "download failed",
            "disk_usage": _disk_usage_for(LOCAL_DIR),
        })
        return

    # SHA256 integrity — the Hub gives us the expected hash so we can
    # verify the wire-level integrity before we report success.
    expected_sha = (snap.get("sha256") or "").strip().lower()
    if expected_sha:
        sha = hashlib.sha256()
        with local_zip.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 16), b""):
                sha.update(chunk)
        got = sha.hexdigest()
        if got != expected_sha:
            log.error("sha256 MISMATCH for %s (got %s… expected %s…)",
                      snap_id, got[:12], expected_sha[:12])
            hub_report({
                "snapshot_id": snap_id,
                "status": "fail",
                "error": f"sha256 mismatch got={got[:16]} expected={expected_sha[:16]}",
                "bytes_written": written,
                "disk_usage": _disk_usage_for(LOCAL_DIR),
            })
            return

    log.info("wrote %s (%s bytes) OK", local_zip, written)

    # Ship to every enabled SMB destination.
    ship_reports = []
    for dest in dests:
        if (dest.get("kind") or "smb_lan") != "smb_lan":
            continue
        res = _ship_to_smb(dest, local_zip, snap_id)
        ship_reports.append(res)

    # Persist last-delivered so a restart doesn't re-download.
    state["last_delivered_snapshot_id"] = snap_id
    state["last_delivered_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                               time.gmtime())
    _save_state(state)

    # Report the LOCAL delivery (authoritative). SMB ship results
    # ride on the same audit trail as additional rows if any failed —
    # keeps a single canonical "did the snapshot land" signal.
    hub_report({
        "snapshot_id": snap_id,
        "status": "ok",
        "bytes_written": written,
        "target_path": str(local_zip),
        "disk_usage": _disk_usage_for(LOCAL_DIR),
        "mdns_services": _mdns_discover(),
    })
    for r in ship_reports:
        # Only bother the Hub with SMB reports that actually attempted
        # a write (skip missing-pysmb noise).
        if r.get("error") == "pysmb not installed":
            continue
        hub_report({
            "snapshot_id": snap_id,
            "destination_id": r["destination_id"],
            "status": r["status"],
            "bytes_written": r["bytes_written"],
            "target_path": r["target_path"],
            "error": r["error"],
        })


def main() -> None:
    if not HUB_URL or not AGENT_TOKEN:
        log.error("FATAL: HUB_URL and AGENT_TOKEN must be set "
                  "(via install.py substitution or docker-compose env). "
                  "HUB_URL=%r AGENT_TOKEN=%r",
                  HUB_URL, AGENT_TOKEN[:8] + "…" if AGENT_TOKEN else "")
        sys.exit(3)

    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    state = _load_state()
    log.info("Paneltec Civil backup agent starting up.")
    log.info("  HUB_URL          = %s", HUB_URL)
    log.info("  LOCAL_DIR        = %s", LOCAL_DIR)
    log.info("  POLL             = %s s", POLL_SECONDS)
    log.info("  host             = %s (%s)", socket.gethostname(),
             platform.platform())
    log.info("  last_delivered   = %s",
             state.get("last_delivered_snapshot_id") or "(none)")
    log.info("  optional deps    = pysmb:%s  zeroconf:%s",
             _HAS_SMB, _HAS_ZEROCONF)

    while True:
        try:
            _one_pass(state)
        except Exception as e:  # noqa: BLE001 — never let the loop die
            log.error("one_pass crashed: %s\n%s", e, traceback.format_exc())
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
