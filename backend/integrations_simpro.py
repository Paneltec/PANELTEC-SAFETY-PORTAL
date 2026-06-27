"""Simpro staff + jobs integration. Uses a static Simpro API token (Bearer).
Supports multiple Company IDs per org (fan-out across companies)."""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from auth import require_roles, get_current_user
from db import db
from models import now_iso, new_id

log = logging.getLogger("paneltec.simpro")
router = APIRouter(prefix="/integrations/simpro", tags=["integrations-simpro"])

DEFAULT_BASE = "https://demo.simprosuite.com"


async def _cfg(org_id: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "simpro"})
    if not doc or not doc.get("config"):
        raise HTTPException(400, "Simpro not configured")
    return doc["config"]


def _require(cfg: dict, *keys: str) -> None:
    missing = [k for k in keys if not cfg.get(k)]
    if missing:
        raise HTTPException(400, f"Missing required fields: {', '.join(missing)}")


def _company_ids(cfg: dict) -> list[str]:
    """Read multi-company list with legacy single-value fallback."""
    raw = cfg.get("company_ids")
    if isinstance(raw, list) and raw:
        out = [str(x).strip() for x in raw if str(x).strip()]
        if out:
            return out
    single = cfg.get("company_id")
    if single is not None and str(single).strip():
        return [str(single).strip()]
    return []


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


# ---------- Companies picker ----------

@router.get("/companies")
async def simpro_companies(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _cfg(user["org_id"])
    _require(cfg, "api_base_url", "api_token")
    url = f"{cfg['api_base_url'].rstrip('/')}/api/v1.0/companies/"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url, headers=_auth_headers(cfg["api_token"]))
    except Exception as e:
        raise HTTPException(502, f"Simpro unreachable: {e}")
    if r.status_code != 200:
        raise HTTPException(400, f"Simpro list failed: HTTP {r.status_code} {r.text[:200]}")
    try:
        data = r.json()
    except Exception:
        data = []
    if not isinstance(data, list):
        data = data.get("data") or []
    out = []
    for c in data:
        if not isinstance(c, dict):
            continue
        cid = c.get("ID") if c.get("ID") is not None else c.get("id")
        out.append({
            "id": cid,
            "name": c.get("Name") or c.get("name"),
            "country": (c.get("Country") if isinstance(c.get("Country"), str)
                        else (c.get("Country") or {}).get("Name") if isinstance(c.get("Country"), dict) else None),
        })
    return {"count": len(out), "companies": out}


# ---------- Test connection (multi-company validation via /companies/ list) ----------

async def _fetch_companies_index(c: httpx.AsyncClient, base: str, token: str) -> dict[str, dict]:
    """Pull the authoritative /api/v1.0/companies/ list and return {id_str: {name, country}}."""
    url = f"{base}/api/v1.0/companies/"
    r = await c.get(url, headers=_auth_headers(token))
    if r.status_code != 200:
        raise HTTPException(400, f"Simpro list failed: HTTP {r.status_code} {r.text[:200]}")
    try:
        data = r.json()
    except Exception:
        data = []
    if not isinstance(data, list):
        data = data.get("data") or []
    out: dict[str, dict] = {}
    for c_ in data:
        if not isinstance(c_, dict):
            continue
        cid = c_.get("ID") if c_.get("ID") is not None else c_.get("id")
        if cid is None:
            continue
        country_raw = c_.get("Country")
        country = (country_raw if isinstance(country_raw, str)
                   else (country_raw or {}).get("Name") if isinstance(country_raw, dict) else None)
        out[str(cid)] = {"name": c_.get("Name") or c_.get("name"), "country": country}
    return out


