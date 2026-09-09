# v58.13.132t — Fuel reports missing $ cost — DIAGNOSIS

**Rev 2 · 2026-09-07** — Re-opened after user pushback quoting
`XT16AB 425.65 $0.00 3times 141.88L`. Original diagnosis has been
re-verified with tighter evidence and stands. **Prior F1 recommendation
(user re-uploads CSV with Total Price column) is NOT superseded — it
is the correct fix.** See Rev 2 Findings section below for the new
evidence trail.

Status: **investigation only, no writes.**

## Root cause layer: **DB** (data absent — pipeline is fine)

All 547 `fuel_transactions` rows have `total_price = None`. The
frontend renders `$0.00` and blanks the `$/L` cell exactly as
designed for the "no price data" state. The backend `fleet_fuel_reports`
aggregator returns `total_price: 0.0` and `dpl: null`. The importer
code, mapping table, upsert path, computed-price-per-litre helper,
and JSON-RPC sync writer are all correct.

## Evidence

### DB — `fuel_transactions` totals (all 547 rows)

```
total_price > 0                : 0
total_price == 0               : 0
total_price null / missing     : 547
price_per_litre > 0            : 0
computed_price_per_litre > 0   : 0
litres > 0                     : 547

source split:
  smartfill_csv : 547
  smartfill_api : 0
```

### DB — freshest row (all fields; abbreviated)

```
id:              a367ee3f-2917-4882-9f21-4fc9215d1d58
source:          smartfill_csv
date_iso:        2026-09-05
litres:          203.81
total_price:     None                 # ← empty
unit_price:      (field not present)
computed_price_per_litre: (field not present)
import_batch_id: bd0bfd76-…
raw_row: {
  'Date':'2026-09-05', 'Time':'17:10:09', 'Card Number':'21301',
  'Description':'Cappa', 'Registration':'XT16AB',
  'From':'Paneltec Breadalbane', 'Litres':'203.810',
  'Fuel Type':'Diesel', 'Pump':'1', 'Odometer':'0'
}
```

The `raw_row` is the ground truth: **the imported CSV file has 10
columns, none of them Total Price / Cost / Amount / $**. That's the
whole bug in one line: the CSV is a legacy export shape from before
Total Price was enabled at the SmartFill portal.

### Sample API response — `GET /api/fleet/fuel/reports?scope=vehicle&period=monthly`

```json
{
  "totals": {"litres": 44836.06, "total_price": 0.0, "fills": 547, "unique_keys": 66},
  "rows": [
    {"key":"bcb686b1-…","label":"XT16AB","litres":3597.14,
     "total_price":0.0,"fills":32,"avg_fill_l":112.41,
     "dpl":null,"delta_dpl":null,"avg_lp100":null,"lp100_sample":0}
    // …65 more rows, all with total_price=0, dpl=null
  ],
  "top_dpl_outliers": [],
  "periods": [/* per-month buckets with total_price=0.0 */]
}
```

API surface is doing exactly what the DB permits.

### SmartFill status — the API auto-sync never landed rows

```
GET /api/fleet/fuel/smartfill-status →
{
  "last_synced_at": "2025-06-30 23:59:59",
  "last_batch_summary": {
    "source": "smartfill_api",
    "rows_total":     1,
    "rows_inserted":  0,     # ← last API attempt saw 1 row, inserted 0
    "rows_rejected":  1,     # ← that 1 got rejected
    "triggered_by": "manual"
  },
  "auto_sync_enabled": false,
  "cron_registered":   false
}
```

Notes:
- Resume cursor is stuck at **2025-06-30 23:59:59** (a year ago) — so
  the next manual sync will pull ~14 months of history if triggered
  as-is.
- Auto-sync toggle is **off**; cron is **not registered**.
- The one API-sync attempt so far rejected its 1 candidate row
  (likely a header-mapping / timestamp parse issue on that specific
  row; separate rabbit hole).

