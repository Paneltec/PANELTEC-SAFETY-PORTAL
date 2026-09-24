import React, { useEffect, useState } from 'react';
import { runSwVersionGuard } from '@/lib/swVersionGuard';
import RebrandNudge from '@/components/RebrandNudge';
import { toast } from 'sonner';
// v58.13.112 — In-app PWA install button + one-time banner + iOS
// walk-through. Hidden entirely when the app is already running in
// standalone mode.
import { PwaInstallButton, PwaInstallBanner } from '@/components/PwaInstallControls';
// v160.3.8.1 — Draggable Settings sub-nav replaces the flat Settings section.
import SettingsNav from '@/components/settings/SettingsNav';
import AppsDirectoryModal from '@/components/AppsDirectoryModal';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Search, Bell, ChevronDown, ChevronLeft, Menu, X, LogOut, ChevronsLeft, ChevronsRight, Plus,
  KeyRound as KeyRoundIcon, Zap, Upload, ShieldCheck, ShieldOff, Lock, Smartphone,
} from 'lucide-react';
// Phase 3.20 Wave 1 — sidebar nav migrated to @fluentui/react-icons.
// Each NAV entry now carries `icon` (Regular outline) for the resting
// state and `iconActive` (Filled) for the currently-active route. Sizes
// are baked into the component name (24Regular/24Filled).
import {
  Board24Regular, Board24Filled,
  Sparkle24Regular, Sparkle24Filled,
  DocumentText24Regular, DocumentText24Filled,
  ClipboardCheckmark24Regular, ClipboardCheckmark24Filled,
  Notebook24Regular, Notebook24Filled,
  Warning24Regular, Warning24Filled,
  Alert24Regular, Alert24Filled,
  ShieldCheckmark24Regular, ShieldCheckmark24Filled,
  ShieldTask24Regular, ShieldTask24Filled,
  ClipboardTextLtr24Regular, ClipboardTextLtr24Filled,
  People24Regular, People24Filled,
  Link24Regular, Link24Filled,
  FolderOpen24Regular, FolderOpen24Filled,
  ArrowDownload24Regular, ArrowDownload24Filled,
  VehicleTruck24Regular, VehicleTruck24Filled,
  Location24Regular, Location24Filled,
  Building24Regular, Building24Filled,
  CubeMultiple24Regular, CubeMultiple24Filled,
  PeopleSettings24Regular, PeopleSettings24Filled,
  PersonAvailable24Regular, PersonAvailable24Filled,
  PlugConnected24Regular, PlugConnected24Filled,
  CloudArrowUp24Regular, CloudArrowUp24Filled,
  Settings24Regular, Settings24Filled,
  Trophy24Regular, Trophy24Filled,
  Mail24Regular, Mail24Filled,
  BookOpen24Regular, BookOpen24Filled,
  // v160.3.7q — Program Schematic nav item.
  Diagram24Regular, Diagram24Filled,
  // v58.13.132eq — Quick Links sidebar entry (read-only shared bookmarks).
  Bookmark24Regular, Bookmark24Filled,
  // v58.13.132es — Apps Directory sidebar entry (rocket, opens new window).
  Rocket24Regular, Rocket24Filled,
} from '@fluentui/react-icons';
import Logo from '../brand/Logo';
import api from '../../lib/api';
import { fetchMe, getToken, getUser, initials, signOut, refreshToken } from '../../lib/auth';
import { RUNNING_VERSION } from '../../lib/version';
import { useWorkspace } from '../../lib/workspace';
import { PermissionsProvider, useCan } from '../../lib/permissions';
import OutboxBell from './OutboxBell';
import NotificationsBell from './NotificationsBell';
import PdfImportModal from '../imports/PdfImportModal';
// v160.3.9.58.1 — Persistent "bulk-import in progress" pill.
import { BulkImportPill } from '../../pages/prestarts/BulkImport/BulkImportPill';
import useSessionTimeout from '../../hooks/useSessionTimeout';
import SessionWarningModal from '../SessionWarningModal';
import InsuranceCriticalModal from '../InsuranceCriticalModal';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { ChangePasswordModal } from '../auth/AuthBundle';
import { ApiHealthPill, BackupPill, UserDropdownCard } from './TopbarPills';

