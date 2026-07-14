// Phase 3.18 — Active Sessions panel inside the Session Timeout card.
// v160.3.0-adjust-5 — Swapped "Revoke" icon to red Trash2, wrapped in AlertDialog.
// v160.3.6v — Added the v6d selection pattern: master checkbox on the header row,
// per-row checkboxes, a floating "N selected · 🗑 Delete selected" action bar and
// a confirm modal that calls POST /admin/active-sessions/bulk-revoke.
//
// The user's own current session is:
//   • rendered with the "You" pill
//   • not selectable via the master checkbox (excluded from "select all visible")
//   • its per-row checkbox is disabled
//   • server-side ALSO filters it out defensively, so even if a stale UI selection
//     reaches the endpoint the caller can never nuke themselves.

import { useEffect, useState } from 'react';
import { Trash2, RefreshCw, Loader2, Users, Timer } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import { RUNNING_VERSION } from '../../lib/version';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from '../ui/alert-dialog';

const ROLE_BADGE = {
  admin:      'bg-violet-100 text-violet-700',
  hseq_lead:  'bg-blue-100 text-blue-700',
  manager:    'bg-blue-100 text-blue-700',
  supervisor: 'bg-emerald-100 text-emerald-700',
  worker:     'bg-amber-100 text-amber-700',
  auditor:    'bg-slate-200 text-slate-700',
};

