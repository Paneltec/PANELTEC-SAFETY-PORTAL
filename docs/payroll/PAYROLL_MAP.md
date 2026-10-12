# Payroll map — Round 1, 12 October 2026

Scope: source-code inventory only; no live database, employee record, credential or payroll screen accessed. Existing implementation, not a compliance certification. Phone scope includes timesheets, own payslips and shared leave/auth services.

## Files and responsibilities

- `backend/auth.py`
- `backend/leave_requests.py`
- `backend/payroll.py`
- `backend/payroll_aba.py`
- `backend/payroll_access.py`
- `backend/payroll_award_settings.py`
- `backend/payroll_balance_import.py`
- `backend/payroll_banking.py`
- `backend/payroll_branding.py`
- `backend/payroll_catalog_settings.py`
- `backend/payroll_completion.py`
- `backend/payroll_delivery.py`
- `backend/payroll_employee_records.py`
- `backend/payroll_engine.py`
- `backend/payroll_fund_lookup.py`
- `backend/payroll_fund_settings.py`
- `backend/payroll_lifecycle.py`
- `backend/payroll_opening_balances.py`
- `backend/payroll_owner_bootstrap.py`
- `backend/payroll_payslip_document.py`
- `backend/payroll_payslips.py`
- `backend/payroll_rate_import.py`
- `backend/payroll_roster.py`
- `backend/payroll_run_register.py`
- `backend/payroll_segments.py`
- `backend/payroll_shift_rules.py`
- `backend/payroll_stp_readiness.py`
- `backend/payroll_submissions.py`
- `backend/payroll_work_types.py`
- `backend/payroll_workbench.py`
- `backend/payroll_worker_payslips.py`
- `backend/permissions.py`
- `frontend/src/pages/pay/DateField.jsx`
- `frontend/src/pages/pay/PayAwardRates.jsx`
- `frontend/src/pages/pay/PayEarningRules.jsx`
- `frontend/src/pages/pay/PayOverview.jsx`
- `frontend/src/pages/pay/PayPeople.jsx`
- `frontend/src/pages/pay/PayPeriods.jsx`
- `frontend/src/pages/pay/PayrollAccess.jsx`
- `frontend/src/pages/pay/PayrollArchive.jsx`
- `frontend/src/pages/pay/PayrollAwardSettings.jsx`
- `frontend/src/pages/pay/PayrollBankPanel.jsx`
- `frontend/src/pages/pay/PayrollBranding.jsx`
- `frontend/src/pages/pay/PayrollCalculationPanel.jsx`
- `frontend/src/pages/pay/PayrollCasualRates.jsx`
- `frontend/src/pages/pay/PayrollCatalogSettings.jsx`
- `frontend/src/pages/pay/PayrollCompletion.jsx`
- `frontend/src/pages/pay/PayrollConnections.jsx`
- `frontend/src/pages/pay/PayrollCoverage.jsx`
- `frontend/src/pages/pay/PayrollDeliverySettings.jsx`
- `frontend/src/pages/pay/PayrollEmployeeRecord.jsx`
- `frontend/src/pages/pay/PayrollEmployeeSettings.jsx`
- `frontend/src/pages/pay/PayrollExtraRun.jsx`
- `frontend/src/pages/pay/PayrollFlow.jsx`
- `frontend/src/pages/pay/PayrollHistory.jsx`
- `frontend/src/pages/pay/PayrollIssuing.jsx`
- `frontend/src/pages/pay/PayrollLeavePanel.jsx`
- `frontend/src/pages/pay/PayrollLifecycle.jsx`
- `frontend/src/pages/pay/PayrollOpeningImport.jsx`
- `frontend/src/pages/pay/PayrollPayslip.jsx`
- `frontend/src/pages/pay/PayrollPortalRequirements.jsx`
- `frontend/src/pages/pay/PayrollRateImport.jsx`
- `frontend/src/pages/pay/PayrollReadiness.jsx`
- `frontend/src/pages/pay/payrollReadinessChecks.js`
- `frontend/src/pages/pay/payrollReportHelpers.js`
- `frontend/src/pages/pay/PayrollReportPage.jsx`
- `frontend/src/pages/pay/PayrollReports.jsx`
- `frontend/src/pages/pay/PayrollRuleSettings.jsx`
- `frontend/src/pages/pay/PayrollRunCategories.jsx`
- `frontend/src/pages/pay/PayrollRunRegister.jsx`
- `frontend/src/pages/pay/PayrollShiftInputs.jsx`
- `frontend/src/pages/pay/PayrollStpReadiness.jsx`
- `frontend/src/pages/pay/PayrollSuperFundSettings.jsx`
- `frontend/src/pages/pay/payrollTheme.css`
- `frontend/src/pages/pay/PayrollTimeApprovals.jsx`
- `frontend/src/pages/pay/PayrollTimesheetDays.jsx`
- `frontend/src/pages/pay/PayrollWorkTypes.jsx`
- `frontend/src/pages/pay/payrun.css`
- `frontend/src/pages/pay/payRunAdapter.js`
- `frontend/src/pages/pay/PayRunEmployee.jsx`
- `frontend/src/pages/pay/PayRunEmployee.test.jsx`
- `frontend/src/pages/pay/PaySettings.jsx`
- `frontend/src/pages/pay/PayShell.jsx`
- `frontend/src/pages/pay/PayTimesheets.jsx`
- `frontend/src/pages/pay/PayWorkbench.company.test.jsx`
- `frontend/src/pages/pay/PayWorkbench.jsx`
- `mobile/app/payslips.tsx`
- `mobile/app/timesheets.tsx`
- `mobile/src/services/leave.ts`
- `mobile/src/services/payslips.ts`
- `mobile/src/services/timesheets.ts`

