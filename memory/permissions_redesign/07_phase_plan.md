# Phase Plan — Users & Permissions Redesign

*(Existing content preserved below the v160.3.9.30 addendum)*

## v160.3.9.30 addendum — Phase 6 backlog

**Phase 6 (post-Phase-4 cleanup) — Refactor `effective_for()` to merge
`ROLE_DEFAULTS` with `roles.permission_tokens[]` from the DB.**

Currently `effective_for()` in `permissions.py:270` only consults the
in-code `ROLE_DEFAULTS` dict. New system roles seeded into the
`roles` collection via `roles_catalogue.py` (contractor_rep,
contractor_rep_submit_only, hseq_manager, mechanic, etc.) require
duplicate `ROLE_DEFAULTS` entries or they receive zero permissions
at auth-time. This duplication is fragile — the drift test in
`test_contractor_rep_scoping_v160_3_9_30.py` exists to catch it.

The clean fix (was Blocker-F-ii during Phase 3d) is to make
`effective_for()`:
1. Read `roles.permission_tokens[]` for `user.role_id` from the DB.
2. Union with any `ROLE_DEFAULTS[user.role]` entry (for backward-compat
   with legacy role strings).
3. Overlay user-specific `user_permissions.overrides`.

Deferred until Phase 5 completion (legacy `role` string retirement)
because Phase 5 removes half the problem: once every user has a
`role_id` and no legacy `role` string, `effective_for()` can rely
solely on `roles.permission_tokens[]`.

**Owner:** whoever picks up Phase 6.
**Estimated scope:** ~30 LOC change in `permissions.py`, 5 LOC change
in `auth.py`, delete of the duplicate `ROLE_DEFAULTS` entries for the
newer system roles (contractor_rep, contractor_rep_submit_only,
hseq_manager, etc. — keep admin + hseq_lead + supervisor as legacy
role-string catches).

---

## Original phase plan (v160.3.9.26 discovery)

Phases 1–4 executed under v160.3.9.26 → v160.3.9.30. See individual
close-out notes in the same directory (`08_phase3b_notes.md`,
`09_frontend_gate_sweep.md`).

### Deferred items from v160.3.9.26 planning

1. Doc 03 — how to handle `hr.Report Emailing` and
   `asset.Report Emailing` on resources with `email_supported=False`.
2. Doc 06 — Simpro-email matches a `workers` row but no `users` row.
3. Simpro sync stays manual — no cron.
