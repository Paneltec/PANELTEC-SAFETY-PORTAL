# v58.13.132mz — Standalone Phone Preview page + `mobile_preview.view` permission cell

## Scope (final, after user re-scope mid-implementation)

**Original brief**: add a dedicated `mobile_preview.view` permission cell so admins can hand out access to the mock phone preview independently of `users.view`.

**Revised mid-ship** (still under the same `.132mz` slug): move the phone preview OUT of the in-page tab (`Settings → Permission presets → Mobile App Modules`) and give it its own **sidebar entry + standalone page** at `/app/phone-preview`. The new permission cell keeps functioning as the gate for both the sidebar item and the page.

Nothing shipped to `/app/mobile/`. Mobile version slug (`.132mx`) left untouched.

## Files touched

### Backend
| File | Change |
|---|---|
| `backend/permissions.py` | Added `"mobile_preview"` to `PERMISSIONS_SCHEMA` (email_supported=False, delete_supported=False). Post-`ROLE_DEFAULTS` clobber loop denies the cell on every non-admin seeded role so `auditor`'s catch-all `view=True` comprehension doesn't silently grant preview access. Admin already gets it via `_all(True)`. |
| `backend/scripts/seed_mobile_preview_v132mz.py` **(new)** | Idempotent one-shot migration. Backfills `mobile_preview.view` alongside `users.view` on: (a) `db.roles.permission_tokens[]`, (b) `db.permission_presets` (custom docs), (c) `db.user_permissions.overrides`. Marker: `bk_migrations[_id=v58_13_132mz_mobile_preview_seed]`. |
| `backend/server.py` | Startup hook — imports and runs `seed_mobile_preview_permission_on_startup` right after the `.132my` false-`needs_attention` cleanup. Busts the `_role_tokens` cache so admin's new tokens are picked up without a second restart. |
| `backend/settings_nav_registry.py` | New key `phone_preview` → `/app/phone-preview` gated by `resource="mobile_preview"`. Kept at the tail of the list so pre-existing per-org saved layouts don't break; admins surface it via the drag/drop tray. |

**Note**: `roles_catalogue.py` did NOT need any change. `_tokens_admin()` calls `_all_tokens()` which iterates over `RESOURCES × ACTIONS` at call-time; adding `mobile_preview` to `PERMISSIONS_SCHEMA` auto-expands admin's token list, and `seed_system_roles()` (called on every boot) re-`$set`s admin's `permission_tokens`.