## API declarations and permission dependencies

Mount: server.py mounts payroll.router and payroll.me_router under /api. Router prefixes and include_router statements below supply the prefixes for relative paths. This inventory includes each payroll API declaration and its source line.

### payroll.py
- L41: `router = APIRouter(prefix="/payroll", tags=["payroll"])`
- L43: `router.include_router(workbench_router)`
- L45: `router.include_router(banking_router)`
- L47: `router.include_router(employee_records_router)`
- L48: `me_router = APIRouter(prefix="/me/payroll", tags=["payroll-me"])`
- L736: `me_router.include_router(segments_phone)`
- L737: `router.include_router(segments_office)`
- L740: `me_router.include_router(worker_payslips_router)`
- L103: `router.get('/settings')` → `read_settings`; defaults: `Depends(require_permission('payroll', 'view'))`
- L108: `router.put('/settings')` → `write_settings`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L188: `router.get('/periods')` → `list_periods`; defaults: `Query(3, ge=0, le=24), Depends(require_permission('payroll', 'view'))`
- L215: `router.post('/periods/{period_id}/close')` → `close_period`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L236: `router.post('/periods/{period_id}/reopen')` → `reopen_period`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L264: `router.get('/profiles')` → `list_profiles`; defaults: `Depends(require_permission('payroll', 'view'))`
- L286: `router.put('/profiles/{worker_id}')` → `put_profile`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L367: `router.get('/timesheets')` → `list_timesheets`; defaults: `None, None, None, None, Depends(require_permission('payroll', 'view'))`
- L399: `router.post('/timesheets')` → `create_timesheet`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L415: `router.patch('/timesheets/{entry_id}')` → `patch_timesheet`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L436: `router.delete('/timesheets/{entry_id}')` → `delete_timesheet`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L453: `router.post('/timesheets/approve')` → `approve_timesheets`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L466: `router.post('/timesheets/reject')` → `reject_timesheets`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L479: `router.post('/timesheets/prefill')` → `prefill_from_signons`; defaults: `None, Depends(require_permission('payroll', 'edit'))`
- L611: `router.get('/summary')` → `summary`; defaults: `None, Depends(require_permission('payroll', 'view'))`
- L618: `router.get('/export')` → `export_csv`; defaults: `Query('summary', pattern='^(summary|daily)$'), Depends(require_permission('payroll', 'view'))`
- L664: `me_router.get('/timesheets')` → `my_timesheets`; defaults: `None, Depends(get_current_user)`
- L692: `me_router.put('/timesheets/{day}')` → `my_upsert`; defaults: `Depends(get_current_user)`
- L715: `me_router.post('/submit')` → `my_submit`; defaults: `None, Depends(get_current_user)`

