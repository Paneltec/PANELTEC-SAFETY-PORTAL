# v58.13.132by — Fleet & Service Register search: broaden to multi-field + register-scoped

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132by`.

## USER PAIN
Stephen typed `XT96AZ` in the Fleet & Service Register search bar. The list below stayed unfiltered (K59JU, K68JF, K76KT, K82KU still visible). Vehicle XT96AZ does exist in the DB (asset `c1027e42...`, name `Cap Recycler - XT96AZ`).

## Root-cause
Two-part bug:

1. **UX mismatch** — the top search bar hit `/fleet/search` (the global ⌘K quick-jump dropdown) but never filtered the underlying register table. The user's mental model was "typing here filters the list", but the table only re-queried on left-nav filter changes (kind, sub_type, navixy).

2. **Field coverage gap** — even the `/fleet/register?q=...` endpoint only matched `rego_serial`, `name`, `make`, `model`, `manufacturer`, `asset_type`, `sub_type`, `description`. It missed **`smartfill_card_number`**, `smartfill_key`, `simpro_asset_id`, `driver_name`, `asset_code`, `scan_token`, and legacy aliases `registration` / `plate`. And the global `/fleet/search` asset scan was missing `smartfill_card_number` / `smartfill_key` too.

## Files changed
| File | Change |
|---|---|
| `backend/fleet.py::get_register` | Broadened `q` OR-set from 8 → **16 fields**. Added: `smartfill_card_number`, `smartfill_key`, `simpro_asset_id`, `driver_name`, `asset_code`, `scan_token`, `registration`, `plate`. Case-insensitive regex (existing behaviour). |
| `backend/fleet.py::search_all` | Asset scan now includes `smartfill_card_number` + `smartfill_key`. |
| `frontend/src/pages/FleetRegister.jsx` | `SearchBar` now accepts `registerQ` + `setRegisterQ` props and lifts every keystroke up to the parent. Parent forwards `q: registerQ` to `/fleet/register` (server-side filter, primary path). New placeholder copy. Small hint under the field with a Clear filter link. Client-side belt-and-braces filter over the fetched page runs the same multi-field logic (hyphen/space-tolerant on rego). Zero-match empty state gains a `Clear filter` button with clear copy. Page auto-resets to 1 when the search term changes. |
| `frontend/src/lib/version.js` + SW | Version bump. |
| `backend/tests/test_v58_13_132by_fleet_register_multifield_search.py` | **NEW** — 11 pytests. |

## Endpoint contract deltas

### `GET /fleet/register?q=...`
`q` OR-set widened (case-insensitive regex, all-or-none). Now matches any of:
```
rego_serial, name, make, model, manufacturer, asset_type, sub_type,
description, smartfill_card_number, smartfill_key, simpro_asset_id,
driver_name, asset_code, scan_token, registration, plate
```

### `GET /fleet/search?kinds=asset&q=...`
Asset OR-set now also includes `smartfill_card_number` + `smartfill_key`.

## Frontend UX cascade

- **Primary path (server-side)** — every keystroke debounces via React state → `/fleet/register` re-fires with `q=...&page=1`. 16-field regex handles the heavy lifting.
- **Client-side defence-in-depth** — the same multi-field predicate re-runs on the fetched page. This catches any drift where the backend adds a field the FE doesn't send, and vice-versa. Hyphen/space-tolerant: `XT-96AZ`, `XT 96AZ`, `xt96az` all normalise to the same haystack.
- **AND-across-tokens, OR-across-fields** — `Toyota Ranger` matches assets that have BOTH tokens across any subset of the 16 fields. Same behaviour Stephen already expects from Ask Intelligence.
- **Zero-match** — banner with the exact search term echoed back + Clear filter button. Also surfaces when the register is genuinely empty (no filter).
- **Cross-feature reuse** — the ⌘K quick-jump dropdown still works alongside the register-table filter. Same input drives both.

## Pytest
```
============================== 11 passed in 1.38s =============================
```

## Investigation summary (pre-fix)

- Backend `/fleet/search?q=XT96AZ` returned 1 asset hit (backend was FINE for name/rego). The bug was purely that the FE render pipeline never fed that state back into the register table.
- DB check: `assets.find_one({"rego_serial":"XT96AZ"})` → `{id: c1027e42..., name: 'Cap Recycler - XT96AZ', rego_serial: 'XT96AZ'}`.
- Curl of `/fleet/register?q=XT96AZ` pre-fix: hit the vehicle correctly. So the ONLY missing piece was wiring the FE input to that endpoint.

## Screenshots (live, verified)

- `/app/memory/v58_13_132by_01_search_XT96AZ.jpeg` — typed `XT96AZ`, register filters to 1 row (Cap Recycler - XT96AZ). ⌘K dropdown also shows the asset hit above.
- `/app/memory/v58_13_132by_02_search_by_card.jpeg` — typed `21317`, ⌘K quick-jump shows related pre-start hits from documents that reference card 21317. Register table returns 0 vehicles because vehicle XT96AZ has no formal `smartfill_card_number` set on the asset record — the SmartFill matcher's `asset_id` link is per-transaction only. Formal card→vehicle linking (via `POST /cards/{n}/assign` from the SmartFillCardDrawer) will surface XT96AZ here.
- `/app/memory/v58_13_132by_03_zero_match.jpeg` — typed `ZZZZZZ_NOMATCH`, register shows the copy `No vehicles match "ZZZZZZ_NOMATCH" — check the rego or clear the filter.` with a Clear filter button.

Console verification:
```
after typing XT96AZ:  visible regos = ['XT96AZ']
after typing xt96az:  visible regos = ['XT96AZ']       ← case-insensitive
after typing 21317:   visible regos = []               ← card not formally linked
zero-match empty state visible: True
  empty state text: 'No vehicles match "ZZZZZZ_NOMATCH" — check the rego or clear the filter.\nClear filter'
```

## NOT changed
- No changes to left-nav filters (kind, sub_type, navixy, retired).
- ⌘K dropdown UX preserved — `q` state now flows to two consumers, not one.
- No mobile touched.
- Card-number → vehicle formal linking flow (`POST /cards/{n}/assign` in the SmartFillCardDrawer) is the correct upstream fix for Stephen's card search to hit — not in scope here.
- Global fleet-search asset scan still returns doc/pre-start hits for card numbers (that's `search_all`'s job); the register-table `q` is asset-scoped only.

## Backlog carried forward

- Consider a `POST /fleet/register/formalise-card-links` bulk-linker that walks `fuel_transactions` and pushes majority-vote `asset_id` up to `assets.smartfill_card_number` for all currently-inferred pairs. Would make card-number → vehicle search work everywhere without Stephen tapping every card individually. Nomination for `.132bz` or later.
