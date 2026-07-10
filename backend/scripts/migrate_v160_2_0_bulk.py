#!/usr/bin/env python3
"""
v160.2.0 — Bulk migration: apply 6 org rules to every remaining form
template. Templates already on the Standard Header (Vehicle Pre-Use
Inspection & Heavy Vehicle Daily Check) are skipped.

Rules:
  1. Personnel labels → worker_picker + inline_company_toggle
     (Prepared By / Attendee-like → config.multi=True)
  2. Vehicle/plant labels → vehicle_navixy
  3. QR-scan capability already inside vehicle_navixy (Scan-QR CTA)
  4. Insert a `gps` "Location" field with reverse_geocode when missing
  5. Convert all `auto_date` and legacy `date` fields to
     `date` + config.default_today=True
  6. Required-flag rendering already handled at renderer level; this
     migration only sets required=True on Rule-4 inserts.

Guardrails: snapshot every touched template into
`form_templates_backup_v160_1_6` FIRST, and refuse to overwrite an
existing backup (idempotency).

Run:
    cd /app && set -a && source backend/.env && set +a && \
        python3 backend/scripts/migrate_v160_2_0_bulk.py
"""
from __future__ import annotations

import asyncio
import copy
import json
import os
import re
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


SKIP_TEMPLATE_IDS = {
    'af05afa0-0a9a-4ad7-8fe4-74fa1359b6e3',  # Vehicle Pre-Use Inspection
    'be6e01d5-1e98-4d81-bb4a-33fd607f0d20',  # Heavy Vehicle Daily Check
}

COMPANY_OPTIONS = [
    {'label': 'Paneltec Civil', 'simpro_id': '2'},
    {'label': 'Viatec',         'simpro_id': '3'},
]

# ─── Rule 1 — personnel labels ─────────────────────────────────────────
PERSONNEL_PATTERNS = [
    r'\bworker\b', r'\bname\b', r'\bsupervisor\b', r'\boperator\b',
    r'\bprepared by\b', r'\breviewed( by)?\b', r'\bapproved( by)?\b',
    r'\bsigned by\b', r'\bsign[- ]on\b', r'\bperson responsible\b',
    r'\bemergency contact\b', r'\battendee', r'\binductee\b',
    r'\bforeman\b', r'\btrainer\b', r'\btrained by\b',
    r'\bissued by\b', r'\bauthoris(e|ed|ing)( by)?\b',
    r'\bcompleted by\b', r'\bcrew\b',
]
PERSONNEL_RE = re.compile('|'.join(PERSONNEL_PATTERNS), re.IGNORECASE)

# Labels that should default to multi-select.
MULTI_PATTERNS = [
    r'\bprepared by\b',       # crew that prepared the SWMS/JSEA
    r'\battendee',            # toolbox / induction attendees
    r'\bcrew\b',              # crew rosters
    r'\battending',
    r'\bpersonnel\b',
]
MULTI_RE = re.compile('|'.join(MULTI_PATTERNS), re.IGNORECASE)

# ─── Rule 2 — vehicle/plant labels ─────────────────────────────────────
VEHICLE_PATTERNS = [
    r'\bvehicle( rego| id)?\b', r'\bequipment( id)?\b',
    r'\bplant( id| type)?\b', r'\bmachine(ry)?\b',
    r'\bfleet( number)?\b', r'\brego\b', r'\bregistration\b',
    r'\btruck\b', r'\bexcavator\b', r'\bloader\b', r'\bcrane\b',
    r'\bscaffold\b', r'\bunit no', r'\basset\b',
]
VEHICLE_RE = re.compile('|'.join(VEHICLE_PATTERNS), re.IGNORECASE)

# Templates that are NOT vehicle-attached (skip Rule 2 & vehicle header).
NON_VEHICLE_KEYWORDS = re.compile(
    r'(swms|toolbox|induction|d&a test|drug|alcohol|near miss|'
    r'incident report|sign[- ]?in|visitor|jsea|site inspection|'
    r'site safety|end of day)', re.IGNORECASE,
)


