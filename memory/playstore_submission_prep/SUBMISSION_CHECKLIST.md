# Google Play Store Submission Checklist — Paneltec WHS

## Prerequisites
- [ ] **Google Play Console account** — $25 one-time fee
      → https://play.google.com/console/signup
      → Sign up with the business Google account (e.g. stephen@paneltec.com.au)
- [ ] **Developer profile complete** — legal name, address, contact email, phone
      → Developer name: `Paneltec Group` (or `Paneltec Group Pty Ltd` — matches ABN)
      → Contact email: ___@paneltec.com.au
      → Website: https://paneltec.com.au
      → Phone: ___ (required for account verification)
- [ ] **AAB file downloaded** — READY ✓
      → Build `8d27d2cf` finished successfully
      → Download: https://expo.dev/artifacts/eas/KGb1B22HHLP6A5fjGaavbLyQkAYycru9p7YvjCXhams.aab
      → NOTE: this AAB uses old package `com.emergent.whscompliance.fv5aib`. For Play Store, trigger a new AAB build with `com.paneltec.whs` first (see step below).

## Before First Upload
- [ ] **Trigger AAB build with new package name** (`com.paneltec.whs` from `.132p3h`):
      ```bash
      cd /app/mobile
      EXPO_TOKEN=<token> eas build -p android --profile production --non-interactive
      ```
      Wait for build to finish, download the .aab artifact.

## Create App in Play Console
- [ ] Play Console → **Create app**
      → App name: `Paneltec WHS`
      → Default language: English (Australia)
      → App or Game: **App**
      → Free or Paid: **Free**
      → Declarations: accept all
- [ ] Package name will be auto-detected from AAB: `com.paneltec.whs`

## Internal Testing Track (fastest — no Google review)
- [ ] Go to **Testing → Internal testing** → **Create new release**
- [ ] Upload the `.aab` file
- [ ] Add release notes: `v1.0.58 — Initial release. Jobs, forms, hazards, leave, GPS sign-on.`
- [ ] **Create email list** of up to 100 internal testers
      → Add: stephen@paneltec.com.au + any field workers' emails
- [ ] **Review and publish** to internal track
      → Testers receive install link within minutes (no store review needed)

## Store Listing
- [ ] **Main store listing** tab → paste content from `STORE_LISTING.md`
      → App name: `Paneltec WHS`
      → Short description: pick from 3 options
      → Full description: copy-paste
- [ ] **Screenshots** — upload 6 phone screenshots (see `SCREENSHOT_INSTRUCTIONS.md`)
- [ ] **Feature graphic** — upload 1024×500 banner (see `FEATURE_GRAPHIC_BRIEF.md`)
- [ ] **App icon** — auto-sourced from AAB (512×512 adaptive icon)

## Data Safety
- [ ] **Data safety questionnaire** — answer based on app's actual data practices:
      | Data type | Collected | Shared | Purpose |
      |-----------|-----------|--------|---------|
      | Name | Yes | No | Account identity |
      | Email | Yes | No | Authentication |
      | Phone number | Yes | No | SMS job dispatch |
      | Approximate location | Yes | No | GPS site sign-on |
      | Precise location | Yes | No | GPS site sign-on |
      | Photos | Yes | No | Hazard/incident evidence |
      | Files | Yes | No | Medical certificates, form attachments |
      | App activity | Yes | No | Analytics, error tracking (Sentry) |
      → Data encrypted in transit: **Yes** (HTTPS)
      → Data deletion mechanism: **Yes** (contact admin)

## Content Rating
- [ ] Complete IARC questionnaire
      → All answers: None / No → rating: **Everyone**

## Target Audience
- [ ] Set target age: **18+** (workplace app, not for children)
- [ ] App access: select **Restricted access** — requires login credentials provided by employer

## Privacy Policy
- [ ] URL: `https://whs-compliance.preview.emergentagent.com/privacy`
      → Already public and live ✓

## Publish to Internal Testing
- [ ] Click **Review and roll out** → Confirm
- [ ] Share opt-in link with testers

## Later — Production Release
- [ ] Move to **Closed testing** first (triggers Google review — 1-3 days)
- [ ] Once approved, promote to **Production**
- [ ] Set up staged rollout (10% → 50% → 100%)

## User Needs to Provide
1. Google account for Play Console signup
2. Legal business name + address (for developer profile)
3. Support email address
4. Support phone number
5. List of internal tester email addresses