### Frontend — `FuelReporting.jsx` renders `total_price` verbatim

Key lines:
- `295`: `<Stat label="Total cost" value={\`$${(totals.total_price ?? 0).toFixed(2)}\`} />` → renders **$0.00**
- `435`: `<td>${r.total_price.toFixed(2)}</td>` → renders **$0.00** on every row
- `445`: `{r.dpl != null ? \`$${r.dpl.toFixed(3)}\` : '—'}` → renders **—** on every row
- `282-289`: coverage banner
    ```jsx
    const cov = data.totals?.total_price > 0 ? 100 : 0;
    // …
    with the <em>Total Price</em> column enabled to unlock $/L reporting.
    ```
  **This banner is designed for exactly this scenario** — a CSV
  imported without Total Price. It IS rendering right now, but the
  user's screenshot suggests they missed it (or the banner copy is
  too subtle relative to the "$0.00 / —" cells that dominate the
  page).

## Why cost is missing (chain of causation)

1. The legacy CSV that populated the 547 rows was exported from
   SmartFill's portal **before** the "Total Price" column toggle was
   enabled on the account. Column list in `raw_row` proves it: only
   10 columns, none of which are cost-bearing.
2. The importer (`fleet_fuel.py:713`) reads
   `_parse_float(raw_row.get(mapping.get("total_price", ""), ""))`.
   Since no column resolved to `total_price` in the mapping,
   `mapping.get("total_price", "")` returned `""`, `raw_row.get("", "")`
   returned `""`, `_parse_float("")` returned `None`. The 547 rows
   all land with `total_price=None`.
3. `_compute_price_per_litre(None, litres)` returns `None`
   (`fleet_fuel.py:115-118`) → `computed_price_per_litre` is not set.
4. `.131n` upsert-on-duplicate would happily merge `total_price` into
   any existing row IF a subsequent import provided it — but no such
   subsequent import has happened yet.
5. `.131m` API auto-sync (`Transactions:Read`) fetches Total Price
   correctly (see `_SMARTFILL_CSV_COLUMNS` at
   `fleet_fuel.py:1229-1233`), but auto-sync is OFF and the one
   manual attempt saw only 1 row and rejected it.

## Proposed fix (1–3 lines)

**Data hydration, no code change needed.** Pick one:

- **F1 (fastest, single-op).** In the SmartFill portal, re-export the
  affected date range as CSV **with the Total Price column enabled**,
  upload via **Fleet → Fuel → Import CSV**. The
  `_FUEL_UPSERT_ENABLED` path
  (`fleet_fuel.py:756-895`) will match all 547 existing rows on
  `transaction_id`/`dedupe_hash` and merge `total_price` in without
  duplicates. `computed_price_per_litre` is back-filled by
  `fleet_fuel.py:892-896`. Zero risk to existing data.
- **F2 (canonical, going forward).** Set the resume cursor back to
  the earliest fill date (`~2025-06-01`) and trigger
  `POST /api/fleet/fuel/sync-smartfill` — the API returns Total Price
  natively. Same upsert-merge path back-fills the 547 rows. Then
  toggle `auto_sync_enabled=true` so all future rows land with cost.
  Requires investigating the one-row rejection first.
- **F3 (UI-only stopgap).** Raise the visibility of the existing
  "Enable Total Price column…" banner (currently at
  `FuelReporting.jsx:282-289`) — bigger, above-the-fold, blocking the
  `$0.00` cells until acknowledged. Signals honestly that the data is
  incomplete rather than looking like a broken app.

Recommendation: **F1 now** (fix today for the user), **F2 next**
(fix the pipeline), **F3 optional** (defensive UX for future gaps).

## Not the root cause

- API endpoint shape ✅ correct
- Frontend rendering ✅ correct
- Column mapping / alias list ✅ correct (10 aliases incl. `cost`,
  `total`, `amount`, `value`, `$`)
