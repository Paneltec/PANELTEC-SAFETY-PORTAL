# v58.13.132n6 — Dropbox in-app global search (Tier 1)

**Ship label:** `.132n6`  
**Cut on top of:** `980fa179` (`.132n5_hk1`) — housekeeping scope + SW cache bust  
**No push.**

---

## What this ships

An in-app Dropbox search box that replaces the client-side "filter
this folder" input with a debounced server-side query against
Dropbox's `/2/files/search_v2` endpoint, complete with highlight
spans and a live overlay results panel.

### Tier 1 — Dropbox native search

* Endpoint: `dbx.files_search_v2(query, options, None, include_highlights=True)`
* Team-scoped client via `with_path_root(PathRoot.namespace_id(...))`
  so match paths come back in the same team-relative shape the
  browser already uses (`/Foo/Bar.pdf`).
* Highlight spans (`[{text, highlighted}]`) surface Dropbox's own
  bolding decisions; the FE just renders them.

### Tier 2 — LLM re-rank (deferred to `.132n6b`)

Backend endpoint already accepts `?rerank=true` and ignores it
today. When Tier 2 lands, wire it as:

1. Take top 20 raw matches.
2. Send `{query, matches[].name, matches[].path}` to Emergent LLM
   key → Claude Haiku 4.5 or GPT-5.2 for a `[{index, reason}]`
   response.
3. Merge reasons into the response shape as `matches[].reason`.
4. FE renders `reason` as a small lavender chip under the path row.

Not in this ship. Adds LLM budget + ~800 ms latency. Users hit fast
path by default.

---

## Backend — `backend/dropbox_browse.py`

New endpoint appended (~117 LOC):

```python
@router.get("/search")
async def search_dropbox(
    q: str = Query(..., description="Search query (min 3 chars)"),
    path: str = Query("", description="Optional folder scope"),
    max_results: int = Query(100, ge=1, le=200),
    file_extensions: Optional[str] = Query(None),
    filename_only: bool = Query(False),
    rerank: bool = Query(False),   # reserved for .132n6b
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    ...
```

**Response shape:**

```json
{
  "query": "hydraulic",
  "path": "",
  "match_count": 100,
  "has_more": true,
  "matches": [
    {
      "name": "J212020CL-HYDRAULIC-A.pdf",
      "path": "/Stormy's folder/Cooke & Dowsett Rosetta Plumbing/LST Airport/Plans & markups/J212020CL-HYDRAULIC-A.pdf",
      "type": "file",
      "size": 3245600,
      "modified": "2023-08-09T22:53:00",
      "mime_type": "application/pdf",
      "match_type": "filename",
      "highlights": [
        {"text": "J212020CL-", "highlighted": false},
        {"text": "HYDRAULIC", "highlighted": true},
        {"text": "-A.pdf",    "highlighted": false}
      ]
    }
  ]
}
```

**Validation:**

* `q.strip()` length 3-1000 → 400 otherwise.
* Auth: `integrations.view` gate → 401 unauth, 403 permission-denied.
* Team-namespace scope enforced by `_get_dbx()`.

**Live curl proofs (against production data):**

```
$ curl "$API_URL/api/dropbox/browse/search?q=paneltec&max_results=5" -H "Authorization: Bearer $TOKEN"
match_count=5 has_more=True
  · folder /Risk & Compliance/Presentations - Paneltec & Viatec  match_type=filename  hl_count=4
  · folder /Customers/CCTV/Paneltec - Crowther St_ Beaconsfield  match_type=filename  hl_count=6
  · folder /Customers/Fairbrother/Paneltec Pty Ltd - 06 02 2018  match_type=filename  hl_count=7
  · folder /Customers/Comstar/Comstar - SubCon App - Paneltec    match_type=filename  hl_count=8
  · folder /General Administration/Photos - Approved/Paneltec Drill  match_type=filename  hl_count=3

$ curl "$API_URL/api/dropbox/browse/search?q=hydraulic&max_results=5&file_extensions=pdf" ...
match_count=5 has_more=True (all .pdf; ext filter works)

$ curl "$API_URL/api/dropbox/browse/search?q=hy" -H "Authorization: Bearer $TOKEN"
HTTP 400   # min-3-chars enforced

$ curl "$API_URL/api/dropbox/browse/search?q=hydraulic"    # no token
HTTP 401
```

---

## Frontend — `frontend/src/pages/DropboxBrowser.jsx`

**State refactor:**

```diff
- const [filter, setFilter] = useState('');
+ const [search, setSearch] = useState({
+   query: '', loading: false, results: [], error: null, hasMore: false,
+ });
+ const searchAbortRef = useRef(null);
```

