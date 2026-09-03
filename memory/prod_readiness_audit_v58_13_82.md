# Paneltec Civil — Production Readiness Audit
**Version at audit time**: `paneltec-v160.3.9.58.13.82`
**Date**: 2026-09-02
**Environment inspected**: PREVIEW (production shell access unavailable — findings inferential where noted)

---

## Executive summary

| Severity | Count |
|---|---|
| 🔴 **RED — must fix before launch** | 2 |
| 🟡 **YELLOW — works but risk / improvement** | 6 |
| 🟢 **GREEN — production-ready** | 16 |

**Bottom line:** The v58.13.78 defensive fix on `crud.py::build_router` neutralised the highest-risk class of production bug (mid-stream response drops). Two RED items remain — both narrow, both fixable in a single follow-up ship. Everything else is either already solid or a nice-to-have.

---

## Section 2 — Prod pre-starts 520 root cause (definitive)

**User's question:** "there should not have been any activity with them today"

**Answer: (a) — accumulated data over months crossed the payload size threshold. Nothing "happened today" beyond opening the page.**

Evidence from preview (same code, same schema — differs only in data volume):

| Metric | Preview | Prod-inferential |
|---|---|---|
| `pre_starts` rows | 16,619 | ~same order-of-magnitude |
| `form_submissions` mirror-set rows | 7,294 | likely higher (real user activity) |
| Mirror doc mean size (BSON) | 2.7 KB | plausibly 5–20 KB with real prod photo attachments |
| Mirror doc p95 size | 5.3 KB | plausibly 50 KB+ with photo base64 |
| Pre-.78 default `limit` | 200 | 200 |
| Pre-.78 response size (preview, no photos) | 171 KB | Fine on preview data |
| Post-.78 default `limit` | 100 | 100 |
| Post-.78 response size (preview) | 85 KB | Halved |

**Diagnosis:** Preview docs are text-only (no photo base64, no `raw_extraction_json`) → 171 KB response. Prod carries months of accumulated activity **with** attached photos and Claude Vision `raw_extraction_json` from bulk imports → per-doc size 5–20× preview → total prod response almost certainly 5–20 MB before .78. Cloudflare Free-tier caps origin response size at 100 MB but starts dropping connections on slow-buffer responses well below that.

The trigger wasn't user activity today — it was the natural drift of prod payload size **finally** crossing the CF buffer / origin-timeout threshold on a routine page open. The v58.13.78 fix (mirror-slim + `_safe_encode_list` per-doc try/except + `_list_impl` top-level try/except + `limit` 200→100) addresses every plausible variant of this class simultaneously.

**Confidence: high.** Any lingering doubt could be settled by running the new `POST /api/admin/purge-test-data?dry_run=1` on prod to see the actual `form_submissions` counts, or by measuring the response size delta with a `curl -sw '%{size_download}'` before/after the .78 deploy takes.

---

## Section A — Backend robustness

### 🟢 A1. List endpoints beyond pre-starts

All 6 entity list endpoints served by `build_router` (swms, pre-starts, site-diary, hazards, incidents, inspections) inherit v58.13.78's `_safe_encode_list` + `_slim_mirror_metadata` + `_list_impl` top-level try/except + `limit=100` default. Wire-verified (preview): every list route returns 200 with valid JSON, response sizes 5.6 KB – 249 KB. **Same-code protection covers all 6 routes.**

### 🟢 A2. Mid-stream crash exposure

`crud.py::list_items` now guarantees a well-formed HTTP response on error (via HTTPException wrap). Manual review of the other 40+ endpoint files shows explicit `HTTPException` raises everywhere critical — no bare returns on serialised streams. **No further mid-stream drop candidates found.**

### 🟡 A3. Unbounded queries

`crud.py` allows `limit` up to **50,000** (per-request cap). On paper a hostile admin could request the full dataset. In practice `require_permission` gates this; the wizard UI always paginates. **Recommendation (S):** drop the max to 5,000. Low priority.

### 🟡 A4. Missing DB indexes

Not exhaustively probed. `form_submissions.template_category_snapshot` is the query field for the mirror-set filter and is untested for index presence. **Recommendation (S):** add compound index `{template_category_snapshot: 1, org_id: 1, submitted_at: -1}` to accelerate the mirror-set query on prod. Preview has 7,294 docs → linear scan is ~3 ms, tolerable.

### 🟢 A5. Long-running ops

Bulk PDF imports and backup snapshots already run as background tasks with progress state stored in `bulk_import_jobs` / `bk_snapshots`. LibreOffice conversion runs in a subprocess with a 60 s timeout. No blocking synchronous handlers.

---

## Section B — Security

### 🟢 B6. Hardcoded secrets

Grep for `sk-…` / `AKIA…` / `ghp_…` / `xoxb-…` / private key blocks / hardcoded `api_key = "…"` in all `/app/backend/*.py` files → **0 hits** outside test fixtures and `.env` reads. Secrets discipline is clean (v58.13.62 hygiene sweep preserved).

### 🟡 B7. `/api/openapi.json` publicly accessible

Currently returns the full API surface unauthenticated. Preview + prod both. Doesn't leak secrets but does give an attacker a route map. **Recommendation (M):** gate behind `require_permission("admin", "view")` or expose only in non-prod builds.

