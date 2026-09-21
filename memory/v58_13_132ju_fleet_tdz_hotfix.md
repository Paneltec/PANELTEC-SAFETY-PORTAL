# .132ju — Hotfix: Fleet TDZ Crash (openAssetId ordering)

## Commit
`13791201` — 2026-09-21

## EAS Build
`fa65ae01-b32c-4751-b5ec-4f7c54065109` (preview-apk, replaces cancelled `ec7e62ee`)

## Bug
`ReferenceError: Cannot access 'assets' before initialization` in `fleet.tsx` on v1.0.32 Metro preview.

## Root Cause
The `useEffect` for `openAssetId` (added in `.132jt`) was placed at line 113 — **above** the `const { data: assets } = useQuery(...)` declaration at line 125. JavaScript `const` is in the temporal dead zone from block start until the declaration line. The effect's closure captured `assets` before it was initialized.

### Before (broken)
```ts
// Line 113 — REFERENCES assets
useEffect(() => {
  if (openAssetId && assets && assets.length > 0) { ... }
}, [openAssetId, assets, router]);

// Line 125 — DECLARES assets
const { data: assets } = useQuery<FleetAsset[]>({ ... });
```

### After (fixed)
```ts
// Line 113 — DECLARES assets first
const { data: assets } = useQuery<FleetAsset[]>({ ... });

// Line 127 — REFERENCES assets (safe)
useEffect(() => {
  if (!openAssetId || !assets || assets.length === 0) return;
  const match = assets.find((a) => a.id === openAssetId);
  if (match) { setSelectedAsset(match); router.setParams({ openAssetId: '' }); }
}, [openAssetId, assets, router]);
```

## Fix
Moved the `openAssetId` effect below the `useQuery` declaration. Added early-return guard for clarity.

## Verification
- Metro restart: clean, no errors
- Fleet tab: renders 115 assets with no crash
- Screenshot verified
