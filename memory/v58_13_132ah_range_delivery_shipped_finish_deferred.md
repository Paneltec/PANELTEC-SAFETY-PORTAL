# v58.13.132ah — Range-aware APK delivery + landing page hardening

**Ship status:** SHIPPED (finish deferred).
**Comms Safe Mode:** ON (unchanged).
**Mobile bundle:** unchanged (`MOBILE_BUNDLE_VERSION = paneltec-v160.3.9.58.13.132ag`). This batch is web + backend only — no APK rebuild needed.

---

## Root cause of the 12.57 MB truncation

`.132ag` served the APK via `FastAPI.FileResponse`. In this deployment (Cloudflare ingress + platform CORS middleware) the response did **not** advertise `Accept-Ranges: bytes` and did **not** honor incoming `Range:` headers — proven by curl (`Range: bytes=100000000-100050000` → HTTP/2 200 with full body, no 206, no `Accept-Ranges`).

Android's system Download Manager (used by Chrome, WebView, and any in-app download) chunks large downloads and depends on `Range` requests to resume after network hiccups / cellular handoffs / screen-lock power-save. Without Range support the download stalls on the first hiccup and freezes at whatever partial byte count made it through the initial burst — commonly 10–15 MB on 4G, matching Stephen's observed 12.57 MB.

Server-side file integrity was fine throughout: on-disk 120,565,090 bytes, SHA `d3b584fd…c3c`, delivered whole to any Range-agnostic client on a stable link.

---

## Changes shipped

### 1. `/app/backend/mobile_downloads.py` — full rewrite
- `Accept-Ranges: bytes` on **every** response (200, 206, 416).
- No `Range` header → `200 OK`, streamed via `StreamingResponse` in 1 MiB chunks (`_CHUNK = 1024 * 1024`).
- Valid `Range: bytes=<start>-<end?>` → `206 Partial Content` with `Content-Range: bytes <start>-<end>/<file_size>`, streamed slice.
- Malformed range (e.g. `bytes=abc-xyz`, multi-range, suffix-length) → `416 Requested Range Not Satisfiable` with `Content-Range: bytes */<file_size>`.
- Unsatisfiable range (start past EOF, end < start) → `416`.
- End clamped to `file_size - 1` if the client asks past EOF (RFC 7233 compliant).
- All `X-Paneltec-Version`, `X-Paneltec-Version-Code`, `X-Paneltec-SHA256`, `Content-Disposition`, `Cache-Control` headers preserved on both 200 and 206.
- `/version` endpoint unchanged.

### 2. `/app/frontend/src/pages/OnboardMobileLanding.jsx` — `AndroidPanel` upgrade
- Fetches `/api/mobile/downloads/android/version` on mount; falls back to `~115 MB` if unreachable.
- **File size strip** (`data-testid="android-file-size"`): shows `~<N> MB` derived from manifest.
- **SHA prefix** (`data-testid="android-file-sha"`): first 8 hex chars of the SHA-256 so the user can eyeball-verify.
- **Amber Wi-Fi warning box** (`data-testid="android-wifi-warning"`): "Please download on Wi-Fi. A 115 MB download on mobile data often fails partway. If your download completes at less than 115 MB, retry on Wi-Fi." (Wifi icon from lucide-react.)
- **Retry link** (`data-testid="android-retry-link"`): "Download stalled? Tap here to retry" — bumps a `nocache` timestamp and re-triggers the download at `?nocache=<ts>` so Chrome cannot resume from a poisoned partial cache entry.
- iOS + desktop branches untouched.
- Existing "allow install from unknown sources" note preserved.

### 3. Version bumps
- `frontend/src/lib/version.js` → `RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132ah'`
- `frontend/src/lib/version.js` → `EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ah'` (bumped from `.132af`)
- `frontend/public/service-worker.js` → `CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ah'` (bumped from `.132af`)
- `mobile/src/lib/version.ts` → `MOBILE_BUNDLE_VERSION` unchanged (`paneltec-v160.3.9.58.13.132ag`).

### 4. Tests — `/app/backend/tests/test_v58_13_132ah_range_delivery.py`
6 new pytest asserts, all passing:

```
tests/test_v58_13_132ah_range_delivery.py::test_full_download_advertises_range_and_streams_entire_file PASSED
tests/test_v58_13_132ah_range_delivery.py::test_range_first_1024_bytes_returns_206_with_content_range PASSED
tests/test_v58_13_132ah_range_delivery.py::test_range_last_10_bytes_returns_206_tail_slice PASSED
tests/test_v58_13_132ah_range_delivery.py::test_range_beyond_eof_returns_416_not_satisfiable PASSED
tests/test_v58_13_132ah_range_delivery.py::test_malformed_range_header_returns_416 PASSED
tests/test_v58_13_132ah_range_delivery.py::test_version_endpoint_still_returns_manifest PASSED
============================== 6 passed in 0.25s ===============================
```

---

## Curl verification (internal `localhost:8001` + external Cloudflare)

**Internal, no Range → 200:**
```
HTTP/1.1 200 OK
accept-ranges: bytes
content-length: 120565090
content-type: application/vnd.android.package-archive
x-paneltec-sha256: d3b584fd38310b46743c1958be4ee6874bbfe32dfc47eb02efeffda6c1532c3c
size=120565090   code=200
```

