/**
 * v58.13.132aj — Fuel Reporting page at `/app/fleet/fuel`.
 *
 * .132aj deltas (5 fixes bundled):
 *   1. Empty-state banner when totals.fills===0 — shows latest import
 *      date + quick-jump preset buttons + Import Fuel CSV modal.
 *   2. Per-fill drilldown card (collapsible) below the leaderboards.
 *   3. CSV export gains a metadata header block + `?detail=1` per-fill
 *      mode.
 *   4. SmartFill Auto-sync status card at top with Sync-now (admin)
 *      + toggle (admin) + last/next run info.
 *   5. Top 5 · Highest fills (litres desc) replaces the previous
 *      "$/L outliers" panel; the outliers panel now renders below
 *      it and only when at least one non-provisional-priced fill
 *      exists in range.
 *
 * Read-only aggregation view over `fuel_transactions`.
 *   · Period toggle: Weekly / Monthly
 *   · Tab switch:   Per-Employee · Per-Vehicle · Admin Rollup
 *   · Date range presets: This Week / Last Week / This Month /
 *     Last Month / YTD / Custom
 *   · Recharts: stacked $ bar + litres line (dual-axis) + breakdown
 *     pie for the active scope
 *   · CSV re-export per view (aggregated + per-fill detail modes)
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
  ArrowLeft, Fuel, Loader2, Download, Mail, ChevronRight, ChevronDown,
  Users, Truck, Building2, TrendingUp, TrendingDown, Minus,
  AlertTriangle, X as XIcon, RefreshCw, Zap, Power, Upload, Clock,
  CheckCircle2, Pencil, DollarSign,
} from 'lucide-react';
import FuelImportModal from '../components/FuelImportModal';
import FuelTransactionDetailModal from '../components/FuelTransactionDetailModal';
import SmartFillCardDrawer from '../components/fleet/SmartFillCardDrawer';
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
  // v58.13.132de — admin-editable fuel-price fallback.
  // Gate on `assets.edit` — matches sibling fleet endpoints (there is
  // no `fleet` resource in the permissions matrix; earlier drafts used
  // one and silently hid the Edit button for every role).
  const canEditFuel = useCan()('assets', 'edit');
  const [priceSettings, setPriceSettings] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [priceEditOpen, setPriceEditOpen] = useState(false);
  const [priceHistOpen, setPriceHistOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState('');
  const [priceSaving, setPriceSaving] = useState(false);
  // v58.13.132df — Bumped after a successful price save. Included in
  // the `reload` useCallback dep list so leaderboards + rollups
  // refetch immediately when the admin edits the provisional price
  // (backend cache is already flushed by the PUT handler).
  const [priceRefreshTick, setPriceRefreshTick] = useState(0);
  const loadPriceSettings = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        api.get('/fleet/fuel/price-settings'),
        api.get('/fleet/fuel/price-history'),
      ]);
      setPriceSettings(s.data);
      setPriceHistory(h.data?.history || []);
    } catch (e) { /* silent — banner still works */ }
  }, []);
  useEffect(() => { loadPriceSettings(); }, [loadPriceSettings]);
  const savePriceSettings = useCallback(async () => {
    const v = parseFloat(priceDraft);
    if (!Number.isFinite(v) || v <= 0 || v > 10) {
      toast.error('Enter a price between 0 and 10 AUD/L');
      return;
    }
    setPriceSaving(true);
    try {
      const r = await api.put('/fleet/fuel/price-settings',
                              { provisional_price_per_litre: v });
      setPriceSettings(r.data);
      toast.success(`Fuel price updated to $${v.toFixed(2)}/L — reports refreshed.`);
      setPriceEditOpen(false);
      loadPriceSettings();
      // v58.13.132df — Trigger a downstream reports refetch so the
      // leaderboards + Admin Rollup totals reflect the new price at
      // read time. Backend cache is already flushed by the PUT.
      setPriceRefreshTick(n => n + 1);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setPriceSaving(false);
    }
  }, [priceDraft, loadPriceSettings]);
  const currentUser = getUser();
  const isAdmin = (currentUser?.role === 'admin');
  const [scope, setScope] = useState('admin');
  const [period, setPeriod] = useState('monthly');
  const [presetKey, setPresetKey] = useState('this-month');
  const initial = presetRange('this-month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  // v58.13.132aj — Import Fuel CSV modal mount (already implemented
  // in FleetRegister.jsx via the same component). Wired to the
  // empty-state banner's "Import Fuel CSV" quick-jump button.
  const [fuelImportOpen, setFuelImportOpen] = useState(false);
  // v58.13.132aj — SmartFill auto-sync card state.
  const [smartfillStatus, setSmartfillStatus] = useState(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [togglingSync, setTogglingSync] = useState(false);
  // v58.13.132aj — Per-fill drilldown state.
  //   v58.13.132ax — Default OPEN so admins discover the per-fill
  //   detail affordance without having to hunt for the toggle.
  //   Auto-fetches on mount because `useEffect` below watches
  //   `txnListOpen`.
  const [txnListOpen, setTxnListOpen] = useState(true);
  const [txnList, setTxnList] = useState(null);
  const [txnListLoading, setTxnListLoading] = useState(false);
  const [txnListSize, setTxnListSize] = useState(100);
  // v58.13.132ax — Per-fill detail modal state.
  //   Any row across the page (drilldown, Top-5 highest, Top-5
  //   outliers) can populate this. Drilldown rows pass the full doc;
  //   Top-5 rows pass just the id (modal fetches via
  //   /fleet/fuel/transactions/{id}).
  const [detailTxn, setDetailTxn] = useState(null);   // full doc or null
  const [detailTxnId, setDetailTxnId] = useState(null);   // id-only fallback
  // v58.13.132bo — SmartFill card drill-down drawer state. Clicking a
  // leaderboard row opens the drawer for that row's card. Rows that
  // group multiple cards under one label surface a small chooser
  // dialog first; rows with zero linked cards toast the reason.
  const [drawerCard, setDrawerCard] = useState(null);
  const [cardChooserRow, setCardChooserRow] = useState(null);
  // v58.13.132ao — restore "Last updated" + refresh affordance that
  // was lost during the .132aj SmartFill card insertion. Populated
  // whenever `reload()` completes successfully.
  const [dataUpdatedAt, setDataUpdatedAt] = useState(null);

  // v58.13.132bt — Fuel Anomalies entry-point banner. Live open-anomaly
  // count fetched on mount + on window focus. 30s in-memory cache so
  // repeat navigations from the sidebar don't hammer the endpoint.
  const [anomalyCount, setAnomalyCount] = useState(null);
  const loadAnomalyCount = useCallback(async () => {
    try {
      const r = await api.get('/fleet/fuel/anomalies', {
        params: { resolved: false, count_only: true },
      });
      setAnomalyCount(r.data?.count ?? 0);
    } catch {
      setAnomalyCount(null);
    }
  }, []);
  useEffect(() => {
    loadAnomalyCount();
    const onFocus = () => loadAnomalyCount();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadAnomalyCount]);

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
      setDataUpdatedAt(new Date());
    } catch (e) {
      toast.error(apiError(e) || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [scope, period, from, to, priceRefreshTick]);

  useEffect(() => { reload(); }, [reload]);

  // v58.13.132bo — Handle a leaderboard row click. Opens the SmartFill
  // card drawer directly for single-card rows; shows a chooser for
  // multi-card rows; toasts a hint for rows with no linked card.
  const handleLeaderboardClick = useCallback((row) => {
    const cards = row?.card_numbers || [];
    if (cards.length === 0) {
      toast.message('No SmartFill card linked to this row.', {
        description: 'Fills without a card_number can\'t be drilled down.',
      });
      return;
    }
    if (cards.length === 1) {
      setDrawerCard(cards[0]);
      return;
    }
    setCardChooserRow(row);
  }, []);

  // v58.13.132aj — SmartFill auto-sync status fetch on mount.
  const loadSmartfillStatus = useCallback(async () => {
    try {
      const r = await api.get('/fleet/fuel/smartfill-status');
      setSmartfillStatus(r.data);
    } catch (e) {
      // Non-fatal — card just renders "Status unavailable".
      setSmartfillStatus({ __error: apiError(e) || 'unavailable' });
    }
  }, []);
  useEffect(() => { loadSmartfillStatus(); }, [loadSmartfillStatus]);

  // v58.13.132aj — Per-fill drilldown fetch. Fires when the list is
  // opened OR when the date range changes and the list is already
  // open. Falls back to 429/500 toast without breaking the page.
  const loadTxnList = useCallback(async (size = txnListSize) => {
    setTxnListLoading(true);
    try {
      const r = await api.get('/fleet/fuel/transactions', {
        params: { from, to, size, page: 1 },
      });
      setTxnList(r.data);
    } catch (e) {
      toast.error(apiError(e) || 'Failed to load transactions');
    } finally {
      setTxnListLoading(false);
    }
  }, [from, to, txnListSize]);
  useEffect(() => {
    if (txnListOpen) loadTxnList(txnListSize);
  }, [txnListOpen, from, to, txnListSize, loadTxnList]);

  const runSyncNow = async () => {
    if (!isAdmin) return;
    setSyncingNow(true);
    try {
      const r = await api.post('/fleet/fuel/sync-smartfill', {});
      toast.success(
        `Sync complete · +${r.data.rows_inserted ?? 0} inserted · ${r.data.rows_duplicate ?? 0} duplicate`
      );
      await Promise.all([reload(), loadSmartfillStatus()]);
    } catch (e) {
      toast.error(apiError(e) || 'Sync failed');
    } finally {
      setSyncingNow(false);
    }
  };

  const toggleAutoSync = async () => {
    if (!isAdmin || !smartfillStatus) return;
    const next = !smartfillStatus.auto_sync_enabled;
    setTogglingSync(true);
    try {
      await api.post('/fleet/fuel/smartfill-auto-sync', { enabled: next });
      toast.success(`Auto-sync ${next ? 'enabled' : 'disabled'}`);
      await loadSmartfillStatus();
    } catch (e) {
      toast.error(apiError(e) || 'Toggle failed');
    } finally {
      setTogglingSync(false);
    }
  };

  const exportCsv = async (detail = false) => {
    try {
      const resp = await api.get('/fleet/fuel/reports/export', {
        params: { scope, period, from, to, ...(detail ? { detail: 1 } : {}) },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = detail
        ? `fuel-report-detail-${scope}-${period}.csv`
        : `fuel-report-${scope}-${period}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(apiError(e) || 'Export failed');
    }
  };

  // v58.13.132dh — Header segmented control. Flips the price source
  // (SmartFill real vs Provisional override-all) for the whole org.
  // PATCH-style PUT: sends only `override_mode`, price is preserved
  // by the backend fallback to the stored value.
  const setOverrideMode = useCallback(async (mode /* "smartfill_with_fallback" | "provisional_all" */) => {
    if (!canEditFuel) return;
    if (priceSettings?.override_mode === mode) return;
    try {
      const r = await api.put('/fleet/fuel/price-settings', { override_mode: mode });
      setPriceSettings(r.data);
      toast.success(
        mode === 'provisional_all'
          ? 'Provisional override active — reports refreshed.'
          : 'Real SmartFill prices restored — reports refreshed.'
      );
      loadPriceSettings();
      setPriceRefreshTick(n => n + 1);
      if (txnListOpen) loadTxnList(txnListSize);
    } catch (e) {
      toast.error(apiError(e) || 'Failed to switch price source');
    }
  }, [canEditFuel, priceSettings, loadPriceSettings, txnListOpen, loadTxnList, txnListSize]);

  const rows = data?.rows || [];
  const periods = data?.periods || [];
  const outliers = data?.top_dpl_outliers || [];
  // v58.13.132aj — new payload keys.
  const outliersReal = data?.top_dpl_outliers_real || [];
  const highestFills = data?.top_by_fill_litres || [];
  const totals = data?.totals || {};
  const leaderboards = data?.leaderboards || null;

  const pieData = useMemo(() => rows.slice(0, 8).map((r) => ({
    name: r.label, value: r.total_price,
  })), [rows]);

  return (
    <div className="p-6 space-y-4" data-testid="fuel-reporting-page">
      {/* v58.13.132dh — Fuel Price Source segmented control.
          Admin flips SmartFill (real) ↔ Provisional (override all).
          When provisional_all is active, every fill in the Per-Fill
          Transactions table + Top 10 cards + Organisation total is
          repriced at read time. Non-admins see the resulting price
          but no control. */}
      {priceSettings && (
        <div
          className="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3 flex-wrap"
          data-testid="fuel-price-source-toggle"
        >
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Fuel price source</div>
            <div className="text-xs text-slate-600 mt-0.5">
              {priceSettings.override_mode === 'provisional_all'
                ? <>Every fill (including SmartFill real) is being displayed at <b>${Number(priceSettings.provisional_price_per_litre).toFixed(3)}/L</b> — read-time override.</>
                : <>SmartFill real prices are shown per fill. Provisional (<b>${Number(priceSettings.provisional_price_per_litre).toFixed(3)}/L</b>) is used only when a fill has no real price.</>}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {priceSettings.override_mode === 'provisional_all' && (
              <span
                data-testid="provisional-override-active-badge"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-amber-400 bg-amber-100 text-amber-900"
              >
                ⚠ Provisional override active
              </span>
            )}
            {canEditFuel ? (
              <div
                role="tablist"
                aria-label="Fuel price source"
                className="inline-flex rounded-full border border-slate-300 bg-slate-100 p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={priceSettings.override_mode !== 'provisional_all'}
                  data-testid="fuel-price-source-smartfill"
                  onClick={() => setOverrideMode('smartfill_with_fallback')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                    priceSettings.override_mode !== 'provisional_all'
                      ? 'bg-white shadow text-blue-700 ring-1 ring-blue-100'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  SmartFill (real)
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={priceSettings.override_mode === 'provisional_all'}
                  data-testid="fuel-price-source-provisional"
                  onClick={() => setOverrideMode('provisional_all')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                    priceSettings.override_mode === 'provisional_all'
                      ? 'bg-amber-500 shadow text-white'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  Provisional (override all)
                </button>
              </div>
            ) : (
              <span
                data-testid="fuel-price-source-readonly"
                className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
              >
                {priceSettings.override_mode === 'provisional_all' ? 'Provisional (override all)' : 'SmartFill (real)'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* v58.13.132de — admin-editable Fuel Price card (fallback for
          fills without a SmartFill-tagged real price). */}
      {priceSettings && (
        <div
          className={`rounded-xl border p-3 flex items-center gap-3 ${
            priceSettings.override_smartfill_real
              ? 'border-amber-300 bg-amber-50'
              : 'border-emerald-200 bg-emerald-50'
          }`}
          data-testid="fuel-price-card"
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ring-1 ${
            priceSettings.override_smartfill_real
              ? 'bg-amber-100 ring-amber-200'
              : 'bg-emerald-100 ring-emerald-200'
          }`}>
            <DollarSign
              size={20}
              className={priceSettings.override_smartfill_real ? 'text-amber-700' : 'text-emerald-700'}
              strokeWidth={2.25}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-[10px] font-bold uppercase tracking-wider ${
              priceSettings.override_smartfill_real ? 'text-amber-800' : 'text-emerald-800'
            }`}>
              Provisional fuel price
              {priceSettings.override_smartfill_real && (
                <span
                  data-testid="fuel-price-override-badge"
                  className="ml-2 inline-flex items-center px-1.5 py-0 rounded-full text-[9px] font-bold tracking-wider border border-amber-400 bg-amber-100 text-amber-900"
                >
                  ⚠ OVERRIDE ACTIVE
                </span>
              )}
            </div>
            <div className={`text-lg font-semibold leading-tight ${
              priceSettings.override_smartfill_real ? 'text-amber-900' : 'text-emerald-900'
            }`} data-testid="fuel-price-value">
              ${Number(priceSettings.provisional_price_per_litre).toFixed(2)} <span className={`text-xs font-normal ${
                priceSettings.override_smartfill_real ? 'text-amber-700' : 'text-emerald-700'
              }`}>AUD / L</span>
            </div>
            <div className={`text-[11px] mt-0.5 ${
              priceSettings.override_smartfill_real ? 'text-amber-800/90' : 'text-emerald-700/80'
            }`} data-testid="fuel-price-info-line">
              {priceSettings.override_smartfill_real ? (
                <>⚠ OVERRIDE ACTIVE — ALL fills (including SmartFill real prices) are being displayed at ${Number(priceSettings.provisional_price_per_litre).toFixed(2)}/L. Real prices in the DB are preserved.</>
              ) : (
                <>Only applies to fills without a SmartFill-tagged real price. Applies to past and future fills — real prices are never overwritten.</>
              )}
              {priceSettings.updated_by_name && !priceSettings.is_default && (
                <> Last edited by <b>{priceSettings.updated_by_name}</b>{priceSettings.updated_at ? <> on <b>{String(priceSettings.updated_at).slice(0, 10)}</b></> : null}.</>
              )}
            </div>
          </div>
          {priceHistory.length > 0 && (
            <button
              type="button"
              onClick={() => setPriceHistOpen(v => !v)}
              className={`text-xs font-semibold hover:underline ${
                priceSettings.override_smartfill_real ? 'text-amber-800' : 'text-emerald-800'
              }`}
              data-testid="fuel-price-history-toggle"
            >
              {priceHistOpen ? 'Hide history' : `History (${priceHistory.length})`}
            </button>
          )}
          {canEditFuel && (
            <button
              type="button"
              onClick={() => {
                setPriceDraft(String(priceSettings.provisional_price_per_litre));
                setPriceEditOpen(true);
              }}
              data-testid="fuel-price-edit-btn"
              className={`inline-flex items-center gap-1.5 rounded-lg text-white text-xs font-semibold px-3 py-1.5 ${
                priceSettings.override_smartfill_real
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              <Pencil size={12} strokeWidth={2.5}/> Edit
            </button>
          )}
        </div>
      )}
      {priceHistOpen && priceHistory.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="fuel-price-history-list">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Price change history (last {Math.min(5, priceHistory.length)})</div>
          <ul className="space-y-1 text-xs text-slate-700">
            {priceHistory.slice(0, 5).map(h => (
              <li key={h.id} className="flex items-center gap-2">
                <span className="text-slate-400">{(h.changed_at || '').slice(0, 10)}</span>
                <span className="font-medium">{h.changed_by_name || '—'}</span>
                <span className="text-slate-500">changed</span>
                <code className="px-1 rounded bg-rose-50 text-rose-700 text-[10px]">${Number(h.old_price).toFixed(2)}</code>
                <span className="text-slate-400">→</span>
                <code className="px-1 rounded bg-emerald-50 text-emerald-700 text-[10px]">${Number(h.new_price).toFixed(2)}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {priceEditOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setPriceEditOpen(false); }}
          data-testid="fuel-price-edit-modal"
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Provisional fuel price</div>
                <h2 className="text-lg font-semibold text-slate-900 mt-0.5">Edit price</h2>
              </div>
              <button onClick={() => setPriceEditOpen(false)} className="p-1 rounded hover:bg-slate-100" data-testid="fuel-price-edit-cancel">
                <XIcon size={16} className="text-slate-500"/>
              </button>
            </div>
            <label className="block mt-4">
              <div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Price (AUD / L)</div>
              <input
                type="number"
                step="0.01"
                min="0"
                max="10"
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
                data-testid="fuel-price-edit-input"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-200 outline-none text-lg font-semibold"
                autoFocus
              />
              <div className="text-[11px] text-slate-500 mt-1">
                Only applies to fills without a SmartFill-tagged real price. Range 0-10.
              </div>
            </label>
            {/* v58.13.132dh — Override toggle relocated to the
                Fuel Price Source segmented control on the header.
                The Edit modal is now price-only for a clearer UX. */}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setPriceEditOpen(false)} className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50">Cancel</button>
              <button
                onClick={savePriceSettings}
                disabled={priceSaving}
                data-testid="fuel-price-edit-save"
                className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-40"
              >
                {priceSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
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
              onClick={() => exportCsv(false)}
              data-testid="fuel-reporting-export-csv"
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
            >
              <Download size={13} /> Export CSV
            </button>
            {/* v58.13.132aj — Per-fill detail export. */}
            <button
              type="button"
              onClick={() => exportCsv(true)}
              data-testid="fuel-reporting-export-csv-detail"
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
              title="Per-fill CSV — every transaction with Date, Time, Vehicle, Driver, Litres, $/L"
            >
              <Download size={13} /> Export detail (per fill)
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

      {/* v58.13.132bt — Fuel Anomalies entry-point banner. Renders
          when we have at least one flagged fill, or a null count
          (endpoint unreachable — still let admins navigate). Hidden
          when count is a concrete 0. */}
      {anomalyCount !== 0 && (
        <Link
          to="/app/fleet/fuel/anomalies"
          data-testid="fuel-reporting-anomalies-banner"
          className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between hover:bg-amber-100 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-amber-600 shrink-0" size={22} />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                SmartFill · Anomaly Inbox
              </div>
              <div className="text-sm font-semibold text-slate-900 mt-0.5">
                {anomalyCount == null
                  ? 'Fuel anomalies flagged — review'
                  : `${anomalyCount.toLocaleString()} fuel ${anomalyCount === 1 ? 'anomaly' : 'anomalies'} flagged`}
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                Resolve, dismiss or manually attribute flagged fills.
              </div>
            </div>
          </div>
          <span
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold border border-amber-700 group-hover:bg-amber-700 transition-colors"
            data-testid="fuel-reporting-anomalies-cta"
          >
            Review anomalies →
          </span>
        </Link>
      )}

      {/* v58.13.132aj — SmartFill auto-sync status card. */}
      <SmartFillSyncCard
        status={smartfillStatus}
        isAdmin={isAdmin}
        syncingNow={syncingNow}
        togglingSync={togglingSync}
        onSyncNow={runSyncNow}
        onToggle={toggleAutoSync}
      />

      {/* v58.13.132ao — Restored "Last updated" + Refresh strip.
          Was lost during the .132aj SmartFill-card insertion. Sits
          right-aligned above the filter row so it applies to every
          scope tab. */}
      <div
        className="flex justify-end items-center gap-2 -mt-2"
        data-testid="fuel-reporting-updated-strip"
      >
        <span
          className="text-[11px] text-slate-500"
          data-testid="fuel-reporting-last-updated"
        >
          {dataUpdatedAt
            ? <>Last updated: <strong className="text-slate-700 font-semibold">{fmtAusDateTime(dataUpdatedAt.toISOString())}</strong></>
            : (loading ? 'Loading…' : 'Not loaded yet')}
        </span>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          data-testid="fuel-reporting-refresh-btn"
          title="Refresh report data"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-[11px] font-semibold"
        >
          {loading
            ? <Loader2 size={11} className="animate-spin" />
            : <RefreshCw size={11} />}
          Reload view
        </button>
      </div>
      <p
        className="text-[10px] text-slate-400 -mt-1 pr-1 text-right"
        data-testid="fuel-reporting-reload-hint"
      >
        Refreshes on-screen data only. To fetch new SmartFill data, use "Sync now" above.
      </p>

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
          {/* v58.13.132aj — Empty-state banner. Rendered ABOVE all
              other bands when the current filter returned no fills.
              Includes quick-jump preset buttons + Import Fuel CSV
              (admin-gated for edit) so admins can escape the empty
              state in a single tap. */}
          {(totals.fills ?? 0) === 0 && (
            <div
              className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-4 shadow-sm"
              data-testid="fuel-reporting-empty-state"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <Fuel className="text-blue-700" size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-blue-950 text-base">
                    No fills in this range.
                  </div>
                  <div className="text-sm text-blue-900 mt-0.5">
                    {totals.latest_txn_date_iso
                      ? <>Latest import ended <strong data-testid="fuel-reporting-empty-latest-date">{fmtAusDate(totals.latest_txn_date_iso)}</strong>. Try a wider range or import a fresh SmartFill CSV.</>
                      : <>No fuel transactions on file yet for your org. Import a SmartFill CSV to get started.</>
                    }
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => applyPreset('last-week')}
                      data-testid="fuel-reporting-empty-jump-last-week"
                      className="px-2.5 py-1 text-xs font-semibold rounded-full border border-blue-300 bg-white text-blue-800 hover:bg-blue-100 inline-flex items-center gap-1"
                    >
                      <ChevronRight size={11} /> Last week
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('this-month')}
                      data-testid="fuel-reporting-empty-jump-this-month"
                      className="px-2.5 py-1 text-xs font-semibold rounded-full border border-blue-300 bg-white text-blue-800 hover:bg-blue-100 inline-flex items-center gap-1"
                    >
                      <ChevronRight size={11} /> This month
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('ytd')}
                      data-testid="fuel-reporting-empty-jump-ytd"
                      className="px-2.5 py-1 text-xs font-semibold rounded-full border border-blue-300 bg-white text-blue-800 hover:bg-blue-100 inline-flex items-center gap-1"
                    >
                      <ChevronRight size={11} /> Year to date
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setFuelImportOpen(true)}
                        data-testid="fuel-reporting-empty-import-csv"
                        className="px-2.5 py-1 text-xs font-semibold rounded-full border border-blue-700 bg-blue-700 text-white hover:bg-blue-800 inline-flex items-center gap-1"
                      >
                        <Upload size={11} /> Import Fuel CSV
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* v58.13.131h — Price-coverage banner + subtext.
              v58.13.132s — Escalate to a red blocking-style banner
              when >10% of visible rollup rows have no cost. Keeps the
              soft blue banner for the 0-100% mid-band as a nudge. */}
          {(() => {
            const rows = data.rows || [];
            const missing = rows.filter((r) => !r.total_price || r.total_price <= 0).length;
            const missingPct = rows.length ? (missing / rows.length) * 100 : 0;
            if (missingPct > 10) {
              return (
                <div
                  className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900 shadow-sm"
                  data-testid="fuel-reporting-missing-cost-banner"
                >
                  <div className="font-bold text-base mb-1">
                    ⚠ Cost data missing on {missing} of {rows.length} {SCOPE_META[scope].colWord + 's'} ({missingPct.toFixed(0)}%).
                  </div>
                  <div className="text-red-800">
                    $/L reporting, procurement outliers, and cost leaderboards
                    are unreliable until this is fixed. Re-export from SmartFill
                    with the <strong>Total Price</strong> column enabled and
                    re-upload via <em>Fleet → Fuel → Import CSV</em>. The
                    existing rows will be back-filled by the upsert-on-duplicate
                    path (no duplicates created).
                  </div>
                </div>
              );
            }
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
          {/* v58.13.132t — Provisional-price banner. Rendered when
              any transaction in the current dataset is still on the
              $3.00 back-fill placeholder. Overrides nothing; sits
              alongside the missing-cost / no-price banners above. */}
          {data.totals?.has_provisional && (
            <div
              className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 shadow-sm"
              data-testid="fuel-reporting-provisional-banner"
            >
              <div className="font-bold mb-1">
                ⚠ Fuel costs shown are <span className="italic">provisional at ${Number(priceSettings?.provisional_price_per_litre ?? 2.25).toFixed(2)}/L</span> pending supplier confirmation.
              </div>
              <div className="text-amber-800 text-xs">
                Applied to fills without a SmartFill-tagged real price — past and future. Real prices are never overwritten.
                Re-upload the SmartFill CSV with the <strong>Total Price</strong> column enabled
                to replace these placeholders with real prices — the upsert path merges in place
                (no duplicates) and clears the provisional flag automatically.
              </div>
            </div>
          )}
          {/* ── Totals ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="fuel-reporting-totals">
            <Stat label="Total litres" value={`${(totals.litres ?? 0).toFixed(1)} L`} />
            {/* v58.13.132t (F-B) — em-dash when sum is 0 rather than $0.00 */}
            <Stat
              label="Total cost"
              value={
                (totals.total_price ?? 0) > 0
                  ? `$${totals.total_price.toFixed(2)}${totals.has_provisional ? '*' : ''}`
                  : '—'
              }
            />
            <Stat label="Total fills" value={totals.fills ?? 0} />
            <Stat label={SCOPE_META[scope].colWord + 's'} value={totals.unique_keys ?? 0} />
          </div>

          {/* ── Top-5 · Highest fills (Litres desc) ──────────
              v58.13.132aj — Replaces the previous "$/L outliers"
              panel. Sort by per-fill litres desc. Provisional-priced
              rows render `$/L` in italic amber with an asterisk.
              v58.13.132ak — Subtitle + range pill for clarity on
              exactly what "highest" means. */}
          <div
            className="rounded-2xl border border-amber-200 bg-amber-50 p-3"
            data-testid="fuel-reporting-highest-fills"
          >
            <div className="flex items-start gap-2 mb-2 flex-wrap">
              <Fuel className="text-amber-600 mt-0.5" size={16} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-amber-900">
                  Top 5 · Highest fills
                </div>
                <div className="text-[11px] text-amber-800/80 mt-0.5">
                  Highest single fills within the selected range.
                </div>
              </div>
              {(from || to) && (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white text-amber-900 border border-amber-300 whitespace-nowrap"
                  data-testid="fuel-reporting-highest-range-pill"
                >
                  {from ? fmtAusDate(from) : '—'} – {to ? fmtAusDate(to) : '—'}
                </span>
              )}
            </div>
            {highestFills.length === 0 ? (
              <div className="text-xs text-amber-800/80">
                No fills in this range.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-amber-800/80">
                    <tr>
                      <th className="px-2 py-1 text-right">Litres</th>
                      <th className="px-2 py-1 text-left">Vehicle</th>
                      <th className="px-2 py-1 text-left">Driver</th>
                      <th className="px-2 py-1 text-left">Date</th>
                      {/* v58.13.132aw — Time column per Stephen ask. */}
                      <th className="px-2 py-1 text-left">Time</th>
                      <th className="px-2 py-1 text-right">Cost</th>
                      <th className="px-2 py-1 text-right">$/L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-200">
                    {highestFills.map((f, i) => (
                      <tr
                        key={i}
                        data-testid={`fuel-reporting-highest-fill-${i}`}
                        onClick={() => f.id && setDetailTxnId(f.id)}
                        className={f.id ? 'cursor-pointer hover:bg-amber-100 transition-colors' : ''}
                        title={f.id ? 'Click to view full transaction detail' : undefined}
                      >
                        <td className="px-2 py-1 text-right font-mono font-bold text-amber-900 tabular-nums">
                          {f.litres?.toFixed(2)} L
                        </td>
                        <td className="px-2 py-1 text-slate-800 truncate max-w-[180px]">
                          {f.registration || f.label}
                        </td>
                        <td className="px-2 py-1 text-slate-700 text-xs truncate max-w-[180px]">
                          {f.driver || '—'}
                        </td>
                        <td className="px-2 py-1 font-mono text-xs text-slate-600">
                          {fmtAusDate(f.date_iso)}
                        </td>
                        {/* v58.13.132aw — Time column (HH:MM 24h). */}
                        <td
                          className="px-2 py-1 font-mono text-xs text-slate-600"
                          data-testid={`fuel-reporting-highest-fill-time-${i}`}
                        >
                          {(f.time_local || '').slice(0, 5) || '—'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {f.total_price != null ? `$${f.total_price.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {f.dpl != null ? (
                            f.price_source === 'provisional_static_3.00' || f.price_source === 'provisional_static_2.25' ? (
                              <span
                                className="italic text-amber-700 font-mono"
                                title="Provisional — awaiting real price"
                              >${f.dpl.toFixed(3)}*</span>
                            ) : (
                              <span className="font-mono">${f.dpl.toFixed(3)}</span>
                            )
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Secondary: $/L outliers (real prices only) ───
              v58.13.132aj — Only rendered when at least one
              non-provisional fill exists. Suppresses the noise
              from a fully-provisional dataset. */}
          {outliersReal.length > 0 && (
            <div
              className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3"
              data-testid="fuel-reporting-outliers-real"
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="text-amber-600" size={16} />
                <div className="text-sm font-bold text-amber-900">
                  Top 5 · $/L outliers · procurement signal
                </div>
                <span className="text-[10px] uppercase tracking-wider text-amber-700/80 ml-1">
                  real prices only
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-amber-800/80">
                    <tr>
                      <th className="px-2 py-1 text-left">$/L</th>
                      <th className="px-2 py-1 text-left">{SCOPE_META[scope].colWord}</th>
                      {/* v58.13.132bz — Rego column so admins can see
                          which vehicle drove each outlier fill. */}
                      <th className="px-2 py-1 text-left">Rego</th>
                      <th className="px-2 py-1 text-right">Litres</th>
                      <th className="px-2 py-1 text-right">Cost</th>
                      <th className="px-2 py-1 text-left">Date</th>
                      {/* v58.13.132aw — Time column per Stephen ask. */}
                      <th className="px-2 py-1 text-left">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-200">
                    {outliersReal.map((o, i) => (
                      <tr
                        key={i}
                        data-testid={`fuel-reporting-outlier-real-${i}`}
                        onClick={() => o.id && setDetailTxnId(o.id)}
                        className={o.id ? 'cursor-pointer hover:bg-amber-100 transition-colors' : ''}
                        title={o.id ? 'Click to view full transaction detail' : undefined}
                      >
                        <td className="px-2 py-1 font-mono font-bold text-amber-900">
                          ${o.dpl?.toFixed(3)}
                        </td>
                        <td className="px-2 py-1 text-slate-800 truncate max-w-[200px]">
                          {o.label}
                        </td>
                        {/* v58.13.132bz — Rego cell w/ linked/inferred/unlinked cascade. */}
                        <td
                          className="px-2 py-1 font-mono text-xs"
                          data-testid={`fuel-reporting-outlier-real-rego-${i}`}
                        >
                          {o.linked_rego ? (
                            <span className="text-emerald-700 font-bold">{o.linked_rego}</span>
                          ) : o.inferred_rego ? (
                            <span className="text-violet-700 font-bold italic" title="Inferred from CSV registration column">
                              {o.inferred_rego}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{o.litres?.toFixed(2)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">${o.total_price?.toFixed(2)}</td>
                        <td className="px-2 py-1 font-mono text-xs text-slate-600">{fmtAusDate(o.date_iso)}</td>
                        {/* v58.13.132aw — Time column (HH:MM 24h). */}
                        <td
                          className="px-2 py-1 font-mono text-xs text-slate-600"
                          data-testid={`fuel-reporting-outlier-real-time-${i}`}
                        >
                          {(o.time_local || '').slice(0, 5) || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
                    {/* v58.13.132ak — `Fills` column removed in favour
                        of `Last fill` (date). Rows sorted by last-fill
                        desc so the most recently-fuelled entity is
                        at the top. */}
                    <th className="px-3 py-2 text-left">Last fill</th>
                    <th className="px-3 py-2 text-right">Litres</th>
                    <th className="px-3 py-2 text-right">Cost</th>
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
                  {rows.map((r) => {
                    // v58.13.132bz — Restore per-row click → open the
                    // SmartFillCardDrawer for card rows OR the txn
                    // detail modal for vehicle rows. Also apply the
                    // .132bq/.132bu label cascade (Card N · REGO /
                    // inferred / unlinked) so per-employee + per-
                    // vehicle rows match the leaderboard treatment.
                    const cards = r.card_numbers || [];
                    let displayLabel = r.label;
                    let isRowInferred = false;
                    if (cards.length === 1) {
                      const cn = cards[0];
                      const linked = (r.linked_rego || '').trim();
                      const inf = (r.inferred_rego || '').trim();
                      if (linked) displayLabel = `Card ${cn} · ${linked}`;
                      else if (inf) { displayLabel = `Card ${cn} · ${inf}`; isRowInferred = true; }
                      else displayLabel = `Card ${cn} · unlinked`;
                    }
                    const clickable = cards.length === 1;
                    const onClick = clickable
                      ? () => setDrawerCard(cards[0])
                      : undefined;
                    return (
                    <tr
                      key={r.key}
                      data-testid={`fuel-reporting-row-${r.key}`}
                      onClick={onClick}
                      className={clickable ? 'cursor-pointer hover:bg-blue-50/60 transition-colors' : ''}
                      title={clickable ? `Open drill-down for card ${cards[0]}` : undefined}
                    >
                      <td className="px-3 py-1.5 text-slate-800 truncate max-w-[280px]">
                        {displayLabel}
                        {isRowInferred && (
                          <span
                            className="ml-1 inline-flex items-center rounded-full bg-violet-100 text-violet-800 px-1 py-0 text-[9px] font-bold italic"
                            title="Inferred from majority vehicle across this card's fills in the last 90 days"
                            data-testid={`fuel-reporting-row-${r.key}-inferred`}
                          >
                            inf.
                          </span>
                        )}
                      </td>
                      <td
                        className="px-3 py-1.5 font-mono text-xs text-slate-700 whitespace-nowrap"
                        data-testid={`fuel-reporting-row-last-fill-${r.key}`}
                      >
                        {/* v58.13.132cc — Restore full timestamp + 12h AM/PM
                            on the LAST FILL column. Backend already carries
                            `latest_fill_timestamp` (ISO 8601 datetime); .132ak
                            regressed this cell to date-only. Falls back to a
                            date-only string when only `latest_fill_date_iso`
                            is available so legacy rows don't crash. */}
                        {r.latest_fill_timestamp
                          ? fmtAusDateTime12h(r.latest_fill_timestamp)
                          : (r.latest_fill_date_iso ? fmtAusDate(r.latest_fill_date_iso) : '—')}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.litres.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">${r.total_price.toFixed(2)}</td>
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
                  );
                  })}
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
                onRowClick={handleLeaderboardClick}
              />
              <Leaderboard
                title="Top 10 · Highest $/L"
                rows={leaderboards.top_by_dpl || []}
                metricKey="dpl"
                metricFmt={(v) => v != null ? `$${v.toFixed(3)}` : '—'}
                testidRoot="fuel-reporting-lb-dpl"
                onRowClick={handleLeaderboardClick}
              />
              <Leaderboard
                title="Top 10 · Most fills"
                rows={leaderboards.top_by_fills || []}
                metricKey="fills"
                metricFmt={(v) => v ?? 0}
                testidRoot="fuel-reporting-lb-fills"
                onRowClick={handleLeaderboardClick}
              />
            </div>
          )}

          {/* v58.13.132aj — Per-fill drilldown card. Default OPEN as
              of .132ax; lazy-loads on open + refetches when the
              date range changes. Reuses the existing
              /fleet/fuel/transactions endpoint with `from`/`to`.
              Each row is now click-to-open on the .132ax
              FuelTransactionDetailModal. */}
          <FuelTransactionsList
            open={txnListOpen}
            onToggle={() => setTxnListOpen((v) => !v)}
            loading={txnListLoading}
            list={txnList}
            size={txnListSize}
            onShowAll={() => setTxnListSize(500)}
            onOpenDetail={(t) => setDetailTxn(t)}
          />
        </>
      )}

      {/* v58.13.132ax — Per-fill detail modal. Reads from `detailTxn`
          (full doc, no fetch needed) or `detailTxnId` (id-only,
          modal fetches). Closed when both are null. */}
      {(detailTxn || detailTxnId) && (
        <FuelTransactionDetailModal
          txn={detailTxn}
          txnId={detailTxnId}
          onClose={() => { setDetailTxn(null); setDetailTxnId(null); }}
        />
      )}

      {emailOpen && (
        <EmailReportDialog
          onClose={() => setEmailOpen(false)}
          filters={{ scope, period, from, to }}
        />
      )}

      {/* v58.13.132bo — SmartFill card drill-down drawer. Opened by
          clicking any Top-10 leaderboard row that has a linked card. */}
      {drawerCard && (
        <SmartFillCardDrawer
          cardNumber={drawerCard}
          onClose={() => setDrawerCard(null)}
          onOpenTxn={(t) => { setDetailTxn(t); }}
        />
      )}

      {/* v58.13.132bo — Card chooser (only when a row groups more than
          one card under the same employee/driver label). */}
      {cardChooserRow && (
        <CardChooserDialog
          row={cardChooserRow}
          onPick={(cn) => { setCardChooserRow(null); setDrawerCard(cn); }}
          onClose={() => setCardChooserRow(null)}
        />
      )}

      {/* v58.13.132aj — Import Fuel CSV modal (admin gated at
          backend). Wired to the empty-state banner + SmartFill card. */}
      <FuelImportModal
        open={fuelImportOpen}
        onClose={() => setFuelImportOpen(false)}
        onImported={() => {
          setFuelImportOpen(false);
          reload();
          loadSmartfillStatus();
        }}
      />
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

function Leaderboard({ title, rows, metricKey, metricFmt, testidRoot, onRowClick }) {
  // v58.13.132bq/bu — Prettify "Card N (unlinked)" labels using a
  // cascade:
  //   1. Formal link (`linked_rego`)  → "Card N · REGO"
  //   2. Inferred from majority asset_id in last 90d (`inferred_rego`)
  //                                     → "Card N · REGO"  + (inferred) chip
  //   3. Neither                       → "Card N · unlinked"
  // Non-card rows (driver name, org, etc.) → row.label as-is.
  const displayLabel = (r) => {
    const cards = r.card_numbers || [];
    if (cards.length !== 1) return r.label;
    const cn = cards[0];
    const linked = (r.linked_rego || '').trim();
    if (linked) return `Card ${cn} · ${linked}`;
    const inferred = (r.inferred_rego || '').trim();
    if (inferred) return `Card ${cn} · ${inferred}`;
    return `Card ${cn} · unlinked`;
  };
  const isInferred = (r) => {
    const cards = r.card_numbers || [];
    return cards.length === 1 && !(r.linked_rego || '').trim()
      && !!(r.inferred_rego || '').trim();
  };
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
          {rows.map((r, i) => {
            const cards = r.card_numbers || [];
            const clickable = onRowClick && cards.length > 0;
            return (
              <tr
                key={r.key}
                data-testid={`${testidRoot}-row-${i}`}
                onClick={clickable ? () => onRowClick(r) : undefined}
                title={
                  clickable
                    ? (cards.length === 1
                        ? `Open drill-down for card ${cards[0]}`
                        : `Pick a card to drill into (${cards.length} linked)`)
                    : undefined
                }
                className={clickable ? 'cursor-pointer hover:bg-blue-50/60' : ''}
              >
                <td className="px-3 py-1.5 text-xs text-slate-400 tabular-nums w-8">{i + 1}</td>
                <td className="px-3 py-1.5 text-slate-800 truncate max-w-[170px]">
                  {displayLabel(r)}
                  {isInferred(r) && (
                    <span
                      className="ml-1 inline-flex items-center rounded-full bg-violet-100 text-violet-800 px-1 py-0 text-[9px] font-bold italic"
                      title="Rego derived from majority vehicle across this card's fills in the last 90 days. Set the formal link on the vehicle record to confirm."
                      data-testid={`${testidRoot}-row-${i}-inferred`}
                    >
                      inf.
                    </span>
                  )}
                  {cards.length > 1 && (
                    <span
                      className="ml-1 inline-flex items-center rounded-full bg-blue-100 text-blue-700 px-1 py-0 text-[9px] font-bold"
                      data-testid={`${testidRoot}-row-${i}-multi-card`}
                    >
                      {cards.length} cards
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-sm whitespace-nowrap">
                  {metricFmt(r[metricKey])}
                </td>
                <td className="px-2 py-1.5 text-right w-12"><DeltaChip d={r.delta_dpl} /></td>
              </tr>
            );
          })}
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


// ─────────────────────────────────────────────────────────
// v58.13.132aj additions — helpers + new sub-components
// ─────────────────────────────────────────────────────────

// Format an ISO YYYY-MM-DD as DD/MM/YYYY (Aus locale). Falls back to
// the raw string if it doesn't look like an ISO date.
function fmtAusDate(iso) {
  if (!iso || iso.length < 10) return iso || '—';
  const y = iso.slice(0, 4), m = iso.slice(5, 7), d = iso.slice(8, 10);
  return `${d}/${m}/${y}`;
}

// Format an ISO datetime as `DD/MM/YYYY hh:mm A` in local 12-hour
// time. Used by the Per-Employee / Per-Vehicle / Admin rollup
// tables' `LAST FILL` column (v58.13.132cc — restored per Stephen
// ask; had regressed to date-only in .132ak).
function fmtAusDateTime12h(iso) {
  if (!iso) return '—';
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return typeof iso === 'string' && iso.length >= 10 ? fmtAusDate(iso) : '—';
    const p = (n) => String(n).padStart(2, '0');
    let h = dt.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(h)}:${p(dt.getMinutes())} ${ampm}`;
  } catch {
    return typeof iso === 'string' ? iso : '—';
  }
}

// Format an ISO datetime as `DD/MM/YYYY HH:mm` in local time.
function fmtAusDateTime(iso) {
  if (!iso) return '—';
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
  } catch {
    return iso;
  }
}

// SmartFill Auto-sync status card. Renders at the top of the page.
// Non-admin viewers see status only; admins see Sync-now + toggle.
function SmartFillSyncCard({
  status, isAdmin, syncingNow, togglingSync, onSyncNow, onToggle,
}) {
  if (!status) {
    return (
      <div
        className="rounded-2xl border border-slate-200 bg-white p-3 flex items-center gap-2 text-xs text-slate-500"
        data-testid="fuel-reporting-smartfill-card-loading"
      >
        <Loader2 size={12} className="animate-spin" /> Loading SmartFill status…
      </div>
    );
  }
  if (status.__error) {
    return (
      <div
        className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-500"
        data-testid="fuel-reporting-smartfill-card-error"
      >
        SmartFill status unavailable — {status.__error}
      </div>
    );
  }
  const enabled = !!status.auto_sync_enabled;
  const cronReg = !!status.cron_registered;
  const last = status.last_batch_summary || {};
  const lastAt = status.last_synced_at || last.uploaded_at;

  // Determine effective mode + pill color.
  let pillTone = 'bg-slate-100 text-slate-700 border-slate-200';
  let pillLabel = 'DISABLED';
  if (enabled && cronReg) {
    pillTone = 'bg-emerald-100 text-emerald-800 border-emerald-200';
    pillLabel = 'ENABLED';
  } else if (enabled && !cronReg) {
    pillTone = 'bg-amber-100 text-amber-800 border-amber-200';
    pillLabel = 'MANUAL ONLY';
  }

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="fuel-reporting-smartfill-card"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
            <Zap className="text-blue-600" size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="font-bold text-slate-900 text-sm">SmartFill Auto-sync</div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${pillTone}`}
                data-testid="fuel-reporting-smartfill-status-pill"
              >
                {pillLabel}
              </span>
            </div>
            <div className="text-xs text-slate-600 mt-1 space-y-0.5">
              <div>
                <span className="text-slate-400 mr-1">Last synced:</span>
                <span
                  className="font-semibold text-slate-800"
                  data-testid="fuel-reporting-smartfill-last-synced"
                >{fmtAusDateTime(lastAt)}</span>
                {last.rows_inserted != null && (
                  <span className="ml-2 text-slate-500">
                    · +{last.rows_inserted} inserted · {last.rows_duplicate ?? 0} dup · {last.rows_anomalous ?? 0} anom
                  </span>
                )}
              </div>
              {enabled && cronReg && (
                <div className="text-slate-500">
                  <Clock size={10} className="inline-block mr-1 -mt-0.5" />
                  Runs daily at 06:00 Australia/Brisbane.
                </div>
              )}
              {enabled && !cronReg && (
                <div className="text-amber-700">
                  Toggle is ON, but the cron scheduler isn't wired in this environment
                  (<code className="font-mono text-[10px] bg-slate-100 px-1 rounded">SMARTFILL_AUTO_SYNC_CRON</code> not set).
                  Sync-now still works.
                </div>
              )}
              {!enabled && (
                <div className="text-slate-500">
                  Manual only — auto-sync is off.
                </div>
              )}
              {status.rate_limit_state?.remaining != null && (
                <div className="text-slate-400 text-[11px]">
                  Rate limit budget: {status.rate_limit_state.remaining} calls remaining this window
                </div>
              )}
            </div>
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onSyncNow}
              disabled={syncingNow}
              data-testid="fuel-reporting-smartfill-sync-now"
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {syncingNow
                ? <Loader2 size={12} className="animate-spin" />
                : <RefreshCw size={12} />
              }
              {syncingNow ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={onToggle}
              disabled={togglingSync}
              data-testid="fuel-reporting-smartfill-toggle"
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border inline-flex items-center gap-1.5 ${
                enabled
                  ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              <Power size={12} />
              {enabled ? 'Disable auto-sync' : 'Enable auto-sync'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// v58.13.132aj — Per-fill drilldown collapsible card. Lazy-loads on
// open. Columns: Date · Time · Vehicle · Driver · Litres · Cost · $/L.
function FuelTransactionsList({ open, onToggle, loading, list, size, onShowAll, onOpenDetail }) {
  const items = list?.items || [];
  const total = list?.total ?? 0;
  const canShowAll = total > items.length;
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
      data-testid="fuel-reporting-txn-list-card"
    >
      <button
        type="button"
        onClick={onToggle}
        data-testid="fuel-reporting-txn-list-toggle"
        className="w-full px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between hover:bg-slate-100"
      >
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 inline-flex items-center gap-1.5">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Per-fill transactions
          {total > 0 && (
            <span className="text-slate-400 normal-case tracking-normal">
              · {items.length} of {total} shown
            </span>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto max-h-[420px]">
          {loading && (
            <div className="p-8 text-center text-xs text-slate-500">
              <Loader2 size={13} className="inline animate-spin mr-1" /> Loading fills…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-400">
              No fills in this range.
            </div>
          )}
          {!loading && items.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-white text-[10px] uppercase tracking-wider text-slate-500 sticky top-0 border-b border-slate-100">
                <tr>
                  <th className="px-3 py-1.5 text-left">Date</th>
                  <th className="px-3 py-1.5 text-left">Time</th>
                  <th className="px-3 py-1.5 text-left">Vehicle</th>
                  <th className="px-3 py-1.5 text-left">Driver</th>
                  <th className="px-3 py-1.5 text-right">Litres</th>
                  <th className="px-3 py-1.5 text-right">Cost</th>
                  <th className="px-3 py-1.5 text-right">$/L</th>
                  {/* v58.13.132au — Transaction ID column so admins
                      can cross-reference DB rows directly with the
                      SmartFill portal. Null on legacy CSV rows. */}
                  <th className="px-3 py-1.5 text-left" title="SmartFill portal transaction id (v58.13.132au)">Txn ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((t) => {
                  const driver = t.resolved_driver_name || t.driver || '—';
                  const dpl = t.computed_price_per_litre;
                  const isProv = t.price_source === 'provisional_static_3.00' || t.price_source === 'provisional_static_2.25';
                  return (
                    <tr
                      key={t.id}
                      data-testid={`fuel-reporting-txn-row-${t.id}`}
                      onClick={() => onOpenDetail?.(t)}
                      className="cursor-pointer hover:bg-amber-50 transition-colors"
                      title="Click to view full transaction detail"
                    >
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {fmtAusDate(t.date_iso)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-600">
                        {(t.time_local || '').slice(0, 5) || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-800 truncate max-w-[160px]">
                        {t.registration || t.description || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-700 truncate max-w-[180px]">
                        {driver}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {t.litres != null ? Number(t.litres).toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {t.total_price != null ? `$${Number(t.total_price).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {dpl != null ? (
                          isProv ? (
                            <span className="italic text-amber-700 font-mono"
                                  title="Provisional — awaiting real price">
                              ${Number(dpl).toFixed(3)}*
                            </span>
                          ) : (
                            <span className="font-mono">${Number(dpl).toFixed(3)}</span>
                          )
                        ) : '—'}
                      </td>
                      {/* v58.13.132au — SmartFill transaction id. */}
                      <td
                        className="px-3 py-1.5 font-mono text-[11px] text-slate-500"
                        data-testid={`fuel-reporting-txn-id-${t.id}`}
                      >
                        {t.transaction_id || <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {open && canShowAll && !loading && (
            <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-center">
              <button
                type="button"
                onClick={onShowAll}
                data-testid="fuel-reporting-txn-list-show-all"
                className="text-xs font-semibold text-blue-700 hover:text-blue-900"
              >
                Show all {total} fills →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// v58.13.132bo — CardChooserDialog. Rendered when a leaderboard row
// groups more than one SmartFill card under the same driver/label.
// Lets the admin pick which card to drill into.
function CardChooserDialog({ row, onPick, onClose }) {
  const cards = row?.card_numbers || [];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
      onClick={onClose}
      data-testid="fuel-reporting-card-chooser"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
          Multiple cards for this row
        </div>
        <h3 className="text-lg font-bold text-slate-900 mt-0.5" title={row?.label}>
          {row?.label}
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Pick a SmartFill card to open its drill-down drawer.
        </p>
        <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto">
          {cards.map((cn) => (
            <button
              key={cn}
              type="button"
              onClick={() => onPick(cn)}
              className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-blue-50 text-sm font-mono"
              data-testid={`fuel-reporting-card-chooser-opt-${cn}`}
            >
              Card {cn}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
            data-testid="fuel-reporting-card-chooser-cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
