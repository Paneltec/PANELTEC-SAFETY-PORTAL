import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Check, X as XIcon, Minus, RotateCcw, ShieldCheck, Save, Mail, Download, Loader2, AlertCircle, Search as SearchIcon, LogOut, Trash2, KeyRound, AlertTriangle, Pencil, Sparkles, Wand2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
// Phase 3.20 Wave 1 — row-action + toolbar icons migrated to Fluent.
// 20-pixel Regular variant for actions, matching the spec.
import {
  Key20Regular as FlKey,
  Edit20Regular as FlEdit,
  SignOut20Regular as FlSignOut,
  Delete20Regular as FlDelete,
  Mail20Regular as FlMail,
  PersonAdd20Regular as FlPersonAdd,
  ArrowDownload20Regular as FlDownload,
} from '@fluentui/react-icons';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader } from '../components/capture/Ui';
import SimproImportPickerModal from '../components/simpro/SimproImportPickerModal';
import HowThisWorks from '../components/help/HowThisWorks';
// Phase 4.17 v134.2 — Dashboard/List tabs.
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import ModuleDashboard from '../components/dashboards/ModuleDashboard';
import { RESOURCE_LABELS, EMAIL_SUPPORTED, TEAM_VIEW_SUPPORTED, useCan } from '../lib/permissions';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
// Phase 4.7 — admin access controls (invite / PIN / reset / unlock).
import AccessSection from '../components/auth/AccessSection';
import AccessKebab from '../components/auth/AccessKebab';
// v160.3.9.32-4c.1 — BulkSimproZipModal import removed; button rehomed to /workers page header.
// v160.3.7i — SimproZipImportGuide has been rehomed to its own page
// (`/app/settings/help/simpro-import`). It previously rendered inline
// here and broke the Users & Permissions layout. A subtle text link
// pointing to the dedicated guide now sits above the Bulk import ZIPs
// action in the page header.
import { Link } from 'react-router-dom';
// v160.3.7h — Shared body-scroll-lock hook. Applied to every overlay on
// this page so scrolling inside a modal never leaks to the page beneath.
import useLockBodyScroll from '../lib/useLockBodyScroll';

// v160.3.9.29-2a — Live-fetched system role catalogue replaces the
// hard-coded ROLES array. See Phase 3c sub-phase 2a scope in
// `/app/memory/permissions_redesign/09_frontend_gate_sweep.md` §4 row 8.
// LEGACY_ROLES stays as a fallback so this page keeps functioning if
// `/api/admin/roles` is unavailable — the 5 originals stayed assignable.
const LEGACY_ROLES = [
    // v160.3.9.30 — Phase 3d: contractor roles activated. LEGACY_ROLES
    // fallback still uses names without "not yet available"; the live
    // fetch merges the seeded roles which now carry `is_active=true`.
    { role_id: 'admin',      name: 'Admin',      is_active: true, source: 'legacy' },
    { role_id: 'hseq_lead',  name: 'HSEQ Lead',  is_active: true, source: 'legacy' },
    { role_id: 'supervisor', name: 'Supervisor', is_active: true, source: 'legacy' },
    { role_id: 'worker',     name: 'Worker',     is_active: true, source: 'legacy' },
    { role_id: 'auditor',    name: 'Auditor',    is_active: true, source: 'legacy' },
];

// Module-level cache so parallel <useSystemRoles> calls in sibling
// components share one HTTP round-trip (drawer + invite panel + bulk
// modal all mount on the same page).
let _rolesCache = null;
function useSystemRoles() {
  const [roles, setRoles] = useState(_rolesCache || LEGACY_ROLES);
  const [loading, setLoading] = useState(!_rolesCache);
  useEffect(() => {
    if (_rolesCache) return;
    let alive = true;
    api.get('/admin/roles').then(({ data }) => {
      if (!alive) return;
      const seeded = (data?.roles || []).map((r) => ({
        role_id: r.role_id,
        name: r.name || r.role_id,
        is_active: r.is_active !== false,
        source: 'seed',
      }));
      const byId = new Map();
      for (const r of LEGACY_ROLES) byId.set(r.role_id, r);
      for (const r of seeded) byId.set(r.role_id, r);   // seed wins on collision
      const merged = Array.from(byId.values()).sort((a, b) => a.role_id.localeCompare(b.role_id));
      _rolesCache = merged;
      setRoles(merged);
      setLoading(false);
    }).catch(() => {
      if (!alive) return;
      setLoading(false);   // silent fallback to LEGACY_ROLES
    });
    return () => { alive = false; };
  }, []);
  return { roles, loading };
}

// Kept for backward compat while sub-phase 2b/2c files still reference
// these arrays. Prefer `useSystemRoles()` for anything new.
const ROLES = LEGACY_ROLES.map((r) => r.role_id);
const ROLE_LABELS = Object.fromEntries(LEGACY_ROLES.map((r) => [r.role_id, r.name]));
const STATUSES = ['active', 'invited', 'disabled'];
const STATUS_LABELS = { active: 'Active', invited: 'Invited', disabled: 'Disabled' };
const ACTIONS = ['open', 'view', 'edit', 'email'];
const RESOURCES = Object.keys(RESOURCE_LABELS);


