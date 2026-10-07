"""Opening balance preview for current employees. Saving uses the audited employee API."""
import csv
import io
from datetime import date
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from permissions import require_permission
from payroll_rate_import import workbook, norm
from payroll_roster import roster
from db import db

router = APIRouter(prefix='/opening-import', tags=['payroll-opening-balances'])
FIELDS = ['Worker ID', 'Employee', 'Annual Leave Hours', 'Personal Leave Hours', 'YTD Gross', 'YTD PAYG', 'YTD Super']

@router.get('/template')
async def template(user=Depends(require_permission('payroll','edit'))):
    return {'columns': FIELDS, 'rows': [[w['id'], w['name'], '', '', '', '', ''] for w in await roster(user['org_id'])]}

@router.post('/preview')
async def preview(file: UploadFile=File(...), as_at: date=Form(...), reason: str=Form(...), user=Depends(require_permission('payroll','edit'))):
    from payroll_employee_records import public, OpeningBalances
    if not reason.strip() or len(reason)>300:
        raise HTTPException(422, 'Enter an import source or reason (up to 300 characters)')
    if (file.filename or '').lower().endswith('.csv'):
        raw = await file.read(5_000_001)
        if len(raw)>5_000_000: raise HTTPException(422, 'File must be smaller than 5 MB')
        try: rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
        except (UnicodeError, csv.Error): raise HTTPException(422, 'Use a UTF-8 CSV or XLSX file')
    else:
        books = await workbook(file)
        if len(books)!=1: raise HTTPException(422, 'Use one worksheet for opening balances')
        rows = next(iter(books.values()))
    if not rows or len(rows)>10001 or list(rows[0])!=FIELDS:
        raise HTTPException(422, 'Use the opening balances template headers, with at most 10,000 employees')
    current = {w['id']:w for w in await roster(user['org_id'])}
    ready, errors, seen = [], [], set()
    for index, values in enumerate(rows[1:],2):
        if not any(v not in (None,'') for v in values): continue
        source = dict(zip(FIELDS, values))
        wid = str(source.get('Worker ID') or '').strip()
        name = str(source.get('Employee') or '').strip()
        problem = None
        if wid not in current: problem = 'Worker ID is not a current Simpro employee'
        elif norm(name)!=norm(current[wid]['name']): problem = 'Employee name does not match this Worker ID; download a fresh template'
        elif wid in seen: problem = 'Duplicate employee; remove duplicate rows before importing'
        seen.add(wid)
        if problem:
            errors.append({'row':index,'name':name,'error':problem}); continue
        try:
            def value(column):
                v=source.get(column)
                return None if v in (None,'') else float(v)
            opening = OpeningBalances(as_at=as_at, annual_hours=value('Annual Leave Hours'),
                personal_hours=value('Personal Leave Hours'), ytd_gross=value('YTD Gross'),
                ytd_payg=value('YTD PAYG'), ytd_super=value('YTD Super'),
                source='Global opening balances import', reason=reason.strip()).model_dump(mode='json')
        except (ValueError, TypeError):
            errors.append({'row':index,'name':name,'error':'Enter non-negative leave hours and valid YTD amounts. Leave hours are required; blank YTD stays unknown.'}); continue
        old = public(await db.pay_employee_records.find_one({'_id':f"{user['org_id']}:{wid}"}))
        ready.append({'worker_id':wid,'name':current[wid]['name'],'revision':old['revision'],
            'profile':old['profile'],'opening_balances':opening,'previous':old['opening_balances']})
    return {'rows':ready,'errors':errors,'as_at':as_at.isoformat(),
        'financial_year':f'{as_at.year if as_at.month>=7 else as_at.year-1}/{(as_at.year if as_at.month>=7 else as_at.year-1)+1}'}