### payroll_aba.py

### payroll_access.py

### payroll_award_settings.py
- L8: `router=APIRouter(prefix='/configuration/awards',tags=['payroll-configuration'])`
- L22: `router.get('')` → `read`; defaults: `Depends(require_permission('payroll', 'view'))`
- L25: `router.put('')` → `save`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L40: `router.get('/employee-summary')` → `employee_summary`; defaults: `Depends(require_permission('payroll', 'view'))`

### payroll_balance_import.py
- L11: `router = APIRouter(prefix='/opening-import', tags=['payroll-opening-balances'])`
- L15: `router.get('/template')` → `template`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L19: `router.post('/preview')` → `preview`; defaults: `File(...), Form(...), Form(...), Depends(require_permission('payroll', 'edit'))`

### payroll_banking.py
- L22: `router=APIRouter(prefix='/banking', tags=['payroll-banking'])`
- L93: `router.get('/employer')` → `get_employer`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L98: `router.put('/employer')` → `set_employer`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L102: `router.get('/workers/{worker_id}')` → `get_bank`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L108: `router.put('/workers/{worker_id}')` → `set_bank`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L148: `router.get('/batch/{week}')` → `preview_batch`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L157: `router.post('/batch/{week}/download')` → `download_batch`; defaults: `Depends(require_permission('payroll', 'edit'))`

### payroll_branding.py
- L9: `router=APIRouter(prefix='/branding',tags=['payroll-branding'])`
- L55: `router.get('')` → `load`; defaults: `Depends(require_permission('payroll', 'view'))`
- L60: `router.put('')` → `save`; defaults: `Depends(require_permission('payroll', 'edit'))`

### payroll_catalog_settings.py
- L11: `router=APIRouter(prefix='/configuration/catalog',tags=['payroll-configuration'])`
- L46: `router.get('/{kind}')` → `read`; defaults: `Depends(require_permission('payroll', 'view'))`
- L51: `router.post('/{kind}/preview')` → `preview`; defaults: `File(...), Depends(require_permission('payroll', 'edit'))`
- L65: `router.put('/{kind}')` → `save`; defaults: `Depends(require_permission('payroll', 'edit'))`

### payroll_completion.py
- L10: `router=APIRouter()`
- L28: `router.get('/{week}/completion')` → `status`; defaults: `Depends(require_permission('payroll', 'view'))`
- L47: `router.post('/{week}/completion/{kind}')` → `record`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L63: `router.post('/{week}/close-run')` → `close`; defaults: `Depends(require_permission('payroll', 'edit'))`

### payroll_delivery.py
- L11: `router = APIRouter()`
- L25: `router.get('/delivery/settings')` → `settings`; defaults: `Depends(require_permission('payroll', 'view'))`
- L31: `router.put('/delivery/settings')` → `configure`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L56: `router.post('/{week}/complete')` → `complete`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L81: `router.get('/{week}/delivery/{revision}')` → `batch_status`; defaults: `Depends(require_permission('payroll', 'view'))`
- L92: `router.post('/{week}/delivery/{revision}/{worker_id}')` → `dispatch`; defaults: `Depends(require_permission('payroll', 'edit'))`

