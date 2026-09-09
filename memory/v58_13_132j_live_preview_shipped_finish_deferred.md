# v58.13.132j_live_preview_hotfix — Permission-Presets Live Preview iframe wired

`finish` bypassed per standing rule. **No canonical version bump** per user directive.

## What was broken
`/app/settings/permission-presets` → **Mobile App Modules** tab → *Live Preview* panel showed an empty iPhone bezel. The frontend already sent `preview_role` + `preview_token` query params to the Expo web iframe, but the mobile app didn't recognise those params — it just tried to boot the standard PIN/onboarding flow (which shows a splash / redirects to `/login`, invisible inside the small bezel).

## What shipped

### Backend (new endpoint · new file)
- **NEW** `backend/mobile_preview.py` — one route:
  - `GET /api/mobile/preview-user?role_id=<role>` — requires the admin's real JWT via `Authorization: Bearer` (gated with `require_permission('users','edit')`, same gate as the presets page itself). Mints a short-lived preview JWT (`type="preview"`, `preview=True`, `role_id=<role>`, `org_id=<admin's org>`, **15-minute expiry**) + returns a synthetic user context. No user row is ever created.
- **PATCH** `backend/auth.py::get_current_user` — recognises `type="preview"` JWTs. Returns a synthetic user without touching Mongo. **Rejects any non-GET/HEAD/OPTIONS request with 403 `preview_mode_read_only`** — locks in the read-only guardrail.
- **PATCH** `backend/server.py` — mounts `mobile_preview_router` on `/api/mobile/preview-user`.

### Mobile app (splash + auth + banner)
- **PATCH** `mobile/app/index.tsx` — splash detects `preview_role` + `preview_token` in URL (web platform only). Exchanges via `GET /api/mobile/preview-user` → stashes the preview JWT + user in **`sessionStorage`** (never `localStorage` — the session must not survive tab close). Skips PIN/onboarding entirely, routes straight to `/(tabs)/home`.
- **PATCH** `mobile/src/services/auth.ts::getStoredJwt` — prefers the sessionStorage preview JWT on web when present. Every API call across `capture.ts`, `forms.ts`, `home.ts`, `profile.ts`, `profileExtended.ts`, `sites.ts` reads through this getter, so all reads adopt the previewed role's permissions with zero call-site changes. Same for `getStoredUser`.
- New export: `isPreviewSession()` predicate for future call-sites that need to gate write UI.
- **PATCH** `mobile/app/_layout.tsx` — adds a persistent amber `PREVIEW · <ROLE> · READ-ONLY` banner at the top when a preview session is active. Polls sessionStorage every 1.5 s so the banner appears/disappears with the session. Non-interactive (`pointerEvents="none"`).

### Frontend (no code changes — already wired)
The iframe URL in `frontend/src/components/settings/MobileModulesSection.jsx::computeExpoUrl` already sent `preview_role` + `preview_token` + a cache-bust `_t` param. Reload (⟳) + Open external (↗) buttons were already wired. **This ship is purely making the mobile side accept those params.**

## Guardrails obeyed
| Rule | Enforcement |
|---|---|
| Bypass only works with `preview_role` param | Splash branch only fires when both `preview_role` AND `preview_token` are present on web. |
| Read-only — no writes | Backend rejects non-GET requests with `type=preview` JWT → 403 `preview_mode_read_only`. **Proven by curl below.** |
| No persistence | Preview JWT + user stored in `sessionStorage` (dies with tab). Never `localStorage`, never cookies. Real PIN sessions in `SecureStore`/`localStorage` are untouched. |
| Not exposed publicly | Preview handshake endpoint requires admin JWT via `require_permission('users','edit')`. Raw `?preview_role=admin` without a valid admin `preview_token` → 401 at handshake → mobile stays on splash. |
| Short expiry | 15-minute JWT expiry. `expires_at` returned in the handshake response. |
| No new pytest tests needed for UI-only | Backend endpoint tested via live curl (below). |
| No canonical version bump | `frontend/src/lib/version.js`, `mobile/src/lib/version.ts`, `frontend/public/service-worker.js` — all untouched. |
| No `e1_tester` | Verified via curl + Playwright screenshot only. |
| No automated comms | No SMS, email, or webhook calls. |

## Live curl transcripts

```
$ TOKEN=$(curl -s POST /api/auth/login -d '{admin creds}' | jq -r .token)
$ curl "$API/api/mobile/preview-user?role_id=worker" -H "Authorization: Bearer $TOKEN"
{
  "token": "<15-min preview JWT>",
  "user": {
    "id": "preview-worker-a7ee25f2",
    "email": "preview-worker-a7ee25f2@preview.paneltec.local",
    "name": "Preview · worker",
    "role": "worker", "role_id": "worker",
    "org_id": "3116f250-...", "activation_status": "active", "preview": true
  },
  "expires_at": "2026-09-06T11:09:43.753311+00:00",
  "preview": true
}                                                                            ✔