**Internal, `Range: bytes=0-1023` → 206:**
```
HTTP/1.1 206 Partial Content
accept-ranges: bytes
content-length: 1024
content-range: bytes 0-1023/120565090
size=1024   code=206
```

**Internal, `Range: bytes=120565080-120565089` (last 10 bytes) → 206:**
```
HTTP/1.1 206 Partial Content
content-length: 10
content-range: bytes 120565080-120565089/120565090
size=10   code=206
```

**Internal, `Range: bytes=99999999999-` → 416:**
```
HTTP/1.1 416 Requested Range Not Satisfiable
content-range: bytes */120565090
accept-ranges: bytes
```

**Internal, `Range: bytes=abc-xyz` (malformed) → 416:**
```
HTTP/1.1 416 Requested Range Not Satisfiable
content-range: bytes */120565090
```

**External Cloudflare, full download → 200:**
```
HTTP/2 200
accept-ranges: bytes                            ← NEW (was missing on .132ag)
content-length: 120565090
x-paneltec-sha256: d3b584fd38310b46743c1958be4ee6874bbfe32dfc47eb02efeffda6c1532c3c
size=120565090   code=200
sha256 of downloaded body: d3b584fd38310b46743c1958be4ee6874bbfe32dfc47eb02efeffda6c1532c3c  ✓ matches
```

**External Cloudflare, `Range: bytes=0-1023` → 206:**
```
HTTP/2 206                                       ← NEW (was 200 with full body on .132ag)
accept-ranges: bytes
content-length: 1024
content-range: bytes 0-1023/120565090
size=1024   code=206
```

Cloudflare correctly proxies both the `Range` request header and the `206`/`Content-Range` response headers now that the origin advertises range support. Root cause fully closed.

---

## Screenshot

`/tmp/onboard_android_132ah.png` — Android branch of `/m/onboard/:token`:
- Header: PANELTEC CIVIL · FIELD APP · ONBOARDING (unchanged).
- Welcome, Stephen (`state.first_name` populated).
- FOR ANDROID card:
  - File size / Verify strip: `~115 MB` · `d3b584fd…`
  - Amber Wi-Fi warning box (visible & rendered correctly with `<Wifi>` icon).
  - Green "Download & install" button.
  - "Download stalled? Tap here to retry" link (`data-testid="android-retry-link"`).
  - Existing "unknown sources" copy preserved.
  - "Already installed? Open in app" button preserved.
  - 3-step numbered list preserved.

Rendered on 420×900 mobile viewport with Android UA spoof.

---

## User instructions for Stephen (relay verbatim)

> 1. Get on Wi-Fi (not mobile data) if you're not already.
> 2. Re-scan the same onboarding QR — URL unchanged.
> 3. Landing page now shows the expected file size (~115 MB) and a SHA prefix (`d3b584fd…`) so you can eyeball-verify a completed download.
> 4. Tap **Download & install**. With the new Range-aware handler, Chrome's Download Manager can now resume automatically after any cellular hiccup — the download should complete correctly.
> 5. If Chrome pauses or stalls, tap the small **"Download stalled? Tap here to retry"** link below the green button — that cache-busts the URL and forces a fresh start rather than resuming from a poisoned partial.
> 6. Install → open the app → set your PIN → done.
> 7. Sanity check post-download: the file should be ~115 MB and its SHA-256 should start with `d3b584fd`. If either doesn't match, retry on Wi-Fi.

---

## Deferred / follow-ups (NOT in this batch)

- **Object Storage / S3 migration** for the APK — would also clear one of the parked `ephemeral-upload-storage` lint warnings (`backend/mobile_downloads.py` is not currently flagged, but the sibling upload paths remain). Parked for v58.14.x with the other ephemeral storage cleanup.
- **Post-install SHA-256 auto-verify** on the Android side — needs Android intent + reflection access, out of scope for a landing-page-level fix.
- **Play Store publish** — still gated on Play Console setup (existing `TODO(play-store-id)` preserved at line 39 of `OnboardMobileLanding.jsx`).

## Standing backlog (unchanged)

- Add multi-select rows + "Print selected cards" button to Workers tab (P2).
- Add BOM forecast max/min + rain probability to mobile home (P2).
- Add Details modal for accepted-job hero "Details" button (P2).
- iOS TestFlight wire-up for landing page (waiting on Apple Developer account) (P2).
- SmartFill API auto-sync pipeline validation (P1).
- Invite email flow — dead-ends because comms_safe_mode blocks M365 (P2).

---

## Files touched

- `backend/mobile_downloads.py` (rewrite — range-aware `StreamingResponse`)
- `backend/tests/test_v58_13_132ah_range_delivery.py` (new — 6 asserts)
- `frontend/src/pages/OnboardMobileLanding.jsx` (AndroidPanel + header comment)
- `frontend/src/lib/version.js` (`RUNNING_VERSION`, `EXPECTED_CACHE_VERSION`)
- `frontend/public/service-worker.js` (`CACHE_VERSION`)
- `memory/v58_13_132ah_range_delivery_shipped_finish_deferred.md` (this memo)

Zero mobile / `/app/mobile/` code touched. Zero DB migrations. Zero new dependencies.