// v58.13.132ix — APK version + Sync-from-EAS block for the top-bar
// "Download app" popover. Split into its own component so the fetch
// happens only when the popover is actually mounted (DropdownMenu
// unmounts closed content) — no wasted GET on every page render.
function ApkVersionBlock() {
  const [meta, setMeta] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);

  const loadMeta = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/mobile/downloads/android/version');
      setMeta(r.data);
    } catch (_) {
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadMeta(); }, [loadMeta]);

  const onSync = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/mobile/downloads/android/ingest-from-eas');
      const m = r.data?.manifest;
      if (m) {
        toast.success(`Synced: v${m.version} · build ${m.eas_build_id?.slice(0, 8)}`);
      } else {
        toast.success('APK synced from EAS');
      }
      await loadMeta();
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || 'EAS sync failed';
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5" data-testid="topbar-apk-version-block">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Published APK</div>
          {loading ? (
            <div className="text-xs text-slate-400 mt-0.5">Checking…</div>
          ) : !meta || !meta.available ? (
            <div className="text-xs text-slate-500 mt-0.5" data-testid="topbar-apk-version-none">None published yet</div>
          ) : (
            <div className="text-xs text-slate-800 mt-0.5" data-testid="topbar-apk-version-current">
              <span className="font-semibold">v{meta.version}</span>
              {meta.version_code ? <span className="text-slate-500"> · build {meta.version_code}</span> : null}
              {meta.built_at ? (
                <div className="text-[10px] text-slate-500 leading-tight mt-0.5">
                  Built {new Date(meta.built_at).toLocaleDateString()}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          data-testid="topbar-apk-sync-eas"
          className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          title="Pull the latest FINISHED Android build from EAS and republish here."
        >
          {syncing ? '…syncing' : 'Sync latest from EAS'}
        </button>
      </div>
    </div>
  );
}

import AdminPillsLock from './AdminPillsLock';

const NAV = [
  { section: 'Overview', items: [
    { to: '/app/dashboard', label: 'Dashboard', icon: Board24Regular, iconActive: Board24Filled, testid: 'nav-dashboard', pastel: 'coral' },
    { to: '/app/ask', label: 'Ask Intelligence', icon: Sparkle24Regular, iconActive: Sparkle24Filled, testid: 'nav-ask', pastel: 'lilac' },
    // v58.13.132et — "Quick Links" sidebar entry removed to eliminate
    // Stephen's discoverability confusion ("i don't know where the
    // quick links is"). The Apps Directory modal is now the single
    // access point for staff; the legacy `/app/quick-links` route
    // 302-redirects to the dashboard with `?open=apps-directory`
    // so old bookmarks auto-open the modal.
    // v58.13.132es — Apps Directory sidebar entry. Admin-only for
    // this ship; opens an IN-APP modal (dispatched via the existing
    // `action` NAV pattern → global CustomEvent `paneltec:open-apps-directory`).
    // Modal is caught by AppShell and overlays the current tab.
    // Tiles inside the modal use `target="_blank"` so individual
    // launches still pop new browser tabs — but the hub itself no
    // longer requires a separate browser window.
    { action: 'open-apps-directory', label: 'Apps Directory', icon: Rocket24Regular, iconActive: Rocket24Filled, testid: 'nav-apps-directory', requiresCan: ['users', 'edit'], pastel: 'peach' },
  ]},
  { section: 'Capture', items: [
    { to: '/app/swms', label: 'AI SWMS', icon: DocumentText24Regular, iconActive: DocumentText24Filled, testid: 'nav-swms', resource: 'swms', pastel: 'mint' },
    { to: '/app/pre-starts', label: 'Daily Pre-Starts', icon: ClipboardCheckmark24Regular, iconActive: ClipboardCheckmark24Filled, testid: 'nav-pre-starts', resource: 'pre_starts', pastel: 'sky' },
    // v160.3.9.58.1 — Bulk import route (URL → dry-run → approve). Distinct from
    // the drag/drop `Import PDFs` action below — that stays for one-off uploads.
    // Chose sidebar entry (over a page button on PreStarts) because this is a
    // first-class capture flow, not a hidden action. Gated on `pre_starts.edit`
    // to match backend `_WRITE_ROLES` (admin / manager / hseq_lead).
    { to: '/app/pre-starts/bulk-import', label: 'Bulk Import from URL', icon: CloudArrowUp24Regular, iconActive: CloudArrowUp24Filled, testid: 'nav-pre-starts-bulk-import', requiresCan: ['pre_starts', 'edit'], pastel: 'peach' },
    { to: '/app/site-diary', label: 'Site Diary', icon: Notebook24Regular, iconActive: Notebook24Filled, testid: 'nav-site-diary', resource: 'site_diary', pastel: 'butter' },
    // v58.13.132ia — Hazard Reports merged into Incident Reports.
    // Sidebar entry retired; deep-link /app/hazards redirects to
    // /app/incidents?type=hazard (see App.js).
    { to: '/app/incidents', label: 'Incident Reports', icon: Alert24Regular, iconActive: Alert24Filled, testid: 'nav-incidents', resource: 'incidents', pastel: 'blush' },
    { to: '/app/inspections', label: 'Inspection Reports', icon: ShieldCheckmark24Regular, iconActive: ShieldCheckmark24Filled, testid: 'nav-inspections', resource: 'inspections', pastel: 'lavender' },
    // v58.13.106 / v58.13.109b — Site Visitors register. Single source
    // of truth for both anonymous QR sign-ins (populated by the .106
    // public form) and any legacy form-template sign-ins migrated in
    // via `backend/scripts/migrate_legacy_signins_v58_13_109b.py`.
    // Data-visitors table renders correctly with the merged records.
    { to: '/app/admin/visitors', label: 'Site Visitors', icon: PersonAvailable24Regular, iconActive: PersonAvailable24Filled, testid: 'nav-admin-visitors', pastel: 'sky', permission: 'sites_visitors.view' },
    // v160.3.0-adjust-13 — new Capture bucket. Slots after Inspection
    // Reports because risk assessments feed inspection / audit workflows.
    { to: '/app/risk-assessments', label: 'Risk Assessments', icon: ShieldTask24Regular, iconActive: ShieldTask24Filled, testid: 'nav-risk-assessments', resource: 'risk_assessments', pastel: 'lilac' },
    // v58.13.132hz — Dedicated SSRA capture entry point. Slots after
    // Risk Assessments because SSRAs are a subset of that surface.
    // Same permission (risk_assessments.view) since the underlying
    // endpoint is /api/risk-assessments.
    { to: '/app/capture/ssra', label: 'SSRA', icon: ShieldTask24Regular, iconActive: ShieldTask24Filled, testid: 'nav-capture-ssra', resource: 'risk_assessments', pastel: 'lilac' },
    // v58.13.12 — New "Submissions" bucket.
    // v58.13.132dz — CS Incidents sidebar entry retired. Data merged
    // into Incident Reports (see `/api/cs-incident` 410 gate + the
    // `.132dz` migration script). Old `/app/submissions/cs-incidents`
    // route now redirects to `/app/incidents` (see App.js) for
    // one release cycle so bookmarks / stale tabs land somewhere sane.
    { to: '/app/forms', label: 'Forms', icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-forms', pastel: 'sky' },
    // v160.3.0-adjust-20b — Drag-drop import entry point. Opens the
    // shared <PdfImportModal>. Admin/HSEQ-lead only. Renders as a
    // button (not a NavLink) so it doesn't try to navigate.
    { action: 'open-import', label: 'Import PDFs', icon: CloudArrowUp24Regular, iconActive: CloudArrowUp24Filled, testid: 'nav-import-pdfs', requiresCan: ['workers', 'edit'], pastel: 'sky' },
  ]},
  { section: 'Compliance', items: [
    { to: '/app/suppliers', label: 'Suppliers', icon: People24Regular, iconActive: People24Filled, testid: 'nav-suppliers', pastel: 'sage' },
    { to: '/app/renewals', label: 'Renewal Links', icon: Link24Regular, iconActive: Link24Filled, testid: 'nav-renewals', resource: 'renewals', pastel: 'sage' },
    { to: '/app/document-library', label: 'Document Library', icon: FolderOpen24Regular, iconActive: FolderOpen24Filled, testid: 'nav-document-library', pastel: 'lavender' },
    // v58.13.132mb — Phase 2: non-admin visible entry. AppShell hides
    // this via `hideWhenEmpty: 'sharedWithMe'` when the current user
    // has zero active shares (poll `/document-library/shared-with-me`
    // on mount, empty array → nav item omitted).
    // v58.13.132ml — SOFT HIDE. Nav entry commented out; the poll on
    // mount is also disabled below. Backend endpoints + doc_shares
    // collection preserved. Uncomment this line + the poll useEffect
    // to restore the feature.
    // { to: '/app/shared-with-me', label: 'Shared with me', icon: FolderOpen24Regular, iconActive: FolderOpen24Filled, testid: 'nav-shared-with-me', pastel: 'lavender', hideWhenEmpty: 'sharedWithMe' },
    { to: '/app/audit-exports', label: 'Audit Exports', icon: ArrowDownload24Regular, iconActive: ArrowDownload24Filled, testid: 'nav-audit-exports', resource: 'audit_exports', pastel: 'coral' },
    // v58.13.120d — "Plant & Vehicles" sidebar entry retired. The
    // legacy `/app/vehicles` route still redirects to `/app/fleet`
    // (see LegacyVehiclesRedirect in App.js) during the grace period
    // ending 2026-09-11 so bookmarked deep-links keep working.
    // v58.13.120c — Fleet & Service Register. Sole survivor entry
    // for the fleet/plant/service surface.
    { to: '/app/fleet', label: 'Fleet & Service Register', icon: VehicleTruck24Regular, iconActive: VehicleTruck24Filled, testid: 'nav-fleet', resource: 'assets', pastel: 'violet' },
    // v58.13.132gl-b — Equipment Register (gas monitors, test gauges,
    // calibration certs with expiry tracking).
    { to: '/app/equipment', label: 'Equipment Register', icon: Trophy24Regular, iconActive: Trophy24Filled, testid: 'nav-equipment', pastel: 'butter' },
    { to: '/app/sites', label: 'Sites', icon: Location24Regular, iconActive: Location24Filled, testid: 'nav-sites', requiresCan: ['sites', 'edit'], pastel: 'lavender' },
    // v58.13.132ab — admin-only screen to assign a mobile daily job.
    { to: '/app/mobile/assign-daily-jobs', label: 'Ad-hoc Jobs', icon: ClipboardCheckmark24Regular, iconActive: ClipboardCheckmark24Filled, testid: 'nav-assign-daily-jobs', requiresCan: ['users', 'edit'], pastel: 'coral' },
  ]},
  { section: 'Settings', items: [
    { to: '/app/settings/org', label: 'Organisation', icon: Building24Regular, iconActive: Building24Filled, testid: 'nav-settings-org', pastel: 'slate' },
    // v58.13.132cb — "Workspaces" sidebar entry retired (Phase A of
    // workspaces/sites merge). The concept is now unified with Sites,
    // which lives under Compliance. Existing bookmarks to
    // /app/settings/workspaces redirect to /app/settings/sites (see App.js).
    { to: '/app/settings/users', label: 'Users & Permissions', icon: PeopleSettings24Regular, iconActive: PeopleSettings24Filled, testid: 'nav-settings-users', requiresCan: ['users', 'edit'], pastel: 'slate' },
    { to: '/app/settings/permission-presets', label: 'Permission presets', icon: Trophy24Regular, iconActive: Trophy24Filled, testid: 'nav-settings-permission-presets', requiresCan: ['users', 'edit'], pastel: 'slate' },
    { to: '/app/settings/workers', label: 'Workers', icon: PersonAvailable24Regular, iconActive: PersonAvailable24Filled, testid: 'nav-settings-workers', pastel: 'sky' },
    { to: '/app/settings/form-assignments', label: 'Form Assignments', icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-settings-form-assignments', requiresCan: ['forms', 'edit'], pastel: 'sky' },
    { to: '/app/settings/swms-assignments', label: 'SWMS Assignments', icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-settings-swms-assignments', requiresCan: ['swms', 'edit'], pastel: 'sky' },
    { to: '/app/settings/integrations', label: 'Integrations', icon: PlugConnected24Regular, iconActive: PlugConnected24Filled, testid: 'nav-settings-integrations', resource: 'integrations', pastel: 'slate' },
    { to: '/app/settings/system', label: 'System', icon: Settings24Regular, iconActive: Settings24Filled, testid: 'nav-settings-system', requiresCan: ['users', 'edit'], pastel: 'slate' },
    { to: '/app/settings/certifications', label: 'Certifications', icon: Trophy24Regular, iconActive: Trophy24Filled, testid: 'nav-settings-certifications', pastel: 'butter', badgeKey: 'certExpiry' },
    { to: '/app/settings/backup', label: 'Backup & Restore', icon: CloudArrowUp24Regular, iconActive: CloudArrowUp24Filled, testid: 'nav-settings-backup', requiresCan: ['users', 'edit'], pastel: 'slate' },
    // v160.3.7q — Bird's-eye program schematic (admin-oriented since it links out to every admin surface).
    { to: '/app/settings/schematic', label: 'Program Schematic', icon: Diagram24Regular, iconActive: Diagram24Filled, testid: 'nav-settings-schematic', requiresCan: ['users', 'edit'], pastel: 'lavender' },
    { to: '/app/outbox', label: 'Email outbox', icon: Mail24Regular, iconActive: Mail24Filled, testid: 'nav-outbox', pastel: 'slate' },
    // Phase 4.11 (v121) — top-level Help entry so the user manual is
    // discoverable from anywhere in the app, not just the dashboard
    // header button.
    { to: '/app/help', label: 'User Manual', icon: BookOpen24Regular, iconActive: BookOpen24Filled, testid: 'nav-help', pastel: 'lavender' },
  ]},
];

// Phase 3.20.3 — Per-section icon tint for the sidebar. Always renders the
// Filled glyph variant (matches Option C in the user's design vote). The
// resting colour groups items by section so a glance tells you which
// bucket you're in:
//   • Overview     → violet  (Intelligence)
//   • Capture      → blue    (field record creation)
//   • Compliance   → emerald (post-capture compliance work)
//   • Settings     → slate   (admin)
// Active row override: orange icon + left-border + bg-orange-50, regardless
// of section, so the current route is unmistakable.
const SECTION_TINTS = {
  Overview:   { idle: 'text-violet-600',  hover: 'group-hover:text-violet-700' },
  Capture:    { idle: 'text-blue-600',    hover: 'group-hover:text-blue-700' },
  Compliance: { idle: 'text-emerald-600', hover: 'group-hover:text-emerald-700' },
  Settings:   { idle: 'text-slate-500',   hover: 'group-hover:text-slate-700' },
};

// v58.13.132es — Apps Directory in-app modal state lives at the
// AppShell level so any sidebar item can dispatch the open event
// (`paneltec:open-apps-directory`) and have it caught here.

const SidebarNav = ({ collapsed, onItemClick, canAdminNav, badges = {} }) => {
  const can = useCan();
  // v58.13.132mb — "Shared with me" nav visibility. Poll the endpoint
  // once on mount so the entry only appears for users who actually
  // have a share (admins with no explicit shares get an empty list
  // here and the item stays hidden — admins already see the full
  // library via the main Document Library entry).
  // v58.13.132ml — SOFT HIDE. Poll disabled to avoid a needless
  // /document-library/shared-with-me GET on every AppShell mount
  // while the feature is hidden. `hasShared` stays `false` so the
  // (also-commented-out) NAV entry never appears. Backend endpoint
  // remains reachable for future revival — restore this block AND
  // the NAV entry above to re-enable the feature.
  const [hasShared, _setHasShared] = useState(false);
  void _setHasShared;
  /*
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = (await import('../../lib/api')).default;
        const { data } = await api.get('/document-library/shared-with-me');
        if (!cancelled) setHasShared(Array.isArray(data) && data.length > 0);
      } catch (_e) {
        if (!cancelled) setHasShared(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  */
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4" data-testid="sidebar-nav">
      {NAV.map((group) => {
        // v160.3.8.1 — The Settings section is now dynamic (per-org
        // drag/drop layout + folders). Delegate to <SettingsNav />
        // instead of the flat visible-item loop below. Non-admins
        // see the same layout read-only; the component internally
        // filters by requiresCan / resource gates using the same
        // registry the backend seeds from.
        if (group.section === 'Settings') {
          return (
            <SettingsNav
              key={group.section}
              collapsed={collapsed}
              onItemClick={onItemClick}
              canAdminNav={canAdminNav}
              badges={badges}
            />
          );
        }
        const visible = group.items.filter((it) => {
          // v160.3.9.29-2a — `requiresCan: [resource, action]` supersedes
          // the legacy `adminOnly: true` flag. Both branches supported
          // during the migration; new entries should ONLY use requiresCan.
          if (it.requiresCan && !can(...it.requiresCan)) return false;
          if (it.adminOnly && !canAdminNav) return false;
          if (it.resource && !can(it.resource, 'open')) return false;
          // v58.13.132mb — conditional emptiness gates (currently just
          // 'sharedWithMe'). Extend the switch when new empty-hides
          // land.
          if (it.hideWhenEmpty === 'sharedWithMe' && !hasShared) return false;
          return true;
        });
        if (visible.length === 0) return null;
        const tint = SECTION_TINTS[group.section] || SECTION_TINTS.Settings;
        return (
          <div key={group.section} className="mb-5">
            {!collapsed && <div className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{group.section}</div>}
            <ul className="space-y-0.5">
              {visible.map((it) => {
                const IconFilled = it.iconActive || it.icon;
                const key = it.to || it.action || it.testid;
                // v160.3.0-adjust-20b — Action item (opens a modal via
                // custom event). Rendered as a plain button so it's
                // never `isActive` and doesn't participate in routing.
                if (it.action) {
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => {
                          onItemClick && onItemClick();
                          window.dispatchEvent(new CustomEvent(`paneltec:${it.action}`));
                        }}
                        data-testid={it.testid}
                        title={collapsed ? it.label : undefined}
                        className="group w-full flex items-center gap-3 rounded-lg pr-2.5 pl-2.5 py-2 text-sm text-slate-700 hover:text-slate-900 sidebar-idle text-left"
                      >
                        <IconFilled
                          className={`shrink-0 transition-colors sidebar-icon ${tint.idle} ${tint.hover}`}
                          style={{ width: 20, height: 20 }}
                        />
                        {!collapsed && <span className="truncate flex-1">{it.label}</span>}
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={key}>
                    <NavLink to={it.to} onClick={onItemClick} data-testid={it.testid}
                      className={({ isActive }) =>
                        `group flex items-center gap-3 rounded-lg pr-2.5 pl-2.5 py-2 text-sm transition-all ${
                          isActive
                            ? 'sidebar-active text-slate-900'
                            : 'sidebar-idle text-slate-700 hover:text-slate-900'
                        }`} title={collapsed ? it.label : undefined}>
                      {({ isActive }) => (
                        <>
                          <IconFilled
                            className={`shrink-0 transition-colors sidebar-icon ${isActive ? 'text-orange-500' : `${tint.idle} ${tint.hover}`}`}
                            style={{ width: 20, height: 20 }}
                          />
                          {!collapsed && <span className="truncate flex-1">{it.label}</span>}
                          {!collapsed && it.beta && <span className="text-[9px] uppercase tracking-wider font-semibold text-brand-violet bg-brand-violet-soft px-1.5 py-0.5 rounded">Beta</span>}
                          {/* v58.13.109 — Sidebar badge pill. Renders when
                              the badges dict has a truthy total for the
                              item's badgeKey. Only wired for the
                              Certifications entry today (expired +
                              expiring-within-30-days count). Red pill so
                              it reads as "attention required" at a
                              glance without being tied to a specific
                              route colour. */}
                          {!collapsed && it.badgeKey && badges[it.badgeKey]?.total > 0 && (
                            <span
                              data-testid={`${it.testid}-badge`}
                              title={`${badges[it.badgeKey].expired} expired · ${badges[it.badgeKey].expiring_soon} expiring soon`}
                              className="ml-auto text-[10px] leading-none font-semibold text-white bg-red-600 rounded-full px-1.5 py-0.5 min-w-[18px] text-center"
                            >
                              {badges[it.badgeKey].total > 99 ? '99+' : badges[it.badgeKey].total}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
};

function TopBar({ onToggleMobile, onToggleCollapse, collapsed, user }) {
  // v160.3.0-adjust-19 — Drag-drop PDF import.
  const [importOpen, setImportOpen] = useState(false);
  // v160.3.9.29-2a — `canImport` now driven by the granular workers.edit
  // token via useCan(), matching the backend guard on /api/imports/pdf.
  // Previously hard-coded to ['admin','hseq_lead'] which duplicated the
  // legacy _admin() check.
  const can = useCan();
  const canImport = can('workers', 'edit');
  // v160.3.0-adjust-20b — Sidebar "Import PDFs" nav item dispatches
  // this custom event; the TopBar owns the modal state so a single
  // modal instance is reused across both entry points.
  useEffect(() => {
    const onOpenImport = () => setImportOpen(true);
    window.addEventListener('paneltec:open-import', onOpenImport);
    return () => window.removeEventListener('paneltec:open-import', onOpenImport);
  }, []);
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId, setWorkspaceId } = useWorkspace();
  const [workspaces, setWorkspaces] = useState([]);
  // Phase 4.7 — self-serve password change from the user dropdown.
  const [changePwOpen, setChangePwOpen] = useState(false);
  // Phase 4.7.3 — Comms Safe Mode indicator (v58.13.92 — always-on
  // color-coded pill; was previously a conditional amber chip that
  // only rendered when Safe Mode was ON).
  const [safeMode, setSafeMode] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      api.get('/admin/comms-safe-mode/status')
        .then((r) => { if (alive) setSafeMode(r.data); })
        .catch(() => { /* non-admin or unauthenticated, skip */ });
    };
    load();
    // v58.13.92 — live-update the pill without a full page refresh.
    //   1. Refetch on any route change (cheap; means clicking away
    //      from `/app/settings/comms-safe-mode` back to a dashboard
    //      immediately reflects the new state).
    //   2. Listen for the `paneltec:comms-safe-mode-changed` window
    //      event that `CommsSafeMode.jsx` dispatches after a
    //      successful PATCH so the pill flips in the same tab even
    //      when the user stays on the admin page.
    const onEvent = () => load();
    window.addEventListener('paneltec:comms-safe-mode-changed', onEvent);
    return () => {
      alive = false;
      window.removeEventListener('paneltec:comms-safe-mode-changed', onEvent);
    };
  }, [location.pathname]);
  useEffect(() => {
    let live = true;
    api.get('/workspaces')
      .then(({ data }) => { if (live) setWorkspaces(Array.isArray(data) ? data : []); })
      .catch(() => { if (live) setWorkspaces([]); });
    return () => { live = false; };
  }, [location.pathname]);  // refetch when nav changes (cheap, makes deletes reflect)

  const hasWorkspaces = workspaces.length > 0;
  // v58.13.132ak — Only expose the switcher when there is more than
  // one workspace. With a single workspace the "All / <that one>"
  // choice is a no-op and just clutters the header.
  const showSwitcher = workspaces.length > 1;
  const options = hasWorkspaces ? [{ id: '*', name: 'All workspaces' }, ...workspaces] : [];
  const active = options.find((o) => o.id === workspaceId) || options[0] || { id: '*', name: 'No workspaces' };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  // Phase 3.16 — session-timeout warning lives at the AppShell level so the
  // modal is rendered as a sibling of <main>, not nested inside TopBar.
  // Previously the state was declared inside TopBar but referenced down here,
  // which exploded with "warnInfo is not defined" on every /app/* render.

  const onBack = () => {
    // navigate(-1) falls back gracefully when history is empty in most
    // browsers, but be explicit: if there's effectively no history (e.g. the
    // user landed directly on a non-dashboard URL), send them home instead.
    if (window.history.length <= 1) navigate('/app/dashboard');
    else navigate(-1);
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center gap-3 px-4 lg:px-6 sticky top-0 z-30 max-md:civil-chrome max-md:border-b-black" data-testid="topbar-header">
      <button className="md:hidden p-2 rounded-md hover:bg-slate-100" onClick={onToggleMobile} data-testid="mobile-menu-button" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <button className="hidden md:inline-flex p-2 rounded-md hover:bg-slate-100 text-slate-500" onClick={onToggleCollapse} data-testid="sidebar-collapse-button" aria-label="Collapse sidebar">
        {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
      </button>

      {location.pathname !== '/app/dashboard' && (
        <button
          onClick={onBack}
          title="Back"
          aria-label="Back"
          data-testid="topbar-back"
          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 hover:text-slate-900 transition-colors">
          <ChevronLeft size={16} />
        </button>
      )}

      {/* v58.13.132ak — Workspace switcher hides when there is 0 or
          1 workspace (Stephen's Paneltec Civil case: single "Work
          Admin" workspace makes the switcher a no-op). Multi-tenancy
          plumbing (`useWorkspace` / `wsParams`) stays intact; the
          switcher reappears the moment a 2nd workspace is provisioned
          via Settings → Workspaces. */}
      {showSwitcher && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm max-md:bg-transparent max-md:border-civil-concrete-mid max-md:text-civil-off-white max-md:min-h-[44px]" data-testid="workspace-switcher">
              <span className={`w-2 h-2 rounded-full ${hasWorkspaces ? 'bg-brand-blue max-md:bg-civil-hivis-orange' : 'bg-slate-300'}`} />
              <span className="font-medium">{active.name}</span>
              <ChevronDown size={14} className="text-slate-400 max-md:text-civil-off-white" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {options.map((w) => (
              <DropdownMenuItem key={w.id} onClick={() => setWorkspaceId(w.id)} data-testid={`workspace-option-${w.id}`}>
                {w.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* v58.13.132ak — Global search input removed. Was a placeholder
          since v54 (see tooltip: "Full search UI queued for v54.") —
          never wired to a real search endpoint. Restore JSX from the
          .132aj revision if a real Ask-style global search lands
          later. */}
      <div className="flex-1" />

      <NotificationsBell />
      <OutboxBell />
      {/* v58.13.132iv — Compact "Download app" chip. Admin-only. Sits
          left of the notification bells so it doesn't jostle their
          badge counts. Popover surfaces the Android APK direct link
          (endpoint `/api/mobile/downloads/android/latest.apk` has
          existed since .132af), an iOS placeholder, and a deep link
          to the full Mobile App Modules admin page for advanced
          controls. Added because users kept getting lost hunting for
          the APK three levels deep in Settings → Permissions & Roles
          → Mobile App Modules tab. */}
      {user?.role === 'admin' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="topbar-download-app"
              title="Download the mobile app"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 text-white border border-slate-900 text-[11px] font-semibold uppercase tracking-wider hover:bg-slate-700 transition-colors"
            >
              <Smartphone size={12} />
              Download app
              <ChevronDown size={10} className="opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 p-3">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Paneltec Civil · Mobile app
            </DropdownMenuLabel>
            <p className="mt-1 mb-3 text-xs text-slate-600 leading-relaxed">
              Install the mobile app for field workers, admins doing role-simulator testing, or QR sign-on stations.
            </p>
            {/* v58.13.132ix — Currently-published APK metadata + admin
                "Sync latest from EAS" button. Reads manifest from
                /mobile/downloads/android/version (public, no auth) and
                POSTs to /mobile/downloads/android/ingest-from-eas
                (admin-only) to refresh from EAS. */}
            <ApkVersionBlock />
            <a
              href="/api/mobile/downloads/android/latest.apk"
              download
              data-testid="topbar-download-app-android"
              className="block w-full text-center rounded-xl px-3 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-700 transition mb-2"
            >
              ⬇ Download Android APK
            </a>
            <button
              type="button"
              disabled
              data-testid="topbar-download-app-ios"
              className="block w-full text-center rounded-xl px-3 py-2 text-sm font-medium bg-slate-100 text-slate-400 cursor-not-allowed mb-3"
              title="iOS TestFlight setup pending — reach out to admin for status."
            >
              iOS install · Coming soon
            </button>
            <p className="text-[10px] text-slate-500 leading-relaxed mb-2">
              Android: sideload the APK · enable "Install from unknown sources" on first install.
            </p>
            <DropdownMenuSeparator />
            <Link
              to="/app/settings/permission-presets"
              data-testid="topbar-download-app-modules-link"
              className="mt-2 block w-full text-center rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 border border-slate-200"
            >
              Manage mobile modules →
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* v160.3.9.58.1 — persistent pill for in-flight bulk imports. */}
      <BulkImportPill />

      {/* v58.13.132am — Wrap the 4 status pills (Import PDFs, API,
          Backup, Comms Safe Mode) behind a PIN glance-shield.
          Underlying endpoints stay open — this is UX only. Non-admin
          users see nothing here; admins see 🔒 Admin, which reveals
          the pills after PIN unlock (sessionStorage TTL). */}
      <AdminPillsLock>
      {/* v160.3.0-adjust-19 — Drag-drop PDF import (admin only). */}
      {canImport && (
        <button
          onClick={() => setImportOpen(true)}
          title={'Import PDFs\nUpload signed forms, certificates, or supplier documents to attach them to the right worker or site.'}
          data-testid="topbar-import-pdfs"
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold uppercase tracking-wider hover:bg-blue-100 transition-colors"
        >
          <Upload size={12} />
          Import PDFs
        </button>
      )}

      {/* Phase 4.16 (v133) — tech-aesthetic pills */}
      <ApiHealthPill />
      <BackupPill />

      {/* v58.13.92 — Always-visible color-coded Comms Safe Mode pill.
          Previously (Phase 4.7.3) this only rendered when Safe Mode
          was ON — a "warning-only" chip. User pain (verbatim): "i
          will need i pill if i need to get to it quickly." So the
          pill now renders in all three states:
            · Safe Mode ON            → amber pill, ShieldCheck icon
            · Safe Mode OFF           → green pill, ShieldOff icon
            · env_locked (ON via env) → amber-plus-lock variant
          When `safeMode` hasn't loaded yet (initial mount, or the
          call 401s for a non-admin) we render nothing — that's the
          same behaviour as before, avoids a skeleton flicker. */}
      {safeMode && (() => {
        const eff = safeMode.effective;
        const locked = !!safeMode.env_locked;
        const isOn = eff === 'on';
        const n = Number(safeMode.blocked_count || 0);
        const showBadge = isOn && n > 0;
        // v58.13.94 — Color semantics flipped from .92/.93 to match
        // user intuition. USER PAIN VERBATIM: "with the safe mode on
        // you were going to turn the pill green to show its on."
        //   ON  → GREEN (system is protecting — reassuring)
        //   OFF → AMBER (real sends possible — warning)
        // Icons unchanged: ShieldCheck (ON) = "protected",
        // ShieldOff (OFF) = "protection dropped".
        const cls = isOn
          ? 'bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200'
          : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100';
        const Icon = isOn ? ShieldCheck : ShieldOff;
        const iconCls = isOn
          ? 'fill-emerald-500 text-emerald-700'
          : 'text-amber-700';
        const label = isOn
          ? 'Comms Safe Mode: ON'
          : 'Comms Safe Mode: OFF';
        // v58.13.94 — Tooltip copy also flipped to emphasise SAFETY
        // when ON and RISK when OFF (per ship spec). Pluralisation
        // and the env-locked qualifier from .92/.93 preserved.
        const tooltip = isOn
          ? (locked
              ? (showBadge
                  ? `Comms Safe Mode is ON (env-locked) — ${n} outbound comm${n === 1 ? '' : 's'} captured safely, not delivered. Click to manage.`
                  : 'Comms Safe Mode is ON (env-locked) — outbound comms are being captured safely, not delivered. Click to manage.')
              : (showBadge
                  ? `Comms Safe Mode is ON — ${n} outbound comm${n === 1 ? '' : 's'} captured safely, not delivered. Click to manage.`
                  : 'Comms Safe Mode is ON — outbound comms are being captured safely, not delivered. Click to manage.'))
          : 'Comms Safe Mode is OFF — real emails and SMS will fire on button clicks. Click to manage.';
        return (
          <Link
            to="/app/settings/comms-safe-mode"
            title={tooltip}
            aria-label={tooltip}
            data-testid="comms-safe-mode-chip"
            data-mode={eff}
            data-env-locked={locked ? 'true' : 'false'}
            data-blocked-count={String(n)}
            className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 ${isOn ? 'focus:ring-emerald-400' : 'focus:ring-amber-400'} ${cls}`}
          >
            <Icon size={12} className={iconCls} aria-hidden="true" />
            {label}
            {showBadge && (
              // v58.13.94 — Badge re-coloured for contrast on the
              // new green pill. White fill + emerald-800 text keeps
              // the count legible without adding a second "alarm"
              // colour to a pill that is itself the reassuring
              // signal. If the count needs to feel more urgent for
              // large backlogs, a future ship can swap to
              // `bg-rose-500 text-white` at a threshold (e.g. N>=10).
              <span
                data-testid="comms-safe-mode-chip-count"
                className="ml-0.5 inline-flex items-center justify-center min-w-[16px] px-1 rounded-full bg-white text-emerald-800 border border-emerald-300 text-[10px] font-bold leading-none tabular-nums"
                aria-hidden="true"
              >
                {n}
              </span>
            )}
            {locked && (
              <Lock size={10} className="text-emerald-700" aria-hidden="true" data-testid="comms-safe-mode-chip-env-lock" />
            )}
          </Link>
        );
      })()}
      </AdminPillsLock>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 ml-1 pl-1 pr-2 py-0.5 rounded-full hover:bg-slate-100"
            data-testid="user-menu-trigger"
            title={'Account\nYour profile, session settings, and sign out.'}
            aria-label="Account and settings menu"
          >
            <span className="grid place-items-center w-8 h-8 rounded-full bg-orange-500 text-white text-xs font-bold shadow-sm">
              {initials(user)}
            </span>
            {/* v58.13.132ew — Full name + role for security awareness so
                users can never mistake which account they are acting on.
                Was previously just the first-name in uppercase. */}
            <span className="hidden sm:flex flex-col items-start leading-tight" data-testid="user-chip-identity">
              <span className="text-xs font-semibold text-slate-800 truncate max-w-[160px]">
                {user?.name || user?.email || 'You'}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {(user?.role_id || user?.role || 'user').replace(/_/g, ' ')}
              </span>
            </span>
            <ChevronDown size={14} className="text-slate-400 hidden sm:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-96 p-0 bg-slate-950 text-slate-100 border border-orange-500/40 rounded-2xl shadow-2xl overflow-hidden"
          style={{ backgroundImage: 'radial-gradient(rgba(249,115,22,0.10) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
          <UserDropdownCard
            user={user}
            onChangePassword={() => setChangePwOpen(true)}
            onSignOut={handleSignOut}
            onNavigate={navigate}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordModal open={changePwOpen} onClose={() => setChangePwOpen(false)} />
      {/* v160.3.0-adjust-19 — Drag-drop PDF import modal. */}
      <PdfImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </header>
  );
}

const SidebarShell = ({ collapsed, canAdminNav, badges, brandName, user }) => (
  <aside className={`hidden md:flex flex-col bg-white border-r border-slate-200 transition-[width] duration-200 sticky top-0 h-screen z-20 ${collapsed ? 'w-[72px]' : 'w-64'}`} data-testid="sidebar-desktop">
    <div className={`h-16 flex items-center border-b border-slate-200 bg-white ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
      <Link to="/app/dashboard" className="block">
        {collapsed
          ? <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" fill="#2C6BFF" /></svg>
          : <Logo size="sm" displayName={brandName} />}
      </Link>
    </div>
    {/* v58.13.132ew — Belt-and-braces "Logged in as" line under the
        wordmark. Visible from every page so users can't confuse which
        account they are acting on. Collapsed sidebar hides it. */}
    {!collapsed && user && (
      <div className="px-5 py-2 border-b border-slate-100 bg-slate-50/60"
           data-testid="sidebar-logged-in-as">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Logged in as</div>
        <div className="text-xs font-semibold text-slate-800 truncate">{user?.name || user?.email || 'You'}</div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500">
          {(user?.role_id || user?.role || 'user').replace(/_/g, ' ')}
        </div>
      </div>
    )}
    <SidebarNav collapsed={collapsed} canAdminNav={canAdminNav} badges={badges} />
    {/* v58.13.132cd — Version pill raised ABOVE the PWA install
        button (previously at the very bottom of the sidebar, hard
        to see on 900px laptops when the nav overflowed) and
        re-styled as a proper badge with `bg-slate-100`,
        `border-slate-200`, `text-slate-700` for a legible WCAG-AA
        contrast against the white sidebar. Kept the same testid
        (`app-version-footer`) and the `title={RUNNING_VERSION}`
        tooltip so tests that rely on the source-of-truth string
        stay green. Collapsed sidebar strips the leading
        `paneltec-` prefix and shows only the version tail (still
        the same string exposed to the tooltip). Bottom margin
        `mb-2` keeps it visually separated from the PWA install
        button below.
        v58.13.132dj — Lifted ~20px higher off the bottom edge per
        Stephen's UX brief: bottom padding pb-5 (was pb-1) so the
        pill floats clear of the sidebar chrome on short laptops. */}
    <div
      className={`${collapsed ? 'px-1.5' : 'px-3'} mt-auto pt-3 pb-5`}
      data-testid="app-version-footer"
      title={RUNNING_VERSION}
    >
      <div
        className={`w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 text-slate-700 font-mono font-semibold text-[10px] leading-none py-1.5 ${collapsed ? 'px-1.5' : 'px-2.5'} shadow-sm`}
        data-testid="app-version-pill"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        <span className="truncate">
          {collapsed
            ? RUNNING_VERSION.split('-').pop()
            : RUNNING_VERSION.replace(/^paneltec-/, '')}
        </span>
      </div>
    </div>
    {/* v58.13.112 — PWA install affordance. Hidden entirely when the
        app is already running in standalone mode (usePwaInstall
        detects `display-mode: standalone` + iOS `navigator.standalone`).
        Auto-shows on Chrome/Edge/Android after the browser fires
        `beforeinstallprompt`; opens an iOS Safari walk-through on
        iOS instead. v58.13.132cd — Now sits BELOW the version pill
        (previous order had the pill under this button, out of view
        on short viewports). */}
    <PwaInstallButton collapsed={collapsed} />
  </aside>
);

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState(getUser());
  // v58.13.109 — Sidebar Certifications badge. `{expired, expiring_soon,
  // total}` refreshed on shell mount + on every route change. Cheap
  // count endpoint (`/api/certifications/expiry-count`) — no polling
  // interval, no websocket, no aggressive refetching. Server-side
  // guarded by `@safe_admin_endpoint` so a Mongo hiccup renders the
  // pill as absent instead of exploding the shell.
  const [certBadge, setCertBadge] = useState({ expired: 0, expiring_soon: 0, total: 0 });
  // v58.13.132dr — Sidebar wordmark now reads the org's chosen brand
  // name (`display_name → trading_name → name → 'Paneltec Civil'`)
  // instead of the historical hard-coded literal. Fetched once on
  // shell mount; refreshed on the `paneltec_org_updated` custom
  // event so Org Settings saves reflect in the sidebar without a
  // page reload.
  const [brandName, setBrandName] = useState('Paneltec Civil');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await import('../../lib/api');
        const { data } = await r.default.get('/org');
        if (!alive) return;
        setBrandName(
          (data?.display_name || data?.trading_name || data?.name
           || 'Paneltec Civil').trim(),
        );
      } catch (_e) { /* keep default */ }
    };
    load();
    const bump = () => load();
    window.addEventListener('paneltec_org_updated', bump);
    return () => { alive = false; window.removeEventListener('paneltec_org_updated', bump); };
  }, []);
  // Phase 3.16 — idle-watch + warning modal driver. Lives here (not in
  // TopBar) so the modal can be rendered as a sibling of <main> below.
  const [warnInfo, setWarnInfo] = useState(null);
  // v58.13.132es — Apps Directory in-app modal. Toggled by the
  // sidebar entry via the `paneltec:open-apps-directory` CustomEvent.
  const [appsDirectoryOpen, setAppsDirectoryOpen] = useState(false);
  useEffect(() => {
    const open = () => setAppsDirectoryOpen(true);
    window.addEventListener('paneltec:open-apps-directory', open);
    return () => window.removeEventListener('paneltec:open-apps-directory', open);
  }, []);
  // v58.13.132et — Auto-open the modal when landing with
  // `?open=apps-directory` (fed by the legacy /quick-links redirect
  // so old bookmarks still work).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('open') === 'apps-directory') {
      setAppsDirectoryOpen(true);
    }
  }, [location.search]);
  useSessionTimeout({
    onWarn: (info) => setWarnInfo(info),
    onLogout: async () => {
      setWarnInfo(null);
      await signOut();
      navigate('/?reason=idle');
    },
  });

  // refresh user from server on mount so role/name stays accurate, and slide
  // the JWT window via a silent /auth/refresh so long-idle sessions don't 401.
  useEffect(() => {
    // v96.2 — Self-heal stuck-SW browsers. If the controlling SW version
    // doesn't match what the backend advertises, this nukes caches +
    // unregisters and force-reloads exactly once per session. Fire-and-
    // forget; safe to ignore the promise.
    runSwVersionGuard();
    if (getToken()) {
      refreshToken().finally(() => {
        fetchMe().then(setUser).catch(() => { /* 401 interceptor redirects */ });
      });
    }
  }, []);

  // v58.13.109 — Certifications sidebar badge. Refetch on mount + every
  // route change (`location.pathname` dep). No interval — the pill is
  // a "second opinion" indicator not a live tracker, and the cheap
  // /expiry-count endpoint is fine at pathname granularity. Silent
  // fail (setCertBadge to zeros) if the user's role can't read the
  // endpoint or the network hiccups; the pill just doesn't render.
  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    api.get('/certifications/expiry-count').then((r) => {
      if (!alive) return;
      const expired = Number(r?.data?.expired || 0);
      const soon = Number(r?.data?.expiring_soon || 0);
      setCertBadge({ expired, expiring_soon: soon, total: expired + soon });
    }).catch(() => {
      if (alive) setCertBadge({ expired: 0, expiring_soon: 0, total: 0 });
    });
    return () => { alive = false; };
  }, [location.pathname]);

  if (!getToken()) return <Navigate to="/" replace />;

  const permsValue = {
    effective: user?.effective_permissions || {},
    role: user?.role || null,
  };
  // v160.3.9.29-2a — Global admin-nav gate now derived from the granular
  // `users.edit` permission (per Phase 3c decision #3 — coarse "admin
  // identity" derived from users.edit rather than hardcoding a role
  // string). Reads directly off `effective_permissions` so we don't
  // need to be inside <PermissionsProvider> to compute it. Any legacy
  // consumer that still calls this `isAdmin` receives the equivalent
  // boolean (admin + hseq_lead both carry users.edit=true in the seed).
  const canAdminNav = !!user?.effective_permissions?.users?.edit;

  return (
    <PermissionsProvider value={permsValue}>
    <div className="min-h-screen flex bg-brand-bg" data-testid="app-shell">
      <SidebarShell collapsed={collapsed} canAdminNav={canAdminNav} badges={{ certExpiry: certBadge }} brandName={brandName} user={user} />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-72 civil-chrome max-md:border-r-black">
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <div className="h-16 flex items-center justify-between px-5 border-b border-black/40">
            <Logo size="sm" displayName={brandName} />
            <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="p-2 min-w-[48px] min-h-[48px] text-civil-off-white"><X size={20} /></button>
          </div>
          <SidebarNav collapsed={false} onItemClick={() => setMobileOpen(false)} canAdminNav={canAdminNav} badges={{ certExpiry: certBadge }} />
          {/* v58.13.112 — PWA install button also mounted in the mobile
              drawer so Android Chrome users who never open the desktop
              sidebar still see the install affordance. */}
          <div className="mt-auto">
            <PwaInstallButton collapsed={false} />
          </div>
        </SheetContent>
      </Sheet>

      {/* v160.3.0-adjust-7 — Content-column MUST be a stacking context that
       * sits ABOVE the sidebar's z-20. Without this, every page-level
       * modal (`fixed inset-0 z-50 flex items-center …`) is contained
       * in the z-auto flex item's paint layer and paints UNDER the
       * z-20 sidebar. Symptom: left edge of every modal (Worker Edit,
       * Suppliers Edit, Vehicle Edit, PDF preview, Session Warning,
       * Change Password, Confirmations, etc.) clipped by the sidebar.
       * Diagnosis proof: with the modal in-place, `elementsFromPoint(100, 400)`
       * (inside the sidebar area) returned the sidebar's <a> as the
       * topmost element; the modal (z-50) was BELOW it in the paint
       * order. Bumping the modal's z-index to 100 / 9999 did NOT help
       * (stacking context escape). Portaling the modal to `document.body`
       * DID fix it. Giving the content-column its own stacking context
       * via `relative z-40` also fixes it AND does not require
       * refactoring every modal to use React portals.
       *
       * z-40 chosen because:
       *   - Sidebar is z-20 (must beat).
       *   - Radix Portal overlays (Dropdown, Popover, Toast, Dialog)
       *     render OUTSIDE this div via `document.body`, so they still
       *     compete only in the root stacking context.
       *   - Modal at z-50 lives INSIDE this div, painting above the
       *     topbar (z-30 sibling inside this same context) and above
       *     the sidebar (z-20 sibling outside this context).
       */}
      <div className="flex-1 flex flex-col min-w-0 relative z-40">
        <TopBar onToggleMobile={() => setMobileOpen(true)} onToggleCollapse={() => setCollapsed((c) => !c)} collapsed={collapsed} user={user} />
        {/* v58.13.112 — One-time PWA install banner. Only renders on
            Chrome/Edge/Android after `beforeinstallprompt` fires OR
            on iOS Safari. Auto-persists after 30 s so subsequent
            page loads don't repeat it; Not-now / ✕ do a session-only
            dismiss so the same tab doesn't repeat it either. */}
        <PwaInstallBanner />
        <RebrandNudge />
        {/* v160.3.0-adjust-7 — Kept `pt-6 / sm:pt-8 / lg:pt-10` from
         *   adjust-6 (visual breathing room below the topbar). Side +
         *   bottom padding unchanged. Modal clipping was NOT a padding
         *   bug — see the flex-stacking-context fix on the parent div. */}
        <main className="flex-1 p-4 pt-6 sm:p-6 sm:pt-8 lg:p-8 lg:pt-10" data-testid="app-main">
          {/* v156.1 — Opacity-only route transition. `animate-route-fade` has
              NO `transform` keyframe, so this wrapper never becomes a
              containing block for `position: fixed` modal descendants. */}
          <div key={location.pathname} className="animate-route-fade">
            <Outlet />
          </div>
        </main>
      </div>
      {warnInfo && (
        <SessionWarningModal
          secondsRemaining={warnInfo.secondsRemaining}
          onStay={() => { warnInfo.stay?.(); setWarnInfo(null); }}
          onLogout={async () => { setWarnInfo(null); await signOut(); navigate('/?reason=idle'); }} />
      )}
      {/* v58.13.132dp — 7-day insurance critical alert. Admin-only,
          one-time-per-session dismissible. Silent for non-admins. */}
      <InsuranceCriticalModal />
      {/* v58.13.132es — Apps Directory in-app modal (sidebar entry
          fires `paneltec:open-apps-directory`). */}
      <AppsDirectoryModal open={appsDirectoryOpen} onClose={() => setAppsDirectoryOpen(false)} />
    </div>
    </PermissionsProvider>
  );
}
