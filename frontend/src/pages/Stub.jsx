import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Construction, ArrowRight } from 'lucide-react';

const TITLES = {
  '/app/swms': { title: 'AI SWMS Generator', phase: 'Phase 2', crumb: 'Capture / AI SWMS' },
  '/app/pre-starts': { title: 'Daily Pre-Starts', phase: 'Phase 2', crumb: 'Capture / Pre-Starts' },
  '/app/site-diary': { title: 'Site Diary', phase: 'Phase 2', crumb: 'Capture / Site Diary' },
  '/app/hazards': { title: 'Hazard Reports', phase: 'Phase 2', crumb: 'Capture / Hazards' },
  '/app/incidents': { title: 'Incident Reports', phase: 'Phase 2', crumb: 'Capture / Incidents' },
  '/app/inspections': { title: 'Inspection Reports', phase: 'Phase 2', crumb: 'Capture / Inspections' },
  '/app/contractors': { title: 'Contractor Register', phase: 'Phase 3', crumb: 'Compliance / Contractors' },
  '/app/renewals': { title: 'Renewal Links', phase: 'Phase 3', crumb: 'Compliance / Renewals' },
  '/app/audit-exports': { title: 'Audit Exports', phase: 'Phase 3', crumb: 'Compliance / Audit Exports' },
  '/app/ask': { title: 'Ask Intelligence', phase: 'Phase 2', crumb: 'Overview / Ask Intelligence' },
  '/app/settings/org': { title: 'Organisation', phase: 'Phase 3', crumb: 'Settings / Organisation' },
  '/app/settings/workspaces': { title: 'Workspaces', phase: 'Phase 3', crumb: 'Settings / Workspaces' },
  '/app/settings/users': { title: 'Users', phase: 'Phase 3', crumb: 'Settings / Users' },
};

export default function Stub() {
  const { pathname } = useLocation();
  const meta = TITLES[pathname] || { title: 'Coming soon', phase: 'Phase 2', crumb: pathname };

  return (
    <div className="max-w-4xl mx-auto" data-testid="stub-page">
      <nav className="text-xs text-slate-500 mb-3">{meta.crumb}</nav>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">{meta.title}</h1>
      <p className="mt-2 text-slate-600">This module is part of the roadmap and will land in {meta.phase}.</p>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 sm:p-10 shadow-card">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-blue-soft text-brand-blue flex items-center justify-center shrink-0">
            <Construction size={22} />
          </div>
          <div className="flex-1">
            <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-brand-blue">
              Coming in {meta.phase}
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-semibold mt-1">
              {meta.title} is on the build list.
            </h2>
            <p className="mt-2 text-slate-600 leading-relaxed">
              Phase 1 ships the platform shell — landing page, auth, app navigation, the Live Compliance Dashboard
              and the Integrations register. This screen will be wired up in the next phase once API contracts are
              confirmed.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                to="/app/dashboard"
                data-testid="stub-back-dashboard"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-ink text-white text-sm font-medium hover:bg-slate-800"
              >
                Back to dashboard <ArrowRight size={14} />
              </Link>
              <Link
                to="/app/settings/integrations"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50"
              >
                View integrations
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
