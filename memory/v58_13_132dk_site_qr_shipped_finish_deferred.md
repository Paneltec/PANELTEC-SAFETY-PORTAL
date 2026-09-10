# v58.13.132dk — Site QR Signage PDF — SHIPPED (finish deferred)

## Phase 1 — Investigation

`grep` sweep across `/app/backend/`, `/app/frontend/src/` for `qrcode`, `QRCode`, `qr_code`, `sign-on`, `signon`, `site-qr`, `siteQr`:

| Layer | Existing surface | Status |
|---|---|---|
| **Backend deps** | `qrcode`, `Pillow`, `reportlab` all installed in `backend/requirements.txt`. | ✅ Reusable. |
| **Backend helpers** | `sites_qr.py::_make_qr_png`, `_public_app_url`, `_ensure_scan_token`, `_require_site_admin`, `_site_scan_url`. | ✅ Reusable. |
| **Backend endpoint** | `GET /api/sites/{site_id}/scan-pdf?layout=(gate_sign\|avery)` — admin-gated, generates gate-sign OR Avery-30up layout PDF. | ⚠️ Encodes rotating `scan_token` URL, not the persistent `/sign-on/{site_id}` URL. |
| **Public scan flow** | `sites_qr.py::scan_router` mounts `GET /api/scan/site/{token}/context` + `POST /sign-on` etc. — the actual sign-on UI. | ✅ Untouched by this ship. |
| **Frontend button** | `SitePrintModal` component with existing "Print QR" action — but uses the token-based `/scan-pdf` endpoint. | ⚠️ No persistent-URL button. |
| **Public FE route** | No `/sign-on/{site_id}` route exists — only `/scan/site/{token}`. | ❌ Gap. |

**Gap for `.132dk`**: persistent-`site_id` URL surface (endpoint + button + public resolver). Existing `scan-pdf` surface is **left intact and untouched** — `.132dk` is additive.

## Phase 2 — Build (single-endpoint scope)

Stephen narrowed scope mid-ship to just the **A4 Signage PDF** (dropping the PNG + plain-PDF endpoints). One button, one action, one output.

### Backend (`backend/sites_qr_v132dk.py` — new)

- `GET /api/sites/{site_id}/qr-signage.pdf` — admin-only (`require_permission("sites","view")` + `_require_site_admin`), streams a full-page A4 PDF from an in-memory buffer. Never touches disk.
- `GET /api/sign-on/{site_id}` — **public** persistent resolver. Looks up the site by `site_id`, calls `_ensure_scan_token` (idempotent), returns a `302 → /scan/site/{token}`. Stickers printed once keep working forever regardless of token rotation.
- Missing site → 404 on both endpoints. Soft-deleted sites also 404 on the public resolver so we don't leak org ownership.

### Frontend (`frontend/src/pages/SitesAdmin.jsx::SiteDetail`)

- Header actions row now includes a `<Printer /> Print QR Signage` button (slate-900), admin-gated by `user.role_id === 'admin'`. `data-testid="site-detail-print-qr-signage-<site_id>"`.
- Click → `api.get('/sites/<id>/qr-signage.pdf', {responseType:'blob'})` → `stashInlinePdf` → `window.open`. Reuses the same PDF-preview flow as the existing `Print site QR` button.

### Version bump (3 web files)

- `frontend/src/lib/version.js` → `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` = `paneltec-v160.3.9.58.13.132dk`.
- `frontend/public/service-worker.js` → `CACHE_VERSION` = `paneltec-v160.3.9.58.13.132dk`.
- Mobile bundle stays at `.132di`.

## Pytest lock — 7/7 · Combined 66/66

```
tests/test_v58_13_132dk_site_qr_signage.py::test_only_signage_endpoint_exposed        PASSED
tests/test_v58_13_132dk_site_qr_signage.py::test_frontend_single_button_only          PASSED
tests/test_v58_13_132dk_site_qr_signage.py::test_signage_pdf_admin_200_valid_pdf      PASSED  ← live E2E
tests/test_v58_13_132dk_site_qr_signage.py::test_signage_pdf_unknown_site_404         PASSED
tests/test_v58_13_132dk_site_qr_signage.py::test_public_resolver_302_to_scan_flow     PASSED  ← live E2E
tests/test_v58_13_132dk_site_qr_signage.py::test_public_resolver_unknown_site_404     PASSED
tests/test_v58_13_132dk_site_qr_signage.py::test_three_way_sync_at_132dk_or_later     PASSED
```

