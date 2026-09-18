# v58.13.132in — Preview session role display fix · SHIPPED (finish deferred)

**Ship phase:** `.132in`
**Scope:** Fix admin's "Preview as Matthew Wells" showing role=admin on the mobile Profile screen. Three-part backend + web-host fix; underlying mobile-side bug flagged for the Expo team.

## Root cause (recap)

1. `backend/auth.py::get_current_user` synthetic preview user was hard-coded to `name="Preview · worker"` and `role_id=payload.role_id` (which the scope-collapse in `mobile_preview.py` had already flattened to `"worker"`). Never surfaced `preview_scope` or a role label.
2. `backend/mobile_preview.py::mint_preview_user` JWT payload didn't carry a `role_label` claim — mobile Profile had nothing scope-aware to display even if it wanted to.
3. `frontend/src/components/settings/MobileModulesSection.jsx` iframe boot never handed the correct role label across to the mobile app. Because the Expo build runs on a different subdomain (`<sub>.expo.preview…` vs `<sub>.preview…`), the parent frame CANNOT write into the iframe's `localStorage` directly — the SecurityError blocks it.
4. `mobile/app/(tabs)/profile.tsx` line 49: `setRoleLabel(rl || res.data.role_id || res.data.role || '')` where `rl = await getStoredRoleLabel()` reads from **localStorage** (which is per-origin, so scoped to the Expo subdomain, but persists across preview sessions once written). The admin's real login as themselves in that iframe had previously stashed `paneltec_role_label="Admin"` in localStorage. That value survives the preview swap and beats every API-derived fallback in the `||` cascade → screen shows **"Admin"**.

## What shipped

### 1. `backend/auth.py::get_current_user` (synthetic preview user)
- New Mongo lookup by `preview_worker_id` (no-op when the JWT didn't bind a worker) → `name = "{first} {last} (preview)"`. Falls back to the old `"Preview · <role>"` placeholder only when the lookup returns nothing.
- New response field `role_label` — echoed straight from the JWT's `role_label` claim.
- `role_id` now prefers `preview_scope` when present so mobile Profile's `role_id ?? role` fallback cascade lands on `paneltec_civil` / `viatec_traffic` / `admin` / `external_contractor` instead of the collapsed `worker` string that `mobile_preview` writes for the two field-worker scopes.

### 2. `backend/mobile_preview.py::mint_preview_user` (JWT payload)
- JWT now carries `role_label`:
  - Scope path (preferred): `SCOPE_META[scope]["label"]` — e.g. `"Paneltec Civil"`, `"Viatec Traffic Solutions"`, `"Admin"`, `"External Contractor"`.
  - Role-id legacy path: `role_id.replace("_", " ").title()`.
- Nothing else touched — response body / synthetic_user / modules_override unchanged, so existing consumers stay backward-compatible.

### 3. `frontend/src/components/settings/MobileModulesSection.jsx` (web-host)
- `computeExpoUrl(...)` now appends `preview_role_label=<Label>` as a URL query param. SCOPE_LABELS map covers all four scopes; legacy role_id falls back to a Title-cased split.
- New `onLoad` handler on the iframe posts the same label via `postMessage({type: 'paneltec_preview_role_label', role_label, role_id}, '*')`. Cross-origin postMessage is legit; direct `contentWindow.localStorage` writes are not.
- Both hooks are **no-op-safe until the mobile splash script wires up a listener**. Once the mobile team adds the listener (see follow-up flag below), Profile mount will pick the correct label up ahead of `getStoredRoleLabel()` being called.

### 4. Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132in`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132in`
- `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132in`

## Pytest coverage — `tests/test_v58_13_132in_preview_role_label.py` — 6 checks
- **Source pins**:
  - `mobile_preview.py` writes `role_label` on the JWT for both scope + legacy paths.
  - `auth.py::get_current_user` looks up the worker + emits `preview_name + " (preview)"`, surfaces `role_label`, prefers `preview_scope` on `role_id`.
  - `MobileModulesSection.jsx` iframe URL carries `preview_role_label`; onLoad posts the label.
- **Version lockstep** (forward-safe regex).
- **Behavioural** — stubs the workers collection with a Matthew Wells row, calls `mint_preview_user(scope="paneltec_civil", worker_id="worker_test_id")` directly. Decodes the returned JWT and asserts `role_label == "Paneltec Civil"`. Runs the `get_current_user` synthetic-builder logic against the same payload + stubbed collection and asserts:
  - `synthetic["name"] == "Matthew Wells (preview)"`
  - `synthetic["role_id"] == "paneltec_civil"`
  - `synthetic["role_label"] == "Paneltec Civil"`

### Combined suite (.132ie → .132in): **73/73 green.**

## Ban compliance
- No `/app/mobile/` edits. All fixes on backend + web host.
- `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- No `testing_agent` / `e1_tester` / `finish`.

## Mobile-team follow-up (delegated)

**Bug**: `mobile/app/(tabs)/profile.tsx` line 49 lets stale `localStorage.paneltec_role_label` (leftover from an earlier real-session login on the Expo subdomain) beat the API's `res.data.role_id` in the `||` cascade. In preview mode this displays the admin's role instead of the scope being previewed.

**Recommended fix** for the Expo specialist:
1. In `mobile/src/services/auth.ts::getStoredRoleLabel`, prefer the preview-scoped claim when `isPreviewSession()` is true (either read a new sessionStorage key or add a `preview_role_label` reader). Same-origin sessionStorage reads inside the iframe are safe.
2. Have `mobile/app/index.tsx` (splash) also subscribe to the parent's `postMessage({type: 'paneltec_preview_role_label', ...})` and write the payload into `sessionStorage.paneltec_preview_role_label`. Once wired, the postMessage hook shipped in `.132in` becomes live end-to-end.
3. Alternatively, `mobile/app/index.tsx` splash could read the `preview_role_label` URL query param that `MobileModulesSection.jsx` now appends and stash it in sessionStorage before Profile mounts.

The web/backend side is fully ready — the mobile ship is a small listener + localStorage-priority reorder.

## Verification against live server (post-restart)
```
GET /api/health/version
  → {"cache_version":"paneltec-v160.3.9.58.13.132in"}
```
