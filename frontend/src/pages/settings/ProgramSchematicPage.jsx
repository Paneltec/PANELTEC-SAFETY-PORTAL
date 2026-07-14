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
import { Layers } from 'lucide-react';
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
      image: n.image,
      stat: n.stat ? stats?.[n.stat] : null,
      onHide,
      w: n.w,
      h: n.h,
    },
    // Draggable off — this is a diagram, not a whiteboard. If a user
    // wants a custom layout, we'll ship persistence in a later job.
    draggable: false,
    selectable: true,
  };
}

// v160.3.7t — Frameless industrial-symbol node. The illustration IS the
// tile — no zone-tint frame, no black border, no white footer. Zone
// bands behind provide the pastel grouping; the icon+label reads as a
// small punchy iconographic control-panel component. Label sits below
// the icon in Paneltec-blue with a compact black "LIVE N" pill.
function ModuleNode({ data }) {
  const w = data.w || 128;
  const h = data.h || 128;
  const imgSrc = data.image
    ? `/img/schematic/nodes/${data.image}.png`
    : null;
  const slug = data.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div
      title={data.hint}
      style={{ width: w }}
      onContextMenu={(e) => {
        e.preventDefault();
        data.onHide?.();
      }}
      className="schematic-node group relative cursor-pointer flex flex-col items-center gap-1"
      data-testid={`schematic-node-${slug}`}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      {/* Frameless illustration */}
      <div className="flex items-center justify-center transition-transform group-hover:scale-105"
           style={{ width: w, height: h }}>
        {imgSrc ? (
          <img
            src={imgSrc}
            alt=""
            className="max-h-full max-w-full object-contain drop-shadow-md"
            loading="lazy"
            data-testid={`schematic-node-image-${slug}`}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-slate-400">
            <Layers size={40} strokeWidth={1.5} />
          </div>
        )}
      </div>

      {/* Label + live count — sits directly beneath the icon */}
      <div className="text-center leading-tight">
        <div className="text-[11px] font-bold text-[#2C6BFF] max-w-[140px] truncate">
          {data.label}
        </div>
        {data.stat != null && (
          <div className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-[1px] rounded bg-slate-900 text-white text-[9px] font-bold tabular-nums"
            data-testid={`schematic-stat-${slug}`}
          >
            <span className="text-slate-400 font-semibold uppercase tracking-wider text-[7px]">Live</span>
            {Number(data.stat).toLocaleString()}
          </div>
        )}
      </div>
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
          // v160.3.7s — Thick black orthogonal cables echo the hero-image
          // wiring aesthetic. Bezier smooth curves gave a soft-tech feel;
          // step-router gives the "industrial control board" vibe the
          // user asked for.
          type: 'smoothstep',
          pathOptions: { borderRadius: 12, offset: 12 },
          labelStyle: { fontSize: 10, fill: '#0f172a', fontWeight: 700 },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 1 },
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 4,
          style: {
            stroke: '#0f172a',
            strokeWidth: 2.5,
            ...(e.style || {}),
          },
        })),
    [hidden],
  );

  const onNodeClick = (evt, node) => {
    // v160.3.7t — Defensive click handler. `evt.stopPropagation()`
    // prevents bubbling to the react-flow pane. Route is validated
    // against the known list from `App.js` (starts with `/app/…`);
    // an unmapped path used to fall through to the catch-all
    // `<Navigate to="/" replace />` and bounce the admin to Cover
    // ("clicking a node restarts the app"). If the route is missing
    // we now toast politely instead of navigating into oblivion.
    evt?.stopPropagation?.();
    const cfg = SCHEMATIC_NODES.find((n) => n.id === node.id);
    if (!cfg?.route) {
      toast.info(`${cfg?.label || node.id} — no dedicated route yet.`);
      return;
    }
    navigate(cfg.route);
  };

  return (
    <div className="max-w-[1400px] mx-auto pb-16" data-testid="program-schematic-page">
      <PageHeader
        crumb="Settings / Program Schematic"
        title="Program Schematic"
        subtitle="The Paneltec Civil control panel — 27 modules, 6 zones, live data flow."
      />

      {/* v160.3.7r — Industrial control-panel hero illustration. Sits
          above the interactive react-flow diagram; clicking it smooth-
          scrolls to the interactive detail view below so users get both
          the wow-factor aesthetic overview AND the functional tool. */}
      <a
        href="#schematic-interactive"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('schematic-interactive')?.scrollIntoView({
            behavior: 'smooth', block: 'start',
          });
        }}
        className="block group mb-4 rounded-3xl overflow-hidden shadow-lg border border-slate-200 bg-white hover:shadow-xl transition-shadow schematic-hero"
        data-testid="schematic-hero-image"
        aria-label="Program schematic hero — scroll to interactive view"
      >
        <img
          src="/img/schematic/paneltec-control-panel-hero.png"
          alt="Paneltec Civil industrial control-panel schematic — central control station connected by cables to Capture, Intelligence, Integrations, Compliance, Fleet, People, and Backup & Data equipment."
          className="w-full block max-h-[500px] object-cover object-center"
          loading="eager"
        />
      </a>

      <div className="mb-4 flex justify-center">
        <a
          href="#schematic-interactive"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('schematic-interactive')?.scrollIntoView({
              behavior: 'smooth', block: 'start',
            });
          }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 text-white text-[11px] font-semibold uppercase tracking-[0.14em] hover:bg-slate-700 transition-colors schematic-hero-cta"
          data-testid="schematic-hero-cta"
        >
          ↓ Interactive view below
        </a>
      </div>

      <div id="schematic-interactive" className="scroll-mt-4">
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
        style={{ height: 1050 }}
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

      </div>
      {/* Print stylesheet — flatten to landscape, hide controls, keep the
          canvas at a fixed print height so react-flow's absolute-positioned
          nodes stay in place instead of collapsing to zero.
          v160.3.7r — Print output now includes the industrial hero image
          as page 1 (with a page-break) and the interactive diagram on
          page 2 (landscape). */}
      <style>{`
        @media print {
          @page { size: A3 landscape; margin: 10mm; }
          body { background: #ffffff !important; }
          .schematic-hero {
            box-shadow: none !important;
            border: 1px solid #e2e8f0 !important;
            page-break-after: always;
          }
          .schematic-hero img {
            max-height: none !important;
            width: 100% !important;
            height: auto !important;
          }
          .schematic-hero-cta { display: none !important; }
          .schematic-canvas {
            height: 1050px !important;
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