### payroll_employee_records.py
- L12: `router=APIRouter(prefix='/employee-records',tags=['payroll-employee-records'])`
- L120: `router.include_router(rate_import_router, prefix='')`
- L124: `router.include_router(catalog_settings_router)`
- L127: `router.include_router(work_types_router)`
- L130: `router.include_router(fund_settings_router)`
- L133: `router.include_router(balance_import_router)`
- L136: `router.include_router(award_settings_router)`
- L139: `router.include_router(stp_readiness_router)`
- L47: `router.post('/fund/check')` → `check_fund`; defaults: `Depends(require_permission('payroll', 'view'))`
- L52: `router.get('/{worker_id}')` → `load`; defaults: `Depends(require_permission('payroll', 'view'))`
- L57: `router.put('/{worker_id}')` → `save`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L83: `router.get('/{worker_id}/opening-balances/{week}')` → `opening_at`; defaults: `Depends(require_permission('payroll', 'view'))`
- L91: `router.get('/{worker_id}/pay-context/{week}')` → `pay_context`; defaults: `Depends(require_permission('payroll', 'view'))`

### payroll_engine.py

### payroll_fund_lookup.py

### payroll_fund_settings.py
- L8: `router=APIRouter(prefix='/configuration/super-funds',tags=['payroll-configuration'])`
- L40: `router.get('')` → `read`; defaults: `Depends(require_permission('payroll', 'view'))`
- L42: `router.post('/check')` → `check`; defaults: `Depends(require_permission('payroll', 'view'))`
- L49: `router.put('')` → `save`; defaults: `Depends(require_permission('payroll', 'edit'))`

### payroll_lifecycle.py
- L10: `router=APIRouter()`
- L21: `router.get('/{week}/lifecycle')` → `state`; defaults: `Depends(require_permission('payroll', 'view'))`
- L29: `router.post('/{week}/finalize')` → `finalize`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L63: `router.post('/{week}/reopen')` → `reopen`; defaults: `Depends(require_permission('payroll', 'edit'))`

### payroll_opening_balances.py

### payroll_owner_bootstrap.py

### payroll_payslip_document.py

### payroll_payslips.py
- L13: `router=APIRouter()`
- L22: `router.get('/{week}/payslips/status')` → `status`; defaults: `Depends(require_permission('payroll', 'view'))`
- L30: `router.post('/{week}/payslips/issue')` → `issue`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L69: `router.get('/{week}/payslips/{revision}/{worker_id}')` → `download`; defaults: `Depends(require_permission('payroll', 'view'))`
- L78: `router.get('/{week}/payslips/{revision}/{worker_id}/pdf')` → `download_pdf`; defaults: `Depends(require_permission('payroll', 'view'))`

### payroll_rate_import.py
- L8: `router=APIRouter(prefix='/import',tags=['payroll-import'])`
- L74: `router.post('/preview')` → `preview`; defaults: `File(...), File(...), Form('{}'), Form('{}'), Depends(require_permission('payroll', 'edit'))`

### payroll_roster.py

### payroll_run_register.py
- L11: `router = APIRouter()`
- L38: `router.get('/register/list')` → `register`; defaults: `Depends(require_permission('payroll', 'view'))`
- L50: `router.get('/portals/requirements')` → `requirements`; defaults: `Depends(require_permission('payroll', 'view'))`
- L55: `router.put('/portals/requirements/{kind}')` → `save_requirements`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L70: `router.post('/{week}/portal-receipts/{kind}')` → `receipt`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L96: `router.get('/access/list')` → `access_list`; defaults: `Depends(require_permission('payroll', 'view'))`
- L115: `router.post('/access/{user_id}/invite')` → `invite_access`; defaults: `None, Depends(require_permission('payroll', 'view'))`

