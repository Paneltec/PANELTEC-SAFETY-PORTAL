/**
 * v58.13.132bo — SmartFill card drill-down drawer.
 *
 * Opens from any of the 3 Top-10 leaderboards on the Fuel dashboard
 * (Highest $, Highest $/L, Most fills) and shows:
 *   · summary panel (all-time + YTD + 30d fills + anomaly-90d + link)
 *   · full transactions table (paginated, click-to-open per-fill
 *     detail modal, filter to flagged-only)
 *   · footer actions: assign to vehicle (unlinked cards), copy number
 *
 * Backend contract (introduced this ship):
 *   GET  /fleet/fuel/cards/{card}/summary       → summary payload
 *   GET  /fleet/fuel/cards/{card}/transactions  → paginated rows
 *   POST /fleet/fuel/cards/{card}/assign        → link vehicle
 */
import React, { useCallback, useEffect, useState } from 'react';
import { X, Loader2, ExternalLink, Copy, AlertTriangle, Fuel } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';

const PAGE_SIZE = 100;

function fmtMoney(v) { return v == null ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtLitres(v, d = 1) { return v == null ? '—' : `${Number(v).toFixed(d)} L`; }
function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso; }
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
}

export default function SmartFillCardDrawer({ cardNumber, onClose, onOpenTxn }) {
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!cardNumber) return;
    setSummaryLoading(true);
    try {
      const r = await api.get(`/fleet/fuel/cards/${cardNumber}/summary`);
      setSummary(r.data);
    } catch (e) { toast.error(apiError(e) || 'Card summary failed'); }
    finally { setSummaryLoading(false); }
  }, [cardNumber]);

  const loadRows = useCallback(async (nextOffset = 0) => {
    if (!cardNumber) return;
    setRowsLoading(true);
    try {
      const r = await api.get(`/fleet/fuel/cards/${cardNumber}/transactions`, {
        params: { limit: PAGE_SIZE, offset: nextOffset, flagged_only: flaggedOnly },
      });
      setRows(r.data.rows || []);
      setTotal(r.data.total || 0);
      setOffset(nextOffset);
    } catch (e) { toast.error(apiError(e) || 'Transactions failed'); }
    finally { setRowsLoading(false); }
  }, [cardNumber, flaggedOnly]);

  useEffect(() => { loadSummary(); loadRows(0); }, [loadSummary, loadRows]);

  // ESC to close.
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  if (!cardNumber) return null;
  const linked = summary?.linked_vehicle;

  return (
    <div className="fixed inset-0 z-40 flex" data-testid="smartfill-card-drawer">
      <div className="flex-1 bg-slate-900/40" onClick={onClose} />
      {/* v58.13.132bx — Push the panel down 4rem (64px = h-16, the
          app topbar's height) so the drawer header doesn't visually
          collide with the notifications bell / mail icon / avatar. */}
      <div className="w-full max-w-3xl h-[calc(100vh-4rem)] mt-16 bg-white shadow-2xl flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-blue-700">SmartFill Card</div>
            {/* v58.13.132bq/bu — Header cascade:
                  linked  → "Card N · REGO" (emerald)
                  inferred → "Card N · REGO" (violet, italic)
                  neither  → "Card N · unlinked" (amber) */}
            <h2 className="text-lg font-bold text-slate-900" data-testid="smartfill-card-title">
              Card {cardNumber}
              <span className="text-slate-400"> · </span>
              {linked ? (
                <span className="text-emerald-700">{linked.rego_serial || linked.name}</span>
              ) : summary?.inferred_rego ? (
                <span className="text-violet-700 italic" data-testid="smartfill-card-title-inferred">
                  {summary.inferred_rego}
                </span>
              ) : (
                <span className="text-amber-700">unlinked</span>
              )}
            </h2>
            <div className="text-xs mt-0.5">
              {linked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 font-semibold">
                  Linked to {linked.rego_serial || linked.name}
                </span>
              ) : summary?.inferred_rego ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-violet-100 text-violet-800 px-2 py-0.5 font-semibold"
                  title={`Inferred from ${summary.inferred_fill_count_90d ?? '?'} fills in the last 90 days. Not a formal link.`}
                >
                  Inferred · {summary.inferred_rego}
                  {summary.inferred_fill_count_90d
                    ? ` (${summary.inferred_fill_count_90d} fills 90d)` : ''}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-semibold">
                  Unlinked
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100" data-testid="smartfill-card-close">
            <X size={18} />
          </button>
        </header>

        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {summaryLoading ? (
            <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading summary…</div>
          ) : summary && (
            <section className="grid grid-cols-2 md:grid-cols-3 gap-2" data-testid="smartfill-card-summary">
              <Metric label="Total spend (all-time)" value={fmtMoney(summary.all_time?.total_price)} hint={`${summary.all_time?.fill_count ?? 0} fills`} />
              <Metric label="Total litres (all-time)" value={fmtLitres(summary.all_time?.total_litres, 0)} hint={summary.all_time?.avg_price_per_litre != null ? `${fmtMoney(summary.all_time.avg_price_per_litre).slice(1)}/L avg` : ''} />
              <Metric label="YTD spend" value={fmtMoney(summary.ytd?.total_price)} hint={`${fmtLitres(summary.ytd?.total_litres, 0)} · ${summary.ytd?.fill_count ?? 0} fills`} />
              <Metric label="Fills (30d)" value={summary.fills_30d ?? 0} hint="last 30 days" />
              <Metric label="First seen" value={fmtDate(summary.all_time?.first_seen)} hint={`Last: ${fmtDate(summary.all_time?.last_seen)}`} />
              <Metric label="Top driver (90d)" value={summary.top_driver_90d?.name || '—'} hint={summary.top_driver_90d ? `${summary.top_driver_90d.attribution_count} fills` : 'no dominant driver'} />
              <button
                type="button"
                onClick={() => { if (summary.anomaly_count_90d > 0) { setFlaggedOnly(true); loadRows(0); } }}
                disabled={!summary.anomaly_count_90d}
                data-testid="smartfill-card-anomalies"
                className={`text-left rounded-lg border p-2 col-span-1 ${summary.anomaly_count_90d > 0 ? 'bg-amber-50 border-amber-200 hover:bg-amber-100 cursor-pointer' : 'bg-white border-slate-200'}`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 inline-flex items-center gap-1"><AlertTriangle size={12} className={summary.anomaly_count_90d > 0 ? 'text-amber-600' : 'text-slate-400'} />Anomalies (90d)</div>
                <div className={`text-lg font-bold mt-0.5 ${summary.anomaly_count_90d > 0 ? 'text-amber-800' : 'text-slate-900'}`}>{summary.anomaly_count_90d ?? 0}</div>
                <div className="text-[10px] text-slate-500">{summary.anomaly_count_90d > 0 ? 'Click to filter list →' : 'none flagged'}</div>
              </button>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Transactions ({total})</div>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer">
                <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} data-testid="smartfill-card-flagged-only" />
                Flagged only
              </label>
            </div>
            {rowsLoading ? (
              <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-6">No transactions for this card.</div>
            ) : (
              <div className="rounded-lg border border-slate-200 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Date / time</th>
                      <th className="px-2 py-1.5 text-left">Station</th>
                      <th className="px-2 py-1.5 text-right">Litres</th>
                      <th className="px-2 py-1.5 text-right">$/L</th>
                      <th className="px-2 py-1.5 text-right">Total</th>
                      <th className="px-2 py-1.5 text-left">Vehicle</th>
                      <th className="px-2 py-1.5 text-left">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((t) => (
                      <tr
                        key={t.id}
                        onClick={() => onOpenTxn?.(t)}
                        data-testid={`smartfill-card-row-${t.id}`}
                        className="hover:bg-blue-50/50 cursor-pointer"
                      >
                        <td className="px-2 py-1.5 tabular-nums">{fmtDateTime(t.timestamp)}</td>
                        <td className="px-2 py-1.5 truncate max-w-[160px]">{t.from_site || '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtLitres(t.litres)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{t.dpl != null ? `$${t.dpl.toFixed(3)}` : '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-mono">{fmtMoney(t.total_price)}</td>
                        <td className="px-2 py-1.5">{t.vehicle_rego || <span className="text-slate-400 italic">unmatched</span>}</td>
                        <td className="px-2 py-1.5">{(t.anomaly_flags || []).length > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 font-semibold text-[9px]"><AlertTriangle size={9} />{(t.anomaly_flags || []).length}</span> : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {total > PAGE_SIZE && (
                  <div className="flex items-center justify-between px-2 py-1.5 bg-slate-50 border-t border-slate-200 text-[11px]">
                    <div>Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</div>
                    <div className="flex gap-1">
                      <button onClick={() => loadRows(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0} className="px-2 py-0.5 rounded border border-slate-200 disabled:opacity-40">Prev</button>
                      <button onClick={() => loadRows(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total} className="px-2 py-0.5 rounded border border-slate-200 disabled:opacity-40">Next</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            onClick={() => { navigator.clipboard.writeText(cardNumber); toast.success('Card number copied'); }}
            className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
            data-testid="smartfill-card-copy"
          >
            <Copy size={12} /> Copy card number
          </button>
          {!linked && (
            <button
              onClick={() => setAssignOpen(true)}
              className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              data-testid="smartfill-card-assign-btn"
            >
              <ExternalLink size={12} /> Assign to vehicle…
            </button>
          )}
        </footer>

        {assignOpen && (
          <AssignVehicleDialog
            cardNumber={cardNumber}
            onClose={() => setAssignOpen(false)}
            onAssigned={() => { setAssignOpen(false); loadSummary(); }}
          />
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 inline-flex items-center gap-1"><Fuel size={10} />{label}</div>
      <div className="text-sm font-bold text-slate-900 mt-0.5 truncate">{value}</div>
      {hint && <div className="text-[10px] text-slate-500 truncate">{hint}</div>}
    </div>
  );
}

function AssignVehicleDialog({ cardNumber, onClose, onAssigned }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/assets', { params: { kind: 'vehicle', q: query, limit: 20 } })
      .then((r) => setOptions(r.data.assets || r.data.items || r.data || []))
      .catch(() => {});
  }, [query]);

  const assign = async (vehicleId) => {
    setSaving(true);
    try {
      const r = await api.post(`/fleet/fuel/cards/${cardNumber}/assign`, { vehicle_id: vehicleId });
      toast.success(r.data.no_change ? 'Already linked' : `Linked to ${r.data.vehicle_rego}`);
      onAssigned?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" data-testid="smartfill-card-assign-dialog">
        <h3 className="font-bold text-slate-900 mb-2">Assign card {cardNumber} to vehicle</h3>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by rego or name…" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3" data-testid="smartfill-card-assign-search" />
        <div className="max-h-72 overflow-y-auto space-y-1">
          {options.slice(0, 20).map((v) => (
            <button key={v.id} disabled={saving} onClick={() => assign(v.id)} className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-blue-50 text-sm disabled:opacity-50" data-testid={`smartfill-card-assign-opt-${v.id}`}>
              <span className="font-mono">{v.rego_serial || '—'}</span>
              <span className="ml-2 text-slate-500">{v.name}</span>
            </button>
          ))}
          {options.length === 0 && <div className="text-slate-400 text-sm text-center py-4">No vehicles.</div>}
        </div>
      </div>
    </div>
  );
}
