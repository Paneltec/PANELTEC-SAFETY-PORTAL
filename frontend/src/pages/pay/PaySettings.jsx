import DateField from './DateField';
import PayrollDeliverySettings from './PayrollDeliverySettings';
import PayrollBranding from './PayrollBranding';
// Paneltec Pay — Settings: pay period, defaults, allowances, overtime estimate rules.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Plus, X } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { PAY, PayCard, payBtn, payBtnStyle } from './PayShell';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function PaySettings() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setS((await api.get('/payroll/settings')).data); }
    catch (e) { toast.error(apiError(e) || 'Could not load settings'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const setOt = (k, v) => setS((x) => ({ ...x, overtime: { ...x.overtime, [k]: v } }));
  const setAl = (i, k, v) => setS((x) => ({ ...x, allowance_types: x.allowance_types.map((a, j) => j === i ? { ...a, [k]: v } : a) }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...s,
        ordinary_hours_per_week: Number(s.ordinary_hours_per_week), default_break_minutes: Number(s.default_break_minutes),
        rdo_accrual_hours_per_day: Number(s.rdo_accrual_hours_per_day),
        period_anchor: s.period_type === 'fortnightly' ? (s.period_anchor || null) : null,
        overtime: Object.fromEntries(Object.entries(s.overtime).map(([k, v]) => [k, Number(v)])),
        allowance_types: s.allowance_types.filter((a) => a.code && a.label).map((a) => ({ ...a, code: a.code.trim().toLowerCase().replace(/\s+/g, '_') })),
      };
      delete body.org_id; delete body.updated_at; delete body.updated_by;
      setS((await api.put('/payroll/settings', body)).data);
      toast.success('Settings saved');
    } catch (err) { toast.error(apiError(err) || 'Could not save'); }
    finally { setBusy(false); }
  };

  if (!s) return <div className="text-sm" style={{ color: PAY.muted }}>Loading…</div>;
  const inp = 'rounded-lg border px-3 py-2 text-sm w-full';
  const st = { borderColor: PAY.line };
  const lab = 'block text-xs font-semibold';
  const labSt = { color: PAY.muted };

  return (
    <form onSubmit={save} className="space-y-4" data-testid="pay-settings">
      <PayrollDeliverySettings/><PayrollBranding/>
      <PayCard title="Pay period">
        <div className="grid sm:grid-cols-3 gap-3">
          <label className={lab} style={labSt}>Paid<select value={s.period_type} onChange={(e) => set('period_type', e.target.value)} className={inp} style={st}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option></select></label>
          <label className={lab} style={labSt}>Week starts on<select value={s.week_starts} onChange={(e) => set('week_starts', e.target.value)} className={inp} style={st}>{DAYS.map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}</select></label>
          {s.period_type === 'fortnightly' && (
            <label className={lab} style={labSt}>A date one fortnight starts<DateField value={s.period_anchor || ''} onChange={(e) => set('period_anchor', e.target.value)} className={inp} style={st} /></label>
          )}
        </div>
      </PayCard>

      <PayCard title="Defaults for a worked day">
        <div className="grid sm:grid-cols-4 gap-3">
          <label className={lab} style={labSt}>Start<input type="time" value={s.default_start} onChange={(e) => set('default_start', e.target.value)} className={inp} style={st} /></label>
          <label className={lab} style={labSt}>Finish<input type="time" value={s.default_finish} onChange={(e) => set('default_finish', e.target.value)} className={inp} style={st} /></label>
          <label className={lab} style={labSt}>Break (minutes)<input type="number" min={0} max={240} value={s.default_break_minutes} onChange={(e) => set('default_break_minutes', e.target.value)} className={inp} style={st} /></label>
          <label className={lab} style={labSt}>Ordinary hours / week<input type="number" step="0.1" min={0} max={80} value={s.ordinary_hours_per_week} onChange={(e) => set('ordinary_hours_per_week', e.target.value)} className={inp} style={st} /></label>
        </div>
        <div className="mt-3 grid sm:grid-cols-4 gap-3 items-end">
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={!!s.rdo_enabled} onChange={(e) => set('rdo_enabled', e.target.checked)} /> RDOs accrue</label>
          <label className={lab} style={labSt}>RDO hours accrued per day worked<input type="number" step="0.1" min={0} max={8} value={s.rdo_accrual_hours_per_day} onChange={(e) => set('rdo_accrual_hours_per_day', e.target.value)} className={inp} style={st} disabled={!s.rdo_enabled} /></label>
        </div>
      </PayCard>

      <PayCard title="Allowances" aside={<button type="button" onClick={() => set('allowance_types', [...s.allowance_types, { code: '', label: '', unit: 'day' }])} className={payBtn('ghost')} style={payBtnStyle('ghost')}><Plus size={13} /> Add</button>}>
        {s.allowance_types.length === 0 && <div className="text-sm" style={{ color: PAY.muted }}>None yet.</div>}
        <div className="space-y-2">
          {s.allowance_types.map((a, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 items-center">
              <input value={a.code} onChange={(e) => setAl(i, 'code', e.target.value)} className={inp} style={st} placeholder="code" />
              <input value={a.label} onChange={(e) => setAl(i, 'label', e.target.value)} className={inp} style={st} placeholder="Shown to workers" />
              <select value={a.unit} onChange={(e) => setAl(i, 'unit', e.target.value)} className={inp} style={st}><option value="day">per day</option><option value="hour">per hour</option><option value="each">each</option></select>
              <button type="button" onClick={() => set('allowance_types', s.allowance_types.filter((_, j) => j !== i))} className="p-2 text-slate-400 hover:text-rose-600" aria-label="Remove"><X size={14} /></button>
            </div>
          ))}
        </div>
        <div className="mt-2 text-xs" style={{ color: PAY.muted }}>Amounts are set in your payroll system; here we only count them.</div>
      </PayCard>

      <PayCard title="Overtime estimate (for checking only)">
        <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <label className={lab} style={labSt}>Ordinary hours / day<input type="number" step="0.1" value={s.overtime.daily_ordinary_hours} onChange={(e) => setOt('daily_ordinary_hours', e.target.value)} className={inp} style={st} /></label>
          <label className={lab} style={labSt}>First tier hours<input type="number" step="0.5" value={s.overtime.first_tier_hours} onChange={(e) => setOt('first_tier_hours', e.target.value)} className={inp} style={st} /></label>
          <label className={lab} style={labSt}>First tier ×<input type="number" step="0.25" value={s.overtime.first_tier_rate} onChange={(e) => setOt('first_tier_rate', e.target.value)} className={inp} style={st} /></label>
          <label className={lab} style={labSt}>After that ×<input type="number" step="0.25" value={s.overtime.second_tier_rate} onChange={(e) => setOt('second_tier_rate', e.target.value)} className={inp} style={st} /></label>
          <label className={lab} style={labSt}>Saturday ×<input type="number" step="0.25" value={s.overtime.saturday_rate} onChange={(e) => setOt('saturday_rate', e.target.value)} className={inp} style={st} /></label>
          <label className={lab} style={labSt}>Sunday ×<input type="number" step="0.25" value={s.overtime.sunday_rate} onChange={(e) => setOt('sunday_rate', e.target.value)} className={inp} style={st} /></label>
        </div>
        <div className="mt-2 text-xs" style={{ color: PAY.muted }}>These only shape the estimates on the Overview. Your payroll provider applies the award properly.</div>
      </PayCard>

      <div className="flex justify-end">
        <button type="submit" disabled={busy} className={payBtn('primary')} style={payBtnStyle('primary')} data-testid="pay-settings-save">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save settings
        </button>
      </div>
    </form>
  );
}
