"""Integrations admin — per-org config for Simpro / M365 / TextMagic / Navixy.

Phase A: Navixy is real (live HTTP). The other three are placeholders so the
existing Integrations UI keeps working.

v160.3.9.40 (SEC-003) — Integration secrets at rest are now encrypted
with Fernet, keyed off env var `INTEGRATIONS_ENC_KEY`. The
`integration_configs.<kind>.config.<field>` plaintext keys are moved to
`<field>_encrypted` on write. `hydrate_integration_config(doc)` decrypts
on read — callers that used to do `cfg = doc.get("config") or {}` now
do `cfg = hydrate_integration_config(doc)` and get plaintext-in-memory
for the sync/HTTP call. Cross-scope safety: the Fernet key is DISTINCT
from the v38 `BACKUP_DEST_ENC_KEY`; a ciphertext produced with either
key cannot be decrypted with the other. `GET /integrations/*` responses
never return plaintext OR ciphertext — the pre-existing `_mask()` helper
still applies masked-last-4 previews for the UI.
"""
from __future__ import annotations
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from auth import get_current_user, require_roles
from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.integrations")
router = APIRouter(prefix="/integrations", tags=["integrations"])

Kind = Literal["simpro", "microsoft365", "textmagic", "navixy"]
ALL_KINDS: list[Kind] = ["simpro", "microsoft365", "textmagic", "navixy"]


class NavixyConfig(BaseModel):
    api_base_url: str = Field(default="https://api.us.navixy.com")
    account_id: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    session_hash: Optional[str] = None
    poll_seconds: int = Field(default=30, ge=10, le=600)
    auto_poll: bool = True


