# Payroll audit — Round 1

Date: 12 October 2026. Branch: payroll-audit-2026-10-12.
Scope: backend, React payroll and Expo phone payroll. Test data only; no live app or database reads. Findings below are source-based, not assurance that the deployed payroll is compliant. Map and this initial audit were written before fixes.

## Findings and priorities

| ID | Area | Severity | Evidence | Problem / consequence | Fix type |
|---|---|---|---|---|---|
| R1-SEC-01 | Security | High | backend/payroll_employee_records.py:77 | Previous encrypted profile retained only when opening balances change. Rate/fund/tax-profile changes lose prior values, weakening reconstruction. | Safe to fix: retain prior encrypted payload on every successful revision |
| R1-SEC-02 | Security | High | backend/payroll_banking.py:78–85 | Bank replacement event records actor/time but not previous encrypted bank instructions. Cannot reconstruct prior instruction reliably. | Safe to fix: retain encrypted previous payload under the same revision guard |
| R1-COMP-01 | Compliance | High | backend/payroll_stp_readiness.py: readiness blockers; payroll_completion.py: status | No integrated STP submission, correction or annual finalisation. Manually entered receipt does not establish actual ATO acceptance. | Needs sign-off: choose provider and authorisations |
| R1-COMP-02 | Compliance | High | backend/payroll_engine.py:33–45,149–161 | Only supported weekly scales automatically calculated; special circumstances use reviewed manual PAYG. No automatic no-TFN 28-day workflow or annual no-code table import demonstrated. | Needs sign-off: accountant-approved tax scope/table update process |
| R1-COMP-03 | Compliance | High | backend/payroll_engine.py:171–194 | QE, leave loading, caps and allowance inclusion require accountant review. Brief uses OTE terminology but post-July-2026 ATO material uses qualifying earnings. | Needs sign-off; do not change maths |
| R1-COMP-04 | Compliance | High | backend/payroll_roster.py:28–29 | Company division inferred from traffic-control position text, not a confirmed legal employer mapping. Could group staff incorrectly. | Needs sign-off: confirm company mapping; do not reclassify staff |
| R1-COMP-05 | Compliance | High | backend/payroll_engine.py:196–208; mobile/app/payslips.tsx projected balances | Projected balances are not a posted leave ledger; full LSL/RDO history not demonstrated. | Needs sign-off: reconcile authoritative ledger and migration |
| R1-SEC-03 | Security | High | backend/payroll_lifecycle.py:finalize | No independent second-approver enforcement demonstrated; review and finalise use same edit grant. | Needs decision: approval policy, sole-user exception |
| R1-SEC-04 | Security | Medium | backend/payroll_banking.py:put_bank | No bank-change alert in this path. | Needs decision: recipients/channel; no unsolicited messages |
| R1-SEC-05 | Security | Medium | backend/payroll_worker_payslips.py:own_payslips; payroll_roster.py:my_worker | Former/inactive staff cannot use current-roster self-service; each request scans org historical sheets. | Needs decision: former-worker access policy and indexed history |
| R1-USE-01 | Usability | Medium | mobile/app/payslips.tsx: initial load effect | Failed initial list load has no Retry control; user must leave/reopen. | Safe to fix, deferred by test stop condition |
| R1-TEST-01 | Security | High | backend/tests/conftest.py:16,68–97 | Full suite explicitly targets live API/Mongo and logs in; incompatible with test-only rule without an isolated environment. | Needs decision: disposable test deployment; do not use current configuration |

## Checklist A — compliance support

Met means source support, not certification. All money examples in testing are synthetic.

| Check | Status | Evidence / limit |
|---|---|---|
| PAYG current weekly formula | Partly | payroll_engine has dated 2026 Schedule 1 reference; accountant numerical reconciliation outstanding |
| Threshold/HELP/Medicare/residency | Partly | supported scales plus manual reviewed tax; not all automated |
| No-TFN after 28 days | Missing | no automatic deadline workflow established |
| Annual no-code table update | Missing | dated constants in engine |
| STP on/before payday | Missing | readiness explicitly not connected |
| STP disaggregation | Partly | earnings lines exist; provider mapping absent |
| LAFHA/Meals codes | Can't tell | accountant/provider mapping required |
| STP corrections/finalisation | Missing | local correction is not an ATO event |
| Super 12%, correct earnings base | Partly | Decimal calculation and QE review; accountant approval required |
| Super excluded from gross | Met | engine returns separate super result |
| Payday Super receipt/deadline warnings | Partly | manual receipt completion exists; full holiday/exceptions/late-warning evidence not established |
| Choice/stapled fund | Partly | fund/member encrypted storage; stapled workflow not established |
| Payslips within working day | Partly | issuing/delivery controls; no proven deadline enforcement |
| Required payslip fields | Partly | payslip_document/phone render; deductions recipient and complete statutory reconciliation require review |
| Per-company awards/multipliers | Partly | configurable rules; coverage/employer mapping unconfirmed |
| Leave loading | Partly | configurable; accountant review needed |
| Seven-year retention | Can't tell | snapshots exist; backup/retention deployment not inspected |
| Hidden leave balances | Partly | annual/personal calculations; complete LSL ledger not established |
| Own record access | Partly | own issued slips, current roster only |
| Change history | Partly | revisions/events; prior-value gaps R1-SEC-01/02 |
| Calculation examples | Partly | isolated payroll suite exists; each legal scenario not certified |
| Decimal/cents/rounding | Partly | engine Decimal ROUND_HALF_UP; float serialization and downstream aggregation need reconciliation |
| Reimbursements net-only | Met | engine net=gross-tax-deductions+reimbursements |