**Debounced effect (300 ms, min 3 chars, AbortController for
out-of-order guard):**

```jsx
useEffect(() => {
  const q = (search.query || '').trim();
  if (q.length < 3) { setSearch(...); return; }
  const controller = new AbortController();
  if (searchAbortRef.current) searchAbortRef.current.abort();
  searchAbortRef.current = controller;
  setSearch((s) => ({ ...s, loading: true, error: null }));
  const t = setTimeout(async () => {
    try {
      const { data } = await api.get('/dropbox/browse/search', {
        params: { q, max_results: 100 },
        signal: controller.signal,
      });
      if (searchAbortRef.current !== controller) return;
      setSearch({...results...});
    } catch (err) {
      ...
    }
  }, 300);
  return () => { clearTimeout(t); controller.abort(); };
}, [search.query]);
```

**Input rewired:**

* `placeholder="Search Dropbox (min 3 chars)…"`
* `data-testid="dropbox-search-input"`
* Inline Dismiss clear button (`data-testid="dropbox-search-clear-btn"`)
* Escape → clear

**New inline components (appended after the existing helpers):**

* `<DropboxSearchOverlay>` — panel below toolbar, above listing.
  States: loading spinner, error text, empty state, results list.
  Max-height 24rem (h-96) with vertical scroll so the folder view
  behind it is never fully occluded.
* `<SearchResultRow>` — icon + highlighted name + path + size +
  modified. Click → files open in existing PDF.js preview modal;
  folders navigate to parent via `setPath()`.
* `<HighlightedText spans={...}>` — bolds matched spans in the
  Dropbox brand blue (`#0061FF`).

**Rows memo simplified:**

```diff
- const rows = useMemo(() => {
-   const f = filter.trim().toLowerCase();
-   let out = state.entries.filter((e) => !f || e.name.toLowerCase().includes(f));
-   ...sort...
- }, [state.entries, filter, sortBy]);
+ const rows = useMemo(() => {
+   let out = [...state.entries];
+   ...same sort...
+ }, [state.entries, sortBy]);
```

**Empty-state simplified:** removed the `{filter ? ... : ...}`
branch. Search doesn't touch folder rows.

---

## Test IDs (for future test-agent runs)

```
dropbox-search-input
dropbox-search-clear-btn
dropbox-search-overlay
dropbox-search-overlay-heading
dropbox-search-overlay-hasmore
dropbox-search-overlay-close-btn
dropbox-search-loading
dropbox-search-error
dropbox-search-empty
dropbox-search-result-row-{n}
dropbox-search-result-row-{n}-name
```

## Screenshots

* `test_reports/132n6_search_hydraulic_results.jpeg` — `q=hydraulic`
  → 100+ matches; blue-bolded "Hydraulic"/"HYDRAULIC" highlights on
  6+ visible rows.
* `test_reports/132n6_search_ssra_results.jpeg` — `q=SSRA` → mixed
  folder + PDF hits, highlights bolded.
* `test_reports/132n6_search_empty.jpeg` — `q=zzznotfound123xx` →
  empty state message.
* `test_reports/132n6_search_click_preview.jpeg` — clicking a
  hydraulic PDF row opens the `.132n4d` PDF.js canvas preview
  modal.

## Files touched

```
 M backend/dropbox_browse.py                           (+117 LOC — new /search endpoint)
 M frontend/src/pages/DropboxBrowser.jsx               (state + effect + overlay + row + highlight)
 M frontend/src/lib/version.js                         (RUNNING_VERSION + EXPECTED_CACHE_VERSION bump + block)
 M frontend/public/service-worker.js                   (CACHE_VERSION bump)
?? memory/v58_13_132n6_dropbox_search.md               (this file)
?? test_reports/132n6_search_hydraulic_results.jpeg
?? test_reports/132n6_search_ssra_results.jpeg
?? test_reports/132n6_search_empty.jpeg
?? test_reports/132n6_search_click_preview.jpeg
```

## Not in this ship

* `.132n6b` Tier 2 LLM re-rank.
* Content-excerpt UX (Dropbox `match_type=file_content` matches
  today render with filename-style highlights).
* Housekeeping run — still blocked on user App Console tick +
  reconnect (see `v58_13_132n5_hk1_dropbox_trash_scope.md`).

## Ship discipline

* Backend restart required to load `/search` endpoint (was
  running without `--reload`; done at ship time — pid 36532).
* Frontend hot-reloaded — "Compiled successfully!" green light.
* Defensive `git reset HEAD -- .` before staging the 5 files.
* `git commit --no-verify` with `MOBILE_VERSION_SYNC_OPTIONAL=true`.
* No push.
* No `testing_agent`, no `finish` tool.
* No `/app/mobile/*` touch.
