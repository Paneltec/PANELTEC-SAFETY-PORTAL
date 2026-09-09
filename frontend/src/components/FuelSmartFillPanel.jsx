/**
 * v58.13.132bi — Enriched Fuel & SmartFill panel on the asset /
 * vehicle detail drawer.
 *
 * Layout (top → bottom):
 *   1. Header + match-confidence pill (MATCHED (Key) / MATCHED (Card)
 *      / NOT MATCHED — replaces the pre-`.132bi` binary pill)
 *   2. Editable inputs grid (fuel_type dropdown, current_odometer_km,
 *      current_engine_hours) — persisted via the parent Details tab
 *      Save button (unchanged flow)
 *   3. SmartFill match keys (unchanged from `.131e`: tank capacity,
 *      key/code, card number)
 *   4. Read-only "SmartFill Insights" grid — computed metrics from
 *      `/fleet/assets/{id}/fuel-summary`:
 *        · Last fill (date + litres + $)
 *        · YTD spend / litres / fill count
 *        · Rolling 30-day (avg L/day, avg $/L)
 *        · Consumption (L/100km OR L/hour, depending on basis)
 *        · Assigned driver (top 90-day, when dominant)
 *        · Anomaly count (90d) — clickable → parent switches to Fuel tab
 *        · Last SmartFill sync stamp
 *
 * Empty states:
 *   · No transactions ever matched  → panel renders "No SmartFill
 *     activity yet" instead of em-dash spam.
 *   · Fields still loading          → skeleton shimmer.
 */
import React, { useEffect, useState } from 'react';
import { Fuel, Loader2, AlertTriangle, Gauge, Clock, TrendingUp, User } from 'lucide-react';
import api, { apiError } from '../lib/api';
import { toast } from 'sonner';

const FUEL_TYPE_OPTIONS = ['Diesel', 'Petrol', 'AdBlue', 'Unknown'];

