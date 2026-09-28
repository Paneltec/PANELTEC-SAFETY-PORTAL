# Ship `.132p3d` — Leave Requests web polish

## Change 1: Pending badge on nav
- **Location**: Sidebar nav item "Leave Requests" under Compliance section
- **Data source**: Reuses existing `/api/leave/summary` endpoint (`pending` field)
- **Poll cadence**: Refetched on route change (`location.pathname`) + every 60 seconds via `setInterval`
- **Visual**: Red pill badge with count, matching existing certifications badge pattern
- **Badge key**: `leavePending` (extends existing `badges` dict alongside `certExpiry`)
- **Title tooltip**: "N leave request(s) awaiting decision"
- No new backend endpoint needed — `GET /api/leave/summary` already returns `{ pending: N }`
- Badge hides when count is 0

## Change 2: Fix drawer/modal top clipping
- **Root cause**: Drawer used `fixed inset-0 h-full` which started at viewport top (y=0), but the AppShell topbar is `h-16 sticky top-0 z-30`. The drawer content was hidden behind the topbar.
- **Fix (Drawer)**: Replaced `h-full` with `mt-16` (64px = topbar height) and `max-height: calc(100vh - 4rem)` so it starts below the topbar and never exceeds viewport.
- **Fix (Modal)**: Added `pt-20` on overlay and `max-height: calc(100vh - 8rem)` + `overflow-y-auto` on inner content so modal is centered with safe clearance and scrolls internally.
- Tested on 1920px desktop and 1024px laptop viewports — title bar, status pill, and all controls fully visible.

## Files touched
| File | Change |
|------|--------|
| `frontend/src/components/layout/AppShell.jsx` | Added `leaveBadge` state, `/leave/summary` polling effect, `badgeKey: 'leavePending'` on nav item, `leavePending` in badges dict (2 places), made badge title generic |
| `frontend/src/pages/LeaveRequests.jsx` | Fixed Drawer positioning (`mt-16` + max-height), fixed Modal positioning (`pt-20` + max-height + overflow) |
| `frontend/src/lib/version.js` | Bumped to v58.13.132p3d |
| `frontend/public/service-worker.js` | Bumped CACHE_VERSION |

## No backend changes needed
The existing `/api/leave/summary` endpoint already returns `{ pending: N }`.
