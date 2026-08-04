---
title: HR Employees Register
slug: hr-employees-register
order: 10
tags: []
last_updated: 2026-08-04
---

## 8. HR Employees Register

The HR Employees register is the employer-of-record roster (currently 121 employees). It sits alongside the Workers list — Workers is field-oriented (who's on site, what SWMS they've signed, what certifications are expiring), HR Employees is admin-oriented (payroll references, next-of-kin, DOB, address, employment status).

### How data gets in
- **Initial seed** — an XLSX file `hr_employees_source.xlsx` is auto-ingested at startup on first run (idempotent — subsequent restarts skip the ingest).
- **Ongoing refresh** — press **Refresh from Simpro** (blue button, top-right) to re-parse the on-disk source. Simpro doesn't expose an HR endpoint, so the on-disk XLSX is treated as the sync boundary for now.
- **No manual create form** — there is no "+ Add employee" button on this page. If you need to add an employee, drop them into the XLSX source and click Refresh.

### Active vs Archived tabs
Two tabs at the top of the table:
- **Active** — every employee currently on the roster.
- **Archived** — employees marked archived via the drawer's **Archive** action. Archiving keeps the record + audit trail but hides it from the Active view. Restore via the drawer.

Delete (both inline row-button and drawer header) does a soft-delete: the record stays in Mongo with `deleted_at` set. Archive is orthogonal — you can archive without deleting, or delete without archiving.

### PII controls
Date of Birth, home Address, and Next-of-Kin phone/relationship are masked by default. Each field has a **Reveal** button that unmasks the value and writes an audit row (`hr_employees_audit`) capturing who revealed what and when. Reveals are gated by the `hr_employees.reveal_pii` permission token.

### Sparse-column display
The table shows a subset of columns (name, employee_id, role, employment_status, archived flag) — everything else surfaces in the row drawer's **Detail** tab. Filter dropdowns above the table cover role, employment status, and archived state. The search field indexes name, employee_id, and email.

### `linked_worker_id` reserved
Every HR Employees record carries a reserved `linked_worker_id` field for the future Employees↔Workers linker (so a payroll record can point at the field record). It's patchable via the drawer but no endpoint consumes it yet — coming in a future release.

---