Combined suite across `.132de → .132dk`: **66/66 green**.

## Live curl proof

```
$ GET /api/sites/e8014ff0-037e-462f-98fc-4f490e9a78da/qr-signage.pdf
  → HTTP 200 · 21,218 bytes · content-type=application/pdf · body starts %PDF-1.3

$ GET /api/sign-on/e8014ff0-037e-462f-98fc-4f490e9a78da   # no auth
  → HTTP 302 · location=/scan/site/1N0V9GkgGGcc

$ GET /api/sites/unknown/qr-signage.pdf
  → HTTP 404
```

## Screenshot

Rendered `/tmp/132dk_signage.png` — A4 preview of the live PDF for **New Paneltec Depot** (site_id `e8014ff0-037e-462f-98fc-4f490e9a78da`):

- Slate "**SIGN IN HERE**" header band
- Centred QR encoding `https://whs-compliance.preview.emergentagent.com/sign-on/e8014ff0-037e-462f-98fc-4f490e9a78da`
- Site name **New Paneltec Depot** · address `30 Remount Road`
- Instructions *"Scan with your phone camera to sign in for this site."*
- URL in fine print for manual entry
- Orange **PANELTEC CIVIL · WHS COMPLIANCE** footer

## Files touched

- `backend/sites_qr_v132dk.py` (new)
- `backend/server.py` (router mount)
- `frontend/src/pages/SitesAdmin.jsx` (`SiteDetail` — Print QR Signage button + `canGenerateQr` gate)
- `frontend/src/lib/version.js` → `.132dk`
- `frontend/public/service-worker.js` → `.132dk`
- `backend/tests/test_v58_13_132dk_site_qr_signage.py` (new)

## Decisions

- **Persistent URL on `site_id`, not `scan_token`** — the depot-gate sticker is glue and paint; the URL on it must be stable for years. Rotating token stays behind the 302 resolver so we can still invalidate at will without reprinting stickers.
- **Additive to `sites_qr.py`, not a rewrite** — existing `/scan-pdf?layout=(gate_sign|avery)` surface is untouched. Two admins can keep using the token-based flow while others adopt the new persistent one; both work.
- **Public resolver has no auth** — the QR is on a public sticker. We treat missing sites as 404 (not 403) so an attacker with a random site_id can't distinguish "site exists but restricted" from "site doesn't exist".
- **Scope simplification landed mid-ship** — earlier draft exposed `qr.png` + plain-centred `qr.pdf`. Removed cleanly before commit; only `qr-signage.pdf` ships. Pytest `test_only_signage_endpoint_exposed` enforces this.
- **PDF colours use RGB** (slate `#0F1B33`, Paneltec orange `#FC8014`) — matches web-app palette without pulling in a colour-management module.

## Non-blockers left in place (per standing directives)

- 20 pre-existing `ephemeral-upload-storage` lints — v58.14.x scope.
- Mobile bundle at `.132di` — Expo specialist ships separately.

## Ship checklist

- [x] Investigation section written with grep findings.
- [x] Backend: single admin-gated `qr-signage.pdf` endpoint.
- [x] Backend: public `/sign-on/{site_id}` resolver returning 302 → `/scan/site/{token}`.
- [x] Frontend: single admin-only button on Site detail.
- [x] No disk persistence (StreamingResponse from BytesIO).
- [x] 3-way web version sync at `.132dk`.
- [x] Pytest 7/7 + 66/66 combined.
- [x] Live curl proofs (PDF 200/valid + public 302 + unknown 404).
- [x] A4 signage preview rendered (`/tmp/132dk_signage.png`).
- [ ] `finish` tool — **deferred per standing directive**.
- [ ] Mobile bundle bump — **Expo specialist owns**.
