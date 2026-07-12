# `workers` schema extension — `simpro_sync_snapshot`

**Cycle**: v160.3.1a Phase B · **Status**: design only — NO Mongo writes yet.
Every write path referenced below will land in Phase C.

## New optional subdoc on `workers`

```jsonc
{
  // existing worker fields unchanged
  "id":                    "…",
  "org_id":                "…",
  "email":                 "…",
  "first_name":            "…",
  "last_name":             "…",
  "simpro_employee_id":    1077,   // already populated on 60/60 workers

  // NEW — hydrated by Phase C /api/integrations/simpro/workers/refresh
  "simpro_sync_snapshot": {
    "simpro_employee_id":  1077,
    "company_id":          "2",              // "2" | "3"
    "last_synced_at":      "2026-07-12T01:42:48Z",
    "source":              "simpro",
    "position":            "Construction Worker L2",
    "archived":            false,

    // PII allowlist — READ gated by require_roles("admin", "hr_lead")
    // Anything outside `pii.*` is safe to expose to worker/read-only roles.
    "pii": {
      "date_of_birth":   "1987-04-08",       // ISO YYYY-MM-DD
      "address": {
        "street":       "65 Galvin Street",
        "city":         "South Launceston",
        "state":        "TAS",
        "postal_code":  "7249",
        "country":      "Australia"
      },
      "emergency_contact": {
        "name":         "Trish Foster",
        "relationship": "Mum",
        "cell_phone":   "0437770650",
        "work_phone":   "",
        "address":      ""
      }
    }
  },

  // EXTENDED — the existing empty-array field gains structured rows
  "certifications": [
    {
      "cert_kind_slug":     "white-card",
      "raw_source_name":    "White Card",
      "ref_number":         "WC-12345",
      "issued_date":        null,
      "expiry_date":        "2027-06-30",
      "source":             "simpro",         // "simpro" | "manual" | "user_upload"
      "simpro_licence_id":  4951,              // idempotency key for upserts
      "attachment_file_id": null               // Phase D bulk-upload will populate
    }
  ]
}
```

## PII gating rules (implemented in Phase C read endpoints)

| Endpoint | `pii.*` visible? |
|---|---|
| `GET /api/workers` (list) | ❌ never |
| `GET /api/workers/{id}` (worker viewing own profile) | ❌ never |
| `GET /api/workers/{id}` (admin / hr_lead) | ✅ yes |
| `GET /api/workers/{id}` (any other role) | ❌ stripped in the response serializer |
| `GET /api/workers/{id}?include=pii=1` | 400 if caller lacks `admin` or `hr_lead` |
| Mobile app profile read | ❌ never — mobile endpoint strips `simpro_sync_snapshot.pii` |

Enforcement lives inside `_serialize_worker(user, doc)` at the API layer — same pattern as the existing `Banking` / `MaskedSSN` gate that is applied even to Simpro's raw employee detail today.

## Seed files staged in `/app/backend/scripts/seed_data/`

| File | Rows | Purpose |
|---|---:|---|
| `cert_kinds_seed.json` | **152** | Canonical cert taxonomy — one row per dedupe'd Simpro name |
| `simpro_licence_mapping_seed.json` | **158** | Raw Simpro name → cert_kind slug (auto or auto_grouped) |

Both are pure files. Phase C's `refresh` endpoint reads them; if either is missing the endpoint returns HTTP 500 with an actionable error.

## Idempotency

Every Phase C write is upsert-only, keyed by:
- `workers.simpro_sync_snapshot` → keyed by `worker.id` (one snapshot per worker)
- `workers.certifications[]` → keyed by `(source, simpro_licence_id)` — Simpro rows dedupe on `simpro_licence_id`; manual rows dedupe on `(source, ref_number)` or `_id` if present.

## Manual-cert merge rule

When Phase C runs against a worker that already has manually-added certifications:
1. Keep every row where `source != "simpro"`.
2. Upsert Simpro rows keyed by `simpro_licence_id`.
3. If a Simpro `cert_kind_slug` matches an existing manual row's `cert_kind_slug` for the same worker, DO NOT collapse them — leave both. Human decides later via a "duplicate detected" pill in the UI.

## Rollback

Every Phase C run writes a snapshot document to a new collection `worker_import_snapshots`:

```jsonc
{
  "id":               "…",
  "org_id":           "…",
  "run_at":           "…",
  "triggered_by":     "user_id",
  "employees_matched": 61,
  "licences_added":    36,
  "pii_fields_added":  172,
  "diffs": [ { "worker_id": "…", "before": {…}, "after": {…} }, … ]
}
```

A companion CLI `python3 backend/scripts/simpro_worker_sync.py --rollback <run_id>` restores the `before` state of every touched worker.
