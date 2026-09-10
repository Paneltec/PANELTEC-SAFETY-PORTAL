// v58.13.132bj — Program Schematic visual redesign (cluster cards).
//
// Landed on top of the v56 responsive-grid layout. Purely visual —
// no navigation / route / registry changes.
//
// What changed vs. `.132bi` (see `/app/memory/v58_13_132bj_program_schematic_redesign_shipped_finish_deferred.md`):
//   1. Each cluster now renders inside a `rounded-2xl shadow-md`
//      white card with a `border-l-4` accent stripe in the cluster's
//      Tailwind hue.
//   2. Card hover-lifts (`hover:-translate-y-1 hover:shadow-lg`)
//      guarded by `@media (hover: hover)` so touch devices don't
//      trigger the animation.
//   3. Cluster header gains a `w-10 h-10 rounded-full` badge with the
//      cluster's soft accent-100 background + accent-600 icon.
//   4. "N modules" pill switched from inline-hex tinting to Tailwind
//      `bg-<accent>-100 text-<accent>-700 px-2.5 py-0.5 rounded-full
//      text-xs font-medium`.
//   5. Palette rotation locked per Stephen's `.132bj` brief:
//        integrations → sky
//        overview     → indigo
//        capture      → emerald
//        compliance   → amber
//        register     → rose
//        settings     → violet
//      (The brief listed 6 palette entries; the DB has 6 real
//       clusters — 1-to-1 mapping in display order. "Analysis" and
//       "Admin" from Stephen's grid don't exist as codebase
//       clusters; "Compliance"→amber and "Register"→rose take their
//       slots at positions 4 and 5.)
//   6. Body text stays neutral `text-slate-800` — the accent hue only
//      appears in the border stripe, the icon badge, and the count
//      pill. IconTile bodies are unchanged (`.132bi` visual is
//      preserved so downstream tests keep passing).
//
// Individual `IconTile` markup, click handlers, `SCHEMATIC_NODES`
// registry, and every `data-testid` value are UNCHANGED. Downstream
// `test_program_schematic_routes_v47.py` continues to pass.

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as LucideIcons from 'lucide-react';

import { PageHeader } from '../../components/capture/Ui';
import {
  SCHEMATIC_CLUSTERS,
  SCHEMATIC_SUB_CLUSTERS,
  SCHEMATIC_NODES,
} from '../../lib/programSchematic';

const CLUSTER_ORDER = [
  'integrations',
  'overview',
  'capture',
  'compliance',
  'register',
  'settings',
];

// v58.13.132dd — Mobile App section. 10 sub-clusters rebuilt from
// the read-only audit of `mobile/app/**/*.tsx` after `.132cz` replaced
// the 26-screen legacy UI with the new 8-screen mockup + 7-tab bar.
const MOBILE_SUB_CLUSTER_ORDER = [
  'mobile_auth',
  'mobile_tabs',
  'mobile_home',
  'mobile_job',
  'mobile_prestart',
  'mobile_records',
  'mobile_profile',
  'mobile_askai',
  'mobile_stub',
  'mobile_visitor',
];

// v58.13.132bj — Cluster → Tailwind accent hue (locked per Stephen's
// palette). Class names are written out in full so the JIT scanner
// picks them up (dynamic template strings would be stripped in
// production).
const CLUSTER_ACCENT = {
  integrations: 'sky',
  overview:     'indigo',
  capture:      'emerald',
  compliance:   'amber',
  register:     'rose',
  settings:     'violet',
  // v58.13.132dd — mobile sub-cluster accents (10 clusters).
  mobile_auth:     'teal',
  mobile_tabs:     'teal600',
  mobile_home:     'cyan',
  mobile_job:      'cyan600',
  mobile_prestart: 'indigo',
  mobile_records:  'sky600',
  mobile_profile:  'cyan600',
  mobile_askai:    'violet',
  mobile_stub:     'slate',
  mobile_visitor:  'indigo400',
};

