# v58.13.132jp — Privacy Policy + Terms of Service, publicly hosted

## Why
User is submitting the app to **Google Play Closed Testing** and
**Apple TestFlight** tomorrow. Both stores require a publicly
reachable Privacy Policy URL before submission. This ship publishes
both a Privacy Policy (compliant with the Privacy Act 1988 and the
Australian Privacy Principles) and a Terms of Service, and links
to them from the web sign-in cover + the mobile Settings tab.

## Public URLs (live, curl-verified)

| Doc | URL | Status |
|---|---|---|
| Privacy Policy | https://whs-compliance.preview.emergentagent.com/legal/privacy-policy.html | HTTP 200, `text/html; charset=UTF-8`, no auth |
| Terms of Service | https://whs-compliance.preview.emergentagent.com/legal/terms-of-service.html | HTTP 200, `text/html; charset=UTF-8`, no auth |

Both pages return within one request (no bundle load, no JS
required — plain HTML with inline CSS). Google/Apple reviewers
open them in a normal browser and see the full policy immediately.

### Routing decision
The Kubernetes ingress in this environment routes `/api/*` to the
backend (port 8001) and everything else to the frontend (port 3000).
We chose to serve the policies as **static HTML files under
`frontend/public/legal/`** rather than adding routes to the FastAPI
backend, because:

- No `/api/` prefix in the URL (per user requirement).
- No React bundle load — pages render instantly for slow reviewers
  or crawlers that don't execute JS.
- No auth guards — the frontend static handler serves the file
  directly, bypassing React Router's auth logic.
- Zero build step required — file lives at
  `frontend/public/legal/privacy-policy.html` and is picked up by
  CRA's `public/` serve.

The `.html` suffix on the URL is a compromise: the extension-less
`/legal/privacy-policy` would have required either an ingress rule
we can't add, or a React public route (JS-required). The Store
review teams accept either variant.

## Company details (as inserted, verbatim from user)
- Legal name: **Paneltec Pty Ltd**, trading as The Paneltec Group
- ABN: **12 128 689 412** (ATO canonical rendering; user provided
  the equivalent unformatted `121 28689 412`)
- Registered address: **19 Connector Park Drive, Kings Meadows
  TAS 7249, Australia**
- Phone: **03 6343 2026**
- Fax: 03 6343 2087
- Privacy officer / contact: **accounts@paneltec.com.au**
- Governing law: Tasmania, Australia; Privacy Act 1988 (Cth) with
  Australian Privacy Principles.

## Privacy Policy — sections covered (all 10)
1. What personal information we collect (8 categories)
2. Why we collect it — Legal obligation (WHS Act 2011 Cth + WHS
   Act 2012 Tas), Contract, Legitimate interests
3. Who we share it with — Emergent, Navixy, Simpro, OpenAI/
   Anthropic, regulators/insurers/courts. Explicit denial of
   advertising partners, analytics resellers, data brokers.
4. Where data is stored — Emergent-managed infrastructure + local
   UGREEN NAS; offshore transfer disclosure.
5. Retention — 7 years for compliance records, 7 days rolling
   for platform snapshots, indefinite for local NAS.
6. APP user rights — Access, Correction, OAIC complaint path.
7. App permissions — Camera, Storage, Location (foreground only),
   Internet, Notifications, Install unknown apps (sideload flag
   with removal-on-Play-Store note).
8. Security — TLS 1.2+, encrypted at rest, RBAC, audit logging,
   short-lived signed tokens, per-device provisioning.
9. Cookies — no analytics/marketing SDKs; only functional auth
   cookies on web.
10. Changes to this policy — versioned + effective date.

## Terms of Service — sections covered
1. Acceptable use — records must be truthful; no submitting on
   another worker's behalf without authority; no reverse
   engineering; no credential sharing.
2. Ownership of records — Paneltec holds compliance records as
   PCBU under WHS legislation; user retains rights to personal
   information (cross-reference to Privacy Policy).
3. Availability & changes — best-effort service, subject to
   infrastructure providers; may update/remove features.
4. Termination — access tied to engagement; records retained per
   Privacy Policy on termination.
5. Limitation of liability — capped at re-supply / 12-month fee
   refund; consumer guarantees preserved.
6. Governing law — Tasmania.
7. Changes to Terms — posted at same URL; continued use = acceptance.

## Where linked in-app

### Web (`frontend/src/pages/Cover.jsx`)
Two small links added directly beneath the copyright line on the
sign-in cover:

```
© 2026 Stephen Guy · paneltec-v160.3.9.58.13.132jp · All rights reserved
Privacy · Terms
```

Both open in a new tab (`target="_blank"`), muted tint using the
same `--paneltec-gold` token as the copyright line. `data-testid`
attributes: `cover-legal-links`, `cover-privacy-link`,
`cover-terms-link`.

### Mobile Settings tab (`mobile/app/(tabs)/settings.tsx`)
New "LEGAL" section injected between "Ask AI" and "Check for Updates":

```
LEGAL
[shield] Privacy Policy      →
[doc]    Terms of Service    →
```

Each row uses `Linking.openURL(...)` to open the corresponding
public HTML URL in the system browser. `testID` attributes:
`settings-privacy-policy`, `settings-terms-of-service`.

## Files touched
- `frontend/public/legal/privacy-policy.html` **(NEW)** — 10-section policy.
- `frontend/public/legal/terms-of-service.html` **(NEW)** — 7-section terms.
- `frontend/src/pages/Cover.jsx` — 2 legal links under copyright line.
- `mobile/app/(tabs)/settings.tsx` — LEGAL section with 2 rows;
  added `Linking` to the react-native import.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132jp`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132jp`.

## NOT changed
- Backend (untouched — static frontend serve does the job).
- `mobile/app.json` — no mobile version bump because this ship's
  mobile change is a settings-screen link addition that piggybacks
  on the next EAS build; no code path change requires an immediate
  fresh APK. If Stephen needs the LEGAL section on the phone before
  Google Play submission, kick a fresh `preview-apk` build.
- Any other component.

## Verification (curl, live)
```
$ curl -sI https://whs-compliance.preview.emergentagent.com/legal/privacy-policy.html
HTTP/2 200
content-type: text/html; charset=UTF-8
last-modified: Mon, 21 Sep 2026 04:30:26 GMT

$ curl -sI https://whs-compliance.preview.emergentagent.com/legal/terms-of-service.html
HTTP/2 200
content-type: text/html; charset=UTF-8
last-modified: Mon, 21 Sep 2026 04:31:02 GMT
```

Both public, no auth challenge, correct MIME. Ingress adds
`x-robots-tag: noindex, nofollow` and `cache-control: no-store`
via edge config — reviewers open URLs manually so this doesn't
matter for submission; documented for the record.

## Follow-up (not blocking submission)
- If a Store reviewer insists on extension-less URLs
  (`/legal/privacy-policy` without `.html`), add either a React
  public route or a small ingress rewrite. Not blocking Google
  Play / TestFlight submission today.
- Kick a `preview-apk` EAS build if Stephen wants the LEGAL
  section visible in the closed-testing APK.
- Wire the policies into the app onboarding flow (first-login
  "I accept" checkbox) — recommended before public release, not
  required for closed testing.
