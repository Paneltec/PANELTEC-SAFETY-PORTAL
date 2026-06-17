"""FastAPI app entrypoint — mounts all routers under /api."""
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")  # MUST run before importing anything that reads env

from fastapi import APIRouter, Depends, FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from ai import router as ai_router  # noqa: E402
from ask import router as ask_router  # noqa: E402
from auth import get_current_user, router as auth_router  # noqa: E402
from contractors import router as contractors_router  # noqa: E402
from crud import (  # noqa: E402
    diary_router, hazards_router, incidents_router, inspections_router,
    prestarts_router, swms_router,
)
from dashboard import files_router, router as dashboard_router  # noqa: E402
from db import close as close_db  # noqa: E402
from email_outbox import record_router as record_email_router, router as email_router  # noqa: E402
from exports import router as exports_router  # noqa: E402
from integrations import router as integrations_router  # noqa: E402
from renewals import public_router as renewals_public_router, router as renewals_router  # noqa: E402
from seed import ensure_indexes, seed_all  # noqa: E402
from users import router as users_router  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
log = logging.getLogger("paneltec")

app = FastAPI(title="Paneltec Civil API", version="0.2.0", openapi_url="/api/openapi.json")

# CORS — Bearer auth so allow_credentials isn't required; permit wildcard via env.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")


# Permission enforcement middleware — runs before route deps.
from permissions_middleware import PermissionsMiddleware  # noqa: E402
app.add_middleware(PermissionsMiddleware)


@api.get("/")
async def root():
    return {"service": "paneltec-civil", "version": "0.2.0"}


@api.get("/health")
async def health():
    return {"ok": True}


@api.get("/whoami")
async def whoami(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "role": user["role"]}


# mount routers
api.include_router(auth_router)
api.include_router(ai_router)
api.include_router(dashboard_router)
api.include_router(files_router)
api.include_router(swms_router)
api.include_router(prestarts_router)
api.include_router(diary_router)
api.include_router(hazards_router)
api.include_router(incidents_router)
api.include_router(inspections_router)
api.include_router(contractors_router)
api.include_router(renewals_router)
api.include_router(renewals_public_router)
api.include_router(exports_router)
api.include_router(integrations_router)
api.include_router(ask_router)
api.include_router(users_router)
api.include_router(email_router)
api.include_router(record_email_router)

app.include_router(api)


@app.on_event("startup")
async def on_startup():
    await ensure_indexes()
    result = await seed_all()
    log.info("Seeded: %s", result["counts"])


@app.on_event("shutdown")
async def on_shutdown():
    close_db()
