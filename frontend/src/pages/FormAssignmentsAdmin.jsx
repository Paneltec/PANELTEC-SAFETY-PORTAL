// Phase 3.9b — Admin Form-to-Asset-Type Assignments.
//
// Two-pane "email-client" layout (default): left rail = scrollable template
// list with search + multi-select, right pane = Kind + Asset Type checkbox
// groups + one-tap presets. Matrix view remains accessible as a secondary
// toggle for power users. Mobile collapses the left rail to a dropdown and
// pins the save bar to the bottom.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Loader2, Save, AlertTriangle, Check, Truck, Wrench, Hammer, Box, LayoutGrid, Circle, RotateCcw, Sparkles, CheckSquare, Square, HardHat, Users, Building2, X } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';

// Phase 3.20 Wave 2 — lucide row-action/toolbar icons swapped
// to @fluentui/react-icons. Aliased back to the original lucide
// names so existing JSX call sites don't need to change.
import {
  Mail20Regular as Mail,
  Mail20Regular as ListPaneIcon,
  Search20Regular as Search,
  Send20Regular as Send,
} from '@fluentui/react-icons';

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
  const [roleOptions, setRoleOptions] = useState([]);
  const [companyOptions, setCompanyOptions] = useState([]);
  const [draft, setDraft] = useState({});         // {tid: {kinds:Set, asset_types:Set, worker_ids:Set, roles:Set, companies:Set}}
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [multiOn, setMultiOn] = useState(false);
  const [bulkIds, setBulkIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [recipientPreview, setRecipientPreview] = useState({ count: 0, sample: [] });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerResults, setWorkerResults] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/form-templates/assignments');
      setTemplates(data.templates || []);
      setColumns(data.asset_type_columns || {});
      setRoleOptions(data.roles || []);
      setCompanyOptions(data.companies || []);
      const next = {};
      (data.templates || []).forEach((t) => {
        const a = t.applies_to || {};
        next[t.id] = {
          kinds: new Set((a.kinds || []).map((k) => k.toLowerCase())),
          asset_types: new Set((a.asset_types || []).map((x) => x.toLowerCase())),
          worker_ids: new Set((a.worker_ids || []).map((w) => w.worker_id || w)),
          roles: new Set((a.roles || []).map((r) => (r.role || r).toLowerCase())),
          companies: new Set((a.companies || []).map((c) => String(c.simpro_company_id || c))),
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
      const orig = t.applies_to || { kinds: [], asset_types: [], worker_ids: [], roles: [], companies: [] };
      const d = draft[t.id];
      if (!d) return;
      const eqSet = (a, b) => a.size === b.length && [...a].every((x) => b.includes(x));
      const origWorkers = (orig.worker_ids || []).map((w) => w.worker_id || w);
      const origRoles = (orig.roles || []).map((r) => (r.role || r).toLowerCase());
      const origCompanies = (orig.companies || []).map((c) => String(c.simpro_company_id || c));
      if (
        !eqSet(d.kinds, (orig.kinds || []))
        || !eqSet(d.asset_types, (orig.asset_types || []))
        || !eqSet(d.worker_ids, origWorkers)
        || !eqSet(d.roles, origRoles)
        || !eqSet(d.companies, origCompanies)
      ) n += 1;
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
        const d = next[id] ?? { kinds: new Set(), asset_types: new Set(), worker_ids: new Set(), roles: new Set(), companies: new Set() };
        const asset_types = new Set(d.asset_types);
        if (allOn) asset_types.delete(at); else asset_types.add(at);
        next[id] = { ...d, asset_types };
      });
      return next;
    });
  };

  // Generic toggler for Phase 3.9c target sets (worker_ids / roles / companies).
  const toggleTarget = (setName, value) => {
    if (!canEdit) return;
    const ids = targetIds();
    if (!ids.length) return;
    setDraft((prev) => {
      const next = { ...prev };
      const allOn = ids.every((id) => next[id]?.[setName]?.has(value));
      ids.forEach((id) => {
        const d = next[id] ?? { kinds: new Set(), asset_types: new Set(), worker_ids: new Set(), roles: new Set(), companies: new Set() };
        const s = new Set(d[setName]);
        if (allOn) s.delete(value); else s.add(value);
        next[id] = { ...d, [setName]: s };
      });
      return next;
    });
  };

  // Debounced worker search → `/forms/pickers/workers`.
  useEffect(() => {
    const q = workerSearch.trim();
    if (!q) { setWorkerResults([]); return; }
    const t = setTimeout(() => {
      api.get('/forms/pickers/workers', { params: { q, limit: 8 } })
        .then((r) => setWorkerResults(r.data?.workers || []))
        .catch(() => setWorkerResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [workerSearch]);

  // Live "Visible to N workers" counter for the SELECTED single template.
  useEffect(() => {
    if (!selectedId || multiOn) { setRecipientPreview({ count: 0, sample: [] }); return; }
    const d = draft[selectedId];
    if (!d) return;
    const payload = appliesToPayload(d);
    const t = setTimeout(() => {
      api.post(`/form-templates/${selectedId}/preview-recipients`, payload)
        .then((r) => setRecipientPreview({
          count: r.data?.next_count || 0,
          newlyAdded: r.data?.newly_added_count || 0,
          sample: r.data?.newly_added_sample || [],
        }))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [selectedId, multiOn, draft]);

  const applyPreset = (preset) => {
    if (!canEdit) return;
    const ids = targetIds();
    if (!ids.length) return;
    setDraft((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        const keep = next[id] || { worker_ids: new Set(), roles: new Set(), companies: new Set() };
        if (preset === 'clear')        next[id] = { kinds: new Set(),                  asset_types: new Set(), worker_ids: new Set(), roles: new Set(), companies: new Set() };
        else if (preset === 'any')     next[id] = { kinds: new Set(['any']),           asset_types: new Set(), worker_ids: keep.worker_ids, roles: keep.roles, companies: keep.companies };
        else if (preset === 'vehicle') next[id] = { kinds: new Set(['vehicle']),       asset_types: new Set(), worker_ids: keep.worker_ids, roles: keep.roles, companies: keep.companies };
        else if (preset === 'plant')   next[id] = { kinds: new Set(['plant']),         asset_types: new Set(), worker_ids: keep.worker_ids, roles: keep.roles, companies: keep.companies };
      });
      return next;
    });
  };

  // Convert a draft cell → backend payload (with expires_at = null since the
  // UI ships persistent assignments only; expiry support is in the backend
  // model and ready for a future picker).
  const appliesToPayload = (v) => ({
    kinds: Array.from(v.kinds),
    asset_types: Array.from(v.asset_types),
    worker_ids: Array.from(v.worker_ids).map((w) => ({ worker_id: w })),
    roles: Array.from(v.roles).map((r) => ({ role: r })),
    companies: Array.from(v.companies).map((c) => ({ simpro_company_id: c })),
  });

  // Actually persist; `skip_notifications` opts out of the email + SMS fanout.
  const persistSave = async (skipNotifications) => {
    setSaving(true);
    try {
      const assignments = Object.entries(draft).map(([template_id, v]) => ({
        template_id, ...appliesToPayload(v),
      }));
      const r = await api.post('/form-templates/assignments/bulk', {
        assignments, skip_notifications: !!skipNotifications,
      });
      const totals = r.data?.notify || {};
      if (skipNotifications) {
        toast.success(`Saved · ${dirtyCount} template${dirtyCount === 1 ? '' : 's'} updated (notifications muted)`);
      } else if (totals.newly_added_total > 0) {
        toast.success(`Saved · notifying ${totals.newly_added_total} worker${totals.newly_added_total === 1 ? '' : 's'} by email + SMS`);
      } else {
        toast.success(`Saved · ${dirtyCount} template${dirtyCount === 1 ? '' : 's'} updated`);
      }
      setBulkIds(new Set());
      setConfirmOpen(false);
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  const save = async () => {
    if (!canEdit || dirtyCount === 0) return;
    // If any newly-added recipients would be notified, open the confirm
    // dialog. Otherwise persist directly.
    try {
      let total = 0;
      for (const [tid, v] of Object.entries(draft)) {
        const orig = templates.find((t) => t.id === tid)?.applies_to;
        // Cheap skip: if NOTHING changed for this template, don't preview.
        const same = (
          (orig?.worker_ids?.length || 0) === v.worker_ids.size
          && (orig?.roles?.length || 0) === v.roles.size
          && (orig?.companies?.length || 0) === v.companies.size
        );
        if (same) continue;
        const r = await api.post(`/form-templates/${tid}/preview-recipients`, appliesToPayload(v));
        total += (r.data?.newly_added_count || 0);
      }
      if (total > 0) {
        setRecipientPreview((p) => ({ ...p, totalForConfirm: total }));
        setConfirmOpen(true);
      } else {
        await persistSave(false);
      }
    } catch {
      // Fail open — still save without the preview.
      await persistSave(false);
    }
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
            data-testid="view-pane"><ListPaneIcon /> Two-pane</button>
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
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
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

                {/* Phase 3.9c — Workers (direct assignment) */}
                <section className="mt-6" data-testid="section-workers">
                  <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2 inline-flex items-center gap-1.5"><HardHat size={11} /> Applies to WORKERS (direct)</h3>
                  <div className="flex flex-wrap gap-1.5 mb-2" data-testid="worker-chips">
                    {Array.from(selDraft.worker_ids).length === 0 && (
                      <span className="text-[11px] text-slate-400 italic">No direct worker assignments.</span>
                    )}
                    {Array.from(selDraft.worker_ids).map((wid) => (
                      <button key={wid} type="button" onClick={() => toggleTarget('worker_ids', wid)}
                        data-testid={`chip-worker-${wid.slice(0, 8)}`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-semibold hover:bg-blue-100">
                        {wid.slice(0, 8)}… <X size={10} />
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="search" value={workerSearch} onChange={(e) => setWorkerSearch(e.target.value)}
                      placeholder="Search workers by name or email…"
                      data-testid="worker-search"
                      className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-slate-300 text-xs" />
                  </div>
                  {workerResults.length > 0 && (
                    <ul className="mt-1 rounded-lg border border-slate-200 max-h-44 overflow-y-auto" data-testid="worker-results">
                      {workerResults.map((w) => {
                        const on = selDraft.worker_ids.has(w.id);
                        return (
                          <li key={w.id}>
                            <button type="button" onClick={() => toggleTarget('worker_ids', w.id)}
                              data-testid={`worker-row-${w.id.slice(0, 8)}`}
                              className={`w-full text-left px-2.5 py-1.5 text-[12px] flex items-center gap-2 hover:bg-slate-50 ${on ? 'bg-emerald-50' : ''}`}>
                              {on ? <CheckSquare size={12} className="text-emerald-700" /> : <Square size={12} className="text-slate-300" />}
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-slate-900 truncate">{w.name}</div>
                                <div className="text-[10px] text-slate-500 truncate">{[w.trade, w.phone].filter(Boolean).join(' · ')}</div>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {/* Phase 3.9c — Roles */}
                <section className="mt-6" data-testid="section-roles">
                  <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2 inline-flex items-center gap-1.5"><Users size={11} /> Applies to ROLES</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(roleOptions.length ? roleOptions : ['admin','manager','hseq_lead','foreman','operator','driver','worker']).map((r) => (
                      <CheckChip key={r}
                        on={selDraft.roles.has(r)}
                        onClick={() => toggleTarget('roles', r)}
                        disabled={!canEdit}
                        label={r.replace(/_/g, ' ')}
                        testid={`chip-role-${r}`} />
                    ))}
                  </div>
                </section>

                {/* Phase 3.9c — Companies */}
                <section className="mt-6" data-testid="section-companies">
                  <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2 inline-flex items-center gap-1.5"><Building2 size={11} /> Applies to COMPANIES</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {companyOptions.length === 0 && (
                      <span className="text-[11px] text-slate-400 italic">No Simpro companies synced yet.</span>
                    )}
                    {companyOptions.map((c) => (
                      <CheckChip key={c.simpro_company_id}
                        on={selDraft.companies.has(c.simpro_company_id)}
                        onClick={() => toggleTarget('companies', c.simpro_company_id)}
                        disabled={!canEdit}
                        label={c.company_label}
                        hint={`#${c.simpro_company_id}`}
                        testid={`chip-company-${c.simpro_company_id}`} />
                    ))}
                  </div>
                </section>

                {/* Phase 3.9c — Live recipient counter */}
                {!multiOn && (
                  <section className="mt-5 px-3 py-2 rounded-lg bg-slate-100 text-[11px] text-slate-700 inline-flex items-center gap-2 flex-wrap"
                           data-testid="visible-counter">
                    <Users size={12} className="text-slate-500" />
                    Currently <b data-testid="visible-count">{recipientPreview.count}</b> workers would see this form
                    {recipientPreview.newlyAdded > 0 && (
                      <span className="text-blue-700 font-bold">· +{recipientPreview.newlyAdded} newly added</span>
                    )}
                  </section>
                )}

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

      {/* Phase 3.9c — Notification confirm dialog. Asks the admin whether to
          fire the email + SMS fanout for the workers who would be newly
          exposed by this save. Cancel saves silently (skip_notifications). */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4"
             onClick={(e) => e.target === e.currentTarget && setConfirmOpen(false)}
             data-testid="notify-confirm">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200">
            <div className="px-5 py-4 border-b">
              <h3 className="font-display font-bold text-slate-900">Notify newly-assigned workers?</h3>
              <p className="text-xs text-slate-500 mt-1">
                This save adds <b data-testid="notify-count">{recipientPreview.totalForConfirm || 0}</b> worker{(recipientPreview.totalForConfirm || 0) === 1 ? '' : 's'} to one or more templates.
              </p>
            </div>
            <div className="px-5 py-3 text-[12px] text-slate-700 space-y-1.5">
              <div>· Email to each worker (Microsoft 365 outbox)</div>
              <div>· SMS via TextMagic (where mobile is on file)</div>
              <div>· Deduped per worker + template for 24&nbsp;h</div>
            </div>
            <div className="px-5 py-3 border-t bg-slate-50 flex items-center gap-2 justify-end">
              <button onClick={() => persistSave(true)} disabled={saving}
                data-testid="notify-skip"
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                Save · skip notifications
              </button>
              <button onClick={() => persistSave(false)} disabled={saving}
                data-testid="notify-send"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Send />} Save &amp; notify
              </button>
            </div>
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