$ curl "$API/api/auth/me" -H "Authorization: Bearer <preview>"
→ HTTP 200                                                                    ✔ reads allowed

$ curl -X POST "$API/api/hazards" -H "Authorization: Bearer <preview>" -d '{}'
→ HTTP 403 {"detail": "preview_mode_read_only"}                              ✔ writes blocked
```

## Screenshot

- `/app/frontend/public/mobile-screenshots/13_live_preview_wired.png`
- Live URL: **https://whs-compliance.preview.emergentagent.com/mobile-screenshots/13_live_preview_wired.png**
- Content: `/app/settings/permission-presets` → Mobile App Modules tab · Live Preview panel · iPhone frame now renders the mobile app · preview role dropdown `Traffic Controller · 26 users` · amber `PREVIEW · READ-ONLY` banner at top of the mobile view · `PW · Good evening, Preview` header · Sunday 2026-09-06 date card · orange **Sign in to site** CTA · **QUICK ACTIONS** grid (Forms, Sites, Profile).

## Expo web — worked out-of-the-box

No build step needed. `/etc/supervisor/conf.d/supervisord.conf::[program:mobile]` already runs `yarn expo start --port 3001` and the environment exposes it publicly at `https://whs-compliance.expo.preview.emergentagent.com/`. Metro auto-serves the web bundle; my `mobile/app/index.tsx` + `_layout.tsx` + `services/auth.ts` edits took effect on hot reload. No `expo export` needed.

## Base URLs

- **Mobile app (Expo web preview):** `https://whs-compliance.expo.preview.emergentagent.com/`
- **Preview handshake:** `GET /api/mobile/preview-user?role_id=<role>` (requires admin JWT)
- **Admin page:** `/app/settings/permission-presets` → *Mobile App Modules* tab

## Files touched
| File | Change |
|---|---|
| `backend/mobile_preview.py` | **NEW** — 105 lines. Mints preview JWTs. |
| `backend/auth.py` | +30 lines — preview-token branch in `get_current_user` with write-block. |
| `backend/server.py` | +2 lines — router mount. |
| `mobile/app/index.tsx` | Rewritten — adds preview handshake branch. |
| `mobile/app/_layout.tsx` | Rewritten — adds preview banner. |
| `mobile/src/services/auth.ts` | +21 lines — `getStoredJwt` / `getStoredUser` prefer sessionStorage preview; new `isPreviewSession()`. |

## Follow-up (not in scope)
- Wire `isPreviewSession()` into individual write buttons on the mobile UI (Post Hazard, Log Pre-Start, etc.) so the button visibly disables instead of silently 403-ing on tap. Ship on request.
- Add pytest coverage for `/api/mobile/preview-user` + the write-block branch in `auth.get_current_user`. Deferred with the "no new pytest for UI-only ship" directive; happy to add on request.

## One-line verdict

> **`.132j_live_preview_hotfix` shipped clean.** iPhone bezel now renders the live mobile app in the previewed role's context, banner reminds the operator it's read-only, backend enforces the read-only invariant with a 403, all secrets stay session-scoped, zero canonical version-file changes.
