# M4 Reconciliation Audit — v58.13.132d

## Summary
M3 (v58.13.132c) introduced mobile-only APIs (`/api/mobile/sites/*`) and a new `site_sign_ins` collection that **duplicates** functionality already present in the canonical web backend. This audit documents the overlap and prescribes a **REPOINT UI** strategy (no data migration — redirect mobile to existing endpoints).

---

## Three Endpoint Families

### 1. M3 Mobile-Only (`mobile_sites.py`) → `site_sign_ins` collection
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/mobile/sites` | GET | List sites for user, GPS sort, sign-in status |
| `/api/mobile/sites/{id}/sign-in` | POST | Worker sign-in |
| `/api/mobile/sites/{id}/sign-out` | POST | Worker sign-out |
| `/api/mobile/sites/{id}/visitor-sign-in` | POST | Visitor sign-in (authenticated, host check) |
| `/api/mobile/sites/{id}/visitor-sign-out` | POST | Visitor sign-out |
| `/api/mobile/sites/{id}/current-occupancy` | GET | Who's on site |
| `/api/mobile/gps/heartbeat` | POST | GPS breadcrumb trail |

### 2. Legacy Web — QR / Sign-On (`sites_qr.py` + `sites_signon_v127.py`) → `site_signons` collection
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sites` | GET | List all sites (admin) |
| `/api/scan/site/{token}` | GET | Public QR resolver |
| `/api/scan/site/{token}/sign-on` | POST | Authenticated worker sign-on |
| `/api/scan/site/{token}/sign-on-visitor` | POST | Public visitor sign-on |
| `/api/sites/{id}/signon-v127` | POST | Authenticated worker sign-on (GPS + answers) |
| `/api/sites/{id}/signoff` | POST | Sign off specific signon |
| `/api/me/signoff-active` | POST | Sign off caller's active signon |
| `/api/sites/{id}/active-signons` | GET | Admin — who's on site |
| `/api/sites/{id}/signon-log` | GET | Admin — time-range log |

### 3. Public Visitor (`visitor_signins.py`) → `site_visitors` collection
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/public/site/{token}/form` | GET | Visitor form info |
| `/api/public/visitor/site/{token}/signin` | POST | Public visitor sign-in (rate-limited) |
| `/api/public/visitor/{id}/sign-out` | POST | Public visitor sign-out |
| `/api/admin/visitors` | GET | Admin visitor list |

---

## Schema Diff: `site_sign_ins` vs `site_signons`

| Field | `site_sign_ins` (M3) | `site_signons` (Legacy) |
|-------|---------------------|------------------------|
| Primary key | `id` | `id` |
| User ref | `user_id` | `signed_by_user_id` + `worker_id` |
| Sign-in time | `signed_in_at` | `signed_at` |
| Sign-out time | `signed_out_at` | `signoff_at` |
| GPS format | `gps_in: {lat, lng}` | `gps_lat`, `gps_long` (flat) |
| GPS distance | N/A | `gps_distance_m`, `gps_warning` |
| GPS trail | `gps_trail: [...]` | N/A |
| Photo | `photo_data_uri` | N/A |
| Kind | `kind: "worker"/"visitor"` | `source: "qr"/"qr_v127"/"visitor"` |
| Answers | N/A | `answers: [{question_id, value}]` |
| SWMS ack | N/A | `swms_acknowledged: [...]` |

---

## Recommendation: **REPOINT UI** (Not Merge)

### Rationale
- `site_sign_ins` contains only M3 test/preview data — no production history
- The legacy `site_signons` schema is richer (GPS warnings, SWMS ack, answers, distance checks)
- Data migration would require complex field mapping for minimal value
- Simply redirecting mobile to existing endpoints achieves immediate architectural integrity

### Strategy
1. **Unregister** `mobile_sites.py` from `server.py` (keep file for reference)
2. **Fix** `mobile_home.py` to query `site_signons` (not `site_sign_ins`) for active sign-in status
3. **Rewrite** mobile `services/sites.ts` to call:
   - `GET /api/sites` for site list
   - `POST /api/sites/{id}/signon-v127` for worker sign-in
   - `POST /api/me/signoff-active` for worker sign-off
   - `POST /api/public/visitor/site/{token}/signin` for visitor sign-in
4. **Client-side** GPS distance calculation (existing `GET /api/sites` returns lat/lng)
5. **Drop** `site_sign_ins` collection (or leave empty — no cleanup needed)
6. **Update** Home module tiles to source from `mobile_modules_data.py` (19 modules, role-filtered)
7. **Delete** placeholder screens (`toolbox/index.tsx`, `my-fleet/index.tsx`)

### Risk Assessment
- **Low risk**: No production data in `site_sign_ins`
- **Low risk**: Existing web endpoints are battle-tested
- **Medium risk**: Visitor wizard field mapping (M3 captures `escort_required`, `host_user_id` — these map to `visiting_person` in `visitor_signins.py`)

---

## Applied: 2026-09-XX
- Unregistered `mobile_sites.py` from `server.py`
- Updated `mobile_home.py` sign-in check to use `site_signons`
- Rewrote mobile `sites.ts` service to use existing endpoints
- Updated mobile `sites.tsx` for new API shape
- Updated `mobile_home.py` with dynamic 19-module tile grid from `mobile_modules_data.py`
- Deleted `toolbox/index.tsx` and `my-fleet/index.tsx` placeholders