const ACCENT_STYLES = {
  sky: {
    borderLeft: 'border-l-sky-500',
    iconBg:     'bg-sky-100',
    iconText:   'text-sky-600',
    pillBg:     'bg-sky-100',
    pillText:   'text-sky-700',
    legendBg:   'bg-sky-100',
    legendText: 'text-sky-700',
    legendDot:  'bg-sky-500',
  },
  indigo: {
    borderLeft: 'border-l-indigo-500',
    iconBg:     'bg-indigo-100',
    iconText:   'text-indigo-600',
    pillBg:     'bg-indigo-100',
    pillText:   'text-indigo-700',
    legendBg:   'bg-indigo-100',
    legendText: 'text-indigo-700',
    legendDot:  'bg-indigo-500',
  },
  emerald: {
    borderLeft: 'border-l-emerald-500',
    iconBg:     'bg-emerald-100',
    iconText:   'text-emerald-600',
    pillBg:     'bg-emerald-100',
    pillText:   'text-emerald-700',
    legendBg:   'bg-emerald-100',
    legendText: 'text-emerald-700',
    legendDot:  'bg-emerald-500',
  },
  amber: {
    borderLeft: 'border-l-amber-500',
    iconBg:     'bg-amber-100',
    iconText:   'text-amber-600',
    pillBg:     'bg-amber-100',
    pillText:   'text-amber-700',
    legendBg:   'bg-amber-100',
    legendText: 'text-amber-700',
    legendDot:  'bg-amber-500',
  },
  rose: {
    borderLeft: 'border-l-rose-500',
    iconBg:     'bg-rose-100',
    iconText:   'text-rose-600',
    pillBg:     'bg-rose-100',
    pillText:   'text-rose-700',
    legendBg:   'bg-rose-100',
    legendText: 'text-rose-700',
    legendDot:  'bg-rose-500',
  },
  violet: {
    borderLeft: 'border-l-violet-500',
    iconBg:     'bg-violet-100',
    iconText:   'text-violet-600',
    pillBg:     'bg-violet-100',
    pillText:   'text-violet-700',
    legendBg:   'bg-violet-100',
    legendText: 'text-violet-700',
    legendDot:  'bg-violet-500',
  },
  // v58.13.132cx — mobile sub-cluster accent variants.
  teal:      { borderLeft: 'border-l-teal-500',   iconBg: 'bg-teal-100',   iconText: 'text-teal-600',   pillBg: 'bg-teal-100',   pillText: 'text-teal-700',   legendBg: 'bg-teal-100',   legendText: 'text-teal-700',   legendDot: 'bg-teal-500' },
  teal600:   { borderLeft: 'border-l-teal-600',   iconBg: 'bg-teal-100',   iconText: 'text-teal-700',   pillBg: 'bg-teal-100',   pillText: 'text-teal-800',   legendBg: 'bg-teal-100',   legendText: 'text-teal-800',   legendDot: 'bg-teal-600' },
  cyan:      { borderLeft: 'border-l-cyan-500',   iconBg: 'bg-cyan-100',   iconText: 'text-cyan-600',   pillBg: 'bg-cyan-100',   pillText: 'text-cyan-700',   legendBg: 'bg-cyan-100',   legendText: 'text-cyan-700',   legendDot: 'bg-cyan-500' },
  cyan600:   { borderLeft: 'border-l-cyan-600',   iconBg: 'bg-cyan-100',   iconText: 'text-cyan-700',   pillBg: 'bg-cyan-100',   pillText: 'text-cyan-800',   legendBg: 'bg-cyan-100',   legendText: 'text-cyan-800',   legendDot: 'bg-cyan-600' },
  sky600:    { borderLeft: 'border-l-sky-600',    iconBg: 'bg-sky-100',    iconText: 'text-sky-700',    pillBg: 'bg-sky-100',    pillText: 'text-sky-800',    legendBg: 'bg-sky-100',    legendText: 'text-sky-800',    legendDot: 'bg-sky-600' },
  slate:     { borderLeft: 'border-l-slate-500',  iconBg: 'bg-slate-100',  iconText: 'text-slate-600',  pillBg: 'bg-slate-100',  pillText: 'text-slate-700',  legendBg: 'bg-slate-100',  legendText: 'text-slate-700',  legendDot: 'bg-slate-500' },
  indigo400: { borderLeft: 'border-l-indigo-400', iconBg: 'bg-indigo-100', iconText: 'text-indigo-500', pillBg: 'bg-indigo-100', pillText: 'text-indigo-600', legendBg: 'bg-indigo-100', legendText: 'text-indigo-600', legendDot: 'bg-indigo-400' },
};

// v58.13.132bj — Per-cluster lucide icon for the header badge.
// Chosen for semantic fit against the cluster's role.
const CLUSTER_ICON = {
  integrations: 'Plug',
  overview:     'LayoutDashboard',
  capture:      'ClipboardPlus',
  compliance:   'ShieldCheck',
  register:     'Boxes',
  settings:     'Settings',
  // v58.13.132dd — mobile sub-cluster icons (10 clusters).
  mobile_auth:     'LogIn',
  mobile_tabs:     'Menu',
  mobile_home:     'Home',
  mobile_job:      'ClipboardList',
  mobile_prestart: 'CheckSquare',
  mobile_records:  'FolderOpen',
  mobile_profile:  'UserCircle',
  mobile_askai:    'Sparkles',
  mobile_stub:     'CloudOff',
  mobile_visitor:  'UserPlus',
};

