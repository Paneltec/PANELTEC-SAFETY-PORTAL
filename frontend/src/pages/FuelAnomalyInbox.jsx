/**
 * v58.13.131c — Fuel Anomaly Inbox at `/app/fleet/fuel/anomalies`.
 *
 * Filters (rule, status open/resolved, date range, page) + a table
 * of transactions with any anomaly flag. Each row exposes inline
 * Resolve / Dismiss (per-rule) and Manual-Match (for unattributed
 * rows). Per-row actions are gated on `assets.edit`.
 *
 * Never triggers emails or SMS. Inbox-only.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Loader2, ChevronLeft, ChevronRight,
  CheckCircle2, X as XIcon, Search, Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { useCan } from '../lib/permissions';
import FuelTransactionDetailModal from '../components/FuelTransactionDetailModal';

const RULE_META = {
  unusual_hour:        { label: 'Unusual hour',        tone: 'amber',  severity: 'low'    },
  capacity_exceed:     { label: 'Capacity exceeded',   tone: 'rose',   severity: 'high'   },
  stat_spike:          { label: 'Statistical spike',   tone: 'violet', severity: 'medium' },
  reading_regress:     { label: 'Reading regression',  tone: 'violet', severity: 'medium' },
  missing_odometer:    { label: 'No odometer',         tone: 'amber',  severity: 'low'    },
  // v58.13.131d — top-3 $/L outliers this month (procurement signal).
  procurement_outlier: { label: 'Procurement outlier', tone: 'violet', severity: 'medium' },
};

const SEVERITY_TONE = {
  low:    'bg-amber-100 text-amber-800 border-amber-200',
  medium: 'bg-violet-100 text-violet-800 border-violet-200',
  high:   'bg-rose-100 text-rose-800 border-rose-200',
};

const PAGE_SIZE = 50;

export default function FuelAnomalyInbox() {
  const canEdit = useCan()('assets', 'edit');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [rule, setRule] = useState('');
  const [status, setStatus] = useState('open'); // open | resolved | all
  const [q, setQ] = useState('');
  const [matchingTx, setMatchingTx] = useState(null); // txn row for manual-match dialog
  // v58.13.132ax — full-detail modal state.
  const [detailTxn, setDetailTxn] = useState(null);
  // v58.13.132bs — Multi-select state + bulk-attribute modal state.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkAttrOpen, setBulkAttrOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);

  // Deselect all when the Status tab changes to avoid stale selections
  // whose rows are no longer on screen.
  useEffect(() => { setSelected(new Set()); }, [status]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, size: PAGE_SIZE };
      if (rule) params.rule = rule;
      if (status === 'open') params.resolved = false;
      if (status === 'resolved') params.resolved = true;
      const r = await api.get('/fleet/fuel/anomalies', { params });
      setItems(r.data?.items || []);
      setTotal(r.data?.total || 0);
    } catch (e) {
      toast.error(apiError(e) || 'Could not load anomalies');
    } finally {
      setLoading(false);
    }
  }, [page, rule, status]);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const needle = q.trim().toLowerCase();
    return items.filter((r) => {
      const hay = [
        r.registration, r.description, r.driver, r.key_code,
        r.card_number, r.from_site, r.transaction_id,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const flip = async (row, ruleKey, action) => {
    if (!canEdit) return;
    try {
      await api.post(
        `/fleet/fuel/anomalies/${row.id}/${action}`,
        { rule: ruleKey },
      );
      const ruleLabel = RULE_META[ruleKey]?.label || ruleKey;
      const verb = action === 'resolve' ? 'Resolved' : 'Dismissed';
      // v58.13.132bp — 5-second Undo toast so an accidental Resolve/
      // Dismiss can be reversed in one click. Emerald action pill so
      // the affordance is unmissable.
      toast.success(`${verb} · ${ruleLabel}`, {
        duration: 5000,
        actionButtonStyle: {
          backgroundColor: '#059669', // emerald-600
          color: '#ffffff',
          padding: '0.375rem 0.875rem',
          borderRadius: '9999px',
          fontWeight: 600,
          fontSize: '0.75rem',
          border: '1px solid #047857', // emerald-700
        },
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await api.post(
                `/fleet/fuel/anomalies/${row.id}/reopen`,
                { rule: ruleKey },
              );
              toast('Reopened');
              reload();
            } catch (undoErr) {
              toast.error(apiError(undoErr) || 'Undo failed');
            }
          },
        },
      });
      reload();
    } catch (e) {
      toast.error(apiError(e) || `${action} failed`);
    }
  };

  // v58.13.132bs — Bulk actions on the currently-selected set.
  // v58.13.132bv — Robustness upgrades:
  //   · Optimistic FE removal: strip actioned ids from `items` before
  //     the reload fires, so the user sees rows disappear instantly.
  //   · Await reload so subsequent state updates aren't racing a stale
  //     items array.
  //   · Toast surfaces skipped/failed count from the backend response
  //     so admins know when a selected row was a no-op.
  const bulkAction = async (kind, extra = {}) => {
    if (!canEdit) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkPending(true);
    const url = `/fleet/fuel/anomalies/bulk-${kind}`;
    try {
      const r = await api.post(url, { txn_ids: ids, ...extra });
      const d = r.data || {};
      const verbMap = {
        resolve: { done: 'Resolved',    countKey: 'resolved' },
        dismiss: { done: 'Dismissed',   countKey: 'dismissed' },
        attribute: { done: 'Attributed', countKey: 'attributed' },
      };
      const verb = verbMap[kind]?.done || kind;
      const count = d[verbMap[kind]?.countKey] ?? 0;
      const failed = (d.failed || []).length;

      // Optimistic FE removal — for resolve/dismiss on the Open tab,
      // strip the actioned ids from `items` immediately so the user
      // sees the visual drop-out before the reload round-trips.
      if ((kind === 'resolve' || kind === 'dismiss') && status === 'open') {
        setItems((prev) => prev.filter((r) => !selected.has(r.id)));
        setTotal((t) => Math.max(0, t - count));
      }

      let toastMsg = `${verb} · ${count} transaction${count === 1 ? '' : 's'}`;
      if (kind === 'attribute' && d.vehicle_rego) {
        toastMsg += ` · ${d.vehicle_rego}`;
      }
      if (failed > 0) {
        toastMsg += ` · ${failed} skipped`;
      }

      // Only resolve + dismiss carry an Undo path (bulk-reopen). Attribute
      // is not reversible via a single-click undo.
      if (kind === 'attribute') {
        toast.success(toastMsg);
      } else {
        toast.success(toastMsg, {
          duration: 5000,
          actionButtonStyle: {
            backgroundColor: '#059669',
            color: '#ffffff',
            padding: '0.375rem 0.875rem',
            borderRadius: '9999px',
            fontWeight: 600,
            fontSize: '0.75rem',
            border: '1px solid #047857',
          },
          action: {
            label: 'Undo',
            onClick: async () => {
              try {
                await api.post('/fleet/fuel/anomalies/bulk-reopen', { txn_ids: ids });
                toast('Reopened');
                await reload();
              } catch (undoErr) {
                toast.error(apiError(undoErr) || 'Undo failed');
              }
            },
          },
        });
      }
      setSelected(new Set());
      setBulkAttrOpen(false);
      // Await the reload so a fresh items array replaces the
      // optimistic slice before any downstream re-render.
      await reload();
    } catch (e) {
      toast.error(apiError(e) || `Bulk ${kind} failed`);
    } finally {
      setBulkPending(false);
    }
  };

  const toggleRow = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePageAll = () => {
    // v58.13.132ca — When the current filter matches more rows than
    // the visible page, promote the header checkbox to select-all-
    // MATCHING (server-scoped, up to 2000 cap). Fires the same fetch
    // as the amber pre-select banner. If already fully selected on
    // the page + no cross-page rows exist, this falls through to a
    // simple deselect. Stephen's ask: "select all" should mean all
    // matching, not just visible-page-50.
    if (total > filtered.length && !allOnPageSelected) {
      selectAllMatching();
      return;
    }
    setSelected((prev) => {
      const pageIds = filtered.map((r) => r.id);
      const allSelected = pageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const allOnPageSelected = filtered.length > 0
    && filtered.every((r) => selected.has(r.id));

  // v58.13.132bw — Select all txns matching the current server-side
  // filters (status/rule/q) up to the 2000 cap. Powers the "Select
  // all N matching" affordance in the bulk bar so admins can act on
  // the full result-set instead of only the visible page.
  const selectAllMatching = async () => {
    setBulkPending(true);
    try {
      const params = { limit: 2000 };
      if (rule) params.rule = rule;
      if (status === 'open') params.resolved = false;
      if (status === 'resolved') params.resolved = true;
      if (q.trim()) params.search = q.trim();
      const r = await api.get('/fleet/fuel/anomalies/matching-ids', { params });
      const d = r.data || {};
      const ids = d.ids || [];
      setSelected(new Set(ids));
      if (d.capped) {
        toast(
          `Selected first ${ids.length.toLocaleString()} of ${(d.total_matches || 0).toLocaleString()} matches — narrow filters to reach the rest.`,
          { duration: 6000 },
        );
      } else {
        toast(`Selected ${ids.length.toLocaleString()} matching transaction${ids.length === 1 ? '' : 's'}.`);
      }
    } catch (e) {
      toast.error(apiError(e) || 'Could not select matching rows');
    } finally {
      setBulkPending(false);
    }
  };

  return (
    <div className="p-6 space-y-4" data-testid="fuel-anomaly-inbox-page">
      <div>
        <Link
          to="/app/fleet"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
          data-testid="fuel-anomaly-back"
        >
          <ArrowLeft size={12} /> Fleet &amp; Service Register
        </Link>
        <div className="mt-2 flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
              SmartFill · Anomaly inbox
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-slate-900 mt-0.5 inline-flex items-center gap-2">
              <AlertTriangle className="text-amber-600" size={22} />
              Fuel anomalies
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Flagged fuel transactions from the SmartFill CSV importer.
              Resolve, dismiss, or manually attribute each row. No emails or SMS are sent.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total matches</div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums">{total}</div>
          </div>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────── */}
      <div
        className="rounded-2xl border border-slate-200 bg-white p-3 space-y-3"
        data-testid="fuel-anomaly-filters"
      >
        {/* v58.13.132bp — Status filter rendered as a proper tab strip
            (bottom-border indicator on active) instead of the pre-.132bp
            pill trio, which read as standalone chips. */}
        <div className="border-b border-slate-200 -mx-3 px-3">
          <div className="flex items-center gap-1" data-testid="fuel-anomaly-status-tabs">
            {[
              { key: 'open',     label: 'Open' },
              { key: 'resolved', label: 'Resolved' },
              { key: 'all',      label: 'All' },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => { setStatus(opt.key); setPage(1); }}
                data-testid={`fuel-anomaly-status-${opt.key}`}
                className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
                  status === opt.key
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="text-xs font-semibold text-slate-500">Rule</div>
          <select
            value={rule}
            onChange={(e) => { setRule(e.target.value); setPage(1); }}
            data-testid="fuel-anomaly-rule-filter"
            className="text-xs px-2 py-1 border border-slate-300 rounded-md bg-white"
          >
            <option value="">All rules</option>
            {Object.entries(RULE_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>

          <div className="ml-auto relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter shown rows — rego, driver, site, key…"
              data-testid="fuel-anomaly-search"
              className="pl-6 pr-2 py-1 text-xs border border-slate-300 rounded-md w-64 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* v58.13.132bz — Pre-selection banner. Renders when the user
          has selected nothing yet BUT the current filter matches more
          rows than the visible page. Makes the "act on all N matching"
          affordance discoverable without needing to tick a checkbox
          first. */}
      {canEdit && selected.size === 0 && total > filtered.length && filtered.length > 0 && (
        <div
          className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-2 flex items-center gap-3 flex-wrap"
          data-testid="fuel-anomaly-preselect-banner"
        >
          <div className="text-sm">
            Showing <span className="font-semibold">{filtered.length}</span> of{' '}
            <span className="font-semibold">{total.toLocaleString()}</span> matching transactions.
          </div>
          <button
            type="button"
            onClick={selectAllMatching}
            disabled={bulkPending}
            data-testid="fuel-anomaly-preselect-select-all"
            className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white border border-amber-700 disabled:opacity-60"
          >
            Select all {total.toLocaleString()} matching →
          </button>
        </div>
      )}

      {/* v58.13.132bs — Sticky bulk action bar. Only mounts when at
          least one row is selected. Emerald / slate / indigo pills
          match the single-row action button treatment from .132bp. */}
      {canEdit && selected.size > 0 && (        <div
          className="sticky top-2 z-20 rounded-2xl border border-slate-900 bg-slate-900 text-white shadow-lg px-4 py-2.5 flex items-center gap-3 flex-wrap"
          data-testid="fuel-anomaly-bulk-bar"
        >
          <div className="text-sm font-semibold" data-testid="fuel-anomaly-bulk-count">
            {selected.size} transaction{selected.size === 1 ? '' : 's'} selected
            {selected.size > filtered.length && (
              <span
                className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-amber-500 text-slate-900 px-2 py-0.5 rounded"
                data-testid="fuel-anomaly-bulk-cross-page-badge"
              >
                cross-page
              </span>
            )}
          </div>
          {/* v58.13.132bw — Cross-page "Select all N matching" so
              admins can act on the full result set (not just the
              visible page). Only surfaces when there are more
              matches than currently selected. */}
          {total > selected.size && (
            <button
              type="button"
              onClick={selectAllMatching}
              disabled={bulkPending}
              data-testid="fuel-anomaly-bulk-select-all-matching"
              className="text-xs font-semibold text-blue-200 hover:text-white underline underline-offset-2 disabled:opacity-60"
            >
              Select all {total.toLocaleString()} matching →
            </button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => bulkAction('resolve')}
              disabled={bulkPending}
              data-testid="fuel-anomaly-bulk-resolve"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 disabled:opacity-60"
            >
              <CheckCircle2 size={12} /> Bulk Resolve
            </button>
            <button
              type="button"
              onClick={() => bulkAction('dismiss')}
              disabled={bulkPending}
              data-testid="fuel-anomaly-bulk-dismiss"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-600 hover:bg-slate-700 text-white border border-slate-500 disabled:opacity-60"
            >
              <XIcon size={12} /> Bulk Dismiss
            </button>
            <button
              type="button"
              onClick={() => setBulkAttrOpen(true)}
              disabled={bulkPending}
              data-testid="fuel-anomaly-bulk-attribute"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 disabled:opacity-60"
            >
              <Link2 size={12} /> Bulk Manually Attribute
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={bulkPending}
              data-testid="fuel-anomaly-bulk-clear"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-500 text-slate-100 hover:bg-slate-800 disabled:opacity-60"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────── */}
      <div
        className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
        data-testid="fuel-anomaly-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                {canEdit && (
                  <th className="px-3 py-2 text-left w-8">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={togglePageAll}
                      aria-label="Select all rows on this page"
                      data-testid="fuel-anomaly-select-all"
                      className="h-3.5 w-3.5 cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Vehicle</th>
                <th className="px-3 py-2 text-left">Driver / Site</th>
                <th className="px-3 py-2 text-right">Litres</th>
                <th className="px-3 py-2 text-left" title="SmartFill portal transaction id (v58.13.132au)">Txn ID</th>
                <th className="px-3 py-2 text-left">Anomaly rules</th>
                <th className="px-3 py-2 text-left">Match</th>
                {canEdit && <th className="px-3 py-2 text-left w-40">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={canEdit ? 9 : 7} className="px-3 py-8 text-center text-slate-400">
                    <Loader2 className="inline animate-spin" size={14} /> Loading anomalies…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 9 : 7} className="px-3 py-10 text-center text-slate-400">
                    {q
                      ? `No anomalies match "${q}".`
                      : status === 'open'
                        ? 'No open anomalies — you\'re clear.'
                        : 'No anomalies match these filters.'}
                  </td>
                </tr>
              )}
              {!loading && filtered.map((r) => (
                <AnomalyRow
                  key={r.id}
                  row={r}
                  canEdit={canEdit}
                  selected={selected.has(r.id)}
                  onToggle={toggleRow}
                  onFlip={flip}
                  onMatch={() => setMatchingTx(r)}
                  onOpenDetail={(row) => setDetailTxn(row)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 bg-slate-50 text-xs">
            <span>
              Page <strong className="tabular-nums">{page}</strong> of{' '}
              <strong className="tabular-nums">{totalPages}</strong> — {total} total
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                data-testid="fuel-anomaly-page-prev"
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 inline-flex items-center gap-1"
              >
                <ChevronLeft size={11} /> Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                data-testid="fuel-anomaly-page-next"
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 inline-flex items-center gap-1"
              >
                Next <ChevronRight size={11} />
              </button>
            </div>
          </div>
        )}
      </div>

      {matchingTx && (
        <ManualMatchModal
          txn={matchingTx}
          onClose={() => setMatchingTx(null)}
          onMatched={() => { setMatchingTx(null); reload(); }}
        />
      )}

      {/* v58.13.132bs — Bulk-attribute modal reuses the fleet search
          from ManualMatchModal but points at the bulk endpoint. */}
      {bulkAttrOpen && (
        <BulkAttributeModal
          count={selected.size}
          onClose={() => setBulkAttrOpen(false)}
          onPick={(vehicleId) => bulkAction('attribute', { vehicle_id: vehicleId })}
          saving={bulkPending}
        />
      )}

      {/* v58.13.132ax — full-detail modal for any anomaly row. */}
      {detailTxn && (
        <FuelTransactionDetailModal
          txn={detailTxn}
          onClose={() => setDetailTxn(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function AnomalyRow({ row, canEdit, selected, onToggle, onFlip, onMatch, onOpenDetail }) {
  const flags = (row.anomaly_flags || []).filter((f) => f?.rule);
  const openFlags = flags.filter((f) => !f.resolved_at);
  const unmatched = row.match_status === 'unmatched';
  return (
    <tr data-testid={`fuel-anomaly-row-${row.id}`} className="hover:bg-slate-50">
      {canEdit && (
        <td className="px-3 py-2 w-8">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggle?.(row.id)}
            aria-label="Select transaction"
            data-testid={`fuel-anomaly-select-${row.id}`}
            className="h-3.5 w-3.5 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          />
        </td>
      )}
      <td className="px-3 py-2 text-xs font-mono text-slate-700 whitespace-nowrap">
        {/* v58.13.132ax — When cell is a click-to-detail affordance.
            Uses button so keyboard focus lands on it too. */}
        <button
          type="button"
          onClick={() => onOpenDetail?.(row)}
          data-testid={`fuel-anomaly-open-detail-${row.id}`}
          title="View full transaction detail"
          className="inline-flex items-center gap-1 text-left hover:text-amber-700 focus:text-amber-700 focus:outline-none"
        >
          <span>{row.date_iso}</span>
          <span className="text-slate-400"> · </span>
          <span>{row.time_local}</span>
        </button>
      </td>
      <td className="px-3 py-2">
        <div className="font-mono text-sm font-semibold text-slate-800">
          {row.registration || row.key_code || row.card_number || '—'}
        </div>
        <div className="text-[11px] text-slate-500 truncate max-w-[220px]">
          {row.description || '—'}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-slate-600">
        <div>{row.driver || '—'}</div>
        <div className="text-[11px] text-slate-400">{row.from_site || '—'}</div>
      </td>
      <td className="px-3 py-2 text-right font-mono text-sm text-slate-800">
        {row.litres != null ? `${Number(row.litres).toFixed(2)} L` : '—'}
      </td>
      {/* v58.13.132au — SmartFill transaction id. */}
      <td
        className="px-3 py-2 font-mono text-[11px] text-slate-500"
        data-testid={`fuel-anomaly-txn-id-${row.id}`}
      >
        {row.transaction_id || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {flags.map((f, i) => {
            const meta = RULE_META[f.rule] || { label: f.rule, severity: f.severity };
            const resolved = !!f.resolved_at;
            return (
              <span
                key={`${f.rule}-${i}`}
                title={f.detail || meta.label}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                  resolved
                    ? 'bg-slate-100 text-slate-500 border-slate-200 line-through'
                    : SEVERITY_TONE[meta.severity] || SEVERITY_TONE.low
                }`}
                data-testid={`fuel-anomaly-flag-${row.id}-${f.rule}`}
              >
                {meta.label}
              </span>
            );
          })}
        </div>
      </td>
      <td className="px-3 py-2">
        <MatchPill status={row.match_status} />
      </td>
      {canEdit && (
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {openFlags.map((f) => (
              <React.Fragment key={f.rule}>
                <button
                  type="button"
                  onClick={() => onFlip(row, f.rule, 'resolve')}
                  data-testid={`fuel-anomaly-resolve-${row.id}-${f.rule}`}
                  title="Marks this flag as resolved — reversible via Undo toast"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 transition-colors"
                >
                  <CheckCircle2 size={12} /> Resolve
                </button>
                <button
                  type="button"
                  onClick={() => onFlip(row, f.rule, 'dismiss')}
                  data-testid={`fuel-anomaly-dismiss-${row.id}-${f.rule}`}
                  title="Dismisses this flag — reversible via Undo toast"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border bg-slate-600 hover:bg-slate-700 text-white border-slate-700 transition-colors"
                >
                  <XIcon size={12} /> Dismiss
                </button>
              </React.Fragment>
            ))}
            {unmatched && (
              <button
                type="button"
                onClick={onMatch}
                data-testid={`fuel-anomaly-match-${row.id}`}
                title="Manually attribute this transaction to a fleet asset"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border border-blue-300 text-blue-800 hover:bg-blue-50"
              >
                <Link2 size={10} /> Match
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

const MATCH_TONE = {
  matched:   'bg-emerald-100 text-emerald-800',
  manual:    'bg-violet-100 text-violet-800',
  unmatched: 'bg-amber-100 text-amber-800',
};

function MatchPill({ status }) {
  const s = status || 'unmatched';
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
        MATCH_TONE[s] || MATCH_TONE.unmatched
      }`}
    >
      {s}
    </span>
  );
}

// ─────────────────────────────────────────────────────────
function ManualMatchModal({ txn, onClose, onMatched }) {
  const [query, setQuery] = useState(
    txn?.description || txn?.registration || '',
  );
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!query.trim()) { setAssets([]); return; }
      setLoading(true);
      try {
        const r = await api.get('/fleet/register', {
          params: { search: query, limit: 20 },
        });
        if (!cancelled) setAssets(r.data?.items || []);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e) || 'Search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const pick = async (assetId) => {
    setSaving(true);
    try {
      await api.post(`/fleet/fuel/transactions/${txn.id}/match`, { asset_id: assetId });
      toast.success('Transaction attributed manually');
      onMatched?.();
    } catch (e) {
      toast.error(apiError(e) || 'Match failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/50 p-3"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose?.()}
      data-testid="fuel-anomaly-match-modal"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
              Manual attribution
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900">Match transaction to asset</h3>
            <p className="text-xs text-slate-500 mt-1">
              {txn.date_iso} · {txn.time_local} · {Number(txn.litres).toFixed(2)} L
              {' · '}
              <span className="font-mono">
                {txn.registration || txn.key_code || txn.card_number || 'no identifier'}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose?.()}
            data-testid="fuel-anomaly-match-close"
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
            aria-label="Close"
          >
            <XIcon size={14} />
          </button>
        </div>

        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fleet — rego, name, description…"
            data-testid="fuel-anomaly-match-search"
            autoFocus
            className="w-full pl-7 pr-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
        </div>

        <div
          className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100"
          data-testid="fuel-anomaly-match-results"
        >
          {loading && (
            <div className="p-3 text-xs text-slate-500">
              <Loader2 size={12} className="inline animate-spin mr-1" /> Searching…
            </div>
          )}
          {!loading && assets.length === 0 && (
            <div className="p-3 text-xs text-slate-400">No fleet assets matched.</div>
          )}
          {!loading && assets.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={saving}
              onClick={() => pick(a.id)}
              data-testid={`fuel-anomaly-match-pick-${a.id}`}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-blue-50 disabled:opacity-50"
            >
              <div>
                <div className="font-mono text-sm font-semibold text-slate-800">
                  {a.rego_serial || a.name}
                </div>
                <div className="text-[11px] text-slate-500 truncate max-w-[300px]">
                  {a.name} · <span className="capitalize">{a.kind}</span>
                </div>
              </div>
              <span className="text-[10px] font-bold text-blue-700">Match →</span>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => !saving && onClose?.()}
            data-testid="fuel-anomaly-match-cancel"
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// v58.13.132bs — Bulk-attribute modal. Reuses the same debounced
// fleet-register search as ManualMatchModal but attributes the
// entire current selection to whichever vehicle is picked.
function BulkAttributeModal({ count, onPick, onClose, saving }) {
  const [query, setQuery] = useState('');
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!query.trim()) { setAssets([]); return; }
      setLoading(true);
      try {
        const r = await api.get('/fleet/register', {
          params: { search: query, limit: 20 },
        });
        if (!cancelled) setAssets(r.data?.items || []);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e) || 'Search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/50 p-3"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose?.()}
      data-testid="fuel-anomaly-bulk-attribute-modal"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
              Bulk attribution
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900">
              Attribute {count} transaction{count === 1 ? '' : 's'} to a vehicle
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Every selected transaction will be reassigned to the chosen
              vehicle. Not directly reversible via Undo — pick carefully.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose?.()}
            data-testid="fuel-anomaly-bulk-attribute-close"
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
            aria-label="Close"
          >
            <XIcon size={14} />
          </button>
        </div>

        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fleet — rego, name, description…"
            data-testid="fuel-anomaly-bulk-attribute-search"
            autoFocus
            className="w-full pl-7 pr-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
          />
        </div>

        <div
          className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100"
          data-testid="fuel-anomaly-bulk-attribute-results"
        >
          {loading && (
            <div className="p-3 text-xs text-slate-500">
              <Loader2 size={12} className="inline animate-spin mr-1" /> Searching…
            </div>
          )}
          {!loading && assets.length === 0 && (
            <div className="p-3 text-xs text-slate-400">
              {query.trim() ? 'No fleet assets matched.' : 'Type to search the fleet.'}
            </div>
          )}
          {!loading && assets.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={saving}
              onClick={() => onPick?.(a.id)}
              data-testid={`fuel-anomaly-bulk-attribute-pick-${a.id}`}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-indigo-50 disabled:opacity-50"
            >
              <div>
                <div className="font-mono text-sm font-semibold text-slate-800">
                  {a.rego_serial || a.name}
                </div>
                <div className="text-[11px] text-slate-500 truncate max-w-[300px]">
                  {a.name} · <span className="capitalize">{a.kind}</span>
                </div>
              </div>
              <span className="text-[10px] font-bold text-indigo-700">Attribute {count} →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

