# v58.13.132u — Card → attribution mapping — DISCOVERY

Status: **investigation only, no writes.** Sits after `.132s` is
shipped. Sources: live Mongo query + static reads of
`backend/fleet_fuel.py`, `backend/fleet_fuel_enrich.py`,
`backend/simpro_workers_shared_fuel_cards.py` (v58.13.131o).

## Q1 — Unique cards + fill counts

- **67 unique `card_number` values** across 547 `fuel_transactions`.
- Every fill has a card_number (0 rows with null).
- Top-heavy distribution: card `21301` (32 fills) → card `21343` (1 fill).
- Full 67-row card ↔ rego ↔ description table dumped inline
  (kept out of memo for length — reproducible via
  `db.fuel_transactions.aggregate({$group:{_id:'$card_number',n:{$sum:1}}})`).

## Q2 — Current attribution state

| Signal | Rows | Notes |
|---|---:|---|
| `fuel_transactions.asset_id` non-null | **499 / 547 (91 %)** | Set by `fleet_fuel.py` enrichment on ingest, matched by `registration` → `assets.rego_serial`. |
| `fuel_transactions.worker_id` non-null | 0 / 547 | Field exists in schema but never populated. |
| `fuel_transactions.driver` non-null | 0 / 547 | SmartFill "Driver Authorisation" column returns empty for this account. |
| `assets.fuel_card_number` field | **does not exist** | No card-level attribution on the vehicle side. |
| `workers.smartfill_card_numbers` field | exists on schema, **0 / 73 workers have it populated** | Added by `.131o` add-on but never back-filled. |
| Dedicated `fuel_cards` collection | **does not exist** | 0 documents. Neither does `fleet_fuel_cards`. |

### Cards attributed to a vehicle (implicit, via rego match)

- **59 cards** land on a live `assets` row (91 % of fills).
- Attribution is *derived at ingest time* from the SmartFill
  `Registration` column, not stored as a card-level fact.

### Cards NOT attributed (48 fills across 8 cards)

Two shapes:

**Shape A — description is a person's name (2 cards):**

| card | fills | description | rego |
|---|---:|---|---|
| `17079` | 7 | Daniel Butler | (none) |
| `7684`  | 2 | Office        | (none) |

**Shape B — description is a vehicle but rego doesn't match any
`assets.rego_serial` (6 cards):**

| card | fills | description | rego (CSV) | Likely cause |
|---|---:|---|---|---|
| `21310` | 4 | Tipper | A42FT | asset missing |
| `21325` | 12 | Ford Ranger | M017HD | O-vs-0 ambiguity? |
| `21327` | 6  | 300 Tipper | C58GA | asset missing |
| `21333` | 5  | Amarok | I56RD | asset missing |
| `21350` | 10 | Service Utility | I53TV | asset missing |
| `21372` | 2  | Iveco | M76FV | asset missing |

## Q3 — Available matching signals

- **SmartFill CSV columns** (13 fields; already imported per fill):
  Card Number, Description, Registration, Driver Authorisation
  (empty in this account), From, Fuel Type, Litres.
- **`assets` collection** (131 rows): `rego_serial` used for rego
  matching. No card_number / fuel_card / smartfill_card field.
- **`workers` collection** (73 rows): `first_name` + `last_name` are
  the fuzzy-match anchor. Empty `smartfill_card_numbers` array field
  ready to be populated.
- **`users` collection** (83 rows): no card-related field.
- **Card-to-description stability:** every card has ONE unique
  description across all its fills (verified — 67/67 cards). Descriptions
  are effectively human-assigned labels that SmartFill echoes back on
  every transaction. Safe to trust as an identity hint.
- **Card-to-rego stability:** every card has ≤1 rego. 65 cards have a
  rego, 2 do not.

## Q4 — Proposed data model

**New `fuel_cards` collection.** Recommended (cleaner separation than
embedding on `assets`/`workers`).

