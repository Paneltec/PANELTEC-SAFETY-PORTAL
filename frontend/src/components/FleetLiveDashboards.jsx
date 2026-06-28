// Phase 3.6 — Native Navixy dashboards (Fleet Live Status / Trips / Technical Conditions).
import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, Truck, AlertTriangle, Gauge, RefreshCw, ChevronDown, ChevronUp,
  Loader2, Wifi, Clock, Radio, BarChart3, Settings2,
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Legend,
} from 'recharts';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';

const LS_KEY = 'paneltec.dashboards.collapsed';

function fmtAgo(iso) {
  if (!iso) return null;
  try {
    const d = parseISO((iso || '').replace(' ', 'T').replace('Z', ''));
    if (isNaN(d.getTime())) return null;
    return formatDistanceToNow(d, { addSuffix: true });
  } catch { return null; }
}

function Kpi({ icon: Icon, label, value, sub, tone = 'blue', testid }) {
  const tones = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 flex items-start gap-3" data-testid={testid}>
      <div className={`w-9 h-9 rounded-lg border ${tones[tone]} flex items-center justify-center shrink-0`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{label}</div>
        <div className="font-display text-2xl font-bold text-slate-900 tabular-nums leading-none mt-1">{value}</div>
        {sub && <div className="text-[10px] text-slate-500 mt-1">{sub}</div>}
      </div>
    </div>
  );
}