function IconTile({ node, cluster, onClick }) {
  const Icon = LucideIcons[node.icon] || LucideIcons.Circle;
  return (
    <button
      type="button"
      onClick={onClick}
      // v58.5 — Lightened. Off-white surface with soft slate border,
      // subtle hover lift; text stays high-contrast slate-900. Icons
      // shrunk ~35%. Target tile ~100 px tall (was ~140).
      className="group flex flex-col items-center justify-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 hover:bg-white hover:border-slate-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300 transition"
      data-testid={`schematic-node-${node.id}`}
      style={{ minHeight: 100 }}
    >
      <div
        // Icon container also shrinks (w/h 10 vs old 14) — keeps the
        // coloured chip readable without dominating the tile.
        className="w-9 h-9 rounded-full flex items-center justify-center ring-1 group-hover:scale-105 transition-transform"
        style={{
          background: `${cluster.color}18`,
          borderColor: `${cluster.color}66`,
          boxShadow: `0 0 0 1px ${cluster.color}33`,
        }}
      >
        <Icon size={18} style={{ color: cluster.color }} strokeWidth={2.25} />
      </div>
      <div className="text-center text-[12px] font-semibold text-slate-800 leading-tight px-0.5">
        {node.label}
      </div>
    </button>
  );
}

function ClusterCard({ cluster, accent, nodes, onNavigate }) {
  const styles = ACCENT_STYLES[accent] || ACCENT_STYLES.sky;
  const HeaderIcon = LucideIcons[CLUSTER_ICON[cluster.key]] || LucideIcons.Box;

  // Settings splits into two sub-clusters — render sub-headers
  // between them so the ACCESS / DATA & AUTOMATION mental model
  // survives.
  const subs = SCHEMATIC_SUB_CLUSTERS.filter((s) => s.parent === cluster.key);
  const hasSubs = subs.length > 0;

  // v58.13.132bj — Card shell:
  //   · rounded-2xl / shadow-md base
  //   · white bg, soft slate ring, coloured left stripe
  //   · hover-lift + hover-shadow *only on hover-capable pointers*
  //     via Tailwind arbitrary variant `[@media(hover:hover)]:...`
  //     (touch devices skip the transform)
  //   · transition-all 200 ms so hover states feel like a single
  //     coordinated lift
  const cardCls = [
    'rounded-2xl bg-white shadow-md',
    'border border-slate-200',
    'border-l-4', styles.borderLeft,
    'p-5 md:p-6 mb-6',
    'transition-all duration-200',
    '[@media(hover:hover)]:hover:-translate-y-1',
    '[@media(hover:hover)]:hover:shadow-lg',
  ].join(' ');

  return (
    <section
      className={cardCls}
      data-testid={`schematic-cluster-${cluster.key}`}
      data-accent={accent}
    >
      {/* Header row: icon badge · title · count pill */}
      <div className="flex items-center gap-3 mb-5">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center ${styles.iconBg}`}
          data-testid={`schematic-cluster-icon-${cluster.key}`}
        >
          <HeaderIcon size={20} className={styles.iconText} strokeWidth={2.25} />
        </div>
        <h2
          className="text-slate-900 text-lg font-extrabold uppercase tracking-[0.18em]"
          data-testid={`schematic-cluster-label-${cluster.key}`}
        >
          {cluster.label}
        </h2>
        <span
          className={`${styles.pillBg} ${styles.pillText} px-2.5 py-0.5 rounded-full text-xs font-medium`}
          data-testid={`schematic-cluster-count-${cluster.key}`}
        >
          {nodes.length} {nodes.length === 1 ? 'module' : 'modules'}
        </span>
      </div>

      {!hasSubs ? (
        <div
          className="schematic-tile-grid grid gap-3"
          data-testid={`schematic-cluster-grid-${cluster.key}`}
        >
          {nodes.map((n) => (
            <IconTile
              key={n.id}
              node={n}
              cluster={cluster}
              onClick={() => onNavigate(n)}
            />
          ))}
        </div>
      ) : (
        subs.map((sub) => {
          const subNodes = nodes.filter((n) => n.sub === sub.key);
          if (!subNodes.length) return null;
          return (
            <div
              key={sub.key}
              className="mb-6 last:mb-0"
              data-testid={`schematic-sub-cluster-${sub.key}`}
            >
              <h3
                className="text-[12px] font-bold uppercase tracking-[0.22em] text-slate-500 mb-3"
                data-testid={`schematic-sub-cluster-label-${sub.key}`}
              >
                {sub.label}
              </h3>
              <div className="schematic-tile-grid grid gap-3">
                {subNodes.map((n) => (
                  <IconTile
                    key={n.id}
                    node={n}
                    cluster={cluster}
                    onClick={() => onNavigate(n)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

export default function ProgramSchematicPage() {
  const navigate = useNavigate();
  const clusterByKey = React.useMemo(
    () => Object.fromEntries(SCHEMATIC_CLUSTERS.map((c) => [c.key, c])),
    [],
  );

  const onNavigate = (node) => {
    if (!node.route) {
      toast('This module is a stub — Phase 2 will fill it in.');
      return;
    }
    navigate(node.route);
  };

  return (
    <div
      className="min-h-full"
      data-testid="program-schematic-page"
      style={{
        // v58.5 — Lightened: soft slate gradient replaces the deep-navy
        // radial. Preserves a bit of depth without going dark.
        background:
          'radial-gradient(circle at 30% 15%, #F8FAFC 0%, #EEF2F7 55%, #E2E8F0 100%)',
      }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <PageHeader
          title="Program Schematic"
          subtitle="Every Paneltec Civil module at a glance, grouped by cluster. Click a tile to open its page."
          testId="program-schematic-header"
          textClassName="text-slate-900"
        />

        {/* v58.13.132bj — Legend row now uses the same Tailwind
            palette as the cards. Preserved so at-a-glance colour ↔
            cluster identity is still one glance away. */}
        <div
          className="flex flex-wrap gap-2 mb-8"
          data-testid="schematic-legend"
        >
          {CLUSTER_ORDER.map((key) => {
            const c = clusterByKey[key];
            if (!c) return null;
            const styles = ACCENT_STYLES[CLUSTER_ACCENT[key]] || ACCENT_STYLES.sky;
            return (
              <div
                key={c.key}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${styles.legendBg} ${styles.legendText}`}
                data-testid={`schematic-legend-${c.key}`}
              >
                <span className={`inline-block w-2 h-2 rounded-full ${styles.legendDot}`} />
                {c.label}
              </div>
            );
          })}
        </div>

        {/* Canvas — one cluster CARD per cluster. Wrapped in a
            single container so the whole schematic remains a single
            data-testid target for downstream tests. */}
        <div data-testid="schematic-canvas">
          {CLUSTER_ORDER.map((key) => {
            const cluster = clusterByKey[key];
            if (!cluster) return null;
            const clusterNodes = SCHEMATIC_NODES.filter(
              (n) => n.cluster === key,
            );
            if (!clusterNodes.length) return null;
            const accent = CLUSTER_ACCENT[key] || 'sky';
            return (
              <ClusterCard
                key={cluster.key}
                cluster={cluster}
                accent={accent}
                nodes={clusterNodes}
                onNavigate={onNavigate}
              />
            );
          })}

          {/* v58.13.132cx — Mobile App section header + 20 mobile
              sub-cluster cards. Rendered as a group under a bold
              divider so the mobile band reads as its own subsystem
              rather than an extension of the top-level clusters. */}
          <div
            className="mt-10 mb-4 flex items-center gap-3"
            data-testid="schematic-mobile-section"
          >
            {(() => {
              const Smart = LucideIcons.Smartphone || LucideIcons.Circle;
              return (
                <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center ring-1 ring-teal-200">
                  <Smart size={20} className="text-teal-700" strokeWidth={2.25} />
                </div>
              );
            })()}
            <div>
              <h2
                className="text-xl font-bold text-slate-900"
                data-testid="schematic-mobile-section-title"
              >
                Mobile App
              </h2>
              <p
                className="text-xs text-slate-500 mt-0.5"
                data-testid="schematic-mobile-section-subtitle"
              >
                {MOBILE_SUB_CLUSTER_ORDER.length} sub-clusters · every
                mobile screen grouped by navigation tab.
              </p>
            </div>
          </div>

          {MOBILE_SUB_CLUSTER_ORDER.map((subKey) => {
            const cluster = clusterByKey[subKey];
            if (!cluster) return null;
            const clusterNodes = SCHEMATIC_NODES.filter(
              (n) => n.cluster === subKey,
            );
            if (!clusterNodes.length) return null;
            const accent = CLUSTER_ACCENT[subKey] || 'teal';
            return (
              <ClusterCard
                key={cluster.key}
                cluster={cluster}
                accent={accent}
                nodes={clusterNodes}
                onNavigate={onNavigate}
              />
            );
          })}
        </div>

        <p className="text-xs text-slate-500 mt-8 mb-2">
          {SCHEMATIC_NODES.length} modules across {CLUSTER_ORDER.length}{' '}
          top-level clusters + {MOBILE_SUB_CLUSTER_ORDER.length} Mobile
          sub-clusters. Grid adapts 1→2→3→4 columns from mobile to desktop.
        </p>
      </div>
    </div>
  );
}
