/**
 * v58.13.131c — AssetDrawer Fuel tab.
 *
 * Shows the last 500 SmartFill transactions attributed to this asset
 * via `GET /fleet/assets/{id}/fuel`, a rolling-20 summary card, and
 * per-month totals (Litres + $ + fills). Read-only — anomaly
 * actions live in the Fuel Anomaly Inbox.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Fuel, Loader2, ExternalLink, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { apiError } from '../lib/api';
import { toast } from 'sonner';

const SOURCE_BADGE = {
  csv:              { label: 'csv',   tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  navixy_live:      { label: 'live',  tone: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  navixy_snapshot:  { label: 'snap',  tone: 'bg-blue-100 text-blue-800 border-blue-200' },
  unknown:          { label: '—',     tone: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const RULE_LABEL = {
  unusual_hour:        'Unusual hour',
  capacity_exceed:     'Capacity exceeded',
  stat_spike:          'Stat spike',
  reading_regress:     'Reading regression',
  missing_odometer:    'No odometer',
  procurement_outlier: 'Procurement outlier',
};

export default function AssetFuelTab({ asset }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!asset?.id) return;
    let cancelled = false;
    setLoading(true);
    api.get(`/fleet/assets/${asset.id}/fuel`)
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => {
        if (!cancelled) toast.error(apiError(e) || 'Could not load fuel history');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [asset?.id]);

  const monthly = useMemo(() => byMonth(data?.transactions || []), [data]);
  const rolling = data?.rolling_last_20 || {};
  const capacity = asset?.fuel_tank_capacity_l;

  if (!asset?.id) {
    return (
      <div className="text-sm text-slate-500" data-testid="asset-fuel-tab-empty-state">
        Save the asset first to view its fuel history.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="asset-fuel-tab">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
            SmartFill · Attribution
          </div>
          <h4 className="font-display text-base font-bold text-slate-900 inline-flex items-center gap-1.5">
            <Fuel size={16} className="text-blue-600" /> Fuel history
          </h4>
        </div>
        {(data?.transactions?.length ?? 0) > 0 && (
          <Link
            to={`/app/fleet/fuel/anomalies`}
            className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"
            data-testid="asset-fuel-tab-anomaly-link"
          >
            Anomaly inbox <ExternalLink size={11} />
          </Link>
        )}
      </div>

      {loading && (
        <div className="text-xs text-slate-500 py-4">
          <Loader2 size={12} className="inline animate-spin mr-1" /> Loading fuel history…
        </div>
      )}

      {!loading && (
        <>
          {/* ── Rolling summary + capacity ─────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="asset-fuel-summary">
            <Stat
              label="Fills (last 20)"
              value={rolling.count ?? 0}
              testid="asset-fuel-stat-count"
            />
            <Stat
              label="Total (last 20)"
              value={rolling.total_litres != null ? `${rolling.total_litres.toFixed(1)} L` : '—'}
              testid="asset-fuel-stat-total"
            />
            <Stat
              label="Mean / fill"
              value={rolling.mean_litres != null ? `${rolling.mean_litres.toFixed(1)} L` : '—'}
              testid="asset-fuel-stat-mean"
            />
            <Stat
              label="Tank capacity"
              value={capacity ? `${capacity} L` : '—'}
              hint={!capacity ? 'Set on Details tab to unlock capacity anomaly' : null}
              tone={capacity ? 'slate' : 'amber'}
              testid="asset-fuel-stat-capacity"
            />
          </div>

          {/* ── Per-month totals ────────────────────────── */}
          {monthly.length > 0 && (
            <div
              className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
              data-testid="asset-fuel-monthly"
            >
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Monthly totals
              </div>
              <table className="w-full text-sm">
                <thead className="bg-white text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Month</th>
                    <th className="px-3 py-1.5 text-right">Fills</th>
                    <th className="px-3 py-1.5 text-right">Litres</th>
                    <th className="px-3 py-1.5 text-right">Cost</th>
                    <th className="px-3 py-1.5 text-right">$/L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthly.map((m) => (
                    <tr key={m.month} data-testid={`asset-fuel-month-${m.month}`}>
                      <td className="px-3 py-1.5 font-mono text-slate-800">{m.month}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m.fills}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m.litres.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {m.cost > 0 ? `$${m.cost.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                        {m.litres > 0 && m.cost > 0
                          ? `$${(m.cost / m.litres).toFixed(3)}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Recent transactions ─────────────────────── */}
          <div
            className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
            data-testid="asset-fuel-transactions"
          >
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
              <span>Recent transactions</span>
              <span className="normal-case tracking-normal">
                {data?.transactions?.length ?? 0} shown
              </span>
            </div>
            {(data?.transactions?.length ?? 0) === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">
                No fuel transactions attributed to this asset yet.
                <br />
                Import a SmartFill CSV from the Fleet page to get started.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-sm">
                  <thead className="bg-white text-[10px] uppercase tracking-wider text-slate-500 sticky top-0">
                    <tr>
                      <th className="px-3 py-1.5 text-left">When</th>
                      <th className="px-3 py-1.5 text-left">Driver</th>
                      <th className="px-3 py-1.5 text-right">Litres</th>
                      <th className="px-3 py-1.5 text-right">Cost</th>
                      <th className="px-3 py-1.5 text-right">Odo</th>
                      <th className="px-3 py-1.5 text-right" title="Litres per 100 km · v58.13.131i">L/100km</th>
                      <th className="px-3 py-1.5 text-left">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.transactions.slice(0, 100).map((t) => (
                      <tr
                        key={t.id}
                        data-testid={`asset-fuel-txn-${t.id}`}
                        className={t.deleted_at ? 'opacity-50' : ''}
                      >
                        <td className="px-3 py-1.5 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                          {t.date_iso} · {t.time_local?.slice(0, 5)}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-600 truncate max-w-[180px]">
                          {t.driver || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {t.litres != null ? Number(t.litres).toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {t.total_price != null ? `$${Number(t.total_price).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1">
                            {t.odometer_km != null ? `${t.odometer_km}` : '—'}
                            {t.odometer_source && (() => {
                              const b = SOURCE_BADGE[t.odometer_source] || SOURCE_BADGE.unknown;
                              return (
                                <span
                                  title={`odometer_source: ${t.odometer_source}`}
                                  className={`px-1 py-0.5 rounded text-[9px] font-bold uppercase border ${b.tone}`}
                                >📍{b.label}</span>
                              );
                            })()}
                            {t._enrichment_confidence === 'stale' && (
                              <span className="px-1 py-0.5 rounded text-[9px] font-bold uppercase border bg-amber-100 text-amber-800 border-amber-200"
                                    title="Navixy last-heard > 24h — odometer approximated">
                                Navixy stale
                              </span>
                            )}
                          </span>
                        </td>
                        <td
                          className="px-3 py-1.5 text-right tabular-nums text-xs text-slate-700"
                          title={t._lp100_skipped ? `L/100km skipped: ${t._lp100_skipped}` : undefined}
                        >
                          {t.litres_per_100km != null
                            ? Number(t.litres_per_100km).toFixed(2)
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {(t.anomaly_flags || []).length === 0 ? (
                            <span className="text-slate-300 text-[11px]">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {t.anomaly_flags.map((f, i) => (
                                <span
                                  key={`${f.rule}-${i}`}
                                  title={f.detail}
                                  className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                    f.resolved_at
                                      ? 'bg-slate-100 text-slate-500 border-slate-200 line-through'
                                      : 'bg-amber-100 text-amber-800 border-amber-200'
                                  }`}
                                >
                                  <AlertTriangle size={8} />
                                  {RULE_LABEL[f.rule] || f.rule}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function byMonth(txs) {
  const acc = {};
  for (const t of txs) {
    const ts = t.timestamp || '';
    const key = ts.slice(0, 7) || 'unknown';
    const bucket = acc[key] || { month: key, fills: 0, litres: 0, cost: 0 };
    bucket.fills += 1;
    bucket.litres += Number(t.litres) || 0;
    bucket.cost += Number(t.total_price) || 0;
    acc[key] = bucket;
  }
  return Object.values(acc).sort((a, b) => (b.month > a.month ? 1 : -1));
}

const STAT_TONES = {
  slate: 'bg-white border-slate-200',
  amber: 'bg-amber-50 border-amber-200',
};

function Stat({ label, value, hint, tone = 'slate', testid }) {
  return (
    <div
      className={`rounded-xl border p-2 ${STAT_TONES[tone]}`}
      data-testid={testid}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-amber-800 mt-0.5">{hint}</div>}
    </div>
  );
}