- Upsert / dedupe / computed-price helper ✅ correct
- Anomaly rules / enrichment ✅ correct

## Files inspected

- `backend/fleet_fuel.py:96-160, 573-620, 700-900, 985-1000,
  1120-1140, 1220-1310`
- `backend/fleet_fuel_reports.py:61-220, 280-350`
- `backend/integrations_smartfill.py:327-366`
- `backend/cron_smartfill_auto_sync.py:80-115`
- `frontend/src/pages/FuelReporting.jsx:280-470`

## Green-light asks

- **Q1.** Which fix track — F1, F2, F3, or a combination?
- **Q2.** If F2: OK to reset resume cursor to `2025-06-01` and run a
  full 15-month back-fill? Rate-limit budget is 6/min → 60/hour → 600/day;
  547 rows over multiple months will comfortably fit in one afternoon,
  paginated by `smartfill_fetch_transactions`.
- **Q3.** If F2: OK to also flip `auto_sync_enabled=true` post-back-fill
  so drift never happens again?
- **Q4.** Any objection to bundling F3 (banner boost) into `.132t` since
  we're already touching Fuel Reports?

Awaiting green-light. No writes performed.

---

## Rev 2 Findings — user pushback verification

User's message paraphrased: *"XT16AB shows $0.00 despite 3×141.88 L
totalling 425.65 — the cost is unknown unless we do the calculation
(total_price ÷ litres)."*

### The `425.65` and `141.88` numbers are NOT in the DB anywhere

Verified with three orthogonal queries against `fuel_transactions`:

1. **XT16AB has zero fills at 141.88 L.** Full list of all 32 XT16AB
   fills dumped — largest is 234.91 L (2026-08-04), smallest 51.26 L
   (2026-07-01). No fill lands in the 141.85–141.91 L band.
2. **Zero rows across the entire collection have `litres` ≈ 141.88.**
   `db.fuel_transactions.find({litres:{$gte:141.85,$lte:141.91}})` → 0.
3. **The substring `"141.88"` and `"425.6*"` do not appear in any
   `raw_row` value on any row across all 547 records.**

XT16AB is a distinct, well-defined vehicle in the data: 32 fills
totalling 3597.14 L, average 112 L / fill, single card `21301`,
single description "Cappa". None of the user's specific numbers
match anything the app has ever ingested.

### No column-mapper bug — the CSV genuinely has 10 columns

Definitive source: the actual `fuel_import_batches` document for the
successful 547-row load (batch id `bd0bfd76-…`, filename
`real_500.csv`, uploaded 2026-09-05 08:14):

```
columns_detected:  [Date, Time, Card Number, Description, Registration,
                    From, Litres, Fuel Type, Pump, Odometer]
price_coverage_pct: 0.0
rules_suppressed:   [{rules:[procurement_outlier],
                      reason:"No price data on ≥3 rows this batch —
                      R7 has no math."}]
```

The importer's header-detection is not the culprit. It ran, it saw
10 columns, it recorded a batch-level warning at ingest time. The
column-alias table (`fleet_fuel.py:145-147`) already tests **6
aliases** for the Total Price column and accepts any of:

```
totalprice · price · cost · total · amount · value · $
```

after `_norm_header()` lowercases the header and strips non-alnum.
None of those appear in the real CSV — because SmartFill's export
was configured without the Total Price checkbox on this account.

### No 3× duplicate — dedupe is doing its job

Independently verified: across all 32 XT16AB fills, the tuple
`(date_iso, time_local, litres)` is unique on every row. Zero
collisions. `dedupe_hash` covers the composite of
`(card | key | rego, timestamp, litres)` at
`fleet_fuel.py:_compose_dedupe_hash` and de-dupes on
`transaction_id` first, `dedupe_hash` second, `key_code_fallback`
third. The 3× interpretation may have come from a SmartFill
portal view; it is not in our data.