### payroll_segments.py
- L13: `phone = APIRouter()`
- L14: `office = APIRouter()`
- L134: `phone.get('/time-catalog')` → `my_catalog`; defaults: `Depends(get_current_user)`
- L146: `phone.put('/timesheets/{day}/segments')` → `save_segments`; defaults: `Depends(get_current_user)`
- L179: `office.get('/time-catalog')` → `office_catalog`; defaults: `Depends(require_permission('payroll', 'view'))`
- L183: `office.post('/timesheets/{entry_id}/segments/{segment_id}/match')` → `match_client`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L211: `office.post('/timesheets/{entry_id}/review')` → `review_day`; defaults: `Depends(require_permission('payroll', 'edit'))`

### payroll_shift_rules.py

### payroll_stp_readiness.py
- L9: `router=APIRouter(prefix='/configuration/stp-readiness',tags=['payroll-configuration'])`
- L11: `router.get('')` → `read`; defaults: `Depends(require_permission('payroll', 'view'))`

### payroll_submissions.py

### payroll_work_types.py
- L10: `router=APIRouter(prefix='/configuration/work-types',tags=['payroll-configuration'])`
- L32: `router.get('')` → `read`; defaults: `Depends(require_permission('payroll', 'view'))`
- L34: `router.put('')` → `save`; defaults: `Depends(require_permission('payroll', 'edit'))`

### payroll_workbench.py
- L17: `router = APIRouter(prefix="/workbench", tags=["payroll-review"])`
- L19: `router.include_router(branding_router)`
- L21: `router.include_router(register_router)`
- L592: `router.include_router(lifecycle_router)`
- L595: `router.include_router(payslips_router)`
- L598: `router.include_router(delivery_router)`
- L601: `router.include_router(completion_router)`
- L207: `router.get('/{week}/archive')` → `archived_runs`; defaults: `Depends(require_permission('payroll', 'view'))`
- L213: `router.post('/{week}/archive')` → `archive_run`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L242: `router.get('/calculation/settings')` → `calculation_settings`; defaults: `Depends(require_permission('payroll', 'view'))`
- L250: `router.put('/calculation/settings')` → `save_calculation_settings`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L260: `router.get('/connections/settings')` → `connections`; defaults: `Depends(require_permission('payroll', 'view'))`
- L265: `router.put('/connections/settings')` → `save_connections`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L388: `router.get('/{week}/approved-leave')` → `leave_feed`; defaults: `Depends(require_permission('payroll', 'view'))`
- L392: `router.get('/{week}/history')` → `history`; defaults: `Depends(require_permission('payroll', 'view'))`
- L410: `router.post('/out-of-cycle/create')` → `create_extra_run`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L432: `router.get('/employees/list')` → `employee_list`; defaults: `Depends(require_permission('payroll', 'view'))`
- L436: `router.get('/runs/list')` → `runs`; defaults: `Depends(require_permission('payroll', 'view'))`
- L446: `router.get('/{week}/submissions')` → `submitted_hours`; defaults: `Depends(require_permission('payroll', 'view'))`
- L454: `router.get('/{week}')` → `load`; defaults: `Depends(require_permission('payroll', 'view'))`
- L527: `router.post('/{week}/preview')` → `preview`; defaults: `Depends(require_permission('payroll', 'view'))`
- L542: `router.put('/{week}')` → `save`; defaults: `Depends(require_permission('payroll', 'edit'))`
- L566: `router.get('/{week}/report/{kind}')` → `export`; defaults: `Depends(require_permission('payroll', 'view'))`

### payroll_worker_payslips.py
- L8: `router=APIRouter()`
- L19: `router.get('/payslips')` → `list_payslips`; defaults: `Depends(get_current_user)`
- L24: `router.get('/payslips/{week}/{revision}')` → `detail`; defaults: `Depends(get_current_user)`
- L32: `router.get('/payslips/{week}/{revision}/pdf')` → `pdf`; defaults: `Depends(get_current_user)`

## Collections referenced by payroll modules

