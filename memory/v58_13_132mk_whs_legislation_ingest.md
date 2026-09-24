# v58.13.132mk — WHS legislation ingest (Phase 1) + `.132mj` licence parser

**Ship class:** Backend feature (new module) + bundled parser extension
**Type:** Backend-only new code; frontend version pill only
**Status:** SHIPPED (see /migration section for restart implications)
**Baseline:** `.132ml` (`.132mk` letter comes before, but chronology is
`.132ml → .132mk` — user shipped small hide-feature ship first)

## Bundled scope (2 parts)

### Part A — `.132mj` spaced-DMY licence-ticket parser
- New family added to `backend/filename_expiry.py`:
  `EXP\s+(\d{1,2})\s+(\d{1,2})\s+(20\d{2})` (case-insensitive, DMY order)
- Fallback chain: `dotted → compact → monthname → spaced_dmy`
- `_STRIP_JUNK_RE` extended with the new arm so `display_name` strips
  the expiry clause + surrounding separators.
- Validation via `datetime.date()` — invalid combos (day 32, month 13,
  29 Feb non-leap year) return `None` and the row stays unparseable.

### Part B — WHS legislation ingest, Phase 1
- Fetches Tas WHS Act 2012 + WHS Regs 2022 HTML from
  `legislation.tas.gov.au`, and every PDF linked on
  `worksafe.tas.gov.au/topics/laws-and-compliance/codes-of-practice`
  (all hosts, includes Safe Work Australia model COPs Tas has adopted).
- Parses sections, chunks >8 KB blocks on paragraph boundaries,
  writes rows to Mongo `whs_legislation`.
- **Read-only reference lookup** — no writes back to the sources, no
  workflow integration, no editing. Per user brief: "the OH&S feature
  is only information related enquiry".
- **`embedding: null` on every row.** Phase 2 will backfill. Schema
  ready — no migration needed later.

## Files touched

### New backend module: `backend/whs_legislation/`
- `__init__.py` — module marker + phase roadmap.
- `parser.py` — BS4 HTML walker + PyMuPDF PDF walker; chunker helper.
- `ingest.py` — orchestration, progress tracking, idempotent upsert.
- `embed.py` — Phase 1 stub (returns None). Phase 2 replaces internals.
- `api.py` — three admin endpoints under `/api/legislation/*`.

### Modified files
- `backend/filename_expiry.py` — spaced-DMY parser family (Part A).
- `backend/server.py` — mount `whs_legislation_router`; wire
  `ensure_indexes()` into `on_startup`.
- `backend/requirements.txt` — appended `beautifulsoup4==4.15.0`
  (transitive `soupsieve 2.10` also installed).
- `frontend/src/lib/version.js` — header `.132ml → .132mk` + changelog.
- `frontend/public/service-worker.js` — cache version bump.

## Mongo schema

### `whs_legislation` (one row per section or chunk)
```
{
  id: uuid,
  doc_id: str,           // "tas-whs-act-2012", "tas-whs-reg-2022", "cop-<slug>"
  doc_type: "act" | "regulation" | "code_of_practice",
  doc_title: str,
  doc_source_url: str,
  doc_revision_date: iso,
  section_number: str,   // "s.19", "COP§4.2", "COP§page-3" (fallback)
  section_title: str,
  section_text: str,
  section_html: str,     // populated for HTML source only
  parent_section: str,   // "Part 3" or "Part 3 > Division 2"
  full_path: str,        // "Part 3 > Division 2 > s.19 Primary duty of care"
  chunk_suffix: str,     // "" or "_chunk_N" for oversized sections
  embedding: null,       // Phase 2 populates
  last_ingested_at: iso,
  ingest_run_id: uuid
}
```

**Indexes**
- Unique compound `(doc_id, section_number, chunk_suffix)` — enforces
  idempotent upsert.
- `(doc_type)` for filtered listings.
- `(ingest_run_id)` for post-run stale-purge queries.
- Text index on `(section_title, section_text)` — Phase 2 hybrid search.

### `whs_legislation_ingest_runs`
Per-run progress: `run_id`, `state`, `docs_planned`, `docs_processed`,
`sections_processed`, `errors[]`, `per_doc[]`, `started_at`, `updated_at`,
`completed_at`. Unique index on `run_id`.

## Admin endpoints

- `POST /api/legislation/reingest` → `{run_id, state: "started"}`.
  Refuses (409) if another run is active.
- `GET /api/legislation/reingest/status?run_id=…` → live progress.
  Empty run_id returns most recent run.
- `GET /api/legislation/sources` → per-doc summary (title, url,
  last_ingested_at, section_count).

## Idempotency rules

- Each run uses a fresh `ingest_run_id`.
- After per-doc write completes, rows for that `doc_id` with a
  different `ingest_run_id` are deleted → clean stale rows.
- **If a source URL is unreachable, existing rows for that doc are
  NOT deleted.** Failed docs surface in `errors[]`; successful docs
  proceed. No cascade damage.
- Parallel runs blocked — `start_run()` refuses when any run is
  `starting` / `running` and updated within the last 30 min.

## Ban discipline

- No `/app/mobile/*` touch.
- No `testing_agent` call.
- No `finish` tool call.
- Explicit `git add <file>` per touched path (no `-A`, no `commit -a`).
- Parallel-actor files (`craco.config.js` and its `.bak_ticket*`)
  intentionally left unstaged.

## Migration status implications

Backend restart triggered by `server.py` edit + `whs_legislation/`
package addition. Sequence:

1. Pre-ship: migration `copy-19a839780d6f` running (~65 files/h),
   resumed from the .132mh-era `copy-4bf7807b3d19` earlier this ship.
2. Backend hot-reload on ship → migration marked `interrupted` by the
   `.132mg` `sweep_zombie_migration_runs()` startup hook.
3. Post-ship: manual `POST /api/dropbox/migration/{new_run_id}/resume`
   fired → new run_id reported inline in the ship response.
4. `.132mm` (watchdog, immediate follow-up) will auto-heal steps 2/3
   from every future restart forward.

## Future work

Per user request, called out here so future ships don't re-invent:

- **Phase 2** — add embeddings (OpenAI `text-embedding-3-small` via
  Emergent LLM key), semantic search, Ask Intelligence chat integration.
  Reingest endpoint (`POST /api/legislation/reingest`) will trigger
  BOTH text-only refresh (existing Phase 1 code) AND embedding refresh
  (new Phase 2 code) once Phase 2 lands — schema is ready for that
  (embedding field exists, dimension = 1536 already documented in
  `embed.py`).
- **Phase 3** — mauve-themed web UI for the lookup. Frontend page +
  navigation entry + search UX. Backend gains a `GET /api/legislation/
  search?q=…` endpoint that returns top-k hits (text + vector hybrid).

## Post-ship verification (see ship response for numbers)

1. Backend reachable, `on_startup` completed → indexes created.
2. `POST /api/legislation/reingest` returns fresh run_id.
3. `GET /api/legislation/reingest/status?run_id=…` progresses
   `starting → running → completed`.
4. `db.whs_legislation.countDocuments()` non-zero.
5. `db.whs_legislation.findOne({section_number: "s.19"})` returns a
   plausible "Primary duty of care" row.
6. Migration resume confirmed with new run_id + health snapshot
   inline.