def _last4(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return f"••••{value[-4:]}" if len(value) > 4 else "••••"


SECRETS_BY_KIND: dict[str, list[str]] = {
    "navixy": ["password", "session_hash"],
    "simpro": ["api_token"],
    "microsoft365": ["client_secret", "access_token", "refresh_token"],
    "textmagic": ["api_key"],
    "dropbox": ["access_token", "refresh_token"],
}

# ─────────────────────────────────────────────────────────
# v160.3.9.40 (SEC-003) — Fernet encryption for integration secrets.
# ─────────────────────────────────────────────────────────
_ENC_KEY_ENV = "INTEGRATIONS_ENC_KEY"
_ENC_KEY_MISSING_MSG = (
    f"{_ENC_KEY_ENV} missing — integration secret writes will 500. "
    "Set a 32-byte urlsafe base64 Fernet key in backend/.env, or set "
    "INTEGRATIONS_ENC_KEY_ALLOW_MISSING=1 to boot in degraded mode "
    "(reads pass through unchanged; NEW writes rejected)."
)

def _load_fernet() -> Optional[Fernet]:
    raw = os.environ.get(_ENC_KEY_ENV)
    if raw:
        try:
            return Fernet(raw.encode("utf-8"))
        except Exception as e:
            log.error("[v40] %s value is not a valid Fernet key: %s",
                      _ENC_KEY_ENV, type(e).__name__)
            return None
    if os.environ.get("INTEGRATIONS_ENC_KEY_ALLOW_MISSING") == "1":
        log.warning("[v40] %s not set — degraded mode (writes disabled).",
                    _ENC_KEY_ENV)
        return None
    log.error("[v40] %s", _ENC_KEY_MISSING_MSG)
    return None

_FERNET: Optional[Fernet] = _load_fernet()


def _encrypt_integration_secret(plaintext: str) -> str:
    if not _FERNET:
        raise RuntimeError("integration secret encryption unavailable — "
                           f"{_ENC_KEY_ENV} not configured")
    return _FERNET.encrypt(plaintext.encode("utf-8")).decode("ascii")


def _decrypt_integration_secret(ciphertext: str) -> str:
    """Inverse of `_encrypt_integration_secret`. Raises `InvalidToken`
    on a value produced with a different key (including the v38 backup
    dest key — cross-scope isolation is intentional)."""
    if not _FERNET:
        raise RuntimeError("integration secret decryption unavailable — "
                           f"{_ENC_KEY_ENV} not configured")
    return _FERNET.decrypt(ciphertext.encode("ascii")).decode("utf-8")


def _all_secret_fields() -> set[str]:
    out: set[str] = set()
    for fields in SECRETS_BY_KIND.values():
        out.update(fields)
    return out


def hydrate_integration_config(doc: Optional[dict]) -> dict:
    """v40 (SEC-003) — Return the integration doc's `config` dict as a
    shallow copy with encrypted-at-rest secrets decrypted in-memory.
    Callers that used to do `cfg = doc.get("config") or {}` should
    now do `cfg = hydrate_integration_config(doc)` and get plaintext
    for the sync/HTTP call. Safe with `doc=None`.
    """
    if not doc:
        return {}
    cfg = dict(doc.get("config") or {})
    for field in _all_secret_fields():
        enc_key = f"{field}_encrypted"
        if cfg.get(enc_key) and not cfg.get(field):
            try:
                cfg[field] = _decrypt_integration_secret(cfg[enc_key])
            except InvalidToken:
                # Wrong key or tampered ciphertext — do NOT crash the
                # caller, but do log with enough detail to triage.
                log.warning("[v40] integration secret decrypt InvalidToken "
                            "for field=%s (org=%s kind=%s)", field,
                            doc.get("org_id"), doc.get("kind"))
                cfg[field] = ""
            except RuntimeError as e:
                log.warning("[v40] integration secret decrypt unavailable "
                            "for field=%s: %s", field, e)
                cfg[field] = ""
        # Clear the ciphertext key from the in-memory view so the caller
        # can't accidentally use it as if it were plaintext.
        cfg.pop(enc_key, None)
    return cfg


def _encrypt_secrets_for_storage(kind: str, config: dict) -> dict:
    """Prepare a config dict for storage: encrypt secret fields into
    `<field>_encrypted` and drop the plaintext key. Non-secret fields
    pass through unchanged. Raises RuntimeError if a secret needs to
    be written but Fernet is unavailable — do NOT silently store
    plaintext.

    v58.13.85 — Strip leading/trailing whitespace from EVERY string
    value in the config dict before storage. Copy-paste of credentials
    from provider dashboards routinely captures tab/space characters
    (TextMagic api_key was arriving with a leading TAB, breaking the
    httpx `X-TM-Key` header build). Since no legitimate credential /
    URL / identifier we accept has meaningful surrounding whitespace,
    stripping is safe. Applies to both secret and non-secret fields.
    """
    if not config:
        return {}
    out = {}
    for k, v in config.items():
        if isinstance(v, str):
            out[k] = v.strip()
        else:
            out[k] = v
    for field in SECRETS_BY_KIND.get(kind, []):
        v = out.get(field)
        if v is None or v == "":
            # Nothing to encrypt. Preserve any existing ciphertext.
            out.pop(field, None)
            continue
        if not _FERNET:
            raise HTTPException(
                503,
                f"Cannot store secret {field!r}: {_ENC_KEY_ENV} not "
                "configured on this backend. Ask an admin to set the key.",
            )
        # Already stripped above; encrypt the trimmed plaintext.
        out[f"{field}_encrypted"] = _encrypt_integration_secret(str(v))
        out.pop(field, None)
    return out


async def _migrate_plaintext_integration_secrets(db_) -> Dict[str, int]:
    """v40 — one-shot: encrypt every plaintext secret field found in
    `integration_configs`, moving the value under `<field>_encrypted`
    and unsetting the plaintext key. Idempotent — a row already fully
    ciphertext is a no-op. Never touches non-secret fields."""
    if not _FERNET:
        log.warning("[v40] migration skipped — %s not set.", _ENC_KEY_ENV)
        return {"scanned": 0, "encrypted": 0, "skipped_no_fernet": 1}
    scanned = 0
    encrypted_fields = 0
    encrypted_rows = 0
    cursor = db_.integration_configs.find({}, {"_id": 0, "id": 1, "kind": 1,
                                               "org_id": 1, "config": 1})
    async for doc in cursor:
        scanned += 1
        kind = doc.get("kind")
        cfg = doc.get("config") or {}
        secret_fields = SECRETS_BY_KIND.get(kind, [])
        set_ops: dict = {}
        unset_ops: dict = {}
        for field in secret_fields:
            v = cfg.get(field)
            if v is None or v == "":
                continue
            # Value present in plaintext → encrypt.
            try:
                ct = _encrypt_integration_secret(str(v))
            except RuntimeError:
                # Shouldn't happen because _FERNET check above passed.
                continue
            set_ops[f"config.{field}_encrypted"] = ct
            unset_ops[f"config.{field}"] = ""
            encrypted_fields += 1
        if set_ops or unset_ops:
            update: dict = {}
            if set_ops:
                update["$set"] = set_ops
            if unset_ops:
                update["$unset"] = unset_ops
            await db_.integration_configs.update_one(
                {"org_id": doc.get("org_id"), "kind": kind},
                update,
            )
            encrypted_rows += 1
    return {
        "scanned": scanned,
        "rows_encrypted": encrypted_rows,
        "fields_encrypted": encrypted_fields,
    }


def _mask(kind: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(cfg)
    for secret_key in SECRETS_BY_KIND.get(kind, []):
        if out.get(secret_key):
            out[secret_key] = _last4(out[secret_key])
        # v160.3.9.40 (SEC-003) — Never leak the ciphertext to the
        # UI either. If the stored value is under `<field>_encrypted`,
        # show a masked placeholder derived from a decrypt (best-effort)
        # so admins still see the "••••1234" hint.
        enc_key = f"{secret_key}_encrypted"
        if enc_key in out:
            try:
                pt = _decrypt_integration_secret(out[enc_key])
                out[secret_key] = _last4(pt)
            except Exception:
                out[secret_key] = "••••"
            out.pop(enc_key, None)
    return out


def _mask_preserve(kind: str, existing: dict, incoming: dict) -> dict:
    """Merge incoming config with existing, preserving stored secrets when the
    incoming value is masked or empty. Returns the merged config dict with
    plaintext secrets (ready for _encrypt_secrets_for_storage on the way to
    Mongo).
    """
    # v160.3.9.40 (SEC-003) — Existing may have ciphertext under
    # `<field>_encrypted` — hydrate to plaintext for the merge, then
    # the caller re-encrypts before storage.
    existing_hydrated = hydrate_integration_config({"config": existing or {},
                                                    "kind": kind}) if existing else {}
    merged = {**(existing_hydrated or {}), **(incoming or {})}
    for secret_key in SECRETS_BY_KIND.get(kind, []):
        v = (incoming or {}).get(secret_key)
        if v is None:
            merged[secret_key] = (existing_hydrated or {}).get(secret_key)
        elif isinstance(v, str) and (v.startswith("••••") or v.startswith("****") or v.strip() == ""):
            log.info("%s PUT: keeping stored %s (incoming was masked/empty)", kind, secret_key)
            merged[secret_key] = (existing_hydrated or {}).get(secret_key)
    return merged


async def _get_or_default(org_id: str, kind: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": kind}, {"_id": 0})
    if doc:
        return doc
    return {        "id": None, "org_id": org_id, "kind": kind,
        "config": {} if kind != "navixy" else NavixyConfig().model_dump(),
        "status": "not_connected", "last_tested_at": None,
        "last_error": None, "created_at": None, "updated_at": None,
    }


@router.get("")
async def list_integrations(user: dict = Depends(get_current_user)):
    out = []
    for kind in ALL_KINDS:
        doc = await _get_or_default(user["org_id"], kind)
        out.append({
            "kind": kind,
            "status": doc.get("status", "not_connected"),
            "last_tested_at": doc.get("last_tested_at"),
            "last_error": doc.get("last_error"),
        })
    return out


@router.get("/{kind}")
async def get_integration(kind: Kind, user: dict = Depends(get_current_user)):
    doc = await _get_or_default(user["org_id"], kind)
    doc["config"] = _mask(kind, doc.get("config") or {})
    return doc


@router.put("/{kind}")
async def put_integration(kind: Kind, body: dict, user: dict = Depends(require_roles("admin", "hseq_lead"))):
    existing = (await db.integration_configs.find_one({"org_id": user["org_id"], "kind": kind})) or {}
    prev = existing.get("config") or {}
    merged = _mask_preserve(kind, prev, body or {})
    if kind == "navixy":
        config = NavixyConfig(**merged).model_dump()
    else:
        config = merged

    # v160.3.9.40 (SEC-003) — encrypt every secret field before storage.
    # Raises 503 if INTEGRATIONS_ENC_KEY is missing (fail-closed; do NOT
    # silently write plaintext).
    config = _encrypt_secrets_for_storage(kind, config)

    doc = {
        "org_id": user["org_id"], "kind": kind, "config": config,
        "updated_at": now_iso(),
    }
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": kind},
        {"$set": doc, "$setOnInsert": {"id": new_id(), "created_at": now_iso(), "status": "not_connected"}},
        upsert=True,
    )
    saved = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": kind}, {"_id": 0})
    saved["config"] = _mask(kind, saved.get("config") or {})
    return saved


# ---------- Navixy live endpoints ----------

async def _navixy_cfg(org_id: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "navixy"})
    if not doc or not doc.get("config"):
        raise HTTPException(400, "Navixy not configured")
    # v160.3.9.40 (SEC-003) — return plaintext view for HTTP calls.
    return hydrate_integration_config(doc)


@router.post("/navixy/get-hash")
async def navixy_get_hash(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _navixy_cfg(user["org_id"])
    if not cfg.get("email") or not cfg.get("password"):
        raise HTTPException(400, "Email and password are required — save them first.")
    url = f"{cfg['api_base_url'].rstrip('/')}/v2/user/auth"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, json={"login": cfg["email"], "password": cfg["password"]})
    except Exception as e:
        raise HTTPException(502, f"Navixy unreachable: {e}")
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if not data.get("success") or not data.get("hash"):
        msg = data.get("status", {}).get("description") or data.get("description") or r.text[:200]
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "navixy"},
            {"$set": {"status": "error", "last_error": f"Auth failed: {msg}", "updated_at": now_iso()}},
        )
        raise HTTPException(400, f"Navixy auth failed: {msg}")
    new_hash = data["hash"]
    # v160.3.9.40 (SEC-003) — session_hash is a secret; store encrypted.
    # v58.13.132is — A fresh hash IS a successful connection, so flip
    # `status` to "connected" here too. Without this, Get Hash succeeded
    # but the health dot stayed orange/red because `status` retained the
    # prior "error" value, which caused user confusion (test says
    # working, dot says degraded).
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "navixy"},
        {"$set": {"config.session_hash_encrypted": _encrypt_integration_secret(new_hash),
                  "status": "connected",
                  "last_error": None,
                  "last_tested_at": now_iso(),
                  "updated_at": now_iso()},
         "$unset": {"config.session_hash": ""}},
    )
    return {"hash_last4": _last4(new_hash), "fetched_at": now_iso()}


