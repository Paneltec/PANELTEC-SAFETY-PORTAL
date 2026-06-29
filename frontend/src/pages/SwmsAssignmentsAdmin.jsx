// Phase 4.1 — SWMS Assignments admin page.
//
// Two-pane layout:
//   LEFT  — scrollable SWMS list (active only by default; superseded chained
//           ancestors are hidden — admins can flip a toggle to see them).
//   RIGHT — editor for the selected SWMS: 4 multi-select chip groups
//           (roles / workers / companies / asset types) + Save.
//
// Bulk mode: check the bulk-mode toggle, tick rows in the LEFT pane, then
// the RIGHT pane switches to "Editing N SWMS — overwrite applies_to for all".
//
// When a SWMS has supersedes / superseded_by pointers, a small "View history"
// link surfaces a chain modal so admins can audit who superseded what.
import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Save, Search as SearchIcon, History, ChevronRight, X,
  CheckSquare, Square, AlertCircle, FileText, GitCompare,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader } from '../components/capture/Ui';
import SwmsDiffModal from '../components/swms/SwmsDiffModal';

const ROLE_CHOICES = [
  ['admin', 'Admin'],
  ['manager', 'Manager'],
  ['hseq_lead', 'HSEQ Lead'],
  ['supervisor', 'Supervisor'],
  ['auditor', 'Auditor'],
  ['worker', 'Worker'],
];

const ASSET_TYPE_CHOICES = [
  ['plant', 'Plant'],
  ['vehicle', 'Vehicle'],
  ['trailer', 'Trailer'],
  ['attachment', 'Attachment'],
  ['ppe', 'PPE'],
];

const EMPTY_APPLIES = { roles: [], worker_ids: [], company_ids: [], asset_types: [] };
const EDIT_ROLES = new Set(['admin', 'manager', 'hseq_lead']);

