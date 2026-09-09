// Phase 4.3 — Mobile App Module allocator (per-role).
// Phase 4.4 — Live "preview as role" phone-bezel iframe pinned to the right.
//
// Tab inside the Permission Presets / Matrix admin page. Admin sees a grid
// where rows are mobile modules and columns are roles (Worker, Supervisor,
// Contractor, Admin). Toggles control visibility on the Expo mobile app.
//
// • Admin column is rendered but locked (always-on) — the backend enforces
//   it on save so a hand-crafted PUT can't bypass.
// • Dirty-state sticky save bar at the bottom.
// • Brand: orange #F97316 (CTA + active toggle) + slate #1E293B (chrome).
// • Right panel (Phase 4.4): phone-bezel <iframe> pointed at the Expo web
//   build with `preview_token` + `preview_role` query params. Reloads
//   explicitly (never auto-syncs with the grid) so admins see exactly
//   what's currently saved, not the unsaved state.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  ClipboardTaskListLtr20Regular as PreStartIcon,
  Book20Regular as DiaryIcon,
  Warning20Regular as HazardIcon,
  ErrorCircle20Regular as IncidentIcon,
  ClipboardCheckmark20Regular as InspectionIcon,
  DocumentBulletList20Regular as SwmsIcon,
  HatGraduation20Regular as InductionsIcon,
  VehicleTruck20Regular as PlantIcon,
  Ribbon20Regular as CertsIcon,
  Lightbulb20Regular as AskIcon,
  QrCode20Regular as SignOnIcon,
  Person20Regular as ProfileIcon,
  // v158 — icons for the 5 new modules.
  DocumentText20Regular as FormsIcon,
  FolderOpen20Regular as DocLibraryIcon,
  Handshake20Regular as ContractorsIcon,
  Building20Regular as SuppliersIcon,
  People20Regular as WorkersIcon,
  // v159.1 — Users Directory tile is a distinct module (admin/HSEQ tooling)
  // separate from `workers` (field-crew register). Using PeopleSettings so
  // the icon reads as "user administration" not "field crew".
  PeopleSettings20Regular as UsersDirectoryIcon,
  Sparkle20Regular as DefaultsIcon,
  LockClosed20Regular,
  Save20Regular,
  ArrowReset20Regular,
  Phone20Regular,
  ArrowClockwise20Regular,
  Open20Regular,
} from '@fluentui/react-icons';

// v160.3.9.33.3 — Legacy fallback role list. The live dropdown fetches
// from `/api/admin/roles` on mount and merges in every seeded + custom +
// Simpro-position-auto role. This static list is used only as an offline
// fallback and as the CATEGORY mapping for storage: `mobile_modules`
// stores one bucket per LEGACY_CATEGORY. Live roles map to the nearest
// category via `_categoryForRole`.
const LEGACY_CATEGORIES = [
  { key: 'worker',     label: 'Worker'     },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'admin',      label: 'Admin'      },
];
const ROLES = LEGACY_CATEGORIES;  // legacy alias — some helpers below still reference `ROLES`.
const LEGACY_KEYS = new Set(LEGACY_CATEGORIES.map((r) => r.key));

// v58.4 — Map a live role to one of the 4 storage categories. Storage
// (`mobile_modules[category][module]`) is still keyed by category; live
// roles surface as extra columns that INHERIT their category's toggles.
// Best-effort classifier — falls back to `worker` for unrecognised
// custom roles (the safe conservative default).
function _categoryForRole(roleId, roleName) {
  const idL = (roleId || '').toLowerCase();
  const nmL = (roleName || '').toLowerCase();
  if (LEGACY_KEYS.has(idL)) return idL;
  if (idL === 'general_user' || idL === 'training_inductions_only') return 'worker';
  if (idL.includes('admin')) return 'admin';
  if (idL.includes('contractor')) return 'contractor';
  if (idL.includes('hseq') || idL.includes('manager') || idL.includes('director')
      || idL.includes('supervisor') || nmL.includes('manager')) {
    return 'supervisor';
  }
  return 'worker';
}

// v58.4 — Localstorage key + defaults for the preview dropdown UX.
const LS_PREVIEW_SHOW_UNASSIGNED = 'perms.previewDropdown.showUnassigned';
// Max non-legacy columns visible in the matrix by default. "Show all"
// toggle lifts the cap.
const MATRIX_TOP_N_DEFAULT = 8;

// v58.13.132bn — Shared live-roles fetcher. Returns `{ allRoles,
// loading }`. Post-`.132bn` the matrix always renders exactly the 4
// core seed roles (Admin / Paneltec Civil / Viatec Traffic Solutions
// / External Contractor) — no more top-N live roles merge or
// hidden-column count. `matrixCols` is computed inline by the
// consuming component from `allRoles` filtered to `is_system=true`.
function useLiveRoles() {
  const [allRoles, setAllRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api.get('/admin/roles').then(({ data }) => {
      if (cancelled) return;
      const rs = (data?.roles || []).filter((r) => r.is_active !== false);
      setAllRoles(rs);
    }).catch(() => setAllRoles([]))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);
  return { allRoles, loading };
}

