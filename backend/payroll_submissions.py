"""Read-only snapshots of submitted phone times. Office edits stay in the pay run."""
import hashlib
import json
import math
from datetime import date, timedelta
from fastapi import HTTPException
from db import db

async def submissions(org, week):
    if '~' in week:return {}
    end = (date.fromisoformat(week) + timedelta(days=6)).isoformat()
    grouped = {}
    async for row in db.timesheet_entries.find({'org_id': org, 'date': {'$gte': week, '$lte': end}}):
        if row.get('status') not in ('submitted', 'approved', 'locked'):
            continue
        grouped.setdefault(row['worker_id'], []).append({k: row.get(k) for k in
            ('id', 'date', 'kind', 'hours', 'start', 'finish', 'break_minutes', 'estimate', 'allowances', 'notes', 'status', 'updated_at', 'source', 'segments', 'site_name', 'job_ref', 'revision')})
    out = {}
    for worker, rows in grouped.items():
        rows.sort(key=lambda r: (r['date'], str(r['id'])))
        if len({r['date'] for r in rows}) != len(rows):
            raise HTTPException(409, 'Duplicate submitted days must be resolved before importing hours')
        # Keep pre-segment fingerprints stable for existing saved payroll runs.
        hashed = [{k: v for k, v in r.items() if k not in ('site_name', 'job_ref', 'revision', 'segments')} for r in rows]
        for original, hashed_row in zip(rows, hashed):
            if original.get('segments') is not None: hashed_row['segments'] = original['segments']
        digest = hashlib.sha256(json.dumps(hashed, sort_keys=True, default=str).encode()).hexdigest()
        totals = {'ordinary': 0, 'ot1': 0, 'ot2': 0, 'public_holiday': 0}
        notes = []
        for row in rows:
            hours = float(row.get('hours') or 0)
            if not math.isfinite(hours) or not 0 <= hours <= 24:
                raise HTTPException(422, 'Invalid submitted hours; correct the source timesheet first')
            if row['kind'] == 'work':
                estimate = row.get('estimate') or {}
                values = [float(estimate.get(k, 0)) for k in ('ordinary', 'ot_1', 'ot_2')]
                if any(not math.isfinite(v) or v < 0 for v in values) or abs(sum(values)-hours) > .02:
                    raise HTTPException(422, 'Submitted overtime estimates do not match hours; correct the source timesheet first')
                for key, value in zip(('ordinary', 'ot1', 'ot2'), values): totals[key] += value
            elif row['kind'] == 'public_holiday':
                totals['public_holiday'] += hours
            elif hours:
                notes.append(f"{row['date']}: {row['kind']} — {hours:g} hours require allocation by the pay officer")
            if row.get('allowances'):
                notes.append(f"{row['date']}: submitted allowances require pricing and review")
        out[worker] = {'fingerprint': digest, 'days': rows, 'totals': {k: round(v, 2) for k, v in totals.items()}, 'notes': notes}
    return out

async def check_submissions(body, org, week, calculated):
    current = await submissions(org, week)
    for row, output in zip(body.rows, calculated['rows']):
        fingerprint = current.get(row.worker_id, {}).get('fingerprint', '')
        if row.timesheet_fingerprint != fingerprint:
            output['result']['issues'].append('Submitted times changed. Refresh submitted hours and review this employee again.')
            output['result']['review_ready'] = False
    calculated['ready'] = bool(calculated['rows']) and all(r['result']['review_ready'] for r in calculated['rows'])
    return calculated
