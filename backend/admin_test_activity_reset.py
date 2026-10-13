"""Explicit, organisation-scoped test activity reset. Never invoked by startup."""
from datetime import datetime, timedelta, timezone
import uuid
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError
from db import db
from admin_console_pin import _require_admin, unlock, UnlockIn

router = APIRouter(prefix='/admin/test-activity-reset', tags=['test-activity-reset'])
# Master data, credentials, audit trails, files, schedules and integrations are never targets.
TARGETS = {
 'pay_run_archive':'Saved pay-run archives', 'pay_review_sheets':'Pay run worksheets', 'pay_periods':'Pay periods',
 'pay_payslip_batches':'Payslip batches', 'pay_payslip_delivery':'Payslip delivery activity',
 'pay_bank_exports':'Bank export activity', 'timesheet_entries':'Time entries',
 'leave_requests':'Leave requests',
 'asset_service_records':'Fleet service activity',
}
RESET_SCOPE_VERSION = 'preserve-safety-2026-10-13'
KEEP = 'Users, employees, access, settings, rates, integrations, sites, fleet assets, templates, SWMS, schedules, files, backups, audit history, pre-starts, incidents, hazards, inspections, site diaries, submitted forms, daily job assignments and site visitor activity'
def now(): return datetime.now(timezone.utc)
def iso(): return now().isoformat()
def scope(user):
 org=user.get('org_id')
 if not org: raise HTTPException(403, 'An organisation is required.')
 return {'org_id':org}
async def counts(user):
 q=scope(user)
 return {name:await db[name].count_documents(q) for name in TARGETS}
class Execute(BaseModel):
 plan_id:str
 pin:str=Field(min_length=4,max_length=4,repr=False)
 confirmation:str

@router.post('/preview')
async def preview(user:dict=Depends(_require_admin)):
 ids={name:[row['_id'] async for row in db[name].find(scope(user), {'_id':1})] for name in TARGETS}
 amounts={name:len(values) for name,values in ids.items()}
 plan={'id':str(uuid.uuid4()),'org_id':user['org_id'],'actor_id':user['id'],
       'scope_version':RESET_SCOPE_VERSION,'counts':amounts,'ids':ids,'expires_at':(now()+timedelta(minutes=10)).isoformat(),'state':'preview'}
 await db.test_reset_plans.insert_one(plan)
 return {'plan_id':plan['id'],'items':[{'collection':n,'label':TARGETS[n],'count':v} for n,v in amounts.items()],
         'total':sum(amounts.values()),'keeps':KEEP,
         'warning':'Clears ALL listed activity for this organisation, across both companies, not only records named test. Audit history and stored files remain; saved pay-run archives are included in this reset. Pause all data entry and integration imports first.'}

@router.get('/status')
async def status(user:dict=Depends(_require_admin)):
 scope(user)
 job=await db.test_reset_jobs.find_one({'_id':user['org_id']},{'_id':0})
 return job or {'state':'idle'}

async def run_reset(app,user,job_id,ids=None):
 org=user['org_id']; job_filter={'_id':org,'job_id':job_id}
 removed={}; skipped=0
 if ids is None: ids={name:[r['_id'] async for r in db[name].find(scope(user), {'_id':1})] for name in TARGETS}
 try:
  snapshot=await app.state.create_paneltec_snapshot(preserve_existing=True)
  if not snapshot.get('ok') or not snapshot.get('snapshot_id') or not snapshot.get('sha256'):
   raise RuntimeError('backup_unavailable')
  await db.test_reset_jobs.update_one(job_filter,{'$set':{'state':'clearing','snapshot_id':snapshot['snapshot_id'],'updated_at':iso()}})
  for name in TARGETS:
   removed[name]=0
   async for doc in db[name].find({'org_id':org,'_id':{'$in':ids[name]}}):
    # Retain the exact original before removing anything. Concurrent edits fail
    # the whole-document equality predicate and stay in the working collection.
    await db.test_reset_archive.insert_one({'job_id':job_id,'org_id':org,'collection':name,'document':doc,'archived_at':iso()})
    result=await db[name].delete_one({'_id':doc['_id'],'org_id':org,'$expr':{'$eq':['$$ROOT',{'$literal':doc}]}})
    removed[name]+=result.deleted_count
    skipped+=int(not result.deleted_count)
   await db.test_reset_jobs.update_one(job_filter,{'$set':{'removed':removed,'updated_at':iso()}})
  remaining=await counts(user)
  state='completed' if not sum(remaining.values()) and not skipped else 'partial'
  await db.audit_log.insert_one({'id':str(uuid.uuid4()),'org_id':org,'actor_user_id':user['id'],'action':'test_activity_reset','created_at':iso(),'job_id':job_id,'snapshot_id':snapshot['snapshot_id'],'removed':removed,'state':state})
  await db.test_reset_jobs.update_one(job_filter,{'$set':{'state':state,'remaining':remaining,'removed':removed,'updated_at':iso()}})
 except Exception:
  # Never echo exception text: database errors can contain record values.
  await db.test_reset_jobs.update_one(job_filter,{'$set':{'state':'failed','removed':removed,'updated_at':iso(),'message':'Reset stopped. Some activity may remain. Preserve the backup and reset archive; check status before trying again.'}})

@router.post('/execute',status_code=202)
async def execute(body:Execute,request:Request,bg:BackgroundTasks,user:dict=Depends(_require_admin)):
 scope(user)
 if body.confirmation!='RESET TEST ACTIVITY':raise HTTPException(400,'Type RESET TEST ACTIVITY to confirm the listed scope.')
 # Validate the existing PIN on the server for this action, including lockout.
 await unlock(UnlockIn(pin=body.pin),user)
 plan=await db.test_reset_plans.find_one({'id':body.plan_id,'org_id':user['org_id'],'actor_id':user['id'],'state':'preview'})
 if not plan or plan['expires_at']<iso():raise HTTPException(409,'Preview expired. Preview again.')
 if plan.get('scope_version')!=RESET_SCOPE_VERSION or set(plan.get('ids',{}))!=set(TARGETS):raise HTTPException(409,'Reset scope changed. Preview again; safety and job records are protected.')
 if plan['counts']!=await counts(user):raise HTTPException(409,'Activity changed. Pause data entry and preview again.')
 job_id=str(uuid.uuid4())
 try:
  # _id uniqueness prevents two processes from starting resets for the same org.
  result=await db.test_reset_jobs.update_one({'_id':user['org_id'],'state':{'$in':['completed','partial','failed','idle']}},
      {'$set':{'job_id':job_id,'org_id':user['org_id'],'actor_id':user['id'],'state':'backing_up','removed':{},'updated_at':iso()},'$unset':{'snapshot_id':'','remaining':'','message':''}},upsert=True)
 except DuplicateKeyError:raise HTTPException(409,'A reset is already running. Check status; do not start another.')
 used=await db.test_reset_plans.update_one({'id':body.plan_id,'state':'preview'},{'$set':{'state':'used'}})
 if not used.modified_count:
  await db.test_reset_jobs.update_one({'_id':user['org_id'],'job_id':job_id},{'$set':{'state':'failed'}})
  raise HTTPException(409,'This preview has already been used.')
 bg.add_task(run_reset,request.app,user,job_id,plan['ids'])
 return {'job_id':job_id,'state':'backing_up'}