// Module catalogue mirrors `mobile_modules.MODULE_KEYS` on the backend.
// Friendly labels are taken verbatim from the Phase 4.3 brief.
const MODULES = [
  { key: 'pre_start',           label: 'Daily Pre-Starts',       Icon: PreStartIcon },
  { key: 'site_diary',          label: 'Site Diary',             Icon: DiaryIcon },
  { key: 'hazard',              label: 'Hazard Reports',         Icon: HazardIcon },
  { key: 'incident',            label: 'Incident Reports',       Icon: IncidentIcon },
  { key: 'inspection',          label: 'Inspection Reports',     Icon: InspectionIcon },
  { key: 'swms',                label: 'SWMS',                   Icon: SwmsIcon },
  { key: 'inductions',          label: 'Inductions',             Icon: InductionsIcon },
  { key: 'plant_vehicles',      label: 'Plant & Vehicles',       Icon: PlantIcon },
  { key: 'certifications',      label: 'Certifications',         Icon: CertsIcon },
  { key: 'ask_intel',           label: 'Ask Intelligence',       Icon: AskIcon },
  { key: 'sign_on',             label: 'Sign-on / Site Check-in',Icon: SignOnIcon },
  { key: 'profile',             label: 'My Profile',             Icon: ProfileIcon },
  // v158 — 5 new modules. `service_maintenance` was retired (rolled into
  // `plant_vehicles`); backend drops it on read.
  { key: 'forms',               label: 'Forms Library',          Icon: FormsIcon },
  { key: 'document_library',    label: 'Document Library',       Icon: DocLibraryIcon },
  { key: 'contractors',         label: 'Contractors register',   Icon: ContractorsIcon },
  { key: 'suppliers',           label: 'Suppliers',              Icon: SuppliersIcon },
  { key: 'workers',             label: 'Workers directory',      Icon: WorkersIcon },
  // v159.1 — Users Directory tile toggle (admin tooling).
  { key: 'users_directory',     label: 'Users directory',        Icon: UsersDirectoryIcon },
  // v160.0.2 — Compliance Snapshot chip row (phone Home). Aggregated
  // org counts (SWMS / Pre-starts / Site diary / Hazards / Incidents /
  // Inspections). Default off for worker/contractor.
  { key: 'compliance_snapshot', label: 'Compliance Snapshot (Home chip row)', Icon: DefaultsIcon },
];

function ToggleCell({ on, locked, onChange, testid }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={locked}
      onClick={() => !locked && onChange(!on)}
      data-testid={testid}
      className={[
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-orange-500' : 'bg-slate-200',
        locked ? 'opacity-60 cursor-not-allowed ring-1 ring-slate-300' : 'hover:ring-2 hover:ring-orange-200',
      ].join(' ')}
    >
      <span className={[
        'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
        on ? 'translate-x-5' : 'translate-x-0.5',
      ].join(' ')} />
      {locked && (
        <LockClosed20Regular className="absolute -right-5 text-slate-400" style={{ width: 12, height: 12 }} />
      )}
    </button>
  );
}

function deepClone(o) { return JSON.parse(JSON.stringify(o || {})); }
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Phase 4.4 — derive the Expo web build URL from REACT_APP_BACKEND_URL.
// Convention in this environment: backend lives at
//   https://<sub>.preview.emergentagent.com
// and the Expo web build lives at
//   https://<sub>.expo.preview.emergentagent.com
// (matches EXPO_PACKAGER_PROXY_URL in /app/mobile/.env). An explicit
// REACT_APP_EXPO_URL override wins if defined.
function computeExpoUrl(roleOrScope, token, workerId) {
  const explicit = process.env.REACT_APP_EXPO_URL;
  const backend = process.env.REACT_APP_BACKEND_URL || '';
  const base = (explicit && explicit.trim())
    || backend.replace(/^(https?:\/\/[^.]+)\./, '$1.expo.');
  if (!base) return '';
  const u = new URL(base);
  // v58.13.132p — three collapsed scopes take priority; anything else is
  // treated as a legacy per-role id.
  const SCOPES = new Set(['paneltec_civil', 'viatec_traffic', 'admin', 'external_contractor']);
  if (SCOPES.has(roleOrScope)) {
    u.searchParams.set('preview_scope', roleOrScope);
    // For splash's `preview_role` param — pass through a sensible role
    // fallback so the exchangeForPreviewSession URL is still valid.
    u.searchParams.set('preview_role',
      roleOrScope === 'admin' ? 'admin' : 'worker');
  } else {
    u.searchParams.set('preview_role', roleOrScope);
  }
  if (token) u.searchParams.set('preview_token', token);
  if (workerId) u.searchParams.set('preview_worker_id', workerId);
  u.searchParams.set('_t', Date.now().toString());
  return u.toString();
}

