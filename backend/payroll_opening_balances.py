"""Dated employee opening balances; only issued consecutive runs carry leave forward."""
from datetime import date,timedelta
from db import db
from payroll_banking import decrypt

async def leave_at(org, worker, week):
    doc=await db.pay_employee_records.find_one({'_id':f'{org}:{worker}'})
    opening=decrypt(doc).get('opening_balances') if doc else None
    if not opening: return {'available':False,'reason':'No dated opening balances saved'}
    cursor=date.fromisoformat(opening['as_at']);target=date.fromisoformat(week[:10])
    if cursor>target:return {'available':False,'reason':'Opening balance date is later than this pay week'}
    annual=opening['annual_hours'];personal=opening['personal_hours']
    while cursor<target:
        run=await db.pay_review_sheets.find_one({'_id':f'{org}:{cursor.isoformat()}'}) or {}
        revision=run.get('worksheet',{}).get('revision')
        if not run.get(f'issued_{revision}') or run.get('state')!='finalized':
            return {'available':False,'reason':f'No issued pay run starting {cursor.isoformat()}; reconcile the dated balance before using it'}
        row=next((r for r in run.get('report',{}).get('rows',[]) if r['worker_id']==worker),None)
        entry=next((r.get('entry',{}) for r in run.get('worksheet',{}).get('rows',[]) if r['worker_id']==worker),None)
        if row is None or entry is None:return {'available':False,'reason':'An earlier issued run has no balance movement for this employee'}
        result=row['result']
        annual+=result['annual_accrued']-entry.get('annual',0)
        personal+=result['personal_accrued']-entry.get('personal',0)
        # Supplementary issued earnings accrue only their additional ordinary hours.
        async for extra in db.pay_review_sheets.find({'org_id':org,'state':'finalized','worksheet.out_of_cycle':True}):
            if extra['week'][:10]!=cursor.isoformat():continue
            rev=extra.get('worksheet',{}).get('revision')
            if not extra.get(f'issued_{rev}'):continue
            line=next((r for r in extra.get('report',{}).get('rows',[]) if r['worker_id']==worker),None)
            if line:
                annual+=line['result']['annual_accrued'];personal+=line['result']['personal_accrued']
        cursor+=timedelta(days=7)
    if cursor!=target or annual<0 or personal<0:return {'available':False,'reason':'Reconcile the balance date and intervening pay runs'}
    return {'available':True,'as_at':week,'source_date':opening['as_at'],
            'opening_annual':round(annual,6),'opening_personal':round(personal,6)}
