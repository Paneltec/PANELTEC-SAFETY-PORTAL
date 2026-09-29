# .132p44 — Bigger ACCEPT button + seed fresh test job

## Style changes
`jd.acceptBtn`: borderRadius 14→32, paddingVertical 20→22, added paddingHorizontal 32, minHeight 60→64, added alignSelf 'stretch'. Green shadow kept from .132p43.
`jd.acceptBtnText`: fontSize 15→20, fontWeight 800→700.

## Seeded test job
- ID: `6afd3799-ae92-4df5-990f-f055fcc37e36`
- Site: Connector Park Drive
- Address: 45 Connector Park Drive, Rosehill NSW 2142
- Staff: Stephen Guy
- Truck: ISUZU FVZ260 - T042
- Customer: Lendlease Civil
- Status: issued (pending accept)
- DB: test_database.daily_job_assignments

## Files touched
- `mobile/app/(tabs)/home.tsx` — acceptBtn + acceptBtnText styles
- `mobile/app.json` — v1.0.72 / versionCode 194
- `mobile/src/lib/version.ts` — .132p44
- `frontend/src/lib/version.js` — .132p44
- `frontend/public/service-worker.js` — .132p44
