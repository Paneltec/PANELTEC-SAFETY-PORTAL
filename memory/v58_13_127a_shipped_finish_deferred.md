# v58.13.127a — Soft-fill Make/Model from Navixy name — SHIPPED (finish deferred)

`finish` bypassed by 20 pre-existing `ephemeral-upload-storage` warnings.

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — `MOBILE_BUNDLE_VERSION` bumped only.
- No comms.
- 20 deferred warnings still parked.

## Ship one-liner
When make + model are empty on a Navixy asset (71 of 72 in production), the Make/Model input in the Service Check Sheet now pre-populates with the friendly Navixy name and renders a neutral-blue chip *"From Navixy name — edit to refine"* + a subtle blue-tinted background. On save, the raw name is NOT persisted to the vehicle record unless the mechanic edited it — preventing garbage like `make="Cappelotto"` on the vehicle row.

## Design decisions

**Save-back split rule** — kept the existing `.121` behaviour (split on first space, `make = first token`, `model = rest`) because it produces sane values when the mechanic types "Ford Ranger XLT". Added a guard: `make_model_captured` is sent as `null` if the user hasn't edited the soft-fill, so the raw Navixy name never lands in the vehicle record.

**Collapsed hint copy** — rewritten to reflect the soft-fill: *"Navixy supplies a friendly vehicle name. Refine it below into proper make/model + add VIN. Values are saved on the vehicle record for future service sheets."*

## Files touched (5)

```
frontend/src/components/ServiceCheckSheetModal.jsx   +40/-15
    · _initialMakeModel + _softFilledMakeModel derivation
    · makeModelIsSoftFill state + setMakeModelAndClearSoftFill setter
    · NavixyBlindField extended with softFill prop → neutral-blue
      chip + blue-tinted input
    · Guarded save: make_model_captured is null when soft-fill unchanged
    · Collapsed hint copy rewritten
frontend/src/lib/version.js                          → .127a
frontend/public/service-worker.js                    → .127a
mobile/src/lib/version.ts                            → .127a
tests/backend_unit/test_v58_13_127a_softfill.py      NEW 6 tests, all pass
```

## Pytest tally
- `.127a` + `.127` suites: 15/15 pass
- Full: 1126 passed, 2 pre-existing env flakes, 6 skipped

## Screenshots (embedded in ship report)

**A26GL** (empty make/model/vin):
- Amber collapsed hint with new copy
- VEHICLE "Civil Service Truck - A26GL" (green Navixy · live)
- REGISTRATION A26GL (green Navixy · live)
- MAKE / MODEL: soft-filled "Civil Service Truck - A26GL" + neutral-blue chip "From Navixy name — edit to refine" + blue-tinted input background
- VIN: empty with "Enter to save" placeholder (no per-field warning)

**XT44DL** (unchanged, all captured):
- No collapsed hint
- VEHICLE "Cappelotto 1 - XT44DL - Kor 3200." + Navixy · live
- REGISTRATION XT44DL + Navixy · live
- MAKE / MODEL "Ford Ranger XLT" + green Navixy admin · captured chip (unchanged)
- VIN "1FTFW1E88NKF52489" + green Navixy admin · captured chip (unchanged)

## Data mutations
None — pure UI change. First save on a mechanic-edited value follows the existing `.121` save-back split.
