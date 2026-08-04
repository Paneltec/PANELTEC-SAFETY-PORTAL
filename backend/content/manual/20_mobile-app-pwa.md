---
title: Mobile app (PWA)
slug: mobile-app-pwa
order: 20
tags: []
last_updated: 2026-08-04
---

## 18. Mobile app (PWA)

### Installing
See **Section 1 — Getting started**.

### Biometric / Face ID setup
First sign-in on a PWA install asks you to enrol biometric unlock. Tap **Set up Face ID / Fingerprint** when prompted; the credential is stored in your device's secure enclave (never on our servers). Subsequent app launches skip the password screen and unlock with biometric only.

### Pull-to-refresh module config
The mobile home screen shows only the modules your role + permissions allow. If your admin enables a new module while you're signed in, pull down on the home screen to refresh the layout — no sign-out required.

### Offline behaviour
The PWA pre-caches the app shell + your last-viewed module screens. If you lose signal mid-capture, draft forms are saved to local storage and sync to the server when you're back online. Photos are queued in the same local outbox and uploaded in order. The orange dot on the home screen indicates pending offline records.

---
