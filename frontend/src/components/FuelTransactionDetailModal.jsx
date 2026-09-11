// v58.13.132ax — FuelTransactionDetailModal.
//
// A single, reusable modal that opens on click of any fuel-transaction
// row across the app (Fuel Report drilldown + Top-5 tables + Asset
// drawer recent-transactions + Fuel Anomaly Inbox).
//
// USER PAIN (verbatim, Stephen · 2026-09-08):
//   "is ther wany way to view a single transaction with the date
//    then if we see any thing that looks suspissious we will know
//    the time day and vehicle/employee"
//
// Two call shapes:
//   <FuelTransactionDetailModal txn={fullFuelRow} onClose={...} />
//     – FuelReporting drilldown, AssetFuelTab and FuelAnomalyInbox
//       already have the full doc client-side, no fetch needed.
//   <FuelTransactionDetailModal txnId="<id>" onClose={...} />
//     – Top-5 tables carry only a partial payload; the modal fetches
//       `GET /fleet/fuel/transactions/{id}` on open.
//
// Backend endpoint: `backend/fleet_fuel.py::get_transaction` (`.132ax`).
// Requires `assets.view` permission — same read-gate as the report list.

import React, { useEffect, useState } from 'react';
import {
  X as XIcon,
  Loader2,
  Fuel,
  User,
  Truck,
  MapPin,
  CreditCard,
  Hash,
  AlertTriangle,
  Gauge,
  CircleDollarSign,
  Clock,
  Calendar,
  Code,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import api, { apiError } from '../lib/api';
import { toast } from 'sonner';

// ── formatters ──────────────────────────────────────────────
const fmtDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!d) return iso;
  return `${d}/${m}/${y}`;
};
const fmtTime = (t) => {
  if (!t) return '—';
  return t.slice(0, 5);
};
const fmtDollar = (v, decimals = 2) => {
  if (v == null) return '—';
  return `$${Number(v).toFixed(decimals)}`;
};
const fmtNum = (v, decimals = 2) => {
  if (v == null) return '—';
  return Number(v).toFixed(decimals);
};