@router.post("/navixy/test-connection")
async def navixy_test(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _navixy_cfg(user["org_id"])
    h = cfg.get("session_hash")
    if not h:
        raise HTTPException(400, "No session hash — click Get Hash first.")
    url = f"{cfg['api_base_url'].rstrip('/')}/v2/tracker/list"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, json={"hash": h})
    except Exception as e:
        # v58.13.132is — Persist status on network failures too, else
        # the health dot stays green with a stale "connected" while
        # Navixy is unreachable.
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "navixy"},
            {"$set": {"status": "error",
                      "last_error": f"Navixy unreachable: {e}",
                      "last_tested_at": now_iso(),
                      "updated_at": now_iso()}},
        )
        raise HTTPException(502, f"Navixy unreachable: {e}")
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if not data.get("success"):
        msg = (data.get("status") or {}).get("description") or "Unknown error"
        # v58.13.132is — Persist even on hash-error so the health dot
        # reflects reality. Previously this branch raised without
        # writing, leaving the last-known status untouched.
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "navixy"},
            {"$set": {"status": "error",
                      "last_error": msg,
                      "last_tested_at": now_iso(),
                      "updated_at": now_iso()}},
        )
        if "hash" in msg.lower():
            raise HTTPException(400, "Hash invalid — click Get Hash to refresh.")
        raise HTTPException(400, msg)
    trackers = data.get("list") or []
    sample = [{"id": t.get("id"), "label": t.get("label"), "plate": t.get("source", {}).get("phone")} for t in trackers[:3]]
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "navixy"},
        {"$set": {"status": "connected", "last_tested_at": now_iso(), "last_error": None,
                  "vehicle_count": len(trackers), "vehicles_cache": trackers, "updated_at": now_iso()}},
    )
    return {"vehicle_count": len(trackers), "sample": sample, "tested_at": now_iso()}


