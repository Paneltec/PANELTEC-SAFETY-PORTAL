# v58.13.114 — Ask Intelligence scope fix (finish deferred)

**Status:** SHIPPED. `finish` tool blocked by the same 20 pre-existing `ephemeral-upload-storage` warnings (deferred to v58.14.x per user directive).

## Files touched
| Path | Change |
|---|---|
| `backend/ask.py` | Expanded `_evidence()` from 5 → 12 collections, query-aware. New helpers: `_query_tokens`, `_looks_name_shaped`, `_regex_or`, `_can_see_audit`, `_can_see_comms`, `_compute_confidence`, `_build_name_fallback_body`, `ensure_indexes`. Rewrote `POST /ask` to apply the confidence matrix + fallback body. `GET /briefing` passes `question=""` to preserve recency behaviour. |
| `backend/server.py` | Wired `ask_ensure_indexes` into `on_startup` next to the other module index setups. |
| `frontend/src/lib/version.js` | Full v58.13.114 changelog block prepended. `RUNNING_VERSION` → `.114`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `.114`. |
| `mobile/src/lib/version.ts` | `MOBILE_BUNDLE_VERSION` → `.114`. |
| `tests/backend_unit/test_ask_intelligence_scope_v58_13_114.py` | NEW — 31 checks. |

## Pytest count
**31 new checks** in one file. Full suite: **861 passed, 1 skipped, 0 failures** (up from 830 after `.113`).

## Confidence matrix (enforced backend-side)
| hits | entity types | Claude self-grade | Final |
|---:|---:|---|---|
| 0 | 0 | any | **low** ★ |
| 1–2 | 1 | any | low |
| 1–2 | ≥2 | high / medium | medium |
| 1–2 | ≥2 | low | low |
| ≥3 | 1 | high | **medium** ★ |
| ≥3 | 1 | low | low |
| ≥3 | ≥2 | high | high |
| ≥3 | ≥2 | medium | medium |
| ≥3 | ≥2 | low | low |

★ = the two rows that fix the reported bug (previously passed through Claude's `high` as-is).

## Live curl trace (verified against `https://whs-compliance.preview.emergentagent.com/api/ask`)

**Query 1** — `{"question": "stephen"}`:
```
confidence : medium
fallback   : name_summary
cited      : 5 items (types = user, site_visitor, form_submission)
body       : 'stephen' matches 4 users, 3 workers, 8 site visitor records,
             35 authored records. Most recent:
             - Site visitor sign-in: Stephen Guy visiting —, 2026-09-04 09:17
             - Site visitor sign-in: RL Test 7 visiting Stephen, 2026-09-04 04:17
             - Site visitor sign-in: RL Test 5 visiting Stephen, 2026-09-04 04:17
             Narrow further? Try 'incidents authored by stephen' or
             'stephen's site visits last 30 days'.
```

**Query 2** — `{"question": "nonexistentxyz9999"}`:
```
confidence : low        # ← was HIGH pre-fix (bug case)
fallback   : None
cited      : 0 items
```

**Query 3** — `{"question": "recent incidents this quarter"}`:
```
confidence : low        # ← was HIGH pre-fix (bug case)
fallback   : None
cited      : 0 items
```

## Screenshot
`/app/memory/v58_13_114_ask_stephen_fixed.png` — Ask Intelligence page under `stephen@paneltec.com.au`. "Recent Questions" panel shows a perfect **before/after** in the same view:

- **10:42 (pre-fix)** — "stephen" — "The evidence bundle contains no incidents, hazards, or inspections, and none of the SWMS or contractor records reference 'stephen' in their titles or identifiers…"
- **10:55 (post-fix)** — "stephen" — "'stephen' matches 4 users, 3 workers, 8 site visitor records, 35 authored records. Most recent: - Site visitor sign-in: Stephen Guy visiting —, 2026-09-04 09:17 - Site visitor sign-in: RL Test 7 visiting Stephen, 2026-09-04 04:17…"

Version footer live: `paneltec-v160.3.9.58.13.114`.

## Index findings + additions
`form_submissions` at 16,253 rows had **no index** on `submitted_by`, `submitted_by_name`, or `template_name_snapshot`. Regex scans against this collection would have been full-collection reads — flagged and fixed via new `ensure_indexes()` in `ask.py`, wired into `server.on_startup`:

- `form_submissions.submitted_by`
- `form_submissions.submitted_by_name`
- `form_submissions.template_name_snapshot`
- `pre_starts.created_by`
- `site_diary_entries.created_by`
- `site_visitors.name`, `site_visitors.visiting_person`
- `workers.first_name`, `workers.last_name`
- `audit_log.actor_user_id`

`users.email` was already indexed (pre-existing).

## Refinements applied (from the user's green-light message)
1. **Fallback template softened** — now includes a top-3 recent-activity list right after the counts (verified in curl trace above). Format: `Most recent:\n- Site visitor sign-in: ...\n- Form submission: ...\n- User profile: ...\n\nNarrow further? Try '...' or '...'`
2. **`form_submissions` index check** — flagged 3 missing indexes; all added.

## NOT changed
- Frontend `pages/Ask.jsx` — response shape is backwards-compat; the answer + confidence pill re-render off the same fields.
- `POST /api/ask` route / auth gate / `ask_history` write.
- `GET /api/ask/briefing` behaviour (still recency-only).
- No new comms / scheduler / ephemeral-upload paths.
- `/app/mobile/` code (only `MOBILE_BUNDLE_VERSION` bumped).
- The 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.

## Version bump confirmed
- `frontend/src/lib/version.js#RUNNING_VERSION` = `paneltec-v160.3.9.58.13.114` ✓
- `frontend/public/service-worker.js#CACHE_VERSION` = `paneltec-v160.3.9.58.13.114` ✓
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` = `paneltec-v160.3.9.58.13.114` ✓
- Live in-app footer verified via UI screenshot.
