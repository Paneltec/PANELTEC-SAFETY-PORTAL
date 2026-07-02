// Phase 4.17 v134.0 (paneltec-v134) — Shared per-module analytics dashboard.
//
// Every major module (SWMS today, more coming in v134.1/2) mounts this
// component inside its "Dashboard" tab. It fetches
//   GET /api/dashboards/{module}
// on mount, refreshes every 60 s, and renders:
//   1. Hero band — dark-navy, orange chevron accent, uppercase eyebrow
//   2. KPI tile row — slate-900 tiles with big number + label
//   3. Charts row — bar + donut driven by the response `charts` array
//   4. Records needing attention — top-5 table from `attention[]`
//   5. Quick actions row — buttons from `quickActions` prop
//
// The response can carry `todo: true` for modules whose real aggregator
// hasn't shipped yet. In that case we render a friendly "coming soon" state
// instead of a broken dashboard.
//
// Design language matches the Phase 4.16 tech aesthetic — deep navy
// (slate-950 → slate-900), orange #F97316 accents, uppercase tracking-wider
// labels, green LED dots for live-status pills. No Tailwind blue anywhere.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight20Regular,
  Clock20Regular,
  ArrowSync20Regular,
  Info20Regular,
} from '@fluentui/react-icons';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import api, { apiError } from '../../lib/api';

// ------------------------------------------------------------ helpers

// v134 palette — every accent used across the dashboard resolves off the
// module colour to keep the visual signal consistent per module.
const ACCENTS = {
  orange: { hex: '#F97316', ring: 'ring-orange-500/40', text: 'text-orange-400',
            chip: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
            bar: '#F97316' },
  amber:  { hex: '#F59E0B', ring: 'ring-amber-500/40',  text: 'text-amber-400',
            chip: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
            bar: '#F59E0B' },
  emerald:{ hex: '#10B981', ring: 'ring-emerald-500/40', text: 'text-emerald-400',
            chip: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
            bar: '#10B981' },
  violet: { hex: '#7C3AED', ring: 'ring-violet-500/40', text: 'text-violet-400',
            chip: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
            bar: '#7C3AED' },
};

const SEVERITY_CHIP = {
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  red:   'bg-rose-500/10 text-rose-300 border-rose-500/30',
  green: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  slate: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
};

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    const now = new Date();
    const diffMs = now - d;
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return d.toISOString().slice(0, 10);
  } catch { return String(iso).slice(0, 10); }
}

// ------------------------------------------------------------ subcomponents

