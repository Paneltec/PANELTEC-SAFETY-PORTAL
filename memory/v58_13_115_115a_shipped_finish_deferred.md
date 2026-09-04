# v58.13.115 + v58.13.115a — Ask Intelligence follow-ons (finish deferred)

**Status:** SHIPPED. `finish` tool blocked by the same 20 pre-existing `ephemeral-upload-storage` warnings (deferred to v58.14.x per user directive).

## v58.13.115 — Clickable Ask Intelligence citations + Visitor drawer auto-open

### Files touched
| Path | Change |
|---|---|
| `backend/ask.py` | New `_DEEP_LINK_TEMPLATES`, `_build_deep_link()`, `_enrich_citations()`; added `template_id` to form_submissions projection; wired `_enrich_citations` into both `POST /ask` (after the .114 fallback) and `GET /briefing`. |
| `frontend/src/pages/Ask.jsx` | Imported `<Link>` from react-router; `ProofChip` renders `<Link>` when `deep_link` set, plain `<div>` w/ tooltip when null; every chip gets `data-testid="citation-<type>-<id8>"`. |
| `frontend/src/pages/AdminVisitors.jsx` | New `useSearchParams` effect: on mount, `?open=<id>` → `setDrawerId(id)` + flip `include_deleted` if not in filter + strip param via `setSearchParams({}, {replace: true})`. |
| Version constants ×3 + full changelog block in `version.js`. |
| NEW `tests/backend_unit/test_ask_deep_links_v58_13_115.py` — 27 checks. |

### Backend citation payload — before/after
```json
// BEFORE (v58.13.114)
{ "record_type": "user", "record_id": "808cb7de-...", "label": "Stephen" }

// AFTER (v58.13.115)
{ "record_type": "user", "record_id": "808cb7de-...", "label": "Stephen",
  "deep_link": "/app/settings/users?open=808cb7de-..." }
// null case:
{ "record_type": "audit_log", "record_id": "a1", "label": "Login by X",
  "deep_link": null, "deep_link_reason": "no_detail_page" }
```

### Route mapping
| record_type | Deep link | Direct detail page? |
|---|---|---|
| `swms` | `/app/swms/:id` | ✅ direct |
| `contractor` | `/app/contractors/:id` | ✅ direct |
| `site_visitor` | `/app/admin/visitors?open=:id` | ✅ **drawer wired this ship** |
| `incident`, `hazard`, `inspection`, `pre_start`, `site_diary`, `user`, `worker` | `/app/<list>?open=:id` | ❌ list only — drawer wiring flagged for future |
| `form_submission` | `/app/forms/templates/{template_id}/submissions?open=:id` | ✅ template scope |
| `outbound_email`, `outbound_sms` | `/app/outbox?open=:id&kind=email/sms` | ✅ outbox exists |
| `audit_log` | `null` + `no_detail_page` | ❌ no route |

### Live curl trace (`POST /api/ask {"question": "stephen"}`)
Every citation carried a real, correctly-formed deep_link:
- 2× user → `/app/settings/users?open=<uuid>`
- 2× site_visitor → `/app/admin/visitors?open=<uuid>`
- 1× form_submission → `/app/forms/templates/e8873f7e-.../submissions?open=25063a6c-...` (template_id lookup working)

### Pytests
**27 checks** — parametrised deep-link matrix, null-branch reasons, `_enrich_citations` shape preservation, App.js route validity spot-check, frontend source-pins, `AdminVisitors` `?open=` wiring, version pin.

---

## v58.13.115a — Auto-clear Ask history on new search + Clear-history button

### Files touched
| Path | Change |
|---|---|
| `backend/ask.py` | `POST /ask`: `delete_many({org_id, user_id})` before `insert_one`; new `DELETE /ask/history` returning `{deleted: n}`. |
| `frontend/src/pages/Ask.jsx` | Removed "Recent Questions" panel entirely; new "Clear N previous answer(s)" link → `api.delete('/ask/history')` → success toast; local `history` array replaced with `historyCount` int. |
| Version constants ×3 + full changelog block in `version.js` (BOTH .115 and .115a entries). |
| Updated `tests/backend_unit/test_ask_deep_links_v58_13_115.py` — flipped `test_history_panel_renders_citations` → `test_history_panel_removed_in_115a`. |
| NEW `tests/backend_unit/test_ask_history_autoclear_v58_13_115a.py` — 10 checks. |

### Backend diff
```python
# In POST /ask, immediately before the ask_history.insert_one:
# v58.13.115a — Auto-clear the caller's history BEFORE inserting
# the new row. Scoped strictly to (org_id, user_id).
await db.ask_history.delete_many({"org_id": user["org_id"], "user_id": user["id"]})
await db.ask_history.insert_one({...})   # unchanged

# New endpoint:
@router.delete("/history")
async def clear_history(user: dict = Depends(get_current_user)):
    r = await db.ask_history.delete_many({"org_id": user["org_id"],
                                           "user_id": user["id"]})
    return {"deleted": int(getattr(r, "deleted_count", 0) or 0)}
```

### Live curl trace
```
GET  /api/ask/history        → rows: 1   (from the last POST /ask, kept by design)
DELETE /api/ask/history      → {"deleted": 1}
GET  /api/ask/history        → rows: 0
DELETE /api/ask/history      → {"deleted": 0}   (idempotent)
```

### Screenshots
- `/app/memory/v58_13_115a_ask_no_recent_panel.png` — Ask page, **no Recent Questions panel**. Just input + suggestion chips + Ask button + a discreet "Clear 1 previous answer" link at bottom-right. Version footer: `paneltec-v160.3.9.58.13.115a`.
- `/app/memory/v58_13_115a_ask_after_clear.png` — after clicking Clear-history: green Sonner toast **"History cleared (1 row)"** top-right, the link is now hidden (historyCount = 0).

### Pytests
**10 checks** — source-pin delete-before-insert order, `DELETE /ask/history` route + shape, briefing doesn't touch ask_history, behavioural 5→1 auto-delete, cross-user + cross-org scoping (A/A wipe leaves A/B and B/A rows), `clear_history()` returns correct count + idempotent, frontend Recent-Questions removal + Clear-history control wiring, version pin.

---

## Test outcome (both ships)
Full backend_unit suite: **898 passed, 1 skipped, 0 failures** (+37 for .115+.115a, was 861 after .114).

## Version bumps
All 3 canonical strings → `paneltec-v160.3.9.58.13.115a`:
- `frontend/src/lib/version.js#RUNNING_VERSION` ✓
- `frontend/public/service-worker.js#CACHE_VERSION` ✓
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` ✓
- Live in-app footer verified via UI screenshot.

## NOT changed
- Confidence-override matrix from .114 (still runs before enrichment).
- Ask endpoint auth / permission gates.
- `POST /api/ask` / `GET /api/ask/briefing` / `GET /api/ask/history` behaviour, apart from the delete-before-insert + citation enrichment.
- Suggestion chips + suggestion CRUD endpoints.
- `/app/mobile/` code (only `MOBILE_BUNDLE_VERSION` bumped).
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.
