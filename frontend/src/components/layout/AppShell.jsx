import React, { useEffect, useState } from 'react';
import { runSwVersionGuard } from '@/lib/swVersionGuard';
import RebrandNudge from '@/components/RebrandNudge';
// v160.3.8.1 — Draggable Settings sub-nav replaces the flat Settings section.
import SettingsNav from '@/components/settings/SettingsNav';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Search, Bell, ChevronDown, ChevronLeft, Menu, X, LogOut, ChevronsLeft, ChevronsRight, Plus,
  KeyRound as KeyRoundIcon, Zap, Upload,
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
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { ChangePasswordModal } from '../auth/AuthBundle';
import { ApiHealthPill, BackupPill, UserDropdownCard } from './TopbarPills';

const NAV = [
  { section: 'Overview', items: [
    { to: '/app/dashboard', label: 'Intelligence Centre', icon: Board24Regular, iconActive: Board24Filled, testid: 'nav-dashboard', pastel: 'coral' },
    { to: '/app/ask', label: 'Ask Intelligence', icon: Sparkle24Regular, iconActive: Sparkle24Filled, testid: 'nav-ask', pastel: 'lilac' },
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
    { to: '/app/hazards', label: 'Hazard Reports', icon: Warning24Regular, iconActive: Warning24Filled, testid: 'nav-hazards', resource: 'hazards', pastel: 'peach' },
    { to: '/app/incidents', label: 'Incident Reports', icon: Alert24Regular, iconActive: Alert24Filled, testid: 'nav-incidents', resource: 'incidents', pastel: 'blush' },
    { to: '/app/inspections', label: 'Inspection Reports', icon: ShieldCheckmark24Regular, iconActive: ShieldCheckmark24Filled, testid: 'nav-inspections', resource: 'inspections', pastel: 'lavender' },
    // v58.13.6 — Site Sign-In / Visitor Register capture entry. Reads
    // submissions of the fixed template id via the shared endpoint.
    // Uses PersonAvailable icon (already imported) — semantically fits
    // "visitor present". Slotted after Inspections and before Risk
    // Assessments to preserve the existing Capture ordering.
    { to: '/app/site-signin', label: 'Site Sign-In / Visitor Register', icon: PersonAvailable24Regular, iconActive: PersonAvailable24Filled, testid: 'nav-site-signin', pastel: 'sky' },
    // v160.3.0-adjust-13 — new Capture bucket. Slots after Inspection
    // Reports because risk assessments feed inspection / audit workflows.
    { to: '/app/risk-assessments', label: 'Risk Assessments', icon: ShieldTask24Regular, iconActive: ShieldTask24Filled, testid: 'nav-risk-assessments', resource: 'risk_assessments', pastel: 'lilac' },
    // v58.13.12 — New "Submissions" bucket. Consolidates
    // reference-library issue lists that share the tile UX. First
    // occupant is CS Incidents (migrated out of the Risk Assessments
    // tab bar). Reuses `reference_library` gate — same permission the
    // old tab used, no permission migration required.
    { to: '/app/submissions/cs-incidents', label: 'CS Incidents', icon: Alert24Regular, iconActive: Alert24Filled, testid: 'nav-submissions-cs-incidents', resource: 'reference_library', pastel: 'coral' },
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
    { to: '/app/audit-exports', label: 'Audit Exports', icon: ArrowDownload24Regular, iconActive: ArrowDownload24Filled, testid: 'nav-audit-exports', resource: 'audit_exports', pastel: 'coral' },
    { to: '/app/vehicles', label: 'Plant & Vehicles', icon: VehicleTruck24Regular, iconActive: VehicleTruck24Filled, testid: 'nav-vehicles', resource: 'assets', pastel: 'sky' },
    { to: '/app/sites', label: 'Sites', icon: Location24Regular, iconActive: Location24Filled, testid: 'nav-sites', requiresCan: ['sites', 'edit'], pastel: 'lavender' },
  ]},
  { section: 'Settings', items: [
    { to: '/app/settings/org', label: 'Organisation', icon: Building24Regular, iconActive: Building24Filled, testid: 'nav-settings-org', pastel: 'slate' },
    { to: '/app/settings/workspaces', label: 'Workspaces', icon: CubeMultiple24Regular, iconActive: CubeMultiple24Filled, testid: 'nav-settings-workspaces', pastel: 'slate' },
    { to: '/app/settings/users', label: 'Users & Permissions', icon: PeopleSettings24Regular, iconActive: PeopleSettings24Filled, testid: 'nav-settings-users', requiresCan: ['users', 'edit'], pastel: 'slate' },
    { to: '/app/settings/permission-presets', label: 'Permission presets', icon: Trophy24Regular, iconActive: Trophy24Filled, testid: 'nav-settings-permission-presets', requiresCan: ['users', 'edit'], pastel: 'slate' },
    { to: '/app/settings/workers', label: 'Workers', icon: PersonAvailable24Regular, iconActive: PersonAvailable24Filled, testid: 'nav-settings-workers', pastel: 'sky' },
    { to: '/app/settings/form-assignments', label: 'Form Assignments', icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-settings-form-assignments', requiresCan: ['forms', 'edit'], pastel: 'sky' },
    { to: '/app/settings/swms-assignments', label: 'SWMS Assignments', icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-settings-swms-assignments', requiresCan: ['swms', 'edit'], pastel: 'sky' },
    { to: '/app/settings/integrations', label: 'Integrations', icon: PlugConnected24Regular, iconActive: PlugConnected24Filled, testid: 'nav-settings-integrations', resource: 'integrations', pastel: 'slate' },
    { to: '/app/settings/system', label: 'System', icon: Settings24Regular, iconActive: Settings24Filled, testid: 'nav-settings-system', requiresCan: ['users', 'edit'], pastel: 'slate' },
    { to: '/app/settings/certifications', label: 'Certifications', icon: Trophy24Regular, iconActive: Trophy24Filled, testid: 'nav-settings-certifications', pastel: 'butter' },
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

const SidebarNav = ({ collapsed, onItemClick, canAdminNav }) => {
  const can = useCan();
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
  // Phase 4.7.3 — Comms Safe Mode indicator (yellow lightning chip).
  const [safeMode, setSafeMode] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/admin/comms-safe-mode/status')
      .then((r) => { if (alive) setSafeMode(r.data); })
      .catch(() => { /* non-admin or unauthenticated, skip */ });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let live = true;
    api.get('/workspaces')
      .then(({ data }) => { if (live) setWorkspaces(Array.isArray(data) ? data : []); })
      .catch(() => { if (live) setWorkspaces([]); });
    return () => { live = false; };
  }, [location.pathname]);  // refetch when nav changes (cheap, makes deletes reflect)

  const hasWorkspaces = workspaces.length > 0;
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
    <header className="h-16 bg-white border-b border-slate-200 flex items-center gap-3 px-4 lg:px-6 sticky top-0 z-30">
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm" data-testid="workspace-switcher">
            <span className={`w-2 h-2 rounded-full ${hasWorkspaces ? 'bg-brand-blue' : 'bg-slate-300'}`} />
            <span className="font-medium">{active.name}</span>
            <ChevronDown size={14} className="text-slate-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {hasWorkspaces ? (
            options.map((w) => (
              <DropdownMenuItem key={w.id} onClick={() => setWorkspaceId(w.id)} data-testid={`workspace-option-${w.id}`}>
                {w.name}
              </DropdownMenuItem>
            ))
          ) : (
            <div className="px-2 py-3 text-center" data-testid="workspace-empty-state">
              <p className="text-xs text-slate-500 mb-2">No workspaces yet.</p>
              <Link
                to="/app/settings/workspaces"
                data-testid="workspace-empty-create-link"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-blue text-white text-xs font-medium hover:bg-blue-600"
              >
                <Plus size={12} /> Create your first workspace
              </Link>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="hidden md:flex flex-1 max-w-md ml-2 relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          placeholder={'Try: "john smith", "swms-042", "sydney site 3"…  (⌘K)'}
          data-testid="topbar-search"
          title={'Global search\nFind any worker, site, SWMS, contractor, certification, or HR record across the whole platform. Full search UI queued for v54.'}
          aria-label="Global search — find workers, sites, SWMS, contractors, certifications, or HR records"
          className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
        />
      </div>
      <div className="flex-1 md:hidden" />

      <NotificationsBell />
      <OutboxBell />
      {/* v160.3.9.58.1 — persistent pill for in-flight bulk imports. */}
      <BulkImportPill />

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

      {safeMode?.effective === 'on' && (
        <Link
          to="/app/settings/comms-safe-mode"
          title={'Comms Safe Mode\nWhen ON, outgoing SMS/email are held in the Outbox instead of sending — useful for testing without spamming real people. Click to open Settings.'}
          data-testid="comms-safe-mode-chip"
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-semibold uppercase tracking-wider hover:bg-amber-200 transition-colors">
          <Zap size={12} className="fill-amber-500 text-amber-600" />
          Comms Safe Mode
        </Link>
      )}

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
            <span className="hidden sm:inline text-xs font-semibold tracking-wider uppercase text-slate-700">
              {(user?.name || user?.email || 'YOU').split(' ')[0]}
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

const SidebarShell = ({ collapsed, canAdminNav }) => (
  <aside className={`hidden md:flex flex-col bg-white border-r border-slate-200 transition-[width] duration-200 sticky top-0 h-screen z-20 ${collapsed ? 'w-[72px]' : 'w-64'}`} data-testid="sidebar-desktop">
    <div className={`h-16 flex items-center border-b border-slate-200 bg-white ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
      <Link to="/app/dashboard" className="block">
        {collapsed
          ? <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" fill="#2C6BFF" /></svg>
          : <Logo size="sm" />}
      </Link>
    </div>
    <SidebarNav collapsed={collapsed} canAdminNav={canAdminNav} />
    {/* v160.3.9.10a — Version footer, always visible. Tester was
        counting DOM matches for this string and finding zero. */}
    <div className={`mt-auto border-t border-slate-200 py-2 text-center text-[10px] font-mono text-slate-400 ${collapsed ? 'px-1' : 'px-3'}`}
         data-testid="app-version-footer" title={RUNNING_VERSION}>
      {collapsed ? RUNNING_VERSION.split('-').pop() : RUNNING_VERSION}
    </div>
  </aside>
);

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState(getUser());
  // Phase 3.16 — idle-watch + warning modal driver. Lives here (not in
  // TopBar) so the modal can be rendered as a sibling of <main> below.
  const [warnInfo, setWarnInfo] = useState(null);
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
      <SidebarShell collapsed={collapsed} canAdminNav={canAdminNav} />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200">
            <Logo size="sm" />
            <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="p-2"><X size={18} /></button>
          </div>
          <SidebarNav collapsed={false} onItemClick={() => setMobileOpen(false)} canAdminNav={canAdminNav} />
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
    </div>
    </PermissionsProvider>
  );
}
