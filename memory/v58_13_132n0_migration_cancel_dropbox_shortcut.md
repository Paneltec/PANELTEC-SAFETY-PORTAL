# v58.13.132n0 — Cancel Dropbox→NAS migration + sidebar Dropbox launcher

## Two-part ship

### Part 1 — Cancel the Dropbox→NAS migration (safe cancel)

User chose **a + c + f**: cancel the active run, don't delete anything, revert any NAS-primary reads.

**Actions taken**

1. **138 dropbox_migration_run docs cancelled** in one atomic `update_many`. Previous states: 3 × `running`, 135 × `interrupted`. All now `state="cancelled"`, `cancel_reason="user_abandoned_migration_v132n0"`, `cancelled_at=<iso>`. Historical records preserved — nothing deleted.
2. **Watchdog kill-switch flipped**: `db.migration_watchdog_settings` now `{key: "watchdog", enabled: false, disabled_at: "2026-09-25T22:22:36...", disabled_by: "user_v132n0"}`.
3. **APScheduler boot registration guarded**: `server.py` now reads `_watchdog_enabled()` before calling `scheduler.add_job(watchdog_tick, ...)`. When the flag is False the log emits `APScheduler job SKIPPED — dropbox_migration_watchdog (migration_watchdog_settings.enabled=False)` instead of `registered`. Belt-and-braces with the internal `if not await _watchdog_enabled(): return {...skipped}` guard already present at `integrations_dropbox.py:921`.
4. **No files deleted from NAS.** Dropbox originals untouched. Dropbox OAuth left connected.
5. **NAS-vs-Dropbox read audit — no revert needed.** Grepped every `nas_client.*` call in `/app/backend/`. All 8 usages are WRITE-side only (`fetch_and_put`, `stat`, `delete_file`, `ping`) — invoked by `dropbox_bytes_copy.py`, `dropbox_file_enum.py`, `document_library_shares.py:430` (bulk share cleanup), and `integrations_nas.py:181` (health probe). Document downloads (`document_library.py:1356`, `file_pdf.py:145/156`) read from **GridFS** and local disk; **Dropbox stays the source of truth**. Nothing to revert.
6. **APScheduler in-process eviction**: the backend was restarted at the end of this ship. Startup log confirms `APScheduler job SKIPPED — dropbox_migration_watchdog` (no more 5-min ticks). No manual `scheduler.remove_job()` call was needed because the process was recycled.

### Part 2 — Dropbox sidebar shortcut (Navixy Live Board pattern)

**Live Board / Navixy pattern reference** (verbatim from `frontend/src/pages/FleetRegister.jsx`):

```jsx
// L938
const NAVIXY_LIVE_BOARD_URL = 'https://track.gpstrackeraustralia.com/#/user-app/5719';
// L1269-1277 — fallback branch (when framing is refused)
<a
  href={NAVIXY_LIVE_BOARD_URL}
  target="_blank"
  rel="noopener noreferrer"
  data-testid="fleet-live-board-open-tab"
  className="inline-flex items-center gap-1.5 ..."
>
  Open in new tab ↗
</a>
```

Key characteristics of the pattern: **hardcoded URL constant**, `target="_blank"`, `rel="noopener noreferrer"`, no SSO handoff (vendor shows its own login), no window-features string. Dropbox mirror follows the same three anchor attributes.

**Where the Dropbox entry sits**

Registered in `settingsNavRegistry.js` as key `dropbox_launcher`, label `"Dropbox"`, at the tail of the Settings sub-nav (immediately after `phone_preview` from `.132mz`). Rationale:
- Sits in the same sub-nav as `integrations` — the other place admins go to interact with third-party services.
- The `SETTINGS_NAV_REGISTRY` layout picker will surface any newly added key in each org's saved layout on next fetch (proven by the `.132mz` shipping to Stephen's saved layout automatically without intervention).
- If the user prefers a different placement (top-level under Compliance, or its own section) — call it out in the follow-up and I'll relocate.

**External URL**

`https://www.dropbox.com/home/Paneltec-General%20Administration`