@router.get("/navixy/tags")
async def navixy_tags(user: dict = Depends(get_current_user)):
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "navixy"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "Navixy not connected")
    cfg = doc["config"]
    h = cfg.get("session_hash")
    base = cfg["api_base_url"].rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{base}/v2/tag/list", json={"hash": h})
            data = r.json() or {}
    except Exception as e:
        raise HTTPException(502, f"Navixy unreachable: {e}")
    if not data.get("success"):
        msg = (data.get("status") or {}).get("description") or "tag/list failed"
        if "hash" in msg.lower():
            raise HTTPException(400, "Hash invalid — refresh in Settings → Integrations → Navixy")
        raise HTTPException(400, msg)
    tags = [
        {"id": t.get("id"), "name": t.get("name"), "color": t.get("color")}
        for t in (data.get("list") or []) if t.get("id") is not None
    ]
    return {"tags": tags, "count": len(tags)}


async def _navixy_tracker_tag_map(client: httpx.AsyncClient, base: str, h: str) -> dict:
    """Return {tracker_id: [tag_id, ...]} using POST /v2/tag/tracker/list."""
    try:
        r = await client.post(f"{base}/v2/tag/tracker/list", json={"hash": h})
        data = r.json() or {}
    except Exception:
        return {}
    if not data.get("success"):
        return {}
    out: dict = {}
    # Navixy returns list of {tracker_id, tag_id}
    for row in data.get("list") or []:
        tid = row.get("tracker_id")
        if tid is None:
            continue
        out.setdefault(tid, []).append(row.get("tag_id"))
    return out


