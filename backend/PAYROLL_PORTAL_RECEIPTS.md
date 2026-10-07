# Payroll portal receipts

The pay-run register reads saved worksheet totals and revision-specific receipts.
It never treats creating a file or issuing a payslip as proof of delivery/payment.
Existing completion evidence is labelled **Office verified**, separately from
recorded provider responses.

## Integration seam

`POST /api/payroll/workbench/{week}/portal-receipts/{kind}` requires the existing
authenticated payroll editor permission. It is **not a public webhook**. Do not
give a provider a staff session token. Add a provider-specific server adapter
with signature verification/credential handling before exposing any callback.

Kinds: `bank`, `payslips`, `stp`, `super`, `journal`.

Body: `revision`, `event_id`, `status`, `reference`, optional `message`.
Status: `submitted`, `received`, `accepted`, `rejected`.
Event IDs accept letters, digits, hyphens and underscores, maximum 100 characters.
Use an opaque stable identifier; never include account numbers or employee data.

Only the current locked revision is accepted. Duplicate identical events are
idempotent; conflicting reuse returns 409. A compare-and-set write prevents
concurrent responses silently overwriting one another. Per-revision events remain
in the run document. A later correction does not inherit old receipt icons.
Adapters must reconcile provider event ordering before recording a new event.
Responses never set wage payment, completion or leave-posting flags.

## Provider setup

`GET /api/payroll/workbench/portals/requirements` and payroll-editor-only
`PUT /api/payroll/workbench/portals/requirements/{kind}` store provider name,
planned receipt method, accepted-status mapping and setup requirements.
These are specifications, not active connections; no secrets belong here.
Vendor adapters, credentials, sandbox verification and activation remain to be
implemented once the selected provider requirements are available.

## Access

The separate Manage access tab calls the existing owner-only grant/revoke API.
No grants are created by this release. Existing administrator accounts can be
given view-only or view-and-edit payroll access. The owner cannot be removed.
No external invitation, new login role or independent authentication system is
introduced. Read access includes sensitive payroll records, not only summaries.
