// v160.3.9.47 — Program Schematic (SVG topology).
//
// Complete rewrite. The old ReactFlow implementation (v160.3.7q → v43)
// has been retired in favour of a static, SVG-heavy topology diagram
// modelled after a network / control-panel schematic:
//
//   • Dark navy canvas (#0B1220) with a radial purple bloom behind the
//     central hub.
//   • ONE central "Paneltec Civil" hub badge (blue → violet gradient).
//   • 6 clusters (Overview, Capture, Compliance, Register, Settings,
//     Integrations) arranged around the hub — each cluster's icons are
//     drawn in the cluster's locked accent colour.
//   • Settings is visually split into two sub-clusters (Access + Data
//     & Automation) but connected to the hub by a single violet
//     bezier.
//   • Bezier lines are drawn once per cluster (hub-centre → cluster
//     anchor). Icons never carry inter-cluster edges — this keeps the
//     read simple: "everything flows through the hub".
//   • Fully static: no zoom, no pan, no drag. The diagram is a
//     "poster" you click on.
//
// Icons: `lucide-react` only, tinted per cluster via inline colour.
// Route validation is enforced statically by
// `backend/tests/test_program_schematic_routes_v47.py` (every route
// declared in `programSchematic.js` must exist as a `<Route path>`
// under `/app/*` in `App.js`).
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as LucideIcons from 'lucide-react';

import { PageHeader } from '../../components/capture/Ui';
import {
  CANVAS_W,
  CANVAS_H,
  SCHEMATIC_HUB,
  SCHEMATIC_CLUSTERS,
  SCHEMATIC_SUB_CLUSTERS,
  SCHEMATIC_NODES,
} from '../../lib/programSchematic';

const TILE = 128;           // icon-tile diameter (v47.1: was 88)
const ICON_SIZE = 56;       // lucide-react size prop (v47.1: was 34)
const NODE_LABEL_FONT = 16; // (v47.1: was 11)
const CLUSTER_LABEL_FONT = 20; // (v47.1: was 12)
const HUB_TITLE_FONT = 30;  // (v47.1: was 22)
const HUB_SUB_FONT = 15;    // (v47.1: was 11)

// Bezier control-point helper. Draws a smooth "S"-ish curve from the
// hub centre to each cluster anchor by pushing the control points 45%
// of the way along the straight line, then rotating outward around
// the midpoint. This gives every spoke a subtle organic swoop
// regardless of angle from the hub.
function bezierPath(from, to) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Perpendicular offset — magnitude scales with line length so short
  // spokes still curve visibly but long spokes don't loop.
  const len = Math.hypot(dx, dy);
  const off = Math.min(120, Math.max(40, len * 0.18));
  const nx = -dy / len;
  const ny = dx / len;
  const c1x = mx + nx * off * 0.35;
  const c1y = my + ny * off * 0.35;
  return `M ${from.x} ${from.y} Q ${c1x} ${c1y}, ${to.x} ${to.y}`;
}

function ClusterLegendPill({ cluster }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
      style={{
        background: `${cluster.color}1A`,
        color: cluster.color,
        border: `1px solid ${cluster.color}55`,
      }}
      data-testid={`schematic-legend-${cluster.key}`}
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: cluster.color }}
      />
      {cluster.label}
    </div>
  );
}