Derived from `backend/.env → DROPBOX_TEAM_FOLDER_NAME="Paneltec-General Administration"` (URL-encoded space). If the team folder ever renames, the URL is a one-line edit in `settingsNavRegistry.js`.

**Rendering mechanism**

Added a new branch to `SortableItem` (`components/settings/SettingsNav.jsx`): when the registry entry carries an `externalUrl` field, it renders an `<a href={externalUrl} target="_blank" rel="noopener noreferrer">` with a tiny `Open16Regular` glyph next to the label instead of the internal `<NavLink to={route}>`. The rest of the sidebar UX (drag handle, hover state, badges) is preserved. `route` on external entries points to `/app/settings/integrations` so any code path that coerces the entry into a router link still lands somewhere sensible.

**Permission gating**

`requiresCan: ['integrations', 'view']` — mirrors the existing `Integrations` sidebar entry. Admin has it via `_all(True)`. Non-admin roles: none of the four seeded roles (`paneltec_civil`, `viatec_traffic`, `external_contractor`, plus the 6 legacy `custom_*` roles) grant it, so the entry is admin-only in practice.

**Icon choice**: `Cloud24Regular / Cloud24Filled` (Fluent UI). No Dropbox-branded icon exists in the icon set; `Cloud` is the closest generic representation.

## Files touched

### Backend
| File | Change |
|---|---|
| `backend/server.py` | Guard `scheduler.add_job(watchdog_tick, ...)` on `_watchdog_enabled()`. |
| `backend/settings_nav_registry.py` | New key `dropbox_launcher` (server-side layout-validator whitelist). |

### Frontend
| File | Change |
|---|---|
| `frontend/src/components/settings/SettingsNav.jsx` | New `externalUrl` branch in `SortableItem` renders `<a target="_blank">` in place of `<NavLink>`. Added `Open16Regular` import. |
| `frontend/src/lib/settingsNavRegistry.js` | New `dropbox_launcher` entry with `externalUrl` + `Cloud24Regular/Filled` icon + `requiresCan: ['integrations', 'view']`. Cloud icons added to the fluent-icons import list. |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `.132n0`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `.132n0`. |

### Docs
| File | Change |
|---|---|
| `memory/v58_13_132n0_migration_cancel_dropbox_shortcut.md` **(new)** | This memo. |

## Verification

- `curl /api/health/version` → `paneltec-v160.3.9.58.13.132n0`
- Mongo: `dropbox_migration_run` — 0 docs in `{state: {$in: [running, queued, paused, interrupted, dry-run-running]}}`.
- Mongo: `migration_watchdog_settings` — `enabled=false`, `disabled_by="user_v132n0"`.
- Supervisor log post-restart contains: `APScheduler job SKIPPED — dropbox_migration_watchdog (migration_watchdog_settings.enabled=False)` and does NOT contain `APScheduler job registered — dropbox_migration_watchdog`.
- Sidebar (admin, Stephen): `Dropbox` entry present under Settings sub-nav with `Open16Regular` glyph.
- Sidebar (worker, no `integrations.view`): entry hidden.
- Clicking the entry pops `https://www.dropbox.com/home/Paneltec-General%20Administration` in a new tab.
- Document Library file download still returns 200 + bytes (Dropbox is source of truth).

## Screenshots

Captured via screenshot tool (rendered inline; the tool sandbox does NOT persist to `/app/test_reports/`):

- Sidebar with new "Dropbox" entry (admin view, Settings section scrolled into frame).
- New tab landing on Dropbox web (visible auth wall since the headless browser has no session — expected).

## Kept in place (deliberate)

- Historical `dropbox_migration_run` docs kept — audit trail preserved.
- Dropbox OAuth stays connected. `/api/dropbox/health` still reports `ok`.
- Watchdog code paths kept intact — only the boot registration + the `enabled` flag was flipped. Re-enabling the migration in the future is a single Mongo write.
- APScheduler `dropbox_migration_watchdog` job is *not registered*; the internal `watchdog_tick` function short-circuits on `_watchdog_enabled()` so a stale registration (from a future admin toggling the flag on then off in the same boot) still no-ops.
