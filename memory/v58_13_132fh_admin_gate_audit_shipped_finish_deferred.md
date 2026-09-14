# v58.13.132fh — Section H admin-gate audit (documentation-only)

**Status:** SHIPPED. Version-bump-only commit. Finish tool intentionally NOT called.
**Ship type:** Documentation / audit finding. Zero code changes to production paths.
**Scope:** Web only. `/app/mobile/` untouched.

Per Stephen's Section H directive ("remove or downgrade any per-user gate on worker / documents / inductions endpoints that goes beyond 'user is authenticated admin'"), I audited the backend and web frontend for per-user gates. **No load-bearing per-admin gates exist to downgrade.**

---

## Executive summary

The codebase already matches Stephen's clarified mental model (Section B of the `.132fg` brief): every authenticated web user is treated as an admin, all admins see every worker / induction / document fully. The audit turned up:

- Zero `workers:read:own` / `scope:own` permission strings anywhere in the backend.
- Zero `role != "admin"` gates on worker / documents / inductions endpoints.
- Zero `assigned_admin_id` fields or per-admin filters on `db.workers`, `db.worker_certifications`, `db.document_library_files`, or `db.workers_inductions`.
- `_can_read_own` (in `workers_inductions.py`) returns `True` for every role in `_CARD_WRITE = {"admin", "manager", "hseq_lead"}` — every web user hits the True branch on the first line of the function; the "own worker record via email match" branch below is exclusively for mobile-worker-role callers.
- `_serialise` (in `workers.py`) treats every `role in {"admin", "hr_lead", "hseq_lead"}` as `privileged=True`, so `simpro_sync_snapshot.pii` is never stripped from an admin's response.
- `scope=me` on `email_outbox` and `scope=me|team` on `crud.py` are opt-in query params, not gates — a caller must explicitly pass `?scope=me` to narrow the response. Default is full org visibility.

---

## Files audited

```
backend/workers.py                     grep -n "role.*!=.*admin\|user_id.*==\|_can_read"
backend/worker_certifications.py       (same greps)
backend/workers_inductions.py          (same greps)
backend/document_library.py            (same greps)
backend/documents.py                   (same greps)
backend/renewals.py                    (same greps)
backend/forms.py                       (same greps)
```

Zero matches for per-admin filtering. All findings documented above.

---

## Non-load-bearing checks (KEPT — flagged for awareness)

Two check patterns exist that are semantically per-user but are **not** gates on admin-vs-admin visibility:

1. **`_serialise` PII strip** at `workers.py:82-87`:
   ```python
   privileged = viewer_role in {"admin", "hr_lead", "hseq_lead"}
   own_row = bool(viewer_id and (doc.get("user_id") == viewer_id ... ))
   if not (privileged or own_row):
       snap_view = {k: v for k, v in snap.items() if k != "pii"}
   ```
   Every web user is admin → `privileged=True` → PII strip never fires for web callers. This branch protects the mobile worker-role path only. Correct as-is.

2. **`_can_read_own`** at `workers_inductions.py:1125`:
   ```python
   def _can_read_own(user, worker):
       if user.get("role") in _CARD_WRITE:  # admin / manager / hseq_lead
           return True                       # every web user hits this branch
       if user.get("role") != "worker":
           return False
       # ... mobile worker email-match logic
   ```
   Every web user hits the first-line True branch. Correct as-is.

Neither check is a gate between two admins.

---

## Tile-approvals ACL (INTENTIONALLY untouched)

Per Stephen's Section B: "Per-tile approvals (`allowed_user_ids` / `access_mode`) still exists but is only about restricting sensitive tiles (Bank / Xero / WoJo) between admins."

This surface (`backend/org_url_tiles.py`) explicitly gates viewer visibility on the tile's `access_mode` and `allowed_user_ids`. This is the one place where per-user visibility is INTENTIONAL and it stays in place. `.132ez` / `.132ff` shipped the correct semantics; `.132fg` picker flatten removed the noise "Admins" grouping in the editor UI but the per-user ACL data model is preserved.

---

## Files changed (this commit)

```
frontend/src/lib/version.js         +1 −1 (RUNNING_VERSION + EXPECTED_CACHE_VERSION)
frontend/public/service-worker.js   +1 −1 (CACHE_VERSION)
memory/v58_13_132fh_...md           NEW (this ship memo)
```

**Zero production-path code changed.** This is a version-bump-only ship, documented as the deliverable for Section H.

---

## Pytest evidence

No new tests written — nothing to lock. All existing `.132f*` suites still pass:

```
$ cd backend && python -m pytest \
    tests/test_v58_13_132fc_tile_editor_clarity.py \
    tests/test_v58_13_132fe_hotfix_approvals.py \
    tests/test_v58_13_132ff_eligible_users_and_access_mode.py \
    tests/test_v58_13_132fg_regressions_and_picker_flatten.py -q
.....................................                                    [100%]
37 passed in 5.78s
```

---

## Version bumps

- `frontend/src/lib/version.js`: `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fh`
- `frontend/public/service-worker.js`: `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fh`

---

## Next ships (queued)

The remaining `.132fg`-brief sections split into their own ships:

- **`.132fi`** — Section **D** (Private & Confidential + Licences worker profile sections). Backend GridFS collections + endpoints + frontend collapsible sections. Estimated 2 hours + Playwright evidence.
- **`.132fj`** — Section **E** (delete audit across ~10 document surfaces — worker HR docs, Document Library, Insurance policies, SWMS, Site QR PDFs, Fleet service register, Incidents, Risk assessments, Form submissions, Program schematics).
- **`.132fk`** — Section **F** (Paneltec Group logo brand sweep — EPS → SVG/PNG/favicon; header + sidebar + login + PDF + email swaps).

Each will get its own session with full curl + Playwright evidence in the ship memo, per Stephen's non-negotiable pattern.

---

## Honest gaps

I did not write a Playwright script for `.132fh` because there was no interactive control changed. The audit is code-inspection + grep-driven. If Stephen wants a live-browser smoke that "any admin can open any worker" as a regression guard, that would be a fresh Playwright script in `.132fi` alongside the D work.
