# Payroll review — Stephen's handover

12 October 2026 · Round 1 · web app and phone app

## What changed

Two small backend changes preserve the encrypted previous version when payroll employee settings or bank instructions change. This makes future changes traceable without putting the old values on screen. Existing missing history cannot be reconstructed by this fix. No pay calculations, rates, employee classifications or approved screens were changed. No payroll data or live phone/web payroll screens were read. Nothing deployed or merged.

## What is supported — and what is not yet confirmed

The code has Decimal-based calculations, encrypted bank/employee configuration, masked responses, saved-run revisions, worker-only payslip endpoints and synthetic phone-to-office tests. Those controls passed the isolated tests relevant to this round. This is not certification that the app is compliant or fully secure. STP integration is explicitly unfinished. Annual tax-table updates, special tax cases, qualifying earnings, leave ledgers and statutory record retention still need work or confirmation.

The phone app has timesheet and payslip screens. It needs retry handling and a decision about former-employee payslip access. Native phone tests were unavailable because its dependencies are not installed.

## Needs your decision

1. **Test environment:** provide an empty disposable Mongo/API deployment with synthetic fixtures (recommended), or restrict future review to isolated tests and accept incomplete validation. Do not use the Umbrel payroll database for the full suite.
2. **Approval:** require a second payroll approver when available (recommended), with an explicit single-user confirmation exception, or retain the present same-person workflow pending accountant review.
3. **Company mapping:** confirm legal employer identifiers for both companies (recommended); do not infer company purely from traffic-control job titles.
4. **Bank alerts:** choose the authorised recipients and notification channel before implementing alerts; recommend a nominated payroll owner with a minimal, masked notification.
5. **Former employees:** choose time-limited authenticated self-service or an office-managed record request process; recommend an audited request process until identity/access rules are agreed.
6. **Dependencies:** approve establishing a reproducible audit toolchain and native phone test dependencies in a disposable development environment; no blind upgrades.

## Needs your accountant

- Award coverage/classifications and higher agreed-rate treatment for each company.
- PAYG special cases, no-TFN timing, Medicare/study-loan/residency handling and annual Schedule 1 reconciliation.
- July 2026 qualifying earnings, caps, leave-loading and allowance super treatment; the brief's OTE wording is insufficient as an implementation specification.
- LAFHA/meals tax treatment and STP Phase 2 allowance codes; choose the STP provider and migration/correction/finalisation process.
- Opening/YTD balances, leave-ledger reconciliation and portable long service leave requirements.

## Validation and next round

272 baseline and 274 post-change synthetic backend tests passed; 21 web payroll tests passed. Full live-dependent backend suite was deliberately not run. Lint/audit toolchain and native phone dependencies remain blocked; see AUDIT_LOG.md. Stop after Round 1 until isolated validation can be completed. The remaining High findings are still open.

Files: [Map](PAYROLL_MAP.md), [Audit](AUDIT_LOG.md), [Checklist additions](CHECKLIST_ADDITIONS.md). Pull-request link added after creation.

Web production build attempted with dotenv loading disabled and test.invalid backend: failed because existing local dependencies cannot resolve react-pdf (Dropbox viewer import). No package installation attempted. This is unrelated to the two backend changes.

Round 1 draft PR: https://github.com/Paneltec/PANELTEC-SAFETY-PORTAL/pull/10