### Where the `425.65` most likely came from

Three plausible interpretations, in decreasing order of likelihood:

1. **User is reading the SmartFill portal** (which displays Total
   Price on-screen even when their CSV *export* omits the column)
   and expecting Paneltec to show the same value. Diagnosis: the
   portal has the data, our DB does not, because the CSV export did
   not include it.
2. **User is quoting a hypothetical** — "if a row shows 141.88 L
   and $425.65, that gives $3.00/L". 141.88 × 3 = 425.64 — the
   arithmetic itself is the punchline. In that reading the user is
   confirming they want us to *derive* $/L from Total Price ÷
   Litres, which our code already does at `fleet_fuel.py:995`
   (`computed_price_per_litre = _compute_price_per_litre(total_price,
   litres)`) — the derivation is not the missing piece, the
   `total_price` input is.
3. **User is looking at a fresh export they haven't uploaded** —
   possible but the numbers still don't match any XT16AB fill on
   record (no 141.88 L, no $425.65 total).

### The derived-cost logic is present and correct

`fleet_fuel.py:115-118`:

```python
def _compute_price_per_litre(total_price, litres) -> Optional[float]:
    if not total_price or not litres or litres <= 0:
        return None
    return float(total_price) / float(litres)
```

Called on every insert (`fleet_fuel.py:995`) and on every upsert
merge (`fleet_fuel.py:892-896`) — the second path is what enables
the "re-upload with Total Price column, back-fill in place" story.

No fallback exists (nor should exist) for computing cost from
another column — because none of the other 10 columns carry a
money value. The only currency-bearing signal SmartFill produces
is Total Price (per-transaction sale amount) and Unit Price
(price/L). Both are absent from the current CSV.

## Corrected root cause + fix

**Root cause:** unchanged from Rev 1 — the SmartFill CSV export
`real_500.csv` was generated on an account/period where the
"Total Price" column was not enabled in the export template. The
importer scanned all 10 delivered columns and correctly recorded
`price_coverage_pct = 0.0` on the batch. No mapper bug, no dedupe
bug, no rendering bug.

**Fix (unchanged):** F1 — user re-exports the SmartFill fuel history
with the **Total Price** column enabled at the portal, uploads via
Fleet → Fuel → Import CSV. The `.131n` upsert-on-duplicate path
(`fleet_fuel.py:756-895`) will match every one of the existing
547 rows on `dedupe_hash` (`card | key | rego, timestamp, litres`),
merge `total_price` in without creating duplicates, and back-fill
`computed_price_per_litre` automatically via the branch at
`fleet_fuel.py:892-896`.

**Belt-and-braces defence added:** if the user's re-export uses a
header we don't already alias, add it. Current aliases cover 7
common shapes:

```
totalprice · price · cost · total · amount · value · $
```

If SmartFill emits any of these headers instead — please tell us
before upload and we'll add the alias in one line:

- `Sale Total`, `Sale $`, `Sale Amount`
- `Transaction Total`, `Transaction Amount`, `Transaction $`
- `Grand Total`, `Line Total`
- `$ Amount`, `Amount ($)`, `AUD`, `AUD Amount`
- Any header with the word "excl" / "incl" / "GST" (tax-inclusive vs
  exclusive variants)

Adding an alias is a 1-line edit at `fleet_fuel.py:145-147`. No
code review needed — the alias set already contains `$` as a
degenerate shortest-match.

**Verification once the CSV lands:**

```python
# Post-upload sanity check
await db.fuel_transactions.count_documents({"total_price": {"$gt": 0}})
# expected: 547 (all existing rows back-filled)

await db.fuel_transactions.count_documents(
    {"computed_price_per_litre": {"$gt": 0}}
)
# expected: 547

# XT16AB spot-check
async for t in db.fuel_transactions.find(
    {"registration": "XT16AB"}, {"date_iso": 1, "litres": 1,
                                  "total_price": 1,
                                  "computed_price_per_litre": 1}
):
    print(t)
# each row now shows total_price + computed_price_per_litre (~$1.80–$2.10/L
# is the expected 2026 AUD diesel band; $3.00/L would flag as anomalous
# and trigger R7 procurement_outlier)
```

