// v58.13.106 — Admin visitor register.
import React, { useEffect, useMemo, useState } from 'react';
import api, { apiError } from '../lib/api';
import { toast } from 'sonner';

export default function AdminVisitors() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [siteId, setSiteId] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const params = { limit: 200 };
      if (siteId) params.site_id = siteId;
      if (activeOnly) params.active_only = true;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data } = await api.get('/admin/visitors', { params });
      setRows(data.items || []);
    } catch (e) { setError(apiError(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const sites = useMemo(() => {
    const s = new Map();
    rows.forEach((r) => { if (r.site_id) s.set(r.site_id, r.site_id); });
    return Array.from(s.keys());
  }, [rows]);

  const forceSignOut = async (v) => {
    if (!window.confirm(`Force sign-out ${v.name}?`)) return;
    try {
      await api.post(`/admin/visitors/${v.id}/force-signout`);
      toast.success(`Signed out ${v.name}`);
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const durationMin = (r) => {
    if (!r.signed_in_at) return '';
    const end = r.signed_out_at ? new Date(r.signed_out_at) : new Date();
    const min = Math.max(0, Math.round((end - new Date(r.signed_in_at)) / 60000));
    return `${min} min`;
  };

  return (
    <div className="p-6 space-y-6" data-testid="admin-visitors-page">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Site Visitors</h1>
        <p className="text-sm text-slate-500">Public sign-in register from site QR codes.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-2xl border border-slate-200">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">Site ID</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[160px]"
            data-testid="admin-visitors-site-filter">
            <option value="">All sites</option>
            {sites.map((s) => <option key={s} value={s}>{s.slice(0, 8)}…</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">From</span>
          <input type="date" value={dateFrom.slice(0, 10)}
            onChange={(e) => setDateFrom(e.target.value ? `${e.target.value}T00:00:00Z` : '')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm" data-testid="admin-visitors-date-from" />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">To</span>
          <input type="date" value={dateTo.slice(0, 10)}
            onChange={(e) => setDateTo(e.target.value ? `${e.target.value}T23:59:59Z` : '')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm" data-testid="admin-visitors-date-to" />
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)}
            className="h-4 w-4 accent-brand-blue" data-testid="admin-visitors-active-only" />
          <span className="text-sm">Active only</span>
        </label>
        <button onClick={load} disabled={loading}
          className="px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          data-testid="admin-visitors-refresh">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 text-sm">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm" data-testid="admin-visitors-table">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Company</th>
              <th className="text-left px-4 py-2">Phone</th>
              <th className="text-left px-4 py-2">Visiting</th>
              <th className="text-left px-4 py-2">Purpose</th>
              <th className="text-left px-4 py-2">Signed in</th>
              <th className="text-left px-4 py-2">Signed out</th>
              <th className="text-left px-4 py-2">Duration</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100" data-testid={`admin-visitors-row-${r.id}`}>
                <td className="px-4 py-2 font-medium">{r.name}</td>
                <td className="px-4 py-2 text-slate-600">{r.company || '—'}</td>
                <td className="px-4 py-2 text-slate-600 font-mono text-xs">{r.phone || '—'}</td>
                <td className="px-4 py-2 text-slate-600">{r.visiting_person || '—'}</td>
                <td className="px-4 py-2 text-slate-600">{r.purpose || '—'}</td>
                <td className="px-4 py-2 text-slate-500 text-xs">{r.signed_in_at ? new Date(r.signed_in_at).toLocaleString() : '—'}</td>
                <td className="px-4 py-2 text-slate-500 text-xs">
                  {r.signed_out_at
                    ? new Date(r.signed_out_at).toLocaleString()
                    : <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">On site</span>}
                </td>
                <td className="px-4 py-2 text-slate-600 text-xs">{durationMin(r)}</td>
                <td className="px-4 py-2 text-right">
                  {!r.signed_out_at && (
                    <button onClick={() => forceSignOut(r)}
                      className="text-xs px-3 py-1 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50"
                      data-testid={`admin-visitors-force-signout-${r.id}`}>
                      Force sign-out
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No visitors match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