// v160.3.2 — small "6h ago" / "3d ago" formatter for the Simpro last-sync pill
function relativeTime(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function StatusPill({ user }) {
  // Phase 4.7.2 — derive from (status, invite_pending, is_locked) so the
  // pill reflects the current auth state immediately after admin actions
  // (Send invite / Unlock) without the persisted `status` field needing
  // to flip. Backend exposes these flags via `/api/users` (_user_out).
  const status = user?.status || 'active';
  let key = status, label = status;
  if (user?.is_locked) { key = 'locked'; label = 'Locked'; }
  else if (user?.invite_pending && status !== 'disabled') { key = 'invited'; label = 'Invite pending'; }
  else if (status === 'invited') { label = 'Invited'; }
  else if (status === 'disabled') { label = 'Disabled'; }
  else { label = 'Active'; }
  const map = {
    active:   'bg-emerald-100 text-emerald-800',
    invited:  'bg-amber-100 text-amber-800',
    locked:   'bg-rose-100 text-rose-800',
    disabled: 'bg-slate-200 text-slate-600',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${map[key] || 'bg-slate-100'}`}>{label}</span>;
}

function inviteMailtoHref(user) {
  const loginUrl = `${window.location.origin}/`;
  const subject = 'Welcome to Paneltec Civil';
  const body = [
    `Hi ${user.name || ''},`,
    '',
    `You have been invited to join Paneltec Civil as a ${user.role}.`,
    '',
    'Sign in here to set your password and start using the platform:',
    loginUrl,
    '',
    'If you have any questions, just reply to this email.',
    '',
    '— Paneltec Civil',
  ].join('\n');
  return `mailto:${user.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function ConfirmActionModal({ kind, user, busy, onConfirm, onClose }) {
  // v160.3.7h — lock body scroll while this confirm is open so the page
  // underneath (Users list) doesn't scroll and steal focus from the modal.
  useLockBodyScroll();
  const isDelete = kind === 'delete';
  const title = isDelete ? `Delete ${user.name || user.email}?` : `Force sign-out ${user.name || user.email}?`;
  const body = isDelete
    ? 'They will lose access immediately and their active sessions will be revoked. This is a soft-delete — an admin can restore the account from Mongo. SWMS sign-offs, sign-ons and audit records authored by this user are preserved.'
    : "They'll be signed out everywhere and need to sign in again. Their account, role and permissions are unchanged.";
  const cta = isDelete ? 'Delete user' : 'Sign them out';
  const ctaClass = isDelete
    ? 'bg-rose-600 hover:bg-rose-700'
    : 'bg-amber-600 hover:bg-amber-700';

  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);

  return (
    <div
      data-testid={isDelete ? 'user-delete-modal' : 'user-signout-modal'}
      className="fixed inset-0 z-[70] bg-slate-900/70 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose?.()}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
          <div className={`inline-flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 ${isDelete ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-slate-900 truncate">{title}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{user.email} · {user.role}</p>
          </div>
        </div>
        <div className="px-5 py-4 text-sm text-slate-700 leading-relaxed">{body}</div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            data-testid={isDelete ? 'user-delete-cancel' : 'user-signout-cancel'}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            data-testid={isDelete ? 'user-delete-confirm' : 'user-signout-confirm'}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-bold ${ctaClass} disabled:opacity-60`}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : (isDelete ? <Trash2 size={14} /> : <LogOut size={14} />)}
            {busy ? 'Working…' : cta}
          </button>
        </div>
      </div>
    </div>
  );
}


export default function UsersManagement() {
  const can = useCan();
  // v160.3.9.29-2a — Live-fetch system roles for every picker on this
  // page. See `useSystemRoles()` above for the merged legacy+seeded
  // list. This surfaces the 6 new Phase 2 roles (hseq_manager,
  // hseq_manager_readonly, general_user, mechanic, responsible_manager,
  // training_inductions_only, report_emailing_admin, hseq_manager_creator)
  // in every dropdown, and keeps the 2 inactive contractor_rep roles
  // visible-but-disabled with an "· Not yet available" tail label.
  const { roles: systemRoles } = useSystemRoles();
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ role: '', status: 'active' });
  const [active, setActive] = useState(null);
  const [activeTab, setActiveTab] = useState('profile');
  // v160.3.9.32-4c — Phase 4c grouped-by-role sections. Local state only
  // (URL persistence is a later polish).
  const [sectionOpen, setSectionOpen] = useState({});
  const [sectionSort, setSectionSort] = useState({});
  // v160.3.9.32-4c — Phase 4c housekeeping: InviteModal + BulkInviteModal
  // removed (backend returns 410 anyway). Simpro selective-import is the
  // only user-creation path — see setSimproPickerOpen below.
  // v160.3.9.32-4b — Phase 4b Simpro selective-import picker.
  const [simproPickerOpen, setSimproPickerOpen] = useState(false);
  // v160.3.9.32-4b — Admin direct set-password dialog (drawer action).
  const [setPwdFor, setSetPwdFor] = useState(null); // user obj or null
  // v160.3.9.32-4c.1 — importOpen + refreshSimproOpen + bulkZipOpen removed
  // (legacy buttons deleted / bulk-zip rehomed to /workers page header).
  const [lastSync, setLastSync] = useState(null);                     // v160.3.2 — last sync marker
  const [simproStatus, setSimproStatus] = useState({ connected: false, companies: [] });
  const [confirmAction, setConfirmAction] = useState(null); // { kind: 'delete'|'signout', user }
  const [actionBusy, setActionBusy] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  // v160.3.7h — Lock body scroll for the inline bulk-delete confirm (this
  // modal lives in the parent JSX so it can't own its own useEffect).
  useLockBodyScroll(bulkConfirmOpen);
  const me = getUser();

  const [showTest, setShowTest] = useState(false);
  const load = async () => {
    try {
      // v160.3.9.31-4a — Backend hides test fixtures + soft-deleted by
      // default. Pass hide_test=false only when the "show test" toggle
      // is on. `include_deleted=true` is admin-only (future restore
      // flow) — leave off for now.
      const params = showTest ? '?hide_test=false' : '';
      const { data } = await api.get(`/users${params}`);
      setUsers(data);
    } catch (e) { toast.error(apiError(e)); }
  };
  const loadSimpro = async () => {
    try {
      const { data } = await api.get('/integrations/simpro');
      const ok = data?.status === 'connected';
      const companies = (data?.companies_status || []).filter((c) => c.status === 'ok');
      setSimproStatus({ connected: ok && companies.length > 0, companies });
    } catch { setSimproStatus({ connected: false, companies: [] }); }
  };
  const loadLastSync = async () => {
    try {
      const { data } = await api.get('/integrations/simpro/workers/last-sync');
      setLastSync(data);
    } catch { /* silent */ }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); loadSimpro(); loadLastSync(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showTest]);

  // v160.3.9.31-4a — Segmented header buckets. `active` = activation_status
  // 'active' (or unset, for legacy pre-Simpro users). `pending` = imported
  // via Simpro but haven't accepted the invite. `archived` = suspended OR
  // explicitly is_archived — from an admin's POV both are "gone from
  // day-to-day." `testHidden` counts fixture rows that are hidden by
  // default and only shown when the user flips the toggle.
  // MUST live above the `!can('users','view')` early return so hooks fire
  // in the same order on every render.
  const segments = useMemo(() => {
    let active = 0, pending = 0, archived = 0, testHidden = 0;
    for (const u of users) {
      if (u.is_test_fixture) { testHidden += 1; continue; }
      const s = u.activation_status;
      if (s === 'pending_activation') pending += 1;
      else if (s === 'suspended' || u.is_archived) archived += 1;
      else active += 1;
    }
    return { active, pending, archived, testHidden };
  }, [users]);

  if (!can('users', 'view')) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500" data-testid="users-denied">Access denied — you need users.view permission.</div>;
  }
  const filtered = users.filter((u) => (!filters.role || u.role === filters.role) && (!filters.status || u.status === filters.status));
  const disabledCount = users.filter((u) => u.status === 'disabled').length;
  const bulkable = filtered.filter((u) => u.id !== me?.id && !u.deleted_at);
  const bulkAllChecked = bulkable.length > 0 && bulkable.every((u) => bulkSelected.has(u.id));
  const toggleBulk = (uid) => setBulkSelected((s) => { const n = new Set(s); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  const toggleBulkAll = () => setBulkSelected((s) => bulkAllChecked ? new Set() : new Set(bulkable.map((u) => u.id)));
  const runBulkDelete = async () => {
    setActionBusy(true);
    try {
      const ids = Array.from(bulkSelected);
      const { data } = await api.post('/users/bulk-delete', { user_ids: ids });
      const parts = [`Deleted ${data.deleted}`];
      if (data.skipped_self) parts.push(`skipped self ${data.skipped_self}`);
      if (data.skipped_last_admin) parts.push(`skipped last-admin ${data.skipped_last_admin}`);
      if (data.skipped_already_disabled) parts.push(`already disabled ${data.skipped_already_disabled}`);
      toast.success(parts.join(' · '));
      setBulkSelected(new Set());
      setBulkConfirmOpen(false);
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setActionBusy(false); }
  };

  // v160.3.9.32-4c — Phase 4c: user-row renderer factored out so both the
  // legacy flat map and the new group-by-role sections can share the same
  // row markup. Uses closure over the surrounding component state.
  const renderUserRow = (u) => (
    <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => { setActiveTab('profile'); setActive(u); }} data-testid={`user-row-${u.id}`}>
      {can('users', 'edit') && (
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          {u.id !== me?.id && (
            <input type="checkbox"
              checked={bulkSelected.has(u.id)}
              onChange={() => toggleBulk(u.id)}
              data-testid={`user-checkbox-${u.id}`}
              className="h-4 w-4 accent-rose-600" />
          )}
        </td>
      )}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8"><AvatarFallback className="text-xs">{(u.name || u.email || '?')[0]}</AvatarFallback></Avatar>
          <div>
            <div className="font-medium flex items-center gap-1.5">{u.name}
              {u.simpro_employee_id && (
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200"
                  title={`Simpro-linked${u.simpro_last_synced_at ? ` · Last synced ${new Date(u.simpro_last_synced_at).toLocaleString()}` : ''}`}
                  data-testid={`simpro-badge-${u.id}`}>Simpro</span>
              )}
              {u.is_test_fixture && (
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
                  title="Test fixture — hidden from admin lists by default"
                  data-testid={`test-fixture-badge-${u.id}`}>Test</span>
              )}
              {u.activation_status === 'pending_activation' && (
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200"
                  title="User has not activated yet — admin can Set password"
                  data-testid={`pending-badge-${u.id}`}>Pending</span>
              )}
              {u.is_archived && (
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 border border-slate-300"
                  title="Archived — no active access"
                  data-testid={`archived-badge-${u.id}`}>Archived</span>
              )}
            </div>
            <div className="text-xs text-slate-500">{u.email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 bg-slate-100 rounded font-medium">{u.role}</span></td>
      <td className="px-4 py-3"><StatusPill user={u} /></td>
      <td className="px-4 py-3 text-xs">{u.has_permission_overrides ? <span className="text-brand-violet font-medium">Custom</span> : <span className="text-slate-500">Role default</span>}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
      {can('users', 'edit') && (
        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="inline-flex gap-1 items-center">
            <AccessKebab userId={u.id} canEdit={u.id !== me?.id} onAfterAction={load} />
            <button title="Edit permissions" data-testid={`user-edit-perms-${u.id}`}
              onClick={() => { setActiveTab('permissions'); setActive(u); }}
              className="inline-flex items-center justify-center w-7 h-7 rounded bg-violet-100 text-violet-700 hover:bg-violet-200"><FlKey /></button>
            <button title="Edit user" data-testid={`user-edit-${u.id}`}
              onClick={() => { setActiveTab('profile'); setActive(u); }}
              className="inline-flex items-center justify-center w-7 h-7 rounded bg-slate-100 text-slate-700 hover:bg-slate-200"><FlEdit /></button>
            {u.id !== me?.id && (
              <button title="Delete user (soft)" data-testid={`delete-user-${u.id}`}
                onClick={() => setConfirmAction({ kind: 'delete', user: u })}
                className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#fbe4e7] text-[#7a1f33] hover:bg-[#f4c7cd]"><FlDelete /></button>
            )}
          </div>
        </td>
      )}
    </tr>
  );

  return (
    <div className="max-w-6xl mx-auto" data-testid="users-page">
      <PageHeader crumb="Settings / Users" title="Users &amp; permissions"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600" data-testid="users-header-segments">
            <span data-testid="users-seg-active"><b className="text-slate-900">{segments.active}</b> active</span>
            <span className="text-slate-300">·</span>
            <span data-testid="users-seg-pending"><b className="text-slate-900">{segments.pending}</b> pending activation</span>
            <span className="text-slate-300">·</span>
            <span data-testid="users-seg-archived"><b className="text-slate-900">{segments.archived}</b> archived</span>
            {showTest ? (
              <>
                <span className="text-slate-300">·</span>
                <span data-testid="users-seg-test-shown"><b className="text-slate-900">{segments.testHidden}</b> test fixtures visible</span>
                <button
                  type="button"
                  onClick={() => setShowTest(false)}
                  className="text-xs text-blue-600 hover:underline"
                  data-testid="users-hide-test"
                >
                  (hide)
                </button>
              </>
            ) : (
              <>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => setShowTest(true)}
                  className="text-xs text-slate-500 hover:text-slate-900 hover:underline"
                  data-testid="users-show-test"
                >
                  test fixtures hidden (show)
                </button>
              </>
            )}
          </span>
        }
        action={can('users', 'edit') ? (
          <div className="flex items-center gap-2">
            {/* v160.3.9.32-4c.1 — Removed legacy "Import from Simpro"
                (yellow Download) + "Refresh from Simpro" (amber). Both
                superseded by the Phase 4b picker + sync-linked below. */}
            {lastSync?.last_synced_at && (
              <span
                className="text-[11px] text-slate-500"
                data-testid="last-simpro-sync"
                title={`${lastSync.triggered_by || 'manual'} · ${lastSync.last_synced_at}`}
              >
                Synced {relativeTime(lastSync.last_synced_at)}
                {lastSync.triggered_by === 'cron' && (
                  <span className="ml-1 text-[9px] uppercase tracking-wider text-emerald-700 font-semibold">CRON</span>
                )}
              </span>
            )}
            {/* v160.3.9.32-4c.1 — "Bulk import ZIPs" button rehomed to
                /workers where the ZIP-ingested compliance data (photos,
                certification PDFs, licences, inductions, HR docs) actually
                lands. Users page keeps only REST-driven affordances. */}
            {/* v160.3.9.32-4b — Phase 4b replaces the invite flow. Sync
                pulls updated position/archived from Simpro for every
                already-linked user; picker opens the selective-import
                modal. Both gated by users.edit via the backend. */}
            <button
              onClick={async () => {
                try {
                  const { data } = await api.post('/admin/simpro/sync-linked');
                  toast.success(`Synced ${data.scanned} · Updated ${data.changed}`);
                  await load();
                } catch (e) { toast.error(apiError(e)); }
              }}
              data-testid="sync-from-simpro-btn"
              disabled={!simproStatus.connected}
              title={simproStatus.connected ? 'Refresh linked users from Simpro' : 'Connect Simpro first'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={14} /> Sync from Simpro
            </button>
            <button onClick={() => setSimproPickerOpen(true)} data-testid="simpro-picker-btn"
              disabled={!simproStatus.connected}
              title={simproStatus.connected ? 'Choose Simpro employees to import' : 'Connect Simpro first'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50">
              <FlPersonAdd /> Import from Simpro
            </button>
          </div>) : null} />

      {/* v160.3.7i — SimproZipImportGuide was rehomed to
          `/app/settings/help/simpro-import` because the full inline guide
          broke this page's layout. All that remains here is a subtle text
          link pointing admins to the dedicated help page. */}
      {/* v160.3.9.32-4c.2 — Simpro attachment help note moved to /workers
          (where the ZIP button lives). This page no longer has any ZIP
          affordance so the note doesn't belong here. */}

      {/* v160.3.9.32-4c.2 — Pending-user hint banner. Surfaces when there
          are pending_activation users OR users without role_id. Makes the
          "why are picker rows greyed out?" question self-answering — the
          64 Simpro imports are already in this list waiting for a role. */}
      {(() => {
        const pending = users.filter((u) => u.activation_status === 'pending_activation' && !u.is_test_fixture);
        if (pending.length === 0) return null;
        return (
          <div className="mt-3 mb-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-3" data-testid="pending-users-hint">
            <div className="text-blue-700 mt-0.5">💡</div>
            <div className="flex-1 text-sm text-slate-800">
              <b>{pending.length}</b> imported users are waiting for role assignment. Click a user row to assign a role in the drawer.
            </div>
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, status: 'invited' }))}
              className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
              data-testid="show-pending-only"
            >
              Show pending users only →
            </button>
          </div>
        );
      })()}

      {/* v160.3.6u — Flipped to v6p hero hierarchy (LIST is the primary big
          blue capsule; Dashboard collapses to a tiny secondary text-link).
          This page was missed in the original v6p sweep. */}
      <Tabs defaultValue="list" className="mt-2" data-testid="users-tabs">
        <TabsList variant="hero">
          <TabsTrigger variant="hero" emphasis="secondary" value="dashboard" data-testid="users-tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger variant="hero" emphasis="primary" value="list" data-testid="users-tab-list">
            List <span>{users.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4" data-testid="users-tab-dashboard-content">
          <HowThisWorks schematicSlug="workers_access" />
          <ModuleDashboard
            module="workers" title="Users & Workers"
            tagline="Roles, activity and access — Simpro-linked users and pending activations surfaced first."
            moduleColour="violet"
            quickActions={can('users', 'edit') ? [
              { label: 'Import from Simpro', route: '/app/settings/users' },
            ] : []}
          />
        </TabsContent>
        <TabsContent value="list" className="mt-4" data-testid="users-tab-list-content">

      {!can('users', 'edit') && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900" data-testid="users-readonly-banner">
          You can view users but not modify them. Contact an admin to make changes.
        </div>
      )}

      <div className="flex gap-2 mb-4 items-center">
        <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5" data-testid="users-role-filter">
          <option value="">All roles</option>
          {systemRoles.map((r) => (
            <option key={r.role_id} value={r.role_id}>
              {r.name}{!r.is_active ? ' · not yet available' : ''}
            </option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5" data-testid="users-status-filter">
          <option value="">All statuses</option>{['active', 'invited', 'disabled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {filters.status === 'active' && disabledCount > 0 && (
          <span className="text-[11px] text-slate-500" data-testid="users-disabled-hint">
            · {disabledCount} disabled hidden ·{' '}
            <button onClick={() => setFilters({ ...filters, status: 'disabled' })}
              className="text-blue-600 hover:underline">show</button>
          </span>
        )}
        {can('users', 'edit') && bulkSelected.size > 0 && (
          <div className="ml-auto inline-flex items-center gap-2" data-testid="users-bulk-toolbar">
            <span className="text-xs text-slate-600"><strong>{bulkSelected.size}</strong> selected</span>
            <button onClick={() => setBulkSelected(new Set())}
              data-testid="users-bulk-clear"
              className="text-xs text-slate-500 hover:underline">Clear</button>
            <button onClick={() => setBulkConfirmOpen(true)}
              data-testid="users-bulk-delete-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
              <FlDelete /> Delete {bulkSelected.size} user{bulkSelected.size === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="zebra-list w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              {can('users', 'edit') && (
                <th className="text-left px-3 py-2.5 w-8" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={bulkAllChecked}
                    disabled={bulkable.length === 0}
                    onChange={toggleBulkAll}
                    data-testid="users-bulk-select-all"
                    className="h-4 w-4 accent-rose-600" />
                </th>
              )}
              <th className="text-left px-4 py-2.5">User</th><th className="text-left px-4 py-2.5">Role</th>
              <th className="text-left px-4 py-2.5">Status</th><th className="text-left px-4 py-2.5">Permissions</th>
              <th className="text-left px-4 py-2.5">Created</th>
              {can('users', 'edit') && <th className="text-right px-4 py-2.5">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(() => {
              // v160.3.9.32-4c — Phase 4c: group users by role (role_id if
              // set, else legacy role string). Collapsible per-section, per-
              // section sort. Preserves the segmented header buckets above.
              const groups = new Map();
              for (const u of filtered) {
                const key = u.role_id || u.role || '__unassigned__';
                if (!groups.has(key)) groups.set(key, { key, users: [] });
                groups.get(key).users.push(u);
              }
              const roleLabel = (key) => {
                if (key === '__unassigned__') return 'Unassigned role';
                const sys = systemRoles.find((r) => r.role_id === key);
                if (sys) return sys.name;
                return key.replace(/^custom_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              };
              const sortUsers = (arr, mode) => {
                const s = [...arr];
                if (mode === 'name_desc') s.sort((a,b) => (b.name || '').localeCompare(a.name || ''));
                else if (mode === 'last_login') s.sort((a,b) => (b.last_login_at || '').localeCompare(a.last_login_at || ''));
                else if (mode === 'created') s.sort((a,b) => (b.created_at || '').localeCompare(a.created_at || ''));
                else s.sort((a,b) => (a.name || '').localeCompare(b.name || ''));
                return s;
              };
              const ordered = Array.from(groups.values()).sort((a,b) => roleLabel(a.key).localeCompare(roleLabel(b.key)));
              const colCount = can('users', 'edit') ? 7 : 6;
              return ordered.flatMap((g) => {
                const open = sectionOpen[g.key] !== false;
                const sort = sectionSort[g.key] || 'name_asc';
                const rows = [
                  <tr key={`sec-${g.key}`} className="bg-slate-100/70 border-t border-slate-200" data-testid={`role-section-${g.key}`}>
                    <td colSpan={colCount} className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setSectionOpen((s) => ({ ...s, [g.key]: !open }))}
                          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest font-semibold text-slate-700 hover:text-slate-900"
                          data-testid={`role-section-toggle-${g.key}`}>
                          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {roleLabel(g.key)}
                          <span className="text-slate-500 font-normal normal-case tracking-normal">· {g.users.length}</span>
                        </button>
                        <div className="ml-auto">
                          <select value={sort} onChange={(e) => setSectionSort((s) => ({ ...s, [g.key]: e.target.value }))}
                            className="text-xs border border-slate-300 rounded-md px-2 py-1 bg-white"
                            data-testid={`role-section-sort-${g.key}`}>
                            <option value="name_asc">Name A-Z</option>
                            <option value="name_desc">Name Z-A</option>
                            <option value="last_login">Last login</option>
                            <option value="created">Date created</option>
                          </select>
                        </div>
                      </div>
                    </td>
                  </tr>
                ];
                if (open) {
                  for (const u of sortUsers(g.users, sort)) rows.push(renderUserRow(u));
                }
                return rows;
              });
            })()}
          </tbody>
        </table>
      </div>
        </TabsContent>
      </Tabs>

      {bulkConfirmOpen && (
        <div data-testid="users-bulk-delete-modal"
          className="fixed inset-0 z-[70] bg-slate-900/70 grid place-items-center p-4"
          onClick={(e) => e.target === e.currentTarget && !actionBusy && setBulkConfirmOpen(false)}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-rose-100 text-rose-700 flex-shrink-0"><AlertTriangle size={18} /></div>
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-slate-900">Delete {bulkSelected.size} user{bulkSelected.size === 1 ? '' : 's'}?</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">They will lose access immediately. This is a soft-delete — admins can restore from Mongo.</p>
              </div>
            </div>
            <div className="px-5 py-3 text-sm text-slate-700 max-h-48 overflow-auto">
              {users.filter((u) => bulkSelected.has(u.id)).map((u) => (
                <div key={u.id} className="text-xs py-0.5 truncate">• {u.name || u.email} <span className="text-slate-400">({u.role})</span></div>
              ))}
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setBulkConfirmOpen(false)} disabled={actionBusy}
                data-testid="users-bulk-delete-cancel"
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={runBulkDelete} disabled={actionBusy}
                data-testid="users-bulk-delete-confirm"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-60">
                {actionBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {actionBusy ? 'Deleting…' : `Delete ${bulkSelected.size} user${bulkSelected.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {active && <UserDrawer userRow={active} onClose={() => setActive(null)} onReload={load} canEdit={can('users', 'edit')} defaultTab={activeTab} />}
      {confirmAction && (
        <ConfirmActionModal
          kind={confirmAction.kind}
          user={confirmAction.user}
          busy={actionBusy}
          onClose={() => !actionBusy && setConfirmAction(null)}
          onConfirm={async () => {
            const { kind, user: u } = confirmAction;
            setActionBusy(true);
            try {
              if (kind === 'delete') {
                await api.delete(`/users/${u.id}`);
                toast.success(`${u.name || u.email} deleted.`);
              } else {
                await api.post(`/users/${u.id}/force-signout`);
                toast.success(`${u.name || u.email}'s sessions revoked.`);
              }
              setConfirmAction(null);
              await load();
            } catch (e) {
              toast.error(apiError(e));
            } finally {
              setActionBusy(false);
            }
          }}
        />
      )}
      {simproPickerOpen && <SimproImportPickerModal onClose={() => setSimproPickerOpen(false)} onDone={load} />}
      {/* v160.3.9.32-4c.1 — legacy ImportFromSimproDrawer + RefreshFromSimproModal
          instantiations removed. The picker + sync-linked flow replaces them. */}
      {/* v160.3.9.32-4c.1 — bulkZipOpen instantiation removed; button
          rehomed to /workers page header. */}
    </div>
  );
}

