# v58.13.132ep — Quick Links polish (reposition + auto-icon) · SHIPPED

**Ship type:** UX polish + additive backend endpoint
**Version:** `.132eo` → `.132ep` on `frontend/src/lib/version.js` (both `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION`) and `frontend/public/service-worker.js` (`CACHE_VERSION`). Mobile stays at `.132di`.

## What shipped

### Item 1 — Quick Links repositioned ABOVE the Organisation section

- On `frontend/src/pages/OrgSettings.jsx`, `<QuickLinksSection />` was previously rendered at the very bottom of the page (below `<ArchiveRulesSection />`). It's now mounted immediately below the read-only banner and **above the Importance banner + the Identity/Organisation section cards** (Identity, Registered address, Contact & emergency, PDF report branding, Insurance policies).
- Old bottom mount removed — no double render.
- Still admin-gated: `{isAdmin && <QuickLinksSection />}`.

### Item 2 — Auto-fetch company logo

**Backend (`backend/org_url_tiles.py`)**
- New endpoint `POST /api/org/url-tiles/fetch-icon` — admin-only, payload `{"url": "https://..."}`, returns `{"icon_url": "https://…", "source": "apple-touch-icon" | "icon" | "og:image" | "favicon", "cached": bool}` or `{"icon_url": null, "cached": bool}` on total failure.
- Extraction priority in `_parse_head_icons()`:
  1. `<link rel="apple-touch-icon">` (highest-quality — 180×180+; picks the largest `sizes` attr on tie).
  2. `<link rel="icon">` (picks the largest `sizes` attr; `sizes="any"` wins as SVG hint).
  3. `<meta property="og:image">`.
  4. `<origin>/favicon.ico` fallback (HEAD then GET).
- **SSRF hardening**:
  - `_sanitize_url()` reused from `.132eo` — rejects `javascript:` / `file:` / `data:` / `about:` / `mailto:` / protocol-relative / URLs with embedded credentials.
  - `_reject_private_host()` refuses `localhost`, resolves the target hostname via `socket.getaddrinfo`, and rejects any resolved address flagged by `ipaddress` as `is_private` / `is_loopback` / `is_link_local` / `is_multicast` / `is_reserved`.
- **DoS hardening**:
  - httpx `Timeout(5.0)` total on every outbound request.
  - Custom `User-Agent: PaneltecCivil-QuickLinks/1.0 (+https://paneltec.com.au)`.
  - Streamed body read capped at 10 MB (`_FETCH_MAX_BYTES`) — raises HTTP 400 if a hostile response exceeds the cap partway through.
- **In-process cache** — `_ICON_CACHE` dict keyed on the sanitised URL, TTL 24 h (`_ICON_CACHE_TTL_SECONDS`). Second request within the window returns the cached body with `cached: true`. No disk writes anywhere.
- New optional field `remote_icon_url` on the tile model (`TileIn`, `TilePatch`, `_out` all extended). `_sanitize_optional_icon_url()` reuses the strict http/https URL guard. Empty string on PATCH clears the field to `null`.
- The extension is idempotent for pre-.132ep tiles — `_out()` reads `doc.get("remote_icon_url")` which returns `None` on rows without the field.

**Frontend (`frontend/src/components/QuickLinksSection.jsx`)**
- **Auto-fetch on blur** — the editor's URL input carries an `onBlur={runIconFetch}` handler. On blur, the client validates the URL, calls `POST /org/url-tiles/fetch-icon` (skipped if same URL already resolved), and updates `iconState` through the states `idle → fetching → detected / not_found / error`.
- **"Icon detected" preview strip** — when a detection succeeds, an emerald-tinted panel appears between the URL input and Label input, showing:
  - A 32×32 `<img>` thumbnail of the detected icon (`data-testid="org-quick-links-editor-icon-thumb"`),
  - The source (`via icon · <url>` / `via apple-touch-icon · <url>` / etc.),
  - A **"Use emoji"** clear button (`data-testid="org-quick-links-editor-icon-clear"`) that reverts to the plain emoji fallback.
- **Manual icon URL override** — new "Icon URL override (optional)" input (`data-testid="org-quick-links-editor-remote-icon-url"`) lets the admin paste an arbitrary image URL. Auto-detection populates it; manual override wins.
- **Tile rendering** — both `TilePreviewCard` (section preview grid) and `SortableTileCard` (manager popup grid) now conditionally render an `<img src={tile.remote_icon_url}>` when present. Each `<img>` carries `onError={() => setImgError(true)}` which cleanly falls back to the emoji `icon` field if the remote asset 404s / times out / is CORS-blocked. The plain emoji fallback is preserved unchanged for tiles without a `remote_icon_url`.
- The emoji field is now labelled **"Icon / emoji (fallback)"** to clarify its role.

