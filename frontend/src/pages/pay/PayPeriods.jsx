// Paneltec Pay — Pay periods: close, reopen, export.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, Lock, Unlock } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { PAY, PayCard, StatusPill, fmtRange, payBtn, payBtnStyle } from './PayShell';
import { downloadCsv } from './PayOverview';

export default function PayPeriods() {
  const [periods, setPeriods] = useState(null);

  const load = useCallback(async () => {
    try { setPeriods((await api.get('/payroll/periods', { params: { months_back: 6 } })).data.periods || []); }
    catch (e) { toast.error(apiError(e) || 'Could not load pay periods'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const close = async (p) => {
    if (!window.confirm(`Close the period ${fmtRange(p.start, p.end)}?\n\nApproved days are locked. You can reopen it later if something needs fixing.`)) return;
    try { await api.post(`/payroll/periods/${p.id}/close`); toast.success('Period closed'); load(); }
    catch (e) { toast.error(apiError(e) || 'Could not close'); }
  };
  const reopen = async (p) => {
    try { await api.post(`/payroll/periods/${p.id}/reopen`); toast.success('Period reopened'); load(); }
    catch (e) { toast.error(apiError(e) || 'Could not reopen'); }
  };

  if (!periods) return <div className="text-sm" style={{ color: PAY.muted }}>Loading…</div>;

  return (
    <PayCard title="Pay periods" testid="pay-periods">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-left" style={{ color: PAY.muted }}>
            <tr><th className="py-1.5 pr-3">Period</th><th className="py-1.5 pr-3">Status</th><th className="py-1.5 pr-3">Entries</th><th className="py-1.5 pr-3">Hours</th><th className="py-1.5 pr-3">Exported</th><th className="py-1.5 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const c = p.counts || {};
              const pending = (c.draft || 0) + (c.submitted || 0) + (c.rejected || 0);
              return (
                <tr key={p.id} className="border-t" style={{ borderColor: PAY.line, background: p.current ? PAY.goldSoft : undefined }}>
                  <td className="py-2 pr-3 font-semibold" style={{ color: PAY.ink }}>
                    <Link to={`/app/pay/timesheets`} onClick={() => sessionStorage.setItem('pay.period', p.id)} className="hover:underline">{fmtRange(p.start, p.end)}</Link>
                    {p.current && <span className="ml-2 text-[10px] font-bold uppercase" style={{ color: '#b45309' }}>current</span>}
                  </td>
                  <td className="py-2 pr-3"><StatusPill status={p.status} /></td>
                  <td className="py-2 pr-3">
                    {(c.approved || 0) + (c.locked || 0)} approved{pending ? <span className="text-amber-700"> · {pending} to do</span> : ''}
                  </td>
                  <td className="py-2 pr-3">{c.hours ?? 0}</td>
                  <td className="py-2 pr-3 text-xs" style={{ color: PAY.muted }}>{p.exported_at ? new Date(p.exported_at).toLocaleString('en-AU') : '—'}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button type="button" onClick={() => downloadCsv(p.id, 'summary')} className={payBtn('ghost')} style={payBtnStyle('ghost')} title="Summary CSV"><Download size={13} /> CSV</button>{' '}
                    {p.status === 'closed'
                      ? <button type="button" onClick={() => reopen(p)} className={payBtn('ghost')} style={payBtnStyle('ghost')}><Unlock size={13} /> Reopen</button>
                      : <button type="button" onClick={() => close(p)} className={payBtn('primary')} style={payBtnStyle('primary')} disabled={pending > 0} title={pending ? 'Approve everything first' : ''}><Lock size={13} /> Close</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-xs" style={{ color: PAY.muted }}>Closing a period locks its approved days so nothing changes after it has gone to payroll. Export the CSV first, then close.</div>
    </PayCard>
  );
}
