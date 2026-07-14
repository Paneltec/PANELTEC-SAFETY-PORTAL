// v160.3.7q — Program-wide visual schematic (`/app/settings/schematic`).
//
// A bird's-eye view of every Paneltec Civil module, integration, and
// data-flow rendered with react-flow. Zones are pastel bands using the
// v7p semantic colour taxonomy; nodes are rounded cards with live count
// chips fetched from `/api/dashboard/module-stats`; edges are labelled
// Bezier connectors that tell the "hazard photo → auditor PDF" story.
//
// Interaction:
//   • Click a node   → navigate to its module
//   • Hover a node   → tooltip with a one-line description
//   • Right-click    → hide the node (persisted in localStorage)
//   • Zoom / pan     → react-flow built-ins
//   • Ctrl+P (print) → landscape flat layout, controls hidden
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import ReactFlow, {
  Background, Controls, MiniMap, Handle, Position,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

import api, { apiError } from '../../lib/api';
import { PageHeader } from '../../components/capture/Ui';
import { folderColor } from '../../lib/folderColors';
import {
  SCHEMATIC_ZONES, SCHEMATIC_NODES, SCHEMATIC_EDGES,
} from '../../lib/programSchematic';

const HIDDEN_KEY = 'paneltec_schematic_hidden_nodes';

// Turn one schematic-config node into a react-flow node with our custom
// data payload. Kept outside the component so it doesn't rebuild each
// render.
function toRfNode(n, stats, onHide) {
  return {
    id: n.id,
    type: 'moduleNode',
    position: { x: n.x, y: n.y },
    data: {
      label: n.label,
      hint: n.hint,
      route: n.route,
      zone: n.zone,
      stat: n.stat ? stats?.[n.stat] : null,
      onHide,
      w: n.w,
    },
    // Draggable off — this is a diagram, not a whiteboard. If a user
    // wants a custom layout, we'll ship persistence in a later job.
    draggable: false,
    selectable: true,
  };
}

// Custom node — rounded card with tinted border, icon (small round dot
// echoing the zone colour), label, live count chip, and a hover tooltip.
function ModuleNode({ data }) {
  const zoneColor = SCHEMATIC_ZONES.find((z) => z.key === data.zone)?.color || 'slate';
  const c = folderColor(zoneColor);
  return (
    <div
      title={data.hint}
      style={{ width: data.w || 200 }}
      onContextMenu={(e) => {
        e.preventDefault();
        data.onHide?.();
      }}
      className={`schematic-node group relative rounded-2xl border-2 bg-white shadow-md hover:shadow-lg transition-all cursor-pointer overflow-hidden`}
      data-testid={`schematic-node-${data.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div className={`px-3 py-2 flex items-center gap-2 ${c.bg}`}>
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${c.dot} shrink-0`} />
        <span className="text-[13px] font-semibold text-slate-800 truncate">{data.label}</span>
      </div>
      {data.stat != null && (
        <div className="px-3 py-1.5 flex items-center justify-between border-t border-slate-100 bg-white">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Live</span>
          <span
            className="text-[13px] font-bold tabular-nums text-slate-900"
            data-testid={`schematic-stat-${data.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          >
            {Number(data.stat).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

const NODE_TYPES = { moduleNode: ModuleNode };

// react-flow doesn't have a native "group / zone" node type, so zones
// are rendered as absolutely-positioned coloured rectangles behind the
// nodes using a separate SVG overlay layer. Kept outside the flow so
// they don't interfere with node dragging / selection.
function ZoneBands() {
  return (
    <>
      {SCHEMATIC_ZONES.map((z) => {
        const c = folderColor(z.color);
        return (
          <div
            key={z.key}
            className={`absolute rounded-3xl border border-slate-200 ${c.bg}`}
            style={{
              left: z.x, top: z.y, width: z.w, height: z.h,
              opacity: 0.35, pointerEvents: 'none',
              zIndex: 0,
            }}
          >
            <div className="absolute top-2 left-4 text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-600/80 pointer-events-none">
              {z.label}
            </div>
          </div>
        );
      })}
    </>
  );
}

export default function ProgramSchematicPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [hidden, setHidden] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); }
    catch { return new Set(); }
  });

  // Fetch live stats + refresh every 60 s.
  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get('/dashboard/module-stats');
      setStats(data.counts || {});
    } catch (e) {
      toast.error(apiError(e));
    }
  }, []);
  useEffect(() => {
    loadStats();
    const t = setInterval(loadStats, 60_000);
    return () => clearInterval(t);
  }, [loadStats]);

  const hideNode = useCallback((id) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      toast.success('Node hidden. Reset via the "Show all" button.');
      return next;
    });
  }, []);
  const resetHidden = () => {
    setHidden(new Set());
    localStorage.removeItem(HIDDEN_KEY);
  };

  const nodes = useMemo(
    () =>
      SCHEMATIC_NODES
        .filter((n) => !hidden.has(n.id))
        .map((n) => toRfNode(n, stats, () => hideNode(n.id))),
    [stats, hidden, hideNode],
  );
  const edges = useMemo(
    () =>
      SCHEMATIC_EDGES
        .filter((e) => !hidden.has(e.source) && !hidden.has(e.target))
        .map((e) => ({
          ...e,
          type: 'default',
          labelStyle: { fontSize: 10, fill: '#64748b', fontWeight: 500 },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
          labelBgPadding: [4, 2],
          style: { stroke: '#94a3b8', strokeWidth: 1.5, ...(e.style || {}) },
        })),
    [hidden],
  );

  const onNodeClick = (_evt, node) => {
    const cfg = SCHEMATIC_NODES.find((n) => n.id === node.id);
    if (cfg?.route) navigate(cfg.route);
  };

  return (
    <div className="max-w-[1400px] mx-auto pb-16" data-testid="program-schematic-page">
      <PageHeader
        crumb="Settings / Program Schematic"
        title="Program Schematic"
        subtitle="Bird's-eye view of every module, integration, and data-flow across Paneltec Civil. Click any node to jump into that module."
      />

      <div className="flex items-center gap-3 mb-3 text-xs">
        <div className="flex items-center gap-2 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          Live · refreshes every 60&nbsp;s
        </div>
        <div className="text-slate-400">·</div>
        <div className="text-slate-500">
          Right-click any node to hide it &nbsp;·&nbsp;{' '}
          {hidden.size > 0 && (
            <button
              onClick={resetHidden}
              className="text-blue-600 underline hover:no-underline"
              data-testid="schematic-reset-hidden"
            >
              Show all ({hidden.size} hidden)
            </button>
          )}
        </div>
        <div className="text-slate-400 ml-auto">
          Print (Ctrl+P) → landscape one-pager
        </div>
      </div>

      <div
        className="relative rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm schematic-canvas"
        style={{ height: 820 }}
      >
        <ZoneBands />
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            minZoom={0.4}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: 'default' }}
          >
            <Background gap={24} color="#e2e8f0" />
            <MiniMap
              pannable zoomable
              nodeStrokeWidth={2}
              className="schematic-minimap !bg-white/95 !border !border-slate-200 !rounded-xl !shadow"
              style={{ width: 160, height: 100 }}
            />
            <Controls className="schematic-controls" position="bottom-left" />
          </ReactFlow>
        </ReactFlowProvider>
      </div>

      {/* Print stylesheet — flatten to landscape, hide controls, keep the
          canvas at a fixed print height so react-flow's absolute-positioned
          nodes stay in place instead of collapsing to zero. */}
      <style>{`
        @media print {
          @page { size: A3 landscape; margin: 10mm; }
          body { background: #ffffff !important; }
          .schematic-canvas {
            height: 700px !important;
            page-break-inside: avoid;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .schematic-canvas .react-flow__renderer,
          .schematic-canvas .react-flow__viewport {
            transform: none !important;
          }
          .schematic-controls, .schematic-minimap,
          .react-flow__controls, .react-flow__minimap { display: none !important; }
        }
      `}</style>
    </div>
  );
}
