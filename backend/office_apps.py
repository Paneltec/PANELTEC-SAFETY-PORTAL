"""Office Dashboard — launcher for the outside programs the office runs on
(Simpro, Xero, ...).

An admin (anyone holding `users.edit`) keeps the list of programs and picks
who sees each one: individual users (`user_ids`) and/or a whole Simpro
company (`company_ids`: "2" Paneltec Civil, "3" Viatec Traffic). Everyone
else gets only their own programs from `GET /office-apps/mine`.

This decides what shows on a person's dashboard. It is not a lock on the
program itself: each program keeps its own login.
"""
import re
from typing import List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth import get_current_user
from db import db
from models import new_id, now_iso
from permissions import can, require_permission

router = APIRouter(prefix="/office-apps", tags=["office-apps"])

COMPANIES = [
    {"id": "2", "name": "Paneltec Civil"},
    {"id": "3", "name": "Viatec Traffic"},
]
_COMPANY_IDS = {c["id"] for c in COMPANIES}
_HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", re.I)


def clean_url(value: Optional[str]) -> str:
    """Empty string, or an http(s) URL. A bare host gets https:// added."""
    v = (value or "").strip()
    if not v:
        return ""
    if not v.lower().startswith(("http://", "https://")):
        if "://" in v:
            raise ValueError("Web address must start with http:// or https://")
        v = "https://" + v
    try:
        parsed = urlparse(v)
        host, _ = parsed.hostname, parsed.port  # .port raises on a bad port
    except ValueError:
        host = None
    if not host or not _HOST_RE.match(host):
        raise ValueError("That web address doesn't look right")
    return v


class AppIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    category: str = Field(default="", max_length=40)
    url: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=120)
    user_ids: List[str] = Field(default_factory=list, max_length=1000)
    company_ids: List[str] = Field(default_factory=list, max_length=10)

    @field_validator("label", "category", "description")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, v: str) -> str:
        if not v:
            raise ValueError("Label is required")
        return v

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        return clean_url(v)

    @field_validator("company_ids")
    @classmethod
    def _companies(cls, v: List[str]) -> List[str]:
        bad = [c for c in v if c not in _COMPANY_IDS]
        if bad:
            raise ValueError(f"Unknown company: {bad[0]}")
        return sorted(set(v))


class AppPatch(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=60)
    category: Optional[str] = Field(default=None, max_length=40)
    url: Optional[str] = Field(default=None, max_length=500)
    description: Optional[str] = Field(default=None, max_length=120)
    user_ids: Optional[List[str]] = Field(default=None, max_length=1000)
    company_ids: Optional[List[str]] = Field(default=None, max_length=10)

    @field_validator("label", "category", "description")
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if v is not None else v

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v:
            raise ValueError("Label is required")
        return v

    @field_validator("url")
    @classmethod
    def _url(cls, v: Optional[str]) -> Optional[str]:
        return clean_url(v) if v is not None else v

    @field_validator("company_ids")
    @classmethod
    def _companies(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        bad = [c for c in v if c not in _COMPANY_IDS]
        if bad:
            raise ValueError(f"Unknown company: {bad[0]}")
        return sorted(set(v))


def user_company_ids(user: dict) -> List[str]:
    """The Simpro companies a user belongs to, as strings."""
    ids = user.get("company_ids") or []
    if not ids:
        one = user.get("company_id") or user.get("simpro_company_id")
        ids = [one] if one else []
    return [str(c) for c in ids if c is not None]


def user_can_see(app: dict, user: dict) -> bool:
    if user.get("id") in (app.get("user_ids") or []):
        return True
    return bool(set(user_company_ids(user)) & set(app.get("company_ids") or []))


def _public(app: dict) -> dict:
    """What a non-admin gets: no access lists."""
    return {k: app.get(k, "") for k in ("id", "label", "category", "url", "description")}


def _full(app: dict) -> dict:
    out = _public(app)
    out["user_ids"] = app.get("user_ids") or []
    out["company_ids"] = app.get("company_ids") or []
    return out


async def _org_apps(org_id: str) -> List[dict]:
    return await db.office_apps.find({"org_id": org_id}, {"_id": 0}).sort(
        [("category", 1), ("label", 1)]
    ).to_list(500)


async def _valid_user_ids(org_id: str, ids: List[str]) -> List[str]:
    """Keep only ids of users in this org, so access can't name outsiders."""
    ids = list(dict.fromkeys(ids))
    if not ids:
        return []
    found = await db.users.find(
        {"org_id": org_id, "id": {"$in": ids}}, {"_id": 0, "id": 1}
    ).to_list(len(ids))
    ok = {d["id"] for d in found}
    return [i for i in ids if i in ok]


@router.get("/mine")
async def my_apps(user: dict = Depends(get_current_user)):
    """Programs for the signed-in person. Admins see every program."""
    apps = await _org_apps(user["org_id"])
    is_admin = await can(user, "users", "edit")
    visible = apps if is_admin else [a for a in apps if user_can_see(a, user)]
    return {"items": [_public(a) for a in visible], "can_manage": is_admin}


@router.get("")
async def list_apps(user: dict = Depends(require_permission("users", "edit"))):
    return {"items": [_full(a) for a in await _org_apps(user["org_id"])], "companies": COMPANIES}


@router.get("/staff")
async def list_staff(user: dict = Depends(require_permission("users", "edit"))):
    """Active people in the org, with the companies they belong to."""
    docs = await db.users.find(
        {
            "org_id": user["org_id"],
            "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}],
        },
        {"_id": 0, "id": 1, "name": 1, "email": 1, "position": 1, "simpro_position": 1,
         "company_id": 1, "simpro_company_id": 1, "company_ids": 1,
         "is_test": 1, "is_test_fixture": 1, "is_archived": 1},
    ).sort("name", 1).to_list(1000)
    items = [
        {
            "id": d["id"],
            "name": d.get("name") or d.get("email") or "Unnamed",
            "email": d.get("email") or "",
            "position": d.get("simpro_position") or d.get("position") or "",
            "company_ids": user_company_ids(d),
        }
        for d in docs
        if d.get("id") and not (d.get("is_test") or d.get("is_test_fixture") or d.get("is_archived"))
    ]
    return {"items": items, "companies": COMPANIES}


@router.post("", status_code=201)
async def create_app(body: AppIn, user: dict = Depends(require_permission("users", "edit"))):
    doc = body.model_dump()
    doc["user_ids"] = await _valid_user_ids(user["org_id"], doc["user_ids"])
    doc.update({
        "id": new_id(), "org_id": user["org_id"],
        "created_at": now_iso(), "created_by": user.get("id"),
    })
    await db.office_apps.insert_one(dict(doc))
    return _full(doc)


@router.patch("/{app_id}")
async def update_app(app_id: str, body: AppPatch,
                     user: dict = Depends(require_permission("users", "edit"))):
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(400, "No fields to update")
    if "user_ids" in patch:
        patch["user_ids"] = await _valid_user_ids(user["org_id"], patch["user_ids"])
    patch["updated_at"] = now_iso()
    patch["updated_by"] = user.get("id")
    res = await db.office_apps.update_one(
        {"id": app_id, "org_id": user["org_id"]}, {"$set": patch}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Program not found")
    doc = await db.office_apps.find_one({"id": app_id, "org_id": user["org_id"]}, {"_id": 0})
    return _full(doc)


@router.delete("/{app_id}", status_code=204)
async def delete_app(app_id: str, user: dict = Depends(require_permission("users", "edit"))):
    res = await db.office_apps.delete_one({"id": app_id, "org_id": user["org_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Program not found")
