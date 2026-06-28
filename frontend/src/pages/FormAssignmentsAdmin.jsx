// Phase 3.9b — Admin Form-to-Asset-Type Assignments.
//
// Two-pane "email-client" layout (default): left rail = scrollable template
// list with search + multi-select, right pane = Kind + Asset Type checkbox
// groups + one-tap presets. Matrix view remains accessible as a secondary
// toggle for power users. Mobile collapses the left rail to a dropdown and
// pins the save bar to the bottom.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Loader2, Save, Search, AlertTriangle, Check, Truck, Wrench, Hammer, Box,
  LayoutGrid, Mail as ListPaneIcon, Circle, RotateCcw, Sparkles, CheckSquare, Square,
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

const fmtType = (t) => (t || '—').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function FormAssignmentsAdmin() {
  const me = getUser();
  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isLockedOut = !canEdit && me?.role !== 'hseq_lead';
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focusedType = params.get('asset_type');

  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('pane');       // 'pane' (default) | 'matrix'
  const [templates, setTemplates] = useState([]);
  const [columns, setColumns] = useState({});
  const [draft, setDraft] = useState({});         // {tid: {kinds:Set, asset_types:Set}}
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [multiOn, setMultiOn] = useState(false);
  const [bulkIds, setBulkIds] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/form-templates/assignments');
      setTemplates(data.templates || []);
      setColumns(data.asset_type_columns || {});
      const next = {};
      (data.templates || []).forEach((t) => {
        const a = t.applies_to || {};
        next[t.id] = {
          kinds: new Set((a.kinds || []).map((k) => k.toLowerCase())),
          asset_types: new Set((a.asset_types || []).map((x) => x.toLowerCase())),
        };
      });
      setDraft(next);
      if ((data.templates || []).length) setSelectedId((prev) => prev || data.templates[0].id);
    } catch (e) {
      if (e?.response?.status !== 403) toast.error(apiError(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Filter the left rail.
  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => !q || `${t.name} ${t.description || ''}`.toLowerCase().includes(q));
  }, [templates, search]);

  // Dirty detection.
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

  // Resolve which template IDs get the next mutation: either {selected one} or
  // {bulk selection if active}.
  const targetIds = useCallback(() => {
    if (multiOn && bulkIds.size > 0) return Array.from(bulkIds);
    return selectedId ? [selectedId] : [];
  }, [multiOn, bulkIds, selectedId]);

  const toggleKind = (kind) => {
    if (!canEdit) return;
    const ids = targetIds();
    if (!ids.length) return;
    setDraft((prev) => {
      const next = { ...prev };
      // Determine the target state: if ALL targets have this kind, untick; else tick.
      const allOn = ids.every((id) => next[id]?.kinds.has(kind));
      ids.forEach((id) => {
        const d = next[id] ?? { kinds: new Set(), asset_types: new Set() };
        const kinds = new Set(d.kinds);
        if (allOn) kinds.delete(kind); else kinds.add(kind);
        next[id] = { ...d, kinds };
      });
      return next;
    });
  };
  const toggleType = (at) => {
    if (!canEdit) return;
    const ids = targetIds();
    if (!ids.length) return;
    setDraft((prev) => {
      const next = { ...prev };
      const allOn = ids.every((id) => next[id]?.asset_types.has(at));
      ids.forEach((id) => {
        const d = next[id] ?? { kinds: new Set(), asset_types: new Set() };
        const asset_types = new Set(d.asset_types);
        if (allOn) asset_types.delete(at); else asset_types.add(at);
        next[id] = { ...d, asset_types };
      });
      return next;
    });
  };

  const applyPreset = (preset) => {
    if (!canEdit) return;
    const ids = targetIds();
    if (!ids.length) return;
    setDraft((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        if (preset === 'clear')        next[id] = { kinds: new Set(),                  asset_types: new Set() };
        else if (preset === 'any')     next[id] = { kinds: new Set(['any']),           asset_types: new Set() };
        else if (preset === 'vehicle') next[id] = { kinds: new Set(['vehicle']),       asset_types: new Set() };
        else if (preset === 'plant')   next[id] = { kinds: new Set(['plant']),         asset_types: new Set() };
      });
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const assignments = Object.entries(draft).map(([template_id, v]) => ({
        template_id, kinds: Array.from(v.kinds), asset_types: Array.from(v.asset_types),
      }));
      await api.post('/form-templates/assignments/bulk', { assignments });
      toast.success(`Saved · ${dirtyCount} template${dirtyCount === 1 ? '' : 's'} updated`);
      setBulkIds(new Set());
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  if (isLockedOut) {
    return (
      <div className="p-6 sm:p-10 max-w-2xl">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm" data-testid="assignments-lockout">
          <div className="inline-flex w-14 h-14 rounded-2xl items-center justify-center mb-3 bg-amber-50 text-amber-600"><AlertTriangle size={22} /></div>
          <h2 className="font-display text-xl font-bold">Admin only</h2>
          <p className="mt-2 text-sm text-slate-600">Form assignments are managed by your admin, manager, or HSEQ lead.</p>
          <Link to="/app/dashboard" className="mt-4 inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // Single flat list of asset_types for the right pane.
  const allTypes = Object.entries(columns).flatMap(([kind, arr]) => (arr || []).map((at) => ({ kind, asset_type: at })));
  const selected = templates.find((t) => t.id === selectedId);
  const selDraft = selectedId ? draft[selectedId] : null;

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden bg-slate-50" data-testid="form-assignments-page">
      {/* Sticky top toolbar */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 border-b border-slate-200 bg-white flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-blue-700">Settings</div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">Form Assignments</h1>
          <p className="text-[12px] text-slate-500">Workers see these forms when they scan a matching asset&apos;s QR code.</p>
        </div>
        <div className="flex rounded-2xl border border-slate-300 overflow-hidden" data-testid="assignments-view-toggle">
          <button onClick={() => setView('pane')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold ${view === 'pane' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            data-testid="view-pane"><ListPaneIcon size={12} /> Two-pane</button>
          <button onClick={() => setView('matrix')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold ${view === 'matrix' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            data-testid="view-matrix"><LayoutGrid size={12} /> Matrix</button>
        </div>
        <button onClick={save} disabled={!canEdit || dirtyCount === 0 || saving}
          data-testid="save-changes"
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold shadow-sm transition ${
            dirtyCount > 0 && canEdit ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-slate-200 text-slate-500 cursor-not-allowed'
          }`}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save changes{dirtyCount > 0 ? ` · ${dirtyCount}` : ''}
        </button>
      </div>

      {loading ? (
        <div className="flex-1 grid place-items-center text-sm text-slate-500">
          <div><Loader2 size={18} className="animate-spin inline mr-2 text-blue-600" /> Loading…</div>
        </div>
      ) : view === 'matrix' ? (
        <MatrixFallback templates={filteredTemplates} allTypes={allTypes} draft={draft} canEdit={canEdit}
          toggleSingleKind={(id, k) => { setSelectedId(id); setBulkIds(new Set()); setMultiOn(false); setTimeout(() => toggleKind(k), 0); }}
          toggleSingleType={(id, at) => { setSelectedId(id); setBulkIds(new Set()); setMultiOn(false); setTimeout(() => toggleType(at), 0); }}
          focusedType={focusedType} />
      ) : (
        <div className="flex-1 min-h-0 flex">
          {/* Left rail */}
          <div className="w-full sm:w-[320px] border-r border-slate-200 bg-white flex flex-col" data-testid="left-rail">
            <div className="px-3 py-2 border-b border-slate-200 space-y-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${templates.length} templates…`}
                  data-testid="assignments-search"
                  className="w-full pl-8 pr-2 py-2 rounded-lg border border-slate-300 text-xs" />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>{filteredTemplates.length} of {templates.length}</span>
                <button onClick={() => { setMultiOn((p) => !p); setBulkIds(new Set()); }}
                  data-testid="multi-toggle"
                  className={`font-semibold inline-flex items-center gap-1 ${multiOn ? 'text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>
                  <CheckSquare size={11} /> Multi-select {multiOn && `· ${bulkIds.size}`}
                </button>
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto" data-testid="assignments-rail">
              {filteredTemplates.map((t) => {
                const d = draft[t.id];
                const hasAssign = d && (d.kinds.size > 0 || d.asset_types.size > 0);
                const isSel = selectedId === t.id;
                const isBulk = bulkIds.has(t.id);
                return (
                  <li key={t.id} data-testid={`rail-row-${t.id}`}
                    onClick={() => multiOn ? setBulkIds((p) => { const n = new Set(p); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; }) : setSelectedId(t.id)}
                    className={`px-3 py-2.5 border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${isSel && !multiOn ? 'bg-blue-50 border-l-2 border-l-blue-600' : ''}`}>
                    <div className="flex items-start gap-2">
                      {multiOn && (
                        isBulk ? <CheckSquare size={14} className="text-blue-600 mt-0.5" /> : <Square size={14} className="text-slate-300 mt-0.5" />
                      )}
                      <Circle size={8} className={`mt-1.5 ${hasAssign ? 'fill-emerald-500 text-emerald-500' : 'fill-slate-300 text-slate-300'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-slate-900 truncate">{t.name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">{t.category || 'general'}</div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Right pane */}
          <div className="hidden sm:flex flex-1 overflow-y-auto" data-testid="right-pane">
            {selected && selDraft ? (
              <div className="p-5 sm:p-7 w-full max-w-3xl">
                {multiOn && bulkIds.size > 0 && (
                  <div className="mb-4 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 inline-flex items-center gap-2">
                    <Sparkles size={12} /> Editing <strong>{bulkIds.size}</strong> templates at once. Toggling a box applies to all.
                  </div>
                )}
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900" data-testid="selected-name">{multiOn && bulkIds.size > 0 ? `${bulkIds.size} templates selected` : selected.name}</h2>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${CATEGORY_PILL[selected.category] || CATEGORY_PILL.general}`}>{selected.category || 'general'}</span>
                </div>
                {selected.description && !(multiOn && bulkIds.size > 0) && <p className="mt-1 text-sm text-slate-600">{selected.description}</p>}

                {/* Kind section */}
                <section className="mt-6">
                  <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">Applies to KIND</h3>
                  <div className="flex flex-wrap gap-2">
                    <CheckChip on={selDraft.kinds.has('any')} onClick={() => toggleKind('any')} disabled={!canEdit} label="Any asset" testid="chip-kind-any" emphatic />
                    {KIND_OPTIONS.map((k) => (
                      <CheckChip key={k.key} on={selDraft.kinds.has(k.key)} onClick={() => toggleKind(k.key)} disabled={!canEdit} label={k.label} Icon={k.Icon} testid={`chip-kind-${k.key}`} />
                    ))}
                  </div>
                </section>

                {/* Asset Type section */}
                <section className="mt-6">
                  <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">Applies to ASSET TYPE</h3>
                  {allTypes.length === 0 ? (
                    <div className="px-3 py-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      No asset types in your register yet. Use <strong>Any asset</strong> above or add assets on <Link to="/app/vehicles" className="font-semibold underline">Plant &amp; Vehicles</Link>.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
                      {allTypes.map((c) => (
                        <CheckChip key={`${c.kind}-${c.asset_type}`}
                          on={selDraft.asset_types.has(c.asset_type)}
                          onClick={() => toggleType(c.asset_type)}
                          disabled={!canEdit}
                          label={fmtType(c.asset_type)}
                          hint={c.kind}
                          testid={`chip-type-${c.asset_type}`}
                          highlighted={focusedType === c.asset_type} />
                      ))}
                    </div>
                  )}
                </section>

                {/* Presets */}
                <section className="mt-6 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mr-2">Presets:</span>
                  <PresetBtn onClick={() => applyPreset('any')}     label="Any asset" testid="preset-any" />
                  <PresetBtn onClick={() => applyPreset('vehicle')} label="All vehicles" testid="preset-vehicle" />
                  <PresetBtn onClick={() => applyPreset('plant')}   label="All plant" testid="preset-plant" />
                  <PresetBtn onClick={() => applyPreset('clear')}   label="Clear" Icon={RotateCcw} testid="preset-clear" />
                </section>
              </div>
            ) : (
              <div className="m-auto text-sm text-slate-500">Select a template on the left to edit its assignments.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckChip({ on, onClick, disabled, label, Icon, testid, hint, emphatic, highlighted }) {
  return (
    <button onClick={onClick} disabled={disabled} data-testid={testid}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition ${
        on
          ? (emphatic ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-blue-600 border-blue-600 text-white')
          : (highlighted ? 'bg-blue-50 border-blue-300 text-slate-800 hover:bg-blue-100' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50')
      } disabled:opacity-40`}>
      <span className={`inline-flex w-4 h-4 rounded-sm items-center justify-center border ${on ? 'bg-white/30 border-white/50' : 'border-slate-300'}`}>{on && <Check size={11} strokeWidth={3} />}</span>
      {Icon && <Icon size={12} />}
      {label}
      {hint && !on && <span className="text-[10px] text-slate-400">· {hint}</span>}
    </button>
  );
}

function PresetBtn({ onClick, label, Icon, testid }) {
  return (
    <button onClick={onClick} data-testid={testid}
      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
      {Icon && <Icon size={11} />} {label}
    </button>
  );
}

// Matrix view kept for power users — compact, no horizontal scroll on wide screens.
function MatrixFallback({ templates, allTypes, draft, canEdit, toggleSingleKind, toggleSingleType, focusedType }) {
  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse" data-testid="assignments-matrix">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-bold text-slate-700 min-w-[240px]">Template</th>
              <th className="px-2 py-2 text-center font-bold text-slate-700 border-l border-slate-200 min-w-[60px]">Any</th>
              {KIND_OPTIONS.map((k) => (
                <th key={k.key} className="px-2 py-2 text-center font-bold text-slate-700 border-l border-slate-200 min-w-[60px]"><k.Icon size={11} className="inline" /> {k.label}</th>
              ))}
              {allTypes.map((c) => (
                <th key={c.asset_type} className={`px-2 py-2 text-center font-bold text-slate-700 border-l border-slate-200 min-w-[80px] ${focusedType === c.asset_type ? 'bg-blue-50' : ''}`}>{fmtType(c.asset_type)}</th>
              ))}
            </tr></thead>
            <tbody>
              {templates.map((t) => {
                const d = draft[t.id] || { kinds: new Set(), asset_types: new Set() };
                return (
                  <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="sticky left-0 z-10 bg-white hover:bg-slate-50/50 px-3 py-2 text-[13px] font-semibold text-slate-900">{t.name}</td>
                    <td className="text-center border-l border-slate-100"><MatrixCell on={d.kinds.has('any')} onClick={() => toggleSingleKind(t.id, 'any')} disabled={!canEdit} /></td>
                    {KIND_OPTIONS.map((k) => (
                      <td key={k.key} className="text-center border-l border-slate-100"><MatrixCell on={d.kinds.has(k.key)} onClick={() => toggleSingleKind(t.id, k.key)} disabled={!canEdit} /></td>
                    ))}
                    {allTypes.map((c) => (
                      <td key={c.asset_type} className={`text-center border-l border-slate-100 ${focusedType === c.asset_type ? 'bg-blue-50/40' : ''}`}><MatrixCell on={d.asset_types.has(c.asset_type)} onClick={() => toggleSingleType(t.id, c.asset_type)} disabled={!canEdit} /></td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
function MatrixCell({ on, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-5 h-5 rounded inline-flex items-center justify-center border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 hover:bg-slate-50'} disabled:opacity-40`}>
      {on && <Check size={11} strokeWidth={3} />}
    </button>
  );
}
