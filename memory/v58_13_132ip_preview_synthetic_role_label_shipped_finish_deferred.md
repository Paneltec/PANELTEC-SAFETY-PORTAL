# v58.13.132ip — Preview synthetic_user carries role_label (defense-in-depth) · SHIPPED (finish deferred)

**Ship phase:** `.132ip`
**Scope:** Backend-only. Home-screen "Admin" label bug is a mobile-side stale-localStorage bug — DELEGATED to Expo team. This ship makes the mobile fix a 1-liner by ensuring `role_label` is already present in the preview user object mobile stores in sessionStorage.

## User pain

Screenshot shows Home screen header rendering `Admin` under `Hi, MATTHEW` — not Profile. `.132io` fixed `/api/auth/me` but Home screen never calls that endpoint.

## Root cause (in one paragraph)

`mobile/app/(tabs)/home.tsx:56-62` reads `getStoredUser()` (sessionStorage `paneltec_preview_user` in preview) + `getStoredRoleLabel()` (localStorage `paneltec_role_label` on the `.expo` subdomain) with **no `isPreviewSession()` guard on the roleLabel read**. Admin's earlier PIN-login on that Expo subdomain stashed `paneltec_role_label="Admin"` into localStorage; that value persists across the preview swap and beats every fallback. Meanwhile the sessionStorage preview user object had a collapsed `role_id="worker"` and NO `role_label` field.

## What shipped (backend only)

`backend/mobile_preview.py::mint_preview_user` — the `synthetic_user` object returned by `/api/mobile/preview-user` (and stored by mobile splash into `sessionStorage.paneltec_preview_user`) now carries `role_label = payload["role_label"]`. Scope-aware: `"Paneltec Civil"` / `"Viatec Traffic Solutions"` / `"Admin"` / `"External Contractor"` for the four scopes, Title-cased legacy `role_id` otherwise. Applied to both branches of the function (with and without `worker_snapshot`).

This ship is defense-in-depth. It does NOT fix the visible bug on its own because home.tsx never reads `user.role_label` — it reads `getStoredRoleLabel()` first. Once the Expo team ships the mobile fix (below), the label is already waiting in the object.

## Mobile-side fix (DELEGATED to Expo team)

Two 1-line changes:

**`mobile/app/(tabs)/home.tsx`** — add `isPreviewSession()` guard to the roleLabel priority:

```diff
   const loadData = useCallback(async () => {
-    const [u, rl] = await Promise.all([
-      getStoredUser(),
-      getStoredRoleLabel(),
-    ]);
-    setUser(u);
-    setRoleLabel(rl || '');
+    const u = await getStoredUser();
+    setUser(u);
+    if (isPreviewSession()) {
+      // Preview: sessionStorage user is fresh (per-.132ip carries
+      // role_label). Skip localStorage entirely — the .expo subdomain's
+      // paneltec_role_label is stale/admin-scoped and would beat the
+      // scope label otherwise.
+      setRoleLabel(u?.role_label || u?.role_id || u?.role || '');
+    } else {
+      const rl = await getStoredRoleLabel();
+      setRoleLabel(rl || u?.role_label || u?.role_id || u?.role || '');
+    }
```

Import addition:
```diff
- import { getStoredUser, getStoredRoleLabel, clearSession } from '../../src/services/auth';
+ import { getStoredUser, getStoredRoleLabel, clearSession, isPreviewSession } from '../../src/services/auth';
```

Same pattern as the `.132in` fix already in `profile.tsx:50-55`. Audit every other tab (my-work, forms, fleet, outbox, ask-ai, qr-scan) for the same anti-pattern while you're in there.

## Version pin (lockstep)

- `RUNNING_VERSION`        → `paneltec-v160.3.9.58.13.132ip`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ip`
- `CACHE_VERSION` (SW)     → `paneltec-v160.3.9.58.13.132ip`

## Ban compliance

- No `/app/mobile/` edits. Read-only inspection of `home.tsx`, `auth.ts` used to confirm the delegation is correct.
- No `testing_agent` / `e1_tester` / `finish`.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Per Stephen's new standing rule (2026-09-18): no pytest, no Playwright verify, ship fast.

## Live curl check (fast, no full suite)

```
GET /api/mobile/preview-user?scope=paneltec_civil&worker_id=<matthew>
  → user.role_label = "Paneltec Civil"     ← NEW (was missing)
    user.name       = "MATTHEW WELLS (preview)"
    user.role_id    = "worker"              (collapsed by scope aggregation)
```

## Failure mode until Expo team ships the mobile fix

Home screen will continue to display "Admin" for admins whose `.expo` subdomain localStorage carries a stale `paneltec_role_label`. Workaround for the user: manually clear localStorage on the `.expo.preview.emergentagent.com` origin (DevTools → Application → Local Storage → remove `paneltec_role_label`). One-shot; won't survive a future real PIN-login on that origin.