function HeroBand({ title, tagline, moduleColour, schematicSlug, refreshedAt, cacheHit }) {
  const accent = ACCENTS[moduleColour] || ACCENTS.orange;
  return (
    <div
      data-testid="module-dashboard-hero"
      className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 mb-6"
    >
      {/* Subtle diagonal grid + accent glow */}
      <div className="absolute inset-0 opacity-[0.06] pointer-events-none"
           style={{ backgroundImage:
             'linear-gradient(to right, rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.5) 1px, transparent 1px)',
             backgroundSize: '32px 32px' }} />
      <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full pointer-events-none"
           style={{ background: `radial-gradient(circle, ${accent.hex}44 0%, transparent 70%)` }} />

      <div className="relative flex flex-col sm:flex-row items-stretch">
        <div className="flex-1 px-6 sm:px-8 py-6 sm:py-8">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-semibold">
            <span className={`inline-block w-2 h-2 rounded-full ${accent.text.replace('text-', 'bg-')} shadow-[0_0_8px_currentColor] ${accent.text}`} />
            <span className={accent.text}>PANELTEC INTELLIGENCE</span>
            <span className="text-slate-500">· MODULE DASHBOARD</span>
          </div>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-white">
            {title}
          </h1>
          {tagline && <p className="mt-2 text-sm text-slate-400 max-w-xl">{tagline}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${accent.chip}`}>
              <ArrowSync20Regular className="w-3.5 h-3.5" />
              Refreshed {formatWhen(refreshedAt)}
            </span>
            {cacheHit && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-700 bg-slate-800/60 text-slate-400">
                cache hit · 60 s window
              </span>
            )}
          </div>
        </div>

        {schematicSlug && (
          <div className="hidden sm:flex items-center justify-center border-l border-slate-800 bg-slate-900/40 px-4 py-4 w-56">
            <img
              src={`/api/help/schematics/paneltec_${schematicSlug}.png`}
              alt=""
              loading="lazy"
              className="max-h-32 w-auto object-contain opacity-90"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function KpiTile({ tile, accent }) {
  const placeholder = !!tile.placeholder;
  return (
    <div
      data-testid={`module-dashboard-kpi-${tile.key}`}
      className={`relative rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 p-4
                  hover:border-slate-700 transition-colors`}
    >
      <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">
        {tile.label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className={`font-display text-3xl font-bold tabular-nums ${placeholder ? 'text-slate-400' : 'text-white'}`}>
          {typeof tile.value === 'number' ? tile.value.toLocaleString() : (tile.value ?? '—')}
        </div>
        {tile.unit && <div className="text-xs text-slate-500">{tile.unit}</div>}
      </div>
      {typeof tile.trend === 'number' && (
        <div className={`mt-1 text-[11px] font-semibold ${tile.trend >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {tile.trend >= 0 ? '↑' : '↓'} {Math.abs(Math.round(tile.trend * 100))}%
        </div>
      )}
      {placeholder && (
        <div className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500"
             title={tile.hint || 'Coming soon'}>
          <Info20Regular className="w-3 h-3" />
          <span>Coming soon</span>
        </div>
      )}
      <div className={`absolute top-0 left-0 h-1 w-10 rounded-tl-2xl rounded-br-md`}
           style={{ background: accent.hex }} />
    </div>
  );
}