# v58.13.88 lint sweep — module-level `import logging` (line 19) and
# `import os` (line 20) at the top of this file already cover these
# names; the duplicated re-imports here were shadowing them. Removed
# `import logging` and `import os` at this location. `_LOG` and the
# NAVIXY_DEBUG env read below continue to work via the top-of-file
# imports.
_LOG = logging.getLogger("paneltec.navixy")
_NAVIXY_DEBUG = os.environ.get("NAVIXY_DEBUG", "").lower() in ("1", "true", "yes")


def _extract_position(state: dict) -> dict:
    """Pull lat/lng/speed/last_seen out of a Navixy /v2/tracker/get_states entry.

    Real Navixy v2 shape (verified June 2026):
        {source_id, gps: {location: {lat, lng}, speed, updated, ...},
         last_update, connection_status, movement_status, ...}

    Older / alt-plan shapes also seen in the wild:
        gps.lat/lng                   (very old / niche plans)
        location.lat/lng              (some EU resellers)
        last_position.{lat,lng}       (legacy API)
    Try each in order; use whichever has data.
    """
    if not isinstance(state, dict):
        return {"lat": None, "lng": None, "speed": None, "last_seen": None}

    lat = lng = None
    gps = state.get("gps") if isinstance(state.get("gps"), dict) else {}

    loc = gps.get("location") if isinstance(gps.get("location"), dict) else None
    if isinstance(loc, dict):
        lat, lng = loc.get("lat"), loc.get("lng")
    if lat is None or lng is None:
        # gps.lat/lng (rare flat shape)
        lat = lat if lat is not None else gps.get("lat")
        lng = lng if lng is not None else gps.get("lng")
    if lat is None or lng is None:
        # top-level location.lat/lng
        loc2 = state.get("location") if isinstance(state.get("location"), dict) else None
        if isinstance(loc2, dict):
            lat = lat if lat is not None else loc2.get("lat")
            lng = lng if lng is not None else loc2.get("lng")
    if lat is None or lng is None:
        last_pos = state.get("last_position") if isinstance(state.get("last_position"), dict) else None
        if isinstance(last_pos, dict):
            lat = lat if lat is not None else last_pos.get("lat")
            lng = lng if lng is not None else last_pos.get("lng")

    speed = gps.get("speed") if isinstance(gps, dict) else None
    if speed is None:
        speed = state.get("speed_kph") or state.get("speed")

    last_seen = (gps.get("updated") if isinstance(gps, dict) else None) \
        or state.get("last_update") \
        or state.get("connection_status")

    return {"lat": lat, "lng": lng, "speed": speed, "last_seen": last_seen}


