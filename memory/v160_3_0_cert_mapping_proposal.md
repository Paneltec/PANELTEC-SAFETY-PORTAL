# v160.3.0 — Cert-to-Form Mapping Proposal

**Status: PROPOSAL ONLY — not applied. Review, edit, then run apply script.**

Total active templates: **30**  
Baseline rule: safety-critical categories (`pre_start`, `inspection`, `near_miss`, `incident`, `toolbox`) get `white_card` as a minimum when no other keyword hits.

## Proposed mapping

| Template | Category | Proposed slugs | Reason |
|----------|----------|----------------|--------|
| Asbestos Awareness / Class B Removal | `general` | _(none)_ | keyword |
| Confined Space Entry Permit | `general` | `confined_space` | keyword |
| Construction Heavy Equipment Pre-Operation Checklist | `pre_start` | `white_card` | category_baseline |
| Crane Lift / Rigging Plan | `general` | `dogging`, `basic_rigging` | keyword |
| Daily Plant Inspection | `pre_start` | `white_card` | category_baseline |
| Daily Scaffold Inspection | `inspection` | `white_card` | category_baseline |
| Daily Site Inspection | `inspection` | `white_card` | category_baseline |
| Drug & Alcohol Test Record | `admin` | _(none)_ | keyword |
| End of Day Site Sign-Off | `inspection` | `white_card` | category_baseline |
| Equipment Pre-Use Checklist | `pre_start` | `white_card` | category_baseline |
| Excavation / Trench Permit | `general` | _(none)_ | keyword |
| Heavy Vehicle Daily Check | `pre_start` | `white_card` | category_baseline |
| Hot Work Permit | `general` | _(none)_ | keyword |
| Incident Report | `incident` | `white_card` | category_baseline |
| Incident Report Form | `incident` | `white_card` | category_baseline |
| JSEA — Job Safety & Environmental Analysis | `general` | _(none)_ | keyword |
| Near Miss Report | `near_miss` | `white_card` | category_baseline |
| Plant Pre-Start Checklist (Heavy Equipment) | `pre_start` | `white_card` | category_baseline |
| SWMS Sign-On | `general` | _(none)_ | keyword |
| Site Induction Checklist | `toolbox` | `white_card` | keyword |
| Site Sign-In / Visitor Register | `general` | `white_card` | keyword |
| Test Hot Work Permit | `incident` | `white_card` | category_baseline |
| Toolbox Talk | `toolbox` | `white_card` | category_baseline |
| Toolbox Talk Attendance | `toolbox` | `white_card` | category_baseline |
| Vehicle Pre-Use Inspection | `pre_start` | `white_card` | category_baseline |
| Working at Heights Permit | `general` | `working_at_heights` | keyword |
| site-safety-checklist | `general` | _(none)_ | keyword |
| v160.3.0 gated 019ec084 | `general` | _(none)_ | keyword |
| v160.3.0 gated 563c2309 | `general` | _(none)_ | keyword |
| v160.3.0 gated b72c767a | `general` | _(none)_ | keyword |

## How to apply
1. Edit the list above (add / remove slugs per template).
2. Run:
```bash
curl -X PATCH "$API/api/forms/templates/{template_id}" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"required_certifications": ["slug1", "slug2"]}'
```
Or open the Web Admin → Forms → Edit template → "Qualification requirements".

## Canonical slug vocabulary
See `/app/backend/cert_kinds.py::KINDS` — 15 slugs currently.
Fetch runtime via `GET /api/forms/cert-kinds`.