@router.post("/test-connection")
async def simpro_test(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _cfg(user["org_id"])
    _require(cfg, "api_base_url", "api_token")
    ids = _company_ids(cfg)
    if not ids:
        raise HTTPException(400, "At least one Company ID is required.")
    base = cfg["api_base_url"].rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            index = await _fetch_companies_index(c, base, cfg["api_token"])
    except HTTPException:
        raise
    except Exception as e:
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "simpro"},
            {"$set": {"status": "error", "last_tested_at": now_iso(),
                      "last_error": f"Unreachable: {e}", "updated_at": now_iso()}},
        )
        raise HTTPException(502, f"Simpro unreachable: {e}")

    results: list[dict] = []
    for cid in ids:
        info = index.get(str(cid))
        if info is None:
            results.append({"id": cid, "status": "not_found",
                            "error": "Company does not exist in this Simpro instance"})
        else:
            results.append({"id": cid, "status": "ok",
                            "name": info.get("name"), "country": info.get("country")})

    ok_count = sum(1 for r in results if r["status"] == "ok")
    bad_not_found = [r["id"] for r in results if r["status"] == "not_found"]
    primary_name = next((r.get("name") for r in results if r["status"] == "ok"), None)
    primary_country = next((r.get("country") for r in results if r["status"] == "ok"), None)

    if ok_count == 0:
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "simpro"},
            {"$set": {"status": "error", "last_tested_at": now_iso(),
                      "last_error": f"All Company IDs failed: {[r['id'] for r in results]}",
                      "companies_status": results, "updated_at": now_iso()}},
        )
        if bad_not_found:
            raise HTTPException(400,
                f"One or more Company IDs not found in this Simpro instance: {bad_not_found}. "
                "Tap List to pick valid ones.")
        raise HTTPException(400, f"All Company IDs failed: {results}")

    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "simpro"},
        {"$set": {"status": "connected", "last_tested_at": now_iso(),
                  "last_error": (f"Some IDs not found: {bad_not_found}" if bad_not_found else None),
                  "company_name": primary_name, "company_country": primary_country,
                  "companies_status": results,
                  "updated_at": now_iso()}},
    )
    return {"ok": True, "ok_count": ok_count, "companies": results,
            "tested_at": now_iso()}


# ---------- Staff (multi-company merge + dedupe) ----------

def _custom_fields_map(s: dict) -> dict:
    out: dict = {}
    raw = s.get("CustomFields") or s.get("customFields") or []
    if isinstance(raw, list):
        for cf in raw:
            if not isinstance(cf, dict):
                continue
            field = cf.get("CustomField") or cf.get("customField") or {}
            name = (field.get("Name") if isinstance(field, dict) else None) or cf.get("Name") or cf.get("name")
            value = cf.get("Value") or cf.get("value")
            if name:
                out[str(name)] = value
    elif isinstance(raw, dict):
        for k, v in raw.items():
            out[str(k)] = v
    return out


def _normalise_employee(s: dict, company_id: Optional[str] = None) -> dict:
    given = s.get("GivenName") or ""
    family = s.get("FamilyName") or ""
    name = s.get("Name") or " ".join(filter(None, [given, family])) or s.get("name") or ""
    if not given and not family and name and " " in name:
        parts = name.strip().split(" ", 1)
        given, family = parts[0], parts[1] if len(parts) > 1 else ""
    position = None
    pos_raw = s.get("Position")
    if isinstance(pos_raw, str):
        position = pos_raw
    elif isinstance(pos_raw, dict):
        position = pos_raw.get("Name")
    # Simpro's employee detail endpoint nests contact info under PrimaryContact.
    primary = s.get("PrimaryContact") or {}
    email = (s.get("Email") or s.get("email")
             or (primary.get("Email") if isinstance(primary, dict) else None))
    phone = (s.get("Phone") or s.get("phone") or s.get("CellPhone")
             or (primary.get("CellPhone") if isinstance(primary, dict) else None)
             or (primary.get("Phone") if isinstance(primary, dict) else None))
    return {
        "id": s.get("ID") or s.get("id"),
        "name": name,
        "first_name": given,
        "last_name": family,
        "email": email,
        "phone": phone,
        "position": position,
        "role": s.get("Type") or s.get("role"),
        "active": s.get("Active", True) if "Active" in s else s.get("active", True),
        "company_id": company_id,
        "custom_fields": _custom_fields_map(s),
    }


