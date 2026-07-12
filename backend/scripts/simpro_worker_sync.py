"""Simpro Worker Sync — Phase B dry-run.

v160.3.1a — Read-only sync planner. Fetches Simpro employees + org-wide
licences, matches each Simpro employee to a `workers` document by
`simpro_employee_id` (fallback: PrimaryContact.Email), and computes the
diff that a Phase-C sync would apply.

**This script writes NOTHING to Mongo.** It writes only:
  * /app/memory/SIMPRO_SYNC_DRYRUN.md  — human-review Markdown report

Usage:
    python3 backend/scripts/simpro_worker_sync.py --dry-run
Options:
    --dry-run   (required for Phase B; without this flag the script
                 refuses to run because Phase C isn't wired yet.)
    --org-id    Override org (default = the sole configured Simpro org).
    --output    Override the markdown report path.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow importing from /app/backend when invoked directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


# ─────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────

SEED_DIR = Path(__file__).resolve().parent / 'seed_data'
CERT_KINDS_SEED = SEED_DIR / 'cert_kinds_seed.json'
LICENCE_MAP_SEED = SEED_DIR / 'simpro_licence_mapping_seed.json'

# PII allowlist for Phase B (per user approval 2026-07-12).
PII_ALLOWLIST = {'date_of_birth', 'address', 'emergency_contact'}
PII_DENYLIST = {'banking', 'ssn', 'tfn', 'masked_ssn'}


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _norm(s: str | None) -> str:
    return re.sub(r'\s+', ' ', (s or '').strip().lower())


def _lower(s: str | None) -> str:
    return (s or '').strip().lower()


def _load_licence_map() -> dict[str, str]:
    """{raw_simpro_name → cert_kind_slug} — from the seed file."""
    if not LICENCE_MAP_SEED.exists():
        raise FileNotFoundError(f'Missing {LICENCE_MAP_SEED}. Run Phase B seed generator first.')
    rows = json.loads(LICENCE_MAP_SEED.read_text())
    return {r['simpro_licence_name_raw']: r['cert_kind_slug'] for r in rows}


async def _paginate(h: httpx.AsyncClient, url: str, params: dict | None = None) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        p = dict(params or {})
        p['page'] = page
        p.setdefault('pageSize', 250)
        r = await h.get(url, params=p)
        if r.status_code != 200:
            break
        data = r.json()
        if not isinstance(data, list):
            data = data.get('data') or []
        out.extend(data)
        if 'rel="next"' not in (r.headers.get('link') or ''):
            break
        page += 1
        if page > 30:  # hard safety cap
            break
    return out


async def _fetch_simpro(cfg: dict) -> tuple[list[dict], list[dict]]:
    """Return (employee_details, licences_org_wide). Both lists carry `_company_id`."""
    base = cfg['api_base_url'].rstrip('/')
    hdr = {'Authorization': f'Bearer {cfg["api_token"]}', 'Accept': 'application/json'}
    company_ids = cfg.get('company_ids') or ([cfg['company_id']] if cfg.get('company_id') else [])

    async with httpx.AsyncClient(timeout=30, headers=hdr) as h:
        # List employees per company (list-mode returns {ID, Name} only)
        emp_stubs: list[dict] = []
        for cid in company_ids:
            lst = await _paginate(h, f'{base}/api/v1.0/companies/{cid}/employees/')
            for e in lst:
                e['_company_id'] = str(cid)
            emp_stubs.extend(lst)

        # Hydrate detail (no trailing slash — API quirk documented in adjust-20c audit)
        details: list[dict] = []
        for i, e in enumerate(emp_stubs):
            r = await h.get(f'{base}/api/v1.0/companies/{e["_company_id"]}/employees/{e["ID"]}')
            if r.status_code == 200:
                d = r.json()
                d['_company_id'] = e['_company_id']
                details.append(d)
            # gentle pacing — Simpro cap is 60/s
            if i % 20 == 19:
                await asyncio.sleep(0.5)
            else:
                await asyncio.sleep(0.02)

        # Org-wide licences (paginated, per company)
        licences: list[dict] = []
        for cid in company_ids:
            batch = await _paginate(h, f'{base}/api/v1.0/companies/{cid}/licences/')
            for l in batch:
                l['_company_id'] = str(cid)
            licences.extend(batch)

    return details, licences


def _extract_pii(detail: dict) -> dict:
    """Pull ONLY the whitelisted PII fields from a Simpro employee detail."""
    out: dict = {}

    # date_of_birth
    dob = detail.get('DateOfBirth')
    if dob:
        out['date_of_birth'] = dob  # ISO date like "1987-04-08"

    # address — nested object, whitelist inner keys only
    addr = detail.get('Address') or {}
    if any((addr or {}).values()):
        out['address'] = {
            'street': addr.get('Address'),
            'city': addr.get('City'),
            'state': addr.get('State'),
            'postal_code': addr.get('PostalCode'),
            'country': addr.get('Country'),
        }

    # emergency_contact
    ec = detail.get('EmergencyContact') or {}
    if any((ec or {}).values()):
        out['emergency_contact'] = {
            'name': ec.get('Name'),
            'relationship': ec.get('Relationship'),
            'cell_phone': ec.get('CellPhone'),
            'work_phone': ec.get('WorkPhone'),
            'address': ec.get('Address'),
        }

    return out


def _extract_licences(emp_id: int, licences: list[dict], slug_map: dict[str, str]) -> list[dict]:
    """Return normalised licence rows for this employee."""
    rows = []
    for l in licences:
        if l.get('EmployeeID') != emp_id:
            continue
        raw = l.get('Name') or ''
        slug = slug_map.get(raw) or slug_map.get(raw.strip()) or 'unmapped'
        rows.append({
            'simpro_licence_id': l.get('ID'),
            'cert_kind_slug': slug,
            'raw_source_name': raw.strip() or None,
            'ref_number': (l.get('Ref') or '').strip() or None,
            'expiry_date': l.get('ExpiryDate') or None,
            'source': 'simpro',
        })
    # Deterministic order
    rows.sort(key=lambda r: (r['cert_kind_slug'], r['ref_number'] or '', r['simpro_licence_id']))
    return rows


def _match_worker(detail: dict, workers_by_simpro_id: dict, workers_by_email: dict) -> tuple[dict | None, str]:
    """Return (matched_worker_doc, match_reason)."""
    sid = detail.get('ID')
    if sid is not None:
        m = workers_by_simpro_id.get(int(sid))
        if m:
            return m, 'simpro_employee_id'
    pc = detail.get('PrimaryContact') or {}
    email = _lower(pc.get('Email'))
    if email:
        m = workers_by_email.get(email)
        if m:
            return m, 'email_fallback'
    return None, 'unmatched'


# ─────────────────────────────────────────────────────────────────
# Dry-run report builder
# ─────────────────────────────────────────────────────────────────

def _employee_licence_counts(licences: list[dict], employee_ids: set[int]) -> dict:
    """Return {employee_id: count} for employees in the given set."""
    out: dict = {}
    for l in licences:
        eid = l.get('EmployeeID')
        if eid in employee_ids:
            out[eid] = out.get(eid, 0) + 1
    return out


def _diff_pii(existing: dict, proposed: dict) -> dict:
    """Return {field: status} where status is 'add' | 'change' | 'unchanged'.
    `existing` is the workers.simpro_sync_snapshot.pii subdoc (or {}).
    `proposed` is what we would write.
    """
    out = {}
    for k in PII_ALLOWLIST:
        e = existing.get(k)
        p = proposed.get(k)
        if p is None and e is None:
            continue  # nothing to say
        if p is None:
            out[k] = 'unchanged'
        elif e is None:
            out[k] = 'add'
        elif e == p:
            out[k] = 'unchanged'
        else:
            out[k] = 'change'
    return out


def _diff_licences(existing: list[dict], proposed: list[dict]) -> dict:
    """Compare by (simpro_licence_id). Return counts + per-status lists."""
    by_id_existing = {l.get('simpro_licence_id'): l for l in (existing or []) if l.get('simpro_licence_id') is not None}
    by_id_proposed = {l['simpro_licence_id']: l for l in proposed}
    add, change, unchanged = [], [], []
    for lid, p in by_id_proposed.items():
        e = by_id_existing.get(lid)
        if e is None:
            add.append(p)
        else:
            # Compare expiry / ref / slug for change
            changed = (
                (e.get('expiry_date') != p.get('expiry_date'))
                or (e.get('ref_number') != p.get('ref_number'))
                or (e.get('cert_kind_slug') != p.get('cert_kind_slug'))
            )
            (change if changed else unchanged).append({'before': e, 'after': p})
    # Manual-only certs (user added, Simpro doesn't have)
    manual_only = [e for e in (existing or []) if e.get('source') != 'simpro']
    return {'add': add, 'change': change, 'unchanged': unchanged, 'manual_only': manual_only}


async def run_dry_run(org_id: str | None, output_path: Path) -> None:
    mongo = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = mongo[os.environ['DB_NAME']]

    q = {'kind': 'simpro'}
    if org_id:
        q['org_id'] = org_id
    else:
        # Auto-pick the connected org (skip unconfigured demo docs).
        q['status'] = 'connected'
    cfg_doc = await db.integration_configs.find_one(q)
    if not cfg_doc:
        raise RuntimeError(f'No Simpro integration_configs match {q}')
    org_id = cfg_doc['org_id']
    cfg = cfg_doc.get('config') or {}

    slug_map = _load_licence_map()

    print(f'[dry-run] Fetching Simpro for org {org_id[:8]}…')
    details, licences = await _fetch_simpro(cfg)
    print(f'[dry-run] employees={len(details)} licences={len(licences)}')

    # Load our workers
    workers: list[dict] = []
    async for w in db.workers.find({'org_id': org_id, 'deleted_at': None}):
        w.pop('_id', None)
        workers.append(w)
    workers_by_simpro_id: dict = {}
    workers_by_email: dict = {}
    for w in workers:
        sid = w.get('simpro_employee_id') or w.get('simpro_id')
        if sid is not None:
            try:
                workers_by_simpro_id[int(sid)] = w
            except (TypeError, ValueError):
                pass
        e = _lower(w.get('email'))
        if e:
            workers_by_email[e] = w
    print(f'[dry-run] workers total={len(workers)} with_simpro_id={len(workers_by_simpro_id)} with_email={len(workers_by_email)}')

    # Per-employee planning
    plans: list[dict] = []
    unmatched: list[dict] = []
    for d in details:
        w, reason = _match_worker(d, workers_by_simpro_id, workers_by_email)
        pii_proposed = _extract_pii(d)
        licences_proposed = _extract_licences(d.get('ID'), licences, slug_map)
        if not w:
            unmatched.append({
                'simpro_id': d.get('ID'),
                'simpro_name': d.get('Name'),
                'company_id': d.get('_company_id'),
                'position': d.get('Position'),
                'email': ((d.get('PrimaryContact') or {}).get('Email') or '').strip(),
                'archived': bool(d.get('Archived')),
                'licences_proposed': len(licences_proposed),
            })
            continue
        existing_snapshot = (w.get('simpro_sync_snapshot') or {})
        existing_pii = existing_snapshot.get('pii') or {}
        existing_lic = (w.get('certifications') or [])
        plans.append({
            'worker_id': w.get('id'),
            'worker_name': f"{w.get('first_name','')} {w.get('last_name','')}".strip() or w.get('full_name'),
            'worker_email': w.get('email'),
            'simpro_id': d.get('ID'),
            'simpro_name': d.get('Name'),
            'company_id': d.get('_company_id'),
            'match_reason': reason,
            'position': d.get('Position'),
            'archived': bool(d.get('Archived')),
            'pii_diff': _diff_pii(existing_pii, pii_proposed),
            'pii_proposed': pii_proposed,
            'lic_diff': _diff_licences(existing_lic, licences_proposed),
        })

    # ─────────────────────────────────────────────
    # Markdown report
    # ─────────────────────────────────────────────
    now_iso = datetime.now(timezone.utc).isoformat()
    matched = len(plans)
    n_add_lic = sum(len(p['lic_diff']['add']) for p in plans)
    n_chg_lic = sum(len(p['lic_diff']['change']) for p in plans)
    n_unch_lic = sum(len(p['lic_diff']['unchanged']) for p in plans)
    n_manual_only = sum(len(p['lic_diff']['manual_only']) for p in plans)
    n_pii_add = sum(sum(1 for v in p['pii_diff'].values() if v == 'add') for p in plans)
    n_pii_chg = sum(sum(1 for v in p['pii_diff'].values() if v == 'change') for p in plans)
    archived_matched = sum(1 for p in plans if p['archived'])

    def _md_pii(pii: dict, diff: dict) -> str:
        lines = []
        for k in ('date_of_birth', 'address', 'emergency_contact'):
            status = diff.get(k) or ('add' if k in pii else '—')
            val = pii.get(k)
            if isinstance(val, dict):
                val_repr = ' · '.join(f'{ik}={iv!r}' for ik, iv in val.items() if iv)
            else:
                val_repr = repr(val) if val is not None else '—'
            lines.append(f'    - `{k}`: **{status}** — {val_repr}')
        return '\n'.join(lines)

    lines = [
        '# Simpro Worker Sync — Phase B Dry-Run',
        '',
        f'**Generated**: {now_iso}',
        f'**Org**: `{org_id}` — Simpro tenant `{cfg["api_base_url"]}` (Companies: {cfg.get("company_ids") or [cfg.get("company_id")]})',
        f'**Mode**: `--dry-run` — **ZERO writes** to Mongo, ZERO writes to Simpro.',
        f'**PII allowlist**: `{sorted(PII_ALLOWLIST)}`  ·  **denylist**: `{sorted(PII_DENYLIST)}`',
        f'**Licence mapping seed**: `{LICENCE_MAP_SEED}` ({len(slug_map)} raw→slug rows)',
        '',
        '---',
        '',
        '## 🎯 Executive summary',
        '',
        f'| Metric | Value |',
        f'|---|---:|',
        f'| Simpro employees fetched | **{len(details)}** (Company 2: {sum(1 for d in details if d.get("_company_id")=="2")}, Company 3: {sum(1 for d in details if d.get("_company_id")=="3")}) |',
        f'| Simpro licences fetched | **{len(licences)}** (org-wide) |',
        f'| Our workers in scope | **{len(workers)}** |',
        f'| **Matched (would be enriched)** | **{matched}** |',
        f'|   — matched by `simpro_employee_id` | {sum(1 for p in plans if p["match_reason"]=="simpro_employee_id")} |',
        f'|   — matched by email fallback | {sum(1 for p in plans if p["match_reason"]=="email_fallback")} |',
        f'|   — of which archived in Simpro | {archived_matched} |',
        f'| **Unmatched (would be SKIPPED)** | **{len(unmatched)}** |',
        f'| Licences to ADD | {n_add_lic} |',
        f'| Licences to CHANGE (expiry / ref / slug drift) | {n_chg_lic} |',
        f'| Licences UNCHANGED | {n_unch_lic} |',
        f'| Manual-only certs to preserve (not in Simpro) | {n_manual_only} |',
        f'| PII fields to ADD | {n_pii_add} |',
        f'| PII fields to CHANGE | {n_pii_chg} |',
        '',
        '---',
        '',
        '## 1 · Unmatched Simpro employees (skipped — informational only)',
        '',
        'Per user policy "**only workers already in our portal**", these are NOT imported. Listed for review; add them to `workers` first if you want them enriched next cycle.',
        '',
    ]
    if not unmatched:
        lines += ['_None. All Simpro employees resolve to a `workers` doc._']
    else:
        lines += ['| Simpro ID | Company | Name | Position | Email | Archived | Licences would-add |',
                  '|---:|---:|---|---|---|:---:|---:|']
        for u in unmatched:
            lines.append(f'| {u["simpro_id"]} | {u["company_id"]} | {u["simpro_name"]} | {u["position"] or "—"} | `{u["email"] or "—"}` | {"✓" if u["archived"] else ""} | {u["licences_proposed"]} |')
    lines += ['', '---', '', '## 2 · Per-worker diff (matched)', '']

    # Group by "would change something" vs "no-op"
    interesting = [p for p in plans if p['pii_diff'].values() or p['lic_diff']['add'] or p['lic_diff']['change']]
    interesting = [p for p in interesting if any(v in ('add', 'change') for v in p['pii_diff'].values()) or p['lic_diff']['add'] or p['lic_diff']['change']]
    noop = [p for p in plans if p not in interesting]

    lines.append(f'### 2a · Workers with proposed changes ({len(interesting)})')
    lines.append('')
    for p in sorted(interesting, key=lambda x: x['worker_name'] or ''):
        lines.append(f'#### {p["worker_name"]}  ·  `{p["worker_email"] or "—"}`  ·  Simpro ID `{p["simpro_id"]}` (Co {p["company_id"]})')
        lines.append(f'- **match**: `{p["match_reason"]}`  ·  position: `{p["position"] or "—"}`{" · **ARCHIVED in Simpro**" if p["archived"] else ""}')
        lines.append(f'- **PII allowlist diff**:')
        lines.append(_md_pii(p['pii_proposed'], p['pii_diff']))
        ld = p['lic_diff']
        if ld['add']:
            lines.append(f'- **Licences to ADD ({len(ld["add"])})**:')
            for l in ld['add']:
                lines.append(f'    - `{l["cert_kind_slug"]}` — raw `{l["raw_source_name"]}` · ref `{l["ref_number"] or "—"}` · expiry `{l["expiry_date"] or "—"}` · simpro_id `{l["simpro_licence_id"]}`')
        if ld['change']:
            lines.append(f'- **Licences to CHANGE ({len(ld["change"])})**:')
            for pair in ld['change']:
                b, a = pair['before'], pair['after']
                lines.append(f'    - `{a["cert_kind_slug"]}` · simpro_id `{a["simpro_licence_id"]}` — expiry {b.get("expiry_date")!r} → {a.get("expiry_date")!r} · ref {b.get("ref_number")!r} → {a.get("ref_number")!r}')
        if ld['manual_only']:
            lines.append(f'- ⚠️  **Manual certs preserved (not in Simpro): {len(ld["manual_only"])}**')
            for l in ld['manual_only'][:5]:
                lines.append(f'    - `{l.get("cert_kind_slug") or "?"}` — source `{l.get("source") or "?"}`')
            if len(ld['manual_only']) > 5:
                lines.append(f'    - _(+{len(ld["manual_only"])-5} more)_')
        lines.append('')

    if noop:
        lines.append(f'### 2b · Workers with NO proposed changes (no-op) — {len(noop)}')
        lines.append('')
        lines.append('These match a Simpro record but the enrichment would be null (Simpro has no PII populated for them AND no linked licences, OR our snapshot already matches).')
        lines.append('')
        lines.append('| Worker | Simpro ID | Match | Position |')
        lines.append('|---|---:|---|---|')
        for p in sorted(noop, key=lambda x: x['worker_name'] or ''):
            lines.append(f'| {p["worker_name"]} | {p["simpro_id"]} | {p["match_reason"]} | {p["position"] or "—"} |')
        lines.append('')

    lines += [
        '---',
        '',
        '## 3 · Data integrity notes',
        '',
        f'- Simpro licence names with `cert_kind_slug = "unmapped"`: **{sum(1 for p in plans for l in p["lic_diff"]["add"] if l["cert_kind_slug"] == "unmapped")}** rows. If >0, review `simpro_licence_mapping_seed.json`.',
        '- No files, no photos, no attachments were fetched. Simpro API v1.0 doesn\'t expose them (see `SIMPRO_IMPORT_AUDIT.md § A2/A4`).',
        '- No PII outside the allowlist was extracted. `Banking`, `MaskedSSN`, `PayRates`, `AccountSetup` remain untouched.',
    ]

    # Licence coverage analysis — orphan detection
    lic_by_current_emp = sum(1 for l in licences if l.get('EmployeeID') in {d.get('ID') for d in details})
    lic_orphan = len(licences) - lic_by_current_emp
    lines += [
        f'- **Licence coverage**: {lic_by_current_emp} / {len(licences)} licences attach to a current Simpro employee. **{lic_orphan} licences ({lic_orphan*100//max(1,len(licences))}%) are ORPHANS** — they reference EmployeeIDs no longer in the active roster (Simpro keeps licence history for archived/ex-employees). Phase C will silently skip orphans.',
        f'- **Current-roster licence density**: only {sum(1 for eid_cnt in _employee_licence_counts(licences, {d.get("ID") for d in details}).values() if eid_cnt > 0)} of {len(details)} current employees have ≥1 licence in Simpro. If you expected higher, check whether your team keeps LICENCE data in the Simpro Licences tab or in a document-folder (which is API-blocked — see audit §A4).',
        '',
        '---',
        '',
        '## 4 · Reviewer checklist before approving Phase C',
        '',
        '- [ ] Unmatched employees in §1: OK to skip? (Add to portal first if any should be imported.)',
        '- [ ] PII allowlist §exec: still just `date_of_birth`, `address`, `emergency_contact`?',
        '- [ ] Licence mapping: browse `seed_data/simpro_licence_mapping_seed.json` — any auto-mapped rows to remap manually?',
        '- [ ] `cert_kinds` catalogue: browse `seed_data/cert_kinds_seed.json` — consolidate duplicates (e.g. `working-at-heights` + `working-safely-heights`)?',
        '- [ ] Archived-in-Simpro workers matched — should Phase C write to them anyway or skip?',
        '- [ ] Manual-only certs preserved: confirm the merge rule "keep manual, add Simpro on top, dedupe by `simpro_licence_id`".',
        '',
    ]

    output_path.write_text('\n'.join(lines))
    print(f'[dry-run] Report written → {output_path}')
    print(f'[dry-run] matched={matched}  unmatched={len(unmatched)}  add_lic={n_add_lic}  chg_lic={n_chg_lic}  add_pii={n_pii_add}')


# ─────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────

def _load_env_from_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        v = v.strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), v)


def main() -> None:
    ap = argparse.ArgumentParser(description='Simpro Worker Sync — Phase B dry-run planner')
    ap.add_argument('--dry-run', action='store_true', required=True,
                    help='Required. Phase C writes are not wired yet — this flag documents intent.')
    ap.add_argument('--org-id', default=None, help='Override org_id (default: only Simpro-configured org)')
    ap.add_argument('--output', default='/app/memory/SIMPRO_SYNC_DRYRUN.md',
                    help='Markdown report output path')
    args = ap.parse_args()

    _load_env_from_file(Path('/app/backend/.env'))
    if 'MONGO_URL' not in os.environ:
        raise SystemExit('MONGO_URL not set — source /app/backend/.env first')

    asyncio.run(run_dry_run(args.org_id, Path(args.output)))


if __name__ == '__main__':
    main()
