// Phase 3.9b — Admin-managed Form-to-Asset-Type Assignments.
//
// Matrix-first UI: rows = templates, columns = "Any asset" + per-kind toggles
// + per-asset-type checkboxes (columns derived from the org's asset register).
// A "List view" toggle gives a per-template card with two multi-select
// dropdowns for narrow viewports. Save batches the whole matrix via
// `POST /api/form-templates/assignments/bulk` and toasts a diff count.
//
// Permission gate: only admin/manager/hseq_lead see the link in the sidebar.
// The page itself also lockouts the worker role with a friendly panel.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Loader2, Save, Search, Filter, RotateCcw, AlertTriangle, Check,
  ClipboardCheck, Truck, Wrench, Hammer, Box, LayoutGrid, List as ListIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';

const KIND_OPTIONS = [
  { key: 'vehicle',   label: 'Vehicle',   Icon: Truck },
  { key: 'plant',     label: 'Plant',     Icon: Wrench },
  { key: 'tool',      label: 'Tool',      Icon: Hammer },
  { key: 'container', label: 'Container', Icon: Box },
];

const CATEGORY_PILL = {
  pre_use:         'bg-blue-50 text-blue-700',
  daily_check:     'bg-indigo-50 text-indigo-700',
  plant_pre_start: 'bg-emerald-50 text-emerald-700',
  incident:        'bg-rose-50 text-rose-700',
  near_miss:       'bg-amber-50 text-amber-700',
  general:         'bg-slate-100 text-slate-600',
};