## Files touched

- `backend/org_url_tiles.py` — extended: `_sanitize_optional_icon_url`, `_reject_private_host`, `_parse_head_icons`, `_http_get_capped`, `_fetch_icon`, `IconFetchIn`, `POST /fetch-icon`; `remote_icon_url` added to `TileIn` / `TilePatch` / `_out` / create / update flows.
- `frontend/src/components/QuickLinksSection.jsx` — extended: `TilePreviewCard` + `SortableTileCard` now render remote icon with fallback; `TileEditor` gains auto-fetch, preview, manual override.
- `frontend/src/pages/OrgSettings.jsx` — repositioned `<QuickLinksSection />` above the Identity section, removed the old bottom mount.
- `frontend/src/lib/version.js` — bumped `.132eo` → `.132ep` on both fields.
- `frontend/public/service-worker.js` — bumped `CACHE_VERSION`.
- `backend/tests/test_v58_13_132ep_quick_links_polish.py` — NEW (20 pytest checks).

## NOT changed

- No other Org Settings section touched.
- No other backend router touched — `org_router` / `org_archive_rules_router` untouched.
- No disk writes anywhere. Icon URLs stored as strings in Mongo, cache lives in-process only, images never blob-persisted.
- `/app/mobile/` — untouched. Mobile bundle stays `.132di`.
- Twenty pre-existing `ephemeral-upload-storage` lint warnings — still parked for v58.14.x.
- Existing tiles (without `remote_icon_url`) continue rendering with their emoji fallback — no migration required.

## Pytest evidence

```
$ python -m pytest tests/test_v58_13_132ep_quick_links_polish.py -q
....................                                                     [100%]
20 passed, 1 warning in 3.76s
```

Coverage (20 checks):
- Item 1: `QuickLinksSection` renders above `title="Identity"` on OrgSettings.jsx (position guard) AND above `ArchiveRulesSection` (no leftover bottom mount).
- Backend module: `@router.post("/fetch-icon")` registered + admin-gated + SSRF guards (`_reject_private_host`, `_FETCH_TIMEOUT_SECONDS=5.0`, `_FETCH_MAX_BYTES=10_MB`, `_ICON_CACHE_TTL_SECONDS=24h`).
- Model: `remote_icon_url` present on `TileIn` + `TilePatch` + `_out`.
- **Head parser unit test** — 4×4 fixture confirms priority order (apple-touch-icon → icon (largest sizes) → og:image) and empty-list on no-icon HTML.
- **Timeout branch** — monkeypatched `httpx.AsyncClient` raises `TimeoutException` on every call → `_fetch_icon` returns `{icon_url: null}`.
- **404 with favicon fallback** — mock target returns 404 on the page but 200 on `/favicon.ico` → returns `{icon_url: ".../favicon.ico", source: "favicon"}`.
- **404 with no favicon** — mock target returns 404 everywhere → `{icon_url: null}`.
- **Live-API smokes**: admin-only guard (hseq_lead → 403), localhost + 127.0.0.1 rejected (400), `file:` scheme rejected (400), tile persists `remote_icon_url` on POST + clears on PATCH with empty string.
- FE source-pins: `onBlur={runIconFetch}`, editor `-icon-preview` / `-icon-thumb` / `-icon-clear` / `-remote-icon-url` testids, both grid renderers use `<img src={tile.remote_icon_url}>` with `onError` fallback.
- Version-sync forward-safe `>= .132ep` pin.

Also re-ran `.132eo` + `.132en` suites — **no regressions**:
```
$ python -m pytest tests/test_v58_13_132eo_url_tiles.py tests/test_v58_13_132en_incidents_table_view.py -q
.....sssss....................                                           [100%]
25 passed, 5 skipped in 0.92s
```

(5 skips = the `.132eo` live-API tests deferring under the auth rate-limit; source-pins all green.)

## Curl proof — Westpac + Google + GitHub + SSRF guards