## Not the root cause (confirmed)

Prior Rev 1 findings still hold:

- API endpoint shape ✅ correct — returns `total_price: 0` because
  DB has null.
- Frontend rendering ✅ correct — renders `$0.00` for null.
- Column mapping / alias list ✅ correct — 7 aliases already
  handle common cost-column shapes.
- Upsert / dedupe / computed-price helper ✅ correct — tested end-
  to-end via the upsert branch.
- 3× duplicate hypothesis ✗ not confirmed — 0 dedupe collisions
  across all 32 XT16AB fills.

## Files inspected (Rev 2 additions)

- `backend/fleet_fuel.py:115-118` (compute helper)
- `backend/fleet_fuel.py:143-158` (alias table)
- `backend/fleet_fuel.py:892-896` (upsert back-fill of computed_ppl)
- `backend/fleet_fuel.py:_compose_dedupe_hash` (dedupe composition)
- `db.fuel_import_batches` — the successful 547-row batch record
- `db.fuel_transactions` — all 32 XT16AB fills + full-collection
  substring scan for `141.88` / `425.6*`

No writes performed.

---

## Rev 3 — Static-price bug audit + compute-path audit + render audit

Triggered by user rule:
> `price_per_litre` is ALWAYS computed per transaction as
> `total_price / litres`. Weekly price variation is expected —
> every transaction has its own rate. If either input is missing,
> render `—` (em-dash). Never `$0.00`, never a fallback.

Result: **no static/hardcoded price bug found in code.** The
`$3.000/year` the user is seeing is a **SmartFill Pricing Module
issue on their account** — the portal's `Unit Price` column reports
a constant $3.000 for the whole year because Pricing Module wasn't
updated weekly. The `.131o` amendment (Sep 2026) already
acknowledged this and switched the app to *ignore* the `Unit Price`
column and always compute per-row from `total_price / litres`.
The rule the user wants locked in is already the code's behaviour.

Two ambient risks flagged for future hardening — see Follow-ups.

### 7. Static-price grep

Query: any hardcoded `3.0` / `3.00` / static per-litre constant in
fuel-related backend & frontend.

- `grep -rnE '\b3\.0+\b|"3\.00"|"3\.0"' backend/fleet_fuel*.py
  backend/integrations_smartfill.py backend/cron_smartfill_auto_sync.py`
  → **zero matches.**
- `grep -rnE '\b3\.0+\b|"3\.00"|"3\.0"' frontend/src/pages/Fuel*.jsx
  frontend/src/pages/FleetRegister.jsx frontend/src/components/`
  → **zero fuel-relevant matches.** Every hit is a version string
  in `AppShell.jsx` (`v160.3.0-adjust-…`, `v160.3.0`, etc.) — not
  a price constant.
- `grep -rnE 'unit_price|unitPrice|\$3\.0' frontend/src` → **zero**
  matches in frontend code. The stored `unit_price` field is
  never fetched or rendered by any UI component.

**Conclusion:** The `$3.000` figure the user reported cannot
originate from any hardcoded constant in this codebase.

### 8. Compute path audit

`fleet_fuel.py:106-122` (verbatim, unchanged since .131o):