function DonutCard({ title, data, testid }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid={testid}>
      <div className="text-xs uppercase tracking-wider font-bold text-slate-600 mb-2">{title}</div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={45} outerRadius={70} paddingAngle={2}>
              {data.map((e) => <Cell key={e.label} fill={e.color} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="text-[11px] space-y-0.5 mt-2">
        {data.map((d) => (
          <li key={d.label} className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: d.color }} />
              {d.label}
            </span>
            <span className="font-semibold tabular-nums text-slate-800">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FleetStatusTab({ data }) {
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5" data-testid="fleet-status-kpis">
        <Kpi icon={Truck} label="Total objects" value={data.total} tone="blue" testid="kpi-total" />
        <Kpi icon={Wifi} label="Online" value={data.online} tone="green" testid="kpi-online" />
        <Kpi icon={Radio} label="Offline" value={data.offline} tone="slate" testid="kpi-offline" />
        <Kpi icon={AlertTriangle} label="GPS not updated" value={data.gps_not_updated} tone="amber" testid="kpi-gps-not-updated" />
        <Kpi icon={Activity} label="Other" value={data.other} tone="violet" testid="kpi-other" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DonutCard title="Connection" data={data.connection_breakdown} testid="donut-connection" />
        <DonutCard title="Movement" data={data.movement_breakdown} testid="donut-movement" />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="long-unseen-table">
        <div className="text-xs uppercase tracking-wider font-bold text-slate-600 mb-2">Top 10 long-unseen objects</div>
        {data.long_unseen?.length ? (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500">
              <tr><th className="text-left py-1.5">Object</th><th className="text-right">Last update</th></tr>
            </thead>
            <tbody>
              {data.long_unseen.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1.5 text-slate-800 font-medium truncate">{r.label}</td>
                  <td className="py-1.5 text-right text-slate-500 tabular-nums">{fmtAgo(r.last_updated) || r.last_updated || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="text-xs text-slate-500">All trackers recently reported in 🎉</div>}
      </div>
    </div>
  );
}

function TripsTab({ data }) {
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5" data-testid="trips-kpis">
        <Kpi icon={BarChart3} label="Total trips" value={data.total_trips} tone="blue" testid="kpi-trips" />
        <Kpi icon={Gauge} label="Total km" value={Number(data.total_km).toLocaleString(undefined, { maximumFractionDigits: 0 })} tone="green" testid="kpi-km" />
        <Kpi icon={Clock} label="Drive time" value={`${Math.floor(data.total_drive_minutes / 60)}h`} sub={`${data.total_drive_minutes % 60}m`} tone="amber" testid="kpi-time" />
        <Kpi icon={Activity} label="Avg trip" value={`${data.avg_km} km`} tone="violet" testid="kpi-avg" />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="trips-per-day">
        <div className="text-xs uppercase tracking-wider font-bold text-slate-600 mb-2">Trips per day · last {data.days} days</div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.per_day} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
              <YAxis yAxisId="t" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="k" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="t" dataKey="trips" fill="#3B82F6" name="Trips" />
              <Bar yAxisId="k" dataKey="km" fill="#10B981" name="Km" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="top-vehicles-table">
        <div className="text-xs uppercase tracking-wider font-bold text-slate-600 mb-2">Top 10 vehicles by distance</div>
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left py-1.5">Vehicle</th>
              <th className="text-right">Trips</th>
              <th className="text-right">Km</th>
              <th className="text-right">Drive time</th>
            </tr>
          </thead>
          <tbody>
            {(data.top_vehicles || []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5 text-slate-800 font-medium truncate max-w-[260px]">{r.label}</td>
                <td className="py-1.5 text-right tabular-nums">{r.trips}</td>
                <td className="py-1.5 text-right tabular-nums">{r.km}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-500">{Math.floor(r.minutes / 60)}h {r.minutes % 60}m</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TechnicalTab({ data }) {
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5" data-testid="tech-kpis">
        <Kpi icon={Truck} label="Total objects" value={data.total} tone="blue" testid="kpi-tech-total" />
        <Kpi icon={Wifi} label="Online · valid GPS" value={data.online_valid_gps} tone="green" testid="kpi-tech-gps" />
        <Kpi icon={Activity} label="Recent engine" sub="last 24 h" value={data.recent_engine} tone="violet" testid="kpi-tech-engine" />
        <Kpi icon={AlertTriangle} label="Idle > 24h" value={data.idle_over_24h} tone="amber" testid="kpi-tech-idle" />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="tech-table">
        <div className="text-xs uppercase tracking-wider font-bold text-slate-600 mb-2">Per-asset health</div>
        <div className="max-h-[400px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 sticky top-0 bg-white">
              <tr>
                <th className="text-left py-1.5">Vehicle</th>
                <th className="text-left">Status</th>
                <th className="text-right">Position</th>
                <th className="text-right">Engine</th>
                <th className="text-right">Battery</th>
                <th className="text-right">GSM</th>
              </tr>
            </thead>
            <tbody>
              {(data.per_asset || []).map((r) => {
                const posAge = r.last_position_age_min != null
                  ? r.last_position_age_min < 60 ? `${r.last_position_age_min}m`
                  : r.last_position_age_min < 60 * 24 ? `${Math.floor(r.last_position_age_min / 60)}h`
                  : `${Math.floor(r.last_position_age_min / (60 * 24))}d` : '—';
                const statusTone = {
                  online: 'bg-emerald-50 text-emerald-700',
                  offline: 'bg-slate-100 text-slate-600',
                  just_registered: 'bg-violet-50 text-violet-700',
                  idle: 'bg-amber-50 text-amber-700',
                }[r.status] || 'bg-slate-100 text-slate-600';
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-800 font-medium truncate max-w-[220px]">{r.label}</td>
                    <td className="py-1.5">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${statusTone}`}>{r.status || '—'}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{posAge}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{fmtAgo(r.last_engine_event_at) || '—'}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{r.battery != null ? `${r.battery}%` : '—'}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{r.gsm != null ? r.gsm : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function FleetLiveDashboards() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_KEY) === '1');
  const [tab, setTab] = useState('fleet-status');
  const [data, setData] = useState({ 'fleet-status': null, trips: null, technical: null });
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const setCollapsedPersist = (v) => {
    setCollapsed(v);
    localStorage.setItem(LS_KEY, v ? '1' : '0');
  };

  const fetchTab = async (key) => {
    setBusy(true);
    try {
      const url = key === 'trips'
        ? '/assets/navixy/dashboards/trips?days=7'
        : `/assets/navixy/dashboards/${key}`;
      const r = await api.get(url);
      setData((d) => ({ ...d, [key]: r.data }));
      setUpdatedAt(r.data.updated_at);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (collapsed) return;
    if (!data[tab]) fetchTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, collapsed]);

  const refresh = () => fetchTab(tab);
  const tabs = useMemo(() => [
    { key: 'fleet-status', label: 'Fleet Live Status', icon: Wifi },
    { key: 'trips', label: 'Trips · last 7 days', icon: BarChart3 },
    { key: 'technical', label: 'Technical Conditions', icon: Settings2 },
  ], []);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white mb-4 overflow-hidden" data-testid="fleet-live-dashboards">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
        <Activity size={16} className="text-blue-600" />
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider font-bold text-slate-600">Fleet Live Dashboards</div>
          <div className="text-[11px] text-slate-500">
            Native rebuild of the three Navixy dashboards · data refreshes every 60 s
          </div>
        </div>
        {!collapsed && (
          <>
            <div className="text-[11px] text-slate-500">
              {updatedAt ? `Updated · ${fmtAgo(updatedAt) || 'just now'}` : '—'}
            </div>
            <button onClick={refresh} disabled={busy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
              data-testid="dashboards-refresh">
              {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
            </button>
          </>
        )}
        <button onClick={() => setCollapsedPersist(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-slate-100" data-testid="dashboards-collapse-toggle">
          {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="px-3 pt-3 flex items-center gap-1.5 border-b border-slate-100" data-testid="dashboards-tabs">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold border-b-2 transition ${tab === t.key ? 'border-blue-600 text-blue-700 bg-blue-50/40' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}
                data-testid={`dashboard-tab-${t.key}`}>
                <t.icon size={12} /> {t.label}
              </button>
            ))}
          </div>
          <div className="p-4 bg-slate-50/40">
            {busy && !data[tab] ? (
              <div className="flex items-center justify-center py-12 text-slate-500 text-sm" data-testid="dashboards-loading">
                <Loader2 size={16} className="animate-spin mr-2" /> Loading dashboard…
              </div>
            ) : tab === 'fleet-status' ? <FleetStatusTab data={data['fleet-status']} />
              : tab === 'trips' ? <TripsTab data={data.trips} />
              : <TechnicalTab data={data.technical} />}
          </div>
        </>
      )}
    </div>
  );
}