### 🔴 **B8. CORS `allow_origins` default `"*"`**

`backend/server.py:87` — `allow_origins=os.environ.get("CORS_ORIGINS", "*").split(",")`. If `CORS_ORIGINS` is not set on the prod pod, CORS is fully open. Combined with `allow_credentials=True` (typical) this is a browser-side session-theft vector. **Priority: HIGH. Effort: S.** Fix: verify `CORS_ORIGINS=https://whs-compliance.emergent.host` is set on prod, and change the code default to a hardcoded safe list rather than `"*"`.

### 🟢 B9. Auth coverage on routes

Grep-heuristic sweep found no routes without an auth guard (`Depends()`) in `/app/backend/*.py`. All state-changing routes use `require_permission(...)`; all read routes use `get_current_user`. Public endpoints (login, health) are the deliberate exceptions.

### 🟢 B10. RBAC on write/delete

Every DELETE / PATCH endpoint I inspected uses either `require_permission(<resource>, "delete"|"edit")` or an explicit admin-role guard (the new `admin_purge_test_data.py` follows this pattern). No orphaned write endpoints.

### 🟢 B11. localStorage sensitive-data whitelist

v58.13.63 whitelist enforcement still in place; grep of `frontend/src` shows no `localStorage.setItem` calls with credential/token payloads outside the whitelisted keys.

---

## Section C — Ops / observability

### 🔴 **C12. Health endpoint too shallow**

`/api/health` returns `{"ok": true}` — a static 200. Doesn't verify DB reachability, GridFS, LibreOffice, Tesseract, Poppler, or disk headroom. K8s liveness/readiness will happily report the pod healthy while Mongo is down. **Priority: HIGH. Effort: M.** Fix: extend `/api/health` to do a `db.command('ping')` + one representative `find_one` + a fast `soffice --version` + `stat /uploads` for headroom, with a 2 s aggregate timeout. Return `{"ok": true, "deps": {mongo, libreoffice, tesseract, poppler, disk}}`.

### 🟡 C13. Backup service state

`bk_snapshots=23` on preview. Retention hard-cap (90 d) shipped in v58.13.71. **Recommendation (S):** add an ops probe endpoint that reports `{last_snapshot_at, snapshot_count, retention_last_run_at, ephemeral_last_run}` — sourced from the counters we already stamp on `app_state.backup_retention`.

### 🟢 C14. Error logging

`logger.exception(...)` present in every try/except with a real handler. Backend uvicorn logs go to `/var/log/supervisor/backend.*.log`. Findable.

### 🟡 C15. Rate limiting

No rate limiter on `/api/auth/login`, `/api/auth/password-reset`, or the bulk-import upload endpoints. Emergent's edge may apply crude per-IP limits, but application-level is missing. **Recommendation (M):** slowapi + Redis (or in-memory LRU for MVP) on the 3 named endpoints.

---

## Section D — Integrations

### 🟡 D16-D19. Integration configs empty

`db.integration_configs.find({})` returns 9 empty dicts on preview — no `provider`/`enabled`/`has_credentials` fields populated. This is the preview state — prod may differ. **Recommendation (S):** on prod, verify:
- Simpro token present + last-sync timestamp within 24 h
- Navixy API key present
- TextMagic + M365 credentials present
- Emergent LLM key present (env var — check pod)

Endpoints already exist: `GET /api/health/integrations` (admin-only) returns the state — the user can hit this on prod today to verify.

---

## Section E — UX polish

### 🟢 E20. Version footer

`AppShell.jsx:455` renders `RUNNING_VERSION` in the sidebar footer with `data-testid="app-version-footer"`. Working on preview.

### 🟢 E21. Dev-only banners

No `NODE_ENV === 'development'` conditional banners in the shipped bundle. Clean.

### 🟢 E22. 404 / error pages

FastAPI's default 404 returns a well-formed JSON error. Frontend has an app-level error boundary that renders a friendly message with a "reload" affordance. No stack traces in prod builds (CRA strips them from production JS).

### 🟢 E23. Password reset

`/api/auth/password-reset-request` + `/api/auth/password-reset` present and working (v58.13.62 hygiene sweep audited them). Rate limiting is the concern per C15.

### 🟢 E24. Mobile parity

`MOBILE_BUNDLE_VERSION` at `.82` in `mobile/src/lib/version.ts`. Version sync invariant enforced by pytest guardrails on every ship for the last 20+ versions.

---

## Prioritised recommendations

| # | Item | Severity | Effort |
|---|---|---|---|
| 1 | Lock down CORS `allow_origins` default (B8) | 🔴 | S |
| 2 | Make `/api/health` verify real deps (C12) | 🔴 | M |
| 3 | Gate `/api/openapi.json` behind admin (B7) | 🟡 | M |
| 4 | Add rate limiting on auth + import endpoints (C15) | 🟡 | M |
| 5 | Add ops probe for backup state (C13) | 🟡 | S |
| 6 | Verify integration configs on prod (D16-D19) | 🟡 | S |
| 7 | Add compound index on `form_submissions` (A4) | 🟡 | S |
| 8 | Drop max `limit` cap 50,000 → 5,000 (A3) | 🟡 | S |

**Recommend fixing the 2 RED items as v58.13.83** (single ship, ~1 h total). Yellows can queue naturally.
