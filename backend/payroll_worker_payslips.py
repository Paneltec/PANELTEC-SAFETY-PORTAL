"""Authenticated workers can see only their own issued, immutable payslips."""
from fastapi import APIRouter,Depends,HTTPException
from fastapi.responses import Response
from auth import get_current_user
from db import db
from payroll_roster import my_worker

router=APIRouter()
async def own_payslips(user):
    worker=await my_worker(user);items=[]
    async for doc in db.pay_review_sheets.find({'org_id':user['org_id']}):
        for snapshot in doc.get('finalizations',[]):
            issued=doc.get(f"issued_{snapshot['revision']}")
            if issued and any(r['worker_id']==worker for r in snapshot['report']['rows']):
                items.append((doc['week'],snapshot,issued,worker))
    return sorted(items,key=lambda v:(v[2]['paid_date'],v[1]['revision']),reverse=True)

@router.get('/payslips')
async def list_payslips(response:Response,user=Depends(get_current_user)):
    response.headers['Cache-Control']='no-store'
    return {'payslips':[{'week':week,'revision':snapshot['revision'],'paid_date':issued['paid_date'],'net':next(r['result']['net'] for r in snapshot['report']['rows'] if r['worker_id']==worker)} for week,snapshot,issued,worker in await own_payslips(user)]}

@router.get('/payslips/{week}/{revision}')
async def detail(week:str,revision:int,response:Response,user=Depends(get_current_user)):
    response.headers['Cache-Control']='no-store'
    from payroll_payslip_document import statement
    for w,s,i,worker in await own_payslips(user):
        if w==week and s['revision']==revision:return statement(s,worker,w,i)
    raise HTTPException(404,'Your issued payslip was not found')

@router.get('/payslips/{week}/{revision}/pdf')
async def pdf(week:str,revision:int,user=Depends(get_current_user)):
    from payroll_payslip_document import render_pdf
    for w,s,i,worker in await own_payslips(user):
        if w==week and s['revision']==revision:return Response(render_pdf(s,worker,w,i),media_type='application/pdf',headers={'Cache-Control':'no-store','Content-Disposition':f'attachment; filename="payslip-{week}-r{revision}.pdf"'})
    raise HTTPException(404,'Your issued payslip was not found')
