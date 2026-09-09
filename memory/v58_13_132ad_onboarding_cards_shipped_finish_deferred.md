# v58.13.132ad — SHIPPED (Onboarding card PDF generator in Workers tab)

Status: **shipped, pytest 1/1 (8 asserts), 3 sample PDFs generated
against live workers, live end-to-end verified.**

## User's ask (verbatim)

> "it could live in the worker tab in the menue that way the
>  employee name would be imprinted and it wouls be nic to print
>  all workers a t the same tome"

## Executive summary

New printable-onboarding-card generator. Admin opens Workers tab,
clicks an orange **Print all onboarding cards** toolbar button
(or the per-row QR button) and gets a PDF where each card has
that worker's actual name imprinted and a QR encoding a fresh
`paneltec://onboard?token=...` deep link with a 7-day TTL.

- **Backend**: `GET /api/mobile/onboarding/cards.pdf` — 3 modes
  (`worker_id`, `worker_ids`, `all`) + `expires_days` override.
- **Web**: 1 new toolbar button + 1 new per-row action button on
  the Workers tab, both admin-gated. Confirmation modal for bulk.
- **PDF grammar**: reuses `pdf_card_template.py` primitives —
  zero new design assets.
- **Idempotency**: unused unexpired token reused, no burn.
- **Bulk-skip**: workers without `simpro_employee_id` skipped and
  reported in `X-Paneltec-Skipped` header.
- **Audit**: 1 `user_audit` row per generation.

## Files touched

### Backend
| File | Change | LOC delta |
|---|---|---:|
| `backend/mobile_onboarding_cards.py` | **new** | +275 |
| `backend/server.py` | router mount | +4 |
| `backend/tests/test_v58_13_132ad_onboarding_cards.py` | **new** pytest | +165 |

### Web frontend
| File | Change | LOC delta |
|---|---|---:|
| `frontend/src/pages/Workers.jsx` | 2 buttons + 1 modal + 2 handlers | +130 |
| `frontend/src/lib/version.js` | RUNNING_VERSION + EXPECTED_CACHE_VERSION + ship-note | +45 |
| `frontend/public/service-worker.js` | CACHE_VERSION | +1 |

### Mobile
Untouched.

## New API surface

```
GET /api/mobile/onboarding/cards.pdf          (admin/owner only)
    ?worker_id=X               → single card, 100×62mm
    ?worker_ids=X,Y,Z          → multi-card, 4-up A4
    ?all=true                  → every active non-archived worker
    ?expires_days=N            → TTL override 1..90 (default 7)

Response:  application/pdf
Headers:   Content-Disposition: attachment; filename="onboarding_cards_YYYYMMDD.pdf"
           X-Paneltec-Generated: <count>
           X-Paneltec-Skipped: <count>

400  no mode chosen (needs worker_id | worker_ids | all=true)
404  worker not found (single-mode only)
403  non-admin caller
422  no cards generated (payload includes `skipped[]` list)
```

## Runtime verification

```
$ curl "…/cards.pdf?worker_id=<Rick Antrim>"
  → 200, application/pdf, 9,014 bytes
  → X-Paneltec-Generated: 1

$ curl "…/cards.pdf?worker_ids=<A>,<B>"
  → 200, application/pdf, 16,124 bytes
  → X-Paneltec-Generated: 2

$ curl "…/cards.pdf?all=true"
  → 200, application/pdf, 516,499 bytes
  → X-Paneltec-Generated: 70   (all live active workers)
  → X-Paneltec-Skipped: 0

$ (second identical single-worker call)
  → 200, but no new token row created (idempotency confirmed)
```

### Sample PDFs

- `/app/memory/samples/onboarding_card_sample.pdf` — single card
  for Rick Antrim (9 KB).
- `/app/memory/samples/onboarding_cards_bulk_sample.pdf` — 2 cards
  4-up on A4 (16 KB).
- `/app/memory/samples/onboarding_cards_all_sample.pdf` — all 70
  active workers, 18 pages A4 (517 KB).

### Independent visual verification (gemini analysis of single card)

