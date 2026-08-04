---
title: Troubleshooting & FAQ
slug: troubleshooting-faq
order: 21
tags: []
last_updated: 2026-08-04
---

## 19. Troubleshooting & FAQ

- **"My changes aren't showing"** — Hard refresh (Cmd/Ctrl + Shift + R). Paneltec's service worker auto-detects new versions and prompts a reload, but a manual hard refresh always works.

- **"A tile bounced me back to login"** — This shouldn't happen on the current build; if it does, screenshot the URL and report to your admin. Likely a stale route from an older deploy.

- **"PDF won't open in my browser"** — Some ad-blockers strip PDF responses. Open in an incognito window or use the inline preview by clicking the PDF row in the audit pack list.

- **"Camera permission denied"** — iOS / Android both require explicit camera permission. Settings → Safari/Chrome → Camera → Allow for `paneltec.com.au`.

- **"Lifetime odometer is wrong on a vehicle"** — Likely no Navixy panel counter for that device. Open the asset, scroll to **Live Counters**, click **+ Add a historical reading** and enter the correct total km. Future trip deltas anchor off your reading.

- **"I'm locked out"** — Five failed sign-ins triggers a 15-minute lockout. Either wait it out or ask your admin to unlock via **Users & Permissions → Unlock**.

- **"My phone is still showing the old cobalt app icon"** — iOS and Android cache home-screen icons aggressively. Remove the app from your home screen and re-install via Share / browser menu → Add to Home Screen.

- **"The SWMS paste didn't work"** — Make sure you pasted into the **Paste SWMS** dialog (not the regular SWMS form). The dialog handles Word/Outlook combined HTML+plain-text payloads safely; the regular form expects keyboard input.

---

_For anything not covered here, contact your organisation's Paneltec administrator. They have direct support escalation to the Paneltec team._
