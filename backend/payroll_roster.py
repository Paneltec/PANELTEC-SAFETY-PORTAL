"""Payroll reads the existing Simpro-linked worker IDs; never creates employees."""
from fastapi import HTTPException
from db import db

def label(value):
    return str(value.get('Name') or value.get('name') or '') if isinstance(value, dict) else str(value or '')

async def roster(org):
    result = []
    identities = set()
    async for worker in db.workers.find({'org_id': org, 'deleted_at': None}):
        snapshot = worker.get('simpro_sync_snapshot') or {}
        employee = snapshot.get('simpro_employee_id') or worker.get('simpro_employee_id')
        if not employee or str(employee) == 'None':
            continue
        # The latest Simpro archive status takes precedence over old local flags.
        active = not snapshot['archived'] if 'archived' in snapshot else worker.get('active', True)
        if not active:
            continue
        company = snapshot.get('company_id') or worker.get('simpro_company_id') or worker.get('company_id') or ''
        identity = (str(company), str(employee))
        if identity in identities:
            raise HTTPException(409, 'Duplicate Simpro employee links exist. Resolve the worker links before creating payroll; historical runs are retained.')
        identities.add(identity)
        # Existing People/Timesheet records display the imported Position field.
        # Prefer an explicit department when supplied; match Traffic Control exactly.
        department = label(snapshot.get('department') or worker.get('department') or snapshot.get('position') or worker.get('position')).strip()
        division = 'viatec' if ' '.join(department.casefold().split()) == 'traffic control' else 'paneltec'
        result.append({**worker, 'name': f"{worker.get('first_name', '')} {worker.get('last_name', '')}".strip() or worker['id'],
                       'department': department, 'division': division, 'active': True, 'simpro_employee_id': str(employee)})
    return sorted(result, key=lambda w: (w['name'].casefold(), w['id']))

def public_roster(rows):
    return [{k: w.get(k, '') for k in ('id', 'name', 'department', 'division', 'simpro_employee_id')} for w in rows]

async def my_worker(user):
    rows = await roster(user['org_id'])
    if user.get('worker_id'):
        matches = [w for w in rows if w['id'] == user['worker_id']]
    else:
        matches = [w for w in rows if w.get('user_id') == user['id']]
        if not matches and user.get('email'):
            matches = [w for w in rows if str(w.get('email') or '').strip().casefold() == user['email'].strip().casefold()]
    if len(matches) != 1:
        raise HTTPException(409, 'Your login must be linked to exactly one current Simpro employee. Ask the office to check the worker link.')
    return matches[0]['id']
