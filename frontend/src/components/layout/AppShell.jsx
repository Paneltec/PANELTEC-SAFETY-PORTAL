import React, { useEffect, useState } from 'react';
import { runSwVersionGuard } from '@/lib/swVersionGuard';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Search, Bell, ChevronDown, ChevronLeft, Menu, X, LogOut, ChevronsLeft, ChevronsRight, Plus,
  KeyRound as KeyRoundIcon, Zap,
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
  Settings24Regular, Settings24Filled,
  Trophy24Regular, Trophy24Filled,
  Mail24Regular, Mail24Filled,
} from '@fluentui/react-icons';
import Logo from '../brand/Logo';
import api from '../../lib/api';
import { fetchMe, getToken, getUser, initials, signOut, refreshToken } from '../../lib/auth';
import { useWorkspace } from '../../lib/workspace';
import { PermissionsProvider, useCan } from '../../lib/permissions';
import OutboxBell from './OutboxBell';
import useSessionTimeout from '../../hooks/useSessionTimeout';
import SessionWarningModal from '../SessionWarningModal';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { ChangePasswordModal } from '../auth/AuthBundle';

const NAV = [
  { section: 'Overview', items: [
    { to: '/app/dashboard', label: 'Intelligence Centre', icon: Board24Regular, iconActive: Board24Filled, testid: 'nav-dashboard', pastel: 'coral' },
    { to: '/app/ask', label: 'Ask Intelligence', icon: Sparkle24Regular, iconActive: Sparkle24Filled, testid: 'nav-ask', pastel: 'lilac' },
  ]},
  { section: 'Capture', items: [
    { to: '/app/swms', label: 'AI SWMS', icon: DocumentText24Regular, iconActive: DocumentText24Filled, testid: 'nav-swms', resource: 'swms', pastel: 'mint' },
    { to: '/app/pre-starts', label: 'Daily Pre-Starts', icon: ClipboardCheckmark24Regular, iconActive: ClipboardCheckmark24Filled, testid: 'nav-pre-starts', resource: 'pre_starts', pastel: 'sky' },
    { to: '/app/site-diary', label: 'Site Diary', icon: Notebook24Regular, iconActive: Notebook24Filled, testid: 'nav-site-diary', resource: 'site_diary', pastel: 'butter' },
    { to: '/app/hazards', label: 'Hazard Reports', icon: Warning24Regular, iconActive: Warning24Filled, testid: 'nav-hazards', resource: 'hazards', pastel: 'peach' },
    { to: '/app/incidents', label: 'Incident Reports', icon: Alert24Regular, iconActive: Alert24Filled, testid: 'nav-incidents', resource: 'incidents', pastel: 'blush' },
    { to: '/app/inspections', label: 'Inspection Reports', icon: ShieldCheckmark24Regular, iconActive: ShieldCheckmark24Filled, testid: 'nav-inspections', resource: 'inspections', pastel: 'lavender' },
    { to: '/app/forms', label: 'Forms', icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-forms', pastel: 'sky' },
  ]},
  { section: 'Compliance', items: [
    { to: '/app/suppliers', label: 'Suppliers', icon: People24Regular, iconActive: People24Filled, testid: 'nav-suppliers', pastel: 'sage' },
    { to: '/app/renewals', label: 'Renewal Links', icon: Link24Regular, iconActive: Link24Filled, testid: 'nav-renewals', resource: 'renewals', pastel: 'sage' },
    { to: '/app/document-library', label: 'Document Library', icon: FolderOpen24Regular, iconActive: FolderOpen24Filled, testid: 'nav-document-library', pastel: 'lavender' },
    { to: '/app/audit-exports', label: 'Audit Exports', icon: ArrowDownload24Regular, iconActive: ArrowDownload24Filled, testid: 'nav-audit-exports', resource: 'audit_exports', pastel: 'coral' },
    { to: '/app/vehicles', label: 'Plant & Vehicles', icon: VehicleTruck24Regular, iconActive: VehicleTruck24Filled, testid: 'nav-vehicles', resource: 'assets', pastel: 'sky' },
    { to: '/app/sites', label: 'Sites', icon: Location24Regular, iconActive: Location24Filled, testid: 'nav-sites', adminOnly: true, pastel: 'lavender' },
  ]},
  { section: 'Settings', items: [
    { to: '/app/settings/org', label: 'Organisation', icon: Building24Regular, iconActive: Building24Filled, testid: 'nav-settings-org', pastel: 'slate' },
    { to: '/app/settings/workspaces', label: 'Workspaces', icon: CubeMultiple24Regular, iconActive: CubeMultiple24Filled, testid: 'nav-settings-workspaces', pastel: 'slate' },
    { to: '/app/settings/users', label: 'Users & Permissions', icon: PeopleSettings24Regular, iconActive: PeopleSettings24Filled, testid: 'nav-settings-users', adminOnly: true, pastel: 'slate' },
    { to: '/app/settings/permission-presets', label: 'Permission presets', icon: Trophy24Regular, iconActive: Trophy24Filled, testid: 'nav-settings-permission-presets', adminOnly: true, pastel: 'slate' },
    { to: '/app/settings/workers', label: 'Workers', icon: PersonAvailable24Regular, iconActive: PersonAvailable24Filled, testid: 'nav-settings-workers', pastel: 'sky' },
    { to: '/app/settings/form-assignments', label: 'Form Assignments', icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-settings-form-assignments', adminOnly: true, pastel: 'sky' },
    { to: '/app/settings/swms-assignments', label: 'SWMS Assignments', icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-settings-swms-assignments', adminOnly: true, pastel: 'sky' },
    { to: '/app/settings/integrations', label: 'Integrations', icon: PlugConnected24Regular, iconActive: PlugConnected24Filled, testid: 'nav-settings-integrations', resource: 'integrations', pastel: 'slate' },
    { to: '/app/settings/system', label: 'System', icon: Settings24Regular, iconActive: Settings24Filled, testid: 'nav-settings-system', adminOnly: true, pastel: 'slate' },
    { to: '/app/settings/certifications', label: 'Certifications', icon: Trophy24Regular, iconActive: Trophy24Filled, testid: 'nav-settings-certifications', pastel: 'butter' },
    { to: '/app/outbox', label: 'Email outbox', icon: Mail24Regular, iconActive: Mail24Filled, testid: 'nav-outbox', pastel: 'slate' },
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

const SidebarNav = ({ collapsed, onItemClick }) => {
  const can = useCan();
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4" data-testid="sidebar-nav">
      {NAV.map((group) => {
        const visible = group.items.filter((it) => !it.resource || can(it.resource, 'open'));
        if (visible.length === 0) return null;
        const tint = SECTION_TINTS[group.section] || SECTION_TINTS.Settings;
        return (
          <div key={group.section} className="mb-5">
            {!collapsed && <div className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{group.section}</div>}
            <ul className="space-y-0.5">
              {visible.map((it) => {
                const IconFilled = it.iconActive || it.icon;
                return (
                  <li key={it.to}>
                    <NavLink to={it.to} onClick={onItemClick} data-testid={it.testid}
                      className={({ isActive }) =>
                        `group flex items-center gap-3 rounded-lg pr-2.5 py-2 text-sm transition-colors border-l-4 ${
                          isActive
                            ? 'border-orange-500 bg-orange-50 pl-1.5 text-slate-900 font-semibold'
                            : 'border-transparent pl-1.5 text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                        }`} title={collapsed ? it.label : undefined}>
                      {({ isActive }) => (
                        <>
                          <IconFilled
                            className={`shrink-0 transition-colors ${isActive ? 'text-orange-500' : `${tint.idle} ${tint.hover}`}`}
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
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" placeholder="Search records, contractors, SWMS…" data-testid="topbar-search"
          className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue" />
      </div>
      <div className="flex-1 md:hidden" />

      <button className="relative p-2 rounded-md hover:bg-slate-100 text-slate-500" data-testid="notifications-bell" aria-label="Notifications">
        <Bell size={18} />
        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-brand-red text-white text-[10px] font-semibold flex items-center justify-center">3</span>
      </button>
      <OutboxBell />

      {safeMode?.effective === 'on' && (
        <Link
          to="/app/settings/comms-safe-mode"
          title="Outbound email/SMS are being captured but not delivered. Click to view Settings."
          data-testid="comms-safe-mode-chip"
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-semibold uppercase tracking-wider hover:bg-amber-200 transition-colors">
          <Zap size={12} className="fill-amber-500 text-amber-600" />
          Comms Safe Mode
        </Link>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 ml-1" data-testid="user-menu-trigger">
            <Avatar className="h-8 w-8 bg-brand-blue text-white">
              <AvatarFallback className="bg-brand-blue text-white text-xs font-semibold">{initials(user)}</AvatarFallback>
            </Avatar>
            <ChevronDown size={14} className="text-slate-400 hidden sm:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="text-sm font-medium">{user?.name || 'Demo User'}</div>
            <div className="text-xs text-slate-500 font-normal">{user?.email}</div>
            <div className="text-[10px] mt-1 uppercase tracking-wider text-brand-blue font-semibold">{user?.role}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild data-testid="menu-profile">
            <Link to="/app/profile">My Profile</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setChangePwOpen(true)} data-testid="menu-change-password">
            <KeyRoundIcon size={14} className="mr-2" /> Change password…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSignOut} data-testid="menu-sign-out">
            <LogOut size={14} className="mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordModal open={changePwOpen} onClose={() => setChangePwOpen(false)} />
    </header>
  );
}

const SidebarShell = ({ collapsed }) => (
  <aside className={`hidden md:flex flex-col bg-white border-r border-slate-200 transition-[width] duration-200 ${collapsed ? 'w-[72px]' : 'w-64'}`} data-testid="sidebar-desktop">
    <div className={`h-16 flex items-center border-b border-slate-200 ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
      <Link to="/app/dashboard" className="block">
        {collapsed
          ? <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z" fill="#2C6BFF" /></svg>
          : <Logo size="sm" />}
      </Link>
    </div>
    <SidebarNav collapsed={collapsed} />
  </aside>
);

export default function AppShell() {
  const navigate = useNavigate();
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
      navigate('/login?reason=idle');
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

  if (!getToken()) return <Navigate to="/login" replace />;

  const permsValue = {
    effective: user?.effective_permissions || {},
    role: user?.role || null,
  };

  return (
    <PermissionsProvider value={permsValue}>
    <div className="min-h-screen flex bg-brand-bg" data-testid="app-shell">
      <SidebarShell collapsed={collapsed} />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200">
            <Logo size="sm" />
            <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="p-2"><X size={18} /></button>
          </div>
          <SidebarNav collapsed={false} onItemClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onToggleMobile={() => setMobileOpen(true)} onToggleCollapse={() => setCollapsed((c) => !c)} collapsed={collapsed} user={user} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8" data-testid="app-main"><Outlet /></main>
      </div>
      {warnInfo && (
        <SessionWarningModal
          secondsRemaining={warnInfo.secondsRemaining}
          onStay={() => { warnInfo.stay?.(); setWarnInfo(null); }}
          onLogout={async () => { setWarnInfo(null); await signOut(); navigate('/login?reason=idle'); }} />
      )}
    </div>
    </PermissionsProvider>
  );
}
