// Paneltec Pay — People: each worker's pay profile (employment type,
// ordinary hours, RDO, the ID your payroll provider uses for them).
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { PAY, PayCard, payBtn, payBtnStyle } from './PayShell';

const TYPES = [
  ['full_time', 'Full time'], ['part_time', 'Part time'], ['casual', 'Casual'], ['contractor', 'Contractor'],
];

function Row({ p, onSaved }) {
  const [form, setForm] = useState(p);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/payroll/profiles/${p.worker_id}`, {
        employment_type: form.employment_type, classification: form.classification || null,
        ordinary_hours_per_week: Number(form.ordinary_hours_per_week) || null,
        rdo_enabled: !!form.rdo_enabled, payroll_employee_id: form.payroll_employee_id || null,
        notes: form.notes || null,
      });
      setDirty(false); onSaved();
    } catch (e) { toast.error(apiError(e) || 'Could not save'); }
    finally { setBusy(false); }
  };
  const inp = 'rounded-lg border px-2 py-1.5 text-sm w-full';
  const st = { borderColor: PAY.line };
  return (
    <tr className="border-t" style={{ borderColor: PAY.line, opacity: p.active ? 1 : 0.55 }} data-testid={`pay-person-${p.worker_id}`}>
      <td className="py-2 pr-3 font-semibold whitespace-nowrap" style={{ color: PAY.ink }}>{p.name}<div className="text-[10px] font-normal" style={{ color: PAY.muted }}>{p.position}{!p.active && ' · inactive'}</div></td>
      <td className="py-2 pr-2"><select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)} className={inp} style={st}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
      <td className="py-2 pr-2"><input value={form.classification || ''} onChange={(e) => set('classification', e.target.value)} className={inp} style={st} placeholder="e.g. CW3" /></td>
      <td className="py-2 pr-2"><input type="number" step="0.1" min={0} max={80} value={form.ordinary_hours_per_week ?? ''} onChange={(e) => set('ordinary_hours_per_week', e.target.value)} className={`${inp} w-20`} style={st} /></td>
      <td className="py-2 pr-2 text-center"><input type="checkbox" checked={!!form.rdo_enabled} onChange={(e) => set('rdo_enabled', e.target.checked)} /></td>
      <td className="py-2 pr-2"><input value={form.payroll_employee_id || ''} onChange={(e) => set('payroll_employee_id', e.target.value)} className={inp} style={st} placeholder="ID in payroll" /></td>
      <td className="py-2 text-right">
        <button type="button" onClick={save} disabled={!dirty || busy} className={payBtn('primary')} style={payBtnStyle('primary')}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
        </button>
      </td>
    </tr>
  );
}

export default function PayPeople() {
  const [rows, setRows] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const load = useCallback(async () => {
    try { setRows((await api.get('/payroll/profiles')).data.profiles || []); }
    catch (e) { toast.error(apiError(e) || 'Could not load people'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <div className="text-sm" style={{ color: PAY.muted }}>Loading…</div>;
  const shown = rows.filter((r) => showInactive || r.active);
  return (
    <PayCard title={`People · ${shown.length}`} testid="pay-people"
      aside={<label className="text-xs inline-flex items-center gap-1.5" style={{ color: PAY.muted }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> show inactive</label>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-left" style={{ color: PAY.muted }}>
            <tr><th className="py-1.5 pr-3">Person</th><th className="py-1.5 pr-2">Employment</th><th className="py-1.5 pr-2">Classification</th><th className="py-1.5 pr-2">Hours / week</th><th className="py-1.5 pr-2 text-center">RDO</th><th className="py-1.5 pr-2">Payroll ID</th><th className="py-1.5" /></tr>
          </thead>
          <tbody>{shown.map((p) => <Row key={p.worker_id} p={p} onSaved={load} />)}</tbody>
        </table>
      </div>
      <div className="mt-3 text-xs" style={{ color: PAY.muted }}>
        People come from Settings → Workers. The payroll ID is whatever your payroll provider calls this person, so exports line up.
      </div>
    </PayCard>
  );
}
