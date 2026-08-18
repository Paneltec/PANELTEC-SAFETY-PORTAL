// v160.3.9.56 — Program Schematic (RESPONSIVE CSS GRID).
//
// The old SVG topology (v47 → v55.4) has been retired after five
// failed attempts to keep curved arc-labels legible + icons non-
// overlapping at every viewport width. It is now a plain responsive
// grid of icon tiles, grouped by cluster with a normal H2 heading
// above each group. Boring but bulletproof:
//
//   • Each tile: rounded square (120×140), lucide icon centred on a
//     cluster-tinted disc, straight (not curved) label beneath.
//   • Grid: 4 columns at ≥1280px, 3 at ≥768px, 2 at ≥480px, 1 at
//     <480px. Achieved via CSS Grid `auto-fill / minmax(...)`.
//   • Groups are ordered Integrations → Overview → Capture →
//     Compliance → Register → Settings, mirroring the sidebar. Each
//     group header renders in WHITE against the dark background with
//     a cluster-coloured accent bar for identity.
//   • Settings still splits into ACCESS + DATA & AUTOMATION
//     sub-clusters — but as sub-headings under the Settings H2, not
//     as separate top-level groups.
//   • Click behaviour is identical to the old SVG version:
//     react-router navigate, toast fallback if the destination is
//     stub-only.
//
// Legacy SVG geometry (bezier spokes, hub, arc labels, sub-cluster
// chips) is archived in git history under commits tagged
// `paneltec-v160.3.9.55.4` and earlier — restorable if the CSS grid
// approach ever needs to be reverted. The topology registry in
// `/app/frontend/src/lib/programSchematic.js` is now geometry-free
// (x/y stripped) — only `cluster`, `sub`, `label`, `icon`, `route`
// remain, so downstream consumers (`test_program_schematic_routes_v47.py`)
// keep working.
//
// Contrast + overlap complaints from v51-v55.4 are solved by design:
// grid gaps prevent any tile-to-tile overlap, WHITE section headers
// on the dark background give 12:1+ contrast, and the label is a
// standard HTML `<div>` — no SVG-text arc clipping possible.
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

function ClusterGroup({ cluster, nodes, onNavigate }) {
  // Settings splits into two sub-clusters — render sub-headers
  // between them so the ACCESS / DATA & AUTOMATION mental model
  // survives.
  const subs = SCHEMATIC_SUB_CLUSTERS.filter((s) => s.parent === cluster.key);
  const hasSubs = subs.length > 0;
  return (
    <section
      className="mb-10"
      data-testid={`schematic-cluster-${cluster.key}`}
    >
      <div className="flex items-center gap-3 mb-4">
        <span
          className="inline-block w-1.5 h-8 rounded-sm"
          style={{ background: cluster.color }}
        />
        <h2
          className="text-slate-900 text-lg font-extrabold uppercase tracking-[0.18em]"
          style={{ letterSpacing: '0.18em' }}
          data-testid={`schematic-cluster-label-${cluster.key}`}
        >
          {cluster.label}
        </h2>
        <span
          className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{
            background: `${cluster.color}22`,
            color: cluster.color,
            border: `1px solid ${cluster.color}55`,
          }}
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
              className="mb-6"
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

        {/* Legend row — one pill per cluster, colour-coded. */}
        <div
          className="flex flex-wrap gap-2 mb-8"
          data-testid="schematic-legend"
        >
          {CLUSTER_ORDER.map((key) => {
            const c = clusterByKey[key];
            if (!c) return null;
            return (
              <div
                key={c.key}
                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  background: `${c.color}1A`,
                  color: c.color,
                  border: `1px solid ${c.color}55`,
                }}
                data-testid={`schematic-legend-${c.key}`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: c.color }}
                />
                {c.label}
              </div>
            );
          })}
        </div>

        {/* Canvas — one CSS-grid group per cluster. Wrapped in a
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
            return (
              <ClusterGroup
                key={cluster.key}
                cluster={cluster}
                nodes={clusterNodes}
                onNavigate={onNavigate}
              />
            );
          })}
        </div>

        <p className="text-xs text-slate-500 mt-8 mb-2">
          {SCHEMATIC_NODES.length} modules across {SCHEMATIC_CLUSTERS.length}{' '}
          clusters. Grid adapts 1→2→3→4 columns from mobile to desktop.
        </p>
      </div>
    </div>
  );
}
