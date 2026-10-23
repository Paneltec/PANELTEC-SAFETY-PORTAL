import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';

export default function WeeklyDieselPricing({ canEdit, onModeChange }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const apply = useCallback(value => { setData(value); onModeChange(value.enabled); }, [onModeChange]);
  useEffect(() => {
    let cancelled = false;
    api.get('/fleet/fuel/weekly-diesel').then(r => { if (!cancelled) apply(r.data); })
      .catch(() => { if (!cancelled) setError('Weekly diesel pricing could not be loaded.'); });
    return () => { cancelled = true; };
  }, [apply]);
  const change = async (enabled) => {
    setBusy(true); setError('');
    try { const r = await api.put('/fleet/fuel/weekly-diesel', {enabled}); apply(r.data); toast.success(enabled ? 'Weekly diesel pricing enabled for new imports. Existing fills stay locked.' : 'Manual pricing selected for new imports. Existing fills stay locked.'); }
    catch (e) { setError(apiError(e)); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true); setError('');
    try { const r = await api.post('/fleet/fuel/weekly-diesel/refresh'); apply(r.data); }
    catch (e) { setError(apiError(e)); }
    finally { setBusy(false); }
  };
  const date = value => String(value || '').split('-').reverse().join('/');
  return <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 space-y-3" aria-label="Weekly diesel pricing">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h2 className="text-lg font-bold text-slate-900">Weekly diesel price</h2><p className="text-sm text-slate-600">FuelCheck Tasmania · ordinary diesel · AUD per litre</p></div>
      <span className="text-sm font-semibold text-blue-800">{data?.enabled ? 'Automatic weekly pricing on' : 'Manual / SmartFill pricing active'}</span>
    </div>
    <p className="text-sm text-slate-700">Each Monday–Sunday week uses the average of the previous seven calendar days, in Tasmania time. Once saved, a week’s rate stays locked. Existing imported fills keep their original prices.</p>
    {data?.current ? <div className="rounded-xl bg-white p-4">
      <strong className="text-2xl text-slate-900">${Number(data.current.price_per_litre).toFixed(4)}/L</strong>
      <p className="text-sm text-slate-700">For {date(data.current.week_start)} – {date(data.current.week_end)}</p>
      <p className="text-xs text-slate-500 mt-1">Average of {date(data.current.source_week_start)} – {date(data.current.source_week_end)} · 7 daily prices · locked</p>
    </div> : <p className="text-sm text-amber-800">This week’s price has not been captured. Refresh FuelCheck to check availability.</p>}
    <p className="text-xs text-slate-600">These are retail benchmark estimates, not supplier invoice costs. New diesel fills use the rate for their fill date. If that week’s rate is unavailable, those rows wait for a retry instead of receiving a guessed price.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-3 items-center text-sm">
      {canEdit && <><button type="button" disabled={busy} onClick={refresh} className="rounded-lg border border-blue-300 bg-white px-3 py-2 disabled:opacity-50">{busy ? 'Working…' : 'Refresh FuelCheck'}</button><button type="button" disabled={busy || !data} onClick={() => change(!data.enabled)} className="rounded-lg bg-blue-700 text-white px-3 py-2 disabled:opacity-50">{data?.enabled ? 'Use manual / SmartFill pricing' : 'Enable weekly diesel pricing'}</button></>}
      <a href={data?.source_url || 'https://www.fuelcheck.tas.gov.au/app/FuelPrice/Trend?fuelTypeCode=DL'} target="_blank" rel="noreferrer" className="text-blue-700 underline">FuelCheck source</a>
      <button type="button" onClick={() => setHistory(!history)} className="text-blue-700 underline">{history ? 'Hide' : 'Show'} locked weekly prices</button>
    </div>
    {history && <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Applies to week</th><th className="p-2">Source week</th><th className="p-2">Locked $/L</th></tr></thead><tbody>{(data?.history || []).map(w => <tr key={w.week_start} className="border-t border-blue-100"><td className="p-2">{date(w.week_start)} – {date(w.week_end)}</td><td className="p-2">{date(w.source_week_start)} – {date(w.source_week_end)}</td><td className="p-2">${Number(w.price_per_litre).toFixed(4)}</td></tr>)}</tbody></table></div>}
  </section>;
}
