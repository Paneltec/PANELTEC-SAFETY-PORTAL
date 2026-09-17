import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Check, X as XIcon, Minus, RotateCcw, ShieldCheck, Save, Mail, Send, Download, Loader2, AlertCircle, Search as SearchIcon, LogOut, Trash2, KeyRound, AlertTriangle, Pencil, Sparkles, Wand2, RefreshCw, ChevronDown, ChevronRight, Lock, Unlock, GripVertical, QrCode, Printer } from 'lucide-react';
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
import { stashInlinePdf } from '../lib/pdfStash';
import DismissibleHint from '../components/DismissibleHint';
import { getUser } from '../lib/auth';
import { PageHeader } from '../components/capture/Ui';
import SimproImportPickerModal from '../components/simpro/SimproImportPickerModal';
import HowThisWorks from '../components/help/HowThisWorks';
import useDeepLinkOpen from '../lib/useDeepLinkOpen';
// Phase 4.17 v134.2 — Dashboard/List tabs.
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import ModuleDashboard from '../components/dashboards/ModuleDashboard';
import { RESOURCE_LABELS, EMAIL_SUPPORTED, TEAM_VIEW_SUPPORTED, DELETE_SUPPORTED, OPEN_VIEW_SUPPORTED, useCan } from '../lib/permissions';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
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
import { filesUrl } from '../lib/downloadUrl';
import useLockBodyScroll from '../lib/useLockBodyScroll';

// v160.3.9.41 — @dnd-kit sortable for the role-section reorder handle.
// Replaces the pair of up/down ArrowUp/ArrowDown buttons that used to
// live on each role-section header (see git blame: v160.3.9.33.1).
// The persistence contract is UNCHANGED — we still PUT to
// `/api/user-prefs/section-order/users` with `{section_order: [...]}`
// (per-viewer preference; every logged-in admin has their own saved
// order for their own view of the Users page). The keyboard sensor is
// dnd-kit's default (arrow keys with focus on the grip; Space to
// lift / drop). Individual user rows below each header retain their
// existing per-section sort dropdown (name/last-login/created).
import {
  DndContext, PointerSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  arrayMove, useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS as DndCSS } from '@dnd-kit/utilities';

// v160.3.9.42.3 — Bug 1: Aaron Foster's Simpro-imported photo was a
// 512×512 solid-purple placeholder PNG (11,881 bytes, fetch HTTP 200,
// image loads fine, `object-cover` renders it correctly — but the
// SOURCE is junk). User asked to fall back to initials for cases
// like this. Detection: after `onLoad`, draw the image into a 4×4
// canvas and compute channel-wise variance. Real photos score >>100;
// mono-color placeholders score ~0. Threshold 30 catches solid
// blocks + heavily-JPEG-artefacted single-colour tiles without false-
// positiving muted-but-real photos.
function getInitials(name, email) {
  const src = (name || '').trim();
  if (src) {
    const tokens = src.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
    if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  }
  const e = (email || '').trim();
  if (e) {
    const [local, domain] = e.split('@');
    const two = ((local && local[0]) || '') + ((domain && domain[0]) || '');
    if (two) return two.toUpperCase();
  }
  return '?';
}

// v160.3.9.42.3 — Bug 1: Aaron Foster's Simpro-imported photo was a
// 512×512 solid-purple placeholder PNG (11,881 bytes, fetch HTTP 200,
// image loads fine, `object-cover` renders it correctly — but the
// SOURCE is junk). User asked to fall back to initials for cases
// like this. Detection: after `img.decode()`, draw the image into a
// 4×4 canvas and compute channel-wise variance. Live calibration on
// 12 users (v42.3 diagnostic): mono-purple Aaron scored 114.93,
// LOWEST real photo (Dominic Goold) scored 1,608. Threshold 500 is
// 4.4× above the mono-placeholder ceiling and 3.2× below the real-
// photo floor — comfortable margin either way. Same-origin URL
// (…/api/…?token=…) so canvas readback is not CORS-tainted; no
// `crossOrigin` attribute needed and adding one would BREAK the
// probe by forcing strict CORS on requests that don't need it.
function isMonoColorImage(imgEl) {
  try {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 4;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(imgEl, 0, 0, 4, 4);
    const data = ctx.getImageData(0, 0, 4, 4).data;
    const sums = [0, 0, 0], sumSq = [0, 0, 0];
    for (let i = 0; i < 16; i++) {
      for (let ch = 0; ch < 3; ch++) {
        const v = data[i * 4 + ch];
        sums[ch] += v;
        sumSq[ch] += v * v;
      }
    }
    let totalVar = 0;
    for (let ch = 0; ch < 3; ch++) {
      const mean = sums[ch] / 16;
      totalVar += (sumSq[ch] / 16) - (mean * mean);
    }
    return totalVar < 500;
  } catch (_) {
    return false;
  }
}

function InitialsAvatar({ initials, testId, className }) {
  return (
    <div
      className={className || "w-14 h-14 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-sm font-semibold text-slate-600 shrink-0 select-none"}
      data-testid={testId}
      aria-label={`Avatar initials ${initials}`}>
      {initials}
    </div>
  );
}

// v160.3.9.41.2 — <AvatarImage> wrapper that resolves the raw
// `photo_url` string returned by `GET /api/users` (e.g.
// `/api/workers/{id}/photo/{gid}` or `/api/files/document_library/…`)
// through `filesUrl()`. This appends the short-lived signed-download
// JWT that v40 SEC-004 now requires on every `/api/files/*` and
// `/api/workers/*/photo/*` endpoint. Without this wrapper the raw
// URL 401s server-side and the browser silently falls back to the
// initials tile — the exact failure the v41.1 diagnostic caught
// (13 users enriched by backend, 0 <img> avatars visible in DOM).
// v160.3.9.42.3 — Bug 1: on `onLoad` we now also probe the decoded
// pixels for mono-colour placeholders (see `isMonoColorImage`). If
// the source is a solid block, we treat it as broken and render the
// initials fallback instead. Callers pass `initials` + `fallbackTestId`.
function UserAvatarImage({ rawSrc, alt, testId, className, initials, fallbackTestId }) {
  const [resolvedSrc, setResolvedSrc] = React.useState(null);
  const [broken, setBroken] = React.useState(false);
  const imgRef = React.useRef(null);
  React.useEffect(() => {
    let alive = true;
    setBroken(false);
    if (!rawSrc) { setResolvedSrc(null); return () => { alive = false; }; }
    filesUrl(rawSrc)
      .then((url) => { if (alive) setResolvedSrc(url); })
      .catch(() => { if (alive) { setResolvedSrc(null); setBroken(true); } });
    return () => { alive = false; };
  }, [rawSrc]);
  // v160.3.9.42.3 — Run the mono-colour probe AFTER `resolvedSrc` lands.
  // `<img crossOrigin>` is intentionally omitted because the photo URL is
  // same-origin (…/api/workers/…?token=…) — adding crossOrigin forces
  // strict CORS on a request that never needed it and taints the canvas.
  // We use `img.decode()` when available so we know the pixels are ready
  // before drawing; onLoad-only would miss cached hits on some browsers.
  React.useEffect(() => {
    if (!resolvedSrc) return;
    let alive = true;
    const el = imgRef.current;
    if (!el) return;
    const check = () => {
      if (!alive) return;
      if (isMonoColorImage(el)) setBroken(true);
    };
    if (el.complete && el.naturalWidth > 0) {
      // Cached hit — canvas is ready right now.
      queueMicrotask(check);
    } else if (typeof el.decode === 'function') {
      el.decode().then(check).catch(() => {});
    }
    return () => { alive = false; };
  }, [resolvedSrc]);
  if (!resolvedSrc || broken) {
    return <InitialsAvatar initials={initials || '?'} testId={fallbackTestId} />;
  }
  return (
    <img
      ref={imgRef}
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={(e) => { if (isMonoColorImage(e.target)) setBroken(true); }}
      onError={() => setBroken(true)}
      className={className || "w-14 h-14 rounded-full object-cover border border-slate-200 bg-white shrink-0"}
      data-testid={testId}
    />
  );
}