```jsonc
// db.fuel_cards
{
  "id": "uuid",
  "org_id": "uuid",
  "card_number": "21301",                       // unique per org
  "attribution_kind": "vehicle",                // enum: vehicle | worker | shared | unassigned
  "asset_id":  "…uuid…" | null,                 // set iff kind=vehicle
  "worker_id": "…uuid…" | null,                 // set iff kind=worker
  "smartfill_description": "Cappa",             // last-seen echo from SmartFill
  "smartfill_registration": "XT16AB",           // last-seen echo, informational
  "notes": "Shared card — Sydney depot"         // free-text; used for kind=shared
                                                //           and kind=unassigned
  "assigned_by": "user_id",
  "assigned_at": "iso",
  "created_at": "iso", "updated_at": "iso",
}
```

Indexes: `{org_id, card_number}` unique; `{asset_id}`; `{worker_id}`.

**Why not embed on `assets`/`workers`?**
- Cards outlive vehicles (retired truck → card reassigned).
- Cards can be shared (`Office`) — no single asset/worker owner.
- Multi-card workers/vehicles are cleaner as many-to-one via
  `fuel_cards.worker_id`.
- Migration path from empty `workers.smartfill_card_numbers`
  (denorm) into `fuel_cards` is trivial.

**Derived denorm (optional, back-compat):**
- `workers.smartfill_card_numbers` — array, back-filled from
  `fuel_cards.worker_id`. Kept for fast worker-detail views.
- `assets.fuel_card_number` — string, back-filled from
  `fuel_cards.asset_id`.

**Enrichment change:** at ingest, `fleet_fuel.py` looks up
`fuel_cards.card_number` FIRST. If found, stamps `asset_id` /
`worker_id` on the fill immediately. Falls back to rego match if
card unmapped (current behaviour) so existing 91 % coverage stays.

## Q5 — Auto-match heuristics (proposed)

Run on demand ("Auto-match all" button) — write suggestions to a
staging list, admin confirms per-row before commit.

| # | Rule | Confidence | Expected hits (this dataset) |
|---|---|---|---:|
| H1 | `card.rego == asset.rego_serial` exact | **high** | 59 |
| H2 | `card.rego ≈ asset.rego_serial` after `O→0`, `I→1`, strip whitespace | medium | +1–3 |
| H3 | `card.description` fuzzy-match to `workers.first_name + last_name` (Levenshtein ≤ 2 OR token-set-ratio ≥ 90) | medium | 2 (Daniel Butler, others in future exports) |
| H4 | `card.description == "Office"` / "Shared" / "Depot" (case-insensitive) → shared, no owner | manual-review | 1 (card 7684) |
| H5 | Fall-through → `attribution_kind = "unassigned"`, admin picks | n/a | remaining |

## Q6 — Admin UI mockup

Single screen at `/app/settings/fleet/fuel-cards`. Table view.

