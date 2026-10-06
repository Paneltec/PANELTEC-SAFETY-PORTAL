"""Client/job segments inside the canonical worker/day timesheet record."""
from datetime import date, timedelta
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError
from auth import get_current_user
from db import db
from models import now_iso
from permissions import require_permission

phone = APIRouter()
office = APIRouter()
CATEGORIES = {'yard': 'Yard / Workshop', 'travel': 'Travel', 'training': 'Training', 'office': 'Office'}

class Segment(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    category: str = Field('client', pattern='^(client|yard|travel|training|office|unmatched)$')
    client_key: str = Field('', max_length=160)
    client_name: str = Field('', max_length=160)
    job_id: str = Field('', max_length=100)
    start: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    finish: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    break_minutes: int = Field(0, ge=0, le=600)
    notes: str = Field('', max_length=1000)

class DaySegments(BaseModel):
    revision: int = Field(0, ge=0)
    segments: list[Segment] = Field(default_factory=list, max_length=40)

def minutes(value):
    h, m = value.split(':')
    return int(h)*60+int(m)

def aggregate(segments):
    ordered = sorted(segments, key=lambda s: s['start'])
    previous = -1
    total = 0
    ids = set()
    for s in ordered:
        # Validate stored data too; hours are always calculated on the server.
        Segment(**s)
        start, end = minutes(s['start']), minutes(s['finish'])
        if s['id'] in ids: raise HTTPException(422, 'Duplicate time entry')
        ids.add(s['id'])
        if end <= start: raise HTTPException(422, 'Finish must be later than start on the same day')
        if start < previous: raise HTTPException(422, 'Times overlap. Adjust the start or finish before saving.')
        net = end-start-s['break_minutes']
        if net <= 0: raise HTTPException(422, 'Break must be shorter than the time worked')
        previous = end
        total += net
        s['hours'] = round(net/60, 4)
    return {'segments': ordered, 'hours': round(total/60, 4),
            'start': ordered[0]['start'] if ordered else None,
            'finish': ordered[-1]['finish'] if ordered else None,
            'break_minutes': sum(s['break_minutes'] for s in ordered),
            'site_name': ', '.join(dict.fromkeys(s['client_name'] for s in ordered)),
            'job_ref': ', '.join(dict.fromkeys(s['job_ref'] for s in ordered if s.get('job_ref')))}

async def catalog(org):
    config = await db.integration_configs.find_one({'org_id': org, 'kind': 'simpro'}) or {}
    clients = {}
    for c in config.get('customers_cache') or []:
        if not c.get('active', True) or not c.get('simpro_customer_id'): continue
        company, cid = str(c.get('simpro_company_id') or ''), str(c['simpro_customer_id'])
        key = f"{company}:{c.get('type', 'Company')}:{cid}"
        clients[key] = {'key': key, 'name': str(c.get('name') or c.get('company_name') or 'Unnamed client'),
                        'company': company, 'customer_id': cid, 'jobs': []}
    async for j in db.simpro_jobs.find({'org_id': org, 'status_bucket': 'active'}):
        candidates = [c for c in clients.values() if c['company'] == str(j.get('company_id') or '') and
                      (c['customer_id'] == str(j['simpro_customer_id']) if j.get('simpro_customer_id') else
                       c['name'].strip().casefold() == str(j.get('customer_name') or '').strip().casefold())]
        # Older imports have names only. Never guess between duplicate client names.
        if len(candidates) == 1:
            candidates[0]['jobs'].append({'id': str(j['id']), 'number': str(j.get('simpro_job_id') or ''),
                                         'name': str(j.get('name') or ''), 'site': str(j.get('site_name') or '')})
    return sorted(clients.values(), key=lambda c: c['name'].casefold())

async def unlocked(org, day):
    d = date.fromisoformat(day)
    week = (d-timedelta(days=d.weekday())).isoformat()
    run = await db.pay_review_sheets.find_one({'_id': f'{org}:{week}'})
    if run and run.get('state') == 'finalized':
        raise HTTPException(409, 'Payroll is finalized. Ask the pay officer to open a correction.')

async def resolve(segments, org, old=()):
    clients = {c['key']: c for c in await catalog(org)}
    old_by_id = {s['id']: s for s in old}
    out = []
    for model in segments:
        s = model.model_dump()
        s['job_ref'] = ''
        if s['category'] in CATEGORIES:
            s.update(client_name=CATEGORIES[s['category']], client_key='', job_id='')
        elif s['category'] == 'unmatched':
            if not s['client_name'].strip(): raise HTTPException(422, 'Enter the client name for the office to match')
            s.update(client_name=s['client_name'].strip(), client_key='', job_id='', needs_matching=True)
        else:
            prior = old_by_id.get(s['id'], {})
            # Keep historical client/job labels if the same selection is now archived.
            if prior.get('category') == 'client' and prior.get('client_key') == s['client_key'] and prior.get('job_id', '') == s['job_id']:
                s.update(client_name=prior['client_name'], job_ref=prior.get('job_ref', ''))
            else:
                c = clients.get(s['client_key'])
                if not c: raise HTTPException(422, 'Client is no longer available. Select a client again.')
                s['client_name'] = c['name']
                if s['job_id']:
                    job = next((j for j in c['jobs'] if j['id'] == s['job_id']), None)
                    if not job: raise HTTPException(422, 'Select an open job belonging to this client')
                    s['job_ref'] = job['number']
            s['needs_matching'] = False
        out.append(s)
    return out

@phone.get('/time-catalog')
async def my_catalog(user=Depends(get_current_user)):
    from payroll import _my_worker_id
    wid = await _my_worker_id(user)
    recent = []
    async for day in db.timesheet_entries.find({'org_id': user['org_id'], 'worker_id': wid}).sort([('date', -1)]):
        for s in day.get('segments', []):
            key = s.get('client_key')
            if key and key not in recent: recent.append(key)
        if len(recent) >= 8: break
    return {'clients': await catalog(user['org_id']), 'recent': recent[:8], 'categories': CATEGORIES}

@phone.put('/timesheets/{day}/segments')
async def save_segments(day: str, body: DaySegments, user=Depends(get_current_user)):
    from payroll import _my_worker_id, _parse_date, _compute, get_settings
    _parse_date(day)
    wid = await _my_worker_id(user)
    await unlocked(user['org_id'], day)
    key = {'org_id': user['org_id'], 'worker_id': wid, 'date': day}
    old = await db.timesheet_entries.find_one(key)
    if old and old.get('status') not in ('draft', 'rejected'):
        raise HTTPException(409, 'Sent days are locked. Ask the office to send this day back.')
    if old and old.get('kind', 'work') != 'work':
        raise HTTPException(409, 'This is a leave or non-work day. Ask the office to correct it.')
    if body.revision != (old or {}).get('revision', 0):
        raise HTTPException(409, 'This day changed on another device. Reload the week before editing.')
    segments = await resolve(body.segments, user['org_id'], (old or {}).get('segments', []))
    row = {**(old or {}), **key, **aggregate(segments), 'kind': 'work', 'status': 'draft',
           'revision': body.revision+1, 'updated_at': now_iso(), 'updated_by': user['id']}
    row.pop('_id', None)
    if not old: row.update(id=str(uuid4()), source='worker', created_by=user['id'], created_at=now_iso(), allowances=[], notes='')
    _compute(row, await get_settings(user['org_id']))
    if old:
        result = await db.timesheet_entries.replace_one({**key, 'revision': old.get('revision'), 'status': old['status'], 'updated_at': old.get('updated_at')}, row)
        if not result.matched_count: raise HTTPException(409, 'Day changed while saving. Reload and try again.')
    else:
        try: await db.timesheet_entries.insert_one(dict(row))
        except DuplicateKeyError: raise HTTPException(409, 'Day was saved on another device. Reload and try again.')
    return row

class MatchClient(BaseModel):
    revision: int = Field(ge=0)
    client_key: str = Field(min_length=1, max_length=160)
    job_id: str = Field('', max_length=100)

@office.get('/time-catalog')
async def office_catalog(user=Depends(require_permission('payroll', 'view'))):
    return {'clients': await catalog(user['org_id'])}

@office.post('/timesheets/{entry_id}/segments/{segment_id}/match')
async def match_client(entry_id: str, segment_id: str, body: MatchClient, user=Depends(require_permission('payroll', 'edit'))):
    from payroll import _entry_or_404
    row = await _entry_or_404(user['org_id'], entry_id)
    await unlocked(user['org_id'], row['date'])
    if row.get('status') == 'locked': raise HTTPException(409, 'Day is locked')
    if row.get('revision', 0) != body.revision: raise HTTPException(409, 'Reload changed timesheet first')
    segment = next((s for s in row.get('segments', []) if s['id'] == segment_id), None)
    if not segment or segment.get('category') != 'unmatched': raise HTTPException(422, 'Choose an unmatched client entry')
    updated = (await resolve([Segment(**{**segment, 'category': 'client', 'client_key': body.client_key, 'job_id': body.job_id})], user['org_id']))[0]
    updated['original_client_name'] = segment['client_name']
    row['segments'] = [updated if s['id'] == segment_id else s for s in row['segments']]
    row.update(aggregate(row['segments']))
    row.update(revision=body.revision+1, updated_at=now_iso(), matched_by=user['id'])
    row.pop('_id', None)
    result = await db.timesheet_entries.replace_one({'org_id': user['org_id'], 'id': entry_id, 'revision': body.revision, 'status': row['status']}, row)
    if not result.matched_count: raise HTTPException(409, 'Day changed while matching. Reload first.')
    return row
