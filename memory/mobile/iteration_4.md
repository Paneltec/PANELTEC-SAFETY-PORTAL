# Iteration 4 — Phase 8 Track 4: Vehicles Screen + Full Phase 8 Completion

## Summary
All 5 tracks of Phase 8 are now implemented and compiling clean.

## What was implemented this iteration

### Track 4: Vehicles Screen (NEW)
- **`(tabs)/vehicles.tsx`** — Full Vehicles screen matching web `Vehicles.jsx`:
  - Tag picker: horizontal scrollable chips from `GET /api/integrations/navixy/tags`, with color dots, selection state (filled vs outline), clear button
  - Fleet list: vehicle rows with brand-blue label, Live/Offline status indicator, primary tag chip with color, speed, plate, relative time, address, "Free" utilisation badge, MapPin button
  - Alternating row backgrounds (matching web: #EAF3FB / #F2F8FC)
  - Empty states: "Select tags" prompt when no tags selected, "No vehicles match" when tags produce 0 results
  - Navixy error card: "Connect Navixy to see your fleet" if API fails
  - Tag selection persisted in AsyncStorage
  - Pull-to-refresh on fleet data

- **`src/components/VehicleMapModal.tsx`** — Full-screen vehicle map modal:
  - Header: vehicle label + GPS Live/Offline status + Tracker ID
  - Body: Google Maps embed iframe (web) or `react-native-webview` WebView (native)
    - URL: `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed` — NO API key needed
  - Bottom strip: lat/lng coordinates + "Directions" link (opens Google Maps directions) + "Open in Navixy" link
  - "Position not currently available" fallback when no GPS coordinates

### Tab Layout Update
- Vehicles tab added to `(tabs)/_layout.tsx` with `can('vehicles', 'open')` permission gating

## Web-to-mobile mapping
| Web Component | Mobile Component | Match Level |
|--------------|-----------------|-------------|
| `Vehicles.jsx` tag sidebar | Horizontal scrollable tag chips | Adapted for mobile |
| `Vehicles.jsx` vehicle rows | Vertical list with same row layout | Full match |
| `VehicleMapModal.jsx` iframe | iframe (web) / WebView (native) | Full match |
| `VehicleMapModal.jsx` bottom strip | Bottom strip with Directions + Navixy links | Full match |

## Full Phase 8 Status
| Track | Status | Key Files |
|-------|--------|-----------|
| Track 1: Permissions | DONE | AuthContext.tsx, api.ts, _layout.tsx, capture.tsx, 6 index screens |
| Track 2: PDF | DONE | PdfActions.tsx → 6 detail screens |
| Track 3: Email | DONE | EmailButton.tsx, EmailSendSheet.tsx → 6 detail screens, outbox.tsx |
| Track 4: Vehicles | DONE | vehicles.tsx, VehicleMapModal.tsx |
| Track 5: Polish | DONE | login.tsx (disabled banner), api.ts (force-logout) |

## Known Issues
- CDN tunnel `expo-whs-compliance.preview.emergentagent.com` not resolving to app (DNS issue) — app works on localhost:3001
- Package version warnings for expo-file-system and expo-sharing (non-breaking)

## Dependencies
- No new dependencies added this iteration (react-native-webview already installed)

## API Endpoints Used
- `GET /api/integrations/navixy/tags` — tag list
- `GET /api/integrations/navixy/vehicles?tag_ids=...` — vehicle data
- Google Maps embed URL (no API key): `https://maps.google.com/maps?q=lat,lng&z=15&output=embed`
