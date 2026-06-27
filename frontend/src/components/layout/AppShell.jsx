import React, { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Sparkles, FileText, ClipboardCheck, NotebookPen, TriangleAlert,
  Siren, ShieldCheck, Users2, Link2, FolderDown, Building2, Boxes, Plug, UserCog,
  Search, Bell, ChevronDown, ChevronLeft, Menu, X, LogOut, ChevronsLeft, ChevronsRight, Radio,
  Plus, FolderOpen,
} from 'lucide-react';
import Logo from '../brand/Logo';
import api from '../../lib/api';
import { fetchMe, getToken, getUser, initials, signOut, refreshToken } from '../../lib/auth';
import { useWorkspace } from '../../lib/workspace';
import { PermissionsProvider, useCan } from '../../lib/permissions';
import OutboxBell from './OutboxBell';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';
import { Avatar, AvatarFallback } from '../ui/avatar';

const NAV = [
  { section: 'Overview', items: [
    { to: '/app/dashboard', label: 'Intelligence Centre', icon: LayoutDashboard, testid: 'nav-dashboard', pastel: 'coral' },
    { to: '/app/ask', label: 'Ask Intelligence', icon: Sparkles, testid: 'nav-ask', pastel: 'lilac' },
  ]},
  { section: 'Capture', items: [
    { to: '/app/swms', label: 'AI SWMS', icon: FileText, testid: 'nav-swms', resource: 'swms', pastel: 'mint' },
    { to: '/app/pre-starts', label: 'Daily Pre-Starts', icon: ClipboardCheck, testid: 'nav-pre-starts', resource: 'pre_starts', pastel: 'sky' },
    { to: '/app/site-diary', label: 'Site Diary', icon: NotebookPen, testid: 'nav-site-diary', resource: 'site_diary', pastel: 'butter' },
    { to: '/app/hazards', label: 'Hazard Reports', icon: TriangleAlert, testid: 'nav-hazards', resource: 'hazards', pastel: 'peach' },
    { to: '/app/incidents', label: 'Incident Reports', icon: Siren, testid: 'nav-incidents', resource: 'incidents', pastel: 'blush' },
    { to: '/app/inspections', label: 'Inspection Reports', icon: ShieldCheck, testid: 'nav-inspections', resource: 'inspections', pastel: 'lavender' },
  ]},
  { section: 'Compliance', items: [
    { to: '/app/contractors', label: 'Contractor Register', icon: Users2, testid: 'nav-contractors', resource: 'contractors', pastel: 'sage' },
    { to: '/app/renewals', label: 'Renewal Links', icon: Link2, testid: 'nav-renewals', resource: 'renewals', pastel: 'sage' },
    { to: '/app/document-library', label: 'Document Library', icon: FolderOpen, testid: 'nav-document-library', pastel: 'lavender' },
    { to: '/app/audit-exports', label: 'Audit Exports', icon: FolderDown, testid: 'nav-audit-exports', resource: 'audit_exports', pastel: 'coral' },
    { to: '/app/vehicles', label: 'Vehicles', icon: Radio, testid: 'nav-vehicles', beta: true, resource: 'vehicles', pastel: 'sky' },
  ]},
  { section: 'Settings', items: [
    { to: '/app/settings/org', label: 'Organisation', icon: Building2, testid: 'nav-settings-org', pastel: 'slate' },
    { to: '/app/settings/workspaces', label: 'Workspaces', icon: Boxes, testid: 'nav-settings-workspaces', pastel: 'slate' },
    { to: '/app/settings/integrations', label: 'Integrations', icon: Plug, testid: 'nav-settings-integrations', resource: 'integrations', pastel: 'slate' },
    { to: '/app/settings/users', label: 'Users', icon: UserCog, testid: 'nav-settings-users', resource: 'users', pastel: 'slate' },
    { to: '/app/outbox', label: 'Email outbox', icon: Bell, testid: 'nav-outbox', beta: true, pastel: 'slate' },
  ]},
];

const SidebarNav = ({ collapsed, onItemClick }) => {
  const can = useCan();
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4" data-testid="sidebar-nav">
      {NAV.map((group) => {
        const visible = group.items.filter((it) => !it.resource || can(it.resource, 'open'));
        if (visible.length === 0) return null;
        return (
          <div key={group.section} className="mb-5">
            {!collapsed && <div className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{group.section}</div>}
            <ul className="space-y-0.5">
              {visible.map((it) => {
                const Icon = it.icon;
                const activeCls = `nav-active-${it.pastel || 'slate'}`;
                return (
                  <li key={it.to}>
                    <NavLink to={it.to} onClick={onItemClick} data-testid={it.testid}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          isActive ? `${activeCls} font-semibold` : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`} title={collapsed ? it.label : undefined}>
                      <Icon size={18} className="shrink-0" />
                      {!collapsed && <span className="truncate flex-1">{it.label}</span>}
                      {!collapsed && it.beta && <span className="text-[9px] uppercase tracking-wider font-semibold text-brand-violet bg-brand-violet-soft px-1.5 py-0.5 rounded">Beta</span>}
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
          <DropdownMenuItem onClick={handleSignOut} data-testid="menu-sign-out">
            <LogOut size={14} className="mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState(getUser());

  // refresh user from server on mount so role/name stays accurate, and slide
  // the JWT window via a silent /auth/refresh so long-idle sessions don't 401.
  useEffect(() => {
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
    </div>
    </PermissionsProvider>
  );
}
