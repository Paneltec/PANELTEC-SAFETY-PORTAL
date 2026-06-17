import React, { useEffect, useState } from 'react';
import { Mail, RefreshCw, Ban, ExternalLink, AlertTriangle, Filter } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { PageHeader } from '../components/capture/Ui';

const STATUS_STYLES = {
  queued:    'bg-amber-100 text-amber-800 border-amber-200',
  sent:      'bg-emerald-100 text-emerald-800 border-emerald-200',
  failed:    'bg-red-100 text-red-800 border-red-200',
  cancelled: 'bg-slate-200 text-slate-700 border-slate-300',
};

export default function Outbox() {
  const [data, setData] = useState({ items: [], m365_connected: false, count: 0 });
  const [statusF, setStatusF] = useState('');
  const [kindF, setKindF] = useState('');
  const [active, setActive] = useState(null);

  const load = async () => {
    const params = new URLSearchParams();
    if (statusF) params.set('status', statusF);
    if (kindF) params.set('related_record_type', kindF);
    try {
      const { data: d } = await api.get('/email/outbox?' + params.toString());
      setData(d);
    } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusF, kindF]);

  const retry  = async (id) => { try { await api.post(`/email/outbox/${id}/retry`);  toast.success('Retried'); load(); } catch (e) { toast.error(apiError(e)); } };
  const cancel = async (id) => { try { await api.post(`/email/outbox/${id}/cancel`); toast.success('Cancelled'); load(); } catch (e) { toast.error(apiError(e)); } };

  return (
    <div className="max-w-6xl mx-auto" data-testid="outbox-page">
      <PageHeader crumb="Settings / Email outbox" title="Email outbox"
        subtitle={`${data.count} messages · provider: Microsoft 365${data.m365_connected ? '' : ' (not connected)'}`} />

      {!data.m365_connected && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3" data-testid="m365-banner">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <strong>Microsoft 365 not connected.</strong> Queued emails won't send until M365 is configured in
            <a href="/app/settings/integrations" className="underline ml-1">Settings → Integrations</a>.
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Filter size={14} className="text-slate-400" />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)}
          className="text-sm border border-slate-300 rounded-lg px-2 py-1.5" data-testid="outbox-filter-status">
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={kindF} onChange={(e) => setKindF(e.target.value)}
          className="text-sm border border-slate-300 rounded-lg px-2 py-1.5" data-testid="outbox-filter-kind">
          <option value="">All record types</option>
          {['swms', 'pre_starts', 'site_diary', 'hazards', 'incidents', 'inspections',
            'contractors', 'renewals', 'audit_exports'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button onClick={load} className="text-sm inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">To</th>
              <th className="text-left px-4 py-2.5">Subject</th>
              <th className="text-left px-4 py-2.5">Related</th>
              <th className="text-left px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr><td colSpan={6} className="text-center text-sm text-slate-500 py-8">No outbox messages.</td></tr>
            )}
            {data.items.map((m) => (
              <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`outbox-row-${m.id}`}>
                <td className="px-4 py-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border ${STATUS_STYLES[m.status]}`}>
                    {m.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-700 truncate max-w-[200px]">{(m.to || []).join(', ')}</td>
                <td className="px-4 py-3 font-medium cursor-pointer" onClick={() => setActive(m)}>{m.subject}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{m.related_record_type || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{new Date(m.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {(m.status === 'queued' || m.status === 'failed') && (
                    <button onClick={() => retry(m.id)} title="Retry" className="text-xs px-2 py-1 hover:bg-slate-100 rounded inline-flex items-center gap-1 mr-1"
                      data-testid={`outbox-retry-${m.id}`}><RefreshCw size={12} /> Retry</button>
                  )}
                  {m.status === 'queued' && (
                    <button onClick={() => cancel(m.id)} title="Cancel" className="text-xs px-2 py-1 hover:bg-red-50 text-red-700 rounded inline-flex items-center gap-1"
                      data-testid={`outbox-cancel-${m.id}`}><Ban size={12} /> Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end sm:items-center justify-end" onClick={() => setActive(null)}>
          <div className="bg-white w-full sm:max-w-lg h-full sm:h-auto sm:max-h-[80vh] overflow-auto border-l border-slate-200 p-5" onClick={(e) => e.stopPropagation()} data-testid="outbox-drawer">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Status</div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase border ${STATUS_STYLES[active.status]}`}>{active.status}</span>
              </div>
              <button onClick={() => setActive(null)} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
            </div>
            <h3 className="font-display text-xl mt-3">{active.subject}</h3>
            <div className="mt-2 text-xs text-slate-500"><Mail size={11} className="inline -mt-0.5 mr-1" /> {(active.to || []).join(', ')}</div>
            {active.cc?.length > 0 && <div className="text-xs text-slate-500">CC: {active.cc.join(', ')}</div>}
            <div className="mt-4 border border-slate-200 rounded-lg p-3 prose prose-sm max-w-none text-sm" dangerouslySetInnerHTML={{ __html: active.body_html || '' }} />
            {active.attachments?.length > 0 && (
              <div className="mt-3"><div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Attachments</div>
                <ul className="text-sm space-y-1">{active.attachments.map((a, i) => (
                  <li key={i}><a href={a.file_url} className="text-brand-blue hover:underline inline-flex items-center gap-1"><ExternalLink size={11} /> {a.filename}</a></li>
                ))}</ul>
              </div>
            )}
            {active.error && <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">Error: {active.error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
