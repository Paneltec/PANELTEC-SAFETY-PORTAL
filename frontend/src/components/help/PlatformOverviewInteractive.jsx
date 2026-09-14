// v58.13.132ge — Interactive Platform Overview.
//
// Replaces the static `paneltec_architecture.png` on the Live
// Compliance Dashboard with a real, clickable grid of tiles.
// Each tile navigates to the app route for the module (routes
// sourced from `App.js` at ship time — see the ship memo table).
// Tiles with no natural destination render as disabled with a
// tooltip that explains why.

import React from 'react';
import { Link } from 'react-router-dom';
import {
  UserCog, Users, User, UserCheck,
  FileText, TriangleAlert, Siren, ClipboardCheck, ClipboardList,
  MapPin, ShieldCheck, Truck, Award, Archive, Sparkles,
  FileType, BarChart3, Smartphone,
} from 'lucide-react';

/**
 * @typedef {{
 *   key: string, label: string, to?: string,
 *   disabledReason?: string, icon: any,
 * }} Tile
 */

/** @type {Tile[]} */
const PERSONAS = [
  { key: 'admin',       label: 'Admin',       to: '/app/settings/org',      icon: UserCog },
  { key: 'supervisor',  label: 'Supervisor',  to: '/app/settings/org',      icon: Users },
  { key: 'worker',      label: 'Worker',      to: '/app/settings/workers',  icon: User },
  { key: 'visitor',     label: 'Visitor',     to: '/app/sites',             icon: UserCheck },
];

/** @type {Tile[]} */
const MODULES = [
  { key: 'swms',        label: 'SWMS',                     to: '/app/swms',                    icon: FileText },
  { key: 'hazards',     label: 'Hazards → Risk assess.',   to: '/app/risk-assessments',        icon: TriangleAlert },
  { key: 'incidents',   label: 'Incidents',                to: '/app/incidents',               icon: Siren },
  { key: 'inspections', label: 'Inspections',              to: '/app/inspections',             icon: ClipboardCheck },
  { key: 'prestarts',   label: 'Pre-starts',               to: '/app/pre-starts',              icon: ClipboardList },
  { key: 'sites',       label: 'Sites & QR sign-on',       to: '/app/sites',                   icon: MapPin },
  { key: 'workers',     label: 'Workers & Permissions',    to: '/app/settings/workers',        icon: ShieldCheck },
  { key: 'fleet',       label: 'Plant & Vehicles',         to: '/app/fleet',                   icon: Truck },
  { key: 'certs',       label: 'Certifications',           to: '/app/settings/certifications', icon: Award },
  { key: 'audit',       label: 'Audit Exports',            to: '/app/audit-exports',           icon: Archive },
  // v58.13.132gf — Ask Intelligence disabled per Stephen's brief.
  // Feature is mocked at the backend end and hasn't shipped an
  // ask-actual-questions UX yet — the tile now reads as read-only
  // "Coming soon" like Mobile App / MongoDB.
  { key: 'ask',         label: 'Ask Intelligence',
    disabledReason: 'Coming soon — Ask Intelligence is on the roadmap.', icon: Sparkles },
];

/** @type {Tile[]} */
const OUTPUTS = [
  { key: 'pdf',    label: 'PDF Reports',    to: '/app/document-library', icon: FileType },
  // v58.13.132gf — Live Dashboard tile is now a no-op with the
  // "You're here" tooltip — clicking used to reload the same route
  // which felt broken. Disabled pattern matches Mobile App / Mongo.
  { key: 'live',   label: 'Live Dashboard',
    disabledReason: "You're here.", icon: BarChart3 },
  { key: 'mobile', label: 'Mobile App',     disabledReason: 'Mobile app is a separate install — contact admin.', icon: Smartphone },
];

/** @type {Tile[]} */
const INTEGRATIONS = [
  { key: 'simpro',    label: 'Simpro',        to: '/app/settings/integrations/simpro' },
  { key: 'navixy',    label: 'Navixy',        to: '/app/settings/integrations/navixy' },
  { key: 'ms365',     label: 'Microsoft 365', to: '/app/settings/integrations/microsoft365' },
  { key: 'textmagic', label: 'TextMagic',     to: '/app/settings/integrations/textmagic' },
  { key: 'mongo',     label: 'MongoDB',       disabledReason: 'Managed platform service — no in-app config surface.' },
];


function TileButton({ tile, tone, testIdRoot }) {
  const Icon = tile.icon;
  const testid = `${testIdRoot}-${tile.key}`;
  const disabled = !tile.to;
  const commonClass = (
    'group relative flex items-center gap-2 px-3 py-2 rounded-xl '
    + 'border text-left text-[13px] font-semibold transition-all '
    + 'shadow-sm min-h-[48px] w-full '
    + (disabled
      ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed '
      : `${tone} hover:-translate-y-0.5 hover:shadow-md cursor-pointer`)
  );
  const iconEl = Icon ? (
    <span className="shrink-0 opacity-80">
      <Icon size={16} />
    </span>
  ) : null;

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        data-testid={testid}
        title={tile.disabledReason}
        className={commonClass}
      >
        {iconEl}
        <span className="truncate">{tile.label}</span>
        <span
          data-testid={`${testid}-disabled-marker`}
          className="ml-auto text-[9px] uppercase tracking-widest text-slate-400">
          info
        </span>
      </button>
    );
  }
  return (
    <Link
      to={tile.to}
      data-testid={testid}
      title={tile.hint || `Open ${tile.label}`}
      className={commonClass}
    >
      {iconEl}
      <span className="truncate">{tile.label}</span>
      <span
        aria-hidden
        className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] tracking-widest text-slate-400">
        →
      </span>
    </Link>
  );
}


function Tier({ tiles, tone, testIdRoot, title, cols }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-500 mb-2">
        {title}
      </div>
      <div
        className={`grid gap-2 ${cols}`}
        data-testid={`${testIdRoot}-grid`}
      >
        {tiles.map((t) => (
          <TileButton
            key={t.key}
            tile={t}
            tone={tone}
            testIdRoot={testIdRoot}
          />
        ))}
      </div>
    </div>
  );
}


export default function PlatformOverviewInteractive() {
  return (
    <section
      data-testid="platform-overview-interactive"
      className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm p-5 sm:p-6">
      <header className="mb-4 flex items-start gap-2">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-brand-blue">
            Platform overview
          </div>
          <div className="mt-0.5 text-sm text-slate-600">
            Every tile navigates to that module. Grouped by persona,
            capture module, output, and integration.
          </div>
        </div>
      </header>

      <div className="space-y-5">
        <Tier
          title="Personas"
          tiles={PERSONAS}
          tone="bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-400"
          testIdRoot="platform-overview-persona"
          cols="grid-cols-2 sm:grid-cols-4"
        />
        <Tier
          title="Capture modules"
          tiles={MODULES}
          tone="bg-blue-50 border-blue-200 text-blue-900 hover:border-blue-400"
          testIdRoot="platform-overview-module"
          cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Tier
            title="Outputs"
            tiles={OUTPUTS}
            tone="bg-emerald-50 border-emerald-200 text-emerald-900 hover:border-emerald-400"
            testIdRoot="platform-overview-output"
            cols="grid-cols-1 sm:grid-cols-3"
          />
          <Tier
            title="Integrations"
            tiles={INTEGRATIONS}
            tone="bg-amber-50 border-amber-200 text-amber-900 hover:border-amber-400"
            testIdRoot="platform-overview-integration"
            cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          />
        </div>
      </div>
    </section>
  );
}