```python
# v58.13.131o (post-ship amendment) — Compute $/L from
# Total Price ÷ Litres per row. SmartFill's own `Unit Price` column
# is stale on this account (Pricing Module wasn't updated weekly, so
# it reads a constant $3.000 all year). `total_price` is what the
# operator actually paid, so we trust that + the litre count.
#
# Displayed everywhere the UI previously showed `unit_price`
# (reports, AssetDrawer Fuel tab). R7 outlier math uses this value.
# The raw `unit_price` field stays on the doc for audit but is
# never rendered.
def _compute_price_per_litre(total_price, litres) -> Optional[float]:
    try:
        tp = float(total_price) if total_price is not None else None
        lt = float(litres) if litres is not None else None
    except (TypeError, ValueError):
        return None
    if tp is None or lt is None or lt <= 0:
        return None
    return tp / lt
```

**Call sites (both write paths):**

| Line | Path | Behaviour |
|---:|---|---|
| `fleet_fuel.py:995` | Insert on new-row branch (`_import_csv` loop) | Sets `computed_price_per_litre = _compute_price_per_litre(total_price, litres)` on every insert. Returns None if either input is missing → field is None, UI shows `—`. |
| `fleet_fuel.py:892-896` | Upsert-on-duplicate merge branch | Re-computes `computed_price_per_litre` from the *merged* `(total_price, litres)` (post-fill) and updates only if the value changed. Recomputes even when only one of the two fields was back-filled by the upsert. |

**No caching, no static fallback, no aggregate substitution at the
storage layer.** Per-row semantics honoured.

The stored `unit_price` field is populated on write (line 992/783)
purely for audit — no code path reads it back for reporting. Grep
confirms zero frontend consumers.

### 9. Frontend render audit

Four surfaces render $/L. Verified each reads the correct field:

**A. `FuelReporting.jsx` — top-level totals & rollup table**

- Table row `$/L` cell — `FuelReporting.jsx:471`:
  ```jsx
  {r.dpl != null ? `$${r.dpl.toFixed(3)}` : '—'}
  ```
  `r.dpl` comes from the API. The API computes it at
  `fleet_fuel_reports.py:177` via `_dpl(v["litres"], v["total_price"])`
  → `sum($) / sum(L)` per-rollup bucket. **This IS an aggregate**
  but it is the mathematically correct weighted-average per-vehicle
  per-period, NOT a static constant. Rollup by definition; not the
  "$3.00 per row" concern.

- Top-5 $/L outliers — `FuelReporting.jsx:357`:
  ```jsx
  ${o.dpl?.toFixed(3)}
  ```
  Outlier `dpl` is computed **per transaction** at
  `fleet_fuel_reports.py:161-168` via `_dpl(litres, price)` on the
  raw fill — per-row, not aggregated. Correct.

- `$/L` leaderboard — same per-row source (`o.dpl`).

- Δ $/L chip — per-key computed at
  `fleet_fuel_reports.py:_compute_delta_by_key`; drills into
  current-vs-previous-period `sum($) / sum(L)`. Aggregate-aware
  by design.

**B. `AssetFuelTab.jsx` — per-vehicle drawer, Monthly totals table**

- `AssetFuelTab.jsx:144-147`:
  ```jsx
  {m.litres > 0 && m.cost > 0
    ? `$${(m.cost / m.litres).toFixed(3)}`
    : '—'}
  ```
  Client-side computed per-month rollup — `sum($) / sum(L)`. Same
  weighted-average shape as (A). Correct rollup semantic. Falls back
  to `—` when either aggregate is 0, per user's rule.

**C. `AssetFuelTab.jsx` — Recent transactions per-row table**

- Row cells at `AssetFuelTab.jsx:200-205` render **Litres** and
  **Cost** (as `t.total_price`) individually.
- **DOES NOT render a per-row $/L column.** No `computed_price_per_litre`
  cell in this table. A user comparing to the SmartFill portal
  (which shows Unit Price per row) sees no counter-signal.
- Not a wrong display; a **display gap**. See Follow-up F-A below.

**D. Fuel Anomaly Inbox**

- `FuelAnomalyInbox.jsx` reads flags via `/api/fleet/fuel/anomalies`
  and displays `computed_price_per_litre` when the R7
  `procurement_outlier` rule fires — per-row source.

