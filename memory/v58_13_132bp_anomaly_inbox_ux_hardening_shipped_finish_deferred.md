# v58.13.132bp — Fuel Anomaly Inbox UX hardening

**Status:** SHIPPED · finish tool deferred per standing directive.
**Version pins (all in lockstep):**
- `RUNNING_VERSION`         = `paneltec-v160.3.9.58.13.132bp`
- `EXPECTED_CACHE_VERSION`  = `paneltec-v160.3.9.58.13.132bp`
- SW `CACHE_VERSION`        = `paneltec-v160.3.9.58.13.132bp`
- `MOBILE_BUNDLE_VERSION`   = unchanged (no `/app/mobile/` code touched).

---

## USER PAIN (verbatim, Stephen · 2026-09-09)

> "By the way as soon as you touch it it goes away and can't see it
> again... there is no resolved tab and I didn't click resolve or
> any thing"

The `.131c` inbox rendered the per-flag Resolve/Dismiss actions as
tiny 10-pixel emerald/slate-outlined pills (`px-1.5 py-0.5
text-[10px]`) that were visually indistinguishable from the severity
chips beside them. The read-only investigation (`.132bp` step 0)
confirmed no auto-mutation logic exists on the page — every
disappearance was a mis-tap on the Resolve chip that then correctly
dropped the row from the `resolved=false` filter. The Resolved tab
was on screen but rendered as a rounded-pill filter chip that didn't
read as a "tab".

Three fixes bundled in this ship; **bulk checkboxes / bulk-delete
parked** per Stephen's explicit decision.

---

## Files changed

| File | Change |
|---|---|
| `backend/fleet_fuel.py` | +55 lines: new `POST /fleet/fuel/anomalies/{txn_id}/reopen` endpoint + `AnomalyReopenIn` model + `reopen_anomaly` handler. |
| `frontend/src/pages/FuelAnomalyInbox.jsx` | Chip re-style · Undo toast · Tab-strip refactor · Unused `Filter` import removed. |
| `frontend/src/lib/version.js` | Version bump + full changelog block prepended. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` bump. |
| `backend/tests/test_v58_13_132bp_anomaly_reopen.py` | **NEW** — 9 pytests. |
| `backend/tests/test_v58_13_132bo_smartfill_card_drilldown.py` | 1-line forward-safe fix to `test_version_and_cache_bumped_to_132bo` (was hard-`endswith` — now `>= .132bo`). |
| `memory/v58_13_132bp_anomaly_inbox_ux_hardening_shipped_finish_deferred.md` | This memo. |

---

## Endpoint contract

```
POST /api/fleet/fuel/anomalies/{txn_id}/reopen
Content-Type: application/json
Authorization: Bearer <admin or assets.edit token>

Request:
  { "rule": "<rule_key>" }         # e.g. "reading_regress"

Responses:
  200  { "txn_id": "...", "rule": "...", "reopened": 1 }
  400  { "detail": "rule not present on this transaction" }
  400  { "detail": "rule is already open" }
  404  { "detail": "tx not found" }
  403  (auth failure — reused `assets.edit` gate)
```

**Field clearing:** the handler clears every resolution-metadata
field this codebase has ever written to a flag, so a re-opened flag
looks byte-identical to a freshly-detected flag:

```
resolved_at, resolved_by, resolved_action, resolved_note,
resolution_reason, resolution_kind, dismissed_at  →  all set to None
```

Multi-flag rows are safe — only the specified rule's flag is
touched; other flags on the same transaction stay put.

---

## Frontend deltas

### Fix 1 — Resolve/Dismiss chips → real buttons

```jsx
// Before (.131c):
className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded
           text-[10px] font-bold border border-emerald-300
           text-emerald-800 hover:bg-emerald-50"

// After (.132bp):
className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md
           text-xs font-semibold border bg-emerald-600
           hover:bg-emerald-700 text-white border-emerald-700
           transition-colors"
```

- Hit area up ~4×.
- Filled bg so they can't read as status chips.
- Titles now signal reversibility: `"Marks this flag as resolved —
  reversible via Undo toast"`.
- Dismiss mirrors on the slate ramp (`bg-slate-600 hover:bg-slate-700
  text-white border-slate-700`).
- Icons up from size 10 to size 12.

### Fix 2 — Undo toast + emerald action pill

```jsx
toast.success(`${verb} · ${ruleLabel}`, {
  duration: 5000,
  actionButtonStyle: {
    backgroundColor: '#059669',  // emerald-600
    color: '#ffffff',
    padding: '0.375rem 0.875rem',
    borderRadius: '9999px',
    fontWeight: 600,
    fontSize: '0.75rem',
    border: '1px solid #047857', // emerald-700
  },
  action: {
    label: 'Undo',
    onClick: async () => {
      await api.post(`/fleet/fuel/anomalies/${row.id}/reopen`,
                     { rule: ruleKey });
      toast('Reopened');
      reload();
    },
  },
});
```

- Same shape for Resolve + Dismiss — one code path, one Undo affordance.
- Undo error path calls `apiError(undoErr) || 'Undo failed'` so a
  race (concurrent second resolve, network drop) never dies
  silently.
- Sonner's `actionButtonStyle` targets the rendered action button
  inline — the app-level `<Toaster richColors closeButton />` config
  in `App.js` is untouched.

### Fix 3 — Status filter → real tab strip