```
┌─── FUEL CARDS ────────────────────────────────────────────── [Auto-match all] [Save changes (3)] ─┐
│                                                                                                    │
│  Filter: [All]  [Attributed]  [Unattributed (8)]  [Conflicts]      Search: card / rego / name ▢    │
│                                                                                                    │
│  ┌──────────┬──────────┬───────────────────┬─────────┬───────────────────────────┬──────────────┐  │
│  │ Card #   │ Fills    │ SmartFill hint    │ Rego    │ Attribute to              │ Confidence   │  │
│  ├──────────┼──────────┼───────────────────┼─────────┼───────────────────────────┼──────────────┤  │
│  │ 21301    │ 32       │ "Cappa"           │ XT16AB  │ [Vehicle ▾ XT16AB Cappa ]│ auto · high  │  │
│  │ 21314    │ 28       │ "Capvac"          │ XT02AX  │ [Vehicle ▾ XT02AX Capvac]│ auto · high  │  │
│  │ …                                                                                              │  │
│  │ 17079    │ 7        │ "Daniel Butler"   │ —       │ [Worker  ▾ Daniel Butler]│ auto · med   │  │
│  │ 7684     │ 2        │ "Office"          │ —       │ [Shared  ▾ (no owner)   ]│ manual       │  │
│  │ 21310    │ 4        │ "Tipper"          │ A42FT   │ [Unassigned            ▾]│ needs match  │  │
│  │ …                                                                                              │  │
│  └──────────┴──────────┴───────────────────┴─────────┴───────────────────────────┴──────────────┘  │
│                                                                                                    │
│  Legend:  auto·high  auto·med  needs-match  manual                                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Dropdown for "Attribute to" opens a searchable combobox with three
sections (Vehicle · Worker · Shared/Unassigned). Same UX as the
existing `assets` picker in FormBuilder.

### Endpoints (proposed surface)

- `GET  /api/fleet/fuel/cards`
- `POST /api/fleet/fuel/cards/{card_number}` — upsert attribution
- `POST /api/fleet/fuel/cards/auto-match` — run heuristics, return
  staged suggestions (does not write)
- `POST /api/fleet/fuel/cards/bulk-commit` — commit N staged rows

### Kebab actions per row (nice-to-haves)

- **View fills** → opens filtered `FuelReporting` for this card
- **History** → shows previous attribution timeline
- **Unassign** → clears attribution, keeps the card row for future
  reassignment

## Q7 — Implementation phases (proposed for `.132v` and beyond)

- **`.132v` — data layer:** Migration script creates
  `fuel_cards` collection, back-fills 65 rego-matched cards from
  the existing `fuel_transactions.card_number` → `asset_id` join.
  Adds `card_number` unique index. No UI yet.
- **`.132w` — enrichment:** Wire `fleet_fuel.py` ingest to consult
  `fuel_cards` before rego fallback. Adds `worker_id` to
  fuel_transactions when card is worker-attributed.
- **`.132x` — admin UI:** Ship the screen sketched above.
  Auto-match "Save suggestions" + manual override.

## Risks / open questions

- **R-U1** Cards with rego but no matching asset (6 cards, ~37
  fills) — is this a missing-vehicle-in-DB problem, or genuine
  data drift (retired vehicles still logging fills)? Answer needed
  before `.132v` — else the enrichment will keep leaving them
  unattributed.
- **R-U2** Card `17079` — "Daniel Butler". Is Daniel Butler in
  `workers`? If not, is he a contractor / non-employee driver?
  Need his `worker_id` to seed the mapping cleanly. If he isn't
  in the DB, the card is effectively an anonymous-driver card
  and belongs to `attribution_kind='shared'` with a `notes` field
  saying "Daniel Butler".
- **R-U3** Card `7684` — "Office" — pool card. `attribution_kind =
  'shared'` seems correct. Should we track WHICH office (Sydney vs
  Newcastle)? Would need a `workspace_id` on `fuel_cards`.
- **R-U4** Denorm sync — if we mirror to `workers.smartfill_card_numbers`
  and `assets.fuel_card_number`, we need a re-sync path (e.g. every
  time `fuel_cards` is edited, refresh the two mirrors). Trigger
  or explicit call?
- **R-U5** Multi-org — the `fuel_cards` index must be
  `{org_id, card_number}` unique, not `{card_number}` alone, in
  case two tenants share a card-number scheme.

## Files inspected

- `backend/fleet_fuel.py` — `card_number`, `registration`,
  `asset_id` handling on ingest.
- `backend/fleet_fuel_enrich.py` — enrichment pipeline
  (rego → asset match).
- `backend/simpro_workers_shared_fuel_cards.py` (per `.131o` memo)
  — `workers.smartfill_card_numbers` field spec.
- Mongo:  `fuel_transactions`, `assets`, `workers`, `users`,
  `fuel_cards` (empty), `fleet_fuel_cards` (empty).

## Green-light asks

- **U-Q1.** Confirm data model — new `fuel_cards` collection (option B)
  vs embedded fields on `assets`/`workers` (option A)?
- **U-Q2.** Confirm phased plan — `.132v` (back-fill) → `.132w`
  (enrichment) → `.132x` (admin UI). Or bundle as one bigger `.132v`?
- **U-Q3.** Card `17079` (Daniel Butler): is he in `workers`? If yes,
  what's his worker_id / email so we can hard-seed the mapping? If
  no, treat as `shared` with a `notes="Daniel Butler"`?
- **U-Q4.** For the 6 orphan-rego cards (card with rego but no
  matching asset): do you want us to (a) create the missing asset
  rows, or (b) treat them as shared with `notes="see rego X"`, or
  (c) leave `unassigned` for you to fix in the admin UI?
- **U-Q5.** Denorm mirrors — populate
  `workers.smartfill_card_numbers` + `assets.fuel_card_number` at
  every fuel_cards write, or keep the collection as sole source
  of truth?

No writes performed.
