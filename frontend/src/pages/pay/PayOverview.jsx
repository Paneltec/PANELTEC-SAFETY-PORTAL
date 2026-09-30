// Paneltec Pay — Overview: the current period at a glance.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, RefreshCw, CheckCheck, AlertTriangle } from 'lucide-react';
import api, { apiError, API_BASE, TOKEN_KEY } from '../../lib/api';
import { PAY, PayCard, StatusPill, fmtRange, payBtn, payBtnStyle } from './PayShell';

function Stat({ label, value, sub, accent }) {
  return (
    <div className="rounded-xl p-3" style={{ background: accent ? PAY.goldSoft : '#f3f2fa' }}>
      <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: PAY.muted }}>{label}</div>
      <div className="font-display font-extrabold text-2xl mt-0.5" style={{ color: PAY.ink }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: PAY.muted }}>{sub}</div>}
    </div>
  );
}

export function downloadCsv(periodId, fmt) {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  fetch(`${API_BASE}/payroll/export?period_id=${encodeURIComponent(periodId)}&fmt=${fmt}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || 'Export failed');
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const m = /filename="([^"]+)"/.exec(cd);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m ? m[1] : `paneltec-pay-${periodId}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  }).catch((e) => toast.error(e.message));
}

export default function PayOverview() {
  const [data, setData] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.get('/payroll/summary'), api.get('/payroll/periods', { params: { months_back: 2 } })]);
      setData(s.data); setPeriods(p.data.periods || []);
    } catch (e) { toast.error(apiError(e) || 'Could not load Paneltec Pay'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const prefill = async () => {
    setBusy(true);
    try {
      const r = await api.post('/payroll/timesheets/prefill', null, { params: { period_id: data.period.id } });
      toast.success(r.data.created ? `${r.data.created} day(s) pre-filled from site sign-ons` : 'Nothing new to pre-fill');
      load();
    } catch (e) { toast.error(apiError(e) || 'Pre-fill failed'); }
    finally { setBusy(false); }
  };

  if (!data) return <div className="text-sm" style={{ color: PAY.muted }}>Loading…</div>;
  const t = data.totals;
  const current = periods.find((p) => p.id === data.period.id) || {};
  const submitted = data.rows.reduce((n, r) => n + r.status.submitted, 0);
  const draft = data.rows.reduce((n, r) => n + r.status.draft, 0);

  return (
    <div className="space-y-4" data-testid="pay-overview">
      <PayCard
        title={<>This pay period · {fmtRange(data.period.start, data.period.end)} <span className="ml-2"><StatusPill status={current.status || 'open'} /></span></>}
        aside={
          <div className="flex gap-2">
            <button type="button" onClick={prefill} disabled={busy} className={payBtn('ghost')} style={payBtnStyle('ghost')} data-testid="pay-prefill">
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Pre-fill from sign-ons
            </button>
            <button type="button" onClick={() => downloadCsv(data.period.id, 'summary')} className={payBtn('gold')} style={payBtnStyle('gold')} data-testid="pay-export">
              <Download size={14} /> Export CSV
            </button>
          </div>
        }>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="People with hours" value={t.workers} />
          <Stat label="Total hours" value={t.hours} sub={`${t.ordinary} ordinary · ${t.ot_1} at 1.5× · ${t.ot_2} at 2× (estimates)`} />
          <Stat label="Waiting for approval" value={submitted} sub={`${draft} still in draft`} accent={submitted > 0} />
          <Stat label="Unapproved entries" value={t.unapproved} sub={t.unapproved ? 'Approve before closing' : 'All clear'} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link to="/app/pay/timesheets" className={payBtn('primary')} style={payBtnStyle('primary')}><CheckCheck size={14} /> Open timesheets</Link>
          <Link to="/app/pay/periods" className={payBtn('ghost')} style={payBtnStyle('ghost')}>All pay periods</Link>
        </div>
      </PayCard>

      <PayCard title="By person">
        {data.rows.length === 0 ? (
          <div className="text-sm" style={{ color: PAY.muted }}>
            No hours recorded for this period yet. Click <strong>Pre-fill from sign-ons</strong> to pull in the site sign-ons, or add days on the Timesheets tab.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-left" style={{ color: PAY.muted }}>
                <tr><th className="py-1.5 pr-3">Person</th><th className="py-1.5 pr-3">Days</th><th className="py-1.5 pr-3">Hours</th><th className="py-1.5 pr-3">Ordinary</th><th className="py-1.5 pr-3">OT 1.5×</th><th className="py-1.5 pr-3">OT 2×</th><th className="py-1.5 pr-3">RDO</th><th className="py-1.5 pr-3">Leave</th><th className="py-1.5">Status</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.worker_id} className="border-t" style={{ borderColor: PAY.line }}>
                    <td className="py-2 pr-3 font-semibold" style={{ color: PAY.ink }}>{r.name}</td>
                    <td className="py-2 pr-3">{r.days}</td>
                    <td className="py-2 pr-3 font-semibold">{r.hours}</td>
                    <td className="py-2 pr-3">{r.ordinary}</td>
                    <td className="py-2 pr-3">{r.ot_1 || '—'}</td>
                    <td className="py-2 pr-3">{r.ot_2 || '—'}</td>
                    <td className="py-2 pr-3">{r.rdo_taken ? `−${r.rdo_taken}` : ''}{r.rdo_accrued ? ` +${r.rdo_accrued}` : ''}</td>
                    <td className="py-2 pr-3">{r.leave_hours || (r.approved_leave ? <span title={r.approved_leave.map((l) => `${l.type} ${l.start}→${l.end}`).join('\n')} className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={12} /> approved leave</span> : '—')}</td>
                    <td className="py-2">
                      {r.status.submitted > 0 && <StatusPill status="submitted" />}{' '}
                      {r.status.draft > 0 && <StatusPill status="draft" />}{' '}
                      {r.status.rejected > 0 && <StatusPill status="rejected" />}{' '}
                      {r.status.approved > 0 && !r.status.submitted && !r.status.draft && <StatusPill status="approved" />}
                      {r.status.locked > 0 && <StatusPill status="locked" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 text-xs" style={{ color: PAY.muted }}>
          Overtime splits are estimates for checking only. Your payroll provider's award rules are the source of truth.
        </div>
      </PayCard>
    </div>
  );
}