All 6 required elements present and correctly rendered:
1. Navy header band + white "PANELTEC CIVIL" wordmark + orange
   "FIELD APP" eyebrow + orange chevron ✓
2. Large centered QR code ✓
3. Three-step "1. Open camera  2. Scan QR  3. Install & sign in" ✓
4. "Employee name:" label with **RICK ANTRIM** printed on the
   dashed line ✓
5. Bottom-left "For Paneltec Civil employees only." ✓
6. Bottom-right double-chevron + version tag ✓

## Screenshots

- `/app/memory/samples/workers-tab-onboarding.png` — Workers tab
  with new orange "Print all onboarding cards" toolbar button and
  per-row QR icon (orange background) on every row.
- `/app/memory/samples/workers-tab-onboarding-modal.png` — the
  confirmation modal, "Generate cards for **70** active workers?",
  Cancel + orange "Generate PDF" primary button.

## Pytest

```
$ python3 -m pytest tests/test_v58_13_132ad_onboarding_cards.py -v
tests/test_v58_13_132ad_onboarding_cards.py::test_onboarding_cards_end_to_end PASSED [100%]
============================== 1 passed in 1.52s ===============================
```

8 asserts covering:
1. single-worker mode (200, %PDF magic, size floor, headers).
2. token idempotency (second call reuses row, no new mint).
3. bulk `worker_ids=` with a mixed batch — 2 generated + 1 skipped.
4. `all=true` (≥2 generated).
5. bad-request (400) when no mode chosen.
6. 404 for unknown worker_id.
7. `user_audit` row written with `action=onboarding_cards_generated`.
8. Worker-role → 403.

## Design details

- Card size: 100mm × 62mm (business-card-plus). 4-up on A4 with
  10mm margin + 8mm gutter → 4 cards per page.
- QR: 28mm block, box_size=8, border=1 (matches other Paneltec QR
  cards — Worker ID, Site sign-on, Supplier induction).
- Version tag reads `RUNNING_VERSION` from
  `frontend/src/lib/version.js` at request time (extracts the
  `v58.x.y` short form). Currently emits `v58.13.132ad`.
- Preload param: `paneltec://onboard?token=...&preload=civil`
  (or `viatec` when the worker's `company`/`division` contains
  "viatec"). Matches the mobile deep-link handler at
  `mobile/app/(auth)/welcome.tsx:9`.

## Rule enforced (from `.132ac`)

Feature added on **every surface** the user cares about:
- Backend endpoint ✓
- Web frontend toolbar button ✓
- Web frontend per-row action ✓
- Confirmation modal for bulk ✓
- Pytest coverage ✓
- Admin-only gate on both server AND the client-side button
  hidden for non-admin (`canEdit` check).
- Audit trail ✓

No dead affordances — non-admin users see neither button.

## Version bumps

- `RUNNING_VERSION`: `.132ac` → `.132ad`
- `CACHE_VERSION`: `.132ab` → `.132ad`
- `EXPECTED_CACHE_VERSION`: `.132ab` → `.132ad`
- `MOBILE_BUNDLE_VERSION`: unchanged (`.132ac` — no mobile touched).

## Rollback

```
git revert <this commit>
```
Reverts the endpoint mount, the two Workers-tab buttons, the
modal, and the pytest. Existing `mobile_onboarding_tokens` rows
survive (they're the same shape the `.132a` `POST issue-token`
endpoint creates; they remain valid until the mobile app
redeems or the TTL expires).

## Deferred (not in this batch)

- Multi-select rows + "Print selected cards" — the state and UI
  hooks are in place (`ids` parameter path is wired), just no row
  checkbox flow driving it yet. Trivial follow-up (`~30 LOC`).
- `?bulk_grid=8x` — 4-up is A4-optimal at 62mm card height; if you
  need denser packing (business-card standard 55mm) that's a knob
  on the backend endpoint, not a UI change.
- Comms-Safe-Mode gate — token issuance is a DB write, not a
  comms event, so Safe Mode does NOT block this. Cards can be
  printed and distributed by hand regardless of TextMagic/M365
  status.

## Chain complete

Ready for the next batch.