def is_personnel(label: str) -> bool:
    if not label: return False
    # Exclude common false-positive labels.
    l = label.lower()
    if 'company name' in l or 'site name' in l or 'project name' in l:
        return False
    if 'permit name' in l or 'form name' in l or 'template name' in l:
        return False
    if 'name of' in l and 'worker' not in l and 'operator' not in l:
        # e.g. "Name of Task" — not personnel.
        return False
    return bool(PERSONNEL_RE.search(l))


def is_multi(label: str) -> bool:
    return bool(MULTI_RE.search(label or ''))


def is_vehicle(label: str) -> bool:
    return bool(VEHICLE_RE.search(label or ''))


def is_vehicle_attached(name: str, fields: list) -> bool:
    """A template is vehicle-attached if it either (a) is NOT in the
    non-vehicle keyword list, AND (b) has at least one field that looks
    like a vehicle/plant reference."""
    if NON_VEHICLE_KEYWORDS.search(name or ''):
        return False
    for f in fields:
        if is_vehicle(f.get('label') or ''):
            return True
        if f.get('type') in ('vehicle_navixy', 'asset_scan'):
            return True
    return False


def convert_field(f: dict, changes: dict) -> dict:
    """Apply rules 1, 2, 5 to a single field. Returns the (possibly new)
    field dict. Mutates `changes` counters."""
    out = copy.deepcopy(f)
    label = out.get('label') or ''

    # Rule 5 — date normalisation
    if out.get('type') in ('auto_date', 'date'):
        was = out.get('type')
        out['type'] = 'date'
        cfg = out.get('config') or {}
        cfg['default_today'] = True
        out['config'] = cfg
        if was == 'auto_date':
            changes['date_normalised'] += 1

    # Rule 2 — vehicle picker
    if is_vehicle(label) and out.get('type') not in ('vehicle_navixy',):
        # Don't upgrade a plain checklist item like "Excavator in good order?"
        # to a vehicle picker — only truly identifying fields.
        # Heuristic: field type must be text/textarea/number/select AND
        # the label is short (≤ 40 chars) with rego/id/name/type language.
        if out.get('type') in ('text', 'textarea', 'number', 'select') and len(label) <= 60:
            l = label.lower()
            if ('rego' in l or 'id' in l or 'number' in l or 'type' in l
                    or 'name' in l or l.strip() in {'vehicle', 'plant', 'equipment', 'machine'}
                    or 'select vehicle' in l or 'select plant' in l or 'select equipment' in l):
                out['type'] = 'vehicle_navixy'
                # Clear any legacy config that no longer applies.
                out['config'] = out.get('config') or {}
                changes['vehicle_converted'] += 1

    # Rule 1 — worker picker
    if is_personnel(label) and out.get('type') != 'worker_picker':
        # Only convert data-entry types (text/textarea/select) — not
        # radio/checkbox/photo/gps/signature.
        if out.get('type') in ('text', 'textarea', 'select'):
            out['type'] = 'worker_picker'
            cfg = out.get('config') or {}
            cfg['inline_company_toggle'] = True
            cfg['company_options'] = COMPANY_OPTIONS
            if is_multi(label):
                cfg['multi'] = True
            out['config'] = cfg
            changes['worker_converted'] += 1

    return out


def ensure_gps(fields: list, changes: dict) -> list:
    """Rule 4 — ensure a GPS "Location" field exists with reverse_geocode."""
    for f in fields:
        if f.get('type') in ('gps', 'location'):
            f['type'] = 'gps'
            cfg = f.get('config') or {}
            cfg['reverse_geocode'] = True
            f['config'] = cfg
            changes['gps_updated'] += 1
            return fields
    # Not present — insert at position 2 (after Date + Operator if they
    # exist) or as-early-as-possible otherwise.
    insert_at = min(2, len(fields))
    fields.insert(insert_at, {
        'id': f'f_location_{uuid.uuid4().hex[:6]}',
        'type': 'gps',
        'label': 'Location',
        'required': True,
        'config': {'reverse_geocode': True},
    })
    changes['gps_inserted'] += 1
    return fields