const PRICE_SOURCE_LABEL = {
  smartfill_actual: { label: 'SmartFill actual', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  'provisional_static_3.00': { label: 'Provisional $3.00 (placeholder)', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
};

export default function FuelTransactionDetailModal({ txn, txnId, onClose }) {
  const [doc, setDoc] = useState(txn || null);
  const [loading, setLoading] = useState(!txn && !!txnId);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (txn) {
      setDoc(txn);
      return;
    }
    if (!txnId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await api.get(`/fleet/fuel/transactions/${txnId}`);
        if (!cancelled) setDoc(r.data);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e) || 'Failed to load transaction');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [txn, txnId]);

  const t = doc || {};
  const dpl = t.computed_price_per_litre;
  const isProv = t.price_source === 'provisional_static_3.00';
  const priceMeta = PRICE_SOURCE_LABEL[t.price_source] || null;
  const driver = t.resolved_driver_name || t.driver || null;
  const flags = (t.anomaly_flags || []).filter((f) => f?.rule);
  const openFlags = flags.filter((f) => !f.resolved_at);

  // v58.13.132dj — Provisional-override display awareness. When the
  // org has flipped the `.132dh` toggle to `provisional_all`, the
  // backend already reprices `total_price` + `computed_price_per_litre`
  // at read time; we also receive `raw_total_price` and
  // `raw_computed_price_per_litre` so the modal can surface the raw
  // SmartFill numbers as an audit reference row.
  const overrideActive = t.price_state?.override_mode === 'provisional_all';
  const provPrice = t.price_state?.provisional_price_per_litre;
  const rawTotal = t.raw_total_price;
  const rawDpl = t.raw_computed_price_per_litre;
  const priceHint = overrideActive
    ? 'Provisional override'
    : (priceMeta ? priceMeta.label : (t.price_source || '—'));
  const dplHint = overrideActive
    ? 'Provisional override'
    : (isProv ? 'Provisional — awaiting real price' : 'Total ÷ Litres');
  const priceTone = overrideActive ? 'amber' : (isProv ? 'amber' : 'slate');

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 pt-20 pb-8 overflow-y-auto"
      onClick={onClose}
      data-testid="fuel-txn-detail-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
      >
        {/* ── header ─────────────────────────────────────── */}
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 bg-slate-50">
          <div className="w-9 h-9 rounded-lg bg-amber-500 text-white flex items-center justify-center">
            <Fuel size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Fuel transaction detail
            </div>
            <div className="text-base font-display font-bold text-slate-900 truncate">
              {loading ? 'Loading…' : (
                <>
                  {t.registration || t.description || '—'}
                  <span className="text-slate-400 font-normal"> · </span>
                  {fmtDate(t.date_iso)}
                  <span className="text-slate-400 font-normal"> · </span>
                  {fmtTime(t.time_local)}
                </>
              )}
            </div>
          </div>
          {/* v58.13.132dj — Provisional override pill (mirrors the
              header segmented control on Fuel Reporting). */}
          {overrideActive && !loading && (
            <span
              data-testid="fuel-txn-detail-override-pill"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-amber-400 bg-amber-100 text-amber-900"
            >
              ⚠ Provisional override active
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            data-testid="fuel-txn-detail-close"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100"
            title="Close"
          >
            <XIcon size={16} />
          </button>
        </div>

        {loading && (
          <div className="p-10 text-center text-slate-500">
            <Loader2 className="inline animate-spin" size={16} /> Loading fill…
          </div>
        )}

        {!loading && doc && (
          <div className="p-5 space-y-4">
            {/* ── anomaly banner ──────────────────────── */}
            {openFlags.length > 0 && (
              <div
                className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 flex items-start gap-2"
                data-testid="fuel-txn-detail-anomaly-banner"
              >
                <AlertTriangle className="text-rose-600 shrink-0 mt-0.5" size={14} />
                <div className="text-[13px] text-rose-800">
                  <span className="font-semibold uppercase tracking-wide text-[11px]">
                    {openFlags.length} open anomaly {openFlags.length === 1 ? 'flag' : 'flags'}
                  </span>
                  <ul className="mt-1 list-disc list-inside space-y-0.5">
                    {openFlags.map((f, i) => (
                      <li key={`${f.rule}-${i}`}>
                        <span className="font-mono font-semibold">{f.rule}</span>
                        {f.detail && <span className="text-rose-700"> — {f.detail}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* ── metrics strip ───────────────────────── */}
            <div className="grid grid-cols-3 gap-3">
              <Metric
                label="Litres"
                value={t.litres != null ? `${fmtNum(t.litres, 2)} L` : '—'}
                hint={t.fuel_type || 'Diesel'}
                testId="fuel-txn-detail-litres"
              />
              <Metric
                label="Total price"
                value={fmtDollar(t.total_price)}
                hint={priceHint}
                tone={priceTone}
                testId="fuel-txn-detail-total-price"
              />
              <Metric
                label="$/L (computed)"
                value={dpl != null ? fmtDollar(dpl, 3) : '—'}
                hint={dplHint}
                tone={priceTone}
                testId="fuel-txn-detail-dpl"
              />
            </div>

            {/* ── details table ───────────────────────── */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <Row
                icon={<Hash size={12} />}
                label="Transaction ID"
                value={t.transaction_id || <span className="text-slate-300 italic">null (CSV import)</span>}
                testId="fuel-txn-detail-transaction-id"
              />
              <Row
                icon={<Calendar size={12} />}
                label="Date"
                value={fmtDate(t.date_iso)}
              />
              <Row
                icon={<Clock size={12} />}
                label="Time"
                value={fmtTime(t.time_local)}
                testId="fuel-txn-detail-time"
              />
              <Row
                icon={<Truck size={12} />}
                label="Vehicle"
                value={
                  <>
                    <span className="font-mono font-semibold">{t.registration || '—'}</span>
                    {t.description && (
                      <span className="text-slate-500"> · {t.description}</span>
                    )}
                  </>
                }
                testId="fuel-txn-detail-vehicle"
              />
              <Row
                icon={<CreditCard size={12} />}
                label="Card"
                value={
                  <>
                    <span className="font-mono">{t.card_number || '—'}</span>
                    {t.attribution_pending && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-200">
                        Unlinked
                      </span>
                    )}
                  </>
                }
                testId="fuel-txn-detail-card"
              />
              <Row
                icon={<User size={12} />}
                label="Driver"
                value={driver || <span className="text-slate-400 italic">unresolved</span>}
                testId="fuel-txn-detail-driver"
              />
              <Row
                icon={<MapPin size={12} />}
                label="From site"
                value={t.from_site || <span className="text-slate-300">—</span>}
                testId="fuel-txn-detail-from-site"
              />
              {/* v58.13.132do — Portal Unit Price row surfaces the
                  effective per-fill price under BOTH toggle modes
                  with a "REFLECTS FUEL PRICE POLICY" caption, so
                  admins never see developer jargon ("stale —
                  ignored, we use total ÷ litres") from the .132dl
                  wording. Under `smartfill_with_fallback` (default),
                  the row shows the SmartFill-computed $/L (Total ÷
                  Litres — mirrors the `$/L (Computed)` metric card)
                  with a slate policy caption. Under `provisional_all`
                  (from .132dh), it swaps to the Provisional price
                  with the amber caption shipped in .132dl. Read-time
                  only; no DB mutation. */}
              {(dpl != null || (overrideActive && provPrice != null)) && (
                <Row
                  icon={<CircleDollarSign size={12} />}
                  label="Portal unit price"
                  value={
                    overrideActive && provPrice != null ? (
                      <span data-testid="fuel-txn-detail-portal-unit-price-override">
                        <span className="font-mono">{fmtDollar(provPrice, 3)}</span>
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-800">
                          Provisional override active — reflects fuel price policy
                        </span>
                      </span>
                    ) : (
                      <span data-testid="fuel-txn-detail-portal-unit-price">
                        <span className="font-mono">{fmtDollar(dpl, 3)}</span>
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-500">
                          SmartFill price — reflects fuel price policy
                        </span>
                      </span>
                    )
                  }
                />
              )}
              {/* v58.13.132dj — Raw SmartFill audit reference row.
                  Only rendered when the .132dh toggle is
                  `provisional_all` AND the raw values are actually
                  distinguishable from the displayed ones. Preserves
                  the SmartFill numbers as evidence of what was
                  imported, without mutating the DB. */}
              {overrideActive && rawTotal != null && (
                <Row
                  icon={<CircleDollarSign size={12} />}
                  label="SmartFill raw (reference)"
                  value={
                    <span data-testid="fuel-txn-detail-smartfill-raw">
                      <span className="font-mono">{fmtDollar(rawTotal)}</span>
                      {rawDpl != null && (
                        <>
                          <span className="mx-1 text-slate-400">@</span>
                          <span className="font-mono">{fmtDollar(rawDpl, 3)}/L</span>
                        </>
                      )}
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-800">
                        Displayed values reflect provisional override (${fmtNum(provPrice, 3)}/L)
                      </span>
                    </span>
                  }
                />
              )}
              {t.odometer_km != null && (
                <Row
                  icon={<Gauge size={12} />}
                  label="Odometer"
                  value={
                    <>
                      <span className="font-mono">{Math.round(t.odometer_km).toLocaleString()} km</span>
                      {t.odometer_source && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200">
                          {t.odometer_source}
                        </span>
                      )}
                    </>
                  }
                />
              )}
              {t.engine_hours != null && (
                <Row
                  icon={<Clock size={12} />}
                  label="Engine hours"
                  value={
                    <>
                      <span className="font-mono">{fmtNum(t.engine_hours, 1)} h</span>
                      {t.engine_hours_source && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200">
                          {t.engine_hours_source}
                        </span>
                      )}
                    </>
                  }
                />
              )}
              {t.litres_per_100km != null && (
                <Row
                  icon={<Fuel size={12} />}
                  label="L / 100km"
                  value={<span className="font-mono">{fmtNum(t.litres_per_100km, 2)}</span>}
                />
              )}
              <Row
                icon={<Hash size={12} />}
                label="Source"
                value={
                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                    {t.source || '—'}
                  </span>
                }
              />
              <Row
                icon={<Hash size={12} />}
                label="Match status"
                value={
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                    t.match_status === 'matched'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : t.match_status === 'manual'
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}>
                    {t.match_status || '—'}
                  </span>
                }
              />
            </div>

            {/* ── raw import row (collapsible) ─────────── */}
            {t.raw_row && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  data-testid="fuel-txn-detail-raw-toggle"
                  className="w-full px-3 py-2 bg-slate-50 flex items-center justify-between hover:bg-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Code size={12} /> Raw import row
                  </span>
                  <span className="normal-case tracking-normal text-slate-400">
                    {showRaw ? 'Hide' : 'Show'}
                  </span>
                </button>
                {showRaw && (
                  <pre
                    className="text-[11px] leading-relaxed font-mono bg-slate-950 text-slate-100 p-3 overflow-x-auto max-h-64"
                    data-testid="fuel-txn-detail-raw-json"
                  >
                    {JSON.stringify(t.raw_row, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── footer ─────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500">
          <span data-testid="fuel-txn-detail-imported-at">
            {doc?.imported_at ? `Imported ${new Date(doc.imported_at).toLocaleString()}` : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, hint, tone = 'slate', testId }) {
  const toneCls = tone === 'amber'
    ? 'bg-amber-50 border-amber-200'
    : 'bg-white border-slate-200';
  return (
    <div className={`rounded-xl border p-3 ${toneCls}`} data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5 font-mono">{value}</div>
      {hint && (
        <div className={`text-[10px] mt-0.5 ${tone === 'amber' ? 'text-amber-800' : 'text-slate-500'}`}>
          {hint}
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, value, testId }) {
  return (
    <div
      className="grid grid-cols-[110px_1fr] items-center gap-3 px-3 py-2 border-t border-slate-100 first:border-t-0"
      data-testid={testId}
    >
      <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className="text-[13px] text-slate-800">
        {value}
      </div>
    </div>
  );
}
