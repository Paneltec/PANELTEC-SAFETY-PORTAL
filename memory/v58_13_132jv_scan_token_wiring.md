# .132jv — Wire QR Scanner + Asset Detail to /api/scan/{token} Endpoints

## Commit
`472e3a12` — 2026-09-21

## EAS Build
`362b2214-4127-41fe-a80c-1199b035bd6a` (preview-apk, v1.0.33 build 155)
Cancelled: `fa65ae01` (v1.0.32, had .132ju only)

---

## Path A — QR scanner scan-token lookup (qr-scan.tsx)

### Diff (10 lines)
```diff
 async function lookupInFleet(identifier: string): Promise<FleetAsset | null> {
+  // .132jv — First try the public scan-token resolver.
+  try {
+    const scanRes = await authGet<FleetAsset>(`/api/assets/scan/${encodeURIComponent(identifier)}`);
+    if (scanRes.ok && scanRes.data && scanRes.data.id) return scanRes.data;
+  } catch {
+    // 404 = not a scan token, fall through to fleet register lookup
+  }
+
   // Existing: fleet register fallback for rego/id/name plain scans
   const res = await authGet('/api/fleet/register?limit=500&page=1');
```

Also updated `extractIdentifier()` to recognise `/scan/{token}` path segments in full URLs.

---

## Path B — Asset Detail curated forms (fleet.tsx AssetDetailSheet)

### Diff (15 lines, simplified)
```diff
 function AssetDetailSheet({ asset, onClose, router }) {
+  const scanToken = asset.scan_token;
+
+  // Fetch curated forms via scan token
+  const { data: curatedRes, isLoading: curatedLoading } = useQuery({
+    queryKey: ['scan-forms', scanToken],
+    queryFn: () => authGet(`/api/scan/${scanToken}/forms`),
+    enabled: !!scanToken,
+  });
+
+  const curatedForms = curatedRes?.forms || [];
+  const hasCuratedForms = curatedForms.length > 0;

   // Render: if hasCuratedForms → curated tiles; else → fallback ASSET_ACTIONS tiles
+  // Each curated tile: category-coloured LH stripe + icon + name + description
+  // Recommended badge: orange pill top-right when form.recommended === true
+  // Empty-assignments banner: "No forms mapped to this asset type yet. Ask admin."
```

### Recommended badge rendering
Orange `#FFF7ED` background pill with `#F17222` bold text, positioned right of the label column inside the tile row.

### Empty-assignments fallback
When `/api/scan/{token}/forms` returns empty `forms[]`:
1. Show info banner: "No forms mapped to this asset type yet. Ask admin to configure." (blue info accent)
2. Still render all ASSET_ACTIONS fallback tiles so workers aren't blocked

---

## Files Touched
| File | Change |
|------|--------|
| `app/(screens)/qr-scan.tsx` | Added scan-token first-pass in `lookupInFleet`, `/scan/{token}` URL parsing |
| `app/(tabs)/fleet.tsx` | AssetDetailSheet: curated forms query, recommended badge, empty-fallback banner, new styles |
| `app.json` | Version 1.0.33, build 155 |
| `src/lib/version.ts` | Bundle version `.132jv` |

## Nothing unexpected found
- `qr-scan.tsx` was clean from `.132jt` rewrite — no stale code
- `authGet` import already present in both files
- All 115 assets confirmed to have `scan_token` (per previous investigation)