// Node tile — SVG group so it lives inside the same viewBox coordinate
// system as the bezier lines. Icon rendered via lucide-react inside a
// `<foreignObject>` so we still get the crisp lucide stroke set.
function SchematicNode({ node, cluster, onClick }) {
  const Icon = LucideIcons[node.icon] || LucideIcons.Layers;
  const slug = node.id;
  const half = TILE / 2;
  return (
    <g
      className="schematic-node cursor-pointer"
      onClick={onClick}
      data-testid={`schematic-node-${slug}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {/* Halo ring — subtle glow of the cluster colour */}
      <circle
        cx={node.x}
        cy={node.y}
        r={half - 2}
        fill={`${cluster.color}22`}
        stroke={`${cluster.color}88`}
        strokeWidth={1.5}
        className="transition-all duration-200 group-hover:stroke-2"
      />
      {/* Inner glass tile */}
      <circle
        cx={node.x}
        cy={node.y}
        r={half - 12}
        fill="#0F172A"
        stroke={cluster.color}
        strokeWidth={1}
      />
      <foreignObject
        x={node.x - ICON_SIZE / 2}
        y={node.y - ICON_SIZE / 2 - 4}
        width={ICON_SIZE}
        height={ICON_SIZE}
        style={{ pointerEvents: 'none' }}
      >
        <div style={{ color: cluster.color, width: ICON_SIZE, height: ICON_SIZE }}>
          <Icon size={ICON_SIZE} strokeWidth={1.8} />
        </div>
      </foreignObject>
      <text
        x={node.x}
        y={node.y + half + 22}
        textAnchor="middle"
        style={{
          fill: '#E2E8F0',
          fontSize: NODE_LABEL_FONT,
          fontWeight: 600,
          fontFamily: 'Inter, system-ui, sans-serif',
          pointerEvents: 'none',
        }}
      >
        {node.label}
      </text>
    </g>
  );
}

export default function ProgramSchematicPage() {
  const navigate = useNavigate();

  const clusterByKey = React.useMemo(
    () => Object.fromEntries(SCHEMATIC_CLUSTERS.map((c) => [c.key, c])),
    [],
  );

  const handleNodeClick = React.useCallback(
    (node) => {
      if (!node.route) {
        toast.info(`${node.label} — no route yet.`);
        return;
      }
      navigate(node.route);
    },
    [navigate],
  );

  const hubCentre = {
    x: SCHEMATIC_HUB.x + SCHEMATIC_HUB.w / 2,
    y: SCHEMATIC_HUB.y + SCHEMATIC_HUB.h / 2,
  };

  return (
    <div className="max-w-[1600px] mx-auto pb-16" data-testid="program-schematic-page">
      <PageHeader
        crumb="Settings / Program Schematic"
        title="Program Schematic"
        subtitle="Every module in Paneltec Civil, connected to one control panel."
      />

      {/* Legend row — always shown, gives users the colour → cluster map. */}
      <div className="flex flex-wrap gap-2 mb-4" data-testid="schematic-legend">
        {SCHEMATIC_CLUSTERS.map((c) => (
          <ClusterLegendPill key={c.key} cluster={c} />
        ))}
      </div>

      <div
        className="relative rounded-2xl overflow-hidden shadow-lg schematic-canvas overflow-x-auto md:overflow-x-visible"
        style={{ border: '1px solid #1E293B' }}
        data-testid="schematic-canvas"
      >
        <svg
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="min-w-[1100px] md:min-w-0"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          <defs>
            {/* v47.1 — Vertical linear gradient replaces the v47 radial
                bloom. Top: deep indigo #1E1B4B, bottom: dark navy #0B1220. */}
            <linearGradient id="canvas-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#1E1B4B" />
              <stop offset="55%"  stopColor="#12173A" />
              <stop offset="100%" stopColor="#0B1220" />
            </linearGradient>
            {/* Hub bloom — a soft radial halo hugging the badge only,
                so the badge still reads as the visual anchor. */}
            <radialGradient id="hub-halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%"  stopColor="#7C3AED" stopOpacity="0.55" />
              <stop offset="55%" stopColor="#7C3AED" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#0B1220" stopOpacity="0" />
            </radialGradient>
            {/* Hub badge gradient — blue to violet. */}
            <linearGradient id="hub-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"  stopColor="#2C6BFF" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>
            {/* Faint grid pattern — a touch darker than v47 to keep
                icon contrast crisp against the indigo top of the
                gradient. */}
            <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#1E293B" strokeWidth="0.6" opacity="0.45" />
            </pattern>
          </defs>

          {/* Backdrop: vertical gradient, then grid pattern, then hub halo. */}
          <rect width={CANVAS_W} height={CANVAS_H} fill="url(#canvas-bg)" />
          <rect width={CANVAS_W} height={CANVAS_H} fill="url(#grid)" />
          <circle cx={hubCentre.x} cy={hubCentre.y} r={320} fill="url(#hub-halo)" />

          {/* Bezier spokes — hub centre → each cluster anchor. */}
          <g data-testid="schematic-spokes">
            {SCHEMATIC_CLUSTERS.map((c) => (
              <g key={c.key}>
                <path
                  d={bezierPath(hubCentre, c.anchor)}
                  stroke={c.color}
                  strokeWidth={2.8}
                  fill="none"
                  strokeLinecap="round"
                  opacity={0.78}
                  data-testid={`schematic-spoke-${c.key}`}
                />
                {/* Terminal dot at the cluster anchor. */}
                <circle
                  cx={c.anchor.x}
                  cy={c.anchor.y}
                  r={8}
                  fill={c.color}
                  opacity={0.95}
                />
              </g>
            ))}
          </g>

          {/* Sub-cluster (Settings only) — thin violet dashed connector +
              cluster labels. */}
          {SCHEMATIC_SUB_CLUSTERS.length > 0 && (
            <g data-testid="schematic-sub-clusters">
              {SCHEMATIC_SUB_CLUSTERS.map((sc, i) => {
                const parent = clusterByKey[sc.parent];
                const next = SCHEMATIC_SUB_CLUSTERS[i + 1];
                return (
                  <g key={sc.key}>
                    <text
                      x={sc.x}
                      y={sc.y}
                      style={{
                        fill: parent.color,
                        fontSize: 15,
                        fontWeight: 700,
                        letterSpacing: 2,
                        fontFamily: 'Inter, system-ui, sans-serif',
                        textTransform: 'uppercase',
                      }}
                    >
                      {sc.label}
                    </text>
                    {next && next.parent === sc.parent && (
                      <line
                        x1={sc.x + 8}
                        y1={sc.y + 10}
                        x2={next.x + 8}
                        y2={next.y - 18}
                        stroke={parent.color}
                        strokeWidth={1.2}
                        strokeDasharray="4 4"
                        opacity={0.55}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Cluster label chips — floating outside each cluster's icon
              group (positions declared per-cluster in `labelPos`). */}
          <g data-testid="schematic-cluster-labels">
            {SCHEMATIC_CLUSTERS.map((c) => (
              <g key={c.key}>
                <rect
                  x={c.labelPos.x - 95}
                  y={c.labelPos.y - 20}
                  width={190}
                  height={36}
                  rx={18}
                  fill={c.color}
                  opacity={0.15}
                  stroke={c.color}
                  strokeOpacity={0.55}
                  strokeWidth={1.2}
                />
                <text
                  x={c.labelPos.x}
                  y={c.labelPos.y + 6}
                  textAnchor="middle"
                  style={{
                    fill: c.color,
                    fontSize: CLUSTER_LABEL_FONT,
                    fontWeight: 800,
                    letterSpacing: 3,
                    fontFamily: 'Inter, system-ui, sans-serif',
                    textTransform: 'uppercase',
                  }}
                >
                  {c.label}
                </text>
              </g>
            ))}
          </g>

          {/* Nodes. */}
          <g data-testid="schematic-nodes">
            {SCHEMATIC_NODES.map((n) => (
              <SchematicNode
                key={n.id}
                node={n}
                cluster={clusterByKey[n.cluster]}
                onClick={() => handleNodeClick(n)}
              />
            ))}
          </g>

          {/* Central hub badge — drawn LAST so it sits above the spokes. */}
          <g data-testid="schematic-hub">
            <rect
              x={SCHEMATIC_HUB.x}
              y={SCHEMATIC_HUB.y}
              width={SCHEMATIC_HUB.w}
              height={SCHEMATIC_HUB.h}
              rx={18}
              fill="url(#hub-fill)"
              stroke="#FFFFFF33"
              strokeWidth={1.5}
            />
            <text
              x={SCHEMATIC_HUB.x + SCHEMATIC_HUB.w / 2}
              y={SCHEMATIC_HUB.y + SCHEMATIC_HUB.h / 2 - 4}
              textAnchor="middle"
              style={{
                fill: '#FFFFFF',
                fontSize: HUB_TITLE_FONT,
                fontWeight: 800,
                letterSpacing: 0.5,
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            >
              {SCHEMATIC_HUB.label}
            </text>
            <text
              x={SCHEMATIC_HUB.x + SCHEMATIC_HUB.w / 2}
              y={SCHEMATIC_HUB.y + SCHEMATIC_HUB.h / 2 + 30}
              textAnchor="middle"
              style={{
                fill: '#FFFFFFCC',
                fontSize: HUB_SUB_FONT,
                fontWeight: 600,
                letterSpacing: 4,
                fontFamily: 'Inter, system-ui, sans-serif',
                textTransform: 'uppercase',
              }}
            >
              {SCHEMATIC_HUB.sub}
            </text>
          </g>
        </svg>

        {/* Hover state for nodes — scale-up on hover, without breaking the
            transform origin (SVG groups don't accept CSS transform-origin
            reliably, so we use `transform-box: fill-box`). */}
        <style>{`
          .schematic-node { transition: transform 200ms ease; transform-box: fill-box; transform-origin: center; }
          .schematic-node:hover { transform: scale(1.06); }
          .schematic-node:focus { outline: none; }
          @media print {
            @page { size: A3 landscape; margin: 8mm; }
            .schematic-canvas { break-inside: avoid; border: 0 !important; box-shadow: none !important; }
          }
        `}</style>
      </div>

      <p className="mt-3 text-xs text-slate-500 md:hidden" data-testid="schematic-hint-mobile">
        Scroll horizontally to explore &rarr; &nbsp;·&nbsp; Tap any node to open its module.
      </p>
      <p className="mt-3 text-xs text-slate-500 hidden md:block" data-testid="schematic-hint">
        Click any node to open its module. Print (Ctrl + P) for a landscape one-pager.
      </p>
    </div>
  );
}
