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
  CheckCircle2, X as XIcon, Search, Filter, Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { useCan } from '../lib/permissions';

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
      toast.success(`${action === 'resolve' ? 'Resolved' : 'Dismissed'} · ${RULE_META[ruleKey]?.label || ruleKey}`);
      reload();
    } catch (e) {
      toast.error(apiError(e) || `${action} failed`);
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
        className="rounded-2xl border border-slate-200 bg-white p-3 flex flex-wrap gap-2 items-center"
        data-testid="fuel-anomaly-filters"
      >
        <div className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
          <Filter size={12} /> Status
        </div>
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
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
              status === opt.key
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {opt.label}
          </button>
        ))}

        <div className="mx-2 h-5 border-l border-slate-200" />

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

      {/* ── Table ───────────────────────────────────────── */}
      <div
        className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
        data-testid="fuel-anomaly-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Vehicle</th>
                <th className="px-3 py-2 text-left">Driver / Site</th>
                <th className="px-3 py-2 text-right">Litres</th>
                <th className="px-3 py-2 text-left">Anomaly rules</th>
                <th className="px-3 py-2 text-left">Match</th>
                {canEdit && <th className="px-3 py-2 text-left w-40">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-3 py-8 text-center text-slate-400">
                    <Loader2 className="inline animate-spin" size={14} /> Loading anomalies…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-3 py-10 text-center text-slate-400">
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
                  onFlip={flip}
                  onMatch={() => setMatchingTx(r)}
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function AnomalyRow({ row, canEdit, onFlip, onMatch }) {
  const flags = (row.anomaly_flags || []).filter((f) => f?.rule);
  const openFlags = flags.filter((f) => !f.resolved_at);
  const unmatched = row.match_status === 'unmatched';
  return (
    <tr data-testid={`fuel-anomaly-row-${row.id}`} className="hover:bg-slate-50">
      <td className="px-3 py-2 text-xs font-mono text-slate-700 whitespace-nowrap">
        {row.date_iso}
        <span className="text-slate-400"> · </span>
        {row.time_local}
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
                  title={`Resolve · ${RULE_META[f.rule]?.label || f.rule}`}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                >
                  <CheckCircle2 size={10} /> Resolve
                </button>
                <button
                  type="button"
                  onClick={() => onFlip(row, f.rule, 'dismiss')}
                  data-testid={`fuel-anomaly-dismiss-${row.id}-${f.rule}`}
                  title={`Dismiss · ${RULE_META[f.rule]?.label || f.rule}`}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  <XIcon size={10} /> Dismiss
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
