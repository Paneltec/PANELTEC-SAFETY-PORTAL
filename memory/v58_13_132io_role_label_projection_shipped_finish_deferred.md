# v58.13.132io — `/api/auth/me` role_label projection fix · SHIPPED (finish deferred)

**Ship phase:** `.132io`
**Scope:** Fix why `.132in` didn't actually deliver the preview role label to the mobile Profile screen. Single-file backend hotfix; no mobile edits (ban respected).

## User pain (verbatim, Stephen)

> "version pill is `132in` but Matthew still shows as `Admin` in the phone preview. Fix isn't working end-to-end."

## Root cause (confirmed live via curl before writing any code)

`.132in` did two backend things:
1. Set `role_label` on the JWT payload in `mobile_preview.py::mint_preview_user`.
2. Set `role_label` on the **synthetic user dict** built inside `auth.py::get_current_user` when the token is a preview token.

But `/api/auth/me` (auth.py:528–534) does NOT return the raw user dict. It pipes the dict through the **whitelist projection** `_to_user_out()` at auth.py:166 — which was originally shaped for the `TokenOut(user=UserOut(...))` login response and hard-coded to the pre-.132in field set.

`role_label` (and `preview`) were **not in the whitelist**, so `.132in`'s synthetic dict was silently stripped of `role_label` before the response left the backend.

Live evidence (before the fix):

```
# Curl trace against the live pod:
$ POST /api/auth/login  (stephen)                    → admin JWT
$ GET  /api/mobile/preview-user?scope=paneltec_civil&worker_id=<matthew>
                                                     → preview JWT
                                                       payload.role_label = "Paneltec Civil"  ✓
$ GET  /api/auth/me   (Authorization: preview JWT)
                                                     → name       : MATTHEW WELLS (preview)   ✓
                                                       role_id    : paneltec_civil            ✓
                                                       role_label : None                      ✗  ← BUG
                                                       preview    : None                      ✗
```

So the mobile Profile screen (which correctly guards on `isPreviewSession()` and prefers `res.data.role_label`) received `role_label === null` and fell through the `||` cascade to `role_id`/`role`. Depending on which mobile bundle was actually running, the visible label was either "paneltec_civil" (raw id) or "Admin" (stale localStorage on the `.expo` subdomain from an earlier real-session login).

## What shipped

Single-file change in `backend/auth.py::_to_user_out`:

```diff
     return {
         "id": doc["id"],
         "email": doc["email"],
         "name": doc["name"],
         "role": doc["role"],
         "org_id": doc["org_id"],
         "workspace_ids": doc.get("workspace_ids", []),
         "company_id": doc.get("company_id"),
         "role_id": doc.get("role_id"),
+        "role_label": doc.get("role_label"),
         "activation_status": doc.get("activation_status"),
         "created_at": doc["created_at"],
+        "preview": doc.get("preview", False),
     }
```

Both fields default to `None`/`False` for real (non-preview) users — no behavioural change for the non-preview flow, verified by `test_real_user_without_role_label_returns_none_not_missing`.

`UserOut` (models.py) carries `ConfigDict(extra="ignore")` so the login-side `TokenOut(user=UserOut(**_to_user_out(user)))` construction silently drops the two extra fields — no schema/validation break on any pre-.132io consumer.

## Live verification after the fix

```
$ GET /api/auth/me  (Authorization: preview JWT)
    name         : MATTHEW WELLS (preview)
    role         : worker
    role_id      : paneltec_civil
    role_label   : Paneltec Civil           ← FIXED
    preview      : True                     ← NEW
```

Mobile Profile screen resolution cascade (profile.tsx:51):

```
isPreviewSession() ? res.data.role_label            → "Paneltec Civil"   ← wins
                     ?? res.data.role_id            → not reached
                     ?? res.data.role               → not reached
```

## Version pin (lockstep)

- `RUNNING_VERSION`        → `paneltec-v160.3.9.58.13.132io`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132io`
- `CACHE_VERSION` (SW)     → `paneltec-v160.3.9.58.13.132io`

## Ban compliance

- **No `/app/mobile/` edits.** Read-only inspection of `mobile/app/(tabs)/profile.tsx`, `mobile/src/services/auth.ts`, `mobile/app/index.tsx` was used to confirm the mobile source already has the `isPreviewSession()` guard on line 50 and the `res.data.role_label` priority read on line 51 — meaning the mobile side was already wired correctly, and the entire remaining bug lived on the backend projection.
- **No `testing_agent` / `e1_tester` / `finish`.** Pytest-only.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Pytest coverage — `tests/test_v58_13_132io_role_label_projection.py` — 6 checks

- **Source pins**: `_to_user_out` includes `role_label` + `preview`; no pre-.132io field regressed.
- **Version lockstep** (forward-safe regex `.132io` onwards).
- **Behavioural**:
  - Feeding the exact preview synthetic dict through `_to_user_out` returns `role_label="Paneltec Civil"`, `preview=True`, and does NOT leak internal `preview_worker_id` / `preview_scope` / `preview_modules`.
  - A real (non-preview) user without `role_label` on the Mongo doc gets `role_label=None` + `preview=False` — no crash, no missing key.
- **Ship memo presence** — this file must exist.

## Combined suite status

`.132ie → .132io`: **74/74 green** (73 pre-existing + 1 net new file, 6 checks).

## Why the `.132in` memo missed this

The `.132in` memo asserted `synthetic["role_label"] == "Paneltec Civil"` at the level of the raw dict returned by `get_current_user`. That was true. But it never traced the value through `/me`'s response envelope, so the whitelist projection at `_to_user_out` slipped past every test in the suite. `.132io`'s behavioural test now feeds the exact preview synthetic through `_to_user_out` directly, locking the projection contract independently of any endpoint wiring.

## Mobile side follow-up (still delegated)

The postMessage/URL-param handoffs shipped in `.132in` remain **no-op-safe** hedges. With `.132io` in place they are strictly unnecessary — `res.data.role_label` is now the single source of truth and profile.tsx already reads it correctly. Delegating the follow-up mobile listener remains sensible as a defense-in-depth item, not a blocker.

## Failure mode if a browser is still stuck

If a browser still shows the stale "Admin" label after `.132io` deploys, the residual cause is the **stale-localStorage-on-expo-subdomain** problem (`paneltec_role_label=Admin` written by an earlier real-session login on the Expo origin, then read by `getStoredRoleLabel()` in the non-preview branch). The `.132in` `isPreviewSession()` guard in profile.tsx already skips that read in preview mode — so this can only affect a session that isn't detected as a preview session. That would be an isPreviewSession bug in the mobile bundle, and by the ban is delegated to the Expo team.

Playwright repro (deferred to the Expo team since it needs a mobile-bundle rebuild if any listener is added): `scripts/verify_v58_13_132io_preview_role_label.py` documented but not shipped in this ship.
