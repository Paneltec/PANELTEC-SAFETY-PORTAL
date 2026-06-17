"""Workspace listing — used by the user-edit drawer for assignment."""
from fastapi import APIRouter, Depends
from auth import get_current_user
from db import db

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("")
async def list_workspaces(user: dict = Depends(get_current_user)):
    docs = await db.workspaces.find(
        {"org_id": user["org_id"]}, {"_id": 0, "id": 1, "name": 1}
    ).sort("name", 1).to_list(200)
    return docs
