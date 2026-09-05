# v58.13.123 + .123a — Heavy Truck template + punch-list — SHIPPED (finish deferred)

`finish` tool bypassed by the 20 pre-existing
`ephemeral-upload-storage` warnings; parked for v58.14.x.

Retro-filed as part of the `.124` audit sweep — no code touched
by this memo. The two live ships were:

## `.123` — Heavy Truck PM template
- 77 items across 11 sections, tri-state X/✓/NA marks
- Dynamic tyre-tread grid (Out/In per axle position, 32nds precision)
- Watermark-free PDF renderer honours the tri-state marks + tread
  readings + consumables + next-inspection date

## `.123a` — Punch-list on top of `.123`
- Technician picker narrowed to tech-only roles + widened source
  to include `workers` collection (contractors)
- Custom checklist items add/delete per section (frontend state
  only, serialised into POST payload with `custom:true`)
- Customer signature pad replaced with an attach-docs-or-photos
  dropzone (image/*, application/pdf, multi)
- Rego label gains Navixy · live / Manual chip
- Template picker relabelled "Choose a vehicle type to service"
- Tech mode toggle relabelled "Type new"
- Tyre tread section made collapsible (bug fix; was always-open
  regardless of section state)

## Root cause: Navixy not populating on some forms
Not a code bug — 148 of 220 org assets have no
`navixy_device_id`, and Navixy's `vehicle_info` payload only
carries make/model/VIN when the fleet operator entered it in
Navixy admin. Modal now shows the state via chips.

## Test locks
- `tests/backend_unit/test_service_sheet_punchlist_v58_13_123a.py` — 11 tests, all pass

## Follow-up shipped in `.124`
- `.121` stale testid (`sheet-cust-signature`) — hotfixed on the
  same ship as `.124`.