async def _refresh_staff_cache(cfg: dict, ids: list[str], token: str) -> tuple[list[dict], list[dict]]:
    """Fetch employees from every company, hydrate each with detail (email, phone, position).
    Simpro's list endpoint returns only {ID, Name} — detail at /employees/{id} (no trailing slash)
    provides PrimaryContact.Email / .CellPhone / Position. Returns (raw_per_company, normalised_deduped)."""
    base = cfg["api_base_url"].rstrip("/")
    raw_per_company: list[dict] = []
    merged: list[dict] = []
    seen: set = set()
    sem = asyncio.Semaphore(8)  # cap parallel detail calls

    async def fetch_detail(client: httpx.AsyncClient, cid: str, eid) -> Optional[dict]:
        async with sem:
            try:
                r = await client.get(f"{base}/api/v1.0/companies/{cid}/employees/{eid}",
                                     headers=_auth_headers(token))
                if r.status_code == 200:
                    return r.json()
            except Exception:
                return None
        return None

    async with httpx.AsyncClient(timeout=20) as c:
        for cid in ids:
            url = f"{base}/api/v1.0/companies/{cid}/employees/"
            try:
                r = await c.get(url, headers=_auth_headers(token))
            except Exception as e:
                raw_per_company.append({"id": cid, "status": "error", "error": str(e), "raw": []})
                continue
            if r.status_code != 200:
                raw_per_company.append({"id": cid, "status": "error",
                                        "error": f"HTTP {r.status_code} {r.text[:120]}", "raw": []})
                continue
            try:
                summary = r.json()
            except Exception:
                summary = []
            if not isinstance(summary, list):
                summary = summary.get("data") or []
            raw_per_company.append({"id": cid, "status": "ok", "raw": summary})

            # Fan out detail calls in parallel (bounded by semaphore).
            detail_tasks = [fetch_detail(c, cid, s.get("ID") or s.get("id"))
                            for s in summary if isinstance(s, dict)]
            details = await asyncio.gather(*detail_tasks, return_exceptions=False) if detail_tasks else []
            for summary_row, detail in zip(summary, details):
                if not isinstance(summary_row, dict):
                    continue
                merged_row = {**summary_row, **(detail or {})}
                eid = merged_row.get("ID") or merged_row.get("id")
                key = (eid, cid) if eid is None else eid
                if eid is not None and key in seen:
                    continue
                if eid is not None:
                    seen.add(key)
                merged.append(_normalise_employee(merged_row, company_id=cid))
    return raw_per_company, merged


@router.get("/employees")
async def simpro_employees(
    company_ids: Optional[str] = None,
    filter: str = "whiteboard",  # noqa: A002 — accepted as the API field name
    user: dict = Depends(require_roles("admin", "hseq_lead")),
):
    """List Simpro staff with import-status flags, ready for the Users import drawer.

    Query params:
      - company_ids: comma-separated subset of the configured company IDs.
        Defaults to all configured company IDs.
      - filter: "whiteboard" (apply staff_custom_field/value filter, default)
                or "all" (return everyone, no filter).
    """
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "simpro"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "Simpro not connected")
    cfg = doc.get("config") or {}
    _require(cfg, "api_base_url", "api_token")

    configured = _company_ids(cfg)
    if company_ids:
        requested = [c.strip() for c in company_ids.split(",") if c.strip()]
        ids = [c for c in requested if c in configured]
        if not ids:
            raise HTTPException(400, "No matching company_ids in your Simpro config.")
    else:
        ids = configured

    if not ids:
        raise HTTPException(400, "No Company IDs configured.")

    _, merged = await _refresh_staff_cache(cfg, ids, cfg["api_token"])

    if filter == "whiteboard":
        ff = (cfg.get("staff_custom_field") or "").strip().lower()
        fv = (cfg.get("staff_field_value") or "").strip().lower()
        if ff and fv:
            merged = [m for m in merged
                      if any(k.lower() == ff and str(v).lower() == fv
                             for k, v in (m.get("custom_fields") or {}).items())]

    existing = await db.users.find(
        {"org_id": user["org_id"]},
        {"_id": 0, "email": 1, "simpro_employee_id": 1, "simpro_company_id": 1},
    ).to_list(2000)
    existing_emails = {str(u.get("email") or "").lower() for u in existing if u.get("email")}
    existing_simpro = {(str(u["simpro_employee_id"]), str(u["simpro_company_id"]))
                       for u in existing
                       if u.get("simpro_employee_id") and u.get("simpro_company_id")}

    company_names = {}
    for cs in (doc.get("companies_status") or []):
        if cs.get("status") == "ok":
            company_names[str(cs.get("id"))] = cs.get("name") or str(cs.get("id"))

    out = []
    importable_count = 0
    for m in merged:
        email = (m.get("email") or "").strip()
        eid = str(m.get("id")) if m.get("id") is not None else None
        cid = str(m.get("company_id") or "")
        already = False
        already_reason = None
        if eid and (eid, cid) in existing_simpro:
            already = True
            already_reason = "Already imported (Simpro ID match)"
        elif email and email.lower() in existing_emails:
            already = True
            already_reason = "Already imported (email match)"
        email_missing = not email
        importable = not already and not email_missing
        if importable:
            importable_count += 1
        out.append({
            **m,
            "company_name": company_names.get(cid, cid),
            "is_already_imported": already,
            "already_imported_reason": already_reason,
            "email_missing": email_missing,
            "importable": importable,
        })

    return {
        "count": len(out),
        "importable_count": importable_count,
        "employees": out,
        "companies_queried": ids,
        "filter": filter,
    }


