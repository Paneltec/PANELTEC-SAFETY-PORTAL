# AGENTS.md

## Cursor Cloud specific instructions

This repo is the **Paneltec Civil WHS Compliance Platform** — a monorepo with three surfaces plus MongoDB:

| Service | Path | Port | Required? | Run (dev) |
|---|---|---|---|---|
| MongoDB | system | 27017 | Yes (sole datastore) | `mongod --dbpath /data/db --logpath /var/log/mongodb/mongod.log --bind_ip 127.0.0.1` |
| Backend API (FastAPI) | `backend/` | 8001 | Yes | `cd backend && .venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 --reload` |
| Web frontend (CRA/CRACO) | `frontend/` | 3000 | Yes | `cd frontend && BROWSER=none yarn start` |
| Mobile (Expo RN) | `mobile/` | 8081/3001 | Optional (field-crew phone flow) | `cd mobile && yarn start` |

The base README (`README.md`) documents features, the permission model, and standard commands; it assumes the code lives at `/app` and runs under `supervisor`. In Cursor Cloud there is **no supervisor** — start each service manually (commands above), preferably in a `tmux` session.

### Non-obvious setup caveats (already handled by the base snapshot + update script)

- **Python deps need a custom index + the legacy resolver.** `emergentintegrations` and `litellm` are pinned to a private wheel URL and the modern pip resolver reports a false `ResolutionImpossible`. Install with: `pip install --use-deprecated=legacy-resolver -r requirements.txt --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/`. The backend uses a venv at `backend/.venv`.
- **Hardcoded `/app` upload path.** `backend/pdf_renderer.py` defaults `UPLOADS_DIR` to `/app/backend/uploads`, which does not exist here and crashes startup. `backend/.env` sets `UPLOADS_DIR=/workspace/backend/uploads` to fix this. Route strings like `/app/swms` in `dashboards.py`/`email_outbox.py` are frontend URLs, not filesystem paths — leave them alone.
- **`.env` files are git-ignored** and live on disk (not in the repo). `backend/.env` needs `MONGO_URL`, `DB_NAME`, `JWT_SECRET` (all hard-required), plus `UPLOADS_DIR`, `COMMS_SAFE_MODE=on`, `DEMO_PASSWORD`. `frontend/.env` needs `REACT_APP_BACKEND_URL=http://localhost:8001`. `EMERGENT_LLM_KEY` is only needed to exercise AI features (SWMS generation, Ask Intelligence, photo hazard classification); everything else works without it.
- **The DB self-seeds on backend startup** (`seed.py::seed_all` via the FastAPI `startup` event) — idempotent. It creates the `paneltec-civil` org, 2 workspaces, 5 demo users, and sample records. No manual seed step is required.
- **Startup logs a benign warning** that `libreoffice`, `tesseract`, and `poppler` are missing and triggers an async reinstall. Core API + web flows work without them; they are only needed for some DOCX→PDF / OCR paths.

### Dev login credentials (seeded, dev-only)

`admin@paneltec.com` / `demo123` (role admin). Other seeded roles share the same password: `demo@paneltec.com` (hseq_lead), `super@paneltec.com` (supervisor), `worker@paneltec.com` (worker), `audit@paneltec.com` (auditor).

### Tests & lint

- Backend regression suite: `cd /workspace && backend/.venv/bin/python -m pytest backend/tests/test_worker_leaks.py -v` (targets the running backend on `localhost:8001`). It expects the accounts `stephen@paneltec.com.au` / `Mcgstephen50#` (admin) and `worker_stephen@paneltec.com.au` / `WorkerTest123!` (worker); the automatic seed does **not** create these, so create them first if a fresh DB is used. Two tests (`test_*_workers_list_*`) also require rows in the `workers` collection, which the seed does not populate.
- Frontend lint: CRA/`react-scripts` runs ESLint automatically during `yarn start`/`yarn build` (warnings only, no errors). There is no standalone lint script.
- Backend has `flake8`/`black`/`mypy` installed (no repo config). `scripts/check_no_legacy_login_copy.sh` is a lightweight CI-style guard.