## Checklist B — security/privacy

| Check | Status | Evidence / limit |
|---|---|---|
| Server access controls | Partly | payroll require_permission; owner explicit grants; own worker endpoints. Full independent auth/deployment matrix not completed |
| Encryption/masking | Partly | Fernet employee/bank records; pay review sheets contain unencrypted financial figures; storage/backup encryption unknown |
| Sensitive logs/errors | Can't tell | targeted paths reviewed; complete telemetry/history not scanned |
| Audit and bank alerts | Partly | R1-SEC-01/02/04 |
| Independent approval | Missing | R1-SEC-03 |
| Validation/injection | Partly | typed Pydantic limits and revision guards; complete adversarial suite outstanding |
| Sessions/PIN/CORS/CSRF | Partly | shared auth and CORS credentials disabled; deployment values not read |
| Secrets/repo history | Can't tell | no secret values accessed; dedicated redacting history scanner needed |
| Dependency audit | Pending | commands/results below; no blind upgrades |
| Encrypted/access-controlled backups | Can't tell | no backup contents or deployment configuration inspected |
| TFN rule/NDB plan | Can't tell | encryption is not sufficient proof of operational compliance |

## Checklist C — presentation and flow

| Check | Status | Evidence / limit |
|---|---|---|
| Approved layout/order/colours | Preserve | no changes in this round |
| Clear next steps/errors | Partly | review blockers and completion list; mobile missing retry |
| Unsaved warning/autosave | Partly | beforeunload/custom navigation guard; preview debounce is not persisted autosave |
| Keyboard/Enter | Can't tell | no synthetic browser session yet |
| Numeric focus/2 decimals | Partly | decimal editing tests; select-all not present in PayEntryInput |
| Loading/empty states | Partly | phone loading/empty present; R1-USE-01 |
| Contrast/labels/44px | Can't tell | no device-based accessibility audit performed |
| 1280px/tablet | Can't tell | real payroll screenshots prohibited; synthetic preview needed |
| Final totals/confirm | Partly | completion/lifecycle UI; independent approval absent |
| Consistent wording | Partly | existing review/calculation/paid distinctions; full UX pass outstanding |

## Sources checked 12 October 2026

- https://softwaredevelopers.ato.gov.au/PaydaySuper — qualifying earnings and receipt timing; do not use OTE-only checklist wording as a calculation specification.
- https://smallbusiness.fairwork.gov.au/keeping-the-right-records — seven-year records and payslip timing.
- https://softwaredevelopers.ato.gov.au/STPdocumentlibrary — implementation/provider specifications required.

## Round 1 plan

Pick two safe fixes only: R1-SEC-01 and R1-SEC-02, each with synthetic regression coverage. No maths, classification, award, STP, email, fund payment or deployment changes. Run isolated tests and attempt required validation without live access. Stop if safe full-suite validation cannot be established, per section 6 of the supplied brief.

## Round 1 results and re-audit

- R1-SEC-01 fixed: every successful employee-profile update retains the previous encrypted payload in its audit event; all previously missing history remains unrecoverable. No backfill.
- R1-SEC-02 fixed: bank replacements read the prior payload at the submitted revision, then atomically update and append encrypted history using that same revision predicate. Conflicting/stale writes append nothing.
- Both are additive data fields, no migration, deletion, key change or calculation change. Rolling back code leaves already-written history intact. History growth/retention policy still needs review before high-volume use.
- Re-audit: public responses remain masked and do not include ciphertext/audit arrays. Regression tests assert prior-value recovery, no plaintext storage and no stale-write audit additions. Existing documents work without an audit-history backfill. Employer and worker paths share put_bank.
- Baseline: 272 isolated backend tests passed. After fixes: 274 passed. Test harness uses synthetic in-memory records; actual permissions module is mocked in this harness, so it does not certify deployment authorisation.
- Web payroll: 21 tests across 2 suites passed. No approved layout or pay maths changed.
- Full backend suite: NOT run. backend/tests/conftest.py explicitly expects live API/Mongo fixtures. Automatic approval review initially rejected isolated execution for this reason; after inspecting the unittest harness (which never imports pytest conftest), execution was approved with external network blocked. The first network guard also blocked Windows asyncio socketpair and failed; adjusted guard allows Python's internal socketpair only. No external connection allowed.
- Lint: existing frontend/eslint.audit.config.mjs fails on PayrollTimeApprovals.jsx:12 because react-hooks/exhaustive-deps is referenced but that plugin is absent from this audit config. This file/config was unchanged. Full lint is not green.
- Dependency audit: python -m pip_audit --version reports unavailable. npm audit --package-lock-only --ignore-scripts --audit-level=high reports ENOLOCK (repo uses yarn.lock). No installs or lockfile replacement attempted; no vulnerability-free claim.
- Phone: mobile/node_modules absent. Phone compilation/emulator tests cannot run using existing dependencies. Source review completed for payroll screens/services; isolated phone API tests included in 274. No APK/phone release built or installed.
- Full backend test requirement cannot be satisfied without an isolated disposable environment. Stop after Round 1 under section 6: safe validation is blocked by the test-only hard rule. High findings remain; this is NOT a clean audit or production approval. Request a disposable test environment before Round 2. No deployment or merge authorised by this audit brief; submit PR for approval.

Web production build attempted with dotenv loading disabled and test.invalid backend: failed because existing local dependencies cannot resolve react-pdf (Dropbox viewer import). No package installation attempted. This is unrelated to the two backend changes.
