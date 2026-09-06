/**
 * v58.13.131d — Fuel Reporting page at `/app/fleet/fuel`.
 *
 * Read-only aggregation view over `fuel_transactions`.
 *   · Period toggle: Weekly / Monthly
 *   · Tab switch:   Per-Employee · Per-Vehicle · Admin Rollup
 *   · Date range presets: This Week / Last Week / This Month /
 *     Last Month / YTD / Custom
 *   · Top-5 $/L outliers panel (always visible)
 *   · Recharts: stacked $ bar + litres line (dual-axis) + breakdown
 *     pie for the active scope
 *   · CSV re-export per view
 *   · "Email this report" opens a small dialog — POSTs to
 *     `/api/fleet/fuel/reports/email` (fires INSIDE the HTTP request
 *     that user triggered — no cron, no BackgroundTask).
 *
 * Never emails without an explicit click. Comms Safe Mode honoured
 * by the backend — the dialog surfaces the `safe_mode:true` response
 * so the operator knows nothing was actually sent.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Fuel, Loader2, Download, Mail, ChevronRight,
  Users, Truck, Building2, TrendingUp, TrendingDown, Minus,
  AlertTriangle, X as XIcon,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Line, ComposedChart, PieChart, Pie, Cell,
} from 'recharts';
import { toast } from 'sonner';
import api, { apiError, TOKEN_KEY } from '../lib/api';
import { useCan } from '../lib/permissions';
import { getUser } from '../lib/auth';

const SCOPE_META = {
  employee: { label: 'Per-Employee', icon: Users,     colWord: 'Employee' },
  vehicle:  { label: 'Per-Vehicle',  icon: Truck,     colWord: 'Vehicle'  },
  admin:    { label: 'Admin Rollup', icon: Building2, colWord: 'Scope'    },
};

const PIE_COLORS = [
  '#2563eb', '#7c3aed', '#16a34a', '#ea580c', '#0891b2',
  '#db2777', '#65a30d', '#f59e0b', '#0284c7', '#9333ea',
];

// Preset date ranges. Keys emit ISO YYYY-MM-DD.
function presetRange(key) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const iso = (dt) => dt.toISOString().slice(0, 10);
  if (key === 'this-week') {
    const dow = (now.getDay() + 6) % 7; // Mon=0
    const start = new Date(y, m, d - dow);
    return { from: iso(start), to: iso(now), label: 'This week' };
  }
  if (key === 'last-week') {
    const dow = (now.getDay() + 6) % 7;
    const end = new Date(y, m, d - dow - 1);
    const start = new Date(y, m, d - dow - 7);
    return { from: iso(start), to: iso(end), label: 'Last week' };
  }
  if (key === 'this-month') {
    return { from: iso(new Date(y, m, 1)), to: iso(now), label: 'This month' };
  }
  if (key === 'last-month') {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { from: iso(start), to: iso(end), label: 'Last month' };
  }
  if (key === 'ytd') {
    return { from: iso(new Date(y, 0, 1)), to: iso(now), label: 'Year to date' };
  }
  return { from: '', to: '', label: 'Custom' };
}

export default function FuelReporting() {
  const canEdit = useCan()('assets', 'edit');
  const [scope, setScope] = useState('admin');
  const [period, setPeriod] = useState('monthly');
  const [presetKey, setPresetKey] = useState('this-month');
  const initial = presetRange('this-month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const applyPreset = (key) => {
    setPresetKey(key);
    if (key !== 'custom') {
      const r = presetRange(key);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/fleet/fuel/reports', {
        params: { scope, period, from, to },
      });
      setData(r.data);
    } catch (e) {
      toast.error(apiError(e) || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [scope, period, from, to]);

  useEffect(() => { reload(); }, [reload]);

  const exportCsv = async () => {
    try {
      const resp = await api.get('/fleet/fuel/reports/export', {
        params: { scope, period, from, to },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fuel-report-${scope}-${period}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(apiError(e) || 'Export failed');
    }
  };

  const rows = data?.rows || [];
  const periods = data?.periods || [];
  const outliers = data?.top_dpl_outliers || [];
  const totals = data?.totals || {};
  const leaderboards = data?.leaderboards || null;

  const pieData = useMemo(() => rows.slice(0, 8).map((r) => ({
    name: r.label, value: r.total_price,
  })), [rows]);

  return (
    <div className="p-6 space-y-4" data-testid="fuel-reporting-page">
      <div>
        <Link
          to="/app/fleet"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
          data-testid="fuel-reporting-back"
        >
          <ArrowLeft size={12} /> Fleet &amp; Service Register
        </Link>
        <div className="mt-2 flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
              SmartFill · Fuel intelligence
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-slate-900 mt-0.5 inline-flex items-center gap-2">
              <Fuel className="text-blue-600" size={22} /> Fuel reports
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Read-only aggregations over the SmartFill CSV importer feed. On-demand only —
              no scheduled sends, no background jobs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportCsv}
              data-testid="fuel-reporting-export-csv"
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
            >
              <Download size={13} /> Export CSV
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => setEmailOpen(true)}
                data-testid="fuel-reporting-email-open"
                className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5 font-semibold"
              >
                <Mail size={13} /> Email this report
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────── */}
      <div
        className="rounded-2xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-2"
        data-testid="fuel-reporting-filters"
      >
        <div className="inline-flex rounded-lg overflow-hidden border border-slate-300">
          {['weekly', 'monthly'].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              data-testid={`fuel-reporting-period-${p}`}
              className={`px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                period === p ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="mx-2 h-5 border-l border-slate-200" />

        {['this-week', 'last-week', 'this-month', 'last-month', 'ytd', 'custom'].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => applyPreset(k)}
            data-testid={`fuel-reporting-preset-${k}`}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
              presetKey === k
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {presetRange(k).label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => { setPresetKey('custom'); setFrom(e.target.value); }}
            data-testid="fuel-reporting-from"
            className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white"
          />
          <label className="text-xs font-semibold text-slate-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => { setPresetKey('custom'); setTo(e.target.value); }}
            data-testid="fuel-reporting-to"
            className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white"
          />
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────── */}
      <div className="border-b border-slate-200 flex gap-1" data-testid="fuel-reporting-tabs">
        {Object.entries(SCOPE_META).map(([k, meta]) => {
          const Icon = meta.icon;
          const active = scope === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setScope(k)}
              data-testid={`fuel-reporting-tab-${k}`}
              className={`inline-flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-sm font-semibold ${
                active
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon size={14} /> {meta.label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="text-xs text-slate-500 py-4">
          <Loader2 size={12} className="inline animate-spin mr-1" /> Loading report…
        </div>
      )}

      {!loading && data && (
        <>
          {/* v58.13.131h — Price-coverage banner + subtext. */}
          {(() => {
            const cov = data.totals?.total_price > 0 ? 100 : 0;
            if (cov === 0) return (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900"
                   data-testid="fuel-reporting-no-price-banner">
                <strong>Cost data not present in this dataset.</strong> Re-export from SmartFill
                with the <em>Total Price</em> column enabled to unlock $/L reporting.
              </div>
            );
            return null;
          })()}
          {/* ── Totals ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="fuel-reporting-totals">
            <Stat label="Total litres" value={`${(totals.litres ?? 0).toFixed(1)} L`} />
            <Stat label="Total cost" value={`$${(totals.total_price ?? 0).toFixed(2)}`} />
            <Stat label="Total fills" value={totals.fills ?? 0} />
            <Stat label={SCOPE_META[scope].colWord + 's'} value={totals.unique_keys ?? 0} />
          </div>

          {/* ── Top-5 $/L outliers ──────────────────────────── */}
          <div
            className="rounded-2xl border border-amber-200 bg-amber-50 p-3"
            data-testid="fuel-reporting-outliers"
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="text-amber-600" size={16} />
              <div className="text-sm font-bold text-amber-900">
                Top 5 · $/L outliers · procurement signal
              </div>
            </div>
            {outliers.length === 0 ? (
              <div className="text-xs text-amber-800/80">
                No fills with pricing data in this range.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-amber-800/80">
                    <tr>
                      <th className="px-2 py-1 text-left">$/L</th>
                      <th className="px-2 py-1 text-left">{SCOPE_META[scope].colWord}</th>
                      <th className="px-2 py-1 text-right">Litres</th>
                      <th className="px-2 py-1 text-right">Cost</th>
                      <th className="px-2 py-1 text-left">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-200">
                    {outliers.map((o, i) => (
                      <tr key={i} data-testid={`fuel-reporting-outlier-${i}`}>
                        <td className="px-2 py-1 font-mono font-bold text-amber-900">
                          ${o.dpl?.toFixed(3)}
                        </td>
                        <td className="px-2 py-1 text-slate-800 truncate max-w-[240px]">
                          {o.label}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{o.litres?.toFixed(2)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">${o.total_price?.toFixed(2)}</td>
                        <td className="px-2 py-1 font-mono text-xs text-slate-600">{o.date_iso}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Charts ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div
              className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-3"
              data-testid="fuel-reporting-composed-chart"
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Cost + litres by {period === 'weekly' ? 'ISO week' : 'month'}
              </div>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <ComposedChart data={periods} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="left" dataKey="total_price" name="$ Cost" fill="#2563eb" />
                    <Line yAxisId="right" dataKey="litres" name="Litres" stroke="#f59e0b" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div
              className="rounded-2xl border border-slate-200 bg-white p-3"
              data-testid="fuel-reporting-pie-chart"
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                {SCOPE_META[scope].label} · $ share (top 8)
              </div>
              <div style={{ width: '100%', height: 300 }}>
                {pieData.length > 0 ? (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={90}
                        label={(e) => `${e.name.slice(0, 8)}…`}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-xs text-slate-400 py-16 text-center">No data.</div>
                )}
              </div>
            </div>
          </div>

          {/* ── Rows table ─────────────────────────────────── */}
          <div
            className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
            data-testid="fuel-reporting-rows-table"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">{SCOPE_META[scope].colWord}</th>
                    <th className="px-3 py-2 text-right">Litres</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-right">Fills</th>
                    <th className="px-3 py-2 text-right">Avg fill (L)</th>
                    <th className="px-3 py-2 text-right" title="v58.13.131i · Avg litres per 100km">Avg L/100km</th>
                    <th className="px-3 py-2 text-right">$/L</th>
                    <th className="px-3 py-2 text-right">Δ $/L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-slate-400">
                        No rows in range.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.key} data-testid={`fuel-reporting-row-${r.key}`}>
                      <td className="px-3 py-1.5 text-slate-800 truncate max-w-[280px]">{r.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.litres.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">${r.total_price.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.fills}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.avg_fill_l.toFixed(2)}</td>
                      <td
                        className="px-3 py-1.5 text-right tabular-nums text-slate-700"
                        title={r.lp100_sample ? `${r.lp100_sample} of ${r.fills} fills contributed` : 'No qualifying deltas'}
                      >
                        {r.avg_lp100 != null ? r.avg_lp100.toFixed(2) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-mono">
                        {r.dpl != null ? `$${r.dpl.toFixed(3)}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right"><DeltaChip d={r.delta_dpl} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Admin leaderboards ─────────────────────────── */}
          {scope === 'admin' && leaderboards && (
            <div
              className="grid grid-cols-1 lg:grid-cols-3 gap-3"
              data-testid="fuel-reporting-leaderboards"
            >
              <Leaderboard
                title="Top 10 · Highest $"
                rows={leaderboards.top_by_cost || []}
                metricKey="total_price"
                metricFmt={(v) => `$${(v || 0).toFixed(2)}`}
                testidRoot="fuel-reporting-lb-cost"
              />
              <Leaderboard
                title="Top 10 · Highest $/L"
                rows={leaderboards.top_by_dpl || []}
                metricKey="dpl"
                metricFmt={(v) => v != null ? `$${v.toFixed(3)}` : '—'}
                testidRoot="fuel-reporting-lb-dpl"
              />
              <Leaderboard
                title="Top 10 · Most fills"
                rows={leaderboards.top_by_fills || []}
                metricKey="fills"
                metricFmt={(v) => v ?? 0}
                testidRoot="fuel-reporting-lb-fills"
              />
            </div>
          )}
        </>
      )}

      {emailOpen && (
        <EmailReportDialog
          onClose={() => setEmailOpen(false)}
          filters={{ scope, period, from, to }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function DeltaChip({ d }) {
  if (d == null) return <span className="text-slate-300">—</span>;
  const abs = Math.abs(d);
  if (abs < 0.001) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
        <Minus size={9} /> flat
      </span>
    );
  }
  if (d > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
        <TrendingUp size={9} /> +${abs.toFixed(3)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
      <TrendingDown size={9} /> −${abs.toFixed(3)}
    </span>
  );
}

function Leaderboard({ title, rows, metricKey, metricFmt, testidRoot }) {
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
      data-testid={testidRoot}
    >
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <tr>
              <td className="px-3 py-6 text-center text-slate-400 text-xs">No data.</td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.key} data-testid={`${testidRoot}-row-${i}`}>
              <td className="px-3 py-1.5 text-xs text-slate-400 tabular-nums w-8">{i + 1}</td>
              <td className="px-3 py-1.5 text-slate-800 truncate max-w-[160px]">{r.label}</td>
              <td className="px-3 py-1.5 text-right font-mono text-sm">
                {metricFmt(r[metricKey])}
              </td>
              <td className="px-3 py-1.5 text-right w-14"><DeltaChip d={r.delta_dpl} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function EmailReportDialog({ onClose, filters }) {
  const me = getUser();
  const [to, setTo] = useState(me?.email || '');
  const [cc, setCc] = useState('');
  const [note, setNote] = useState('');
  const [includePdf, setIncludePdf] = useState(true);
  const [includeCsv, setIncludeCsv] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setSending(true);
    try {
      const toList = to.split(',').map((s) => s.trim()).filter(Boolean);
      const ccList = cc.split(',').map((s) => s.trim()).filter(Boolean);
      const r = await api.post('/fleet/fuel/reports/email', {
        to: toList,
        cc: ccList,
        note,
        scope: filters.scope,
        period: filters.period,
        from_date: filters.from,
        to_date: filters.to,
        include_pdf: includePdf,
        include_csv: includeCsv,
      });
      setResult(r.data);
      if (r.data.sent) {
        toast.success('Report emailed');
      } else if (r.data.safe_mode) {
        toast.warning('Safe Mode is ON — no email sent. Intent audited.');
      }
    } catch (e) {
      if (e?.response?.status === 429) {
        toast.error(e.response.data?.detail || 'Rate limit exceeded');
      } else {
        toast.error(apiError(e) || 'Send failed');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-3"
      onClick={(e) => e.target === e.currentTarget && !sending && onClose?.()}
      data-testid="fuel-reporting-email-dialog"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
              Fuel report · email
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900">Email this report</h3>
          </div>
          <button
            type="button"
            onClick={() => !sending && onClose?.()}
            data-testid="fuel-reporting-email-close"
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            aria-label="Close"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {result && result.safe_mode && (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
              data-testid="fuel-reporting-email-safe-mode-banner"
            >
              <strong>Comms Safe Mode is ON.</strong> Nothing was actually sent —
              the intent was logged for audit. Would have sent to:{' '}
              <span className="font-mono">{(result.would_have_sent_to || []).join(', ')}</span>
            </div>
          )}
          {result && result.sent && (
            <div
              className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"
              data-testid="fuel-reporting-email-sent-banner"
            >
              Sent · message id{' '}
              <span className="font-mono">{result.message_id?.slice(0, 12)}…</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              To <span className="text-slate-400 font-normal">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="fuel-reporting-email-to"
              placeholder="you@paneltec.com.au"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              CC <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              data-testid="fuel-reporting-email-cc"
              placeholder="manager@paneltec.com.au"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Note <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="fuel-reporting-email-note"
              placeholder="Any context you want prepended to the body."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-700 mb-1">Attachments</div>
            <div className="flex gap-4">
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={includePdf}
                  onChange={(e) => setIncludePdf(e.target.checked)}
                  data-testid="fuel-reporting-email-pdf"
                />
                <span>PDF</span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={includeCsv}
                  onChange={(e) => setIncludeCsv(e.target.checked)}
                  data-testid="fuel-reporting-email-csv"
                />
                <span>CSV</span>
              </label>
            </div>
          </div>

          <div className="text-[11px] text-slate-500">
            Report snapshot fires INSIDE this HTTP request. No scheduled sends. Rate limit:
            max 5 sends per user per 10 minutes.
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={() => !sending && onClose?.()}
            disabled={sending}
            data-testid="fuel-reporting-email-cancel"
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={submit}
              disabled={sending || !to.trim() || (!includePdf && !includeCsv)}
              data-testid="fuel-reporting-email-send"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-40"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
              {sending ? 'Sending…' : 'Send now'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