def dedupe_vehicle_and_asset_scan(fields: list, changes: dict) -> list:
    """Rule 2 consolidation:
       - Only ONE vehicle_navixy per template (keep first, drop rest).
       - Any asset_scan gets dropped (function now inside NavixyVehiclePicker).
    """
    seen_vehicle = False
    out = []
    for f in fields:
        if f.get('type') == 'asset_scan':
            changes['asset_scan_dropped'] += 1
            continue
        if f.get('type') == 'vehicle_navixy':
            if seen_vehicle:
                changes['duplicate_vehicle_dropped'] += 1
                continue
            seen_vehicle = True
        out.append(f)
    return out


async def migrate() -> None:
    client = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = client[os.environ['DB_NAME']]

    # ─── STEP 1: Backup snapshot ───────────────────────────────────────
    backup_col = 'form_templates_backup_v160_1_6'
    existing_backup = await db[backup_col].estimated_document_count()
    if existing_backup > 0:
        print(f'Backup collection `{backup_col}` already exists with '
              f'{existing_backup} docs — skipping snapshot (idempotency).')
    else:
        cursor = db.form_templates.find({'deleted_at': None})
        docs = [d async for d in cursor]
        if docs:
            # Snapshot with a run marker so we can distinguish multiple
            # backup collections if we ever have more than one migration.
            snap = []
            now = datetime.now(timezone.utc).isoformat()
            for d in docs:
                d = copy.deepcopy(d)
                d['_backup_run_at'] = now
                d['_backup_source_id'] = str(d.pop('_id', ''))
                snap.append(d)
            await db[backup_col].insert_many(snap)
            print(f'Snapshotted {len(snap)} templates → `{backup_col}`.')

    # ─── STEP 2: Iterate + migrate ─────────────────────────────────────
    report = []
    cursor = db.form_templates.find({'deleted_at': None})
    async for tpl in cursor:
        tid = tpl.get('id')
        if tid in SKIP_TEMPLATE_IDS:
            report.append({'name': tpl['name'], 'skipped': 'already migrated', 'changes': {}})
            continue

        original_fields = tpl.get('fields') or []
        changes = {
            'date_normalised': 0, 'worker_converted': 0, 'vehicle_converted': 0,
            'asset_scan_dropped': 0, 'duplicate_vehicle_dropped': 0,
            'gps_inserted': 0, 'gps_updated': 0,
        }
        # Rules 1, 2, 5 (per-field)
        migrated = [convert_field(f, changes) for f in original_fields]
        # Consolidation
        migrated = dedupe_vehicle_and_asset_scan(migrated, changes)
        # Rule 4 — GPS
        migrated = ensure_gps(migrated, changes)

        # Persist
        await db.form_templates.update_one(
            {'id': tid},
            {'$set': {'fields': migrated}}
        )
        report.append({
            'id': tid, 'name': tpl['name'], 'category': tpl.get('category'),
            'before_count': len(original_fields), 'after_count': len(migrated),
            'changes': changes,
        })

    # ─── STEP 3: Report ────────────────────────────────────────────────
    print('\n=== v160.2.0 Bulk Migration Report ===')
    print(f'{"Template":48s} {"Cat":11s} {"Before":>7s} {"After":>6s}  Changes')
    print('-' * 130)
    for r in report:
        if 'skipped' in r:
            print(f'{r["name"]:48s} {"":11s} {"—":>7s} {"—":>6s}  SKIPPED ({r["skipped"]})')
            continue
        ch = r['changes']
        deltas = [f'{k}={v}' for k, v in ch.items() if v]
        print(f'{r["name"]:48s} {(r["category"] or ""):11s} {r["before_count"]:>7d} {r["after_count"]:>6d}  {", ".join(deltas) or "no-op"}')
    print()

    # Machine-readable summary — used by pytest.
    out_path = '/tmp/v160_2_0_migration_report.json'
    with open(out_path, 'w') as fh:
        json.dump(report, fh, indent=2, default=str)
    print(f'Full JSON report written to {out_path}')


if __name__ == '__main__':
    asyncio.run(migrate())