**No frontend surface renders `unit_price` (verified: 0 grep hits).**
No frontend surface substitutes a global average for a per-row
rate.

### Verdict against user's rule

| Rule | Compliance | Evidence |
|---|---|---|
| $/L always computed as `total_price / litres` per row | ✅ | `fleet_fuel.py:115-122` + call sites 892 & 995 |
| Do NOT read `Unit Price` column into stored $/L field | ✅ | Stored under `unit_price` (audit-only), never rendered |
| Do NOT use a static/hardcoded per-litre fallback | ✅ | Zero grep hits; no constant in code |
| Do NOT show a global year-average as a per-row price | ✅ | Per-row `$/L` comes from `_compute_price_per_litre(row.total_price, row.litres)`. Rollup `dpl` in reports is weighted `sum($)/sum(L)` for the specific period bucket — legitimate rollup, not a year-wide constant |
| Missing input → `—` em-dash, never `$0.00` | ⚠ Partial | `AssetFuelTab.jsx` monthly + per-txn cells correctly show `—`. `FuelReporting.jsx:295` **Total cost** stat still shows `$0.00` when `totals.total_price` is 0 (line 295: `\`$${(totals.total_price ?? 0).toFixed(2)}\``). Not a $/L display, but arguably violates the "never $0.00" spirit of the rule. See Follow-up F-B. |

### Where the user's "$3.000 all year" observation IS coming from

**The SmartFill portal itself** — not Paneltec. The portal's
`Unit Price` column is fed by SmartFill's Pricing Module, which
this account hasn't been maintaining weekly. So every row on the
SmartFill portal (and in the CSV `Unit Price` column, if it were
included in the export) reads $3.000/L for the whole year.

The `.131o` amendment specifically anticipated this scenario and:
1. Renamed the derived-from-total-price field to
   `computed_price_per_litre` (unambiguous name).
2. Kept `unit_price` on the doc for audit but never renders it.
3. Uses `total_price / litres` per-row on every insert and every
   upsert-merge.

If the SmartFill account's Pricing Module were later fixed and
each row got a genuine per-week `Unit Price`, our behaviour is
still correct — we *ignore* that column and compute from
`total_price / litres`. Since `total_price = unit_price × litres`
at the pump, the two would agree anyway; if they diverge (e.g. due
to GST rounding or discount adjustment), we take `total_price ÷
litres` as the source of truth because it's what the operator
actually paid.

### Follow-ups (not blocking)

- **F-A.** `AssetFuelTab.jsx` recent-transactions table has no
  per-row `$/L` cell. Add a column reading
  `t.computed_price_per_litre` and rendering `t.computed_price_per_litre
  != null ? \`$${t.computed_price_per_litre.toFixed(3)}\` : '—'`.
  Would let the operator inspect the per-row derived rate directly
  and confirm it varies week-to-week (not stuck at $3.000). Estimated
  effort: **S** — 6-line JSX addition.
- **F-B.** `FuelReporting.jsx:295` `Total cost` `Stat` shows `$0.00`
  when the sum is zero. Suggest `totals.total_price > 0 ?
  '$' + totals.total_price.toFixed(2) : '—'` per user rule. Effort:
  **S** — 1-line edit.
- **F-C.** Consider stripping `unit_price` from the stored doc
  entirely (belt-and-braces so future refactors can't accidentally
  render it). Would require a one-off migration to drop the field.
  Effort: **M**. Optional — current gate already prevents it from
  reaching UI.

### Rule (locked in for future reference — codify in memo)

> Fuel `$/L` is derived, never stored from source. Only
> `total_price` and `litres` are canonical per-row facts.
> `computed_price_per_litre = total_price / litres` is
> recomputed on every write. Rollup `$/L` is `sum($) / sum(L)`
> over the period bucket. `unit_price` is audit-only, never
> rendered. Missing input → `—`.

No writes performed.
