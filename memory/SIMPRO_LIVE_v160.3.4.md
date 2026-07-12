# v160.3.4a — Simpro ZIP Live Import (Task D · GO LIVE)

**Generated**: 2026-07-12T03:15:55.987101+00:00

**Admin**: `808cb7de-985a-4c49-8554-9c67e5e86313` · **Org**: `3116f250-a4eb-43f3-98a5-2a3656d6cb63`

**Auto-taxonomy step**: created 53 new cert_kinds · merged 0.

---

## Per-worker results

| ZIP | Worker | Predicted (dry-run) | Committed (actual) | Photo | Snapshot |
|---|---|---|---|:---:|---|
| `z0.zip` | DANIEL BUTLER | total=120, attach=0, create=70, hr=9, unm=40 | attached=0, created=105, hr=9, unmatched=5 | ✅ | `ee2d7d76-adfb-44f0-8dd3-e0c816147a3f` |
| `z1.zip` | AARON FOSTER | total=19, attach=2, create=3, hr=6, unm=7 | attached=2, created=10, hr=6, unmatched=0 | ✅ | `61122316-23b6-4884-a953-f13b820d4674` |
| `z2.zip` | AARON HOLMES | total=43, attach=0, create=18, hr=10, unm=13 | attached=0, created=29, hr=10, unmatched=2 | ✅ | `9c8f7e34-055e-4aa1-80c4-eb82b790d228` |
| `z3.zip` | ALEXANDER KINGSTON | total=141, attach=0, create=64, hr=26, unm=50 | attached=0, created=114, hr=26, unmatched=0 | ✅ | `80210c43-c9a4-4650-95d8-12bba6b893bc` |
| `z4.zip` | AMANDA GUY | total=15, attach=0, create=12, hr=1, unm=1 | attached=0, created=13, hr=1, unmatched=0 | ✅ | `d8b493d3-80b7-46d8-a843-5cd03494ed5a` |

---

## Rollback

Each `snapshot_id` above resolves to a `worker_import_snapshots` row with `pre_state` (previous cert/HR IDs + photo) and `post_ids` (newly-created IDs).  Delete `post_ids.new_cert_ids`, `new_hr_doc_ids` and `new_unmatched_ids`, then reset the worker's `photo_url` back to `pre_state.photo_url` to fully undo an import.