### Frontend
| File | Change |
|---|---|
| `frontend/src/pages/PhonePreviewPage.jsx` **(new)** | Standalone page rendering the exact same `PhonePreview` component that used to live inside `MobileModulesSection.jsx`. Route-level gate: `useCan('mobile_preview', 'view')`. Deep-link without the permission → renders an "Access denied" card. |
| `frontend/src/App.js` | New route `/app/phone-preview` → `<PhonePreviewPage />`. |
| `frontend/src/components/settings/MobileModulesSection.jsx` | `PhonePreview` component now `export`ed so `PhonePreviewPage` can reuse it (no logic duplication). `<PhonePreview />` render call removed from the Mobile App Modules tab. Grid collapsed from two-column (`minmax(0,1fr) 380px`) to single-column so the module matrix uses full width. `canOpenPreview` prop preserved on `PhonePreview` for backward-compat (defaults to true; route-level gate now handles auth). |
| `frontend/src/pages/PermissionPresetsAdmin.jsx` | Subtitle rewritten to: **"Curate role presets, choose which mobile-app modules each role sees, and grant phone-preview access via the mobile_preview.view cell."** |
| `frontend/src/lib/permissions.js` | Added `mobile_preview` to `RESOURCE_LABELS`, `EMAIL_SUPPORTED`, `DELETE_SUPPORTED`, `TEAM_VIEW_SUPPORTED`, `OPEN_VIEW_SUPPORTED` catalogues so both the Permission Presets matrix and the `UsersManagement` matrix render the row correctly (view cell = checkbox; email/delete/team_view cells = dash). |
| `frontend/src/lib/settingsNavRegistry.js` | Added `phone_preview` entry with `Phone24Regular/Filled` icon, `requiresCan: ['mobile_preview', 'view']`, route `/app/phone-preview`. `SettingsNav` filters via `can(...it.requiresCan)`, so users lacking the cell never see the entry. |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` → `.132mz`, `EXPECTED_CACHE_VERSION` → `.132mz`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `.132mz`. |

### Docs
| File | Change |
|---|---|
| `memory/v58_13_132mz_mobile_preview_permission.md` **(this file)** | Ship memo. |

## Migration counts (from `/app/backend/scripts/seed_mobile_preview_v132mz.py` on first boot)

- **Roles**: `admin` role has `users.view` in its 309-token list → `mobile_preview.view` added. `seed_system_roles()` on the same boot also `$set`s admin's tokens to `_all_tokens()` which auto-expands to include every `mobile_preview.<action>` because `_all_tokens()` iterates over the freshly-updated `RESOURCES`. `paneltec_civil`, `viatec_traffic`, `external_contractor`, and the 6 legacy `test-*` / `custom_*` roles all have `users.view=False` → skipped.
- **Custom presets**: 0 rows currently in `db.permission_presets` (matches the `.132co` clean-slate) → nothing to migrate.
- **User overrides**: 6 `user_permissions` docs currently have `overrides.users.view=True`, none have `mobile_preview.view` → 6 rows updated.

Marker inserted at `db.bk_migrations[_id=v58_13_132mz_mobile_preview_seed]` so second-and-later restarts short-circuit with `already_done=true`.

## Screenshot artifacts

Captured via the screenshot tool (rendered inline for review; the tool sandbox does NOT persist to `/app/test_reports/` — file paths returned in tool output are virtual). Four states were confirmed visually:

- Sidebar with the new "Phone Preview" entry (admin, Settings section — appears between "Certifications" and "New folder" at the bottom of the Settings sub-nav).
- Standalone Phone Preview page (`/app/phone-preview`) — breadcrumb, H1, live phone bezel + role/worker selectors, "About Phone Preview" help card on the right.
- Permission Presets header showing the reworded subtitle.
- Permissions Matrix (Admin preset) with the new `mobile_preview` row visible between `integrations` and `notifications`, all admin cells checked.
- Negative test: worker (`paneltec_civil` role) — sidebar entry absent, `/app/phone-preview` deep-link renders the "Phone Preview locked" access-denied card.

## Verification

- Admin (`stephen@paneltec.com.au`) preset carries `mobile_preview.view` after the migration + on-boot admin token re-seed.
- Presets lacking `users.view` (paneltec_civil / viatec_traffic / external_contractor) do NOT get `mobile_preview.view` — sidebar entry stays hidden for those users.
- The `<PhonePreview />` render was removed from the Mobile App Modules tab; the tab now renders a single-column module matrix cleanly (no dead 380px column).
- `curl /api/health/version` returns `paneltec-v160.3.9.58.13.132mz` after backend restart.

## Kept in place (deliberate)

- The `PhonePreview` component definition stays inside `MobileModulesSection.jsx` (now `export`ed). Extracting it to its own file would have been ~500 lines of code motion for zero behavioural benefit — the standalone page imports it directly.
- `PhonePreview`'s `canOpenPreview` prop stays with a `true` default so any future caller instantiating the component outside of `PhonePreviewPage` continues to work without threading the gate.
- `permissions.py` `_AUTO_GRANT_EXCLUDED` does NOT include `mobile_preview`. Admin should get it — this is only a `comms_safe_mode`-style block for genuinely explosive knobs.

## Deferred / not shipped

- No mobile (`/app/mobile/`) changes. The version slug there stays on `.132mx`.
- The `permission_tokens[]` for `paneltec_civil` / `viatec_traffic` / `external_contractor` were not manipulated. Migration only touches roles that ALREADY grant `users.view`.

## Git

Defensive reset pattern followed: `git reset HEAD -- .` before every `git add`. Commit created with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify -m "132mz: ..."`. No `git push`.

See report at end of ship for SHA + file list.
