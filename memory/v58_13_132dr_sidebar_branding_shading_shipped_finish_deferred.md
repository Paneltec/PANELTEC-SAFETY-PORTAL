# v58.13.132dr — Sidebar branding editable + shading dial-up

**Status**: Shipped. `finish` tool deliberately deferred per standing directive.

## Sidebar Branding Investigation

**Source**: `frontend/src/components/brand/Logo.jsx:30` (pre-`.132dr`) rendered a **hard-coded literal** — `Paneltec <span className="text-orange-500">Civil</span>`. No org lookup, no context, no prop. Every consumer of `<Logo>` (Login, PublicRenewal, SupplierScanResolver, AppShell desktop sidebar, AppShell mobile sheet) rendered the same static wordmark.

**Consumers grep**:
```
frontend/src/components/layout/AppShell.jsx:571,704  <Logo size="sm" />
frontend/src/pages/PublicRenewal.jsx:6,…              <Logo />
frontend/src/pages/PublicScanResolver.jsx:…           <Logo />
frontend/src/pages/SupplierScanResolver.jsx:172       <Logo />
frontend/src/pages/Login.jsx:…                        <Logo />
```

**Fix**: `<Logo>` now accepts an optional `displayName` prop. Splits on the LAST whitespace: everything before → slate ink, last word → orange. Public pages keep the default fallback. Authenticated shell threads `org.display_name → org.trading_name → org.name → 'Paneltec Civil'` (order per spec).

## Backend

* `OrgPatch.display_name: Optional[str]` — persisted verbatim; no validation beyond string type.

## Frontend

* `frontend/src/components/brand/Logo.jsx` — rewritten. `displayName` prop + `data-brand-name` attr on the root for testability. Default fallback preserved.
* `frontend/src/components/layout/AppShell.jsx` — new `brandName` state, fetches `/api/org` on mount, listens for `paneltec_org_updated` custom event to refresh live after Org Settings saves. Threaded through `SidebarShell(brandName)` and the mobile `<Sheet>`'s `<Logo displayName={brandName} />`.
* `frontend/src/pages/OrgSettings.jsx`:
  * `IDENTITY` array gains `display_name` field between `name` and `trading_name`. Hint: "Sidebar wordmark + PDF header. Falls back to Trading name, then Organisation name."
  * `doSave()` fires `window.dispatchEvent(new CustomEvent('paneltec_org_updated'))` after a successful PATCH so the sidebar refreshes without a page reload.

## Shading dial-up (Item 2)

Grep confirmed shading was PRESENT after `.132dp/.132dq` but too subtle
(`ring-1 ring-emerald-50/60` renders near-invisible on white). Dialled up:

* **Elevated sections** — `border-emerald-200 shadow-md ring-2 ring-emerald-100 bg-gradient-to-br from-emerald-50/40 via-white to-white`. Consistent across Identity / Address / Contact / PDF branding / Insurance policies.
* **Emphasis banner** — promoted to `border-2 border-emerald-300 shadow-md ring-1 ring-emerald-100`, gradient `from-emerald-50 via-white to-white`. Body text tinted emerald-800 on the callout keywords ("PDF reports", "audit exports", …).
* **IMPORTANT chip** — pinned via `absolute -top-2.5 right-4` with a ring-2 white halo (`ring-2 ring-white`) so it lifts off the banner edge.
* **Email popup** — `ring-4 ring-emerald-200 border-2 border-emerald-300 shadow-2xl` + header gradient `from-emerald-100 via-emerald-50 to-white` with a `border-b-2 border-emerald-200` seam. Impossible to miss now.

## Pytests

`backend/tests/test_v58_13_132dr_sidebar_branding_shading.py` — 6 checks, all green:

1. `test_logo_accepts_display_name_and_orange_tail` — signature + last-word orange split + default fallback preserved.
2. `test_appshell_threads_org_brand_name` — lookup order `display_name || trading_name || name`, threaded into both desktop `SidebarShell` and mobile `<Sheet>`, refresh on `paneltec_org_updated` event.
3. `test_org_patch_carries_display_name` — backend model.
4. `test_org_settings_page_exposes_display_name_field` — field key in IDENTITY + event dispatch on save.
5. `test_shading_dialled_up` — ring-2/ring-4 classes + emerald gradient + border-2 + absolute chip positioning present.
6. `test_version_sync_at_132dr` — 3-way version pins.

## Screenshots

* `/app/memory/v58_13_132dr_02_sidebar_custom_brand.png` — sidebar wordmark shows `Paneltec Civil` slate + `DEMO` orange (custom `display_name` = "Paneltec Civil DEMO"). Version pill `v160.3.9.58.13.132dr`.
* `/app/memory/v58_13_132dr_01_shading_dialled_up.png` — Org Settings top of page: strong emerald ring + gradient + IMPORTANT chip pinned top-right on the emphasis banner, Display / Branding name field visible next to Organisation name.
* `/app/memory/v58_13_132dr_03_email_popup_shading.png` — Email Certificates popup with 4-ring emerald halo + 2px border + emerald gradient header. Reads unmistakably as ADMIN ONLY.

## Version pins → `.132dr`

`frontend/src/lib/version.js` (RUNNING + EXPECTED_CACHE) + `frontend/public/service-worker.js` (CACHE_VERSION). Mobile untouched.

## Ops rules

* No `testing_agent`, no `e1_tester`, no `finish` tool.
* No `/app/mobile/` edits.
* No lint regressions (still 20 pre-existing `ephemeral-upload-storage` warnings — none added).
* Commit with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
