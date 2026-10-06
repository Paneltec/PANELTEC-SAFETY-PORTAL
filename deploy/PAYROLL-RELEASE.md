# Payroll menu release

The existing permission-gated PAY menu now links to **Payroll** at `/app/pay/payroll`. The timesheet overview remains at `/app/pay`; all child routes require payroll view access. Payroll includes weekly worksheets, review reports, division branding, encrypted banking and employee setup, finalisation history and draft/issued payslip support.

## Before deployment

- Ordinary image updates resolve the previously verified owner account using a pinned SHA-256 fingerprint of its immutable ID and read its organisation from the existing account. No users or grants are created. Other accounts, duplicate IDs, missing organisation and non-admin roles remain denied. Explicit `PAYROLL_OWNER_USER_ID` / `PAYROLL_OWNER_ORG_ID` environment configuration takes precedence, including incomplete configuration. Only the owner can manage dedicated payroll grants in Users & Permissions.
- Preserve and back up the existing `INTEGRATIONS_ENC_KEY`, or configure a dedicated `PAYROLL_BANK_ENC_KEY` before storing new encrypted payroll records. Do not rotate a key over existing records.
- Keep `PAYROLL_ISSUING_ENABLED=false` until migration and pay-run reconciliation are complete.
- Container image updates preserve the existing environment; explicit environment overrides must also be set on the running deployment. The verified-account bootstrap supports the usual Umbrel image-update flow without new environment variables.
- Verify owner access, an unapproved administrator denial, an approved administrator grant/revocation and cross-organisation denial in staging with the real authentication and MongoDB stack.
- Reconcile worker rates, applicable awards, opening leave and YTD balances against the current provider. Westpac acceptance and CareSuper/QuickSuper and STP-provider connections remain outstanding. CSV review reports are not statutory lodgments.

## Validation

Merged against 7f416c7 without conflicts in existing payroll integrations. Full frontend production build passes with hook and bundle-size warnings. 39 isolated HTTP and owner-bootstrap tests and 25 calculation/access tests pass (plus 9 subtests). Isolated HTTP tests use synthetic users and an in-memory database, not production MongoDB or complete authentication middleware.

Run isolated HTTP tests with `python -m unittest discover -s backend/tests/payroll_isolated -p 'test_payroll_*.py'`. Run the four payroll calculation/access test files with pytest `--noconftest` to avoid the separate integration fixtures.

This release does not transfer money, lodge STP, transmit super contributions, email payslips or post an automatic statutory leave ledger. Issued payslips require an explicit recorded payment and manual delivery.