@router.get("/navixy/vehicles")
async def navixy_vehicles(
    tag_ids: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "navixy"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "Navixy not connected")
    cfg = doc["config"]
    h = cfg.get("session_hash")
    base = cfg["api_base_url"].rstrip("/")
    selected_tag_ids = set()
    if tag_ids:
        for x in tag_ids.split(","):
            x = x.strip()
            if x.isdigit():
                selected_tag_ids.add(int(x))

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            tr = await c.post(f"{base}/v2/tracker/list", json={"hash": h})
            tr_data = tr.json() or {}
            if not tr_data.get("success", True):
                msg = (tr_data.get("status") or {}).get("description") or "tracker/list failed"
                if "hash" in msg.lower():
                    raise HTTPException(400, "Hash invalid — refresh in Settings → Integrations → Navixy")
                raise HTTPException(400, msg)
            trackers = tr_data.get("list") or []
            trackers = [t for t in trackers if isinstance(t, dict)]
            states = {}
            if trackers:
                ids = [t["id"] for t in trackers if t.get("id")]
                st = await c.post(f"{base}/v2/tracker/get_states",
                                  json={"hash": h, "trackers": ids, "allow_not_exist": True})
                st_data = st.json() or {}
                states_raw = st_data.get("states") if isinstance(st_data, dict) else None
                # Navixy returns `states` as a dict keyed by tracker_id (string).
                # IMPORTANT: each state's inner `source_id` is the *device* id,
                # which is different from the tracker id used in tracker/list —
                # so we MUST key off the outer dict key, not source_id.
                # Older / niche shapes return a list of state objects.
                if isinstance(states_raw, dict):
                    for k, v in states_raw.items():
                        if isinstance(v, dict):
                            try:
                                key = int(k)
                            except (TypeError, ValueError):
                                key = k
                            states[key] = v
                elif isinstance(states_raw, list):
                    for s in states_raw:
                        if isinstance(s, dict) and s.get("source_id") is not None:
                            # In list-shape, source_id IS the tracker id.
                            states[s["source_id"]] = s
                if _NAVIXY_DEBUG:
                    with_pos = sum(
                        1 for s in states.values()
                        if isinstance(s.get("gps"), dict) and isinstance(s["gps"].get("location"), dict)
                        and s["gps"]["location"].get("lat") is not None
                    )
                    _LOG.info("navixy get_states: %d trackers requested → %d states parsed, %d with gps.location",
                              len(ids), len(states), with_pos)
            # Fetch tag/name lookup + per-tracker binding map
            tag_lookup: dict = {}
            try:
                tg = await c.post(f"{base}/v2/tag/list", json={"hash": h})
                for t in (tg.json() or {}).get("list") or []:
                    if isinstance(t, dict):
                        tag_lookup[t.get("id")] = {"id": t.get("id"), "name": t.get("name"), "color": t.get("color")}
            except Exception:
                pass
            binding = await _navixy_tracker_tag_map(c, base, h)
            # Some Navixy plans also return `tag_bindings` inline on each tracker object
            for t in trackers:
                inline = t.get("tag_bindings") or t.get("tags") or []
                if inline and t.get("id") not in binding:
                    extracted = []
                    for x in inline:
                        if isinstance(x, dict):
                            v = x.get("tag_id") if "tag_id" in x else x.get("id")
                            if v is not None:
                                extracted.append(v)
                        elif isinstance(x, (int, str)):
                            extracted.append(int(x) if str(x).isdigit() else x)
                    binding[t["id"]] = extracted
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Navixy unreachable: {e}")

    out = []
    for t in trackers:
        if not isinstance(t, dict):
            continue
        tid = t.get("id")
        v_tag_ids = binding.get(tid) or []
        if selected_tag_ids and not (set(v_tag_ids) & selected_tag_ids):
            continue
        s = states.get(tid) if isinstance(states.get(tid), dict) else {}
        pos = _extract_position(s)
        src = t.get("source") if isinstance(t.get("source"), dict) else {}
        out.append({
            "id": tid,
            "label": t.get("label") or t.get("clone_label") or "Vehicle",
            "plate": src.get("phone"),
            "lat": pos["lat"],
            "lng": pos["lng"],
            "speed_kph": pos["speed"],
            "last_seen": pos["last_seen"],
            # Navixy reports connection_status as online/idle/offline/just_registered.
            # Trust it directly — don't recompute from last_seen deltas.
            # Pin colour: "online" + "idle" → green; "offline" → grey; unknown → green.
            "status": ("offline" if s.get("connection_status") == "offline"
                       else "online"),
            "connection_status": s.get("connection_status"),
            "movement_status": s.get("movement_status"),
            "address": s.get("address"),
            "tags": [tag_lookup[tid_] for tid_ in v_tag_ids if tid_ in tag_lookup],
        })
    return {"count": len(out), "total": len(out), "vehicles": out,
            "fetched_at": now_iso(), "filter_tag_ids": sorted(selected_tag_ids)}



# v160.3.9.40 (SEC-003) — Manual re-run of the secrets encryption
# migration. Same pattern as v38's
# /api/backup/admin/migrate-destination-passwords. Idempotent; safe to
# call any time. Admin-only. Never returns any secret material —
# response only carries counts.
@router.post("/admin/migrate-integration-secrets")
async def migrate_integration_secrets(user: dict = Depends(require_roles("admin"))):
    summary = await _migrate_plaintext_integration_secrets(db)
    return {
        "ok": True,
        "at": now_iso(),
        **summary,
    }
