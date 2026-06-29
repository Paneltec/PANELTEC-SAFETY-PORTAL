// Phase 3.16 Part B — Session Timeout admin card.
//
// Drops into Settings → System (admin-only). Surfaces every knob exposed by
// `GET/PUT /api/admin/settings/session-timeout` and the danger button
// `POST /api/admin/settings/force-logout-all`.
//
// Layout note: a single rounded-2xl card that opens with a Clock icon and
// title, then a vertical stack of grouped controls. Per-role overrides
// collapse into a sub-section so the default closed state stays calm — the
// average admin only wants the org-wide idle / absolute / remember-me
// toggles. Everything is dirty-tracked locally; "Save changes" disables
// until there's an actual diff to send.
import { useEffect, useMemo, useState } from 'react';
import {
  Clock, ShieldAlert, Loader2, AlertTriangle, Save, KeyRound,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import { signOut } from '../../lib/auth';

const IDLE_OPTIONS = [
  { v: 15,  l: '15 minutes' },
  { v: 30,  l: '30 minutes' },
  { v: 60,  l: '1 hour' },
  { v: 120, l: '2 hours' },
  { v: 240, l: '4 hours' },
  { v: 480, l: '8 hours' },
];
const ABS_OPTIONS = [
  { v: 4,  l: '4 hours' },
  { v: 8,  l: '8 hours' },
  { v: 12, l: '12 hours' },
  { v: 24, l: '24 hours' },
  { v: 72, l: '72 hours (3 days)' },
];
const WARNING_OPTIONS = [
  { v: 15,  l: '15 seconds' },
  { v: 30,  l: '30 seconds' },
  { v: 60,  l: '1 minute' },
  { v: 120, l: '2 minutes' },
];

const ROLES = [
  ['admin',      'Admin'],
  ['manager',    'Manager'],
  ['hseq_lead',  'HSEQ Lead'],
  ['auditor',    'Auditor'],
  ['supervisor', 'Supervisor'],
  ['worker',     'Worker'],
];

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export default function SessionTimeoutCard() {
  const [loading, setLoading] = useState(true);
  const [original, setOriginal] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);
  const [confirmForceLogout, setConfirmForceLogout] = useState(false);
  const [forcing, setForcing] = useState(false);

  const dirty = useMemo(
    () => original && draft && !deepEqual(original, draft),
    [original, draft],
  );

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/settings/session-timeout');
      setOriginal(data); setDraft(JSON.parse(JSON.stringify(data)));
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setRole = (role, k, v) => setDraft((d) => ({
    ...d,
    per_role_overrides: {
      ...d.per_role_overrides,
      [role]: { ...(d.per_role_overrides?.[role] || {}), [k]: v },
    },
  }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        idle_timeout_minutes:      draft.idle_timeout_minutes,
        absolute_timeout_hours:    draft.absolute_timeout_hours,
        warning_modal_enabled:     draft.warning_modal_enabled,
        warning_modal_seconds:     draft.warning_modal_seconds,
        per_role_overrides_enabled: draft.per_role_overrides_enabled,
        per_role_overrides:        draft.per_role_overrides,
        remember_me_enabled:       draft.remember_me_enabled,
      };
      const { data } = await api.put('/admin/settings/session-timeout', payload);
      setOriginal(data); setDraft(JSON.parse(JSON.stringify(data)));
      toast.success('Session timeout settings saved.');
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  const runForceLogout = async () => {
    setForcing(true);
    try {
      const { data } = await api.post('/admin/settings/force-logout-all');
      toast.success(
        `${data.users_revoked} user${data.users_revoked === 1 ? '' : 's'} signed out · ` +
        `${data.sessions_wiped} active session${data.sessions_wiped === 1 ? '' : 's'} wiped.`,
      );
      // Caller (admin) is included — sign them out cleanly client-side.
      setTimeout(() => signOut().finally(() => { window.location.href = '/login'; }), 600);
    } catch (e) {
      toast.error(apiError(e));
      setForcing(false);
      setConfirmForceLogout(false);
    }
  };

  if (loading || !draft) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="session-timeout-card-loading">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Loading session timeout settings…
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="session-timeout-card">
      <header className="flex items-start gap-3 mb-4">
        <div className="rounded-xl bg-blue-50 p-2 text-blue-700"><Clock size={18} /></div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-slate-900 inline-flex items-center gap-2">
            Session timeout
            <span className="text-[10px] uppercase tracking-wider font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Admin</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Controls how long inactive sessions stay alive across the org. Workers
            and field roles can stay logged in longer than office roles via
            per-role overrides.
          </p>
        </div>
      </header>

      {/* ── Org-wide defaults ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Idle timeout (no activity)" testid="idle-timeout-field" sub="After this idle window, the user is logged out.">
          <select value={draft.idle_timeout_minutes} onChange={(e) => set('idle_timeout_minutes', Number(e.target.value))}
            data-testid="idle-timeout-select"
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30">
            {IDLE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </Field>
        <Field label="Absolute timeout (max lifetime)" testid="absolute-timeout-field" sub="Hard cap regardless of activity. JWT cannot live past this.">
          <select value={draft.absolute_timeout_hours} onChange={(e) => set('absolute_timeout_hours', Number(e.target.value))}
            data-testid="absolute-timeout-select"
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30">
            {ABS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </Field>
      </div>

      {/* ── Warning modal ── */}
      <div className="mt-4 rounded-xl border border-slate-200 p-3.5 bg-slate-50/50">
        <Toggle
          testid="warning-modal-toggle"
          checked={!!draft.warning_modal_enabled}
          onChange={(v) => set('warning_modal_enabled', v)}
          label="Show warning modal before auto-logout"
          sub="Gives users a chance to stay signed in by clicking 'Keep working'."
        />
        {draft.warning_modal_enabled && (
          <div className="mt-3 pl-7">
            <Field label="Warning lead time" testid="warning-seconds-field" inline>
              <select value={draft.warning_modal_seconds} onChange={(e) => set('warning_modal_seconds', Number(e.target.value))}
                data-testid="warning-seconds-select"
                className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg">
                {WARNING_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </Field>
          </div>
        )}
      </div>

      {/* ── Remember me ── */}
      <div className="mt-4 rounded-xl border border-slate-200 p-3.5 bg-slate-50/50">
        <Toggle
          testid="remember-me-toggle"
          checked={!!draft.remember_me_enabled}
          onChange={(v) => set('remember_me_enabled', v)}
          label="Allow 'Keep me logged in' on the login page"
          sub="Workers using shared kiosks should keep this OFF. When ON, ticking the box at sign-in extends the idle window to 30 days."
        />
      </div>

      {/* ── Per-role overrides ── */}
      <div className="mt-4 rounded-xl border border-slate-200">
        <button
          type="button"
          onClick={() => setShowOverrides((s) => !s)}
          data-testid="toggle-role-overrides"
          className="w-full flex items-center justify-between px-3.5 py-3 text-left hover:bg-slate-50">
          <div>
            <div className="text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
              <KeyRound size={14} className="text-slate-500" /> Per-role overrides
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Different timeouts for workers, admins, supervisors, etc.</div>
          </div>
          <Toggle
            testid="per-role-overrides-toggle"
            checked={!!draft.per_role_overrides_enabled}
            onChange={(v) => set('per_role_overrides_enabled', v)}
            stopPropagation
          />
        </button>
        {showOverrides && draft.per_role_overrides_enabled && (
          <div className="border-t border-slate-200 p-3.5 grid gap-2.5" data-testid="role-overrides-matrix">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center text-[10px] uppercase tracking-wider text-slate-500 font-bold px-1">
              <div>Role</div>
              <div className="w-32 text-right">Idle (min)</div>
              <div className="w-32 text-right">Absolute (hr)</div>
            </div>
            {ROLES.map(([key, label]) => {
              const rc = draft.per_role_overrides?.[key] || {};
              return (
                <div key={key} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center" data-testid={`role-row-${key}`}>
                  <div className="text-sm text-slate-700">{label}</div>
                  <input
                    type="number" min={5} value={rc.idle_minutes ?? ''}
                    onChange={(e) => setRole(key, 'idle_minutes', Number(e.target.value) || undefined)}
                    data-testid={`role-${key}-idle`}
                    className="w-32 px-2 py-1.5 text-sm text-right border border-slate-300 rounded-lg" />
                  <input
                    type="number" min={1} value={rc.absolute_hours ?? ''}
                    onChange={(e) => setRole(key, 'absolute_hours', Number(e.target.value) || undefined)}
                    data-testid={`role-${key}-absolute`}
                    className="w-32 px-2 py-1.5 text-sm text-right border border-slate-300 rounded-lg" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Save bar ── */}
      <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
        <div className="text-xs text-slate-500">
          {dirty ? <span className="text-amber-700 font-semibold">Unsaved changes</span> : <span>All synced.</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft(JSON.parse(JSON.stringify(original)))}
            disabled={!dirty || saving}
            data-testid="session-timeout-reset"
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Reset
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            data-testid="session-timeout-save"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save changes
          </button>
        </div>
      </div>

      {/* ── Danger zone ── */}
      <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50/40 p-4" data-testid="danger-zone">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-rose-100 p-2 text-rose-700"><ShieldAlert size={16} /></div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-rose-900">Force logout all sessions</div>
            <p className="text-xs text-rose-800/80 mt-0.5">
              Immediately revokes every active session across the org — including
              yours. Use after credential rotation or a suspected token leak.
            </p>
            {!confirmForceLogout ? (
              <button
                type="button"
                onClick={() => setConfirmForceLogout(true)}
                data-testid="force-logout-start"
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 bg-white text-xs font-bold text-rose-700 hover:bg-rose-50">
                <AlertTriangle size={12} /> Force logout everyone
              </button>
            ) : (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-rose-900">Are you sure? You will be signed out too.</span>
                <button
                  type="button"
                  onClick={runForceLogout}
                  disabled={forcing}
                  data-testid="force-logout-confirm"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-60">
                  {forcing ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />} Yes, sign everyone out
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmForceLogout(false)}
                  disabled={forcing}
                  data-testid="force-logout-cancel"
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, sub, testid, inline, children }) {
  return (
    <label className={inline ? 'inline-flex items-center gap-3' : 'block'} data-testid={testid}>
      <span className={inline ? '' : 'block'}>
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        {sub && <span className="block text-[11px] text-slate-500 mt-0.5">{sub}</span>}
      </span>
      <span className={inline ? '' : 'block mt-1.5'}>{children}</span>
    </label>
  );
}

function Toggle({ checked, onChange, label, sub, testid, stopPropagation }) {
  const handle = (e) => {
    if (stopPropagation) { e.stopPropagation(); }
    onChange(!checked);
  };
  return (
    <div className="flex items-start gap-3" onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={handle}
        data-testid={testid}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors mt-0.5 ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      {label && (
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800">{label}</div>
          {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
        </div>
      )}
    </div>
  );
}
