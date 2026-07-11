// Phase 3.18 — Active Sessions panel inside the Session Timeout card.
// v160.3.0-adjust-5 — Swapped the "Revoke" icon from `LogOut` to a red
// `Trash2` to match the user's mental model ("delete this session")
// and the delete-icon language used elsewhere in the app. Wrapped the
// revoke action in an AlertDialog confirmation so a mis-click can't
// silently log a colleague out mid-shift.
//
// Lists every live session in the org with name, role, last-activity (relative
// time), and a Revoke button. Auto-refreshes every 30s so an admin can watch
// a force-logout-all take effect, or confirm a worker has signed out after
// finishing a shift. The "current session" row is non-revokable (revoking
// yourself is what "Force logout all" is for).
import { useEffect, useState } from 'react';
import { Trash2, RefreshCw, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
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

  const load = async () => {
    try {
      const { data } = await api.get('/admin/active-sessions');
      setRows(data.sessions || []);
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
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusyJti(null);
      setConfirmRow(null);
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-white" data-testid="active-sessions-panel">
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-slate-200 bg-slate-50/60">
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded-lg bg-violet-100 p-1.5 text-violet-700"><Users size={14} /></div>
          <div>
            <div className="text-sm font-bold text-slate-900">Active sessions</div>
            <div className="text-[11px] text-slate-500">
              {loading ? 'Loading…' : `${rows.length} live session${rows.length === 1 ? '' : 's'} · auto-refreshes every 30s`}
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
          {rows.map((r) => (
            <li key={r.jti} className="px-3.5 py-2.5 flex items-center gap-3" data-testid={`session-row-${r.jti}`}>
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
          ))}
        </ul>
      )}

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
    </div>
  );
}
