// Phase 3.5 — Live counter chips for the AssetDrawer (Engine hours / Odometer).
// Renders read-only "synced from Navixy" cards for tracker-linked vehicles
// and editable number inputs for manually-managed plant.
import React, { useEffect, useState } from 'react';
import { Gauge, Activity, RefreshCcw, Loader2, Save, CheckCircle2, MoreHorizontal, X, ClipboardEdit } from 'lucide-react';
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
  return (
    <div className="space-y-3">
      {isNavixy
        ? <NavixyCounters asset={asset} onAssetUpdated={onAssetUpdated} />
        : <ManualCounters asset={asset} onAssetUpdated={onAssetUpdated} />}
      {/* Phase 4.9 — Today / Week / Month trip card. Only for Navixy assets. */}
      {isNavixy && <TripSummaryCard asset={asset} />}
    </div>
  );
}

// Phase 4.18 (v137) — Shared "Add historical reading" modal, opened from the
// "..." overflow menu on both Navixy and Manual counter panels. Lets admins
// backfill an old engine-hours / odometer snapshot against any past date so
// the meter-trends chart can anchor deltas correctly (see
// `POST /api/assets/{id}/meter-history`, Phase 4.9 Part 5).
//
// Client-side monotonicity: reads the newest existing snapshot from
// `/api/assets/{id}/meter-history?limit=1` and refuses submits whose date is
// AT-OR-BEFORE that snapshot but whose values are GREATER — that would break
// the delta chain. (Same-day corrections are allowed; the backend upserts.)
function HistoricalReadingModal({ asset, open, onClose, onSaved }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [km, setKm] = useState('');
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDate(new Date().toISOString().slice(0, 10));
    setHours('');
    setKm('');
    setLatest(null);
    // Use `/meter-trends` — the same endpoint the counters card already
    // subscribes to. It returns the newest snapshot alongside week/month
    // deltas, which is enough for the monotonicity guard below.
    api.get(`/assets/${asset.id}/meter-trends`)
      .then((r) => {
        const t = r.data?.total || r.data;
        if (t && (t.snapshot_date || t.date)) {
          setLatest({
            snapshot_date: t.snapshot_date || t.date,
            engine_hours_total: t.engine_hours_total ?? t.hours_total,
            odometer_km_total: t.odometer_km_total ?? t.km_total,
          });
        }
      })
      .catch(() => setLatest(null));
  }, [open, asset.id]);

  if (!open) return null;

  const submit = async () => {
    if (!date) { toast.error('Pick a date'); return; }
    const h = hours === '' ? null : Number(hours);
    const k = km === '' ? null : Number(km);
    if (h == null && k == null) { toast.error('Enter engine hours, odometer, or both'); return; }
    if (h != null && (!Number.isFinite(h) || h < 0)) { toast.error('Engine hours must be ≥ 0'); return; }
    if (k != null && (!Number.isFinite(k) || k < 0)) { toast.error('Odometer must be ≥ 0'); return; }

    // Monotonicity guard against the newest existing snapshot on the client.
    if (latest && latest.snapshot_date && latest.snapshot_date >= date) {
      const latestH = Number(latest.engine_hours_total ?? latest.hours_total ?? 0);
      const latestK = Number(latest.odometer_km_total ?? latest.km_total ?? 0);
      if (h != null && h > latestH) {
        toast.error(`Engine hours ${h} is greater than a later snapshot (${latestH} on ${latest.snapshot_date})`);
        return;
      }
      if (k != null && k > latestK) {
        toast.error(`Odometer ${k} km is greater than a later snapshot (${latestK} on ${latest.snapshot_date})`);
        return;
      }
    }

    setBusy(true);
    try {
      const payload = { date };
      if (h != null) payload.engine_hours = h;
      if (k != null) payload.odometer_km = k;
      await api.post(`/assets/${asset.id}/meter-history`, payload);
      toast.success('Historical reading saved', {
        description: 'Source will show as "Manually entered" on next refresh.',
      });
      try {
        const a = await api.get(`/assets/${asset.id}`);
        if (onSaved) onSaved(a.data);
      } catch { /* swallow */ }
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
         onClick={onClose} data-testid="meter-history-modal">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-orange-600">
              <ClipboardEdit size={12} /> Add historical reading
            </div>
            <h3 className="font-display text-lg font-semibold text-slate-900 mt-0.5">{asset.name || `${asset.make || ''} ${asset.model || ''}`.trim() || 'Asset'}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Backfill an engine-hours or odometer snapshot so meter deltas anchor correctly.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-slate-100 text-slate-400"
                  aria-label="Close" data-testid="meter-history-modal-close"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                   max={new Date().toISOString().slice(0, 10)}
                   className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm"
                   data-testid="meter-history-date" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Engine hours (total, cumulative)</span>
            <input type="number" step="0.1" min="0" placeholder="e.g. 1240.5" value={hours}
                   onChange={(e) => setHours(e.target.value)}
                   className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm font-semibold tabular-nums"
                   data-testid="meter-history-hours" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Odometer (total, cumulative km)</span>
            <input type="number" step="1" min="0" placeholder="e.g. 84120" value={km}
                   onChange={(e) => setKm(e.target.value)}
                   className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm font-semibold tabular-nums"
                   data-testid="meter-history-km" />
          </label>
          {latest?.snapshot_date && (
            <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2"
                 data-testid="meter-history-latest">
              Newest snapshot on file: <span className="font-semibold text-slate-700">{latest.snapshot_date}</span>
              {latest.engine_hours_total != null && <> · {Number(latest.engine_hours_total).toLocaleString()} hrs</>}
              {latest.odometer_km_total != null && <> · {Number(latest.odometer_km_total).toLocaleString()} km</>}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"
                  data-testid="meter-history-cancel">Cancel</button>
          <button onClick={submit} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
                  data-testid="meter-history-submit">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save reading
          </button>
        </div>
      </div>
    </div>
  );
}

// Small "..." trigger + tooltip label. Renders as a subtle icon button so it
// blends into a counter-panel header alongside "Refresh now".
function AddReadingTrigger({ onClick, testid, accent = 'emerald' }) {
  const tone = accent === 'slate'
    ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-slate-200'
    : 'text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100/60 border-emerald-200';
  return (
    <button onClick={onClick} data-testid={testid}
            title="Add historical reading"
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${tone}`}>
      <MoreHorizontal size={13} />
    </button>
  );
}

// ───── Phase 4.9 — Trip summary card (Today / Week / Month) ──────────
function fmtSecs(s) {
  if (!s) return '0m';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function TripSummaryCard({ asset }) {
  const [range, setRange] = useState('today'); // today | week | month
  const [data, setData] = useState({});        // {today: {...}, week, month}
  const [loading, setLoading] = useState({});

  const load = (r) => {
    setLoading((x) => ({ ...x, [r]: true }));
    api.get(`/assets/${asset.id}/trip-summary?range=${r}`)
      .then((res) => setData((d) => ({ ...d, [r]: res.data })))
      .catch(() => setData((d) => ({ ...d, [r]: { error: true } })))
      .finally(() => setLoading((x) => ({ ...x, [r]: false })));
  };
  useEffect(() => { if (!data[range]) load(range); /* eslint-disable-next-line */ }, [range, asset.id]);

  const d = data[range];
  const total = range === 'today' ? 1 : range === 'week' ? 7 : 30;
  const collecting = d && !d.error && range !== 'today' && (d.days_available || 0) < total;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3" data-testid="trip-summary-card">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider font-bold text-orange-700 inline-flex items-center gap-1.5">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-orange-600 text-white text-[9px]">TRIP</span>
          Today's trip · Navixy
        </div>
        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 border border-slate-200" role="tablist">
          {[
            { k: 'today', label: 'Today' },
            { k: 'week',  label: 'This Week' },
            { k: 'month', label: 'Last Month' },
          ].map((t) => (
            <button key={t.k} role="tab" aria-selected={range === t.k}
              onClick={() => setRange(t.k)}
              data-testid={`trip-tab-${t.k}`}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                range === t.k ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading[range] && !d && (
        <div className="text-xs text-slate-500 py-6 text-center" data-testid="trip-loading">Loading trip data…</div>
      )}
      {d && d.error && (
        <div className="text-xs text-rose-600 py-6 text-center" data-testid="trip-error">
          Could not load trip data — check Navixy connection.
        </div>
      )}
      {d && !d.error && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <TripTile label="Distance" value={d.distance_km?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '0'} unit="km" testid="trip-distance" />
            <TripTile label="Drive time" value={fmtSecs(d.drive_seconds)} unit="" testid="trip-drive" />
            <TripTile label="Idle time" value={fmtSecs(d.idle_seconds)} unit="" testid="trip-idle" />
            <TripTile label="Max speed" value={d.max_speed_kmh ?? 0} unit="km/h" testid="trip-max-speed" />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500 flex-wrap">
            <span data-testid="trip-meta">
              {d.trip_count ?? 0} trip{d.trip_count === 1 ? '' : 's'}
              {range !== 'today' && ` · ${d.days_available ?? 0} of ${total} day${total === 1 ? '' : 's'} with activity`}
            </span>
            {collecting && (
              <span className="text-amber-700" data-testid="trip-collecting">
                Collecting data — some days have no trips on file
              </span>
            )}
          </div>
          {/* Tiny sparkline of daily km — shown on all tabs once we have multiple data points. */}
          {d.sparkline && d.sparkline.length > 1 && (
            <div className="mt-1.5" data-testid="trip-sparkline">
              <div className="h-7 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.sparkline} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                    <Line type="monotone" dataKey="km" stroke="#F97316" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[9px] text-slate-400">Daily km · last {d.sparkline.length} days</div>
            </div>
          )}
        </>
      )}
      <div className="text-[10px] text-slate-500 mt-2 leading-snug">
        Trips are aggregated from Navixy's track records. Idle time is approximated from inter-trip gaps shorter than 30 minutes.
      </div>
    </div>
  );
}

function TripTile({ label, value, unit, testid }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{label}</div>
      <div className="mt-0.5 font-display text-xl font-bold text-slate-900 leading-tight">
        {value}
        {unit && <span className="text-[11px] text-slate-400 font-normal ml-1">{unit}</span>}
      </div>
    </div>
  );
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

// Phase 4.9.1 — Fallback card for assets whose lifetime odometer can't be
// trusted (e.g. Kroll Recycler XT04CS: Navixy `get_counters` returns `[]`,
// the report API isn't on the plan, and the lifetime track-sum still under-
// shot the last 30 days of trips). Admins get an inline form to file a
// historical reading via `POST /api/assets/{id}/meter-history`; everyone
// else just sees the explainer.
function UnreliableOdoCard({ asset, onAssetUpdated }) {
  const user = getUser();
  const canEdit = user?.role === 'admin';
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [km, setKm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = Number(km);
    if (!Number.isFinite(n) || n < 0) { toast.error('Enter a non-negative km value'); return; }
    if (!date) { toast.error('Pick a date'); return; }
    setBusy(true);
    try {
      await api.post(`/assets/${asset.id}/meter-history`, {
        date, odometer_km: n,
      });
      toast.success('Historical odometer reading saved');
      setOpen(false); setKm('');
      try {
        const a = await api.get(`/assets/${asset.id}`);
        if (onAssetUpdated) onAssetUpdated(a.data);
      } catch { /* swallow */ }
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="px-3 py-2.5 rounded-xl border border-amber-300 bg-amber-50/70 flex items-start gap-2.5"
      data-testid="counter-card-odo-unreliable">
      <div className="w-8 h-8 rounded-lg bg-white/80 border border-amber-300 flex items-center justify-center shrink-0">
        <Gauge size={15} className="text-amber-700" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-bold text-amber-800/80">Odometer</div>
        <div className="mt-0.5 font-display text-base font-semibold text-amber-900 leading-tight">
          Lifetime not available
        </div>
        <div className="text-[10px] text-amber-800/80 mt-0.5 leading-snug">
          No panel counter — the GPS-derived estimate is lower than this month{`'`}s trips. Add a historical reading to anchor future deltas.
        </div>
        {canEdit && !open && (
          <button onClick={() => setOpen(true)} data-testid="odo-add-reading-btn"
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 hover:text-amber-900 underline">
            + Add a historical reading
          </button>
        )}
        {canEdit && open && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="odo-add-reading-form">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="px-2 py-1 border border-amber-300 rounded-md text-[11px]"
              data-testid="odo-add-reading-date" />
            <input type="number" min="0" placeholder="Total km" value={km}
              onChange={(e) => setKm(e.target.value)}
              className="px-2 py-1 border border-amber-300 rounded-md text-[11px] w-24 tabular-nums"
              data-testid="odo-add-reading-km" />
            <button onClick={submit} disabled={busy}
              className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 disabled:opacity-50"
              data-testid="odo-add-reading-submit">
              {busy ? <Loader2 size={11} className="animate-spin" /> : 'Save'}
            </button>
            <button onClick={() => setOpen(false)} disabled={busy}
              className="px-2 py-1 rounded-md text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
              data-testid="odo-add-reading-cancel">Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

function NavixyCounters({ asset, onAssetUpdated }) {  const user = getUser();
  const canRefresh = user?.role === 'admin';
  const canEdit = user?.role === 'admin';
  const [refreshing, setRefreshing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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

  const renderTotal = () => {
    // Phase 4.9.1 — surface the actual source per metric. Distinguishes a
    // Navixy panel counter (authoritative) from GPS-derived track-window
    // sums (estimates) so users can tell when a low number is "real" vs
    // "Navixy doesn't have a panel counter for this device".
    const srcLabel = (s) => {
      if (!s) return 'Synced from Navixy';
      if (s === 'panel' || s === 'navixy' || s === 'navixy_counters_v2') return 'Synced from Navixy · panel counter';
      if (s === 'navixy_report') return 'Synced from Navixy · mileage report';
      if (s === 'navixy_tracks_lifetime') return 'Estimated · sum of all trips since first sync';
      if (s.includes('tracks')) return 'GPS-derived (no panel counter)';
      if (s === 'manual') return 'Manually entered';
      return `Synced from Navixy · ${s}`;
    };
    // Phase 4.9.1 — when the backend repair couldn't recover a sensible
    // lifetime odometer (Navixy's `get_counters` returned `[]`, the report
    // API isn't on this plan, AND lifetime track-sum still under-shot the
    // last 30 days of trips), surface a fallback UI instead of a misleading
    // low number. Admins can punch in a historical reading inline.
    const odoUnreliable = !!asset.lifetime_unreliable;
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <CounterCardShell
          icon={Activity} label="Engine hours" unit="hrs"
          value={fmtHours(asset.hours_meter)}
          sub={`${srcLabel(asset.hours_meter_source)}${hoursAgo ? ' · ' + hoursAgo : ''}`}
          accent="border-emerald-200 bg-white"
          testid="counter-card-hours" />
        {odoUnreliable
          ? <UnreliableOdoCard asset={asset} onAssetUpdated={onAssetUpdated} />
          : <CounterCardShell
              icon={Gauge} label="Odometer" unit="km"
              value={fmtKm(asset.odo_km)}
              sub={`${srcLabel(asset.odo_km_source)}${kmAgo ? ' · ' + kmAgo : ''}`}
              accent="border-emerald-200 bg-white"
              testid="counter-card-odo" />
        }
      </div>
    );
  };

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
        <div className="inline-flex items-center gap-1.5">
        {canRefresh && (
          <button onClick={refreshNow} disabled={refreshing}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
            data-testid="live-counters-refresh">
            {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCcw size={11} />}
            Refresh now
          </button>
        )}
        {canEdit && (
          <AddReadingTrigger accent="emerald" testid="live-counters-history-open"
                             onClick={() => setHistoryOpen(true)} />
        )}
        </div>
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

      <HistoricalReadingModal
        asset={asset} open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSaved={(a) => { if (onAssetUpdated) onAssetUpdated(a); }}
      />
    </div>
  );
}

function ManualCounters({ asset, onAssetUpdated }) {
  const user = getUser();
  const canEdit = user?.role === 'admin';
  const [historyOpen, setHistoryOpen] = useState(false);
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
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-600">Live counters · Manual</div>
        {canEdit && (
          <AddReadingTrigger accent="slate" testid="live-counters-manual-history-open"
                             onClick={() => setHistoryOpen(true)} />
        )}
      </div>
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
      <HistoricalReadingModal
        asset={asset} open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSaved={(a) => { if (onAssetUpdated) onAssetUpdated(a); }}
      />
    </div>
  );
}
