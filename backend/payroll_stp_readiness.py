"""Read-only STP preparation checks; never creates or submits a pay event."""
from datetime import date
from fastapi import APIRouter, Depends
from db import db
from models import now_iso
from permissions import require_permission
from payroll_roster import roster
from payroll_banking import decrypt
router=APIRouter(prefix='/configuration/stp-readiness',tags=['payroll-configuration'])
@router.get('')
async def read(as_at:date,user=Depends(require_permission('payroll','view'))):
    org=user['org_id']; brand=await db.pay_branding.find_one({'_id':org}) or {}
    connections=await db.pay_connection_settings.find_one({'_id':org}) or {}
    company=[]
    for fields,label in [(('employer_name',),'Legal employer name'),(('employer_abn',),'Employer ABN'),(('address_line1','suburb','state','postcode'),'Employer address'),(('contact_name','contact_email','contact_phone'),'Payroll contact')]:
        company.append({'label':label,'recorded':all(str(brand.get(k) or '').strip() for k in fields)})
    records={d['worker_id']:d async for d in db.pay_employee_records.find({'org_id':org})}
    fiscal=as_at.year-(as_at.month<7);start=date(fiscal,7,1)
    employees=[]
    for worker in await roster(org):
        doc=records.get(worker['id']);data=decrypt(doc) if doc else {};profile=data.get('profile') or {};opening=data.get('opening_balances') or {}
        issues=[]
        if not doc:issues.append('Employee payroll settings not saved')
        if not data.get('tax_file_number'):issues.append('TFN not recorded; check declaration or applicable exemption')
        if profile.get('employment_type','unconfirmed')=='unconfirmed':issues.append('Employment basis not selected')
        if profile.get('tax_mode','unconfirmed')=='unconfirmed' or not profile.get('tax_declaration_reviewed'):issues.append('Tax declaration and calculation need review')
        elif profile.get('tax_mode')=='manual':issues.append('Manual tax treatment needs provider mapping')
        if not opening:balance='Review whether migration balances are required'
        else:
            try:
                opening_date=date.fromisoformat(opening.get('as_at',''))
                if opening_date>as_at:balance='Opening balance date is after the review date'
                elif opening_date<start:balance='Opening YTD figures are for an earlier financial year'
                elif any(opening.get(k) is None for k in ('ytd_gross','ytd_payg','ytd_super')):balance='Opening gross, PAYG or super total is missing'
                else:balance='Opening totals recorded; category breakdown and reconciliation still required'
            except (ValueError,TypeError):balance='Opening balance date needs review'
        employees.append({'id':worker['id'],'name':worker['name'],'issues':issues,'tfn_recorded':bool(data.get('tax_file_number')),'opening_status':balance})
    blockers=[
      {'title':'Connect the existing STP service','detail':'Confirm your current provider, supported integration, product registration and employer authorisation. Provider notes alone do not connect a service.'},
      {'title':'Build and validate STP Phase 2 reporting','detail':'Map employer and employee identifiers, employment and tax treatment, income types, earnings, leave, allowances, deductions and super into the provider specification.'},
      {'title':'Reconcile migration and year-to-date figures','detail':'Agree the prior BMS ID / payroll ID transition with the provider and accountant. Opening gross, PAYG and super totals alone are not a complete STP migration.'},
      {'title':'Support July 2026 qualifying earnings reporting','detail':'Include year-to-date qualifying earnings under code Q and reconcile super liabilities using the current provider specification.'},
      {'title':'Implement declarations, submissions and verified responses','detail':'Add authorised declarations, pay/update events, duplicate protection, rejection handling and independently received ATO acceptance responses.'},
      {'title':'Implement corrections and annual finalisation','detail':'Support corrected and prior-year events and finalisation for every reportable employee, including employees who have left. Locking a local pay run is not STP finalisation.'}
    ]
    return {'checked_at':now_iso(),'as_at':as_at.isoformat(),'financial_year':f'{fiscal}/{fiscal+1}','ready_to_lodge':False,'connection_status':'not_connected',
      'provider_note':connections.get('stp_provider') or (connections.get('portal_requirements',{}).get('stp',{}).get('provider')) or '',
      'company':company,'employees':employees,'employee_count':len(employees),'employees_needing_review':sum(bool(e['issues']) for e in employees),'blockers':blockers,
      'scope':'Checks saved defaults for current Simpro employees only. Recorded does not mean verified. This does not validate a pay run or inspect past ATO lodgements; former employees must also be reconciled for finalisation.'}