function BarCard({ chart, accent }) {
  const data = Array.isArray(chart.data) ? chart.data : [];
  const total = data.reduce((s, d) => s + (d.y || 0), 0);
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 p-4"
         data-testid={`module-dashboard-chart-${chart.type}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">
          {chart.title}
        </div>
        <div className="text-[11px] text-slate-500 tabular-nums">total {total.toLocaleString()}</div>
      </div>
      <div className="h-56">
        {data.length === 0 ? (
          <EmptyChart label="No data yet" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="x" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                contentStyle={{ background: '#0f172a', border: '1px solid #1f2937',
                                borderRadius: 8, color: '#e2e8f0', fontSize: 12 }}
              />
              <Bar dataKey="y" fill={accent.bar} radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function DonutCard({ chart }) {
  const data = Array.isArray(chart.data) ? chart.data : [];
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 p-4"
         data-testid={`module-dashboard-chart-${chart.type}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">
          {chart.title}
        </div>
        <div className="text-[11px] text-slate-500 tabular-nums">total {total.toLocaleString()}</div>
      </div>
      <div className="h-56">
        {data.length === 0 ? (
          <EmptyChart label="No data yet" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                stroke="#0f172a"
              >
                {data.map((slice, i) => (
                  <Cell key={i} fill={slice.color || '#F97316'} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #1f2937',
                                borderRadius: 8, color: '#e2e8f0', fontSize: 12 }}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                wrapperStyle={{ fontSize: 11, color: '#94a3b8' }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function EmptyChart({ label }) {
  return (
    <div className="h-full w-full flex items-center justify-center text-xs text-slate-500 italic">
      {label}
    </div>
  );
}

function AttentionTable({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center"
           data-testid="module-dashboard-attention-empty">
        <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">
          Records needing attention
        </div>
        <div className="mt-2 text-sm text-slate-400">
          Nothing needs your attention right now. Clean board. ✓
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden"
         data-testid="module-dashboard-attention">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">
          Records needing attention
        </div>
        <span className="text-[11px] text-slate-500">Top {rows.length}</span>
      </div>
      <ul className="divide-y divide-slate-800">
        {rows.map((r, i) => (
          <li key={r.id || i}
              data-testid={`module-dashboard-attention-row-${i}`}
              className="px-4 py-3 hover:bg-slate-800/60 transition-colors">
            <Link to={r.route || '#'}
                  className="flex items-center gap-3 group">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border ${SEVERITY_CHIP[r.severity] || SEVERITY_CHIP.slate}`}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
                {r.severity || 'info'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-100 truncate group-hover:text-white">
                  {r.label}
                </div>
                {r.timestamp && (
                  <div className="mt-0.5 text-[11px] text-slate-500 inline-flex items-center gap-1">
                    <Clock20Regular className="w-3 h-3" />
                    {formatWhen(r.timestamp)}
                  </div>
                )}
              </div>
              <ChevronRight20Regular className="text-slate-500 group-hover:text-orange-400" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuickActionsRow({ actions }) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  return (
    <div className="mt-6 flex flex-wrap gap-2" data-testid="module-dashboard-quick-actions">
      {actions.map((a, i) => (
        <Link
          key={i}
          to={a.route}
          data-testid={`module-dashboard-quick-action-${i}`}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg
                     bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold
                     shadow-sm transition-colors"
        >
          {a.icon}
          {a.label}
        </Link>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ main

export default function ModuleDashboard({
  module,
  title,
  tagline,
  schematicSlug,
  moduleColour = 'orange',
  quickActions = [],
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: payload } = await api.get(`/dashboards/${module}`);
      setData(payload);
    } catch (e) {
      setError(apiError(e) || 'Could not load dashboard');
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const accent = ACCENTS[moduleColour] || ACCENTS.orange;
  const kpis = data?.kpis || [];
  const charts = data?.charts || [];
  const attention = data?.attention || [];
  const isTodo = !!data?.todo;

  // Split charts by type so the layout can put bar left / donut right.
  const barCharts = useMemo(() => charts.filter((c) => c.type === 'bar' || c.type === 'line'), [charts]);
  const donutCharts = useMemo(() => charts.filter((c) => c.type === 'donut' || c.type === 'pie'), [charts]);

  return (
    <section data-testid="module-dashboard" data-module={module}>
      <HeroBand
        title={title}
        tagline={tagline}
        moduleColour={moduleColour}
        schematicSlug={schematicSlug}
        refreshedAt={data?.generated_at}
        cacheHit={!!data?.cache_hit}
      />

      {loading && !data && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 text-slate-400 p-8 text-center text-sm"
             data-testid="module-dashboard-loading">
          Loading dashboard…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 text-rose-200 p-4 text-sm"
             data-testid="module-dashboard-error">
          {error}
        </div>
      )}

      {isTodo && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 p-8 text-center"
             data-testid="module-dashboard-todo">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-semibold text-orange-400 mb-2">
            <span className="inline-block w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_#F97316]" />
            Coming soon
          </div>
          <div className="text-lg font-display font-semibold">
            The {title} dashboard is being built.
          </div>
          <p className="mt-2 text-sm text-slate-400 max-w-lg mx-auto">
            {data?.coming_soon_message ||
              'Real metrics for this module land in a later Phase 4.17 update.'}
          </p>
        </div>
      )}

      {!isTodo && !loading && (
        <>
          {kpis.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6"
                 data-testid="module-dashboard-kpi-row">
              {kpis.map((k) => (
                <KpiTile key={k.key} tile={k} accent={accent} />
              ))}
            </div>
          )}

          {(barCharts.length > 0 || donutCharts.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6"
                 data-testid="module-dashboard-charts-row">
              {barCharts.map((c, i) => (
                <div key={`b${i}`} className="lg:col-span-2">
                  <BarCard chart={c} accent={accent} />
                </div>
              ))}
              {donutCharts.map((c, i) => (
                <div key={`d${i}`}>
                  <DonutCard chart={c} />
                </div>
              ))}
            </div>
          )}

          <AttentionTable rows={attention} />
        </>
      )}

      <QuickActionsRow actions={quickActions} />
    </section>
  );
}
