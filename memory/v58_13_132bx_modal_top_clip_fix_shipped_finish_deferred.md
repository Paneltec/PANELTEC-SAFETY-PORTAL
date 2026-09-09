# v58.13.132bx — Modal top-clip fix

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132bx`.

## USER PAIN
Stephen: the Fuel Transaction Detail popup's top edge visually crowds/collides with the app header row (notification bell, mail icon, `ADMIN` pill, avatar). Same issue on the SmartFill Card drawer.

## Root-cause
The sticky app topbar in `components/layout/AppShell.jsx` is `h-16` (64px) with `sticky top-0 z-30`.

- `FuelTransactionDetailModal.jsx` used a symmetric `py-8` (32px top padding) on the outer overlay wrapper — that placed the modal card only 32px from the viewport top, half-covered by the 64px header row.
- `SmartFillCardDrawer.jsx` used `h-full` on the side panel with no top offset — the drawer's own header sat at `top: 0`, directly under the app header's bell/mail/avatar icons.

The other modals (`ManualMatchModal`, `BulkAttributeModal`, `CardChooserDialog`) use `items-center` and float mid-viewport; they never clip and needed no change.

## Files changed
| File | Line change |
|---|---|
| `frontend/src/components/FuelTransactionDetailModal.jsx` | Outer wrapper padding: `py-8` → `pt-20 pb-8` (80px top / 32px bottom). Modal card now starts 16px below the 64px sticky topbar. |
| `frontend/src/components/fleet/SmartFillCardDrawer.jsx` | Panel wrapper: `h-full bg-white shadow-2xl` → `h-[calc(100vh-4rem)] mt-16 bg-white shadow-2xl`. Panel starts 64px below viewport top and takes the remaining height so its own header sits directly below the app topbar. |
| `frontend/src/lib/version.js` + SW | Version bump. |
| `backend/tests/test_v58_13_132bx_modal_top_clip.py` | **NEW** — 3 source-pin tests. |

## Not changed (deliberately)
- `ManualMatchModal` and `BulkAttributeModal` in `FuelAnomalyInbox.jsx` — both use `fixed inset-0 z-[75] flex items-center justify-center` (viewport-centered), so they always float mid-height. No clip.
- `CardChooserDialog` (nested inside FuelReporting) — same `items-center` layout. No clip.
- The `z-40` on the drawer, and `z-50` on the txn detail modal — z-order was already above the topbar's `z-30`, so the visual overlap wasn't a stacking bug; it was a spatial-margin bug. Left the z-values as-is.

## Pytest
```
============================== 3 passed in 0.03s ==============================
```

## Screenshots (live, verified)

- `/app/memory/v58_13_132bx_01_detail_modal_below_topbar.jpeg` — Fuel Transaction Detail modal for txn `J45AL · 29/06/2026 · 14:03` sitting cleanly below the topbar. Clear breathing room between the app header and the modal's `FUEL TRANSACTION DETAIL` eyebrow / close X.
- `/app/memory/v58_13_132bx_02_card_drawer_below_topbar.jpeg` — SmartFill Card Drawer for `Card 21314 · XT02AX` starts flush below the topbar (bell/mail/ADMIN/avatar row visible above; drawer header + close X below).

Console verification:
```
txn detail modal open: True
  modal outer class: fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 pt-20 pb-8 overflow-y-auto
smartfill card drawer open: True
  drawer panel class: w-full max-w-3xl h-[calc(100vh-4rem)] mt-16 bg-white shadow-2xl flex flex-col
```

## Backlog carried forward
- Same fix pattern is available if any future modal introduces the pattern (`items-start` with `py-*`, or `h-full` without `mt-*`) — worth codifying as a shared `useTopbarAwareModal` hook in a future ship if the count grows past 5.
- `FuelAnomalyBanner.jsx` file is now orphaned (removed from FleetRegister in `.132bw`) — a future cleanup ship can delete the file entirely.
