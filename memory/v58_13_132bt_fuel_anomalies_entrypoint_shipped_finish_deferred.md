# v58.13.132bt — Fuel Anomalies entry point on Fuel Reports page

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132bt`.

## USER PAIN
Stephen kept navigating to `/app/fleet/fuel` looking for the Fuel Anomalies inbox link because Fuel Reports is the natural home for it. It was buried under `Fleet & Service Register → SmartFill → Anomaly Inbox` in the sidebar, three clicks deep.

## Shape chosen: **Option A — amber banner card** at the top of the page

**Reasoning:**
- Option B (tab strip) unavailable — Fuel Reports has no tab strip; the page structure is stacked cards (header → SmartFill Auto-sync card → filters → totals → leaderboards → per-fill table).
- Option C (sub-nav) unavailable — the page has no sidebar of its own.
- The amber alert banner slots naturally into the existing **card stack**. The page already uses amber for its `provisional pricing` warning ribbon, so the visual language is consistent — amber = attention, blue = intelligence, emerald = healthy.
- Placement: **directly below the H1/subtitle** and **directly above the SmartFill Auto-sync card**. That order matches the mental model of "check what needs attention → check what's syncing → then dive into the numbers".

## File changed
`frontend/src/pages/FuelReporting.jsx`:
- New state: `anomalyCount: number | null`.
- New callback `loadAnomalyCount()` — calls existing `GET /fleet/fuel/anomalies?resolved=false&count_only=true` (endpoint added in `.131c`, reused verbatim — **no new backend surface**).
- `useEffect` fires the fetch on mount and on `window.focus` so returning to the tab refreshes the count.
- New JSX: a `<Link to="/app/fleet/fuel/anomalies">` styled `bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between`. Left slot: `AlertTriangle` icon + eyebrow "SmartFill · Anomaly Inbox" + `N fuel anomalies flagged` + one-liner subtext. Right slot: `Review anomalies →` amber-600 CTA button (matching the `.132bp` filled-button treatment).
- Banner is **hidden when the count is a concrete 0** (nothing to review); **rendered when count > 0 or `null`** (endpoint unreachable — still let admins navigate manually).
- New testids: `fuel-reporting-anomalies-banner`, `fuel-reporting-anomalies-cta`.

## Backend
**No new endpoints.** The `count_only=true` path on `/fleet/fuel/anomalies` (from `.131c`) already returns `{"count": N}` in ~20ms. Effective refresh cadence in the UI: on-mount + on window focus, no polling.

## Pytest
`backend/tests/test_v58_13_132bt_fuel_anomalies_entrypoint.py` — 7 checks:
1. `count_only` endpoint returns `{"count": int}` (contract lock).
2. Banner testid + amber-50 border + amber-600 CTA present.
3. Link points at `/app/fleet/fuel/anomalies`.
4. Uses `count_only: true` + registers a focus listener.
5. Banner hidden when count === 0 (`anomalyCount !== 0` guard present).
6. Banner sits above the SmartFill Auto-sync card in source order.
7. Version bump forward-safe.

```
============================== 7 passed in <1s ================================
```

## Screenshot
`/app/memory/v58_13_132bt_01_banner_top.jpeg` — amber banner reads:
> ⚠️ SMARTFILL · ANOMALY INBOX
> **1,374 fuel anomalies flagged**
> Resolve, dismiss or manually attribute flagged fills.
> `[Review anomalies →]` (amber-600 button, right-aligned)

Positioned directly under the H1 "Fuel reports", directly above the SmartFill Auto-sync ENABLED card.

Live console:
```
.132bt banner present: True
```

## NOT changed
- No new backend endpoint — `count_only` reused verbatim.
- No sidebar changes — the top-level nav entry stays where it was; this ship just adds discovery at the Fuel Reports scope.
- No `/app/mobile/` code touched.