function relTime(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60)        return `${s}s ago`;
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ActiveSessionsPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyJti, setBusyJti] = useState(null);
  const [confirmRow, setConfirmRow] = useState(null);
  const [nowTick, setNowTick] = useState(0);

  // v160.3.6v — selection state
  const [selected, setSelected] = useState(() => new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // v160.3.7e — "Purge inactive > 24h" state
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [purgePreview, setPurgePreview] = useState(null);   // { would_purge, cutoff }
  const [purgeBusy, setPurgeBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/admin/active-sessions');
      const next = data.sessions || [];
      setRows(next);
      // v160.3.6v — prune any selected jtis that no longer exist
      const visibleJtis = new Set(next.map((r) => r.jti));
      setSelected((prev) => {
        const kept = new Set();
        prev.forEach((jti) => { if (visibleJtis.has(jti)) kept.add(jti); });
        return kept.size === prev.size ? prev : kept;
      });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const refresh = setInterval(load, 30000);
    const tick = setInterval(() => setNowTick((n) => n + 1), 15000);
    return () => { clearInterval(refresh); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  void nowTick;

  const doRevoke = async (row) => {
    setBusyJti(row.jti);
    try {
      await api.delete(`/admin/active-sessions/${row.jti}`);
      toast.success(`${row.user_name}'s session revoked.`);
      setRows((rs) => rs.filter((r) => r.jti !== row.jti));
      setSelected((prev) => {
        if (!prev.has(row.jti)) return prev;
        const next = new Set(prev);
        next.delete(row.jti);
        return next;
      });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusyJti(null);
      setConfirmRow(null);
    }
  };

  // v160.3.6v — selection helpers (mirrors the Outbox v6d pattern)
  const selectableRows = rows.filter((r) => !r.is_current_session);
  const selectableJtis = selectableRows.map((r) => r.jti);
  const allSelected = selectableJtis.length > 0 && selectableJtis.every((jti) => selected.has(jti));
  const someSelected = !allSelected && selectableJtis.some((jti) => selected.has(jti));

  const toggleRow = (jti) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jti)) next.delete(jti); else next.add(jti);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (selectableJtis.every((jti) => next.has(jti))) {
        selectableJtis.forEach((jti) => next.delete(jti));
      } else {
        selectableJtis.forEach((jti) => next.add(jti));
      }
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const doBulkRevoke = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setBulkBusy(true);
    try {
      const { data } = await api.post('/admin/active-sessions/bulk-revoke', { ids });
      const revoked = data?.revoked || 0;
      const notFound = data?.not_found?.length || 0;
      let msg = `${revoked} session${revoked === 1 ? '' : 's'} revoked`;
      if (notFound > 0) msg += ` · ${notFound} already gone`;
      if (data?.skipped_self) msg += ' · your own session was skipped';
      toast.success(msg);
      setBulkConfirmOpen(false);
      clearSelection();
      await load();
    } catch (e) {
      toast.error(apiError(e) || 'Bulk revoke failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const selfInSelection = rows.some(
    (r) => r.is_current_session && selected.has(r.jti),
  );

  // v160.3.7e — Purge inactive > 24h. Opens confirm with a preview count.
  const openPurge = async () => {
    setPurgeConfirmOpen(true);
    setPurgePreview(null);
    try {
      const { data } = await api.get('/admin/active-sessions/purge-inactive/preview?older_than_hours=24');
      setPurgePreview(data);
    } catch (e) {
      toast.error(apiError(e) || 'Preview failed');
    }
  };
  const doPurge = async () => {
    setPurgeBusy(true);
    try {
      const { data } = await api.post('/admin/active-sessions/purge-inactive', { older_than_hours: 24 });
      toast.success(`${data?.purged || 0} inactive session${data?.purged === 1 ? '' : 's'} purged.`);
      setPurgeConfirmOpen(false);
      setPurgePreview(null);
      clearSelection();
      await load();
    } catch (e) {
      toast.error(apiError(e) || 'Purge failed');
    } finally {
      setPurgeBusy(false);
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-white" data-testid="active-sessions-panel">
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-slate-200 bg-slate-50/60">
        <div className="flex items-center gap-2 min-w-0">
          {/* v160.3.6v — master checkbox lives in the header, next to the title */}
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            onChange={toggleAll}
            disabled={selectableJtis.length === 0}
            aria-label={allSelected ? 'Deselect all visible sessions' : 'Select all revocable sessions'}
            data-testid="active-sessions-select-all"
            className="w-3.5 h-3.5 mr-1 cursor-pointer disabled:opacity-40"
          />
          <div className="rounded-lg bg-violet-100 p-1.5 text-violet-700"><Users size={14} /></div>
          <div>
            <div className="text-sm font-bold text-slate-900">Active sessions</div>
            <div className="text-[11px] text-slate-500">
              {loading ? 'Loading…' : `${rows.length} live session${rows.length === 1 ? '' : 's'} · auto-refreshes every 30s`}
              {' · '}
              {/* v160.3.7f — Visible bundle-version chip so a stale-cache
                  browser is obvious. If a user reports a bug and this chip
                  shows an older version than the backend, they need a hard
                  refresh before we chase server bugs. */}
              <span
                data-testid="active-sessions-bundle-version"
                title="Frontend bundle version — hard-refresh if this is behind the backend"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                {RUNNING_VERSION}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button" onClick={() => { setLoading(true); load(); }}
          disabled={loading}
          data-testid="active-sessions-refresh"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
        </button>
        {/* v160.3.7e — Purge inactive > 24h. Safe for anyone active. */}
        <button
          type="button"
          onClick={openPurge}
          disabled={loading || purgeBusy}
          title="Deletes all sessions with no activity in the last 24 hours — safe for anyone actively signed in"
          data-testid="active-sessions-purge-inactive-btn"
          className="ml-1.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Timer size={11} /> Purge inactive &gt; 24h
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="px-3.5 py-6 text-center text-xs text-slate-500" data-testid="active-sessions-loading">
          <Loader2 size={14} className="animate-spin inline mr-1.5" /> Loading sessions…
        </div>
      ) : rows.length === 0 ? (
        <div className="px-3.5 py-6 text-center text-xs text-slate-500" data-testid="active-sessions-empty">
          No active sessions found. (Workers signed in via Simpro Login also land here.)
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => {
            const isSelected = selected.has(r.jti);
            return (
              <li key={r.jti}
                  className={`px-3.5 py-2.5 flex items-center gap-3 ${isSelected ? 'bg-[#e6eff9]/40' : ''}`}
                  data-testid={`session-row-${r.jti}`}>
                {/* v160.3.6v — per-row checkbox */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleRow(r.jti)}
                  disabled={r.is_current_session}
                  aria-label={r.is_current_session
                    ? 'Your current session — cannot be selected for revoke'
                    : `Select ${r.user_name}'s session`}
                  data-testid={`session-select-${r.jti}`}
                  onClick={(e) => e.stopPropagation()}
                  className="w-3.5 h-3.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate inline-flex items-center gap-1.5">
                    {r.user_name}
                    {r.is_current_session && (
                      <span className="text-[9px] uppercase tracking-wider font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">You</span>
                    )}
                    {r.remember_me && (
                      <span className="text-[9px] uppercase tracking-wider font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded" title="Remember me enabled (30 day idle)">Remember</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{r.user_email}</div>
                </div>
                <div className="hidden sm:block">
                  <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${ROLE_BADGE[r.role] || 'bg-slate-100 text-slate-700'}`}>
                    {r.role || 'user'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 w-20 text-right" title={r.last_activity_at || ''}>
                  {relTime(r.last_activity_at)}
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmRow(r)}
                  disabled={r.is_current_session || busyJti === r.jti}
                  title={r.is_current_session
                    ? 'This is your current session'
                    : 'Revoke this session'}
                  data-testid={`revoke-session-${r.jti}`}
                  aria-label={`Revoke ${r.user_name}'s session`}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-colors disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-rose-600 disabled:hover:border-rose-200">
                  {busyJti === r.jti ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* v160.3.6v — floating selection action bar (Outbox v6d pattern) */}
      {selected.size > 0 && (
        <div
          role="region"
          aria-label="Bulk actions for selected sessions"
          data-testid="active-sessions-selection-bar"
          className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4 pointer-events-none"
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-slate-200 bg-white shadow-xl px-5 py-3">
            <span className="text-sm font-semibold text-slate-900" data-testid="active-sessions-selection-count">
              {selected.size} selected
            </span>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs font-medium text-slate-600 hover:text-slate-900"
              data-testid="active-sessions-selection-clear"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setBulkConfirmOpen(true)}
              data-testid="active-sessions-selection-delete"
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold uppercase tracking-wider px-4 py-2"
            >
              <Trash2 size={13} /> Delete selected (Revoke sessions)
            </button>
          </div>
        </div>
      )}

      {/* Single-row revoke confirmation (existing) */}
      <AlertDialog open={!!confirmRow} onOpenChange={(open) => !open && setConfirmRow(null)}>
        <AlertDialogContent data-testid="revoke-session-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRow && (
                <>
                  <span className="block font-medium text-slate-900 mb-2">
                    {confirmRow.user_name} · {confirmRow.user_email}
                  </span>
                  The user will be logged out immediately on their next request.
                  Any unsaved work in that session will be lost.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={!!busyJti}
              data-testid="revoke-session-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRow && doRevoke(confirmRow)}
              disabled={!!busyJti}
              data-testid="revoke-session-confirm"
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600">
              {busyJti ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Trash2 size={14} className="mr-1.5" />}
              Revoke session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* v160.3.6v — Bulk-revoke confirmation */}
      <AlertDialog open={bulkConfirmOpen} onOpenChange={(o) => { if (!o && !bulkBusy) setBulkConfirmOpen(false); }}>
        <AlertDialogContent data-testid="active-sessions-bulk-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke {selected.size} selected session{selected.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each selected user will be logged out on their next request. Any
              unsaved work in those sessions will be lost.
              {selfInSelection && (
                <span className="mt-3 block rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" data-testid="active-sessions-bulk-self-warning">
                  Your own current session is in the selection — the server will
                  skip it so you stay signed in.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy} data-testid="active-sessions-bulk-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doBulkRevoke}
              disabled={bulkBusy || selected.size === 0}
              data-testid="active-sessions-bulk-confirm"
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600">
              {bulkBusy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Trash2 size={14} className="mr-1.5" />}
              Revoke {selected.size}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* v160.3.7e — Purge inactive > 24h confirm */}
      <AlertDialog open={purgeConfirmOpen} onOpenChange={(o) => { if (!o && !purgeBusy) { setPurgeConfirmOpen(false); setPurgePreview(null); } }}>
        <AlertDialogContent data-testid="active-sessions-purge-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Purge inactive sessions</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete every session whose last activity is
              older than <strong>24 hours</strong>. Active users won&apos;t be
              affected. Your own session is excluded automatically.
              <span className="mt-3 block rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" data-testid="active-sessions-purge-preview">
                {purgePreview === null ? (
                  <>
                    <Loader2 size={12} className="inline animate-spin mr-1.5" />
                    Calculating impact…
                  </>
                ) : (
                  <>
                    <strong className="tabular-nums">{purgePreview.would_purge}</strong>{' '}
                    session{purgePreview.would_purge === 1 ? '' : 's'} qualify for purge.
                    <span className="block text-[10px] text-slate-500 mt-0.5">
                      Cutoff: {new Date(purgePreview.cutoff).toLocaleString()}
                    </span>
                  </>
                )}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgeBusy} data-testid="active-sessions-purge-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doPurge}
              disabled={purgeBusy || purgePreview === null || purgePreview.would_purge === 0}
              data-testid="active-sessions-purge-confirm"
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600">
              {purgeBusy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Trash2 size={14} className="mr-1.5" />}
              {purgePreview === null ? 'Purge' : `Purge ${purgePreview.would_purge} session${purgePreview.would_purge === 1 ? '' : 's'}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