`integration_configs`, `leave_requests`, `pay_bank_details`, `pay_bank_exports`, `pay_branding`, `pay_calculation_settings`, `pay_configuration`, `pay_connection_settings`, `pay_delivery_settings`, `pay_employee_records`, `pay_payslip_batches`, `pay_payslip_delivery`, `pay_periods`, `pay_profiles`, `pay_review_sheets`, `pay_run_archive`, `pay_settings`, `payroll_access`, `simpro_jobs`, `site_signons`, `timesheet_entries`, `users`, `workers`

## Screens

Web route tree: frontend/src/App.js /app/pay and PayShell.jsx. Overview, workbench, reports, super, employees, provider connections, timesheet approvals, settings, award rates and access. Nested controls cover banking, issuing, corrections, receipts, imports and catalog/rule editing. Phone: /timesheets and /payslips; related /leave UI and shared authentication.

## Jobs and external boundaries

server.py calls ensure_payroll_indexes and configures owner access at startup. Payroll delivery creates mail-outbox work; completion captures manually verified external bank/STP/super receipts. No autonomous STP sender or super payment job established in this audit. Shared mail delivery, session expiry, leave integration and backup code require separate review. API families: /api/payroll and /api/me/payroll. External dependencies: MongoDB, Simpro roster/jobs, mail provider, fund lookup; bank/STP/clearing-house operations remain external.

## Test inventory

- `backend/tests/payroll_isolated/test_payroll_access_invite.py`
- `backend/tests/payroll_isolated/test_payroll_api.py`
- `backend/tests/payroll_isolated/test_payroll_archive.py`
- `backend/tests/payroll_isolated/test_payroll_award_summary.py`
- `backend/tests/payroll_isolated/test_payroll_balance_import.py`
- `backend/tests/payroll_isolated/test_payroll_branding.py`
- `backend/tests/payroll_isolated/test_payroll_casual_rates.py`
- `backend/tests/payroll_isolated/test_payroll_catalog.py`
- `backend/tests/payroll_isolated/test_payroll_completion.py`
- `backend/tests/payroll_isolated/test_payroll_draft_rates.py`
- `backend/tests/payroll_isolated/test_payroll_employee_records.py`
- `backend/tests/payroll_isolated/test_payroll_extra_runs.py`
- `backend/tests/payroll_isolated/test_payroll_flow.py`
- `backend/tests/payroll_isolated/test_payroll_fund_settings.py`
- `backend/tests/payroll_isolated/test_payroll_history.py`
- `backend/tests/payroll_isolated/test_payroll_lifecycle.py`
- `backend/tests/payroll_isolated/test_payroll_office_review.py`
- `backend/tests/payroll_isolated/test_payroll_opening.py`
- `backend/tests/payroll_isolated/test_payroll_owner_api.py`
- `backend/tests/payroll_isolated/test_payroll_owner_bootstrap.py`
- `backend/tests/payroll_isolated/test_payroll_panel.py`
- `backend/tests/payroll_isolated/test_payroll_payslips.py`
- `backend/tests/payroll_isolated/test_payroll_phone.py`
- `backend/tests/payroll_isolated/test_payroll_rate_import.py`
- `backend/tests/payroll_isolated/test_payroll_register.py`
- `backend/tests/payroll_isolated/test_payroll_rule_settings.py`
- `backend/tests/payroll_isolated/test_payroll_shift_rules.py`
- `backend/tests/payroll_isolated/test_payroll_simpro_flow.py`
- `backend/tests/payroll_isolated/test_payroll_work_types.py`
- `backend/tests/test_payroll_aba.py`
- `backend/tests/test_payroll_access.py`
- `backend/tests/test_payroll_engine.py`
- `backend/tests/test_payroll_maths.py`
- `frontend/src/pages/pay/PayRunEmployee.test.jsx`
- `frontend/src/pages/pay/PayWorkbench.company.test.jsx`
