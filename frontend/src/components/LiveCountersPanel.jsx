// Phase 3.5 — Live counter chips for the AssetDrawer (Engine hours / Odometer).
// Renders read-only "synced from Navixy" cards for tracker-linked vehicles
// and editable number inputs for manually-managed plant.
import React, { useEffect, useState } from 'react';
import { Gauge, Activity, RefreshCcw, Loader2, Save, CheckCircle2 } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';

function fmtAgo(iso) {
  if (!iso) return null;
  try {
    const d = typeof iso === 'string' ? parseISO(iso.replace(' ', 'T')) : iso;
    if (isNaN(d.getTime())) return null;
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return null;
  }
}

function fmtHours(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });
}
function fmtKm(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Phase 4.8 — tiny inline sparkline. recharts is already bundled (used by the
// dashboard charts) so this avoids pulling a second viz library. No axes /
// tooltip / grid — pure trend shape.
function Sparkline({ data, dataKey, color }) {
  if (!data || data.length === 0) return null;
  // Filter out null y-values, recharts will connect through.
  const safe = data.map((d) => ({ ...d, [dataKey]: d[dataKey] == null ? undefined : d[dataKey] }));
  return (
    <div className="h-5 w-full mt-1" data-testid={`sparkline-${dataKey}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={safe} margin={{ top: 1, right: 1, left: 1, bottom: 1 }}>
          <Line type="monotone" dataKey={dataKey} stroke={color}
            strokeWidth={1.5} dot={false} isAnimationActive={false}
            connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function fmtSigned(n, digits = 1) {
  if (n == null || isNaN(n)) return '—';
  const v = Number(n);
  if (v === 0) return '0';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

export default function LiveCountersPanel({ asset, onAssetUpdated }) {
  // Plant and vehicles both have meters; tools/containers do not.
  if (!asset || (asset.kind !== 'vehicle' && asset.kind !== 'plant')) return null;
  const isNavixy = !!asset.navixy_device_id;
  return isNavixy
    ? <NavixyCounters asset={asset} onAssetUpdated={onAssetUpdated} />
    : <ManualCounters asset={asset} onAssetUpdated={onAssetUpdated} />;
}

function CounterCardShell({ icon: Icon, label, value, unit, sub, accent, testid, children }) {
  return (
    <div className={`px-3 py-2.5 rounded-xl border ${accent} flex items-start gap-2.5`} data-testid={testid}>
      <div className="w-8 h-8 rounded-lg bg-white/70 border border-emerald-200 flex items-center justify-center shrink-0">
        <Icon size={15} className="text-emerald-700" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700/80">{label}</div>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="font-display text-xl font-bold text-slate-900 tabular-nums">{value}</span>
          <span className="text-xs font-semibold text-slate-500">{unit}</span>
        </div>
        {sub && <div className="text-[10px] text-slate-500 mt-0.5 truncate">{sub}</div>}
        {children}
      </div>
    </div>
  );
}

function NavixyCounters({ asset, onAssetUpdated }) {
  const user = getUser();
  const canRefresh = user?.role === 'admin';
  const [refreshing, setRefreshing] = useState(false);
  // Phase 4.8 — tabs + meter-trends fetch.
  const [tab, setTab] = useState('total'); // 'total' | 'week' | 'month'
  const [trends, setTrends] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`/assets/${asset.id}/meter-trends`)
      .then((r) => { if (alive) setTrends(r.data); })
      .catch(() => { if (alive) setTrends({ error: true }); });
    return () => { alive = false; };
  }, [asset.id]);

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      const r = await api.post('/assets/navixy/sync-counters');
      const d = r.data || {};
      if (d.updated > 0) toast.success(`Synced ${d.updated} asset${d.updated === 1 ? '' : 's'} from Navixy`);
      else toast.info(`No new readings — last sync still current (${d.devices || 0} devices polled)`);
      // Refetch this asset so the UI reflects the latest values
      try {
        const a = await api.get(`/assets/${asset.id}`);
        if (onAssetUpdated) onAssetUpdated(a.data);
        // also reload trends — the latest snapshot may have shifted
        const t = await api.get(`/assets/${asset.id}/meter-trends`);
        setTrends(t.data);
      } catch { /* swallow — UI will reload on its own */ }
    } catch (e) { toast.error(apiError(e)); }
    finally { setRefreshing(false); }
  };

  const hoursAgo = fmtAgo(asset.hours_meter_updated_at);
  const kmAgo = fmtAgo(asset.odo_km_updated_at);
  const syncedAgo = fmtAgo(asset.navixy_last_seen_at);
  const navixyAgo = fmtAgo(asset.navixy_last_position_time);

  const renderTotal = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      <CounterCardShell
        icon={Activity} label="Engine hours" unit="hrs"
        value={fmtHours(asset.hours_meter)}
        sub={hoursAgo ? `Synced from Navixy · ${hoursAgo}` : 'Synced from Navixy'}
        accent="border-emerald-200 bg-white"
        testid="counter-card-hours" />
      <CounterCardShell
        icon={Gauge} label="Odometer" unit="km"
        value={fmtKm(asset.odo_km)}
        sub={kmAgo ? `Synced from Navixy · ${kmAgo}` : 'Synced from Navixy'}
        accent="border-emerald-200 bg-white"
        testid="counter-card-odo" />
    </div>
  );

  const renderDelta = (slot, label) => {
    if (!trends || trends.error) {
      return <div className="text-xs text-slate-500 py-6 text-center" data-testid={`trends-${label}-empty`}>
        Collecting data — try again in a few minutes.
      </div>;
    }
    const s = trends[label]; // 'week' | 'month'
    const total = label === 'week' ? 7 : 30;
    const collecting = (s.days_available || 0) < total;
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-emerald-200 bg-white p-3" data-testid={`counter-card-hours-${label}`}>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">
              <Activity size={12} /> Engine hours
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-slate-900">
              {fmtSigned(s.engine_hours_delta, 1)}
              <span className="text-sm text-slate-400 font-normal ml-1">hrs</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Daily avg: <span className="font-semibold text-slate-700">{s.daily_avg_hours} hrs · {s.daily_avg_km} km</span>
            </div>
            <Sparkline data={s.sparkline} dataKey="engine_hours" color="#10B981" />
          </div>
          <div className="rounded-xl border border-emerald-200 bg-white p-3" data-testid={`counter-card-odo-${label}`}>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">
              <Gauge size={12} /> Odometer
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-slate-900">
              {fmtSigned(s.odometer_km_delta, 0)}
              <span className="text-sm text-slate-400 font-normal ml-1">km</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Daily avg: <span className="font-semibold text-slate-700">{s.daily_avg_hours} hrs · {s.daily_avg_km} km</span>
            </div>
            <Sparkline data={s.sparkline} dataKey="odometer_km" color="#F97316" />
          </div>
        </div>
        {collecting && (
          <div className="mt-2 text-[11px] text-slate-500" data-testid={`trends-${label}-collecting`}>
            Collecting data — {s.days_available} of {total} day{total === 1 ? '' : 's'} available. Daily snapshots accumulate at 01:00 UTC.
          </div>
        )}
      </>
    );
  };

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3" data-testid="live-counters-navixy">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 inline-flex items-center gap-1.5">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px]">LIVE</span>
          <span>Live counters · Navixy</span>
        </div>
        {canRefresh && (
          <button onClick={refreshNow} disabled={refreshing}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
            data-testid="live-counters-refresh">
            {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCcw size={11} />}
            Refresh now
          </button>
        )}
      </div>
      {(syncedAgo || navixyAgo) && (
        <div
          title="Synced with Paneltec = when we last polled Navixy successfully. Navixy last heard = when the tracker last sent a position fix. A large gap between the two usually means the device is parked or out of mobile coverage."
          className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mb-2 text-[10px] text-slate-600"
          data-testid="navixy-dual-timestamps">
          {syncedAgo && (
            <span className="inline-flex items-center gap-1" data-testid="navixy-synced-paneltec">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Synced with Paneltec: <span className="font-semibold text-slate-800">{syncedAgo}</span>
            </span>
          )}
          {navixyAgo && (
            <span className="inline-flex items-center gap-1" data-testid="navixy-last-heard">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
              Navixy last heard: <span className="font-semibold text-slate-800">{navixyAgo}</span>
            </span>
          )}
        </div>
      )}

      {/* Phase 4.8 — tab strip */}
      <div className="inline-flex items-center gap-0.5 mb-2.5 p-0.5 rounded-lg bg-white border border-emerald-200" role="tablist">
        {[
          { k: 'total', label: 'Total' },
          { k: 'week',  label: 'This Week' },
          { k: 'month', label: 'Last Month' },
        ].map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k}
            onClick={() => setTab(t.k)}
            data-testid={`meter-tab-${t.k}`}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
              tab === t.k ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'total' && renderTotal()}
      {tab === 'week'  && renderDelta('week', 'week')}
      {tab === 'month' && renderDelta('month', 'month')}

      <div className="text-[10px] text-slate-500 mt-2 leading-snug">
        {tab === 'total'
          ? 'These values come from the Navixy tracker. Manual edits are disabled — change them in Navixy or, for admin overrides, use the meter reset action.'
          : 'Deltas are computed from daily snapshots of the Navixy counters. Manual edits are disabled.'}
      </div>
    </div>
  );
}

function ManualCounters({ asset, onAssetUpdated }) {
  const [hours, setHours] = useState(asset.hours_meter ?? '');
  const [km, setKm] = useState(asset.odo_km ?? '');
  const [busy, setBusy] = useState(null); // 'hours' | 'km' | null
  const [savedH, setSavedH] = useState(false);
  const [savedK, setSavedK] = useState(false);

  const save = async (kind) => {
    const v = kind === 'hours' ? hours : km;
    if (v === '' || v == null) { toast.error('Enter a value'); return; }
    setBusy(kind);
    try {
      const payload = {
        type: 'meter_update',
        title: kind === 'hours' ? 'Hours updated' : 'Odometer updated',
        [kind === 'hours' ? 'hours_at' : 'km_at']: Number(v),
      };
      await api.post(`/assets/${asset.id}/records`, payload);
      toast.success(`${kind === 'hours' ? 'Engine hours' : 'Odometer'} updated`);
      if (kind === 'hours') { setSavedH(true); setTimeout(() => setSavedH(false), 2000); }
      else { setSavedK(true); setTimeout(() => setSavedK(false), 2000); }
      try {
        const a = await api.get(`/assets/${asset.id}`);
        if (onAssetUpdated) onAssetUpdated(a.data);
      } catch { /* ignore */ }
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(null); }
  };

  const hoursAgo = fmtAgo(asset.hours_meter_updated_at);
  const kmAgo = fmtAgo(asset.odo_km_updated_at);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3" data-testid="live-counters-manual">
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-600 mb-2">Live counters · Manual</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {/* Engine hours */}
        <div className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white" data-testid="counter-card-hours">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <Activity size={13} className="text-emerald-700" />
            </div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-600">Engine hours</div>
          </div>
          <div className="flex items-center gap-2">
            <input type="number" step="0.1" value={hours} onChange={(e) => setHours(e.target.value)}
              className="flex-1 min-w-0 px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm font-semibold tabular-nums"
              placeholder="0.0" data-testid="counter-input-hours" />
            <span className="text-xs font-semibold text-slate-500">hrs</span>
            <button onClick={() => save('hours')} disabled={busy === 'hours'}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              data-testid="counter-save-hours" aria-label="Save hours">
              {busy === 'hours' ? <Loader2 size={13} className="animate-spin" />
                : savedH ? <CheckCircle2 size={13} /> : <Save size={13} />}
            </button>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">{hoursAgo ? `Last updated ${hoursAgo}` : 'Not yet recorded'}</div>
        </div>
        {/* Odometer */}
        <div className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white" data-testid="counter-card-odo">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <Gauge size={13} className="text-emerald-700" />
            </div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-600">Odometer</div>
          </div>
          <div className="flex items-center gap-2">
            <input type="number" value={km} onChange={(e) => setKm(e.target.value)}
              className="flex-1 min-w-0 px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm font-semibold tabular-nums"
              placeholder="0" data-testid="counter-input-km" />
            <span className="text-xs font-semibold text-slate-500">km</span>
            <button onClick={() => save('km')} disabled={busy === 'km'}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              data-testid="counter-save-km" aria-label="Save km">
              {busy === 'km' ? <Loader2 size={13} className="animate-spin" />
                : savedK ? <CheckCircle2 size={13} /> : <Save size={13} />}
            </button>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">{kmAgo ? `Last updated ${kmAgo}` : 'Not yet recorded'}</div>
        </div>
      </div>
    </div>
  );
}
