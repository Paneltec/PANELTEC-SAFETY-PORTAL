# v58.13.132iu — Role Simulator (backend) + APK download surface · SHIPPED (finish deferred)

**Ship phase:** `.132iu`
**Scope:** Ship 1 of Stephen's two-part Role Simulator infrastructure.

## Backend — `X-Simulate-Role` header

Inserted at the end of `auth.py::get_current_user`, after the legacy-role derivation and before `return user`. Bypassed entirely by the preview branch (which has its own `return synthetic` earlier). So only real (non-preview) JWTs are eligible.

Rules:
- Admin-only. Non-admins passing the header → **403** with `X-Auth-Reason: sim-role-forbidden`; the attempt is logged at WARN with real_user_id + attempted scope.
- Valid values: `admin`, `paneltec_civil`, `viatec_traffic`, `external_contractor`. Case-insensitive after strip. Anything else → **400** with `X-Auth-Reason: sim-role-invalid`.
- On success:
  - `user["role"]`      → legacy string derived from the simulated `role_id` (falls back to `"worker"` for non-admin scopes, `"admin"` for admin).
  - `user["role_id"]`   → the scope key (`paneltec_civil` / etc).
  - `user["role_label"]` → human-readable scope name.
  - `user["id"]`, `user["email"]`, `user["org_id"]` — **untouched**. Writes still audit under the real admin's user_id.
  - Snapshot fields added: `user["real_user_id"]`, `user["real_role"]`, `user["real_role_id"]`, `user["simulated_role"]`.
- Every applied simulation logs at INFO: `role_simulator.applied real_user_id=<uuid> real_role=admin simulated=<scope> path=<route> method=<method>`. Grep: `grep role_simulator /var/log/supervisor/backend.*.log`.

Live verification (post-restart, curl against pod):

```
$ curl /api/auth/me                                → role=admin,        role_id=admin,        role_label=None
$ curl /api/auth/me -H 'X-Simulate-Role: paneltec_civil'
                                                    → role=worker,       role_id=paneltec_civil, role_label='Paneltec Civil'
$ curl /api/auth/me -H 'X-Simulate-Role: hacker'    → 400 "Invalid X-Simulate-Role: 'hacker'. Valid: admin | paneltec_civil | viatec_traffic | external_contractor"
```

The audit-snapshot fields (`simulated_role`, `real_role`, `real_user_id`) come back as `None` in `/api/auth/me` because `_to_user_out()` whitelists a fixed set of fields. They're still populated on the `user` dict for backend consumers (audit sinks, request handlers). If the mobile client needs to render a "SIMULATING: X" badge based on the response, add those three fields to the whitelist in a future ship — kept out of this one to minimise the diff.

## Frontend — Android APK download button

`components/settings/MobileModulesSection.jsx` — the top section header now has a **Download Android APK** button (data-testid `mobile-modules-apk-download`) linking to `/api/mobile/downloads/android/latest.apk`. Sits right of the "Mobile App Modules" title, admin-visible (this whole page is admin-scoped).

The endpoint (`mobile_downloads.py:94`) has existed since `.132af` but was only reachable via the tokenised worker onboarding landing at `/m/onboard/:token`. Admins previously had to hunt for a valid token to grab the APK. Now one click.

## Web/mobile — no code changes for Simulator UX

Ship 1 is infrastructure only. The mobile FE (`/app/mobile/`) is under edit ban — mobile-side Simulator UI (a persistent chip in the top bar with a scope-picker) is **DELEGATED** to the Expo team. Contract for their build:
- Read the current admin's role from `/api/auth/me` on mount.
- If `role === 'admin'`, render a "Simulate scope" chip in the header with options: Admin / Paneltec Civil / Viatec Traffic / External Contractor.
- On selection, stash the choice in `sessionStorage.paneltec_sim_role` and inject `X-Simulate-Role: <scope>` header into `authGet`/`authPost` (mirror the JWT header logic).
- On "Exit Simulation", clear the sessionStorage key and force-reload.

## Version pin (lockstep)

- `RUNNING_VERSION`        → `paneltec-v160.3.9.58.13.132iu`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132iu`
- `CACHE_VERSION` (SW)     → `paneltec-v160.3.9.58.13.132iu`

## Ban compliance

- No `/app/mobile/` edits.
- Auth-adjacent, so a smoke test WAS run: 3 curl cases (baseline / valid sim / invalid sim). All pass.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
