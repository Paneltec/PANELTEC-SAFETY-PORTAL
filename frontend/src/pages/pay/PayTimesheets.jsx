// Paneltec Pay — Timesheets: a grid of people × days for one pay period.
// Click a cell to add or edit that day; approve/reject in bulk.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, RefreshCw, Check, X, Download, Trash2, Loader2, Lock } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { PAY, PayCard, StatusPill, fmtRange, payBtn, payBtnStyle } from './PayShell';
import { downloadCsv } from './PayOverview';

const KINDS = [
  { key: 'work', label: 'Worked' },
  { key: 'rdo', label: 'RDO taken' },
  { key: 'leave', label: 'Leave' },
  { key: 'public_holiday', label: 'Public holiday' },
  { key: 'no_work', label: 'No work' },
];

const STATUS_COLOR = {
  draft: '#e5e7eb', submitted: '#dbeafe', approved: '#d1fae5', rejected: '#fee2e2', locked: '#ede9fe',
};

function shiftPeriod(periodId, days) {
  const d = new Date(periodId + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Day editor ──────────────────────────────────────────────────────

function DayEditor({ worker, day, entry, settings, onClose, onSaved }) {
  const isNew = !entry;
  const [form, setForm] = useState({
    kind: entry?.kind || 'work',
    start: entry?.start || settings.default_start,
    finish: entry?.finish || settings.default_finish,
    break_minutes: entry?.break_minutes ?? settings.default_break_minutes,
    hours: entry?.hours ?? 7.6,
    site_name: entry?.site_name || '',
    job_ref: entry?.job_ref || '',
    allowances: entry?.allowances || [],
    notes: entry?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const locked = entry?.status === 'locked';
  const allowanceQty = (code) => form.allowances.find((a) => a.code === code)?.qty || 0;
  const setAllowance = (code, qty) => set('allowances', [
    ...form.allowances.filter((a) => a.code !== code), ...(qty > 0 ? [{ code, qty }] : [])]);

  const save = async (e) => {
    e.preventDefault();
    if (locked) return;
    setBusy(true);
    const body = {
      kind: form.kind, break_minutes: Number(form.break_minutes) || 0,
      site_name: form.site_name || null, job_ref: form.job_ref || null,
      allowances: form.allowances, notes: form.notes || null,
    };
    if (form.kind === 'work') { body.start = form.start; body.finish = form.finish; }
    else { body.start = null; body.finish = null; body.hours = Number(form.hours) || 0; }
    try {
      if (isNew) await api.post('/payroll/timesheets', { worker_id: worker.id, date: day, ...body, start: body.start || undefined, finish: body.finish || undefined });
      else await api.patch(`/payroll/timesheets/${entry.id}`, body);
      onSaved(); onClose();
    } catch (err) { toast.error(apiError(err) || 'Could not save'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${worker.name}'s entry for ${day}?`)) return;
    try { await api.delete(`/payroll/timesheets/${entry.id}`); onSaved(); onClose(); }
    catch (err) { toast.error(apiError(err) || 'Could not remove'); }
  };

  const inp = 'w-full rounded-lg border px-3 py-2 text-sm';
  const inpStyle = { borderColor: PAY.line };

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="pay-day-editor">
      <form onSubmit={save} className="w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 text-white" style={{ background: PAY.ink2 }}>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: PAY.gold }}>{worker.name}</div>
          <div className="font-display font-bold">{new Date(day + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <div className="p-4 space-y-3">
          {locked && <div className="rounded-lg px-3 py-2 text-sm" style={{ background: '#ede9fe', color: '#4c1d95' }}><Lock size={12} className="inline mr-1" /> This period is closed. Reopen it on the Pay periods tab to change this day.</div>}
          {entry?.status === 'rejected' && entry.rejected_reason && (
            <div className="rounded-lg px-3 py-2 text-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>Rejected: {entry.rejected_reason}</div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button key={k.key} type="button" onClick={() => set('kind', k.key)} disabled={locked}
                className="rounded-full px-3 py-1 text-xs font-bold border"
                style={form.kind === k.key ? { background: PAY.ink2, color: '#fff', borderColor: PAY.ink2 } : { borderColor: PAY.line, color: PAY.ink2 }}>
                {k.label}
              </button>
            ))}
          </div>
          {form.kind === 'work' ? (
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs font-semibold" style={{ color: PAY.muted }}>Start<input type="time" value={form.start} onChange={(e) => set('start', e.target.value)} className={inp} style={inpStyle} disabled={locked} data-testid="pay-start" /></label>
              <label className="text-xs font-semibold" style={{ color: PAY.muted }}>Finish<input type="time" value={form.finish} onChange={(e) => set('finish', e.target.value)} className={inp} style={inpStyle} disabled={locked} data-testid="pay-finish" /></label>
              <label className="text-xs font-semibold" style={{ color: PAY.muted }}>Break (min)<input type="number" min={0} max={600} value={form.break_minutes} onChange={(e) => set('break_minutes', e.target.value)} className={inp} style={inpStyle} disabled={locked} /></label>
            </div>
          ) : form.kind !== 'no_work' && (
            <label className="block text-xs font-semibold w-40" style={{ color: PAY.muted }}>Hours<input type="number" step="0.1" min={0} max={24} value={form.hours} onChange={(e) => set('hours', e.target.value)} className={inp} style={inpStyle} disabled={locked} /></label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold" style={{ color: PAY.muted }}>Site<input value={form.site_name} onChange={(e) => set('site_name', e.target.value)} className={inp} style={inpStyle} disabled={locked} placeholder="Where they worked" /></label>
            <label className="text-xs font-semibold" style={{ color: PAY.muted }}>Job / cost code<input value={form.job_ref} onChange={(e) => set('job_ref', e.target.value)} className={inp} style={inpStyle} disabled={locked} /></label>
          </div>
          {form.kind === 'work' && (settings.allowance_types || []).length > 0 && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: PAY.muted }}>Allowances</div>
              <div className="flex flex-wrap gap-2">
                {settings.allowance_types.map((a) => (
                  <label key={a.code} className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: PAY.line }}>
                    <input type="checkbox" checked={allowanceQty(a.code) > 0} disabled={locked}
                      onChange={(e) => setAllowance(a.code, e.target.checked ? 1 : 0)} />
                    {a.label}
                    {a.unit !== 'day' && allowanceQty(a.code) > 0 && (
                      <input type="number" min={0} max={100} step="0.5" value={allowanceQty(a.code)} disabled={locked}
                        onChange={(e) => setAllowance(a.code, Number(e.target.value))} className="w-14 rounded border px-1 py-0.5" style={{ borderColor: PAY.line }} />
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}
          <label className="block text-xs font-semibold" style={{ color: PAY.muted }}>Notes<textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className={inp} style={inpStyle} disabled={locked} /></label>
          {entry && (
            <div className="text-xs" style={{ color: PAY.muted }}>
              <StatusPill status={entry.status} />{' '}
              {entry.source === 'signon' && 'Pre-filled from site sign-on. '}
              {entry.approved_by_name && `Approved by ${entry.approved_by_name}. `}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: `1px solid ${PAY.line}` }}>
          {entry && !locked ? <button type="button" onClick={remove} className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600"><Trash2 size={13} /> Remove day</button> : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={payBtn('ghost')} style={payBtnStyle('ghost')}>Cancel</button>
            {!locked && <button type="submit" disabled={busy} className={payBtn('primary')} style={payBtnStyle('primary')} data-testid="pay-day-save">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save</button>}
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// ── Grid ────────────────────────────────────────────────────────────

export default function PayTimesheets() {
  const [periodId, setPeriodId] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);   // { worker, day, entry }
  const [selected, setSelected] = useState(new Set());

  const load = useCallback(async (pid) => {
    try {
      const r = await api.get('/payroll/timesheets', { params: pid ? { period_id: pid } : {} });
      setData(r.data); setPeriodId(r.data.period.id); setSelected(new Set());
    } catch (e) { toast.error(apiError(e) || 'Could not load timesheets'); }
  }, []);
  useEffect(() => {
    // Coming from the Pay periods tab? Open that period.
    let pid = null;
    try { pid = sessionStorage.getItem('pay.period'); sessionStorage.removeItem('pay.period'); } catch { /* ignore */ }
    load(pid);
  }, [load]);

  const byCell = useMemo(() => {
    const m = {};
    (data?.entries || []).forEach((e) => { m[`${e.worker_id}|${e.date}`] = e; });
    return m;
  }, [data]);

  const prefill = async () => {
    setBusy(true);
    try {
      const r = await api.post('/payroll/timesheets/prefill', null, { params: { period_id: periodId } });
      toast.success(r.data.created ? `${r.data.created} day(s) pre-filled from site sign-ons` : 'Nothing new to pre-fill');
      load(periodId);
    } catch (e) { toast.error(apiError(e) || 'Pre-fill failed'); }
    finally { setBusy(false); }
  };

  const act = async (what) => {
    const ids = [...selected];
    if (!ids.length) return;
    let reason;
    if (what === 'reject') { reason = window.prompt('Why are these being sent back? (shown to the worker)') || ''; }
    try {
      const r = await api.post(`/payroll/timesheets/${what}`, { ids, reason });
      toast.success(`${r.data[what === 'approve' ? 'approved' : 'rejected']} entr${r.data[what === 'approve' ? 'approved' : 'rejected'] === 1 ? 'y' : 'ies'} ${what === 'approve' ? 'approved' : 'sent back'}`);
      load(periodId);
    } catch (e) { toast.error(apiError(e) || 'Failed'); }
  };

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllPending = () => setSelected(new Set((data?.entries || []).filter((e) => ['draft', 'submitted', 'rejected'].includes(e.status)).map((e) => e.id)));

  if (!data) return <div className="text-sm" style={{ color: PAY.muted }}>Loading…</div>;
  const { period, days, workers, settings } = data;
  const totals = (wid) => days.reduce((n, d) => n + (byCell[`${wid}|${d}`]?.kind === 'work' ? (byCell[`${wid}|${d}`]?.hours || 0) : 0), 0);
  const isClosed = period.status === 'closed';

  return (
    <div className="space-y-4" data-testid="pay-timesheets">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => load(shiftPeriod(periodId, -1))} className={payBtn('ghost')} style={payBtnStyle('ghost')} aria-label="Previous period"><ChevronLeft size={16} /></button>
        <div className="font-display font-bold text-lg" style={{ color: PAY.ink }}>{fmtRange(period.start, period.end)} <span className="ml-2 align-middle"><StatusPill status={period.status} /></span></div>
        <button type="button" onClick={() => load(shiftPeriod(period.end, 1))} className={payBtn('ghost')} style={payBtnStyle('ghost')} aria-label="Next period"><ChevronRight size={16} /></button>
        <div className="ml-auto flex flex-wrap gap-2">
          {!isClosed && <button type="button" onClick={prefill} disabled={busy} className={payBtn('ghost')} style={payBtnStyle('ghost')} data-testid="pay-ts-prefill"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Pre-fill from sign-ons</button>}
          <button type="button" onClick={() => downloadCsv(periodId, 'daily')} className={payBtn('ghost')} style={payBtnStyle('ghost')}><Download size={14} /> Daily CSV</button>
        </div>
      </div>

      {!isClosed && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={selectAllPending} className="text-xs font-semibold underline" style={{ color: PAY.ink2 }}>Select all unapproved</button>
          <span className="text-xs" style={{ color: PAY.muted }}>{selected.size} selected</span>
          <button type="button" onClick={() => act('approve')} disabled={!selected.size} className={payBtn('primary')} style={payBtnStyle('primary')} data-testid="pay-approve"><Check size={14} /> Approve</button>
          <button type="button" onClick={() => act('reject')} disabled={!selected.size} className={payBtn('ghost')} style={payBtnStyle('ghost')} data-testid="pay-reject"><X size={14} /> Send back</button>
        </div>
      )}

      <PayCard className="overflow-hidden">
        <div className="overflow-x-auto -m-4">
          <table className="w-full text-sm" data-testid="pay-grid">
            <thead>
              <tr style={{ background: '#f3f2fa' }}>
                <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider sticky left-0 bg-[#f3f2fa]" style={{ color: PAY.muted }}>Person</th>
                {days.map((d) => {
                  const dt = new Date(d + 'T00:00:00');
                  const weekend = dt.getDay() === 0 || dt.getDay() === 6;
                  return <th key={d} className="px-1 py-2 text-center text-[11px] uppercase tracking-wider" style={{ color: weekend ? '#b45309' : PAY.muted }}>{dt.toLocaleDateString('en-AU', { weekday: 'short' })}<br /><span className="font-normal normal-case">{dt.getDate()}/{dt.getMonth() + 1}</span></th>;
                })}
                <th className="px-3 py-2 text-right text-[11px] uppercase tracking-wider" style={{ color: PAY.muted }}>Hours</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id} className="border-t" style={{ borderColor: PAY.line }}>
                  <td className="px-3 py-1.5 font-semibold whitespace-nowrap sticky left-0 bg-white" style={{ color: PAY.ink }}>
                    {w.name}
                    <div className="text-[10px] font-normal" style={{ color: PAY.muted }}>{w.position || w.employment_type?.replace('_', ' ')}</div>
                  </td>
                  {days.map((d) => {
                    const e = byCell[`${w.id}|${d}`];
                    const can = e && ['draft', 'submitted', 'rejected'].includes(e.status) && !isClosed;
                    return (
                      <td key={d} className="px-1 py-1 text-center">
                        <div className="relative inline-block">
                          <button type="button" onClick={() => setEditing({ worker: w, day: d, entry: e || null })}
                            title={e ? `${e.kind === 'work' ? `${e.start}–${e.finish}` : e.kind} · ${e.status}${e.site_name ? ` · ${e.site_name}` : ''}` : 'Add'}
                            className="w-14 h-11 rounded-lg text-sm font-bold border"
                            style={e ? { background: STATUS_COLOR[e.status] || '#e5e7eb', borderColor: 'transparent', color: PAY.ink }
                              : { background: '#fff', borderColor: PAY.line, color: '#c7c6da' }}
                            data-testid={`pay-cell-${w.id}-${d}`}>
                            {e ? (e.kind === 'work' ? e.hours : { rdo: 'RDO', leave: 'LV', public_holiday: 'PH', no_work: '—' }[e.kind]) : '+'}
                            {e?.notes && e.source === 'signon' && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500" title="Check this day" />}
                          </button>
                          {can && (
                            <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)}
                              onClick={(ev) => ev.stopPropagation()} className="absolute -bottom-1 -left-1 w-3.5 h-3.5" aria-label="Select" />
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right font-bold" style={{ color: PAY.ink }}>{totals(w.id).toFixed(1)}</td>
                </tr>
              ))}
              {workers.length === 0 && <tr><td colSpan={days.length + 2} className="p-6 text-center text-sm" style={{ color: PAY.muted }}>No active workers found. Add people under Settings → Workers.</td></tr>}
            </tbody>
          </table>
        </div>
      </PayCard>

      <div className="flex flex-wrap gap-3 text-[11px]" style={{ color: PAY.muted }}>
        {Object.entries(STATUS_COLOR).map(([k, c]) => <span key={k} className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{ background: c }} /> {k}</span>)}
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" /> pre-filled, needs checking</span>
      </div>

      {editing && (
        <DayEditor worker={editing.worker} day={editing.day} entry={editing.entry} settings={settings}
          onClose={() => setEditing(null)} onSaved={() => load(periodId)} />
      )}
    </div>
  );
}