```jsx
<div className="border-b border-slate-200 -mx-3 px-3">
  <div className="flex items-center gap-1"
       data-testid="fuel-anomaly-status-tabs">
    {[
      { key: 'open',     label: 'Open' },
      { key: 'resolved', label: 'Resolved' },
      { key: 'all',      label: 'All' },
    ].map((opt) => (
      <button ...
        className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2
                   transition-colors ${
          status === opt.key
            ? 'border-slate-900 text-slate-900'
            : 'border-transparent text-slate-500
               hover:text-slate-800 hover:bg-slate-100'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
</div>
```

- `-mb-px` on each tab so the active tab's 2px underline aligns
  exactly on the container's 1px baseline (classic tab pattern).
- **Every existing per-tab testid preserved** (`fuel-anomaly-status-
  open/resolved/all`) so downstream Playwright + pytest source pins
  keep running.
- Old `<Filter />` icon label + vertical divider retired — the tab
  strip implies "status" without the label.

---

## Pytests (9 new · all green)

`backend/tests/test_v58_13_132bp_anomaly_reopen.py`:

1. `test_reopen_clears_resolution_metadata` — POST clears
   `resolved_at`/`_by`/`_action`/`_note`; second flag on the same
   row untouched.
2. `test_reopen_row_returns_to_open_filter` — after reopen, the
   `/anomalies?resolved=false` list re-surfaces the row.
3. `test_reopen_missing_txn_returns_404`.
4. `test_reopen_rule_absent_returns_400`.
5. `test_reopen_already_open_returns_400` (idempotency guard).
6. `test_frontend_chips_are_real_buttons` — emerald-600 fill,
   px-2.5 hit area, "reversible via Undo toast" titles present, old
   10-px pill styling gone.
7. `test_frontend_undo_toast_wired` — `duration: 5000` + `Undo`
   label + `/reopen` call site + emerald `actionButtonStyle`.
8. `test_frontend_status_filter_is_tab_strip` —
   `fuel-anomaly-status-tabs` testid, `border-b border-slate-200`
   baseline, `-mb-px border-b-2` per-tab underline, old rounded-pill
   className is gone.
9. `test_version_and_cache_bumped_to_132bp` — forward-safe `>=`
   pin on `RUNNING_VERSION` / `EXPECTED_CACHE_VERSION` /
   SW `CACHE_VERSION`.

```
============================== 9 passed in 5.46s ===============================
```

Regression sanity — reran `.132aj` + `.132bi` + `.132bo`:

```
============================== 36 passed, 1 warning in 6.17s ===================
```

(One test in `.132bo` had a strict `endswith(".132bo")` that flipped
red after the version bump — fixed in the same commit as a
forward-safe `>=` pin. Every other test file is untouched.)

---

## Playwright screenshots (verified live · 4 files)

- `/app/memory/v58_13_132bp_01_tab_strip_and_chips.jpeg` — landing
  page. Tab strip visible with `Open` underlined in slate-900,
  79 emerald `Resolve` buttons + 79 slate `Dismiss` buttons in the
  Actions column. Total matches: **1426**.
- `/app/memory/v58_13_132bp_02_chips_closeup.jpeg` — first row
  scrolled into view; the filled buttons are impossible to confuse
  with the pastel `READING REGRESSION` / `NO ODOMETER` severity
  chips beside them.
- `/app/memory/v58_13_132bp_03_undo_toast.jpeg` — Sonner toast
  `✓ Resolved · Reading regression` with the emerald pill **`Undo`**
  action button in the top-right. Total matches dropped 1426 → **1425**
  immediately after the Resolve click.
- `/app/memory/v58_13_132bp_04_after_undo.jpeg` — post-Undo:
  toast `Reopened` fires, the row list has already been re-fetched,
  Total matches back to **1426**. Full round-trip in < 2s.

Version pill at the bottom of the sidebar reads
`paneltec-v160.3.9.58.13.132bp`.

---

## NOT changed / NOT in scope

- **Bulk checkboxes / bulk-delete / bulk-dismiss** — parked per
  Stephen's decision. Zero DELETE surface added.
- `/app/mobile/` — untouched.
- `metro.config.js` — untouched.
- Sonner mount in `App.js` — untouched (`<Toaster richColors
  closeButton />` still authoritative).
- The 20 pre-existing `ephemeral-upload-storage` warnings — still
  parked for v58.14.x per user directive.
- The `assets.edit` gate matrix — reused verbatim from `_flip_anomaly`.
- No comms / emails / SMS wiring — Anomaly Inbox remains
  inbox-only.

---

## Ops notes

- Cache bumped so any admin sitting on `.132bo` sees the "Update
  available" toast and reloads once, picking up the new chips,
  tabs and Undo affordance without a hard refresh.
- Sonner's default toast timeout in the app is 4s but the app-level
  `<Toaster>` doesn't set an explicit default duration — my `duration:
  5000` on the Resolve/Dismiss toast is a per-toast override that
  gives Stephen enough time to spot and click Undo. Standard Sonner
  toasts elsewhere in the app keep their default behaviour.
- The `/reopen` handler is idempotent-safe: calling it twice on the
  same rule returns `400 rule is already open` on the second call
  rather than double-clearing the resolution metadata. Any client
  race condition is handled explicitly.

Next up in the backlog:
1. Investigate the P1 500 toast on Permission Matrix "preview as
   role" panel open (spotted in `.132bn`).
2. `.132ba` — poll EAS build `1b5018a3-f23f-4b0b-839f-5141cab1a7a8`
   for the mobile blink-crash diagnostic.
3. `.132bb-web` follow-up — wire `POST /fleet/fuel/transactions/{id}/flag-suspicious`.