```
# Westpac — real production URL (banking portal)
$ curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"url":"https://banking.westpac.com.au/wbc/banking/handler?TAM_OP=login&segment=personal&logout=false"}' \
    $API/api/org/url-tiles/fetch-icon
{
    "icon_url": "https://banking.westpac.com.au/wbc/banking/Themes/Default/Desktop/WBC/Images/favicon.ico.23fb3f626712cf243b43f34a3e3a8e887b8e8250.ico",
    "source": "icon",
    "cached": false
}

# Google — falls through to /favicon.ico (Google's home page carries no <link rel="icon">)
$ curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"url":"https://www.google.com/"}' $API/api/org/url-tiles/fetch-icon
{
    "icon_url": "https://www.google.com/favicon.ico",
    "source": "favicon",
    "cached": false
}

# GitHub — hits <link rel="icon"> for fluidicon.png
$ curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"url":"https://github.com/"}' $API/api/org/url-tiles/fetch-icon
{
    "icon_url": "https://github.com/fluidicon.png",
    "source": "icon",
    "cached": false
}

# Cache HIT on repeat (second call, same URL, within 24 h)
$ curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"url":"https://www.google.com/"}' $API/api/org/url-tiles/fetch-icon
{
    "icon_url": "https://www.google.com/favicon.ico",
    "source": "favicon",
    "cached": true
}

# SSRF guards — reject localhost + 127.0.0.1
$ curl -s -w "\nHTTP=%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"url":"http://localhost:8001/"}' $API/api/org/url-tiles/fetch-icon
{"detail":"Refusing to fetch localhost"}
HTTP=400

$ curl -s -w "\nHTTP=%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"url":"http://127.0.0.1/"}' $API/api/org/url-tiles/fetch-icon
{"detail":"Refusing to fetch host resolving to 127.0.0.1"}
HTTP=400

# Reject file: scheme (belt-and-braces on the sanitiser)
$ curl -s -w "\nHTTP=%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"url":"file:///etc/passwd"}' $API/api/org/url-tiles/fetch-icon
{"detail":"URL scheme must be http or https (got 'file')"}
HTTP=400
```

**Westpac icon URL (verbatim from the endpoint):**
```
https://banking.westpac.com.au/wbc/banking/Themes/Default/Desktop/WBC/Images/favicon.ico.23fb3f626712cf243b43f34a3e3a8e887b8e8250.ico
```
This resolves to Westpac's red-W favicon — visible in the "before/after" screenshot below as a real branded icon on the Quick Links preview tile.

## Screenshots

- **`/app/memory/v58_13_132ep_quick_links_above_organisation.png`** — Organisation page scrolled to the top. Order (top → bottom):
  1. `Back to Settings` breadcrumb + `Organisation` PageHeader + `Save changes` button.
  2. **Quick Links section** with `Manage tiles` button and 5-tile preview grid (Westpac Banking with the red W favicon rendered by `<img src=remote_icon_url>`, plus the four previously-seeded emoji-fallback tiles).
  3. Green "Important" banner ("This information appears on PDF reports, audit exports, renewal emails…").
  4. **Identity** section (Organisation name, Trading name, ABN, Slug, Timezone) — now sitting BELOW Quick Links, as requested.
  Sidebar version pill reads `v160.3.9.58.13.132ep`.

- **`/app/memory/v58_13_132ep_editor_icon_detected.png`** — Add tile popup with URL `https://github.com/` entered and blurred. Between the URL input and Label input, the emerald **"Icon detected"** preview strip shows the GitHub `fluidicon.png` thumbnail, the metadata line `via icon · https://github.com/fluidicon.png`, and a "Use emoji" clear button. Icon URL override field auto-populated to the same URL.

## How to verify (manual)

1. Log in as admin.
2. Navigate to **Settings → Organisation**.
3. The **Quick Links** section is now the first block after the page title — above Identity + Insurance + everything else.
4. Click **Manage tiles** → **Add tile**. Type `https://banking.westpac.com.au/wbc/banking/handler?TAM_OP=login...` in URL → tab or click into the Label field.
5. Emerald "Icon detected" strip should appear with the Westpac red-W thumbnail and the `via icon · …` source line.
6. Click "Use emoji" → strip disappears, emoji fallback re-enabled.
7. Re-enter the URL, blur again → strip reappears (24 h cache hit, response returns fast).
8. Fill in Label "Westpac Banking" + optional emoji "🏦" → Save → tile renders in the preview grid with the red-W `<img>` icon (not the emoji).
9. If the remote image ever fails to load (network / CORS / 404), the tile's `onError` handler transparently falls back to the emoji.

## Rules compliance

- ✅ No `finish` invoked.
- ✅ No `testing_agent` / `e1_tester` invoked.
- ✅ No files under `/app/mobile/` touched. Mobile bundle stays at `.132di`.
- ✅ Version bumped `.132eo` → `.132ep` in lockstep on all three canonical strings.
- ✅ Server-side fetch: **strict 5 s timeout**, custom User-Agent, **10 MB streamed body cap**, SSRF guard rejects loopback / private / link-local / reserved IPs plus `localhost` by name.
- ✅ Non-http/https URLs still rejected at the `_sanitize_url` layer (inherited from `.132eo`).
- ✅ **No new disk writes** — icon URL stored as a string in Mongo, cache lives in-process only, image blob never persisted.
- ✅ Pytest source-pins + live-API smokes + unit tests green (20/20 on `.132ep`, 25 pass + 5 skip on `.132eo`/`.132en`, no regressions).
- ✅ Ship memo committed here (this file).
