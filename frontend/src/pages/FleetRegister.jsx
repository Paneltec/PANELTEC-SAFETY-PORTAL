/**
 * v58.13.120f — Fleet & Service Register (Phase 3 frontend), REMOUNTED.
 *
 * Restored regressed features per the .120f audit
 * (`/app/memory/v58_13_120f_regression_audit.md`):
 *   · The bespoke 6-section inline drawer has been removed and
 *     replaced with a mount of the legacy `<AssetDrawer />` (7 tabs:
 *     Details / Pairing / Schedules / Service log / Maintenance
 *     history / Photo / Notes). Row-click fetches the full asset via
 *     `GET /api/assets/{id}` and passes it as the `asset` prop.
 *   · `<FleetLiveDashboards />` (Navixy Fleet Live Status / Trips /
 *     Technical) now mounts above the register table whenever the
 *     current page has at least one asset with `navixy_device_id`.
 *   · Row-header chips restored: "Live · Navixy" (green pulse) for
 *     rows with `navixy_device_id`, "NFC" (violet) for rows with
 *     `nfc_uid`, "backfilled" (violet) for rows sourced from the
 *     .120a maintenance backfill.
 *   · `?tab=<tab>` deep-link honoured on drawer open — e.g.
 *     `/app/fleet?open=<id>&tab=maintenance_history` opens the drawer
 *     on the Maintenance history tab.
 *   · Photo tab (see AssetDrawer.jsx::PhotoTab) renders both the
 *     legacy `photo_file_id` and the new `.120a` GridFS `photos[]`
 *     grid with drag-drop + delete-on-hover.
 *
 * Retained from .120c/d/e:
 *   · Feature-flag probe on `/fleet/categories` (404 → Coming soon).
 *   · Left filter tree · center register table · top search bar.
 *   · Bulk Print Labels toolbar action.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Truck, Search as SearchIcon, Printer, Loader2, Wifi, Radio, Plus, Trash2, Info, MapPin, Archive,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { Can, useCan } from '../lib/permissions';
import useDeepLinkOpen from '../lib/useDeepLinkOpen';
import AssetDrawer from '../components/AssetDrawer';
import AssetMapModal from '../components/AssetMapModal';
import FleetLiveDashboards from '../components/FleetLiveDashboards';

const KIND_STYLES = {
  vehicle:   { bg: 'bg-sky-100',    text: 'text-sky-800',    border: 'border-sky-200'   },
  plant:     { bg: 'bg-amber-100',  text: 'text-amber-800',  border: 'border-amber-200' },
  trailer:   { bg: 'bg-violet-100', text: 'text-violet-800', border: 'border-violet-200'},
  tool:      { bg: 'bg-emerald-100',text: 'text-emerald-800',border: 'border-emerald-200'},
  container: { bg: 'bg-slate-100',  text: 'text-slate-700',  border: 'border-slate-200' },
};

// v58.13.120g — Client-side display normaliser for the FilterTree.
// Mirrors the canonical map used by the backend .120g migration
// script so old rows in the database still display consistently
// pre-commit. Applied to LABELS only — the underlying value passed
// to the backend filter query is unchanged (so the tree filters
// pre-commit-shape rows correctly).
const _SUBTYPE_CANONICAL_DISPLAY = {
  'vacuum_truck':  'Vacuum Truck',
  'Vac Truck':     'Vacuum Truck',
  'VACUUM TRUCK':  'Vacuum Truck',
  'vac truck':     'Vacuum Truck',
  'Vacuum truck':  'Vacuum Truck',
  'excavator':     'Excavator',
  'trailer':       'Trailer',
  'ute':           'Ute',
  'tipper':        'Tipper',
  'service_truck': 'Service Truck',
  'crane_truck':   'Crane Truck',
  'compactor':     'Compactor',
  'vehicle':       'Vehicle',
  // v58.13.125 — display rename per user directive. Underlying value
  // stays "other"/"Other" until a proper re-classification ship.
  'other':         'Uncategorised',
  'Other':         'Uncategorised',
};
function displaySubtype(raw) {
  if (!raw) return '(unset)';
  return _SUBTYPE_CANONICAL_DISPLAY[raw] || raw;
}

function KindPill({ kind }) {
  const s = KIND_STYLES[kind] || KIND_STYLES.container;
  return (
    <span data-testid={`fleet-kind-pill-${kind}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border ${s.bg} ${s.text} ${s.border}`}>
      {kind}
    </span>
  );
}

// v58.13.120f — Row-header chips restored from the pre-.120 surface.
function RowChips({ row }) {
  const chips = [];
  if (row.navixy_device_id) {
    chips.push(
      <span key="navixy"
        data-testid={`fleet-row-chip-navixy-${row.id}`}
        title="Live Navixy tracker attached"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Live · Navixy
      </span>,
    );
  }
  if (row.nfc_uid) {
    chips.push(
      <span key="nfc"
        data-testid={`fleet-row-chip-nfc-${row.id}`}
        title={`NFC UID: ${row.nfc_uid}`}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 text-violet-800 border border-violet-200">
        <Radio size={9} /> NFC
      </span>,
    );
  }
  if (row.source && row.source.startsWith('maintenance_backfill')) {
    chips.push(
      <span key="backfill"
        data-testid={`fleet-row-chip-backfill-${row.id}`}
        title="Backfilled from plant_maintenance import (.120a)"
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-800 border border-violet-200">
        backfilled
      </span>,
    );
  }
  if (chips.length === 0) return null;
  return <span className="inline-flex items-center gap-1 flex-wrap">{chips}</span>;
}


// ─────────────────────────── Status pill ─────────────────────────
// v58.13.122 — Coloured pill per asset in the register table.
// GREEN: healthy · AMBER: due soon · RED: overdue (pulsing dot) ·
// GREY: no counter data.
const _STATUS_STYLES = {
  green:  { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500',   label: 'On schedule' },
  amber:  { bg: 'bg-amber-100',   text: 'text-amber-900',   dot: 'bg-amber-500',     label: 'Due soon' },
  red:    { bg: 'bg-rose-100',    text: 'text-rose-800',    dot: 'bg-rose-500',      label: 'Overdue',   pulse: true },
  grey:   { bg: 'bg-slate-100',   text: 'text-slate-600',   dot: 'bg-slate-400',     label: 'No data' },
};
function ServiceStatusPill({ block, assetId }) {
  const s = _STATUS_STYLES[block?.status] || _STATUS_STYLES.grey;
  return (
    <span
      title={block?.hint || 'Schedule not computed'}
      data-testid={`fleet-service-status-${assetId}`}
      data-status={block?.status || 'grey'}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${s.pulse ? 'animate-pulse' : ''}`} />
      {s.label}
    </span>
  );
}


// ─────────────────────────── Filter tree ────────────────────────────
// v58.13.125 — Data source is now a top-level orthogonal dimension
// (Option B from the .125 audit). Radio semantics: exactly one of
// All / Navixy / Manual. Clicking a specific KIND auto-resets the
// data-source to "all" (per user's stated interaction: "if i go the
// KIND list and choose another tab it should turn off the navixy
// ones"). Clicking "All kinds" preserves whatever source was set.
function FilterTree({ data, filter, setFilter, loading, onAddAsset, serviceDueCount, sourceCounts, retiredData }) {
  const canCreate = useCan()('assets', 'edit');
  if (loading) return <div className="text-xs text-slate-400 p-4">Loading tree…</div>;
  if (!data) return <div className="text-xs text-slate-400 p-4">No categories yet.</div>;
  const src = filter.data_source || 'all';
  const setSrc = (s) => setFilter({ ...filter, data_source: s });
  const chooseKind = (kind) => {
    // v58.13.128 — Clicking any KIND clears the Retired/Sold view.
    if (kind === null) {
      setFilter({ ...filter, kind: null, sub_type: null, retired_only: false });
    } else {
      setFilter({ ...filter, kind, sub_type: null, data_source: 'all', retired_only: false });
    }
  };
  const chooseRetired = () => {
    // Retired/Sold is a synthetic KIND — flips the retired_only flag,
    // clears the specific kind filter so all retired assets show mixed.
    setFilter({ ...filter, retired_only: true, kind: null, sub_type: null });
  };
  const resetAll = () => setFilter({
    kind: null, sub_type: null, navixy_only: false,
    service_due: false, data_source: 'all', retired_only: false,
  });
  return (
    <div className="space-y-1" data-testid="fleet-filter-tree">
      {/* v58.13.125 — DATA SOURCE dimension. Radio (mutually
          exclusive within the dimension), AND-combined with KIND. */}
      <div className="rounded-xl bg-gradient-to-r from-violet-100/60 via-indigo-100/40 to-blue-100/20 border border-violet-200/50 shadow-sm p-2 mb-2"
           data-testid="fleet-filter-toolbar-strip">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 px-1 pb-1">Data source</div>
        {[
          { key: 'all',    label: 'All sources',   count: sourceCounts?.total  ?? data.total, dot: 'bg-slate-400' },
          { key: 'navixy', label: 'Navixy-tracked', count: sourceCounts?.navixy ?? 0,          dot: 'bg-emerald-500 animate-pulse' },
          { key: 'manual', label: 'Added Manually',        count: sourceCounts?.manual ?? 0,          dot: 'bg-slate-500' },
        ].map((opt) => (
          <label key={opt.key}
                 className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold cursor-pointer transition-colors ${
                   src === opt.key ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-white/60'
                 }`}
                 data-testid={`fleet-filter-source-${opt.key}-label`}>
            <input type="radio" name="fleet-data-source" value={opt.key}
                   checked={src === opt.key}
                   onChange={() => setSrc(opt.key)}
                   data-testid={`fleet-filter-source-${opt.key}`}
                   className="w-3.5 h-3.5 accent-violet-600" />
            <span className={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />
            <span className="flex-1">{opt.label}</span>
            <span className={`tabular-nums text-xs ${src === opt.key ? 'text-white/80' : 'text-slate-500'}`}>
              {opt.count}
            </span>
          </label>
        ))}
        {/* Service-due chip stays inside the toolbar band. */}
        <label className="flex items-center gap-2 px-3 py-1.5 mt-1 rounded-md text-sm font-semibold text-slate-700 hover:bg-white/60 cursor-pointer border-t border-violet-200/50 pt-2"
               data-testid="fleet-filter-service-due-label">
          <input type="checkbox" checked={!!filter.service_due}
                 onChange={(e) => setFilter({ ...filter, service_due: e.target.checked })}
                 data-testid="fleet-filter-service-due"
                 className="w-3.5 h-3.5 rounded accent-rose-600" />
          <span className="inline-flex items-center gap-1 flex-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Service due
          </span>
          <span className="tabular-nums text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800"
                data-testid="fleet-filter-service-due-count">
            {serviceDueCount ?? 0}
          </span>
        </label>
      </div>

      <div className="text-xs font-bold uppercase tracking-wider text-slate-500 px-2 pt-2 flex items-center justify-between">
        <span>Kind</span>
        <button type="button" onClick={resetAll}
                data-testid="fleet-filter-reset"
                className="text-[10px] font-semibold text-violet-700 hover:text-violet-900 hover:underline normal-case tracking-normal">
          Reset filters
        </button>
      </div>
      <button
        type="button"
        onClick={() => chooseKind(null)}
        data-testid="fleet-filter-kind-all"
        className={`w-full text-left px-3 py-1.5 rounded-md text-sm font-medium flex items-center justify-between ${
          !filter.kind ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
        }`}
      >
        <span>All kinds</span>
        <span className="tabular-nums text-xs opacity-80">{data.total}</span>
      </button>
      {data.kinds.map((k) => (
        <div key={k.kind}>
          <div className="w-full flex items-center gap-1">
            <button
              type="button"
              onClick={() => chooseKind(k.kind)}
              data-testid={`fleet-filter-kind-${k.kind}`}
              className={`flex-1 text-left px-3 py-1.5 rounded-md text-sm font-medium flex items-center justify-between ${
                filter.kind === k.kind ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="capitalize">{k.kind}</span>
              <span className="tabular-nums text-xs opacity-80">{k.total}</span>
            </button>
            {canCreate && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAddAsset?.(k.kind); }}
                data-testid={`fleet-filter-add-${k.kind}`}
                title={`Add a new ${k.kind}`}
                className="p-1 rounded hover:bg-emerald-50 text-emerald-700 hover:text-emerald-800"
              >
                <Plus size={12} />
              </button>
            )}
          </div>
          {filter.kind === k.kind && (
            <div className="ml-3 mt-1 space-y-0.5 border-l border-slate-200 pl-2">
              {Object.entries(k.sub_types).sort((a, b) => b[1] - a[1]).map(([st, n]) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setFilter({ ...filter, sub_type: filter.sub_type === st ? null : st })}
                  data-testid={`fleet-filter-subtype-${st.toLowerCase().replace(/\s+/g,'-')}`}
                  className={`w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between ${
                    filter.sub_type === st ? 'bg-blue-100 text-blue-800 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>{displaySubtype(st)}</span>
                  <span className="tabular-nums text-[10px] opacity-60">{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {/* v58.13.128 — Retired / Sold synthetic KIND row. Segregates
          retired assets from the active list. Clicking flips
          retired_only=true; expanded view shows sub-counts by
          original kind so admins can see what was retired where. */}
      <div className="mt-2 pt-2 border-t border-slate-200">
        <button
          type="button"
          onClick={chooseRetired}
          data-testid="fleet-filter-kind-retired"
          className={`w-full text-left px-3 py-1.5 rounded-md text-sm font-medium flex items-center justify-between ${
            filter.retired_only ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <Archive size={13} className={filter.retired_only ? 'text-white' : 'text-slate-400'} />
            Retired / Sold
          </span>
          <span className="tabular-nums text-xs opacity-80">{retiredData?.total ?? 0}</span>
        </button>
        {filter.retired_only && retiredData && (retiredData.total ?? 0) > 0 && (
          <div className="ml-3 mt-1 space-y-0.5 border-l border-slate-200 pl-2"
               data-testid="fleet-filter-retired-breakdown">
            {Object.entries(retiredData.by_kind || {})
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <div key={k}
                     className="w-full px-2 py-1 rounded text-xs flex items-center justify-between text-slate-600">
                  <span className="capitalize">{k}</span>
                  <span className="tabular-nums text-[10px] opacity-60">{n}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────── Search bar ────────────────────────────
function SearchBar({ onOpenAsset }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!q || q.trim().length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api.get(`/fleet/search`, { params: { q } });
        setResults(r.data);
      } catch (e) {
        toast.error(apiError(e) || 'Search failed');
        setResults(null);
      } finally { setBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const grouped = useMemo(() => {
    if (!results) return null;
    const groups = {};
    for (const h of results.hits) {
      (groups[h.type] = groups[h.type] || []).push(h);
    }
    return groups;
  }, [results]);

  return (
    <div className="relative" data-testid="fleet-search-container">
      <div className="relative">
        <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          data-testid="fleet-search-input"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search across assets, service records, inspections, hazards, incidents, pre-starts. Press ⌘K to focus."
          className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 bg-white"
        />
        {busy && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>
      {open && q.trim().length >= 2 && (
        <div className="absolute z-40 left-0 right-0 top-full mt-1 max-h-[420px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
             data-testid="fleet-search-results">
          {!results && <div className="p-3 text-xs text-slate-500">Searching…</div>}
          {results && results.hits.length === 0 && (
            <div className="p-4 text-sm text-slate-500">No matches for "{q}".</div>
          )}
          {grouped && Object.entries(grouped).map(([type, hits]) => (
            <div key={type} className="border-b last:border-b-0 border-slate-100">
              <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {type} ({hits.length})
              </div>
              {hits.map((h) => (
                <a
                  key={`${h.type}-${h.id}`}
                  href={h.deep_link}
                  data-testid={`fleet-search-hit-${h.type}-${h.id}`}
                  onClick={(e) => {
                    if (h.type === 'asset') {
                      e.preventDefault();
                      onOpenAsset?.(h.id);
                      setOpen(false);
                    }
                  }}
                  className="block px-3 py-2 hover:bg-blue-50 text-sm"
                >
                  <div className="font-medium text-slate-800 truncate">{h.label}</div>
                  {h.snippet && <div className="text-[11px] text-slate-500 truncate">{h.snippet}</div>}
                  {h.matched_field && (
                    <div className="text-[10px] text-slate-400 mt-0.5">matched: {h.matched_field}</div>
                  )}
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─────────────────────────── Register table ─────────────────────────
function RegisterTable({ rows, loading, onRowClick, onDelete, statuses, page, total, limit, setPage, setMapAsset }) {
  const canDelete = useCan()('assets', 'delete');
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="fleet-register-table">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              {/* v58.13.127 — GPS pin column. Shows a violet MapPin
                  on Navixy-tracked rows with coords, muted grey pin
                  on Navixy-but-no-ping rows, empty otherwise. */}
              <th className="px-2 py-2 w-8"></th>
              <th className="px-3 py-2 text-left">Rego</th>
              <th className="px-3 py-2 text-left">Name / description</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Sub-type</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">
                <span className="inline-flex items-center gap-1"
                      data-testid="fleet-service-column-header"
                      title="Service schedule status — AMBER at 85% of interval, RED at 100%+. Grey means no counter data yet.">
                  Service
                  <Info size={10} className="text-slate-400" />
                </span>
              </th>
              <th className="px-3 py-2 text-left">Signals</th>
              {canDelete && <th className="px-3 py-2 text-left w-8"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={canDelete ? 9 : 8} className="px-3 py-8 text-center text-slate-400"><Loader2 className="inline animate-spin" size={14} /> Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={canDelete ? 9 : 8} className="px-3 py-8 text-center text-slate-400">No assets match.</td></tr>
            )}
            {!loading && rows.map((r, idx) => (
              <tr key={r.id} onClick={() => onRowClick(r.id)}
                  data-testid={`fleet-register-row-${r.id}`}
                  data-zebra={idx % 2 === 1 ? 'odd' : 'even'}
                  data-retired={r.status === 'retired' ? 'true' : 'false'}
                  className={`group cursor-pointer transition-colors ${
                    idx % 2 === 1 ? 'bg-slate-100' : 'bg-white'
                  } ${r.status === 'retired' ? 'opacity-60' : ''} hover:!bg-violet-50`}>
                <td className="px-2 py-2 w-8 text-center" onClick={(e) => e.stopPropagation()}>
                  {/* v58.13.127 — MapPin cell. Three states:
                       · violet   → Navixy + coords → click opens map modal
                       · grey     → Navixy but no ping yet → tooltip only
                       · empty    → not Navixy-tracked */}
                  {r.navixy_device_id && r.last_known_lat != null && r.last_known_lng != null ? (
                    <button
                      type="button"
                      onClick={() => setMapAsset(r)}
                      data-testid={`fleet-map-pin-${r.id}`}
                      title={`Show GPS position for ${r.rego_serial || r.name}`}
                      className="p-1 rounded hover:bg-violet-100 text-violet-600 hover:text-violet-800 transition-colors"
                    >
                      <MapPin size={15} strokeWidth={2.4} />
                    </button>
                  ) : r.navixy_device_id ? (
                    <span title="No GPS ping received yet"
                          data-testid={`fleet-map-pin-noping-${r.id}`}
                          className="inline-flex p-1 text-slate-300">
                      <MapPin size={15} strokeWidth={2.0} />
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 font-mono text-sm font-semibold text-slate-800">
                  {/* v58.13.125 — Reject 10+ digit numeric IDs
                      (Navixy tracker serials). Fallback chain:
                      real rego → name → em-dash.
                      v58.13.128 — Rose "Retired" pill inline. */}
                  <span className="inline-flex items-center gap-2">
                    {(() => {
                      const rs = r.rego_serial;
                      if (rs && !/^\d{10,}$/.test(rs)) return rs;
                      return r.name || '—';
                    })()}
                    {r.status === 'retired' && (
                      <span data-testid={`fleet-retired-pill-${r.id}`}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-100 text-rose-800 normal-case tracking-normal">
                        Retired
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700 max-w-md truncate">{r.name || r.description || '—'}</td>
                <td className="px-3 py-2"><KindPill kind={r.kind} /></td>
                <td className="px-3 py-2 text-slate-600 text-xs">{displaySubtype(r.asset_type || r.sub_type)}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${
                    r.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}>{r.status || 'unknown'}</span>
                </td>
                <td className="px-3 py-2">
                  <ServiceStatusPill block={statuses?.[r.id]} assetId={r.id} />
                </td>
                <td className="px-3 py-2"><RowChips row={r} /></td>
                {canDelete && (
                  <td className="px-3 py-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete?.(r); }}
                      data-testid={`fleet-register-delete-${r.id}`}
                      title="Delete this asset"
                      className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 bg-slate-50/50 text-xs">
          <span>Page <strong className="tabular-nums">{page}</strong> of <strong className="tabular-nums">{totalPages}</strong> — {total} total</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(page - 1)} disabled={page <= 1}
              data-testid="fleet-register-page-prev"
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30">Prev</button>
            <button onClick={() => setPage(page + 1)} disabled={page >= totalPages}
              data-testid="fleet-register-page-next"
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ─────────────────────────── Page ───────────────────────────────────
export default function FleetRegister() {
  const [flagState, setFlagState] = useState('probing'); // probing | on | off
  const [categories, setCategories] = useState(null);
  const [filter, setFilter] = useState({ kind: null, sub_type: null, navixy_only: false, service_due: false, data_source: 'all', retired_only: false });
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // v58.13.120f — Drawer state now holds the FULL asset object (fetched
  // via GET /assets/{id}) so AssetDrawer receives everything it needs.
  const [drawerAsset, setDrawerAsset] = useState(null);
  // v58.13.127 — Asset being previewed in the GPS map modal (Item 1).
  const [mapAsset, setMapAsset] = useState(null);
  const [drawerInitialTab, setDrawerInitialTab] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  // v58.13.120g — Confirm-delete state for row-hover delete affordance.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // v58.13.122 — Service status rollup, keyed by asset id. Fetched
  // as a single batched request after each register load.
  const [statuses, setStatuses] = useState({});
  const [statusCounts, setStatusCounts] = useState({ green: 0, amber: 0, red: 0, grey: 0 });
  const LIMIT = 50;

  // Probe the feature flag via the /categories 404 signal.
  useEffect(() => {
    api.get('/fleet/categories')
      .then((r) => { setCategories(r.data); setFlagState('on'); })
      .catch((e) => {
        if (e?.response?.status === 404) setFlagState('off');
        else { setFlagState('off'); toast.error(apiError(e) || 'Fleet register unavailable'); }
      });
  }, []);

  // Deep-link support: `?open=<asset_id>&tab=<tab_key>`.
  const { deepLinkId, deepLinkExtras } = useDeepLinkOpen({
    items: rows, loading: rowsLoading,
    notFoundMessage: 'Linked asset not on this page — clear filters to widen results',
    extraParams: ['tab'],
  });

  const openAsset = React.useCallback(async (assetId, initialTab = null) => {
    if (!assetId) return;
    setDrawerLoading(true);
    setDrawerInitialTab(initialTab);
    try {
      const r = await api.get(`/assets/${assetId}`);
      setDrawerAsset(r.data);
    } catch (e) {
      toast.error(apiError(e) || 'Could not open asset');
    } finally { setDrawerLoading(false); }
  }, []);

  useEffect(() => {
    if (deepLinkId && flagState === 'on') {
      openAsset(deepLinkId, deepLinkExtras?.tab || null);
    }
  }, [deepLinkId, flagState, deepLinkExtras, openAsset]);

  // Load rows on filter / page change.
  const reloadRows = React.useCallback(() => {
    if (flagState !== 'on') return;
    setRowsLoading(true);
    const params = { page, limit: LIMIT };
    if (filter.kind) params.kind = filter.kind;
    if (filter.sub_type) params.sub_type = filter.sub_type;
    // v58.13.125 — Data-source dimension (Option B). Maps to the
    // existing `navixy_only` backend param for source=navixy; for
    // source=manual we filter client-side because /fleet/register
    // has no `navixy_only=false` semantics today (server-side
    // enhancement queued for `.126`).
    if (filter.data_source === 'navixy' || filter.navixy_only) params.navixy_only = true;
    // v58.13.128 — Retired-only filter.
    if (filter.retired_only) params.retired_only = true;
    api.get('/fleet/register', { params })
      .then((r) => { setRows(r.data.items); setTotal(r.data.total); })
      .catch((e) => toast.error(apiError(e) || 'Register load failed'))
      .finally(() => setRowsLoading(false));
  }, [flagState, filter.kind, filter.sub_type, filter.navixy_only, filter.data_source, filter.retired_only, page]);

  useEffect(() => { reloadRows(); }, [reloadRows]);

  // v58.13.122 — Rollup fetch every time the row set changes.
  useEffect(() => {
    if (!rows.length) { setStatuses({}); return; }
    const ids = rows.map((r) => r.id).join(',');
    let cancelled = false;
    api.get('/fleet/service-status-rollup', { params: { ids } })
      .then((r) => {
        if (cancelled) return;
        setStatuses(r.data?.statuses || {});
        setStatusCounts(r.data?.counts || { green: 0, amber: 0, red: 0, grey: 0 });
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [rows]);

  // v58.13.120g — "Add new" starts an empty asset in AssetDrawer.
  const openAddAsset = (preferredKind) => {
    setDrawerInitialTab('details');
    setDrawerAsset({
      id: null,
      kind: preferredKind || 'plant',
      name: '',
      asset_type: preferredKind === 'trailer' ? 'trailer' : 'excavator',
      status: 'active',
    });
  };

  // v58.13.120g — Row-hover delete uses the existing hard-delete
  // endpoint (backend `DELETE /assets/{id}` — asset row removed,
  // plant_maintenance rows retained per the confirm copy).
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/assets/${pendingDelete.id}`);
      toast.success(`Deleted ${pendingDelete.rego_serial || pendingDelete.name || 'asset'}`);
      setPendingDelete(null);
      reloadRows();
    } catch (e) {
      toast.error(apiError(e) || 'Delete failed');
    } finally { setDeleting(false); }
  };

  // v58.13.120f — Show FleetLiveDashboards whenever the current page
  // of rows contains at least one Navixy-linked asset.
  const hasNavixyOnPage = useMemo(
    () => rows.some((r) => !!r.navixy_device_id),
    [rows],
  );

  const printLabels = async () => {
    try {
      const asset_ids = rows.map((r) => r.id);
      const resp = await api.post('/assets/labels/bulk',
        { asset_ids, layout: 'avery_l7160' },
        { responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url; a.download = `fleet-labels-${asset_ids.length}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(apiError(e) || 'Label print failed');
    }
  };

  if (flagState === 'probing') {
    return <div className="p-8 text-slate-500 flex items-center gap-2"><Loader2 className="animate-spin" size={14} /> Loading Fleet & Service Register…</div>;
  }
  if (flagState === 'off') {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center" data-testid="fleet-coming-soon">
        <Truck className="mx-auto text-slate-400" size={40} />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Fleet & Service Register — coming soon</h1>
        <p className="mt-2 text-sm text-slate-500">
          This new surface is being rolled out. Continue using <Link to="/app/vehicles" className="text-blue-600 hover:underline">Plant &amp; Vehicles</Link> for now.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="fleet-register-page">
      {/* v58.13.124 — Header banner. Full-width JPEG behind a
          left-anchored H1 + H2 with a soft dark gradient for
          contrast. Responsive: ~200 px on ≥md, 140 px on mobile. */}
      <div
        data-testid="fleet-register-header-banner"
        className="relative w-full h-[140px] md:h-[200px] overflow-hidden"
        style={{
          backgroundImage: 'url(/fleet-register-header.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center 40%',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900/70 via-slate-900/40 to-transparent" />
        <div className="relative h-full max-w-7xl mx-auto px-6 md:px-8 flex flex-col justify-center">
          <h1 className="text-2xl md:text-4xl font-bold text-white tracking-tight"
              style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
            Fleet &amp; Service Register
          </h1>
          <p className="mt-1 md:mt-2 text-sm md:text-base text-white/90 max-w-2xl"
             style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
            Unified register for vehicles, plant, trailers, tools, and containers with full service history.
          </p>
        </div>
      </div>

    <div className="p-6">
      <header className="mb-4 flex items-baseline justify-end gap-4">
        <div className="flex gap-2">
          <Can resource="assets" action="view">
            <button onClick={printLabels}
              data-testid="fleet-print-labels-btn"
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5">
              <Printer size={13} /> Print labels
            </button>
          </Can>
        </div>
      </header>

      <div className="mb-4">
        <SearchBar onOpenAsset={openAsset} />
      </div>

      {/* v58.13.120f — Fleet Live Dashboards banner. Mounts whenever any
          asset on the current page is Navixy-linked. Component
          self-fetches and persists collapsed state. */}
      {hasNavixyOnPage && (
        <div data-testid="fleet-live-dashboards-banner">
          <FleetLiveDashboards />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <aside className="rounded-2xl border border-slate-200 bg-white p-3">
          <FilterTree
            data={categories}
            filter={filter}
            setFilter={(f) => { setFilter(f); setPage(1); }}
            onAddAsset={openAddAsset}
            serviceDueCount={(statusCounts.amber || 0) + (statusCounts.red || 0)}
            retiredData={categories?.retired}
            sourceCounts={(() => {
              // v58.13.126 — Prefer server-authoritative counts from
              // `/api/fleet/categories.source_counts`. Falls back to
              // client-derived counts for older API responses.
              if (categories?.source_counts) {
                return categories.source_counts;
              }
              const total = categories?.total || 0;
              const navixy = rows.filter((r) => !!r.navixy_device_id).length;
              return { total, navixy, manual: Math.max(0, total - navixy) };
            })()}
          />
        </aside>
        <main>
          <RegisterTable
            rows={(() => {
              let r = rows;
              // Data-source manual filter is client-side today.
              if (filter.data_source === 'manual') {
                r = r.filter((row) => !row.navixy_device_id);
              }
              if (filter.service_due) {
                r = r.filter((row) => ['amber', 'red'].includes(statuses?.[row.id]?.status));
              }
              return r;
            })()}
            loading={rowsLoading}
            onRowClick={openAsset}
            onDelete={(r) => setPendingDelete(r)}
            statuses={statuses}
            page={page}
            total={filter.service_due
              ? rows.filter((r) => ['amber', 'red'].includes(statuses?.[r.id]?.status)).length
              : total}
            limit={LIMIT}
            setPage={setPage}
            setMapAsset={setMapAsset}
          />
        </main>
      </div>

      {/* v58.13.127 — GPS map modal. Rendered outside <main> so the
          Leaflet container has a clean stacking context. */}
      {mapAsset && (
        <AssetMapModal asset={mapAsset} onClose={() => setMapAsset(null)} />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/50 p-3"
             onClick={(e) => e.target === e.currentTarget && !deleting && setPendingDelete(null)}
             data-testid="fleet-delete-confirm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700">Confirm delete</div>
              <h3 className="font-display text-lg font-bold text-slate-900 mt-1">
                Delete asset {pendingDelete.rego_serial || pendingDelete.name || pendingDelete.id.slice(0, 8)}?
              </h3>
              <p className="text-sm text-slate-600 mt-2">
                This removes the asset row. Linked service history / plant_maintenance records are retained.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                data-testid="fleet-delete-cancel"
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                data-testid="fleet-delete-confirm-btn"
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                {deleting && <Loader2 size={13} className="animate-spin" />}
                Delete asset
              </button>
            </div>
          </div>
        </div>
      )}

      {drawerLoading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
             data-testid="fleet-drawer-loading">
          <div className="bg-white rounded-lg px-6 py-4 shadow-lg flex items-center gap-2">
            <Loader2 className="animate-spin text-blue-600" size={16} />
            <span className="text-sm text-slate-700">Loading asset…</span>
          </div>
        </div>
      )}
      {drawerAsset && !drawerLoading && (
        <AssetDrawer
          asset={drawerAsset}
          initialTab={drawerInitialTab}
          onClose={() => { setDrawerAsset(null); setDrawerInitialTab(null); }}
          onSaved={(a) => { setDrawerAsset(a); reloadRows(); }}
        />
      )}
    </div>
    </div>
  );
}
