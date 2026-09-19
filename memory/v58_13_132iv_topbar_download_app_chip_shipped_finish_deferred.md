# v58.13.132iv — Top-bar "Download app" chip · SHIPPED (finish deferred)

**Ship phase:** `.132iv`
**Scope:** User couldn't find the APK download button after `.132iu` because it sat three levels deep (Settings → Permissions & Roles → Mobile App Modules tab). This ship surfaces a one-click access point in the top bar.

## What shipped

`components/layout/AppShell.jsx::TopBar` — new admin-only chip inserted right after `<OutboxBell />` (data-testid `topbar-download-app`). Uses the existing `DropdownMenu` primitives so no new dependencies.

Chip:
- Style: black pill with `Smartphone` lucide icon + "Download app" + chevron.
- Visibility: `user?.role === 'admin'` only. Non-admins don't see it.
- Hidden below `sm` breakpoint to keep mobile top bar uncluttered.

Popover content:
- Header: "PANELTEC CIVIL · MOBILE APP" + one-line description.
- **Download Android APK** — big black button linking to `/api/mobile/downloads/android/latest.apk` (`download` attribute forces save-as, no navigation).
- **iOS install · Coming soon** — grey disabled button with tooltip "iOS TestFlight setup pending".
- Sideload help text.
- Separator + **Manage mobile modules →** link to `/app/settings/permission-presets` for admins who want the full matrix.

## Version pin (lockstep)

- `RUNNING_VERSION`        → `paneltec-v160.3.9.58.13.132iv`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132iv`
- `CACHE_VERSION` (SW)     → `paneltec-v160.3.9.58.13.132iv`

## Ban compliance

- No `/app/mobile/` edits.
- No pytest / Playwright per standing rule; single-file frontend change with existing icon + primitive.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Follow-up

The APK button inside `MobileModulesSection` (from `.132iu`) is kept as-is — it's redundant for admins now but still useful when they're already deep in the modules matrix and want a one-click grab without navigating away.