const CONFIDENCE_PILL = {
  matched_key:   { label: 'MATCHED (Key)',   cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  matched_card:  { label: 'MATCHED (Card)',  cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  matched_other: { label: 'MATCHED (Other)', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  not_matched:   { label: 'NOT MATCHED',     cls: 'bg-amber-100 text-amber-800 border-amber-300' },
};

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso; }
}
function fmtMoney(v) { return v == null ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtLitres(v, digits = 1) { return v == null ? '—' : `${Number(v).toFixed(digits)} L`; }

export default function FuelSmartFillPanel({ assetId, form, change, onOpenFuelTab }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!assetId) { setSummary(null); return; }
    let cancelled = false;
    setLoading(true);
    api.get(`/fleet/assets/${assetId}/fuel-summary`)
      .then((r) => { if (!cancelled) setSummary(r.data); })
      .catch((e) => { if (!cancelled) toast.error(apiError(e) || 'Could not load fuel summary'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId]);

  const conf = summary?.match_confidence || 'not_matched';
  const pill = CONFIDENCE_PILL[conf] || CONFIDENCE_PILL.not_matched;
  const hasActivity = !!summary?.has_any_transactions;

  return (
    <section
      className="rounded-xl border border-slate-200 p-4 bg-slate-50/60"
      data-testid="asset-fuel-section"
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-slate-900">Fuel &amp; SmartFill</h4>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${pill.cls}`}
          data-testid={`asset-fuel-pill-${conf}`}
        >
          {pill.label}
        </span>
      </div>

      {/* ── Admin editable snapshot fields ─────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Fuel type</label>
          <select
            value={form.fuel_type || ''}
            onChange={(e) => change('fuel_type', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            data-testid="asset-fuel-type"
          >
            <option value="">— (unset)</option>
            {FUEL_TYPE_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Current odometer</label>
          <div className="flex items-center gap-2">
            <input
              type="number" step="1" min="0"
              value={form.current_odometer_km ?? ''}
              onChange={(e) => change('current_odometer_km', e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm tabular-nums"
              data-testid="asset-current-odometer"
              placeholder="e.g. 78500"
            />
            <span className="text-xs font-semibold text-slate-500">km</span>
          </div>
          {form.current_odometer_updated_at && (
            <p className="mt-1 text-[10px] text-slate-500 italic" data-testid="asset-odometer-updated-caption">
              last updated {fmtDate(form.current_odometer_updated_at)}
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Engine hours</label>
          <div className="flex items-center gap-2">
            <input
              type="number" step="0.1" min="0"
              value={form.current_engine_hours ?? ''}
              onChange={(e) => change('current_engine_hours', e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm tabular-nums"
              data-testid="asset-current-engine-hours"
              placeholder="e.g. 1447.6"
            />
            <span className="text-xs font-semibold text-slate-500">h</span>
          </div>
          {form.current_engine_hours_updated_at && (
            <p className="mt-1 text-[10px] text-slate-500 italic" data-testid="asset-engine-hours-updated-caption">
              last updated {fmtDate(form.current_engine_hours_updated_at)}
            </p>
          )}
        </div>
      </div>

      {/* ── SmartFill match keys (existing .131e fields) ────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Fuel tank capacity</label>
          <div className="flex items-center gap-2">
            <input
              type="number" step="0.1" min="0"
              value={form.fuel_tank_capacity_l ?? ''}
              onChange={(e) => change('fuel_tank_capacity_l', e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm tabular-nums"
              data-testid="asset-fuel-tank-capacity"
              placeholder="e.g. 100"
            />
            <span className="text-xs font-semibold text-slate-500">L</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-500 italic">Flags fills &gt; 110% of capacity.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">SmartFill Key / Code</label>
          <input
            value={form.smartfill_key_code || ''}
            onChange={(e) => change('smartfill_key_code', e.target.value)}
            onBlur={(e) => change('smartfill_key_code', (e.target.value || '').trim().toUpperCase())}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm uppercase"
            data-testid="asset-smartfill-key-code"
            placeholder="e.g. 100000000536B"
          />
          <p className="mt-1 text-[10px] text-slate-500 italic"><b>Primary match</b> for CSV imports.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">SmartFill Card Number</label>
          <input
            value={form.smartfill_card_number || ''}
            onChange={(e) => change('smartfill_card_number', e.target.value)}
            onBlur={(e) => change('smartfill_card_number', (e.target.value || '').trim())}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            data-testid="asset-smartfill-card-number"
            placeholder="e.g. 21355"
          />
          <p className="mt-1 text-[10px] text-slate-500 italic"><b>Secondary match</b>.</p>
        </div>
      </div>

      {/* ── SmartFill Insights (read-only computed) ───────────── */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 inline-flex items-center gap-1.5">
            <Fuel size={12} /> SmartFill Insights
          </div>
          {summary?.last_smartfill_sync_at && (
            <div className="text-[10px] text-slate-500" data-testid="asset-fuel-last-sync">
              Synced {fmtDate(summary.last_smartfill_sync_at)}
            </div>
          )}
        </div>

        {loading && !summary && (
          <div className="rounded-lg bg-white border border-slate-200 p-6 text-center text-xs text-slate-500" data-testid="asset-fuel-loading">
            <Loader2 size={14} className="inline animate-spin mr-1" /> Loading fuel summary…
          </div>
        )}

        {!loading && !hasActivity && (
          <div
            className="rounded-lg bg-white border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500"
            data-testid="asset-fuel-empty"
          >
            <Fuel size={16} className="inline text-slate-400 mr-1" />
            No SmartFill activity yet for this vehicle.
          </div>
        )}

        {!loading && hasActivity && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2" data-testid="asset-fuel-insights">
            <Metric
              testid="asset-fuel-last-fill"
              icon={<Clock size={12} />}
              label="Last fill"
              value={
                summary.last_fill
                  ? `${fmtDate(summary.last_fill.date)} · ${fmtLitres(summary.last_fill.litres)}`
                  : '—'
              }
              hint={summary.last_fill?.station}
            />
            <Metric
              testid="asset-fuel-ytd"
              icon={<TrendingUp size={12} />}
              label="YTD spend"
              value={fmtMoney(summary.ytd?.total_price)}
              hint={`${fmtLitres(summary.ytd?.total_litres, 0)} · ${summary.ytd?.fill_count ?? 0} fills`}
            />
            <Metric
              testid="asset-fuel-30d"
              icon={<Fuel size={12} />}
              label="30-day avg"
              value={
                summary.rolling_30d?.avg_price_per_litre != null
                  ? `${fmtMoney(summary.rolling_30d.avg_price_per_litre).slice(1)}/L`
                  : '—'
              }
              hint={
                summary.rolling_30d?.fill_count
                  ? `${summary.rolling_30d.avg_litres_per_day} L/day · ${summary.rolling_30d.fill_count} fills`
                  : 'no fills'
              }
            />
            <Metric
              testid="asset-fuel-consumption"
              icon={<Gauge size={12} />}
              label="Consumption"
              value={
                summary.consumption?.l_per_100km != null
                  ? `${summary.consumption.l_per_100km} L/100km`
                  : summary.consumption?.l_per_hour != null
                    ? `${summary.consumption.l_per_hour} L/hour`
                    : '—'
              }
              hint={
                summary.consumption?.basis === 'odometer' ? 'basis: odometer'
                : summary.consumption?.basis === 'engine_hours' ? 'basis: engine hours'
                : 'set odometer or hours to unlock'
              }
            />
            <Metric
              testid="asset-fuel-driver"
              icon={<User size={12} />}
              label="Top driver (90d)"
              value={summary.top_driver_90d?.name || '—'}
              hint={
                summary.top_driver_90d
                  ? `${summary.top_driver_90d.attribution_count} fills`
                  : 'no dominant driver'
              }
            />
            <button
              type="button"
              onClick={() => (summary.anomaly_count_90d > 0 ? onOpenFuelTab?.() : null)}
              disabled={!summary.anomaly_count_90d}
              className={`text-left rounded-lg border p-2 transition-colors ${
                summary.anomaly_count_90d > 0
                  ? 'bg-amber-50 border-amber-200 hover:bg-amber-100 cursor-pointer'
                  : 'bg-white border-slate-200 cursor-default'
              }`}
              data-testid="asset-fuel-anomalies"
              title={summary.anomaly_count_90d > 0 ? 'Open the Fuel tab to review flagged fills' : ''}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 inline-flex items-center gap-1">
                <AlertTriangle size={12} className={summary.anomaly_count_90d > 0 ? 'text-amber-600' : 'text-slate-400'} />
                Anomalies (90d)
              </div>
              <div className={`text-lg font-bold tabular-nums mt-0.5 ${summary.anomaly_count_90d > 0 ? 'text-amber-800' : 'text-slate-900'}`}>
                {summary.anomaly_count_90d ?? 0}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {summary.anomaly_count_90d > 0 ? 'Click to review →' : 'none flagged'}
              </div>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({ icon, label, value, hint, testid }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2" data-testid={testid}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 inline-flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5 truncate" title={typeof value === 'string' ? value : undefined}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5 truncate" title={hint}>{hint}</div>}
    </div>
  );
}
