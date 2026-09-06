// v58.13.132e_web_hotfix — Persistent version badge for every route.
//
// The existing `AppShell` renders a `data-testid="app-version-footer"`
// element inside the authed sidebar, so the version tag is only visible
// on `/app/*` routes when the sidebar is expanded on desktop. On the
// public landing (`/`), login/signup, PWA reset flows, print pages,
// scan-resolvers, and every mobile viewport where the sidebar collapses
// to a drawer, the tag was invisible.
//
// This component renders a small fixed-position pill in the bottom-right
// corner on every route. It reads the same `RUNNING_VERSION` constant as
// the sidebar footer, so the two never disagree. Hidden below the mobile
// tab bar breakpoint on small screens by shifting to bottom-left where
// nothing else lives.
import React from 'react';
import { RUNNING_VERSION } from '../lib/version';

export default function VersionBadge() {
  return (
    <div
      data-testid="app-version-badge"
      title={RUNNING_VERSION}
      className="fixed bottom-1 right-2 sm:right-3 z-[45] pointer-events-none select-none
                 text-[10px] leading-none font-mono text-slate-400/70 tracking-tight
                 bg-white/60 backdrop-blur-sm px-2 py-1 rounded-full border border-slate-200/60
                 shadow-sm print:hidden"
    >
      {RUNNING_VERSION}
    </div>
  );
}