function UserDrawer({ userRow, onClose, onReload, canEdit, defaultTab = 'profile' }) {
  const [tab, setTab] = useState(defaultTab);
  // v160.3.9.29-2a — Live-fetched role catalogue for the drawer's role
  // Select. See useSystemRoles() at module scope.
  const { roles: systemRoles } = useSystemRoles();
  const [detail, setDetail] = useState(null);
  const [perms, setPerms] = useState(null);
  const [profile, setProfile] = useState({ name: '', email: '', role: '', status: '', workspace_ids: [] });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hardConfirm, setHardConfirm] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [permSearch, setPermSearch] = useState('');
  const [presets, setPresets] = useState({ built_in: [], custom: [] });
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [appliedPreset, setAppliedPreset] = useState(null);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  // v160.3.9.32-4c — ResetPasswordDialog state (direct set + magic-link modes).
  const [resetPwdOpen, setResetPwdOpen] = useState(false);

  // v160.3.7g — Lock body scroll while the drawer is open so wheel/touch
  // scrolls inside the drawer don't leak through to the page underneath.
  // v160.3.7h — Refactored onto the shared useLockBodyScroll hook.
  useLockBodyScroll();

  const load = async () => {
    try {
      const { data: u } = await api.get(`/users/${userRow.id}`);
      setDetail(u);
      setProfile({ name: u.name, email: u.email || '', role: u.role, status: u.status || 'active', workspace_ids: u.workspace_ids || [] });
      const { data: p } = await api.get(`/users/${userRow.id}/permissions`);
      setPerms(p);
      try { const { data: ws } = await api.get('/workspaces'); setWorkspaces(ws || []); } catch { /* ignore */ }
    } catch (e) { toast.error(apiError(e)); }
  };
  const loadPresets = async () => {
    try {
      const { data } = await api.get('/permission-presets');
      setPresets({ built_in: data.built_in || [], custom: data.custom || [] });
    } catch { /* non-fatal */ }
  };
  useEffect(() => { load(); loadPresets(); /* eslint-disable-next-line */ }, [userRow.id]);

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const saveProfile = async () => {
    setBusy(true);
    try {
      const payload = { ...profile };
      // Drop email from payload if unchanged from server detail (avoids spurious
      // collision checks) or invalid format.
      const original = (detail?.email || '').toLowerCase();
      const next = (payload.email || '').toLowerCase().trim();
      if (!next || !emailRe.test(next)) {
        delete payload.email;
      } else if (next === original) {
        delete payload.email;
      } else {
        payload.email = next;
      }
      await api.patch(`/users/${userRow.id}`, payload);
      toast.success('Profile updated'); onReload(); load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const cycle = (resource, action) => {
    if (action === 'email' && !EMAIL_SUPPORTED[resource]) return;
    // v159.2 — team_view only cycles on the six team-scoped resources.
    if (action === 'team_view' && !TEAM_VIEW_SUPPORTED[resource]) return;
    setPerms((p) => {
      const o = { ...(p.overrides || {}) };
      const sub = { ...(o[resource] || {}) };
      const cur = sub[action];
      if (cur === undefined) sub[action] = true;
      else if (cur === true) sub[action] = false;
      else delete sub[action];
      if (Object.keys(sub).length === 0) delete o[resource]; else o[resource] = sub;
      // Recompute effective: default from role_defaults, override wins.
      const eff = JSON.parse(JSON.stringify(p.effective || {}));
      const defVal = p.role_defaults?.[resource]?.[action] || false;
      eff[resource] = eff[resource] || {};
      eff[resource][action] = (o[resource]?.[action] !== undefined) ? o[resource][action] : defVal;
      return { ...p, overrides: o, effective: eff };
    });
  };

  const savePerms = async () => {
    setBusy(true);
    try { await api.put(`/users/${userRow.id}/permissions`, { overrides: perms.overrides, reasons: perms.reasons || {} }); toast.success('Permissions saved'); onReload(); load(); setAppliedPreset(null); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  const resetPerms = async () => {
    setBusy(true);
    try { await api.post(`/users/${userRow.id}/permissions/reset`); toast.success('Reset to role defaults'); onReload(); load(); setAppliedPreset(null); setSelectedPresetId(''); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const allPresets = useMemo(
    () => [...(presets.built_in || []), ...(presets.custom || [])],
    [presets]
  );
  const applyPresetLocal = () => {
    if (!selectedPresetId) return;
    const preset = allPresets.find((p) => p.id === selectedPresetId || p.key === selectedPresetId);
    if (!preset || !perms) return;
    // Replace overrides with the preset matrix. Recompute effective off the
    // role_defaults that came back from the server.
    const overrides = {};
    const eff = JSON.parse(JSON.stringify(perms.effective || {}));
    Object.entries(preset.permissions || {}).forEach(([res, acts]) => {
      overrides[res] = {};
      Object.entries(acts || {}).forEach(([act, val]) => {
        overrides[res][act] = !!val;
        eff[res] = eff[res] || {};
        eff[res][act] = !!val;
      });
    });
    setPerms({ ...perms, overrides, effective: eff });
    setAppliedPreset({ key: preset.key || preset.id, label: preset.label, is_builtin: !!preset.is_builtin });
  };

  const handlePresetCreated = (created) => {
    setPresets((s) => ({ ...s, custom: [...(s.custom || []), created] }));
    setSelectedPresetId(created.id);
    toast.success(`Saved preset "${created.label}"`);
  };
  const disable = async () => {
    if (!window.confirm('Disable this user? They will be unable to log in.')) return;
    try { await api.delete(`/users/${userRow.id}`); toast.success('User disabled'); onReload(); onClose(); }
    catch (e) { toast.error(apiError(e)); }
  };

  return createPortal((
    // v160.3.9.29-2a HOT-PATCH — Wrapped the drawer in a React Portal to
    // `document.body` so its `fixed inset-0` is truly viewport-relative.
    // A prior regression in the AppShell content-column stacking context
    // was causing the drawer's top edge to clip below the topbar (user
    // report: "the top of the popup has been cut off and i cant see how
    // to go back"). Portalling out is the robust fix — no ancestor can
    // create a containing block for the fixed backdrop.
    <div className="fixed inset-0 bg-black/40 z-[60] flex justify-end" onClick={onClose}>
      {/* v160.3.7g — Drawer structural rebuild:
          • outer panel: fixed height (h-full) + flex-col + overflow-hidden
          • sticky header (name + close X) — stays visible while scrolling
          • sticky tab strip — same reason
          • ONE inner scroll region (flex-1 overflow-y-auto min-h-0) for
            the content. Wheel/touch scrolls now stay inside the drawer.
          Previously `overflow-auto` on the whole panel + no scroll lock
          made the background page scroll instead of the drawer contents. */}
      <div className="bg-white w-full sm:max-w-2xl h-full flex flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="user-drawer">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 pt-5 pb-3 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Avatar className="h-11 w-11"><AvatarFallback className="text-sm">{(userRow.name || userRow.email || '?')[0]}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-xl truncate">{userRow.name}</h2>
                  <div className="text-sm text-slate-500 font-normal truncate">{userRow.email}</div>
                </div>
              </div>
              {/* v160.3.9.32-4c drawer chips */}
              <div className="mt-2 flex flex-wrap gap-1.5" data-testid="user-drawer-chips">
                {userRow.simpro_employee_id && (
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200"
                    title={userRow.simpro_last_synced_at ? `Last synced ${new Date(userRow.simpro_last_synced_at).toLocaleString()}` : 'Simpro-linked'}
                    data-testid="drawer-chip-simpro"
                  >Simpro-linked</span>
                )}
                {userRow.is_test_fixture && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
                    data-testid="drawer-chip-test">Test</span>
                )}
                {userRow.activation_status === 'pending_activation' && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200"
                    data-testid="drawer-chip-pending">Pending activation</span>
                )}
                {userRow.is_archived && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 border border-slate-300"
                    data-testid="drawer-chip-archived">Archived</span>
                )}
              </div>
            </div>
            {/* v160.3.9.29-2a HOT-PATCH — Enlarged, higher-contrast close
                button. Previous 2xl bare `&times;` was hard to spot when
                the drawer's top edge clipped. Now a proper 32×32 pill
                with hover + focus rings + aria-label so keyboard + screen
                reader users can dismiss reliably. */}
            <button
              onClick={onClose}
              aria-label="Close user drawer"
              title="Close (Esc)"
              data-testid="user-drawer-close"
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-blue/40 transition-colors"
            >
              <XIcon size={18} />
            </button>
          </div>
          <div className="mt-4 flex gap-4">
            {['profile', 'permissions', 'sessions'].map((t) => (
              <button key={t} onClick={() => setTab(t)} data-testid={t === 'sessions' ? 'session-history-tab' : `tab-${t}`}
                className={`pb-2 text-sm font-medium ${tab === t ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-slate-500'}`}>{t === 'sessions' ? 'Session history' : t}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4" data-testid="user-drawer-scroll">
        {tab === 'sessions' && (
          <SessionHistoryTab userId={userRow.id} />
        )}

        {tab === 'profile' && detail && (
          <div className="mt-5 space-y-4">
            <label className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Name</div>
              <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" disabled={!canEdit} data-testid="user-name" /></label>
            <label className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Email</div>
              <input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50 disabled:text-slate-500"
                disabled={!canEdit} placeholder="name@example.com" autoComplete="off" data-testid="user-email" />
              {profile.email && !emailRe.test(profile.email.trim()) && (
                <div className="text-[11px] text-rose-600 mt-1">Enter a valid email address.</div>
              )}
            </label>
            <div className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Role</div>
              <Select value={profile.role || undefined} onValueChange={(v) => setProfile({ ...profile, role: v })} disabled={!canEdit}>
                <SelectTrigger className="w-full" data-testid="user-role"><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {systemRoles.map((r) => (
                    <SelectItem key={r.role_id} value={r.role_id} disabled={!r.is_active} data-testid={`role-opt-${r.role_id}`}>
                      {r.name}{!r.is_active ? ' · not yet available' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Status</div>
              <Select value={profile.status || undefined} onValueChange={(v) => setProfile({ ...profile, status: v })} disabled={!canEdit}>
                <SelectTrigger className="w-full" data-testid="user-status"><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} data-testid={`status-opt-${s}`}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-[11px] text-slate-500 mt-1">Changing role / status / email will sign the user out of any active sessions.</div>
            </div>
            <div className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Workspaces</div>
              {workspaces.length === 0 ? <div className="text-xs text-slate-400 italic">No workspaces in your org.</div> : (
                <div className="space-y-1 border border-slate-200 rounded-lg p-2" data-testid="user-workspaces">
                  {workspaces.map((w) => (
                    <label key={w.id} className="flex items-center gap-2 text-sm px-1 py-0.5 hover:bg-slate-50 rounded cursor-pointer">
                      <input type="checkbox" disabled={!canEdit}
                        checked={profile.workspace_ids.includes(w.id)}
                        onChange={(e) => setProfile((p) => ({ ...p, workspace_ids: e.target.checked
                          ? [...p.workspace_ids, w.id]
                          : p.workspace_ids.filter((x) => x !== w.id) }))}
                        data-testid={`ws-toggle-${w.id}`} />
                      <span>{w.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {canEdit && (
              <div className="pt-4 border-t border-slate-200" data-testid="drawer-access-block">
                <AccessSection userId={userRow.id} />
              </div>
            )}
            {canEdit && (
              <div className="flex gap-2 pt-2 flex-wrap"><button onClick={saveProfile} disabled={busy} className="px-4 py-2 bg-brand-blue text-white rounded-lg text-sm inline-flex items-center gap-1.5" data-testid="save-profile"><Save size={13} /> Save changes</button>
                {profile.status === 'active' && <button onClick={() => setConfirmDelete(true)} className="px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm" data-testid="disable-user">Disable user</button>}
                {profile.status === 'disabled' && <button onClick={() => { setProfile({ ...profile, status: 'active' }); setTimeout(saveProfile, 0); }} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm" data-testid="reactivate-user">Reactivate</button>}
                {/* v160.3.9.32-4c — Password action opens ResetPasswordDialog with two modes. */}
                <button onClick={() => setResetPwdOpen(true)} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm inline-flex items-center gap-1.5" data-testid="password-btn">
                  <KeyRound size={13} /> Password
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'permissions' && perms && (
          <div className="mt-5" data-testid="user-permissions-modal">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <div className="text-sm text-slate-700"><ShieldCheck size={13} className="inline mr-1 text-brand-blue" /> Role default: <strong>{perms.role}</strong></div>
              {canEdit && <button onClick={resetPerms} data-testid="perm-reset-defaults" className="text-xs inline-flex items-center gap-1 px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"><RotateCcw size={11} /> Reset to defaults</button>}
            </div>

            {canEdit && (
              <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2.5" data-testid="preset-picker">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] uppercase tracking-wider font-bold text-violet-700 inline-flex items-center gap-1.5">
                    <Wand2 size={12} /> Quick apply preset
                  </div>
                  <button onClick={() => setSavePresetOpen(true)} disabled={!perms.overrides || Object.keys(perms.overrides).length === 0}
                    data-testid="save-current-as-preset"
                    title={!perms.overrides || Object.keys(perms.overrides).length === 0 ? 'Tweak the matrix below, then save as a preset' : 'Save the current matrix as a custom preset'}
                    className="text-[11px] text-violet-700 hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed inline-flex items-center gap-1">
                    <Sparkles size={11} /> Save current as new preset…
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <select value={selectedPresetId} onChange={(e) => setSelectedPresetId(e.target.value)}
                    data-testid="preset-select"
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-sm bg-white border border-violet-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/40">
                    <option value="">Choose a preset…</option>
                    {(presets.built_in || []).length > 0 && (
                      <optgroup label="Built-in">
                        {(presets.built_in || []).map((p) => (
                          <option key={p.id} value={p.id} title={p.description} data-testid={`preset-option-${p.key}`}>{p.label}</option>
                        ))}
                      </optgroup>
                    )}
                    {(presets.custom || []).length > 0 && (
                      <optgroup label="Custom">
                        {(presets.custom || []).map((p) => (
                          <option key={p.id} value={p.id} title={p.description}>{p.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button onClick={applyPresetLocal} disabled={!selectedPresetId}
                    data-testid="preset-apply-btn"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed">
                    <Wand2 size={11} /> Apply
                  </button>
                </div>
                {selectedPresetId && !appliedPreset && (
                  <div className="text-[11px] text-violet-700/80 mt-1.5">
                    {(allPresets.find((p) => p.id === selectedPresetId || p.key === selectedPresetId) || {}).description || 'Select Apply to populate the matrix below.'}
                  </div>
                )}
                {appliedPreset && (
                  <div className="mt-2 px-2.5 py-2 rounded-lg bg-white border border-violet-300 text-[12px] text-violet-900 inline-flex items-center gap-2" data-testid="preset-applied-banner">
                    <Sparkles size={12} className="text-violet-600" />
                    <span>Applied <strong>{appliedPreset.label}</strong> preset — review the matrix below, then click <strong>Save permissions</strong> to commit.</span>
                  </div>
                )}
              </div>
            )}

            <div className="relative mb-2">
              <SearchIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text" value={permSearch} onChange={(e) => setPermSearch(e.target.value)}
                placeholder="Search resources (e.g. workers, certifications, inductions)…"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                data-testid="perm-search"
              />
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="zebra-list w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr><th className="text-left px-3 py-2">Resource</th>{ACTIONS.map((a) => <th key={a} className="px-3 py-2">{a}</th>)}</tr>
                </thead>
                <tbody>
                  {RESOURCES.filter((res) => {
                    if (!permSearch.trim()) return true;
                    const s = permSearch.trim().toLowerCase();
                    return res.toLowerCase().includes(s)
                      || (RESOURCE_LABELS[res] || '').toLowerCase().includes(s);
                  }).map((res) => (
                    <tr key={res} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium">{RESOURCE_LABELS[res]}</td>
                      {ACTIONS.map((act) => {
                        const ov = perms.overrides?.[res]?.[act];
                        const isEmail = act === 'email';
                        const isTeamView = act === 'team_view';
                        const supported = (!isEmail || EMAIL_SUPPORTED[res])
                          && (!isTeamView || TEAM_VIEW_SUPPORTED[res]);
                        const eff = perms.effective?.[res]?.[act];
                        let icon, cls;
                        if (!supported) { icon = <span className="text-slate-300">—</span>; cls = ''; }
                        else if (ov === true) { icon = <Check size={14} className="text-emerald-600" />; cls = 'bg-emerald-50'; }
                        else if (ov === false) { icon = <XIcon size={14} className="text-red-600" />; cls = 'bg-red-50'; }
                        else { icon = eff ? <Check size={14} className="text-slate-400" /> : <Minus size={14} className="text-slate-300" />; cls = ''; }
                        // v159.4 — effective-value chip beneath the tri-state
                        // icon. Only shown when the cell is `inherit` — that's
                        // the only time admins wonder what actually resolves.
                        const showEffChip = supported && ov === undefined;
                        return (
                          <td key={act} className={`px-3 py-2 text-center cursor-pointer ${cls}`}
                            onClick={() => canEdit && supported && cycle(res, act)}
                            data-testid={`perm-${res}-${act}`}
                            title={
                              !supported ? 'Not supported for this resource'
                              : ov === undefined ? `Inherits from preset — effective: ${eff ? 'allow' : 'deny'}`
                              : `Override: ${ov ? 'allow' : 'deny'}`
                            }>
                            <div className="flex flex-col items-center gap-0.5">
                              {icon}
                              {showEffChip && (
                                <span className={`text-[9px] leading-none font-semibold uppercase tracking-wide ${eff ? 'text-emerald-600/70' : 'text-slate-400'}`}>
                                  {eff ? 'allow' : 'deny'}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">Click a cell to cycle: <span className="inline-flex items-center gap-1"><Minus size={11} /> inherits</span> · <span className="inline-flex items-center gap-1"><Check size={11} className="text-emerald-600" /> explicit allow</span> · <span className="inline-flex items-center gap-1"><XIcon size={11} className="text-red-600" /> explicit deny</span></p>
            {canEdit && <button onClick={savePerms} disabled={busy} className="mt-4 px-4 py-2 bg-brand-blue text-white rounded-lg text-sm inline-flex items-center gap-1.5" data-testid="save-perms"><Save size={13} /> Save permissions</button>}
          </div>
        )}
        {canEdit && detail?.deleted_at && (
          <div className="mt-6 pt-4 border-t border-rose-200" data-testid="user-hard-delete-section">
            <div className="text-[11px] uppercase tracking-wider font-bold text-rose-700 mb-1.5">Danger zone</div>
            <p className="text-xs text-slate-600 mb-2">This user is soft-deleted. Permanently removing them deletes the row from Mongo — name, email, history pointer. This cannot be undone.</p>
            <button
              type="button" onClick={async () => {
                if (!hardConfirm) { setHardConfirm(true); return; }
                setBusy(true);
                try {
                  await api.delete(`/users/${detail.id}?hard=true`);
                  toast.success(`${detail.name || detail.email} permanently deleted.`);
                  onReload?.(); onClose();
                } catch (e) { toast.error(apiError(e)); }
                finally { setBusy(false); setHardConfirm(false); }
              }}
              data-testid={hardConfirm ? 'user-hard-delete-confirm' : 'user-hard-delete-btn'}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-60">
              <Trash2 size={12} /> {hardConfirm ? `Confirm — permanently delete ${detail.name || detail.email}` : 'Permanently delete'}
            </button>
            {hardConfirm && (
              <button type="button" onClick={() => setHardConfirm(false)}
                className="ml-2 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
            )}
          </div>
        )}
        </div>{/* /v160.3.7g scroll container */}
        {savePresetOpen && (
          <SavePresetModal
            overrides={perms?.overrides || {}}
            onClose={() => setSavePresetOpen(false)}
            onCreated={(c) => { setSavePresetOpen(false); handlePresetCreated(c); }}
          />
        )}
        {resetPwdOpen && (
          <ResetPasswordDialog
            user={userRow}
            onClose={() => setResetPwdOpen(false)}
            onDone={() => { setResetPwdOpen(false); onReload(); }}
          />
        )}
      </div>
    </div>
  ), document.body);
}

function SavePresetModal({ overrides, onClose, onCreated }) {
  useLockBodyScroll();
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      // Convert overrides → full matrix (assume false where absent).
      const permissions = {};
      Object.entries(overrides || {}).forEach(([res, acts]) => {
        permissions[res] = { ...acts };
      });
      const { data } = await api.post('/permission-presets', {
        label: label.trim(),
        description: description.trim(),
        permissions,
      });
      onCreated?.(data);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose?.()}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" data-testid="save-preset-modal">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-700 grid place-items-center"><Sparkles size={16} /></div>
          <div>
            <h3 className="font-display font-bold text-slate-900">Save current matrix as preset</h3>
            <p className="text-[11px] text-slate-500">Other admins can apply this preset to any user in your org.</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label className="block"><div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Label</div>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Family Admin"
              data-testid="save-preset-label" autoFocus
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" /></label>
          <label className="block"><div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Description</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What this preset grants. Helps the next admin pick the right one."
              data-testid="save-preset-description" rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" /></label>
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={busy || !label.trim()}
            data-testid="save-preset-submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save preset
          </button>
        </div>
      </div>
    </div>
  );
}


// v160.3.9.32-4c — InviteModal + BulkInviteModal removed (Phase 4c housekeeping).
// Backend returns 410 for both invite endpoints; Simpro selective-import is the
// only user-creation path. See SimproImportPickerModal.


// v160.3.9.32-4c — ResetPasswordDialog with two modes.
//   · "Set password directly" → POST /users/{id}/set-password with an
//     admin-chosen password. Bumps token_version → force logout.
//   · "Email reset link" → POST /users/{id}/reset-password (existing
//     magic-link flow). No password chosen; user sets their own.
function ResetPasswordDialog({ user, onClose, onDone }) {
  useLockBodyScroll();
  const [mode, setMode] = useState('direct');
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const submitDirect = async () => {
    if (pwd !== confirm) { toast.error('Passwords do not match'); return; }
    if (pwd.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/set-password`, { password: pwd });
      toast.success(`Password set for ${user.email}. They have been logged out of all sessions.`);
      onDone?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  const submitMagicLink = async () => {
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/reset-password`, { channel: 'email' });
      toast.success(`Reset link sent to ${user.email}`);
      onDone?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  return createPortal((
    <div className="fixed inset-0 z-[80] bg-slate-900/60 grid place-items-center p-4" onClick={(e) => e.target === e.currentTarget && !busy && onClose()} data-testid="reset-password-dialog">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="font-display font-bold text-slate-900 text-lg">Reset password for {user.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{user.email}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-2" role="tablist">
            <button type="button" onClick={() => setMode('direct')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm border ${mode === 'direct' ? 'border-brand-blue bg-blue-50 text-brand-blue font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              data-testid="reset-mode-direct">Set password directly</button>
            <button type="button" onClick={() => setMode('magic')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm border ${mode === 'magic' ? 'border-brand-blue bg-blue-50 text-brand-blue font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              data-testid="reset-mode-magic">Email reset link</button>
          </div>
          {mode === 'direct' ? (
            <div className="space-y-2">
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Warning — user will be logged out of every device. Communicate the new password securely.
              </div>
              <label className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">New password</div>
                <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} minLength={8}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="reset-direct-pwd" autoFocus /></label>
              <label className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Confirm</div>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="reset-direct-confirm" /></label>
            </div>
          ) : (
            <div className="text-sm text-slate-700 space-y-2">
              <div>Send a one-time magic link to <b>{user.email}</b>. The user picks their own password.</div>
              <div className="text-xs text-slate-500">The link is valid for a limited time. If email delivery is blocked, use &ldquo;Set directly&rdquo; instead.</div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          {mode === 'direct' ? (
            <button type="button" onClick={submitDirect} disabled={busy || pwd.length < 8}
              className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-40"
              data-testid="reset-direct-submit">{busy ? 'Setting…' : 'Set password'}</button>
          ) : (
            <button type="button" onClick={submitMagicLink} disabled={busy}
              className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-40"
              data-testid="reset-magic-submit">{busy ? 'Sending…' : 'Send reset link'}</button>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}


function ImportStatusBadge({ row }) {
  if (row.is_already_imported) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-slate-200 text-slate-600" title={row.already_imported_reason || ''}>Already imported</span>;
  }
  if (row.email_missing) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-amber-100 text-amber-800" title="Add an email in Simpro to import">Email missing</span>;
  }
  return <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-emerald-100 text-emerald-800">New</span>;
}

const ROLE_OPTIONS_IMPORT = [
  { value: 'worker', label: 'Field Worker' },
  { value: 'supervisor', label: 'Site Supervisor' },
  { value: 'hseq_lead', label: 'HSEQ Lead' },
  { value: 'admin', label: 'Admin' },
];

function ImportFromSimproDrawer({ companies, onClose, onDone }) {
  useLockBodyScroll();
  const allCompanyIds = useMemo(() => companies.map((c) => String(c.id)), [companies]);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  // Phase 3.21 — filterMode state retained internally as a constant
  // because the backend `/integrations/simpro/employees` endpoint still
  // accepts a `filter` query param. We pin it to `all` so the UI always
  // shows the full employee list (the whiteboard toggle is gone).
  const filterMode = 'all';
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  // Monotonically increasing request id used to discard stale responses
  // when the filter / company selection flips faster than the network can keep up.
  const reqIdRef = React.useRef(0);

  // Sync selectedCompanies to the companies prop on first arrival (and when
  // a new company appears that wasn't in the previous list — initial-population case).
  useEffect(() => {
    setSelectedCompanies((prev) => {
      if (prev.length === 0 && allCompanyIds.length > 0) return allCompanyIds;
      return prev;
    });
  }, [allCompanyIds]);

  // Fetch employees whenever companies/filter changes.
  // Uses a request-id guard so a slow earlier fetch can't overwrite a newer one.
  const fetchEmployees = async (ids, mode) => {
    if (ids.length === 0) { setEmployees([]); setSelected(new Set()); return; }
    reqIdRef.current += 1;
    const myReq = reqIdRef.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ company_ids: ids.join(','), filter: mode });
      const { data } = await api.get(`/integrations/simpro/employees?${qs.toString()}`);
      // Only commit results if this is still the latest in-flight request.
      if (reqIdRef.current !== myReq) return;
      setEmployees(data.employees || []);
      setSelected(new Set());
    } catch (e) {
      if (reqIdRef.current === myReq) toast.error(apiError(e));
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchEmployees(selectedCompanies, filterMode); }, [selectedCompanies.join(','), filterMode]);

  const toggleCompany = (cid) => {
    const k = String(cid);
    setSelectedCompanies((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
  };

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return employees;
    return employees.filter((e) =>
      (e.name || '').toLowerCase().includes(s)
      || (e.email || '').toLowerCase().includes(s)
      || (e.position || '').toLowerCase().includes(s)
    );
  }, [employees, search]);

  const importableVisible = visible.filter((e) => e.importable);

  const toggleRow = (e) => {
    if (!e.importable) return;
    const k = String(e.id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const selectAllVisible = () => setSelected(new Set(importableVisible.map((e) => String(e.id))));
  const clearSelection = () => setSelected(new Set());

  const submit = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const payload = {
        employees: employees.filter((e) => selected.has(String(e.id))).map((e) => ({
          simpro_employee_id: String(e.id),
          simpro_company_id: String(e.company_id),
          email: e.email,
          first_name: e.first_name || '',
          last_name: e.last_name || '',
          name: e.name,
          mobile: e.phone || null,
          position: e.position || null,
          company_name: e.company_name || null,
        })),
      };
      const { data } = await api.post('/users/import-from-simpro', payload);
      const parts = [`Imported ${data.created}`];
      if (data.skipped?.length) parts.push(`Skipped ${data.skipped.length}`);
      toast.success(parts.join(' · '), {
        description: data.skipped?.length
          ? data.skipped.slice(0, 3).map((s) => `${s.email}: ${s.reason}`).join('  ·  ')
          : undefined,
      });
      onDone?.();
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose} data-testid="import-simpro-drawer">
      <div className="bg-white w-full sm:max-w-4xl h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl">Import users from Simpro</h2>
            <p className="text-xs text-slate-500 mt-0.5">Pull staff from your connected Simpro companies into Users &amp; Permissions.</p>
          </div>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-700" aria-label="Close" data-testid="import-simpro-close">&times;</button>
        </div>

        <div className="px-6 py-4 border-b border-slate-200 space-y-3 bg-slate-50">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Companies</div>
            <div className="flex flex-wrap gap-1.5">
              {companies.map((c) => {
                const k = String(c.id);
                const on = selectedCompanies.includes(k);
                return (
                  <button key={k} type="button" onClick={() => toggleCompany(c.id)}
                    data-testid={`import-company-chip-${c.id}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'}`}>
                    {c.name || `Company ${c.id}`} <span className="opacity-70">#{c.id}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <SearchIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, or position"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                data-testid="import-search"
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-2 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="text-slate-600">
            <strong>{selected.size}</strong> selected · {importableVisible.length} importable · {visible.length} shown
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={selectAllVisible} disabled={importableVisible.length === 0}
              className="text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline"
              data-testid="import-select-all">Select all (importable)</button>
            <button type="button" onClick={clearSelection} disabled={selected.size === 0}
              className="text-slate-500 hover:underline disabled:text-slate-400 disabled:no-underline"
              data-testid="import-clear">Clear</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="px-6 py-12 text-center text-slate-500 text-sm inline-flex items-center gap-2 justify-center w-full">
              <Loader2 size={14} className="animate-spin" /> Loading employees from Simpro…
            </div>
          ) : visible.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 text-sm inline-flex items-center gap-2 justify-center w-full">
              <AlertCircle size={14} /> No employees match your filters.
            </div>
          ) : (
            <table className="zebra-list w-full text-sm">
              <thead className="bg-white text-[11px] uppercase tracking-wider text-slate-500 sticky top-0 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 w-8"></th>
                  <th className="text-left px-2 py-2.5">Name</th>
                  <th className="text-left px-2 py-2.5">Email</th>
                  <th className="text-left px-2 py-2.5">Mobile</th>
                  <th className="text-left px-2 py-2.5">Position</th>
                  <th className="text-left px-2 py-2.5">Company</th>
                  <th className="text-left px-2 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const k = String(e.id);
                  const checked = selected.has(k);
                  const disabled = !e.importable;
                  return (
                    <tr key={k} className={`border-t border-slate-100 ${disabled ? 'bg-slate-50/60 opacity-70' : 'hover:bg-slate-50 cursor-pointer'}`}
                      onClick={() => { if (!disabled) toggleRow(e); }} data-testid={`import-row-${e.id}`}>
                      <td className="px-4 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                        <input type="checkbox" checked={checked} disabled={disabled}
                          onChange={() => toggleRow(e)}
                          className="h-4 w-4 accent-blue-600 disabled:opacity-50 cursor-pointer"
                          data-testid={`import-checkbox-${e.id}`} />
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7"><AvatarFallback className="text-[10px]">{(e.name || '?')[0]}</AvatarFallback></Avatar>
                          <span className="font-medium">{e.name || '—'}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-xs text-slate-600">{e.email || <span className="text-slate-400 italic">—</span>}</td>
                      <td className="px-2 py-2.5 text-xs text-slate-600">{e.phone || '—'}</td>
                      <td className="px-2 py-2.5 text-xs text-slate-600">{e.position || '—'}</td>
                      <td className="px-2 py-2.5 text-xs text-slate-600">{e.company_name || `#${e.company_id}`}</td>
                      <td className="px-2 py-2.5"><ImportStatusBadge row={e} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-end gap-4 pr-32 sm:pr-40">
          <div className="flex-1 text-[11px] text-slate-500">
            New users land as <strong>role: worker</strong> with no workspace
            assignment. Adjust per-user via the ✏️ Edit drawer after import.
          </div>
          <div className="ml-auto inline-flex items-center gap-2">
            <button onClick={submit} disabled={busy || selected.size === 0}
              data-testid="import-submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold uppercase tracking-[0.12em] disabled:opacity-50 hover:bg-blue-700">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span data-testid="import-submit-label">
                Import {selected.size} {selected.size === 1 ? 'user' : 'users'}
              </span>
            </button>
            <button onClick={onClose} type="button" disabled={busy}
              data-testid="import-cancel"
              className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Phase 3.21 Item 3 — Session history tab. Admin-only; the backend
// endpoint enforces the role check so the worst case for a non-admin is
// a 403 with an empty render. We render the last 50 sessions per user
// with semantic chips per end_reason so an auditor can see WHY a session
// ended at a glance.
const END_REASON_CHIP = {
  idle:               { label: 'Idle timeout',     cls: 'bg-slate-100 text-slate-700' },
  explicit_logout:    { label: 'Signed out',        cls: 'bg-blue-100 text-blue-800' },
  admin_revoke:       { label: 'Admin revoked',     cls: 'bg-rose-100 text-rose-800' },
  force_logout_all:   { label: 'Force-logout all',  cls: 'bg-violet-100 text-violet-800' },
  absolute_timeout:   { label: 'Absolute expiry',   cls: 'bg-amber-100 text-amber-800' },
  token_version_bump: { label: 'Password change',   cls: 'bg-indigo-100 text-indigo-800' },
};

function SessionHistoryTab({ userId }) {
  const [rows, setRows] = React.useState(null);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    setRows(null); setError(null);
    api.get(`/admin/users/${userId}/session-history?limit=50`)
      .then((r) => { if (!cancelled) setRows(r.data?.history || []); })
      .catch((e) => { if (!cancelled) setError(apiError(e)); });
    return () => { cancelled = true; };
  }, [userId]);

  const fmt = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch (_) { return iso; }
  };

  if (error) return <div className="mt-5 text-sm text-rose-700" data-testid="session-history-error">{error}</div>;
  if (rows === null) return <div className="mt-5 text-sm text-slate-500">Loading session history…</div>;
  if (rows.length === 0) {
    return <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500" data-testid="session-history-empty">
      No session history for this user yet. History rows are written each time a session ends (idle timeout, sign-out, or admin revoke) and auto-purged after 30 days.
    </div>;
  }

  return (
    <div className="mt-5 rounded-xl border border-slate-200 overflow-x-auto" data-testid="session-history-table">
      <table className="zebra-list w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Login</th>
            <th className="text-left px-3 py-2 font-semibold">Ended</th>
            <th className="text-left px-3 py-2 font-semibold">Reason</th>
            <th className="text-left px-3 py-2 font-semibold">Role</th>
            <th className="text-left px-3 py-2 font-semibold">IP</th>
            <th className="text-left px-3 py-2 font-semibold">User agent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const chip = END_REASON_CHIP[r.end_reason] || { label: r.end_reason || 'Unknown', cls: 'bg-slate-100 text-slate-700' };
            return (
              <tr key={r.jti} className="border-t border-slate-100" data-testid={`session-history-row-${r.jti}`}>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap" title={r.login_at}>{fmt(r.login_at)}</td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap" title={r.ended_at}>{fmt(r.ended_at)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${chip.cls}`}>{chip.label}</span>
                </td>
                <td className="px-3 py-2 text-slate-700">{r.role || '—'}</td>
                <td className="px-3 py-2 text-slate-600 font-mono text-[12px]">{r.ip_address || '—'}</td>
                <td className="px-3 py-2 text-slate-500 text-[11px] max-w-[280px] truncate" title={r.user_agent || ''}>{r.user_agent || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// v160.3.1 — Simpro Worker Sync modal. Runs a dry-run first, shows the
// plan, then executes on confirm. Emits a snapshot_id the user can look
// up in the audit log (future UI). Idempotent — safe to re-click.
function RefreshFromSimproModal({ onClose, onDone }) {
  useLockBodyScroll();
  const [phase, setPhase] = React.useState('planning'); // planning | ready | running | done | error
  const [plan, setPlan] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setPhase('planning');
    api.post('/integrations/simpro/workers/refresh?dry_run=1')
      .then((r) => { if (!cancelled) { setPlan(r.data); setPhase('ready'); } })
      .catch((e) => { if (!cancelled) { setError(apiError(e)); setPhase('error'); } });
    return () => { cancelled = true; };
  }, []);

  const runIt = async () => {
    setPhase('running');
    try {
      const r = await api.post('/integrations/simpro/workers/refresh?dry_run=0');
      setResult(r.data);
      setPhase('done');
      toast.success(
        `Simpro refresh complete — ${r.data.counts.workers_new_created} new · ${r.data.counts.certs_added} certs added`,
        { description: `Snapshot: ${(r.data.snapshot_id || '').slice(0, 8)}` }
      );
      onDone?.();
    } catch (e) {
      setError(apiError(e));
      setPhase('error');
      toast.error('Simpro refresh failed');
    }
  };

  const c = plan?.counts;
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={phase === 'running' ? undefined : onClose}
         data-testid="refresh-simpro-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <RefreshCw size={18} />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-semibold text-slate-900">Refresh workers from Simpro</h3>
            <p className="mt-0.5 text-sm text-slate-600">
              Pulls live employee detail + licences via the Simpro API. Idempotent.
              PII allowlist: DoB, address, emergency contact only.
            </p>
          </div>
        </div>

        {phase === 'planning' && (
          <div className="py-8 flex items-center justify-center text-slate-500 text-sm gap-2" data-testid="refresh-simpro-planning">
            <Loader2 size={16} className="animate-spin" /> Planning changes…
          </div>
        )}

        {phase === 'ready' && c && (
          <div data-testid="refresh-simpro-plan" className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="grid grid-cols-2 gap-y-1.5">
                <div className="text-slate-500">Employees fetched</div>
                <div className="text-right font-semibold text-slate-900">{c.simpro_employees}</div>
                <div className="text-slate-500">Workers matched</div>
                <div className="text-right font-semibold text-slate-900">{c.workers_matched}</div>
                <div className="text-slate-500">New workers to create</div>
                <div className="text-right font-semibold text-emerald-700">{c.workers_new_created}</div>
                <div className="text-slate-500">Licences to add</div>
                <div className="text-right font-semibold text-emerald-700">{c.certs_added}</div>
                <div className="text-slate-500">Licences to update</div>
                <div className="text-right font-semibold text-amber-700">{c.certs_updated}</div>
                <div className="text-slate-500">Licences unchanged</div>
                <div className="text-right text-slate-500">{c.certs_unchanged}</div>
                <div className="text-slate-500">Workers with PII to populate</div>
                <div className="text-right font-semibold text-slate-900">{c.pii_workers_updated}</div>
              </div>
            </div>
            {plan.new_workers_preview?.length > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                <div className="font-semibold text-[11px] uppercase tracking-wider mb-1">
                  New workers to onboard ({plan.new_workers_preview.length})
                </div>
                <ul className="space-y-0.5">
                  {plan.new_workers_preview.slice(0, 12).map((n, i) => (
                    <li key={i} className="truncate">
                      <span className="font-medium">{n.simpro_name}</span>
                      <span className="text-emerald-700"> · {n.position || '—'}</span>
                      <span className="text-emerald-600 ml-1">({n.simpro_company === '2' ? 'Paneltec' : 'VTS'})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {phase === 'running' && (
          <div className="py-8 flex items-center justify-center text-slate-500 text-sm gap-2" data-testid="refresh-simpro-running">
            <Loader2 size={16} className="animate-spin" /> Applying changes to your workers…
          </div>
        )}

        {phase === 'done' && result && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" data-testid="refresh-simpro-done">
            <div className="font-semibold mb-1 flex items-center gap-1.5"><Check size={14} /> Sync applied successfully.</div>
            <div className="text-xs text-emerald-800">
              Snapshot ID: <span className="font-mono">{result.snapshot_id?.slice(0, 8)}</span> · use{' '}
              <span className="font-mono">POST /api/integrations/simpro/workers/rollback/{result.snapshot_id?.slice(0, 8)}…</span>{' '}
              to reverse this run.
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" data-testid="refresh-simpro-error">
            <div className="font-semibold mb-1 flex items-center gap-1.5"><AlertCircle size={14} /> Refresh failed.</div>
            <div className="text-xs text-rose-800">{error}</div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={phase === 'running'}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            data-testid="refresh-simpro-cancel-btn"
          >
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          {phase === 'ready' && (
            <button
              onClick={runIt}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 shadow-sm"
              data-testid="refresh-simpro-apply-btn"
            >
              <RefreshCw size={13} /> Apply now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}