@router.get("/staff")
async def simpro_staff(user: dict = Depends(get_current_user)):
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "simpro"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "Simpro not connected")
    cfg = doc.get("config") or {}
    _require(cfg, "api_base_url", "api_token")
    ids = _company_ids(cfg)
    if not ids:
        raise HTTPException(400, "No Company IDs configured")

    cached_at = doc.get("staff_cached_at")
    is_stale = True
    if cached_at:
        try:
            ts = datetime.fromisoformat(cached_at.replace("Z", "+00:00"))
            is_stale = (datetime.now(timezone.utc) - ts) > timedelta(minutes=5)
        except Exception:
            pass

    all_staff: list[dict] = doc.get("staff_cache_norm") or []
    if is_stale:
        try:
            _, merged = await _refresh_staff_cache(cfg, ids, cfg["api_token"])
            all_staff = merged
            await db.integration_configs.update_one(
                {"org_id": user["org_id"], "kind": "simpro"},
                {"$set": {"staff_cache_norm": merged[:1000],
                          "staff_count": len(merged),
                          "staff_cached_at": now_iso(), "updated_at": now_iso()}},
            )
        except Exception:
            pass  # serve stale cache

    # Primary filter: staff_custom_field / staff_field_value
    filter_field = (cfg.get("staff_custom_field") or "").strip()
    filter_value = (cfg.get("staff_field_value") or "").strip()
    primary = all_staff
    if filter_field and filter_value:
        ff_lc = filter_field.lower()
        fv_lc = filter_value.lower()
        primary = [m for m in all_staff
                   if any(k.lower() == ff_lc and str(v).lower() == fv_lc
                          for k, v in (m.get("custom_fields") or {}).items())]

    # Fallback: position_filter (only if primary returned nothing)
    used_fallback = False
    position_filter = cfg.get("position_filter") or []
    if not primary and isinstance(position_filter, list) and position_filter:
        needles = [str(p).strip().lower() for p in position_filter if str(p).strip()]
        primary = [m for m in all_staff
                   if m.get("position") and any(n in m["position"].lower() for n in needles)]
        used_fallback = bool(needles)

    return {
        "count": len(primary),
        "staff": primary,
        "cached_at": doc.get("staff_cached_at"),
        "companies_queried": ids,
        "filtered_by": ({"field": filter_field, "value": filter_value}
                        if (filter_field and filter_value and not used_fallback) else None),
        "fallback_used": used_fallback,
        "position_filter": position_filter if used_fallback else None,
    }


# ---------- Jobs sync (multi-company fan-out) ----------

def _job_status_bucket(stage: Optional[str]) -> str:
    if not stage:
        return "unknown"
    s = stage.lower()
    if any(k in s for k in ["complete", "archive", "invoice"]):
        return "completed"
    return "active"


