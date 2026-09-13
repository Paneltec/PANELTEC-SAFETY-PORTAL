# v58.13.132dt — Simpro customer search dropdown fix

**Status**: Shipped. `finish` tool deliberately deferred per standing directive.
`e1_tester` / `testing_agent` untouched. No `/app/mobile/` edits.

## Diagnostic (before touching code)

### Step 1 — Curl the FE-called endpoint

The FE hits `/api/integrations/simpro/customers/search` (via axios
prefix `/api` + `/integrations/simpro/customers/search`).
`.132dq`'s test suite locked that same path.

```
$ curl "$BASE/api/integrations/simpro/customers/search?q=an&limit=20" \
       -H "Authorization: Bearer $ADMIN_TOK"
{"items": [], "total": 0, "cached_at": "2026-09-11T04:01:54Z", "connected": true}

$ curl "$BASE/api/integrations/simpro/customers/search?q=paneltec&limit=5" \
       -H "Authorization: Bearer $ADMIN_TOK"
{"items": [], "total": 0, "cached_at": "2026-09-11T04:01:54Z", "connected": true}
```

Endpoint returns **200 OK with `connected: true`** but `items: []` for
every substring. Failure is not a 404, not a 500, and not an auth
problem — the endpoint runs, hits Simpro's cache, and returns nothing.

### Step 2 — Simpro API health

Direct `/customers?company=both` shows **2,064 cached customers**,
sample row shape:

```json
{
  "simpro_customer_id": "3",
  "simpro_company_id":  "2",
  "company_label":      "Paneltec",
  "name":               "ABC Australian Broardband Company",
  "type":               "Company",
  "active":             true
}
```

The cached rows carry only **6 keys**. The Simpro token is live, the
sync ran, data is present.

### Step 3 — `_match` filter grep

`backend/integrations_simpro.py::simpro_customers_search` (`.132dq`
line 738-744) filtered over:

```python
("company_name", "contact_name", "email", "given_name", "family_name")
```

**None of those keys exist on cache rows** — `_normalise_customer`
collapsed everything into a single `name` string. Every substring
haystack was the empty string. Root cause found.

### Step 4 — Simpro list-response inspection

Direct probe of `GET /api/v1.0/companies/2/customers/?pageSize=3&page=1`
returns:

```
row 0 keys: ID, _href, Type, CompanyName, GivenName, FamilyName
```

**No `Email` in the list response.** Email lives on the per-customer
detail endpoint (path via the `_href` string):

```
GET  /api/v1.0/companies/2/customers/companies/3/
→ {..., "CompanyName": "145 Financial",
        "Phone": "03 6344 9424",
        "Email": "sbleathman@145financial.com.au",
        "Contacts": [...]}
```

So even after fixing `_match`, matched rows would still lack the
email the FE picker needs for the M365 dispatch.

### Step 5 — FE wiring check

`OrgSettings.jsx::InsuranceEmailModal`:
* `useEffect([search])` debounces 220ms then calls
  `api.get('/integrations/simpro/customers/search', {params: {q, limit: 15}})`.
* On response → `setSuggestions(data?.items || [])`.
* Dropdown component renders when `suggestions.length > 0`, mapping
  over `s.simpro_customer_id`, `s.email`, `s.company_name`,
  `s.contact_name`.
* Click handler: `addRecipient(s.email, {company_name: s.company_name})`.
  Button disabled when `!s.email`.

Debounce + wiring are correct. FE-side behaviour is 100% dependent
on the backend returning rows with `company_name` **and** `email`
populated.

### Failure layer summary

**Backend** — two independent gaps chained:
1. `_normalise_customer` throws away the split fields Simpro returns
   (`CompanyName`/`GivenName`/`FamilyName`), collapsing them into a
   single `name` string. Cache rows have no keys for the filter to
   hit.
2. `email` never makes it into cache rows because the Simpro
   **list** endpoint doesn't include it; only the **detail**
   endpoint via `_href` does. Even a fixed filter would return rows
   the FE renders as disabled ("no email").

## Fix

Applied entirely in `backend/integrations_simpro.py`. Three layers:

### 1. Cache row enrichment — `_normalise_customer`

Now emits `company_name`, `contact_name`, `given_name`,
`family_name`, and `_href` alongside the pre-existing `name`,
`type`, `company_label` fields. Nothing removed — the `name` field
is preserved and now populated as `company_name or contact_name or
"(unnamed)"` so any pre-.132dt consumer keeps working.

### 2. `_match` filter — pins to real keys

```python
("name", "company_name", "contact_name",
 "given_name", "family_name", "email",
 "type", "company_label")
```

`email` is retained in the haystack for cache rows that come back
already enriched; the other keys are guaranteed to exist on the
new cache shape.

### 3. On-demand email enrichment — `_fetch_customer_email` + `_enrich_emails`