// v160.3.9.41 — Sortable section-header row for the Users & Permissions
// table. Wraps a `<tr>` in dnd-kit's `useSortable`. Applies the
// transform + transition styles from the hook so a lift-and-drop
// animates the underlying row. The children render prop receives
// `(listeners, attributes, isDragging)` so callers can bind them to
// their own grip button — keeps the drag-target scoped to the grip
// instead of the whole row (users can still click "Toggle section"
// / "Sort dropdown" without kicking off a drag).
function SortableSectionHeaderTr({ id, colour, colCount, canEdit, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !canEdit });
  const style = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    // Slightly lift + shadow the dragged row so the user can see it move.
    zIndex: isDragging ? 20 : undefined,
    position: isDragging ? 'relative' : undefined,
    boxShadow: isDragging ? '0 6px 16px -4px rgba(0,0,0,0.18)' : undefined,
  };
  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`${colour.bg} border-t-2 ${colour.border}`}
      data-testid={`role-section-${id}`}
      data-dragging={isDragging ? 'true' : 'false'}>
      <td colSpan={colCount} className="px-3 py-1.5">
        {children(listeners, attributes, isDragging)}
      </td>
    </tr>
  );
}

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
      // v160.3.9.33 — Phase 4d: pass through `source` verbatim from the
      // backend. DB rows now carry one of "seed" / "admin_created" /
      // "simpro_position_auto" (see roles_catalogue.py). Fallback to
      // "admin_created" for legacy custom rows still missing the field.
      const seeded = (data?.roles || []).map((r) => ({
        role_id: r.role_id,
        name: r.name || r.role_id,
        is_active: r.is_active !== false,
        source: r.source || (r.is_system ? 'seed' : 'admin_created'),
        is_system: !!r.is_system,
        permission_tokens_count: (r.permission_tokens || []).length,
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

// v160.3.9.33 — Bust the module-level cache after any role mutation so
// sibling components pick up the change without a full page reload.
export function bustRolesCache() {
  _rolesCache = null;
}

// Kept for backward compat while sub-phase 2b/2c files still reference
// these arrays. Prefer `useSystemRoles()` for anything new.
const ROLES = LEGACY_ROLES.map((r) => r.role_id);
const ROLE_LABELS = Object.fromEntries(LEGACY_ROLES.map((r) => [r.role_id, r.name]));
// v58.13.132r-4 — `pending_invite` added so Simpro-hydrated users
// (activation_status='pending_activation') aren't hidden by the default
// status filter. See sync_workers_to_users_v58_13_132r_hotfix.py.
const STATUSES = ['active', 'pending_invite', 'invited', 'disabled'];

// v160.3.9.33 — Phase 4d — position → role slug.
// Each unique Simpro position IS a Paneltec role (`custom_<slug>`),
// auto-created on Simpro import + selectable manually via the bulk
// dialog's "Create '<position>' role" affordance. Slug rules must
// match `_slugify()` in backend/roles_catalogue.py exactly: lowercase
// alphanumerics separated by underscores, everything else collapsed.
function slugifyPosition(position) {
  const p = (position || '').trim().toLowerCase();
  if (!p) return '';
  return p.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'role';
}

// Returns the role_id that matches this position, or a special
// synthetic role_id `__create_from_position__` if the position is
// set but no matching role exists yet. Returns null when the user
// has no simpro_position (falls back to manual pick from seed list).
function positionRoleFor(user, systemRoles) {
  const pos = user?.simpro_position || '';
  if (!pos) return null;
  const slug = 'custom_' + slugifyPosition(pos);
  const found = systemRoles.find((r) => r.role_id === slug && r.is_active !== false);
  if (found) return found.role_id;
  return '__create_from_position__';
}

// v160.3.9.33.1 — Deterministic role → colour hash. 12 accessible pastels
// mapped by role_id string hash. Special-cases: `admin` = warm rose
// (attention), `general_user` = neutral slate, HSEQ family = compliance
// blue. All bg/fg pairs pass WCAG AA on section-header text size.
const ROLE_COLOUR_PALETTE = [
  { bg: 'bg-emerald-50',  border: 'border-emerald-200', fg: 'text-emerald-800', accent: 'bg-emerald-500' },
  { bg: 'bg-sky-50',      border: 'border-sky-200',     fg: 'text-sky-800',     accent: 'bg-sky-500' },
  { bg: 'bg-amber-50',    border: 'border-amber-200',   fg: 'text-amber-800',   accent: 'bg-amber-500' },
  { bg: 'bg-cyan-50',     border: 'border-cyan-200',    fg: 'text-cyan-800',    accent: 'bg-cyan-500' },
  { bg: 'bg-teal-50',     border: 'border-teal-200',    fg: 'text-teal-800',    accent: 'bg-teal-500' },
  { bg: 'bg-indigo-50',   border: 'border-indigo-200',  fg: 'text-indigo-800',  accent: 'bg-indigo-500' },
  { bg: 'bg-pink-50',     border: 'border-pink-200',    fg: 'text-pink-800',    accent: 'bg-pink-500' },
  { bg: 'bg-lime-50',     border: 'border-lime-200',    fg: 'text-lime-800',    accent: 'bg-lime-600' },
  { bg: 'bg-violet-50',   border: 'border-violet-200',  fg: 'text-violet-800',  accent: 'bg-violet-500' },
  { bg: 'bg-orange-50',   border: 'border-orange-200',  fg: 'text-orange-800',  accent: 'bg-orange-500' },
  { bg: 'bg-fuchsia-50',  border: 'border-fuchsia-200', fg: 'text-fuchsia-800', accent: 'bg-fuchsia-500' },
  { bg: 'bg-yellow-50',   border: 'border-yellow-200',  fg: 'text-yellow-800',  accent: 'bg-yellow-500' },
];
export function roleColour(role_id) {
  if (!role_id) return { bg: 'bg-slate-100', border: 'border-slate-200', fg: 'text-slate-700', accent: 'bg-slate-400' };
  if (role_id === 'admin') return { bg: 'bg-rose-50', border: 'border-rose-200', fg: 'text-rose-800', accent: 'bg-rose-500' };
  if (role_id === 'general_user') return { bg: 'bg-slate-50', border: 'border-slate-200', fg: 'text-slate-700', accent: 'bg-slate-400' };
  if (role_id.startsWith('hseq_')) return { bg: 'bg-blue-50', border: 'border-blue-200', fg: 'text-blue-800', accent: 'bg-blue-600' };
  let h = 0;
  for (let i = 0; i < role_id.length; i++) h = ((h << 5) - h) + role_id.charCodeAt(i);
  return ROLE_COLOUR_PALETTE[Math.abs(h) % ROLE_COLOUR_PALETTE.length];
}


const STATUS_LABELS = { active: 'Active', pending_invite: 'Pending invite', invited: 'Invited', disabled: 'Disabled' };
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
  else if (status === 'pending_invite') { key = 'invited'; label = 'Pending invite'; }
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
  // v57.3 — client-side search across name / email / role / role_id /
  // simpro_position / activation_status. Debounced ~150 ms so typing
  // stays snappy at the current dataset size (~90 users). The search
  // slots ahead of the existing role/status filter so segment counts
  // reflect the filtered subset ("5 of 63 active matching 'smith'").
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  // v57.4 — Saved views (localStorage-only, no backend). Built-in
  // "default" views live alongside user-created ones. Storage limit
  // 20 user views; guard against private-mode localStorage failures
  // by treating any thrown Error as "storage unavailable" and hiding
  // the Save button (chip row still works with in-memory defaults).
  const DEFAULT_VIEWS = React.useMemo(() => ([
    { id: 'built-in-active',   name: 'All active',        builtin: true, config: { search: '', filters: { role: '', status: 'active' } } },
    { id: 'built-in-pending',  name: 'Pending inductees', builtin: true, config: { search: '', filters: { role: '', status: 'pending_invite' } } },
    { id: 'built-in-archived', name: 'Archived only',     builtin: true, config: { search: '', filters: { role: '', status: 'archived' } } },
  ]), []);
  const [savedViews, setSavedViews] = useState([]);
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('paneltec_users_saved_views');
      setSavedViews(raw ? (JSON.parse(raw) || []) : []);
      setStorageAvailable(true);
    } catch { setStorageAvailable(false); setSavedViews([]); }
  }, []);
  const persistViews = React.useCallback((next) => {
    setSavedViews(next);
    try { window.localStorage.setItem('paneltec_users_saved_views', JSON.stringify(next)); }
    catch { /* private mode — silently degrade */ }
  }, []);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState('');
  const applyView = React.useCallback((view) => {
    const cfg = view.config || {};
    setSearch(cfg.search || '');
    setFilters(cfg.filters || { role: '', status: 'active' });
  }, []);
  const [active, setActive] = useState(null);
  const [activeTab, setActiveTab] = useState('profile');
  // v58.13.119 — Ask Intelligence deep-link (`?open=<id>&tab=profile`).
  // On mount, read the id + optional tab, look up the user row once
  // load() completes, open the drawer. Strip the params so back-nav
  // doesn't re-open. Reuses the same `active` drawer wire as row-click.
  const { deepLinkId } = useDeepLinkOpen({
    items: users,
    loading: users.length === 0,  // proxy: while users is empty we consider it loading
    notFoundMessage: 'Linked user not found',
    extraParams: ['tab'],
  });
  useEffect(() => {
    if (!deepLinkId || active) return;
    const row = users.find((u) => u.id === deepLinkId);
    if (row) {
      setActiveTab('profile');
      setActive(row);
    }
  }, [deepLinkId, users, active]);
  // v160.3.9.32-4c — Phase 4c grouped-by-role sections. Local state only
  // (URL persistence is a later polish).
  const [sectionOpen, setSectionOpen] = useState({});
  // v160.3.9.42.3 — Bug 3: "Refresh from Simpro" tactile-feedback state.
  const [isRefreshingSimpro, setIsRefreshingSimpro] = useState(false);
  // v58.13.132hs — Auto-provision toolbar state.
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [bulkInviteConfirm, setBulkInviteConfirm] = useState(false);
  const [isBulkInviting, setIsBulkInviting] = useState(false);
  // v160.3.9.42.1 — `sectionSort` state retired with the dropdown. Users
  // & Permissions rows now render in alphabetical (A-Z) order in every
  // section, per user request.
  // v160.3.9.33.1 — Persisted section order from /user-prefs/section-order/users
  const [sectionOrder, setSectionOrder] = useState([]);  useEffect(() => {
    api.get('/user-prefs/section-order/users')
      .then(({ data }) => setSectionOrder(data?.section_order || []))
      .catch(() => setSectionOrder([]));
  }, []);

  // v160.3.9.41 — dnd-kit sensors: pointer for mouse/touch, keyboard for a11y.
  // 8-px activation distance on the pointer sensor prevents accidental drags
  // when the user just meant to click the grip's tooltip.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
  // v160.3.9.32-4c.3 — Assign-Role dialog target. `null` = closed;
  // otherwise `{ users: [user, ...] }` for single or bulk assignment.
  const [assignRoleTarget, setAssignRoleTarget] = useState(null);
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

  // v57.3 — Multi-token AND-match across name / email / role / role_id /
  // simpro_position / activation_status. Returns a stable memoised
  // predicate so the row filter + segment counters use identical logic.
  const searchTokens = useMemo(() => (
    debouncedSearch.trim().toLowerCase().split(/\s+/).filter(Boolean)
  ), [debouncedSearch]);
  const matchesSearch = useMemo(() => {
    if (!searchTokens.length) return () => true;
    return (u) => {
      const hay = [
        u.name, u.email, u.role, u.role_id, u.simpro_position, u.activation_status,
      ].filter(Boolean).join(' ').toLowerCase();
      return searchTokens.every((t) => hay.includes(t));
    };
  }, [searchTokens]);

  // Segment counts recomputed against the search-filtered set so the
  // header reflects the visible subset ("5 of 63 active matching 'smith'").
  const searchSegments = useMemo(() => {
    let active = 0, pending = 0, archived = 0, testHidden = 0;
    for (const u of users) {
      if (!matchesSearch(u)) continue;
      if (u.is_test_fixture) { testHidden += 1; continue; }
      const s = u.activation_status;
      if (s === 'pending_activation') pending += 1;
      else if (s === 'suspended' || u.is_archived) archived += 1;
      else active += 1;
    }
    return { active, pending, archived, testHidden };
  }, [users, matchesSearch]);

  if (!can('users', 'view')) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500" data-testid="users-denied">Access denied — you need users.view permission.</div>;
  }
  const filtered = users.filter((u) => matchesSearch(u) && (!filters.role || u.role === filters.role) && (!filters.status || u.status === filters.status));
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

  // v57.3 — Highlight helper used by the row cells to mark search
  // matches inline. Green `<mark>` styled to match the User Manual
  // highlight for cross-page consistency (#16A34A bg + white text).
  const highlight = (text) => {
    const s = String(text ?? '');
    if (!s || !searchTokens.length) return s;
    // Longest tokens first so shorter overlapping tokens don't win.
    const toks = [...searchTokens].sort((a, b) => b.length - a.length);
    const rx = new RegExp('(' + toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    const out = [];
    let last = 0, m;
    while ((m = rx.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      out.push(
        <mark
          key={`m${m.index}`}
          style={{ background: '#16A34A', color: '#FFFFFF', padding: '1px 3px', borderRadius: 3, fontWeight: 700 }}
        >{m[0]}</mark>
      );
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };

  // v160.3.9.32-4c — Phase 4c: user-row renderer factored out so both the
  // legacy flat map and the new group-by-role sections can share the same
  // row markup. Uses closure over the surrounding component state.
  const renderUserRow = (u) => (
    <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => { setActiveTab('profile'); setActive(u); }} data-testid={`user-row-${u.id}`}>
      {can('users', 'edit') && (
        <td className="px-3 py-1 align-middle" onClick={(e) => e.stopPropagation()}>
          {u.id !== me?.id && (
            <input type="checkbox"
              checked={bulkSelected.has(u.id)}
              onChange={() => toggleBulk(u.id)}
              data-testid={`user-checkbox-${u.id}`}
              className="h-4 w-4 accent-rose-600" />
          )}
        </td>
      )}
      <td className="px-4 py-1 align-middle">
        <div className="flex items-center gap-2">
          {/* v160.3.9.42.1 — Match the Workers-portal avatar exactly.
              Shadcn <Avatar> + <AvatarImage> used `aspect-square h-full w-full`
              WITHOUT `object-cover`, so browsers defaulted to `object-fit: fill`
              which stretches non-1:1 photos and produces the skew + soft look
              the user flagged. Workers renders a bare `<img w-10 h-10 rounded-full
              object-cover border ...>` — no Radix wrapper. We do the same here
              at 56 px (h-14) so the photo is legible AND crisp. Initials
              fallback uses the identical square-round + object-cover discipline
              via a plain <div>. */}
          {u.photo_url ? (
            <UserAvatarImage
              rawSrc={u.photo_url}
              alt={u.name || u.email || ''}
              testId={`user-photo-${u.id}`}
              initials={getInitials(u.name, u.email)}
              fallbackTestId={`user-photo-fallback-${u.id}`}
              className="w-14 h-14 rounded-full object-cover border border-slate-200 bg-white shrink-0"
            />
          ) : (
            <InitialsAvatar
              initials={getInitials(u.name, u.email)}
              testId={`user-photo-fallback-${u.id}`}
            />
          )}
          <div className="min-w-0">
            <div className="font-medium flex items-center gap-1.5 leading-tight">
              <span className="truncate">{highlight(u.name)}</span>
              {u.role_locked && (
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 inline-flex items-center gap-0.5"
                  title="Role manually locked — Simpro sync won't change it"
                  data-testid={`locked-badge-${u.id}`}><Lock size={8} /> Locked</span>
              )}
              {u.is_test_fixture && (
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
                  title="Test fixture"
                  data-testid={`test-fixture-badge-${u.id}`}>Test</span>
              )}
              {u.activation_status === 'pending_activation' && (
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200"
                  title="Pending activation"
                  data-testid={`pending-badge-${u.id}`}>Pending</span>
              )}
              {u.is_archived && (
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 border border-slate-300"
                  title="Archived"
                  data-testid={`archived-badge-${u.id}`}>Archived</span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 truncate">{highlight(u.email)}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-1 align-middle">
        {/* v160.3.9.33.1 — Show role NAME (never the raw custom_ slug). */}
        <span className="text-xs px-2 py-0.5 bg-slate-100 rounded font-medium" data-testid={`role-chip-${u.id}`}>
          {(() => {
            const key = u.role_id || u.role;
            const sys = systemRoles.find((r) => r.role_id === key);
            if (sys) return sys.name;
            if (key && key.startsWith('custom_')) {
              return key.replace(/^custom_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            }
            return key || '—';
          })()}
        </span>
        {u.has_permission_overrides && (
          <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200"
            title="This user has permission overrides on top of their role defaults"
            data-testid={`overrides-badge-${u.id}`}>+ Overrides</span>
        )}
      </td>
      <td className="px-4 py-1 align-middle"><StatusPill user={u} /></td>
      <td className="px-4 py-1 align-middle text-[11px] text-slate-500">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
      {can('users', 'edit') && (
        <td className="px-4 py-1 align-middle text-right" onClick={(e) => e.stopPropagation()}>
          <div className="inline-flex gap-1 items-center">
            {!u.role_id && u.activation_status === 'pending_activation' && (
              <button
                title="Assign a role to activate this pending user"
                data-testid={`assign-role-btn-${u.id}`}
                onClick={() => setAssignRoleTarget({ users: [u] })}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700"
              >Assign role</button>
            )}
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
            {/* v57.3 — When a search is live, show "N of M" so the user
                sees both the filtered subset AND the total. */}
            {debouncedSearch.trim() ? (
              <>
                <span data-testid="users-seg-active"><b className="text-slate-900">{searchSegments.active}</b> of {segments.active} active matching “{debouncedSearch}”</span>
                <span className="text-slate-300">·</span>
                <span data-testid="users-seg-pending"><b className="text-slate-900">{searchSegments.pending}</b> of {segments.pending} pending</span>
                <span className="text-slate-300">·</span>
                <span data-testid="users-seg-archived"><b className="text-slate-900">{searchSegments.archived}</b> of {segments.archived} archived</span>
              </>
            ) : (
              <>
                <span data-testid="users-seg-active"><b className="text-slate-900">{segments.active}</b> active</span>
                <span className="text-slate-300">·</span>
                <span data-testid="users-seg-pending"><b className="text-slate-900">{segments.pending}</b> pending activation</span>
                <span className="text-slate-300">·</span>
                <span data-testid="users-seg-archived"><b className="text-slate-900">{segments.archived}</b> archived</span>
              </>
            )}
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
            {/* v160.3.9.42.3 — Refresh button now surfaces an in-flight
                affordance. `POST /admin/simpro/sync-linked` typically
                takes 25-40s (real Simpro API round-trip), so the previous
                no-feedback UX gave the (correct) impression the button
                did nothing. `isRefreshingSimpro` state + spinner + 500ms
                min-visible floor mirrors the Backup dashboard fix in v39. */}
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
                if (isRefreshingSimpro) return;
                setIsRefreshingSimpro(true);
                const started = Date.now();
                try {
                  const { data } = await api.post('/admin/simpro/sync-linked');
                  toast.success(`Synced ${data.scanned} · Updated ${data.changed}`);
                  // v160.3.9.43.2 — Also refresh the "Synced X ago" pill.
                  // Backend now writes a `worker_import_snapshots` row on
                  // every sync-linked success, so this refetch will pick
                  // up the fresh timestamp and the stale ZIP-import pill
                  // updates to "just now" without a page reload.
                  await Promise.all([load(), loadLastSync()]);
                } catch (e) {
                  toast.error(apiError(e));
                } finally {
                  const elapsed = Date.now() - started;
                  const remaining = Math.max(0, 500 - elapsed);
                  setTimeout(() => setIsRefreshingSimpro(false), remaining);
                }
              }}
              data-testid="refresh-from-simpro-btn"
              data-refreshing={isRefreshingSimpro ? 'true' : 'false'}
              disabled={!simproStatus.connected || isRefreshingSimpro}
              title={simproStatus.connected ? 'Refresh linked users from Simpro' : 'Connect Simpro first'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0093D0] text-white text-sm font-semibold border border-[#0093D0] hover:bg-[#0079AB] hover:border-[#0079AB] focus:outline-none focus:ring-2 focus:ring-[#0093D0]/40 disabled:opacity-60 shadow-sm"
            >
              <RefreshCw size={14} className={isRefreshingSimpro ? 'animate-spin' : ''} />
              {isRefreshingSimpro ? 'Refreshing…' : 'Refresh from Simpro'}
            </button>
            <button onClick={() => setSimproPickerOpen(true)} data-testid="simpro-picker-btn"
              disabled={!simproStatus.connected}
              title={simproStatus.connected ? 'Choose Simpro employees to import into this workspace' : 'Connect Simpro first'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50">
              <FlPersonAdd /> Add employees from Simpro
            </button>
            {/* v58.13.132hs — Auto-provisioning toolbar. Backfill scans
                every worker in the org and creates a status=invited
                user for those without one (no emails sent). Send-pending
                emails every status=invited user that has NEVER been
                emailed. Both admin-gated on the backend. */}
            <button
              onClick={async () => {
                if (isBackfilling) return;
                setIsBackfilling(true);
                try {
                  const { data } = await api.post('/workers/backfill-user-provision');
                  toast.success(
                    `Backfill · Scanned ${data.scanned} · New ${data.invited_pending_send} · ` +
                    `Conflict ${data.email_conflict} · No email ${data.no_email} · Already linked ${data.already_linked}`,
                    { duration: 6000 },
                  );
                  await load();
                } catch (e) { toast.error(apiError(e)); }
                finally { setIsBackfilling(false); }
              }}
              data-testid="backfill-provision-btn"
              disabled={isBackfilling || !can('users', 'edit')}
              title="Create user accounts for workers without one (no emails sent)"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-slate-700 text-sm font-semibold border border-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              <UserPlus size={14} className={isBackfilling ? 'animate-spin' : ''} />
              {isBackfilling ? 'Backfilling…' : 'Provision users for workers'}
            </button>
            <button
              onClick={() => setBulkInviteConfirm(true)}
              data-testid="bulk-send-invites-btn"
              disabled={!can('users', 'edit')}
              title="Send invite emails to every user in Invited state that has never been emailed"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold border border-emerald-700 hover:bg-emerald-700 disabled:opacity-60"
            >
              <Send size={14} />
              Send pending invites
            </button>
          </div>) : null} />

      {/* v160.3.9.33.2 — photo reminder banner */}
      {can('users', 'edit') && (
        <DismissibleHint
          storageKey="paneltec.hint.users-zip-photos-v33_2"
          testId="users-photo-hint"
          text="Missing photos on some users? A fresh Simpro ZIP export uploaded via Workers will populate photos + link them to Users."
          linkTo="/app/workers"
          linkLabel="Go to Workers →"
        />
      )}

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
              onClick={() => setFilters((f) => ({ ...f, status: 'pending_invite' }))}
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
        <TabsList variant="pill-pair">
          <TabsTrigger variant="pill-pair" emphasis="secondary" value="dashboard" data-testid="users-tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger variant="pill-pair" emphasis="primary" value="list" data-testid="users-tab-list">
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
          {/* v58.13.132bg — Filter dropdown restricted to the 4 core
              seed roles (`is_system=true`). Legacy fallback rows
              (worker / supervisor / auditor / hseq_lead) baked into
              LEGACY_ROLES and any admin-created / simpro-position-auto
              custom roles are excluded — the `.132bd` sweep guarantees
              zero active users hold non-core role_ids. Order is
              deterministic: Admin → org roles alphabetical → External
              Contractor last. */}
          {systemRoles
            .filter((r) => r.is_system === true && r.is_active !== false)
            .sort((a, b) => {
              const rank = (id) => id === 'admin' ? 0 : id === 'external_contractor' ? 2 : 1;
              const ra = rank(a.role_id); const rb = rank(b.role_id);
              if (ra !== rb) return ra - rb;
              return (a.name || a.role_id).localeCompare(b.name || b.role_id);
            })
            .map((r) => (
              <option key={r.role_id} value={r.role_id} data-testid={`users-role-filter-opt-${r.role_id}`}>
                {r.name}
              </option>
            ))}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5" data-testid="users-status-filter">
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
        </select>
        {filters.status === 'active' && segments.pending > 0 && (
          <span className="text-[11px] text-slate-500" data-testid="users-pending-hint">
            · {segments.pending} pending hidden ·{' '}
            <button onClick={() => setFilters({ ...filters, status: 'pending_invite' })}
              className="text-blue-600 hover:underline" data-testid="users-pending-hint-show">show</button>
          </span>
        )}
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
            {(() => {
              // v160.3.9.33 — Phase 4d simplification:
              //   • ALL selected users have role_id → HIDE the button.
              //   • SOME need a role → render as a small text-link.
              //   • ALL need a role → render as the primary violet button.
              const pending = users.filter((u) => bulkSelected.has(u.id)
                && !u.role_id && u.activation_status === 'pending_activation');
              if (pending.length === 0) return null;
              const isAllPending = pending.length === bulkSelected.size;
              if (isAllPending) {
                return (
                  <button
                    onClick={() => setAssignRoleTarget({ users: pending })}
                    title={`Assign role to ${pending.length} pending user${pending.length === 1 ? '' : 's'}`}
                    data-testid="users-bulk-assign-role-btn"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700"
                  >
                    <ShieldCheck size={13} /> Assign role ({pending.length})
                  </button>
                );
              }
              return (
                <button
                  onClick={() => setAssignRoleTarget({ users: pending })}
                  title={`Assign role to the ${pending.length} pending user${pending.length === 1 ? '' : 's'} in your selection`}
                  data-testid="users-bulk-assign-role-btn"
                  className="text-xs text-violet-700 hover:text-violet-900 hover:underline font-semibold"
                >
                  <ShieldCheck size={11} className="inline" /> Assign role to {pending.length} pending
                </button>
              );
            })()}
            <button onClick={() => setBulkConfirmOpen(true)}
              data-testid="users-bulk-delete-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
              <FlDelete /> Delete {bulkSelected.size} user{bulkSelected.size === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>

      {/* v57.4 — Saved-views chip row. Rendered above the search
          input. Built-in views are uneditable and non-deletable;
          user-created chips get an inline × delete affordance. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="users-saved-views">
        {[...DEFAULT_VIEWS, ...savedViews].map((v) => (
          <span key={v.id} className="inline-flex items-center gap-1 group">
            <button
              type="button"
              onClick={() => applyView(v)}
              data-testid={`users-view-${v.id}`}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${v.builtin ? 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200' : 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'}`}
            >
              {v.name}
            </button>
            {!v.builtin && (
              <button
                type="button"
                onClick={() => persistViews(savedViews.filter((s) => s.id !== v.id))}
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 text-xs"
                data-testid={`users-view-delete-${v.id}`}
                aria-label={`Delete saved view ${v.name}`}
                title="Delete this view"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {/* v57.3 — Search bar above the users table. Debounced client-side
          filter across name / email / role / role_id / simpro_position /
          activation_status. Clear via ×, Esc, or emptying the input. */}
      <div className="mb-3 flex items-center gap-2" data-testid="users-search-wrap">
        <div className="relative flex-1 max-w-xl">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setSearch(''); }}
            placeholder="Search users by name, email, role, or Simpro position…"
            className="w-full pl-9 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
            data-testid="users-search"
            aria-label="Search users"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:bg-slate-100"
              data-testid="users-search-clear"
              aria-label="Clear search"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
        {debouncedSearch.trim() && (
          <span data-testid="users-search-count" className="text-xs text-slate-500">
            <b className="text-slate-800">{filtered.length}</b> match{filtered.length === 1 ? '' : 'es'}
          </span>
        )}
        {/* v57.4 — Save-as-view button. Hidden if localStorage is
            unavailable (private browsing). */}
        {storageAvailable && (search.trim() || filters.status !== 'active' || filters.role) && (
          <button
            type="button"
            onClick={() => { setSaveDialogName(search.trim() || 'My view'); setSaveDialogOpen(true); }}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
            data-testid="users-save-view-btn"
          >
            Save as view
          </button>
        )}
      </div>

      {/* v57.4 — Inline save-view dialog (localStorage-only). */}
      {saveDialogOpen && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" data-testid="users-save-view-dialog">
          <span className="text-xs font-semibold text-slate-600">Save view as:</span>
          <input
            autoFocus
            value={saveDialogName}
            onChange={(e) => setSaveDialogName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setSaveDialogOpen(false); }}
            className="flex-1 max-w-xs px-2 py-1 text-sm border border-slate-300 rounded"
            data-testid="users-save-view-name"
            placeholder="Give the view a name…"
          />
          <button
            type="button"
            onClick={() => {
              const name = saveDialogName.trim();
              if (!name) return;
              if (savedViews.length >= 20) {
                toast.error('You have 20 saved views — delete one before creating a new one.');
                return;
              }
              const next = [...savedViews, { id: `view-${Date.now()}`, name, config: { search, filters } }];
              persistViews(next);
              setSaveDialogOpen(false);
              toast.success(`Saved view “${name}”`);
            }}
            className="text-[11px] font-bold px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
            data-testid="users-save-view-confirm"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setSaveDialogOpen(false)}
            className="text-[11px] font-semibold px-3 py-1 rounded text-slate-500 hover:bg-slate-100"
            data-testid="users-save-view-cancel"
          >
            Cancel
          </button>
        </div>
      )}

      {/* v57.3 — Empty state when search yields nothing. Sits above the
          table so the header/segments stay visible for context. */}
      {debouncedSearch.trim() && filtered.length === 0 && (
        <div
          data-testid="users-search-empty"
          className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 mb-3"
        >
          No users match “{debouncedSearch}”. Try a different term.
        </div>
      )}

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
              <th className="text-left px-4 py-2.5">Status</th>
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
              // v160.3.9.42.1 — Per-section sort dropdown removed. Users
              // asked for a single deterministic ordering everywhere so
              // admins don't have to remember which section is on which
              // mode. Alphabetical A-Z on `name` is the only sort now.
              // Case-insensitive via `localeCompare` default options.
              const sortUsers = (arr) => {
                const s = [...arr];
                s.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
                return s;
              };
              // v160.3.9.33.1 — Apply user's saved section-order pref if
              // present. Groups not in the saved order fall to the tail,
              // still sorted alphabetically. Unknown role_ids gracefully
              // ignored (roles may have been deleted since prefs saved).
              const orderKey = (k) => {
                const idx = sectionOrder.indexOf(k);
                return idx === -1 ? 10000 : idx;
              };
              const ordered = Array.from(groups.values()).sort((a, b) => {
                const oa = orderKey(a.key), ob = orderKey(b.key);
                if (oa !== ob) return oa - ob;
                return roleLabel(a.key).localeCompare(roleLabel(b.key));
              });
              // v160.3.9.41 — legacy `moveSection` (up/down arrow variant)
              // removed; @dnd-kit's `handleDragEnd` below handles reorder.
              const resetOrder = () => {
                setSectionOrder([]);
                api.delete('/user-prefs/section-order/users').catch(() => {});
              };
              const colCount = can('users', 'edit') ? 6 : 5;
              // v160.3.9.41 — @dnd-kit sortable reorder. Replaces the
              // former up/down ArrowUp/ArrowDown buttons on each role-
              // section header with a `⋮⋮` grip. Persistence
              // contract UNCHANGED — still writes to
              // `PUT /api/user-prefs/section-order/users` with
              // `{section_order: [...]}`, per-viewer semantic. Grip is
              // bound via `useSortable(id: g.key)` on a small inline
              // <SortableSectionHeader> component below; keyboard
              // sensor (arrow keys / Space) is dnd-kit's default.
              const handleDragEnd = async (event) => {
                const { active, over } = event;
                if (!active || !over || active.id === over.id) return;
                // v160.3.9.41.1 — Snapshot the previous order BEFORE we
                // optimistically apply the new one so we can revert on
                // failure and never let the UI diverge from the server.
                // The functional setState guarantees we're deriving the
                // next order from the CURRENT state and not the closure
                // capture of `sectionOrder` (avoids the race where two
                // drags fire in quick succession).
                const cur = ordered.map((g) => g.key);
                const from = cur.indexOf(active.id);
                const to = cur.indexOf(over.id);
                if (from < 0 || to < 0) return;
                const next = arrayMove(cur, from, to);
                const prev = cur;
                setSectionOrder(next);   // optimistic local update
                try {
                  // AWAIT the PUT and re-sync from the server response
                  // so the local state is guaranteed to match what
                  // Mongo persisted. This defends against any future
                  // caller (e.g. a background refresh) that might set
                  // stale state right after the drag lands.
                  const { data } = await api.put(
                    '/user-prefs/section-order/users',
                    { section_order: next },
                  );
                  if (Array.isArray(data?.section_order) && data.section_order.length > 0) {
                    setSectionOrder(data.section_order);
                  }
                } catch (e) {
                  // Revert on failure so the drop doesn't visually
                  // "stick" while the server has the old order.
                  setSectionOrder(prev);
                  toast.error('Could not save order — reverting');
                }
              };
              const sectionIds = ordered.map((g) => g.key);
              return (
                <DndContext
                  sensors={dndSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}>
                  <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
                    {ordered.flatMap((g, gi) => {
                const open = sectionOpen[g.key] !== false;
                const colour = roleColour(g.key);
                const rows = [
                  <SortableSectionHeaderTr key={`sec-${g.key}`}
                    id={g.key} colour={colour} colCount={colCount}
                    canEdit={can('users', 'edit')}>
                    {(dragListeners, dragAttributes, isDragging) => (
                      <div className="flex items-center gap-2">
                        {can('users', 'edit') && (
                          <button
                            type="button"
                            {...dragListeners}
                            {...dragAttributes}
                            className={`p-0.5 rounded hover:bg-white/60 cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
                            title="Drag to reorder section (arrow keys to move via keyboard)"
                            aria-label={`Reorder role section: ${roleLabel(g.key)}`}
                            data-testid={`role-section-grip-${g.key}`}>
                            <GripVertical size={13} className={colour.fg} />
                          </button>
                        )}
                        <span className={`inline-block w-2 h-2 rounded-full ${colour.accent}`} />
                        <button type="button" onClick={() => setSectionOpen((s) => ({ ...s, [g.key]: !open }))}
                          className={`inline-flex items-center gap-1.5 text-xs uppercase tracking-widest font-bold ${colour.fg} hover:opacity-80`}
                          data-testid={`role-section-toggle-${g.key}`}>
                          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          {roleLabel(g.key)}
                          <span className={`${colour.fg} opacity-70 font-normal normal-case tracking-normal`}>· {g.users.length}</span>
                        </button>
                        {gi === 0 && sectionOrder.length > 0 && can('users', 'edit') && (
                          <button type="button" onClick={resetOrder}
                            className="ml-2 text-[10px] text-slate-600 hover:text-slate-900 hover:underline"
                            data-testid="role-section-reset-order">
                            Reset order
                          </button>
                        )}
                        {/* v160.3.9.42.1 — per-section sort <select> removed.
                            Alphabetical A-Z is now the single source of truth. */}
                      </div>
                    )}
                  </SortableSectionHeaderTr>
                ];
                if (open) {
                  for (const u of sortUsers(g.users)) rows.push(renderUserRow(u));
                }
                return rows;
              })}
                  </SortableContext>
                </DndContext>
              );
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
      {/* v58.13.132hs — Bulk "Send pending invites" confirm dialog.
          Counts users in `invited` state that have never been emailed
          (or emailed longer than `resendDays` ago) and asks for
          explicit confirmation before firing the bulk send. */}
      {bulkInviteConfirm && (() => {
        const pending = users.filter((u) => u.status === 'invited' && !u.last_invite_sent && u.email);
        return (
          <div data-testid="bulk-invites-modal"
            className="fixed inset-0 z-[70] bg-slate-900/70 grid place-items-center p-4"
            onClick={(e) => e.target === e.currentTarget && !isBulkInviting && setBulkInviteConfirm(false)}>
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0"><Send size={18} /></div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-bold text-slate-900">Send invites to {pending.length} pending user{pending.length === 1 ? '' : 's'}?</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Each invited user with an email address and no prior send will receive a magic link. Recipients set their own password on first click.</p>
                </div>
              </div>
              <div className="px-5 py-3 text-sm text-slate-700 max-h-48 overflow-auto">
                {pending.length === 0 && (
                  <div className="text-xs text-slate-500 italic">No pending invites to send.</div>
                )}
                {pending.slice(0, 25).map((u) => (
                  <div key={u.id} className="text-xs py-0.5 truncate">• {u.name || u.email} <span className="text-slate-400">({u.email})</span></div>
                ))}
                {pending.length > 25 && (
                  <div className="text-[11px] text-slate-400 mt-1">…and {pending.length - 25} more</div>
                )}
              </div>
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setBulkInviteConfirm(false)} disabled={isBulkInviting}
                  data-testid="bulk-invites-cancel"
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button type="button"
                  disabled={isBulkInviting || pending.length === 0}
                  onClick={async () => {
                    setIsBulkInviting(true);
                    try {
                      const { data } = await api.post('/users/bulk-send-pending-invites', { user_ids: [], resend_after_days: 0 });
                      toast.success(`Sent ${data.sent} · Skipped recent ${data.skipped_recent} · Skipped no-channel ${data.skipped_no_channel}`);
                      setBulkInviteConfirm(false);
                      await load();
                    } catch (e) { toast.error(apiError(e)); }
                    finally { setIsBulkInviting(false); }
                  }}
                  data-testid="bulk-invites-confirm"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-60">
                  {isBulkInviting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {isBulkInviting ? 'Sending…' : `Send ${pending.length} invite${pending.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {active && <UserDrawer userRow={active} onClose={() => setActive(null)} onReload={load} canEdit={can('users', 'edit')} defaultTab={activeTab} />}
      {assignRoleTarget && (
        <AssignRoleDialog
          users={assignRoleTarget.users}
          systemRoles={systemRoles}
          onClose={() => setAssignRoleTarget(null)}
          onDone={() => { setBulkSelected(new Set()); load(); }}
        />
      )}
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

// ─────────────────────────────────────────────────────────────
// v160.3.9.32-4c.3 — AssignRoleDialog
// Single- and bulk-Assign Role dialog. Renders one row per user
// with:
//   • name + email
//   • Simpro position (from the imported record)
//   • role dropdown pre-selected via suggestRoleHint()
// Bulk mode also shows a "Set all to…" convenience dropdown at
// the top which overrides every row when a value is picked.
// Assigning `admin` to a single user requires a second red
// warning confirm dialog. Bulk-assigning `admin` is refused by
// the backend (400) — we also guard client-side in the
// "Set all to…" list by omitting it.
// ─────────────────────────────────────────────────────────────
function AssignRoleDialog({ users, systemRoles, onClose, onDone }) {
  useLockBodyScroll();
  const isBulk = users.length > 1;
  // v160.3.9.33 — Phase 4d: pre-select each row's role by matching the
  // user's Simpro position to the auto-created `custom_<slug>` role. If
  // that role doesn't exist yet, pre-select the special sentinel
  // `__create_from_position__` which submits via the __from_position__
  // backend flow (auto-creates the role, then assigns). Users without a
  // Simpro position get no pre-selection — admin must pick manually.
  const [selections, setSelections] = useState(() => {
    const out = {};
    for (const u of users) {
      const roleId = positionRoleFor(u, systemRoles);
      out[u.id] = { role_id: roleId || '', from_position: !!roleId };
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [adminConfirm, setAdminConfirm] = useState(null);   // user obj pending admin-confirm
  const [setAllValue, setSetAllValue] = useState('');       // "Set all to…" picker value

  const activeRoles = useMemo(
    // v160.3.9.33 — Phase 4d: allow seed + admin_created + simpro_position_auto.
    // Only exclude legacy fallback entries (source === 'legacy') that don't
    // exist in db.roles — those would 404 the assignment.
    () => systemRoles.filter((r) => r.is_active !== false && r.source !== 'legacy'),
    [systemRoles]
  );
  // Bulk-safe roles = everything except admin.
  const bulkSafeRoles = activeRoles.filter((r) => r.role_id !== 'admin');

  const applySetAll = (roleId) => {
    setSetAllValue(roleId);
    if (!roleId) return;
    setSelections((s) => {
      const next = { ...s };
      for (const u of users) next[u.id] = { ...next[u.id], role_id: roleId };
      return next;
    });
  };

  const runSubmit = async () => {
    // v160.3.9.33 — Phase 4d: split selections into two groups:
    //   • fromPositionIds — users whose selected value is the special
    //     `__create_from_position__` sentinel. These get bundled into
    //     ONE call with role_id="__from_position__" so the backend
    //     auto-creates each unique position role and assigns per-user.
    //   • byRole — standard {role_id -> [user_id]} grouping for the
    //     remaining users who picked a concrete role_id.
    const fromPositionIds = [];
    const byRole = new Map();
    for (const u of users) {
      const roleId = selections[u.id]?.role_id;
      if (!roleId) continue;
      if (roleId === '__create_from_position__') {
        fromPositionIds.push(u.id);
        continue;
      }
      if (!byRole.has(roleId)) byRole.set(roleId, []);
      byRole.get(roleId).push({ id: u.id, from_position: !!selections[u.id]?.from_position });
    }
    if (byRole.size === 0 && fromPositionIds.length === 0) {
      toast.error('Pick a role for at least one user');
      return;
    }
    setBusy(true);
    // Promise.allSettled so a mid-batch failure doesn't roll back the
    // whole toast/close/refresh flow. Users see per-role_id failure
    // detail; succeeded rows are reflected immediately via onDone().
    try {
      const calls = [];
      if (fromPositionIds.length) {
        calls.push(
          api.post('/users/bulk-assign-role', {
            user_ids: fromPositionIds,
            role_id: '__from_position__',
            auto_create_from_position: true,
            admin_confirmed: true,
            hint_matched: true,
          }).then(({ data }) => ({ roleId: '__from_position__', data }))
        );
      }
      for (const [roleId, rows] of byRole.entries()) {
        const allFromPosition = rows.every((r) => r.from_position);
        calls.push(
          api.post('/users/bulk-assign-role', {
            user_ids: rows.map((r) => r.id),
            role_id: roleId,
            admin_confirmed: true,
            hint_matched: allFromPosition,
          }).then(({ data }) => ({ roleId, data }))
        );
      }
      const results = await Promise.allSettled(calls);
      let totalUpdated = 0, totalSkipped = 0, totalErrors = 0;
      const autoCreated = [];
      const failedRoles = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          totalUpdated += r.value.data.updated || 0;
          totalSkipped += r.value.data.skipped || 0;
          totalErrors += r.value.data.errors || 0;
          for (const rid of (r.value.data.auto_created_role_ids || [])) {
            autoCreated.push(rid);
          }
        } else {
          failedRoles.push(apiError(r.reason));
        }
      }
      const parts = [];
      if (totalUpdated) parts.push(`Assigned to ${totalUpdated} user${totalUpdated === 1 ? '' : 's'}`);
      if (autoCreated.length) parts.push(`${autoCreated.length} new position role${autoCreated.length === 1 ? '' : 's'} created`);
      if (totalSkipped) parts.push(`${totalSkipped} skipped (already had roles)`);
      if (totalErrors) parts.push(`${totalErrors} row errors`);
      if (failedRoles.length) {
        toast.error(`Some roles failed — ${failedRoles.slice(0, 2).join('; ')}${failedRoles.length > 2 ? '…' : ''}`);
      }
      if (parts.length) toast.success(parts.join(' · '));
      // Any auto-create bumps the roles catalogue → bust the module cache.
      if (autoCreated.length) bustRolesCache();
      onDone?.();
      if (failedRoles.length === 0) onClose?.();
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    // Client-side guard: single-row admin needs its own red confirm.
    if (!isBulk) {
      const only = users[0];
      const chosen = selections[only.id]?.role_id;
      if (chosen === 'admin') {
        setAdminConfirm(only);
        return;
      }
    }
    runSubmit();
  };

  return createPortal((
    <div
      data-testid="assign-role-modal"
      className="fixed inset-0 z-[70] bg-slate-900/70 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose?.()}
    >
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3 shrink-0">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-violet-100 text-violet-700 flex-shrink-0">
            <ShieldCheck size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-slate-900">
              {isBulk ? `Assign roles to ${users.length} users` : `Assign role to ${users[0].name || users[0].email}`}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Pre-selections come from each user&apos;s Simpro position. Assigning a role activates the account.
            </p>
          </div>
        </div>

        {isBulk && (
          <div className="px-5 py-3 bg-violet-50/60 border-b border-violet-100 flex items-center gap-3 shrink-0" data-testid="assign-role-setall-row">
            <span className="text-xs font-semibold uppercase tracking-wider text-violet-700">Set all to…</span>
            <select
              value={setAllValue}
              onChange={(e) => applySetAll(e.target.value)}
              disabled={busy}
              data-testid="assign-role-setall"
              className="text-sm border border-violet-300 rounded-lg px-2 py-1.5 bg-white flex-1 max-w-xs"
            >
              <option value="">(keep per-user hints)</option>
              {bulkSafeRoles.map((r) => (
                <option key={r.role_id} value={r.role_id}>{r.name}</option>
              ))}
            </select>
            <span className="text-[11px] text-slate-500">
              Admin cannot be bulk-assigned.
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left py-1.5">User</th>
                <th className="text-left py-1.5">Simpro position</th>
                <th className="text-left py-1.5">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const sel = selections[u.id];
                const rolesForRow = isBulk ? bulkSafeRoles : activeRoles;
                const positionRoleId = positionRoleFor(u, systemRoles);
                const hasPosition = !!(u.simpro_position || '').trim();
                const needsAutoCreate = positionRoleId === '__create_from_position__';
                const currentPositionRole = positionRoleId && positionRoleId !== '__create_from_position__'
                  ? rolesForRow.find((r) => r.role_id === positionRoleId)
                  : null;
                const selectValue = sel?.role_id || '';
                const valueIsAvailable = selectValue === '__create_from_position__'
                  || rolesForRow.some((r) => r.role_id === selectValue);
                return (
                  <tr key={u.id} className="border-t border-slate-100" data-testid={`assign-role-row-${u.id}`}>
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-800 truncate max-w-[180px]" title={u.name}>{u.name || '—'}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[180px]" title={u.email}>{u.email}</div>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-600" data-testid={`assign-role-position-${u.id}`}>
                      {u.simpro_position || <span className="italic text-slate-400">(none)</span>}
                    </td>
                    <td className="py-2">
                      <select
                        value={valueIsAvailable ? selectValue : ''}
                        onChange={(e) => setSelections((s) => ({
                          ...s,
                          [u.id]: {
                            role_id: e.target.value,
                            from_position: e.target.value === '__create_from_position__' || e.target.value === positionRoleId,
                          },
                        }))}
                        disabled={busy}
                        data-testid={`assign-role-select-${u.id}`}
                        className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white w-full max-w-[240px]"
                      >
                        <option value="">Select role…</option>
                        {/* v160.3.9.33 — Phase 4d: synthetic "Create '<pos>' role"
                            option surfaces when the user has a simpro_position
                            but no matching auto-role has been created yet.
                            Greyed-out when the user has no position at all. */}
                        {hasPosition ? (
                          needsAutoCreate ? (
                            <option value="__create_from_position__" data-testid={`assign-role-create-opt-${u.id}`}>
                              ✨ Create + assign &quot;{u.simpro_position}&quot; role
                            </option>
                          ) : (
                            currentPositionRole && (
                              <option value={currentPositionRole.role_id} data-testid={`assign-role-position-opt-${u.id}`}>
                                {currentPositionRole.name} (from position)
                              </option>
                            )
                          )
                        ) : (
                          <option value="" disabled data-testid={`assign-role-no-position-${u.id}`}>
                            (no Simpro position — pick manually)
                          </option>
                        )}
                        <optgroup label="Seeded roles">
                          {rolesForRow.filter((r) => r.source === 'seed').map((r) => (
                            <option key={r.role_id} value={r.role_id}>{r.name}</option>
                          ))}
                        </optgroup>
                        {rolesForRow.some((r) => r.source === 'admin_created') && (
                          <optgroup label="Custom roles">
                            {rolesForRow.filter((r) => r.source === 'admin_created').map((r) => (
                              <option key={r.role_id} value={r.role_id}>{r.name}</option>
                            ))}
                          </optgroup>
                        )}
                        {rolesForRow.some((r) => r.source === 'simpro_position_auto' && r.role_id !== positionRoleId) && (
                          <optgroup label="Other position roles">
                            {rolesForRow.filter((r) => r.source === 'simpro_position_auto' && r.role_id !== positionRoleId).map((r) => (
                              <option key={r.role_id} value={r.role_id}>{r.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {!hasPosition && (
                        <div className="text-[10px] text-slate-500 mt-0.5" data-testid={`assign-role-no-position-help-${u.id}`}>
                          This user has no Simpro position — pick a role manually.
                        </div>
                      )}
                      {sel?.from_position && sel.role_id && (
                        <div className="text-[10px] text-violet-600 mt-0.5" data-testid={`assign-role-hinted-${u.id}`}>
                          <Sparkles size={9} className="inline" />{' '}
                          {sel.role_id === '__create_from_position__'
                            ? 'will create this position role on save'
                            : 'matched to Simpro position'}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} disabled={busy}
            data-testid="assign-role-cancel"
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}
            data-testid="assign-role-confirm"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {busy ? 'Assigning…' : (isBulk ? `Assign ${users.length} roles` : 'Assign role')}
          </button>
        </div>
      </div>

      {adminConfirm && (
        <div
          data-testid="assign-role-admin-confirm"
          className="fixed inset-0 z-[75] bg-slate-900/80 grid place-items-center p-4"
          onClick={(e) => e.target === e.currentTarget && !busy && setAdminConfirm(null)}
        >
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border-2 border-rose-500">
            <div className="px-5 py-4 border-b border-rose-200 bg-rose-50 flex items-start gap-3">
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-rose-100 text-rose-700 flex-shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-rose-900">Grant Admin access?</h3>
                <p className="text-xs text-rose-800 mt-0.5">
                  Admin has full control of this organisation. Grant only when you are certain.
                </p>
              </div>
            </div>
            <div className="px-5 py-4 text-sm text-slate-700">
              <div className="font-medium">{adminConfirm.name || adminConfirm.email}</div>
              <div className="text-xs text-slate-500">{adminConfirm.email}</div>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setAdminConfirm(null)} disabled={busy}
                data-testid="assign-role-admin-cancel"
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={() => { setAdminConfirm(null); runSubmit(); }} disabled={busy}
                data-testid="assign-role-admin-confirm-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-60">
                <AlertTriangle size={14} /> Grant admin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  ), document.body);
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
  // v160.3.9.33 — Phase 4d Option C: unlock-role confirm dialog.
  const [unlockConfirm, setUnlockConfirm] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const runUnlock = async () => {
    setUnlockBusy(true);
    try {
      await api.patch(`/users/${userRow.id}`, { role_locked: false });
      toast.success('Role unlocked — next Simpro sync will match the position.');
      setUnlockConfirm(false);
      await onReload?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setUnlockBusy(false);
    }
  };

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
                  {userRow.simpro_position && (
                    <div className="text-xs text-slate-500 font-normal truncate mt-0.5" data-testid="drawer-simpro-position">
                      <span className="text-violet-600 font-semibold uppercase tracking-wider text-[10px]">Simpro position:</span>{' '}
                      <span className="text-slate-700">{userRow.simpro_position}</span>
                    </div>
                  )}
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
            {/* v58.13.132cn / .132cx — Print onboarding card (QR) block.
                Admin quick action. Disabled when the user has no
                simpro_employee_id (no worker profile to bind to). */}
            <div
              className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-3 flex items-center gap-3"
              data-testid="user-onboarding-card-block"
            >
              <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center ring-1 ring-violet-200">
                <QrCode size={18} className="text-violet-700" strokeWidth={2.25} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-violet-900">Mobile onboarding card</div>
                <div className="text-[11px] text-violet-800/70">Prints a QR that binds this user's phone on first launch.</div>
              </div>
              <button
                type="button"
                disabled={!userRow.simpro_employee_id}
                title={userRow.simpro_employee_id
                  ? "Print onboarding card (QR)"
                  : "This user has no simpro_employee_id → no worker profile to bind."}
                data-testid="user-print-onboarding-card-btn"
                onClick={async () => {
                  try {
                    const r = await api.get(
                      `/mobile/onboarding/cards.pdf?user_id=${encodeURIComponent(userRow.id)}`,
                      { responseType: 'blob' },
                    );
                    const { src } = await stashInlinePdf(
                      r.data, `onboarding_${userRow.id}.pdf`,
                    );
                    window.open(src, '_blank');
                  } catch (e) {
                    toast.error(e?.response?.data?.detail || 'Print failed');
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Printer size={14} strokeWidth={2.25} />
                Print
              </button>
            </div>
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
            <div className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1 flex items-center gap-1.5">
              <span>Role</span>
              {/* v160.3.9.33 — Phase 4d Option C: role_locked lock icon.
                  Only visible when the admin has manually overridden the
                  Simpro-position role. Click opens confirm to unlock. */}
              {userRow.role_locked && (
                <button
                  type="button"
                  onClick={() => setUnlockConfirm(true)}
                  disabled={!canEdit}
                  data-testid="user-role-lock-icon"
                  title="Role is manually locked and won't change with Simpro sync. Click to unlock."
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[9px] font-bold uppercase tracking-wider border border-amber-300 hover:bg-amber-200 disabled:cursor-not-allowed"
                >
                  <Lock size={9} /> Locked
                </button>
              )}
            </div>
              <Select value={profile.role || undefined} onValueChange={(v) => setProfile({ ...profile, role: v })} disabled={!canEdit}>
                <SelectTrigger className="w-full" data-testid="user-role"><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {/* v160.3.9.33 — Phase 4d: allow all non-legacy sources
                      (seed / admin_created / simpro_position_auto). Legacy
                      fallback entries (worker/supervisor/hseq_lead/auditor)
                      that don't exist in db.roles are still filtered out. */}
                  {systemRoles.filter((r) => r.source !== 'legacy').map((r) => (
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
                {/* v58.13.132hs — Send invite (magic link) button. Only
                    surfaces for users in `invited` / `pending_invite`
                    state — active/disabled don't need it. Idempotent
                    on the backend; re-clicking just resends. */}
                {(userRow.status === 'invited' || userRow.status === 'pending_invite' || userRow.invite_pending) && (
                  <button
                    onClick={async () => {
                      try {
                        const { data } = await api.post(`/users/${userRow.id}/invite`, { channel: 'auto' });
                        toast.success(`Invite sent via ${data.channel} to ${userRow.email}`);
                        await onReload?.();
                      } catch (e) { toast.error(apiError(e)); }
                    }}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm inline-flex items-center gap-1.5 border border-emerald-700 hover:bg-emerald-700"
                    data-testid="send-invite-btn"
                  >
                    <Send size={13} />
                    {userRow.last_invite_sent ? 'Resend invite' : 'Send invite'}
                  </button>
                )}
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
                        const isDelete = act === 'delete';
                        const isOpenOrView = act === 'open' || act === 'view';
                        // v58.13.105 — Support gate widened to honour
                        // DELETE_SUPPORTED and OPEN_VIEW_SUPPORTED so
                        // resources like `comms_safe_mode` (edit-only)
                        // render "—" for their non-applicable columns.
                        // Prior gate only checked email + team_view.
                        const supported = (!isEmail || EMAIL_SUPPORTED[res])
                          && (!isTeamView || TEAM_VIEW_SUPPORTED[res])
                          && (!isDelete || DELETE_SUPPORTED[res] !== false)
                          && (!isOpenOrView || OPEN_VIEW_SUPPORTED[res] !== false);
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
            {/* v58.13.132ez — Apps Directory approvals panel. Same
                underlying `allowed_user_ids` field the tile editor
                writes; edits here PATCH the batch endpoint. */}
            <UserApprovedTilesPanel userId={detail.id} canEdit={canEdit} />
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
        {/* v160.3.9.33 — Phase 4d Option C: unlock-role confirm. */}
        {unlockConfirm && (
          <div
            data-testid="unlock-role-modal"
            className="fixed inset-0 z-[75] bg-slate-900/70 grid place-items-center p-4"
            onClick={(e) => e.target === e.currentTarget && !unlockBusy && setUnlockConfirm(false)}
          >
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">
                  <Unlock size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-bold text-slate-900">Unlock role?</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Simpro sync will then reassign this user&apos;s role based on their position.
                  </p>
                </div>
              </div>
              <div className="px-5 py-3 text-sm text-slate-700">
                <div className="font-medium">{userRow.name || userRow.email}</div>
                <div className="text-xs text-slate-500">
                  Simpro position: <span className="text-slate-700">{userRow.simpro_position || '(none)'}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Current role: <code className="text-slate-700">{userRow.role_id}</code>
                </div>
              </div>
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setUnlockConfirm(false)}
                  disabled={unlockBusy}
                  data-testid="unlock-role-cancel"
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={runUnlock}
                  disabled={unlockBusy}
                  data-testid="unlock-role-confirm"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold disabled:opacity-60"
                >
                  {unlockBusy ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
                  {unlockBusy ? 'Unlocking…' : 'Unlock role'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  ), document.body);
}

// v58.13.132ez — Per-user Apps Directory approvals sub-panel that
// lives inside the Permissions tab of the User Details modal. Reads
// `GET /org/url-tiles/user-approvals?user_id=<uid>` for the current
// state + `GET /org/url-tiles?include_disabled=true` for the tile
// catalog (labels/icons), and writes the selection through the
// batch endpoint `PATCH /org/url-tiles/user-approvals`. Public
// tiles render checked-and-disabled with a "Public — everyone"
// hint so admins never accidentally flip them into restricted.
function UserApprovedTilesPanel({ userId, canEdit }) {
  const [tiles, setTiles] = useState([]);
  const [approvals, setApprovals] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tilesRes, apprRes] = await Promise.all([
        api.get('/org/url-tiles?include_disabled=true'),
        api.get(`/org/url-tiles/user-approvals?user_id=${encodeURIComponent(userId)}`),
      ]);
      const catalog = (tilesRes.data?.tiles || [])
        .slice()
        .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      setTiles(catalog);
      const approved = new Set(apprRes.data?.approved_tile_ids || []);
      setApprovals(apprRes.data);
      setSelected(approved);
    } catch (e) {
      setError(apiError(e) || 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (tid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tid)) next.delete(tid); else next.add(tid);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/org/url-tiles/user-approvals', {
        user_id: userId,
        approved_tile_ids: Array.from(selected),
      });
      toast.success('Apps Directory approvals saved.');
      await load();
    } catch (e) {
      toast.error(apiError(e) || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const publicSet = new Set(approvals?.public_tile_ids || []);

  return (
    <div className="mt-6 pt-4 border-t border-slate-200"
      data-testid="user-approved-tiles-panel">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider font-bold text-brand-blue">
            Paneltec Group · Apps Directory
          </div>
          <div className="text-sm font-display font-semibold text-slate-800">
            Private tiles
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Tick the tiles this user should see. Public tiles are visible to everyone.
          </p>
        </div>
        {canEdit && !loading && (
          <button type="button" onClick={save} disabled={busy}
            data-testid="user-approved-tiles-save"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-blue text-white text-xs font-bold hover:brightness-110 disabled:opacity-60">
            <Save size={12} /> {busy ? 'Saving…' : 'Save approvals'}
          </button>
        )}
      </div>
      {error && (
        <div className="text-xs text-red-600 mb-2"
          data-testid="user-approved-tiles-error">{error}</div>
      )}
      {loading ? (
        <div className="text-xs text-slate-500"
          data-testid="user-approved-tiles-loading">Loading…</div>
      ) : tiles.length === 0 ? (
        <div className="text-xs text-slate-500"
          data-testid="user-approved-tiles-empty">
          No tiles configured yet. Add tiles in Settings → Organisation → Apps Directory.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-60 overflow-y-auto"
          data-testid="user-approved-tiles-list">
          {tiles.map((t) => {
            const isPublic = publicSet.has(t.id);
            const isChecked = isPublic || selected.has(t.id);
            const disabled = !canEdit || isPublic;
            return (
              <label key={t.id}
                data-testid={`user-approved-tiles-row-${t.id}`}
                data-tile-public={isPublic ? 'true' : 'false'}
                data-tile-checked={isChecked ? 'true' : 'false'}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs ${disabled ? 'cursor-default' : 'cursor-pointer hover:bg-slate-50'}`}>
                <input type="checkbox"
                  checked={isChecked}
                  disabled={disabled}
                  onChange={() => !disabled && toggle(t.id)}
                  data-testid={`user-approved-tiles-checkbox-${t.id}`}
                  className="rounded border-slate-300" />
                <span className="text-lg leading-none" aria-hidden="true">{t.icon || '🔗'}</span>
                <span className="flex-1 truncate font-semibold text-slate-800">{t.label}</span>
                {isPublic ? (
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5"
                    title="Every user sees this tile — turn on 'Approved users only' on the tile itself to change">
                    Public — everyone
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                    Approved
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
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
//
// v58.13.132fb — Two bug fixes:
//   1. z-index bumped `z-[80]` → `z-[95]` so the dialog cleanly
//      out-stacks the user-drawer (`z-[60]`) plus every other
//      admin-page modal in this file (max was `z-[80]`). Was
//      rendering BEHIND the profile drawer for some builds despite
//      both being portalled — bumping gives unambiguous stacking
//      breathing room and matches the "top-of-stack" pattern.
//   2. NEW PASSWORD field wiping on CONFIRM focus was Chrome/Edge
//      password-manager autofill injecting into the first field
//      whenever the second gained focus. Both inputs now carry
//      `autoComplete="new-password"` + distinct `name` attrs +
//      `spellCheck={false}`, and the shared state was moved to a
//      single `pw` object for symmetry. Inline mismatch hint +
//      client-side gating on the submit button also fixed.
function ResetPasswordDialog({ user, onClose, onDone }) {
  useLockBodyScroll();
  const [mode, setMode] = useState('direct');
  // v58.13.132fb — Single state object for the two direct-mode
  // password inputs. Both fields are controlled; the object
  // guarantees a stable render key while the modal is open.
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const mismatch = pw.next.length > 0 && pw.confirm.length > 0
    && pw.next !== pw.confirm;
  const canSetDirect = !busy && pw.next.length >= 8 && pw.next === pw.confirm;
  const submitDirect = async () => {
    if (pw.next !== pw.confirm) { toast.error('Passwords do not match'); return; }
    if (pw.next.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/set-password`, { password: pw.next });
      toast.success(`Password set for ${user.email}. They have been logged out of all sessions.`);
      setPw({ next: '', confirm: '' });
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
    <div className="fixed inset-0 z-[95] bg-slate-900/70 backdrop-blur-sm grid place-items-center p-4" onClick={(e) => e.target === e.currentTarget && !busy && onClose()} data-testid="reset-password-dialog">
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
            // v58.13.132fb — `autoComplete="new-password"` +
            // distinct `name` attrs + `spellCheck={false}` tell
            // Chrome/Edge/Safari password managers that this is a
            // set-new-password flow. Prevents the autofill loop
            // that was wiping NEW PASSWORD when CONFIRM took focus.
            <form className="space-y-2" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (canSetDirect) submitDirect(); }}>
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Warning — user will be logged out of every device. Communicate the new password securely.
              </div>
              <label className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">New password</div>
                <input type="password" value={pw.next}
                  onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
                  minLength={8}
                  name="new-password-set"
                  autoComplete="new-password"
                  spellCheck={false}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="reset-direct-pwd" autoFocus /></label>
              <label className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Confirm</div>
                <input type="password" value={pw.confirm}
                  onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                  name="new-password-confirm"
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-invalid={mismatch}
                  className={`w-full px-3 py-2 border rounded-lg text-sm ${mismatch ? 'border-red-400' : 'border-slate-300'}`}
                  data-testid="reset-direct-confirm" />
                {mismatch && (
                  <div className="mt-1 text-[11px] text-red-600"
                    data-testid="reset-direct-mismatch">Passwords do not match</div>
                )}
              </label>
            </form>
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
            <button type="button" onClick={submitDirect} disabled={!canSetDirect}
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




