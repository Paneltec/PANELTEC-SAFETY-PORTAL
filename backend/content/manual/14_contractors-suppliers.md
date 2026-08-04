---
title: Contractors & Suppliers
slug: contractors-suppliers
order: 14
tags: []
last_updated: 2026-08-04
---

## 12. Contractors & Suppliers

### Importing from Simpro
Sidebar → **Suppliers** → **Import from Simpro** (top-right). Choose the vendor list, map fields if needed, click **Import**. Existing suppliers are matched by ABN; new ones are created with `Source: Simpro` pill.

### Renewal links workflow
Sidebar → **Renewal Links**. Each row is a contractor with an expiring document (insurance, licence, SWMS). Click **Send renewal link** — the contractor receives an email with a public URL `/renew/:token` where they can upload the updated document. The submission lands in your inbox for approval.

### Public QR resolvers
The QR codes on the worker / supplier / site cards resolve via short tokens:

- `/scan/worker/:token` — opens the worker's compliance card on any phone (no login).
- `/scan/site/:token` — opens the site sign-on page.
- `/scan/supplier/:token` — opens the supplier's renewal portal.

Print the QR via the asset / supplier / worker row's **Print** action.

---
