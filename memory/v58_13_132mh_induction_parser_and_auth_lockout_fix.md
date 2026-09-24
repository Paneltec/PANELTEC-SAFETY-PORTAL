# v58.13.132mh — Auth lockout hardening + expiry parser month-name form

**Ship date:** 2026-09-23 · **Author:** e1 · **Commit:** `<sha filled at finish>`

Two-part backend ship, no frontend changes.

## Part A — Auth lockout time-window decay + forensic trail

Fixed in `backend/auth_lockout.py` (full rewrite of the file — 61 → 165 lines).

- Sliding 30-min window (`LOCKOUT_WINDOW_MIN`). New `last_failed_login_at` field: if last fail >30 min ago, counter resets to 1 instead of `previous+1`.
- New `login_attempts` collection. Fields: `email`, `user_id`, `ip`, `user_agent`, `timestamp`, `reason` (`bad-password` | `locked` | `unknown-email` | `activation-pending`). TTL 90 days.
- Two indexes created on module load via `ensure_login_attempts_index()`: TTL on `timestamp`, compound `email + timestamp desc` for support queries.
- `record_login_attempt` signature extended with `ip`, `user_agent`, `reason` kwargs. Backwards-compatible (all keyword-only, defaults None).
- Lockout WARNING log now includes IP + UA (first 80 chars).
- `auth.py:login` populates IP from `X-Forwarded-For` header (first hop, comma-split) with fallback to `request.client.host`, plus UA header, and threads to all three `record_login_attempt` call sites.

Backfill: no schema migration — new field appears on next fail.

## Part B — Expiry parser: `Exp <MonthName> <Year>` form

Fixed in `backend/filename_expiry.py`.

New `_MONTHNAME_RE`:
```
Exp[\s_\-]+(Jan|Feb|Mar|...|Dec)[\s_\-]+(20\d{2})
```
Case-insensitive. Matches both short (`Nov`) and long (`November`) month names. Sets `day=1` for the parsed date.

`_STRIP_JUNK_RE` extended so the matched clause + flanking separators are removed from `display_name`.

Ordered fallback in `parse_filename_expiry`: dotted → compact → monthname.

**Backfill result (post-ship):**
- Newly parsed: 6 (TasWater Induction rows)
- Still unparseable: 16 (16 of original 22, minus the 6 rescued)
- Total parsed in `doc_files`: 115 / 391 (was 109 pre-ship)

**Remaining 16 unparseable breakdown:**
- 7 licence-ticket rows use `EXP DD MM YYYY` space-separated (e.g. `CPR - MLinford - EXP 21 11 2026`) — new pattern family, deferred pending user decision on parser extension vs source correction.
- 5 WHS-procedure docs (`WHS-28a_…_Exposure_V10.0.docx`) — false positives from the regex query. The substring `Exp` in `Exposure` triggered inclusion. Not real expiry files.
- 4 data-entry typos (`EXPO0228`, `EXP12207`, `_4Exp31.78.25` (month=78), `_3Exp019.11.23` (day=019)) — should be corrected at source, not parsed around.

Full list persisted at:
- `/app/memory/v58_13_132mg_unparseable_expiry_original22.json` (original 22 + rescue status)
- `/app/memory/v58_13_132mg_unparseable_expiry.json` (current 16)

## Files touched

- `backend/auth_lockout.py` — full rewrite
- `backend/auth.py` — IP/UA capture + threaded to `record_login_attempt` (3 call sites)
- `backend/filename_expiry.py` — new regex + parser + strip regex extended
- `backend/server.py` — startup call to `ensure_login_attempts_index()`
- `frontend/src/lib/version.js` — version + changelog
- `frontend/public/service-worker.js` — CACHE_VERSION lockstep
- `scripts/backfill_expiry_reparse.py` — new — targeted re-parse of rows where `expires_at IS NULL`
- `scripts/list_unparseable_expiry.py` — moved from `/tmp` in a prior turn; unchanged here
- `memory/v58_13_132mg_unparseable_expiry_original22.json` — snapshot of the original 22
- `memory/v58_13_132mh_induction_parser_and_auth_lockout_fix.md` — this file

## Not shipped

- `EXP DD MM YYYY` space-separated parser — 7 licence rows would benefit; deferred pending user decision.
- Mobile parity — handoff brief drafted in the ship report, not yet delegated.
- No frontend changes.

## Post-ship verification plan (executed inline)

1. Parser unit tests: 6/6 pass (3 pre-existing dotted/compact + 3 new monthname).
2. Backfill re-parse: 6 rescued, 16 remaining (see above).
3. Auth lockout curl smoke: fail 6 logins → 5th triggers 423, `last_failed_login_at` written, `login_attempts` rows present with IP + UA.
4. Migration recovery: `copy-2919b63f4fcf` was in-flight at ship time. Post-restart, sweep hook marks it interrupted; resume endpoint fires new run.