export default function SwmsAssignmentsAdmin() {
  const user = getUser();
  const canEdit = EDIT_ROLES.has(user?.role);
  const [swmsList, setSwmsList] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [workers, setWorkers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_APPLIES);
  const [saving, setSaving] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkPicked, setBulkPicked] = useState(new Set());
  const [historyFor, setHistoryFor] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [swmsR, assnR, wR, cR] = await Promise.all([
        api.get('/swms'),
        api.get('/swms/assignments'),
        api.get('/workers').catch(() => ({ data: [] })),
        api.get('/contractors').catch(() => ({ data: [] })),
      ]);
      setSwmsList(swmsR.data || []);
      setAssignments(assnR.data || {});
      setWorkers(wR.data || []);
      setCompanies(cR.data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // When user picks a SWMS, hydrate the draft from the current assignments map.
  useEffect(() => {
    if (!selectedId) { setDraft(EMPTY_APPLIES); return; }
    const a = assignments[selectedId] || EMPTY_APPLIES;
    setDraft({ ...EMPTY_APPLIES, ...a });
  }, [selectedId, assignments]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return swmsList.filter((r) => {
      if (!s) return true;
      return (r.title || '').toLowerCase().includes(s)
        || (r.code || '').toLowerCase().includes(s);
    });
  }, [swmsList, search]);

  const summary = (a) => {
    const r = a?.roles?.length || 0;
    const w = a?.worker_ids?.length || 0;
    const c = a?.company_ids?.length || 0;
    const t = a?.asset_types?.length || 0;
    if (!(r + w + c + t)) return 'No assignments';
    return `${r} role${r === 1 ? '' : 's'} · ${w} worker${w === 1 ? '' : 's'} · ${c} company${c === 1 ? '' : ''} · ${t} type${t === 1 ? '' : 's'}`;
  };

  const togglePicked = (id) => {
    setBulkPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleArray = (key, v) => {
    setDraft((d) => {
      const arr = d[key] || [];
      const next = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
      return { ...d, [key]: next };
    });
  };

  const saveSingle = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const r = await api.put(`/swms/assignments/${selectedId}`, { applies_to: draft });
      setAssignments((a) => ({ ...a, [selectedId]: r.data.applies_to }));
      toast.success('Assignments saved.');
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  const saveBulk = async () => {
    if (bulkPicked.size === 0) return;
    setSaving(true);
    try {
      const ids = Array.from(bulkPicked);
      const r = await api.put('/swms/assignments/bulk', { swms_ids: ids, applies_to: draft });
      const next = { ...assignments };
      ids.forEach((id) => { next[id] = r.data.applies_to; });
      setAssignments(next);
      toast.success(`${r.data.modified} SWMS updated.`);
      setBulkPicked(new Set());
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  if (!canEdit) {
    return (
      <div className="p-8" data-testid="swms-assignments-page">
        <PageHeader breadcrumb="Settings · SWMS Assignments" title="SWMS Assignments" />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 inline-flex items-start gap-3">
          <AlertCircle size={16} className="mt-0.5" />
          <div>This page is restricted to Admin, Manager and HSEQ Lead roles.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8" data-testid="swms-assignments-page">
      <PageHeader breadcrumb="Settings · SWMS Assignments" title="SWMS Assignments" />
      <p className="text-sm text-slate-600 -mt-2 mb-5 max-w-3xl">
        Decide which roles, workers, companies or asset types each SWMS applies
        to. Superseded versions are hidden from the active list — open &ldquo;View
        history&rdquo; on any SWMS to audit the full version chain.
      </p>

      {loading ? (
        <div className="text-sm text-slate-500"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5">
          {/* ── LEFT ── SWMS list ── */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="p-3 border-b border-slate-200 bg-slate-50/60 flex items-center gap-2">
              <div className="relative flex-1">
                <SearchIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search title or code"
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <label className="text-[11px] text-slate-700 inline-flex items-center gap-1.5 cursor-pointer select-none" data-testid="swms-bulk-mode-row">
                <input type="checkbox" checked={bulkMode} onChange={(e) => { setBulkMode(e.target.checked); setBulkPicked(new Set()); }}
                  data-testid="swms-bulk-mode" className="h-3.5 w-3.5" />
                Bulk
              </label>
            </div>
            <ul className="max-h-[560px] overflow-y-auto divide-y divide-slate-100">
              {filtered.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-slate-500">No active SWMS records.</li>
              )}
              {filtered.map((s) => {
                const a = assignments[s.id] || EMPTY_APPLIES;
                const isSel = selectedId === s.id;
                const isPicked = bulkPicked.has(s.id);
                return (
                  <li
                    key={s.id}
                    data-testid={`swms-list-row-${s.id}`}
                    onClick={() => bulkMode ? togglePicked(s.id) : setSelectedId(s.id)}
                    className={`px-3 py-2.5 cursor-pointer flex items-center gap-2 hover:bg-slate-50 ${isSel && !bulkMode ? 'bg-blue-50' : ''}`}>
                    {bulkMode && (isPicked ? <CheckSquare size={14} className="text-blue-600 shrink-0" /> : <Square size={14} className="text-slate-400 shrink-0" />)}
                    <FileText size={14} className="text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{s.title || '(untitled)'}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {s.code || '—'} · {s.version || 'v?'} · <span className="text-slate-400">{summary(a)}</span>
                      </div>
                    </div>
                    {(s.supersedes || s.superseded_by) && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setHistoryFor(s); }}
                        data-testid={`swms-history-link-${s.id}`}
                        title="View version history"
                        className="inline-flex items-center justify-center w-6 h-6 rounded text-violet-600 hover:bg-violet-50">
                        <History size={12} />
                      </button>
                    )}
                    {!bulkMode && <ChevronRight size={13} className="text-slate-300" />}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ── RIGHT ── Editor ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="swms-assignments-editor">
            {bulkMode ? (
              bulkPicked.size === 0 ? (
                <EmptyHint title="Pick SWMS rows to edit in bulk" body="Tick checkboxes on the left to choose which SWMS share the same applies_to." />
              ) : (
                <Editor
                  title={`Editing ${bulkPicked.size} SWMS in bulk`}
                  subtitle="Saving will overwrite applies_to for all selected records."
                  draft={draft}
                  workers={workers}
                  companies={companies}
                  toggleArray={toggleArray}
                  onSave={saveBulk}
                  saving={saving}
                  saveTestId="swms-bulk-save"
                />
              )
            ) : !selectedId ? (
              <EmptyHint title="Pick a SWMS from the left to edit its assignments." body="The middle column lets you scope by roles, named workers, companies and asset types." />
            ) : (
              <Editor
                title={(swmsList.find((s) => s.id === selectedId)?.title) || 'SWMS'}
                subtitle={`${swmsList.find((s) => s.id === selectedId)?.code || '—'} · ${swmsList.find((s) => s.id === selectedId)?.version || 'v?'}`}
                draft={draft}
                workers={workers}
                companies={companies}
                toggleArray={toggleArray}
                onSave={saveSingle}
                saving={saving}
                saveTestId="assign-save-btn"
              />
            )}
          </div>
        </div>
      )}

      {historyFor && (
        <HistoryModal swms={historyFor} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
}

function EmptyHint({ title, body }) {
  return (
    <div className="text-center py-12">
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      <div className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto">{body}</div>
    </div>
  );
}

function Editor({ title, subtitle, draft, workers, companies, toggleArray, onSave, saving, saveTestId }) {
  return (
    <>
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wider font-bold text-blue-700">Editing</div>
        <h2 className="font-display font-bold text-slate-900 mt-0.5">{title}</h2>
        <div className="text-xs text-slate-500">{subtitle}</div>
      </div>

      <ChipGroup label="Roles" data-testid="assign-roles"
        choices={ROLE_CHOICES} selected={draft.roles}
        onToggle={(v) => toggleArray('roles', v)} />

      <SearchableMulti
        label={`Workers (${draft.worker_ids.length} selected)`}
        items={workers.map((w) => ({ id: w.id, label: `${w.first_name || ''} ${w.last_name || ''}`.trim() || w.email || w.id }))}
        selected={draft.worker_ids}
        onToggle={(v) => toggleArray('worker_ids', v)}
        testid="assign-workers" />

      <SearchableMulti
        label={`Companies / Contractors (${draft.company_ids.length} selected)`}
        items={companies.map((c) => ({ id: c.id, label: c.name || c.legal_name || c.id }))}
        selected={draft.company_ids}
        onToggle={(v) => toggleArray('company_ids', v)}
        testid="assign-companies" />

      <ChipGroup label="Asset types" data-testid="assign-asset-types"
        choices={ASSET_TYPE_CHOICES} selected={draft.asset_types}
        onToggle={(v) => toggleArray('asset_types', v)} />

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
        <button type="button" onClick={onSave} disabled={saving}
          data-testid={saveTestId}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-60">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save assignments
        </button>
      </div>
    </>
  );
}

function ChipGroup({ label, choices, selected, onToggle, ...props }) {
  return (
    <div className="mb-4" {...props}>
      <div className="text-xs font-semibold text-slate-700 mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {choices.map(([v, l]) => {
          const isOn = selected.includes(v);
          return (
            <button
              key={v} type="button" onClick={() => onToggle(v)}
              data-testid={`chip-${v}`}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                isOn
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}>{l}</button>
          );
        })}
      </div>
    </div>
  );
}

function SearchableMulti({ label, items, selected, onToggle, testid }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items.slice(0, 50);
    return items.filter((i) => (i.label || '').toLowerCase().includes(s)).slice(0, 80);
  }, [items, q]);
  return (
    <div className="mb-4" data-testid={testid}>
      <div className="text-xs font-semibold text-slate-700 mb-1.5">{label}</div>
      <div className="relative mb-2">
        <SearchIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={`Filter ${items.length} options…`}
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
      </div>
      <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-slate-500">No matches.</div>
        )}
        {filtered.map((i) => {
          const isOn = selected.includes(i.id);
          return (
            <label key={i.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" checked={isOn} onChange={() => onToggle(i.id)} className="h-3.5 w-3.5" />
              <span className="text-xs text-slate-800 truncate">{i.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function HistoryModal({ swms, onClose }) {
  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [diffFor, setDiffFor] = useState(null); // { swmsId, previousId, currentLabel, previousLabel }

  useEffect(() => {
    let alive = true;
    api.get(`/swms/${swms.id}/history`)
      .then((r) => { if (alive) setChain(r.data.chain || []); })
      .catch((e) => toast.error(apiError(e)))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [swms.id]);

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div
      data-testid="swms-history-modal"
      className="fixed inset-0 z-50 bg-slate-900/70 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-200 bg-slate-50">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-violet-700">Version history</div>
            <div className="font-display font-bold text-slate-900 truncate">{swms.title}</div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-200"><X size={16} /></button>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="text-xs text-slate-500"><Loader2 size={12} className="inline animate-spin mr-1" /> Loading chain…</div>
          ) : !chain || chain.length === 0 ? (
            <div className="text-xs text-slate-500">No history available.</div>
          ) : (
            <ol className="space-y-2.5">
              {chain.map((c, i) => {
                const prevNode = i > 0 ? chain[i - 1] : null;
                return (
                  <li key={c.id} className="relative pl-6">
                    <span className={`absolute left-0 top-1 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${
                      c.status === 'superseded' ? 'bg-slate-300 text-slate-700' : 'bg-blue-600 text-white'
                    }`}>{i + 1}</span>
                    <div className="text-sm font-semibold text-slate-900 truncate">{c.title}</div>
                    <div className="text-[11px] text-slate-500">
                      {c.code || '—'} · {c.version || 'v?'} ·
                      <span className={`ml-1 inline-block text-[9px] uppercase font-bold tracking-wider rounded px-1.5 py-0.5 ${
                        c.status === 'superseded' ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>{c.status || '—'}</span>
                      {c.created_at && <> · {new Date(c.created_at).toLocaleDateString()}</>}
                    </div>
                    {prevNode && (
                      <button
                        type="button"
                        onClick={() => setDiffFor({
                          swmsId: c.id, previousId: prevNode.id,
                          currentLabel: c.version || 'v?',
                          previousLabel: prevNode.version || 'v?',
                        })}
                        data-testid={`swms-diff-link-${c.id}`}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:text-violet-900">
                        <GitCompare size={11} /> View diff vs previous
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
      {diffFor && (
        <SwmsDiffModal
          swmsId={diffFor.swmsId}
          previousId={diffFor.previousId}
          currentLabel={diffFor.currentLabel}
          previousLabel={diffFor.previousLabel}
          onClose={() => setDiffFor(null)}
        />
      )}
    </div>
  );
}