// v58.13.132o — Splash "reset" URL: strip the preview token so the iframe
// boots the real onboarding flow. Used by the Reset preview button.
function computeExpoResetUrl() {
  const explicit = process.env.REACT_APP_EXPO_URL;
  const backend = process.env.REACT_APP_BACKEND_URL || '';
  const base = (explicit && explicit.trim())
    || backend.replace(/^(https?:\/\/[^.]+)\./, '$1.expo.');
  if (!base) return '';
  const u = new URL(base);
  // The `?reset=1` param is only there to bypass the browser cache — the
  // splash treats a token-less URL exactly like a fresh install.
  u.searchParams.set('reset', '1');
  u.searchParams.set('_t', Date.now().toString());
  return u.toString();
}

function PhonePreview({ canEdit }) {
  // v58.13.132q — Strict 3-scope dropdown, persist last selection in
  // localStorage so refreshes remember it. Default: `paneltec_civil`.
  const LS_PREVIEW_SCOPE = 'perms.previewDropdown.scope';
  const [role, setRole] = useState(() => {
    try {
      const v = localStorage.getItem(LS_PREVIEW_SCOPE);
      if (v === 'paneltec_civil' || v === 'viatec_traffic' || v === 'admin' || v === 'external_contractor') return v;
    } catch { /* noop */ }
    return 'paneltec_civil';
  });
  useEffect(() => {
    try { localStorage.setItem(LS_PREVIEW_SCOPE, role); } catch { /* noop */ }
  }, [role]);
  const [src, setSrc] = useState('');
  // v58.13.132o — Preview-as-worker binding state.
  const [previewWorkerId, setPreviewWorkerId] = useState('');
  const [workers, setWorkers] = useState([]);
  // v160.3.9.33.3 → v58.4 — live-fetched roles now enriched with
  // `user_count` from the backend so the dropdown can prioritise
  // in-use roles and hide unassigned ones behind a checkbox.
  const [allRoles, setAllRoles] = useState([]);
  const [showUnassigned, setShowUnassigned] = useState(() => {
    try { return localStorage.getItem(LS_PREVIEW_SHOW_UNASSIGNED) === '1'; }
    catch { return false; }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LS_PREVIEW_SHOW_UNASSIGNED, showUnassigned ? '1' : '0');
    } catch { /* noop */ }
  }, [showUnassigned]);
  useEffect(() => {
    api.get('/admin/roles').then(({ data }) => {
      const rs = (data?.roles || []).filter((r) => r.is_active !== false);
      setAllRoles(rs);
    }).catch(() => setAllRoles([]));
    // v58.13.132o — populate the worker picker.
    api.get('/mobile/preview-user/workers').then(({ data }) => {
      setWorkers(data?.workers || []);
    }).catch(() => setWorkers([]));
  }, []);
  const iframeRef = useRef(null);

  // v58.4 — Group live roles into 3 optgroups sorted by user count.
  //   · inUse   — anyone with users > 0 (the operational set)
  //   · seed    — untouched seeded roles nobody is on yet
  //   · simpro  — auto-created Simpro roles nobody is on yet
  // Admin is force-appended to `inUse` even if user_count is 0 so the
  // operator can always sanity-check the admin view.
  const { inUse, seedGroup, simproGroup } = useMemo(() => {
    const _byCountThenName = (a, b) =>
      (b.user_count || 0) - (a.user_count || 0)
      || (a.name || '').localeCompare(b.name || '');
    const _byName = (a, b) => (a.name || '').localeCompare(b.name || '');
    const inUse = allRoles
      .filter((r) => (r.user_count || 0) > 0 || r.role_id === 'admin')
      .sort(_byCountThenName);
    const seedGroup = allRoles
      .filter((r) => (r.user_count || 0) === 0 && r.role_id !== 'admin'
                     && ((r.source || (r.is_system ? 'seed' : '')) === 'seed'))
      .sort(_byName);
    const simproGroup = allRoles
      .filter((r) => (r.user_count || 0) === 0 && r.role_id !== 'admin'
                     && r.source === 'simpro_position_auto')
      .sort(_byName);
    return { inUse, seedGroup, simproGroup };
  }, [allRoles]);
  const hasLive = inUse.length + seedGroup.length + simproGroup.length > 0;
  const totalRoles = allRoles.length;
  const visibleCount = showUnassigned
    ? (inUse.length + seedGroup.length + simproGroup.length)
    : inUse.length;

  // Build the src once on first render — and only rebuild when the admin
  // explicitly changes role / worker or clicks Reload. Deliberately NOT
  // reactive to the matrix state above (we want the iframe to reflect
  // *saved* config).
  const rebuild = (r = role, wId = previewWorkerId) =>
    setSrc(computeExpoUrl(r, getToken(), wId));
  useEffect(() => { rebuild(role, previewWorkerId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onRoleChange = (e) => {
    const r = e.target.value;
    setRole(r);
    rebuild(r, previewWorkerId);
  };
  // v58.13.132o — worker picker: rebuild the iframe URL with `worker_id`
  // so /api/mobile/preview-user mints a session bound to the picked
  // worker's real profile + data. Read-only stays server-enforced.
  const onWorkerChange = (e) => {
    const wid = e.target.value;
    setPreviewWorkerId(wid);
    rebuild(role, wid);
  };
  const onReload = () => rebuild(role, previewWorkerId);
  const onReset = () => {
    // Wipe the picker state + point the iframe at a token-less URL so it
    // boots the real onboarding flow. Useful for testing the
    // welcome → division → PIN chain end-to-end without redeploying.
    setPreviewWorkerId('');
    setRole('worker');
    setSrc(computeExpoResetUrl());
  };
  const onOpen = () => {
    if (src) window.open(src, '_blank', 'noopener,noreferrer');
  };

  return (
    // Phase 4.4.1 (v125) — sticky settings:
    //   · `top-20` (80px) clears the 64px AppShell topbar instead of
    //     the previous `top-4` which let the panel slide under it.
    //   · `max-h-[calc(100vh-6rem)] overflow-y-auto` lets a tall
    //     preview bezel scroll internally on shorter viewports
    //     instead of being clipped behind the topbar.
    //   · `self-start` belt-and-braces guarantee the aside doesn't
    //     stretch to grid row height (parent already carries
    //     `items-start`, but explicit is cheaper than a regression).
    // v58.7 — Palette sync with mobile redesign. The card chrome,
    // header logo tile, bezel notch, and select focus ring now use
    // the mobile palette's amber (`#F5B301`) accent + `#E5E5E5` borders
    // so the panel doesn't visually clash with the redesigned Expo
    // screens rendering inside the iframe. The iframe content itself
    // is unchanged — it inherits the mobile team's palette when the
    // Expo bundle loads.
    <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto" data-testid="mobile-preview-panel">
      <div className="rounded-2xl border bg-white p-4" style={{ borderColor: '#E5E5E5' }}>
        <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b" style={{ borderColor: '#E5E5E5' }}>
          <div className="inline-flex items-center gap-2">
            <span
              className="w-9 h-9 rounded-xl inline-flex items-center justify-center shadow-sm"
              style={{ background: '#F5B301', color: '#0A0A0A' }}
            >
              <Phone20Regular />
            </span>
            <div>
              <div className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>Live Preview</div>
              <div className="text-[11px]" style={{ color: '#6B6B6B' }}>
                Saved config · {(() => {
                  const match = allRoles.find((r) => r.role_id === role);
                  return match ? match.name : role;
                })()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onReload} data-testid="mobile-preview-reload"
              className="p-1.5 rounded-lg hover:bg-amber-50 transition"
              style={{ color: '#6B6B6B' }}
              title="Reload preview">
              <ArrowClockwise20Regular />
            </button>
            <button type="button" onClick={onOpen} data-testid="mobile-preview-open"
              className="p-1.5 rounded-lg hover:bg-amber-50 transition"
              style={{ color: '#6B6B6B' }}
              title="Open in new tab">
              <Open20Regular />
            </button>
          </div>
        </div>

        <label className="block">
          <div className="flex items-center justify-between mb-1">
            <span className="block text-[10px] uppercase tracking-[0.12em] font-semibold" style={{ color: '#A0A0A0' }}>Preview as role</span>
            {/* v58.4 — role-count summary next to the dropdown. */}
            <span className="text-[10px] tabular-nums" style={{ color: '#A0A0A0' }}
                  data-testid="mobile-preview-role-count">
              {visibleCount} of {totalRoles}
            </span>
          </div>
          <select
            value={role}
            onChange={onRoleChange}
            data-testid="mobile-preview-role"
            disabled={!canEdit}
            className="w-full rounded-lg border bg-white text-sm px-3 py-2 focus:outline-none focus:ring-2"
            style={{
              borderColor: '#E5E5E5',
              color: '#0A0A0A',
              '--tw-ring-color': '#FEF3C7',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#F5B301'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#E5E5E5'; }}
          >
            {/* v58.13.132q — Strict 3-option dropdown. The 27 underlying
                role rows are NOT surfaced here; they still live in the
                permissions matrix runtime and remain fully functional. */}
            <option value="paneltec_civil" data-testid="mobile-preview-scope-paneltec_civil">Paneltec Civil</option>
            <option value="viatec_traffic" data-testid="mobile-preview-scope-viatec_traffic">Viatec Traffic Solutions</option>
            <option value="admin"          data-testid="mobile-preview-scope-admin">Admin</option>
            <option value="external_contractor" data-testid="mobile-preview-scope-external_contractor">External Contractor</option>
          </select>
          {/* v58.13.132q — "Show unassigned roles" checkbox retired. The
              dropdown is now strictly 3-option; per-role preview needs
              are handled via the "Preview as specific worker" dropdown
              below (added in .132o). */}
          <p className="mt-1 text-[10px] leading-tight" style={{ color: '#6B6B6B' }}>
            Reviewing what a user with this role would see. Per-user overrides are not reflected here.
          </p>
        </label>

        {/* v58.13.132o — Preview-as-worker dropdown. Optional; default
            "Generic preview user" mints a role-scoped preview session
            with no worker binding (existing .132j behaviour). Picking a
            worker scopes the session to that worker's real data. */}
        <label className="block mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="block text-[10px] uppercase tracking-[0.12em] font-semibold" style={{ color: '#A0A0A0' }}>Preview as specific worker</span>
            <span className="text-[10px] tabular-nums" style={{ color: '#A0A0A0' }}
                  data-testid="mobile-preview-worker-count">
              {workers.length} worker{workers.length === 1 ? '' : 's'}
            </span>
          </div>
          <select
            value={previewWorkerId}
            onChange={onWorkerChange}
            data-testid="mobile-preview-worker"
            disabled={!canEdit || workers.length === 0}
            className="w-full rounded-lg border bg-white text-sm px-3 py-2 focus:outline-none focus:ring-2"
            style={{
              borderColor: '#E5E5E5',
              color: '#0A0A0A',
              '--tw-ring-color': '#FEF3C7',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#F5B301'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#E5E5E5'; }}
          >
            <option value="">Generic preview user (role only)</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}{w.position ? ` · ${w.position}` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] leading-tight" style={{ color: '#6B6B6B' }}>
            Preview session stays read-only. Writes are blocked server-side.
          </p>
        </label>

        {/* v58.13.132o — Reset preview button. Clears the picker + points
            the iframe at a token-less URL so the real onboarding flow
            (welcome → division → PIN) can be exercised end-to-end. */}
        <div className="mt-3">
          <button
            type="button"
            onClick={onReset}
            data-testid="mobile-preview-reset"
            className="w-full text-xs font-semibold rounded-lg py-2 border transition"
            style={{ borderColor: '#E5E5E5', color: '#6B6B6B', background: 'white' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#FEF3C7';
              e.currentTarget.style.color = '#92400E';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'white';
              e.currentTarget.style.color = '#6B6B6B';
            }}
          >
            Reset preview · test onboarding flow
          </button>
        </div>

        {/* Phone bezel — dark body (a real phone bezel IS dark), amber
            notch dot to match the mobile team's v58.7 palette. Iframe
            content is unchanged; it inherits the new mobile palette
            when the Expo bundle loads. */}
        <div className="mx-auto mt-4" style={{ width: 320 }}>
          <div
            className="relative rounded-[36px] p-3 shadow-2xl"
            style={{ height: 680, background: '#1A1A1A' }}
            data-testid="mobile-preview-bezel"
          >
            {/* Notch */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-28 h-5 rounded-b-2xl flex items-center justify-center" style={{ background: '#0A0A0A' }}>
              <span className="block w-1.5 h-1.5 rounded-full" style={{ background: '#F5B301' }} />
            </div>
            <iframe
              ref={iframeRef}
              src={src || 'about:blank'}
              title="Paneltec Civil mobile preview"
              data-testid="mobile-preview-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="no-referrer-when-downgrade"
              className="w-full h-full rounded-[24px] block"
              style={{ border: 0, background: '#F5F5F7' }}
            />
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: '#6B6B6B' }}>
          Preview reflects unsaved toggle changes <strong style={{ color: '#0A0A0A' }}>only after Save</strong>.
          Click <span className="inline-flex items-center align-middle gap-0.5"><ArrowClockwise20Regular style={{ width: 12, height: 12 }} /></span> to reload once you&rsquo;ve saved.
        </p>
      </div>
    </aside>
  );
}

export default function MobileModulesSection({ canEdit }) {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [applyingDefaults, setApplyingDefaults] = useState(false);
  const [original, setOriginal] = useState(null);
  const [matrix, setMatrix]     = useState(null);
  // v58.5 — per-role overrides layered on top of the 4-category matrix.
  // Shape: `{role_id: {module_key: bool}}`.
  const [overrides, setOverrides] = useState({});
  // v58.4 — Live-fetched roles shared between the matrix table and the
  // PhonePreview dropdown. Prevents the historical mismatch where the
  // matrix showed 4 static columns and the dropdown showed 30 live roles.
  const { allRoles, loading: rolesLoading } = useLiveRoles();
  // Show-all toggle for the matrix — off by default, in which case we
  // cap at MATRIX_TOP_N_DEFAULT (default 8) non-admin live roles by
  // user count. Legacy 4 categories always appear.
  const [showAllCols, setShowAllCols] = useState(false);
  // v159.1 — server-reported defaults metadata. When
  // `needs_migration_review === true` we render a persistent banner so
  // the admin consciously reviews + applies the new hardened defaults.
  // Banner clears once the stored `defaults_version` matches on next load.
  const [defaultsMeta, setDefaultsMeta] = useState({
    needs_migration_review: false,
    defaults_version: null,
    stored_defaults_version: null,
    server_defaults: null,
  });

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settings/mobile-modules');
      setOriginal(deepClone(data.mobile_modules));
      setMatrix(deepClone(data.mobile_modules));
      setOverrides(deepClone(data.mobile_modules_overrides || {}));
      setDefaultsMeta({
        needs_migration_review: !!data.needs_migration_review,
        defaults_version: data.defaults_version || null,
        stored_defaults_version: data.stored_defaults_version || null,
        server_defaults: data.defaults || null,
      });
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const dirty = useMemo(() => matrix && original && !deepEq(matrix, original), [matrix, original]);

  const toggle = (role_id, mod) => {
    // v160.3.9.36 (Phase 5) — Row-key renamed from `role` → `role_id`
    // to align with the token-permission nomenclature. The mobile-
    // modules matrix is keyed by role_id (values happen to match
    // legacy role strings for seeded roles like `admin` / `worker`),
    // so the lock behaviour is identical to the pre-shim implementation.
    if (role_id === 'admin') return;          // admin row locked
    if (!canEdit) return;
    setMatrix((m) => ({ ...m, [role_id]: { ...m[role_id], [mod]: !m[role_id][mod] } }));
  };

  const setAllInRole = (role_id, value) => {
    if (role_id === 'admin' || !canEdit) return;
    setMatrix((m) => ({
      ...m,
      [role_id]: Object.fromEntries(MODULES.map((mo) => [mo.key, value])),
    }));
  };

  const reset = () => setMatrix(deepClone(original));

  // v58.5 — Per-role override handlers. `toggleOverride` writes a
  // single (role_id, module_key) override; `resetRoleOverrides` wipes
  // every override for a live role, restoring pure inheritance.
  const toggleOverride = async (role_id, module_key, current) => {
    if (!canEdit) return;
    const next = !current;
    // Optimistic update — snap the UI so rapid toggles feel responsive.
    setOverrides((o) => {
      const roleO = { ...(o[role_id] || {}) };
      roleO[module_key] = next;
      return { ...o, [role_id]: roleO };
    });
    try {
      const { data } = await api.patch('/settings/mobile-modules/overrides', {
        role_id, module_key, enabled: next,
      });
      // Server may UNSET the override (same-as-inherited); reflect that.
      setOverrides((o) => {
        const roleO = { ...(o[role_id] || {}) };
        if (data.override === null) delete roleO[module_key];
        else roleO[module_key] = data.override;
        const cleaned = { ...o };
        if (Object.keys(roleO).length === 0) delete cleaned[role_id];
        else cleaned[role_id] = roleO;
        return cleaned;
      });
    } catch (e) {
      // Roll back on failure.
      setOverrides((o) => {
        const roleO = { ...(o[role_id] || {}) };
        if (roleO[module_key] !== undefined && roleO[module_key] === next) {
          delete roleO[module_key];
        }
        const cleaned = { ...o };
        if (Object.keys(roleO).length === 0) delete cleaned[role_id];
        else cleaned[role_id] = roleO;
        return cleaned;
      });
      toast.error(apiError(e, 'Override write failed'));
    }
  };

  const resetRoleOverrides = async (role_id) => {
    if (!canEdit) return;
    try {
      await api.delete(`/settings/mobile-modules/overrides/${role_id}`);
      setOverrides((o) => {
        const cleaned = { ...o };
        delete cleaned[role_id];
        return cleaned;
      });
      toast.success('Reset to inherited');
    } catch (e) {
      toast.error(apiError(e, 'Reset failed'));
    }
  };

  // v58.4 — Compute the ordered list of columns to render in the matrix.
  // Contract:
  //   · Legacy 4 categories (Worker/Supervisor/Contractor/Admin) always
  //     appear FIRST and are editable — they are the storage buckets.
  //   · Live roles then follow, sorted by user_count desc then name.
  //   · When `showAllCols` is off, non-legacy live roles are capped at
  //     `MATRIX_TOP_N_DEFAULT`.
  //   · Each column carries a `category` field so the non-legacy cells
  //     can render the INHERITED toggle value from that category's
  //     storage bucket (read-only — you can only edit the 4 categories).
  // v58.13.132bn — Tabs now render EXACTLY the 4 core seed roles in
  // Stephen's fixed order (Admin → Paneltec Civil → Viatec Traffic
  // Solutions → External Contractor). No more "top-N live roles" merge
  // or hidden-column counter — the underlying storage still keys off
  // the 4 LEGACY_CATEGORIES buckets, and each core role maps to a
  // bucket via `_categoryForRole`. Admin is rendered read-only via
  // `is_readonly` (all toggles greyed-on).
  const CORE_ROLE_ORDER = ['admin', 'paneltec_civil', 'viatec_traffic', 'external_contractor'];
  const CORE_ROLE_LABELS = {
    admin: 'Admin',
    paneltec_civil: 'Paneltec Civil',
    viatec_traffic: 'Viatec Traffic Solutions',
    external_contractor: 'External Contractor',
  };
  const matrixCols = useMemo(() => {
    // Filter the live seed roles into a lookup, then materialise in
    // Stephen's canonical order. Roles missing from the payload still
    // render (labels come from CORE_ROLE_LABELS as fallback) so the
    // matrix is stable if `/admin/roles` is slow.
    const bySeed = new Map();
    for (const r of allRoles) {
      if (r.is_system === true && r.is_active !== false) {
        bySeed.set(r.role_id, r);
      }
    }
    const cols = CORE_ROLE_ORDER.map((rid) => {
      const live = bySeed.get(rid);
      return {
        key: rid,
        label: (live && live.name) || CORE_ROLE_LABELS[rid],
        category: _categoryForRole(rid),
        is_category: true,
        is_readonly: rid === 'admin',
        user_count: live?.user_count || 0,
      };
    });
    return {
      cols,
      liveExtrasCount: 0,
      hiddenCount: 0,
    };
  }, [allRoles]);


  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put('/settings/mobile-modules', { mobile_modules: matrix });
      toast.success(r.data.changes
        ? `Saved — ${r.data.changes} change${r.data.changes === 1 ? '' : 's'} applied.`
        : 'Saved.');
      setOriginal(deepClone(r.data.mobile_modules));
      setMatrix(deepClone(r.data.mobile_modules));
      // v159.1 — the PUT stamps `defaults_version` server-side, so reload
      // the metadata so the banner dismisses without a page refresh.
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  // v159.1 — one-click migration: overwrite the current matrix with the
  // server-supplied hardened defaults and persist. Uses the same PUT so
  // the audit log picks up a diff row per role/module that changes.
  const applyServerDefaults = async () => {
    if (!defaultsMeta.server_defaults) return;
    setApplyingDefaults(true);
    try {
      const next = deepClone(defaultsMeta.server_defaults);
      // Admin row is enforced all-true server-side, but mirror here so
      // the UI reflects the effective state immediately.
      next.admin = Object.fromEntries(MODULES.map((mo) => [mo.key, true]));
      const r = await api.put('/settings/mobile-modules', { mobile_modules: next });
      toast.success(r.data.changes
        ? `Hardened defaults applied — ${r.data.changes} change${r.data.changes === 1 ? '' : 's'}.`
        : 'Hardened defaults applied.');
      setOriginal(deepClone(r.data.mobile_modules));
      setMatrix(deepClone(r.data.mobile_modules));
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setApplyingDefaults(false); }
  };

  if (loading || !matrix) {
    return <div className="text-sm text-slate-500 p-6" data-testid="mobile-modules-loading">Loading mobile module matrix…</div>;
  }

  return (
    <div className="space-y-4" data-testid="mobile-modules-section">
      {/* v159.1 — "New defaults available" banner. Persistent (no
          localStorage dismiss) until the admin clicks Apply defaults or
          Save on the current matrix — either action stamps
          `defaults_version` server-side so the banner disappears on the
          next load. */}
      {canEdit && defaultsMeta.needs_migration_review && (
        <div
          data-testid="mobile-modules-defaults-banner"
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"
        >
          <div className="shrink-0 w-10 h-10 rounded-xl bg-amber-100 text-amber-700 inline-flex items-center justify-center">
            <DefaultsIcon />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-900">
              New hardened defaults available
              {defaultsMeta.defaults_version ? ` · ${defaultsMeta.defaults_version}` : ''}
            </div>
            <p className="text-[13px] text-amber-800 mt-1 leading-relaxed max-w-3xl">
              Paneltec has published a stricter default module matrix
              (workers no longer see Plant &amp; Vehicles, Document Library
              or the Users tile by default). Your current saved matrix was
              stamped
              <span className="font-mono px-1"> {defaultsMeta.stored_defaults_version || 'pre-v159'} </span>.
              Review the toggles below and click <strong>Apply hardened defaults</strong>
              to overwrite in one step, or make manual edits and hit Save.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button
                type="button"
                onClick={applyServerDefaults}
                disabled={applyingDefaults || saving}
                data-testid="mobile-modules-apply-defaults"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-60"
              >
                <DefaultsIcon /> {applyingDefaults ? 'Applying…' : 'Apply hardened defaults'}
              </button>
              <span className="text-[12px] text-amber-700">
                Or edit manually and press Save — either action clears this banner.
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-orange-50 text-orange-600 inline-flex items-center justify-center">
          <Phone20Regular />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-slate-900">Mobile App Modules</h2>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Control which tabs and drawer entries appear in the Paneltec Civil
            mobile app for each role. Toggles take effect the next time a user
            signs in or pulls-to-refresh on Profile. Admins always see everything.
          </p>
        </div>
      </div>

      {/* Phase 4.4 — Two-column layout: matrix on the left, sticky
          phone-bezel preview on the right (stacks on < lg). */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {/* v58.13.132bn — Column strip simplified: the matrix now
              renders exactly the 4 core roles in Stephen's canonical
              order (Admin / Paneltec Civil / Viatec Traffic Solutions
              / External Contractor). The pre-`.132bn` "top-N live roles"
              merge + hidden-column counter + "Show all columns"
              checkbox have been retired — the whole model is now one
              column per core role. */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60"
               data-testid="mobile-modules-cols-strip">
            <div className="text-[11px] text-slate-600" data-testid="mobile-modules-subtitle">
              <span className="font-semibold text-slate-800">
                {matrixCols.cols.length}
              </span>{' '}
              column{matrixCols.cols.length === 1 ? '' : 's'} — 4 core roles.
              Toggle which modules each role sees on the mobile app.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="mobile-modules-grid">
              <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold w-[42%]">Module</th>
                  {matrixCols.cols.map((r) => (
                    <th key={r.key} className="px-3 py-3 font-semibold text-center"
                        data-testid={`mobile-col-${r.key}`}
                        data-category={r.category}>
                      <div className="inline-flex items-center gap-1.5 justify-center">
                        <span className="text-slate-700">{r.label}</span>
                        {r.key === 'admin' && <LockClosed20Regular style={{ width: 12, height: 12 }} className="text-slate-400" />}
                      </div>
                      {/* v58.13.132bn — Admin column is a read-only
                          "sees every module" tier. Explanatory chip
                          replaces the "All on / All off" affordance. */}
                      {r.key === 'admin' ? (
                        <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-normal"
                             data-testid="mobile-modules-admin-chip">
                          Sees every module
                        </div>
                      ) : !r.is_category ? (
                        <div className="mt-1 flex flex-col items-center gap-0.5">
                          <span className="text-[9px] font-medium text-slate-400 normal-case tracking-normal">
                            inherits {r.category}
                          </span>
                          <span className="text-[9px] text-slate-500 tabular-nums normal-case">
                            {r.user_count} user{r.user_count === 1 ? '' : 's'}
                          </span>
                          {overrides[r.key] && Object.keys(overrides[r.key]).length > 0 && (
                            <button
                              type="button"
                              onClick={() => resetRoleOverrides(r.key)}
                              disabled={!canEdit}
                              className="text-[9px] font-medium text-orange-600 hover:underline normal-case tracking-normal disabled:opacity-50"
                              data-testid={`mobile-reset-overrides-${r.key}`}
                              title="Remove all overrides for this role"
                            >
                              reset ({Object.keys(overrides[r.key]).length})
                            </button>
                          )}
                        </div>
                      ) : r.key !== 'admin' && canEdit ? (
                        <div className="flex items-center justify-center gap-1.5 mt-1.5 text-[10px] font-medium">
                          <button
                            type="button"
                            onClick={() => setAllInRole(r.key, true)}
                            data-testid={`mobile-all-on-${r.key}`}
                            className="text-orange-600 hover:text-orange-700 hover:underline"
                          >All on</button>
                          <span className="text-slate-300">·</span>
                          <button
                            type="button"
                            onClick={() => setAllInRole(r.key, false)}
                            data-testid={`mobile-all-off-${r.key}`}
                            className="text-slate-500 hover:text-slate-700 hover:underline"
                          >All off</button>
                        </div>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODULES.map(({ key, label, Icon }) => (
                  <tr key={key} className="border-t border-slate-100" data-testid={`mobile-row-${key}`}>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 inline-flex items-center justify-center">
                          <Icon />
                        </span>
                        <span className="font-medium text-slate-800">{label}</span>
                      </div>
                    </td>
                    {matrixCols.cols.map((r) => {
                      // v58.5 — Non-category columns render either the
                      // EFFECTIVE toggle (overridden) or the INHERITED
                      // toggle (from their category's bucket) with
                      // distinct visual states.
                      const bucketKey = r.is_category ? r.key : r.category;
                      const inherited = !!matrix[bucketKey]?.[key];
                      const roleOverride = !r.is_category
                        ? (overrides[r.key] || {})[key]
                        : undefined;
                      const hasOverride = roleOverride !== undefined;
                      const on = hasOverride ? !!roleOverride : inherited;
                      const locked = r.key === 'admin' || !canEdit;
                      return (
                        <td key={r.key} className="text-center px-3 py-3"
                            data-inherit={!r.is_category || undefined}
                            data-override={hasOverride || undefined}>
                          {r.is_category ? (
                            <ToggleCell
                              on={on}
                              locked={locked}
                              onChange={() => toggle(r.key, key)}
                              testid={`mobile-toggle-${r.key}-${key}`}
                            />
                          ) : (
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => toggleOverride(r.key, key, on)}
                              data-testid={`mobile-override-${r.key}-${key}`}
                              data-state={hasOverride ? (on ? 'override-on' : 'override-off') : 'inherit'}
                              title={hasOverride
                                ? `Overridden (${on ? 'ON' : 'OFF'}) — click to revert`
                                : `Inheriting from ${r.category} — click to override`}
                              className={`
                                inline-flex items-center justify-center w-8 h-6 rounded-md text-[11px] font-semibold transition
                                ${hasOverride
                                  ? (on
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
                                    : 'bg-red-100 text-red-800 border border-red-300 hover:bg-red-200')
                                  : (on
                                    ? 'text-emerald-500/60 hover:bg-slate-100'
                                    : 'text-slate-300 hover:bg-slate-100')
                                }
                                disabled:opacity-50 disabled:cursor-not-allowed
                              `.trim().replace(/\s+/g, ' ')}
                            >
                              {hasOverride ? (on ? '✓' : '✕') : (on ? '↳✓' : '↳·')}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <PhonePreview canEdit={canEdit} />
      </div>

      {/* Sticky save bar — appears only when dirty so the page stays calm. */}
      {canEdit && dirty && (
        <div className="sticky bottom-4 z-10" data-testid="mobile-modules-savebar">
          <div className="mx-auto max-w-3xl rounded-2xl border border-slate-900/10 bg-slate-900 text-white shadow-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-2 align-middle"></span>
              Unsaved mobile module changes.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                disabled={saving}
                data-testid="mobile-modules-reset"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-100 hover:bg-white/10"
              ><ArrowReset20Regular /> Reset</button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                data-testid="mobile-modules-save"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:opacity-60"
              ><Save20Regular /> {saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