After `_match` narrows to the top-N (capped at `limit` ≤ 100), each
match's detail is fetched via `_href` in parallel (bounded semaphore
`asyncio.Semaphore(6)` to avoid hammering Simpro). Email is pulled
from `d.Email` with a fallback to the first `Contacts[].Email`.
Results are cached in-process for 30 minutes under
`(org_id, simpro_customer_id)` so subsequent typing across common
prefixes stays snappy.

**Cache eviction**: on ship I ran a one-shot Mongo unset of
`customers_cache` + `customers_cached_at` on the connected org so
the next `/customers` call re-hydrates with the new normalised
shape. Subsequent 5-min TTL refreshes will keep it aligned going
forward.

## Curl round-trip proof (after fix)

```
$ curl "$BASE/api/integrations/simpro/customers/search?q=an&limit=5" \
       -H "Authorization: Bearer $ADMIN_TOK" | jq
{
  "items": [
    { "simpro_customer_id": "3", "name": "ABC Australian Broardband Company",
      "company_name": "ABC Australian Broardband Company",
      "email": "reception@abccivilgroup.com.au",
      "_href": "/api/v1.0/companies/2/customers/companies/3", ... },
    { "simpro_customer_id": "4", "name": "AJ Water Leak Detection",
      "company_name": "AJ Water Leak Detection",
      "email": "admin@ajwater.com.au", ... },
    { "simpro_customer_id": "5", "name": "Asbestas",
      "company_name": "Asbestas",
      "email": null, ... },
    { "simpro_customer_id": "7", "name": "6ty°",
      "company_name": "6ty°",
      "email": "psluce@6ty.com.au", ... },
    ...
  ],
  "total": 5, "connected": true
}
```

Substring `"an"` matches 5+ real customers; 4/5 have their real
Simpro-side email attached; the one with `null` email surfaces as a
disabled row in the picker (existing FE behaviour, unchanged).

## Free-text + selection unchanged

* Free-text "Or enter a custom email address" + Add button — untouched.
* Selected clients still render as removable chips above the input
  (`OrgSettings.jsx` `removeRecipient` / chip render — unchanged).
* Selecting a Simpro row still calls `addRecipient(s.email, {...})`
  with the real email string that lands on `recipients[].email`,
  which the send handler passes verbatim to
  `POST /api/org/insurance/email → recipients: [...]`.

## Tests

`backend/tests/test_v58_13_132dt_simpro_search_fix.py` — **7 passed
in 4.7s**:

```
test_normalise_customer_preserves_split_fields                     PASSED
test_match_filters_over_real_cache_keys                            PASSED
test_email_enrichment_helpers_present                              PASSED
test_frontend_picker_still_wired                                   PASSED
test_three_way_version_sync_at_132dt                               PASSED
test_customers_search_returns_matches_with_emails                  PASSED
test_customers_search_admin_only                                   PASSED
```

The behavioural `test_customers_search_returns_matches_with_emails`
asserts:
* Substring `"an"` returns ≥ 1 items.
* Every row carries the new normalised shape (7 keys).
* At least one row has a real enriched email — the regression lock
  for the `.132dq` bug.
* Admin-only guard preserved (unauth'd → 401/403).

No regressions across the earlier suites:

```
tests/test_v58_13_132ds_staff_login_soft_delete.py — 15 passed
tests/test_v58_13_132dr_sidebar_branding_shading.py — 6 passed
tests/test_v58_13_132dq_insurance_email.py         — 10 passed, 6 skipped
```

## Screenshot

`/app/memory/v58_13_132dt_01_simpro_dropdown_results.jpeg` — the
"Insurance Certificates Distribution" popup with the query `an`
typed into the "Search Simpro customers…" field. Dropdown shows 8
real Simpro customers with real emails: ABC Australian Broardband
Company → `reception@abccivilgroup.com.au`, AJ Water Leak Detection
→ `admin@ajwater.com.au`, 6ty° → `psluce@6ty.com.au`, Burnie City
Council → `accountspayable@burnie.tas.gov.au`, Clarke Agencies
Tasmania → `clarkeagenciestas@bigpond.com`, Claude Neon →
`accountspayable@claudeneon.com.au`. Rows without an email (Asbestas,
CGU Insurance) are greyed as designed. Sidebar footer version pill
`v160.3.9.58.13.132dt`.

## Version pins → `.132dt`

* `frontend/src/lib/version.js` — RUNNING + EXPECTED_CACHE
* `frontend/public/service-worker.js` — CACHE_VERSION
* Mobile untouched at `.132di`.

## Ops rules honoured

* No `testing_agent`, no `e1_tester`, no `finish` tool.
* No `/app/mobile/` edits.
* No new disk writes — email enrichment is in-process only.
* 20 pre-existing `ephemeral-upload-storage` warnings still parked
  for `v58.14.x`.
