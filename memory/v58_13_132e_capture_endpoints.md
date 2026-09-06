# M5 Capture Endpoints Discovery — v58.13.132e

## Architecture Summary

All 5 Capture modules use the **same generic CRUD router** (`crud.py::build_router()`):
- `GET    /api/{entity}` — list (with `?workspace_id=`, `?status=`, `?scope=me|team`, `?limit=`, `?date_from=`, `?date_to=`)
- `GET    /api/{entity}/{id}` — detail
- `POST   /api/{entity}` — create (returns 201)
- `PATCH  /api/{entity}/{id}` — partial update
- `DELETE /api/{entity}/{id}` — soft-delete

Auth: All endpoints require JWT + `require_permission(resource, "view"|"edit")`.
Module gating: Each router carries a `module_id` so mobile can be gate-checked via `require_module()`.

---

## 1. Hazards

| Endpoint | Method | Auth | Notes |
|----------|--------|------|-------|
| `/api/hazards` | GET | JWT + `hazards.view` | List, supports `?status=open` |
| `/api/hazards/{id}` | GET | JWT + `hazards.view` | Detail |
| `/api/hazards` | POST | JWT + `hazards.edit` | Create — body: `HazardIn` |
| `/api/hazards/{id}` | PATCH | JWT + `hazards.edit` | Partial update |
| `/api/hazards/{id}` | DELETE | JWT + `hazards.edit` | Soft delete |

**Pydantic model: `HazardIn`**
```
workspace_id: str (required)
title: str (required)
description: str = ""
photo_url: Optional[str]
location: Optional[str]
severity: "low"|"medium"|"high"|"critical" = "medium"
controls: List[str] = []
status: "open"|"in_progress"|"closed" = "open"
ai_analysis: Optional[dict]
reported_by: Optional[str]
gps_latitude/longitude/accuracy: Optional[float]
gps_street/suburb: Optional[str]
```

**AI Photo Analysis**: `POST /api/ai/hazard-vision`
- Multipart upload: `file` (image)
- Auth: JWT + `require_ai_use`
- Returns: `{identified_hazards: [], suggested_controls: [], severity: str, summary: str, photo_url: str}`
- Photo saved to `/uploads/hazards/` and served via `/api/files/hazards/{name}`
- Reuse for Incidents (same analysis endpoint — just tag differently)

**Collection**: `hazards` + mirrored from `form_submissions` where `template_category_snapshot in ["hazard", "near_miss"]`

---

## 2. Incidents

| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/incidents` | GET | JWT + `incidents.view` |
| `/api/incidents/{id}` | GET | JWT + `incidents.view` |
| `/api/incidents` | POST | JWT + `incidents.edit` |
| `/api/incidents/{id}` | PATCH | JWT + `incidents.edit` |
| `/api/incidents/{id}` | DELETE | JWT + `incidents.edit` |

**Pydantic model: `IncidentIn`**
```
workspace_id: str (required)
title: str (required)
occurred_at: str (ISO datetime, required)
location: Optional[str]
category: "near_miss"|"first_aid"|"medical"|"ltc"|"env"|"property" = "near_miss"
description: str = ""
immediate_actions: str = ""
evidence_photos: List[str] = []
follow_up_actions: List[dict] = []
follow_up_status: "open"|"in_progress"|"closed" = "open"
person_involved: Optional[str]
gps_latitude/longitude/accuracy: Optional[float]
gps_street/suburb: Optional[str]
```

**AI**: Reuse `POST /api/ai/hazard-vision` for evidence photo analysis
**Collection**: `incidents` + mirrored from `form_submissions` where `template_category_snapshot == "incident"`

---

## 3. Pre-Starts

| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/pre-starts` | GET | JWT + `pre_starts.view` |
| `/api/pre-starts/{id}` | GET | JWT + `pre_starts.view` |
| `/api/pre-starts` | POST | JWT + `pre_starts.edit` |
| `/api/pre-starts/{id}` | PATCH | JWT + `pre_starts.edit` |
| `/api/pre-starts/{id}` | DELETE | JWT + `pre_starts.edit` |

**Pydantic model: `PreStartIn`**
```
workspace_id: str (required)
date: str (YYYY-MM-DD, required)
crew_lead: str (required)
work_summary: str (required)
linked_swms_ids: List[str] = []
linked_permits: List[str] = []
hazards_discussed: str = ""
sign_ons: List[PreStartSignOn] = []
notes: Optional[str]
crew_worker_ids: List[str] = []
gps fields...
asset_id/label/rego/meter_reading: Optional
```

**Collection**: `pre_starts` + mirrored from `form_submissions` where `template_category_snapshot in ["pre_start", "plant_pre_start"]`

---

## 4. Site Diary

| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/site-diary` | GET | JWT + `site_diary.view` |
| `/api/site-diary/{id}` | GET | JWT + `site_diary.view` |
| `/api/site-diary` | POST | JWT + `site_diary.edit` |
| `/api/site-diary/{id}` | PATCH | JWT + `site_diary.edit` |
| `/api/site-diary/{id}` | DELETE | JWT + `site_diary.edit` |

**Pydantic model: `SiteDiaryIn`**
```
workspace_id: str (required)
date: str (YYYY-MM-DD, required)
raw_notes: str (required)
structured_log: Optional[dict]
```

**AI**: `POST /api/ai/diary-structure` exists — takes raw notes, returns structured log (from `ai.py`)
**Collection**: `site_diary_entries`

---

## 5. Inspections

| Endpoint | Method | Auth |
|----------|--------|------|
| `/api/inspections` | GET | JWT + `inspections.view` |
| `/api/inspections/{id}` | GET | JWT + `inspections.view` |
| `/api/inspections` | POST | JWT + `inspections.edit` |
| `/api/inspections/{id}` | PATCH | JWT + `inspections.edit` |
| `/api/inspections/{id}` | DELETE | JWT + `inspections.edit` |

**Pydantic model: `InspectionIn`**
```
workspace_id: str (required)
template_name: str (required)
date: str (YYYY-MM-DD, required)
checklist_items: List[{label, response: pass|fail|na, notes, photo_url}] = []
corrective_actions: List[dict] = []
notes: Optional[str]
operator: Optional[str]
operator_signature: Optional[str] (base64 PNG)
gps fields...
```

**Collection**: `inspections` + mirrored from `form_submissions` where `template_category_snapshot == "inspection"`

---

## Auth Status
All endpoints already support JWT auth. No expansion needed.

## Draft / Sync Mechanism
The CRUD `PATCH` endpoint + `status` field enables draft support:
1. `POST /api/{entity}` with `status: "draft"` → creates draft
2. `PATCH /api/{entity}/{id}` with `status: "submitted"` → submits
3. Offline: queue the POST/PATCH in `offline-queue.ts`, flush on reconnect

## Photo Upload
- Hazards/Incidents: `POST /api/ai/hazard-vision` (multipart, returns `photo_url`)
- Other modules: photos stored as `photo_url` field (URL string)
- File serving: `GET /api/files/hazards/{filename}` (auth required)
