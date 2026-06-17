import React, { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Sparkles, FileText, ClipboardCheck, NotebookPen, TriangleAlert,
  Siren, ShieldCheck, Users2, Link2, FolderDown, Building2, Boxes, Plug, UserCog,
  Search, Bell, ChevronDown, Menu, X, LogOut, ChevronsLeft, ChevronsRight, Radio,
} from 'lucide-react';
import Logo from '../brand/Logo';
import { fetchMe, getToken, getUser, initials, signOut } from '../../lib/auth';
import { useWorkspace } from '../../lib/workspace';
import { PermissionsProvider, useCan } from '../../lib/permissions';
import OutboxBell from './OutboxBell';
import { WORKSPACES as MOCK_WS } from '../../mocks/dashboard';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';
import { Avatar, AvatarFallback } from '../ui/avatar';

const NAV = [
  { section: 'Overview', items: [
    { to: '/app/dashboard', label: 'Intelligence Centre', icon: LayoutDashboard, testid: 'nav-dashboard' },
    { to: '/app/ask', label: 'Ask Intelligence', icon: Sparkles, testid: 'nav-ask' },
  ]},
  { section: 'Capture', items: [
    { to: '/app/swms', label: 'AI SWMS', icon: FileText, testid: 'nav-swms', resource: 'swms' },
    { to: '/app/pre-starts', label: 'Daily Pre-Starts', icon: ClipboardCheck, testid: 'nav-pre-starts', resource: 'pre_starts' },
    { to: '/app/site-diary', label: 'Site Diary', icon: NotebookPen, testid: 'nav-site-diary', resource: 'site_diary' },
    { to: '/app/hazards', label: 'Hazard Reports', icon: TriangleAlert, testid: 'nav-hazards', resource: 'hazards' },
    { to: '/app/incidents', label: 'Incident Reports', icon: Siren, testid: 'nav-incidents', resource: 'incidents' },
    { to: '/app/inspections', label: 'Inspection Reports', icon: ShieldCheck, testid: 'nav-inspections', resource: 'inspections' },
  ]},
  { section: 'Compliance', items: [
    { to: '/app/contractors', label: 'Contractor Register', icon: Users2, testid: 'nav-contractors', resource: 'contractors' },
    { to: '/app/renewals', label: 'Renewal Links', icon: Link2, testid: 'nav-renewals', resource: 'renewals' },
    { to: '/app/audit-exports', label: 'Audit Exports', icon: FolderDown, testid: 'nav-audit-exports', resource: 'audit_exports' },
    { to: '/app/vehicles', label: 'Vehicles', icon: Radio, testid: 'nav-vehicles', beta: true, resource: 'vehicles' },
  ]},
  { section: 'Settings', items: [
    { to: '/app/settings/org', label: 'Organisation', icon: Building2, testid: 'nav-settings-org' },
    { to: '/app/settings/workspaces', label: 'Workspaces', icon: Boxes, testid: 'nav-settings-workspaces' },
    { to: '/app/settings/integrations', label: 'Integrations', icon: Plug, testid: 'nav-settings-integrations', resource: 'integrations' },
    { to: '/app/settings/users', label: 'Users', icon: UserCog, testid: 'nav-settings-users', resource: 'users' },
    { to: '/app/outbox', label: 'Email outbox', icon: Bell, testid: 'nav-outbox', beta: true },
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
                return (
                  <li key={it.to}>
                    <NavLink to={it.to} onClick={onItemClick} data-testid={it.testid}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          isActive ? 'bg-brand-blue-soft text-brand-blue font-medium' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
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
  const { workspaceId, setWorkspaceId } = useWorkspace();
  const options = [{ id: '*', name: 'All workspaces' }, ...MOCK_WS];
  const active = options.find((o) => o.id === workspaceId) || options[0];

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center gap-3 px-4 lg:px-6 sticky top-0 z-30">
      <button className="md:hidden p-2 rounded-md hover:bg-slate-100" onClick={onToggleMobile} data-testid="mobile-menu-button" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <button className="hidden md:inline-flex p-2 rounded-md hover:bg-slate-100 text-slate-500" onClick={onToggleCollapse} data-testid="sidebar-collapse-button" aria-label="Collapse sidebar">
        {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm" data-testid="workspace-switcher">
            <span className="w-2 h-2 rounded-full bg-brand-blue" />
            <span className="font-medium">{active.name}</span>
            <ChevronDown size={14} className="text-slate-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {options.map((w) => (
            <DropdownMenuItem key={w.id} onClick={() => setWorkspaceId(w.id)} data-testid={`workspace-option-${w.id}`}>{w.name}</DropdownMenuItem>
          ))}
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
          <DropdownMenuItem data-testid="menu-profile">Profile</DropdownMenuItem>
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

  // refresh user from server on mount so role/name stays accurate
  useEffect(() => {
    if (getToken()) {
      fetchMe().then(setUser).catch(() => { /* 401 interceptor redirects */ });
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
