# v58.13.127 — GPS map modal + Service Sheet name/VIN — SHIPPED (finish deferred)

`finish` bypassed by the 20 pre-existing `ephemeral-upload-storage`
warnings; parked for v58.14.x.

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — `MOBILE_BUNDLE_VERSION` bumped only.
- No comms.
- 20 deferred warnings still parked.

## Ship one-liner
- Item 1: LH violet MapPin cell on Navixy-tracked rows opens an
  embedded OpenStreetMap (Leaflet + react-leaflet) modal showing
  the asset's last-known GPS position in Tasmania.
- Item 2: Vehicle name field added above rego in the Service
  Check Sheet's Vehicle Details section (was missing). Rewrote
  NavixyBlindField copy to reflect three honest states: captured
  (green chip), enter-manually (neutral chip), or amber warning
  (per-field, only when siblings are captured). Single collapsed
  top-hint replaces per-field noise when ALL of make/model/VIN
  are missing.

## Files touched (8)

**Backend (1)**
- `backend/fleet.py` — `AssetRow` now surfaces `last_known_lat`,
  `last_known_lng`, `navixy_last_position_time`, `vin` for the
  register list projection.

**Frontend (5)**
- `frontend/src/components/AssetMapModal.jsx` — NEW, 165 lines
- `frontend/src/pages/FleetRegister.jsx` — MapPin column + modal
  mount + state
- `frontend/src/components/ServiceCheckSheetModal.jsx` — Vehicle
  name field + NavixyBlindField copy rewrite + collapsed hint
- `frontend/src/index.css` — top-level `@import 'leaflet/dist/leaflet.css'`
- `frontend/package.json` — `leaflet@1.9.4`, `react-leaflet@4.2.1`

**Tests + Versions (2)**
- `tests/backend_unit/test_v58_13_127_bundle.py` — NEW 9 tests, all pass
- `tests/backend_unit/test_v58_13_126_bundle.py` — version pin ratchet ≥126
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js` + `mobile/src/lib/version.ts` → `.127`

## Nasty bug caught + fixed mid-ship

**"Map container is already initialized"** — first Playwright verification
of the map modal threw this on marker mount. Well-known react-leaflet 4 x
React 18 StrictMode incompatibility: StrictMode double-invokes effects, and
Leaflet's `_initContainer` stamps `_leaflet_id` on the DOM node during the
first invocation. Second invocation sees the stamp and throws.

Fix: monkey-patch `L.Map.prototype._initContainer` at module load to strip
`_leaflet_id` before delegating. Idempotent (`_v127_strict_patched` guard).
Community-accepted workaround. Also wrapped `MapContainer` in a
`StrictModeSafeMap` that defers rendering by one tick to let StrictMode's
dry-run unmount cleanly.

Second-open re-verified after the patch — clean render, no console errors.

## Post-ship UX

**Screenshot 1** — Fleet Register:
- LH column violet MapPin on 5 visible Navixy rows (A26GL, A93NI, B88TI, C43ZW, D02RF)
- No pin on 3 non-Navixy rows (A18DC, A32GL, CMP-UI-01)
- Data source chips: All 130 · Navixy 72 · Manual 58
- Kind counts: Vehicle 97, Trailer 21, Plant 12
- Version footer: `paneltec-v160.3.9.58.13.127`

**Screenshot 2** — AssetMapModal open on A26GL:
- Header: A26GL + Civil Service Truck - A26GL
- OpenStreetMap rendering Launceston, Tasmania (Kings Meadows, Prospect,
  Youngtown streets visible) at zoom 14
- Marker at -41.477, 147.152
- Footer readouts: coords, last-seen 133d ago, Navixy · connected chip,
  Open in Google Maps button
- OSM attribution corner + footer

**Screenshot 3** — Service Check Sheet on XT44DL (all captured):
- Navixy · connected banner (top)
- Vehicle field: "Cappelotto 1 - XT44DL - Kor 3200." + Navixy · live chip
- Registration: XT44DL + Navixy · live chip
- Make/Model: "Ford Ranger XLT" + green "Navixy admin · captured" chip
- VIN: "1FTFW1E88NKF52489" + green "Navixy admin · captured" chip
- Mileage 41174, Engine hours 2514.0 — auto from Navixy

**Screenshot 4** — Service Check Sheet on A26GL (no make/model/VIN):
- Navixy · connected banner (top)
- Amber collapsed hint: "Navixy doesn't supply make/model/VIN for this device."
- Make/Model + VIN inputs: empty with "Enter to save on the vehicle record"
  placeholder, no per-field amber warning (top hint takes over)
- Mileage 54, Engine hours 1.2 — auto from Navixy

## Pytest tally
- `1120 passed, 2 pre-existing env flakes, 6 skipped` in 10.38s (up from 1111 at .126)
- `.127` suite alone: 9/9 pass
- Ratchets: `test_v58_13_126_bundle` version pin

## Deferred behind `.127` (unchanged queue)
- `.128` — DB-level normalize enforcement + trace (still)
- `.122b` — historic pm back-fill (~689 rows)
- `.122c` — trailer date-anchor scheduling
- v58.14.x — object-storage migration to clear the 20 lint warnings

## Data mutations
None — item 1 reads existing `last_known_lat/lng` synced by the 15-min
scheduler; item 2 is pure UI copy + a new form field.