function fmtType(t) {
  return (t || '—').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function FormAssignmentsAdmin() {
  const me = getUser();
  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isLockedOut = !canEdit && me?.role !== 'hseq_lead';
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focusedType = params.get('asset_type');

  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('matrix');
  const [templates, setTemplates] = useState([]);
  const [columns, setColumns] = useState({});   // {vehicle:[...], plant:[...]}
  const [draft, setDraft] = useState({});       // {template_id: {kinds:Set, asset_types:Set}}
  const [search, setSearch] = useState(focusedType ? focusedType.replace(/_/g, ' ') : '');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/form-templates/assignments');
      setTemplates(data.templates || []);
      setColumns(data.asset_type_columns || {});
      // Seed the draft state from the server snapshot.
      const next = {};
      (data.templates || []).forEach((t) => {
        const a = t.applies_to || {};
        next[t.id] = {
          kinds: new Set((a.kinds || []).map((k) => k.toLowerCase())),
          asset_types: new Set((a.asset_types || []).map((x) => x.toLowerCase())),
        };
      });
      setDraft(next);
    } catch (e) {
      if (e?.response?.status !== 403) toast.error(apiError(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const allCategories = useMemo(() => {
    const s = new Set();
    templates.forEach((t) => s.add(t.category || 'general'));
    return ['all', ...Array.from(s).sort()];
  }, [templates]);

  const flatTypes = useMemo(() => {
    // Flat list of {kind, asset_type} with kind ordering.
    const out = [];
    Object.entries(columns).forEach(([k, arr]) => {
      (arr || []).forEach((at) => out.push({ kind: k, asset_type: at }));
    });
    return out;
  }, [columns]);

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) =>
      (categoryFilter === 'all' || t.category === categoryFilter)
      && (!q || `${t.name} ${t.description || ''}`.toLowerCase().includes(q)),
    );
  }, [templates, search, categoryFilter]);

  // Dirty detection — compare draft Sets to original applies_to.
  const dirtyCount = useMemo(() => {
    let n = 0;
    templates.forEach((t) => {
      const orig = t.applies_to || { kinds: [], asset_types: [] };
      const d = draft[t.id];
      if (!d) return;
      const eqArr = (a, b) => a.size === b.length && [...a].every((x) => b.includes(x));
      if (!eqArr(d.kinds, (orig.kinds || [])) || !eqArr(d.asset_types, (orig.asset_types || []))) n += 1;
    });
    return n;
  }, [templates, draft]);

  const toggleKind = (tplId, kind) => {
    if (!canEdit) return;
    setDraft((prev) => {
      const d = prev[tplId] ?? { kinds: new Set(), asset_types: new Set() };
      const kinds = new Set(d.kinds);
      if (kinds.has(kind)) kinds.delete(kind); else kinds.add(kind);
      return { ...prev, [tplId]: { ...d, kinds } };
    });
  };
  const toggleType = (tplId, assetType) => {
    if (!canEdit) return;
    setDraft((prev) => {
      const d = prev[tplId] ?? { kinds: new Set(), asset_types: new Set() };
      const asset_types = new Set(d.asset_types);
      if (asset_types.has(assetType)) asset_types.delete(assetType); else asset_types.add(assetType);
      return { ...prev, [tplId]: { ...d, asset_types } };
    });
  };
  const clearRow = (tplId) => {
    if (!canEdit) return;
    setDraft((prev) => ({ ...prev, [tplId]: { kinds: new Set(), asset_types: new Set() } }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const assignments = Object.entries(draft).map(([template_id, v]) => ({
        template_id,
        kinds: Array.from(v.kinds),
        asset_types: Array.from(v.asset_types),
      }));
      const { data } = await api.post('/form-templates/assignments/bulk', { assignments });
      toast.success(`Saved · ${dirtyCount} template${dirtyCount === 1 ? '' : 's'} updated`);
      // Re-sync from server to clear dirty flags.
      await load();
      return data;
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  if (isLockedOut) {
    return (
      <div className="p-6 sm:p-10 max-w-2xl">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm" data-testid="assignments-lockout">
          <div className="inline-flex w-14 h-14 rounded-2xl items-center justify-center mb-3 bg-amber-50 text-amber-600">
            <AlertTriangle size={22} />
          </div>
          <h2 className="font-display text-xl font-bold">Admin only</h2>
          <p className="mt-2 text-sm text-slate-600">
            Form assignments are managed by your admin, manager, or HSEQ lead.
          </p>
          <Link to="/app/dashboard" className="mt-4 inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto" data-testid="form-assignments-page">
      {/* Header */}
      <div className="mb-5 flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-blue-700">Settings</div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900">Form Assignments</h1>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Workers will see these forms when they scan a matching asset&apos;s QR code.
            Tick <strong>Any asset</strong> to make a form universal, or pick specific kinds/types.
          </p>
        </div>
        {/* Sticky save */}
        <button onClick={save} disabled={!canEdit || dirtyCount === 0 || saving}
          data-testid="save-changes"
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-bold shadow-md transition ${
            dirtyCount > 0 && canEdit
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-slate-200 text-slate-500 cursor-not-allowed'
          }`}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save changes{dirtyCount > 0 ? ` · ${dirtyCount}` : ''}
        </button>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search template name…"
            data-testid="assignments-search"
            className="w-full pl-9 pr-3 py-2.5 rounded-2xl border border-slate-300 text-sm" />
        </div>
        <div className="relative">
          <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
            data-testid="assignments-category"
            className="pl-8 pr-7 py-2.5 rounded-2xl border border-slate-300 text-sm font-medium bg-white">
            {allCategories.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
          </select>
        </div>
        <div className="flex rounded-2xl border border-slate-300 overflow-hidden" data-testid="assignments-view-toggle">
          <button onClick={() => setView('matrix')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold ${view === 'matrix' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            data-testid="view-matrix"><LayoutGrid size={12} /> Matrix</button>
          <button onClick={() => setView('list')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold ${view === 'list' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            data-testid="view-list"><ListIcon size={12} /> List</button>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-sm text-slate-500">
          <Loader2 size={18} className="animate-spin inline mr-2 text-blue-600" /> Loading templates…
        </div>
      ) : flatTypes.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-900 mb-4">
          No assets in your register yet — only the <strong>Any asset</strong> toggle is available.
          Add vehicles or plant on <Link to="/app/vehicles" className="font-semibold underline">Plant &amp; Vehicles</Link> to unlock per-type assignments.
        </div>
      ) : null}

      {view === 'matrix' && !loading && (
        <MatrixView
          templates={filteredTemplates}
          columns={columns}
          flatTypes={flatTypes}
          draft={draft}
          canEdit={canEdit}
          toggleKind={toggleKind}
          toggleType={toggleType}
          clearRow={clearRow}
          focusedType={focusedType}
        />
      )}
      {view === 'list' && !loading && (
        <ListView
          templates={filteredTemplates}
          columns={columns}
          draft={draft}
          canEdit={canEdit}
          toggleKind={toggleKind}
          toggleType={toggleType}
          clearRow={clearRow}
        />
      )}
    </div>
  );
}

function MatrixView({ templates, flatTypes, draft, canEdit, toggleKind, toggleType, clearRow, focusedType }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse" data-testid="assignments-matrix">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left font-bold text-slate-700 min-w-[260px]">Template</th>
              <th className="px-3 py-3 text-center font-bold text-slate-700 border-l border-slate-200 min-w-[88px]">
                <div className="text-[10px] uppercase tracking-wider">Any asset</div>
              </th>
              {KIND_OPTIONS.map((k) => (
                <th key={k.key} className="px-3 py-3 text-center font-bold text-slate-700 border-l border-slate-200 min-w-[78px]">
                  <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider"><k.Icon size={11} />{k.label}</div>
                </th>
              ))}
              {flatTypes.map((c) => (
                <th key={`${c.kind}-${c.asset_type}`}
                  className={`px-3 py-3 text-center font-bold text-slate-700 border-l border-slate-200 min-w-[100px] ${focusedType === c.asset_type ? 'bg-blue-50' : ''}`}
                  data-testid={`col-${c.asset_type}`}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{c.kind}</div>
                  <div className="text-[11px] font-bold text-slate-800">{fmtType(c.asset_type)}</div>
                </th>
              ))}
              <th className="px-2 py-3 border-l border-slate-200" />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const d = draft[t.id] || { kinds: new Set(), asset_types: new Set() };
              const pillCls = CATEGORY_PILL[t.category] || CATEGORY_PILL.general;
              return (
                <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50/50" data-testid={`row-${t.id}`}>
                  <td className="sticky left-0 z-10 bg-white hover:bg-slate-50/50 px-4 py-2.5 min-w-[260px]">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck size={14} className="text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 text-[13px] truncate" title={t.name}>{t.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${pillCls}`}>{t.category || 'general'}</span>
                          {t.description && <span className="text-[11px] text-slate-500 truncate" title={t.description}>{t.description}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="text-center border-l border-slate-100"><Cell on={d.kinds.has('any')} onClick={() => toggleKind(t.id, 'any')} disabled={!canEdit} testid={`cell-${t.id}-any`} /></td>
                  {KIND_OPTIONS.map((k) => (
                    <td key={k.key} className="text-center border-l border-slate-100">
                      <Cell on={d.kinds.has(k.key)} onClick={() => toggleKind(t.id, k.key)} disabled={!canEdit} testid={`cell-${t.id}-kind-${k.key}`} />
                    </td>
                  ))}
                  {flatTypes.map((c) => (
                    <td key={`${c.kind}-${c.asset_type}`} className={`text-center border-l border-slate-100 ${focusedType === c.asset_type ? 'bg-blue-50/40' : ''}`}>
                      <Cell on={d.asset_types.has(c.asset_type)} onClick={() => toggleType(t.id, c.asset_type)} disabled={!canEdit} testid={`cell-${t.id}-${c.asset_type}`} />
                    </td>
                  ))}
                  <td className="text-center border-l border-slate-100 px-2">
                    <button onClick={() => clearRow(t.id)} disabled={!canEdit}
                      title="Clear all"
                      className="text-slate-400 hover:text-slate-700 p-1 rounded disabled:opacity-30"
                      data-testid={`clear-${t.id}`}>
                      <RotateCcw size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ on, onClick, disabled, testid }) {
  return (
    <button onClick={onClick} disabled={disabled} data-testid={testid}
      className={`w-6 h-6 rounded-md inline-flex items-center justify-center transition border ${
        on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 hover:bg-slate-50'
      } disabled:opacity-40`}>
      {on && <Check size={12} strokeWidth={3} />}
    </button>
  );
}

function ListView({ templates, columns, draft, canEdit, toggleKind, toggleType, clearRow }) {
  return (
    <div className="space-y-3" data-testid="assignments-list">
      {templates.map((t) => {
        const d = draft[t.id] || { kinds: new Set(), asset_types: new Set() };
        const pillCls = CATEGORY_PILL[t.category] || CATEGORY_PILL.general;
        return (
          <div key={t.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm" data-testid={`list-row-${t.id}`}>
            <div className="flex items-start gap-3 mb-3">
              <ClipboardCheck size={16} className="text-slate-400 mt-1" />
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-900">{t.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${pillCls}`}>{t.category || 'general'}</span>
                  {t.description && <span className="text-xs text-slate-500 truncate">{t.description}</span>}
                </div>
              </div>
              <button onClick={() => clearRow(t.id)} disabled={!canEdit}
                className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30"
                data-testid={`list-clear-${t.id}`}>Clear</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Kinds</div>
                <div className="flex flex-wrap gap-1.5">
                  {[{ key: 'any', label: 'Any' }, ...KIND_OPTIONS.map((k) => ({ key: k.key, label: k.label }))].map((k) => {
                    const on = d.kinds.has(k.key);
                    return (
                      <button key={k.key} onClick={() => toggleKind(t.id, k.key)} disabled={!canEdit}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                        data-testid={`list-kind-${t.id}-${k.key}`}>{k.label}</button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Asset types</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(columns).flatMap(([kind, arr]) => (arr || []).map((at) => {
                    const on = d.asset_types.has(at);
                    return (
                      <button key={`${kind}-${at}`} onClick={() => toggleType(t.id, at)} disabled={!canEdit}
                        className={`px-2 py-1 rounded-lg text-[11px] font-semibold border ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                        data-testid={`list-type-${t.id}-${at}`}>{fmtType(at)}</button>
                    );
                  }))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