async def _sync_jobs_for_company(c: httpx.AsyncClient, base: str, token: str, cid: str,
                                  org_id: str, cutoff: datetime) -> tuple[int, int]:
    url = f"{base}/api/v1.0/companies/{cid}/jobs/"
    r = await c.get(url, headers=_auth_headers(token))
    if r.status_code != 200:
        raise HTTPException(400, f"Simpro jobs fetch failed for company {cid}: HTTP {r.status_code} {r.text[:160]}")
    jobs = r.json()
    if not isinstance(jobs, list):
        jobs = jobs.get("data") or []

    synced = 0
    completed_recent = 0
    for j in jobs:
        if not isinstance(j, dict):
            continue
        jid = j.get("ID") or j.get("id")
        if jid is None:
            continue
        stage = (j.get("Stage") if isinstance(j.get("Stage"), str)
                 else (j.get("Stage") or {}).get("Name") if isinstance(j.get("Stage"), dict) else None)
        bucket = _job_status_bucket(stage)
        date_completed_raw = j.get("DateModified") or j.get("DateIssued")
        if bucket == "completed" and date_completed_raw:
            try:
                ts = datetime.fromisoformat(str(date_completed_raw).replace("Z", "+00:00"))
                if ts < cutoff:
                    continue
                completed_recent += 1
            except Exception:
                pass
        doc = {
            "org_id": org_id,
            "company_id": cid,
            "simpro_job_id": jid,
            "name": j.get("Name") or j.get("Description"),
            "stage": stage,
            "status_bucket": bucket,
            "site_name": (j.get("Site") or {}).get("Name") if isinstance(j.get("Site"), dict) else None,
            "customer_name": (j.get("Customer") or {}).get("CompanyName") if isinstance(j.get("Customer"), dict) else None,
            "date_modified": date_completed_raw,
            "synced_at": now_iso(),
        }
        await db.simpro_jobs.update_one(
            {"org_id": org_id, "company_id": cid, "simpro_job_id": jid},
            {"$set": doc, "$setOnInsert": {"id": new_id(), "created_at": now_iso()}},
            upsert=True,
        )
        synced += 1
    return synced, completed_recent


@router.post("/sync-jobs")
async def simpro_sync_jobs(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _cfg(user["org_id"])
    _require(cfg, "api_base_url", "api_token")
    ids = _company_ids(cfg)
    if not ids:
        raise HTTPException(400, "At least one Company ID is required.")
    history_days = max(7, min(365, int(cfg.get("completed_jobs_history_days") or 30)))
    cutoff = datetime.now(timezone.utc) - timedelta(days=history_days)
    base = cfg["api_base_url"].rstrip("/")

    per_company: list[dict] = []
    total_synced = 0
    total_recent = 0
    async with httpx.AsyncClient(timeout=30) as c:
        for cid in ids:
            try:
                s, rcnt = await _sync_jobs_for_company(c, base, cfg["api_token"], cid, user["org_id"], cutoff)
                per_company.append({"id": cid, "status": "ok", "synced": s, "completed_recent": rcnt})
                total_synced += s
                total_recent += rcnt
            except HTTPException as e:
                per_company.append({"id": cid, "status": "error", "error": str(e.detail)})
            except Exception as e:
                per_company.append({"id": cid, "status": "error", "error": str(e)})

    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "simpro"},
        {"$set": {"last_sync_at": now_iso(), "last_sync_count": total_synced,
                  "last_sync_per_company": per_company, "updated_at": now_iso()}},
    )
    return {"synced": total_synced, "completed_recent": total_recent,
            "per_company": per_company, "synced_at": now_iso()}


# ---------- Connect: test + first sync ----------

@router.post("/connect")
async def simpro_connect(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    await simpro_test(user=user)  # raises if all companies fail
    try:
        result = await simpro_sync_jobs(user=user)
    except HTTPException as e:
        return {"ok": True, "connected": True, "sync_error": e.detail, "tested_at": now_iso()}
    return {"ok": True, "connected": True, **result}
