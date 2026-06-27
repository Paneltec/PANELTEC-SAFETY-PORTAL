// Forms Library — Phase 1.
// Templates list + import JSON + fill-out runner. Photo/signature/gps render
// as Phase-2 placeholders; submissions store null for those.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, ClipboardList, Download, Edit3, FileText, Loader2, MapPin,
  Pencil, Plus, Search, Trash2, Upload, UploadCloud, X, FilePlus,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader } from '../components/capture/Ui';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

const CATEGORIES = [
  { key: 'all',        label: 'All',        cls: 'bg-slate-100 text-slate-700' },
  { key: 'incident',   label: 'Incident',   cls: 'bg-[#f7d8dc] text-[#a8324c]' },
  { key: 'inspection', label: 'Inspection', cls: 'bg-[#ece6f4] text-[#4f3a8c]' },
  { key: 'toolbox',    label: 'Toolbox',    cls: 'bg-[#f7eed1] text-[#8c6a1a]' },
  { key: 'near_miss',  label: 'Near Miss',  cls: 'bg-[#f8d7c3] text-[#9c4f1a]' },
  { key: 'general',    label: 'General',    cls: 'bg-slate-100 text-slate-700' },
];
const CAT_CHIP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.cls]));

function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || 'General';
}

function FieldRunner({ field, value, onChange }) {
  const phType = { photo: 'Photo capture', signature: 'Signature', gps: 'GPS capture' }[field.type];
  if (phType) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500"
        data-testid={`field-placeholder-${field.id}`}>
        {field.type === 'photo' && <Camera size={16} className="mx-auto mb-1 text-slate-400" />}
        {field.type === 'signature' && <Pencil size={16} className="mx-auto mb-1 text-slate-400" />}
        {field.type === 'gps' && <MapPin size={16} className="mx-auto mb-1 text-slate-400" />}
        {phType} — coming in Phase 2
      </div>
    );
  }
  if (field.type === 'textarea') {
    return <textarea rows={4} value={value || ''} placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)}
      data-testid={`field-${field.id}`}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />;
  }
  if (field.type === 'select') {
    return (
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}
        data-testid={`field-${field.id}`}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
        <option value="">— Select —</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.type === 'radio') {
    return (
      <div className="space-y-1.5" data-testid={`field-${field.id}`}>
        {(field.options || []).map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name={field.id} value={o} checked={value === o}
              onChange={(e) => onChange(e.target.value)}
              className="w-4 h-4 text-[#1e4a8c]" />
            <span>{o}</span>
          </label>
        ))}
      </div>
    );
  }
  if (field.type === 'date') {
    return <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)}
      data-testid={`field-${field.id}`}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />;
  }
  if (field.type === 'number') {
    return <input type="number" value={value ?? ''} placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)}
      data-testid={`field-${field.id}`}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />;
  }
  return <input type="text" value={value || ''} placeholder={field.placeholder}
    onChange={(e) => onChange(e.target.value)}
    data-testid={`field-${field.id}`}
    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />;
}

function FillOutModal({ template, onClose }) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const requiredOk = (template.fields || [])
    .filter((f) => f.required && !['photo', 'signature', 'gps'].includes(f.type))
    .every((f) => values[f.id] && String(values[f.id]).trim());

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        fields: (template.fields || []).map((f) => ({
          id: f.id, label: f.label, type: f.type, value: values[f.id] ?? null,
        })),
      };
      await api.post(`/forms/templates/${template.id}/submissions`, payload);
      toast.success('Form submitted');
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="form-fillout-modal">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 bg-[#e6eff9] flex items-start gap-3">
          <div className="rounded-xl bg-[#d8e6f4] p-2.5"><FileText size={18} className="text-[#1e4a8c]" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#1e4a8c]">Fill out</div>
            <h2 className="font-display text-lg font-semibold text-slate-900">{template.name}</h2>
            {template.description && <p className="text-xs text-slate-600/80 mt-1 line-clamp-2">{template.description}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-200"><X size={14} /></button>
        </div>
        <div className="px-6 py-5 overflow-y-auto space-y-4 flex-1">
          {(template.fields || []).length === 0 ? (
            <div className="text-sm text-slate-500 italic">This template has no fields yet.</div>
          ) : (template.fields || []).map((f) => (
            <div key={f.id} data-testid={`field-row-${f.id}`}>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {f.label}
                {f.required && <span className="text-[#a8324c] ml-1">*</span>}
                <span className="ml-2 text-[10px] uppercase tracking-wider font-medium text-slate-400">{f.type}</span>
              </label>
              <FieldRunner field={f} value={values[f.id]} onChange={(v) => setValues({ ...values, [f.id]: v })} />
            </div>
          ))}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={submit} disabled={saving || !requiredOk} data-testid="form-submit-btn"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Submit
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailDrawer({ template, onClose, onChanged, canEdit, onFill }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="form-detail-drawer">
      <div className="w-full max-w-xl bg-white shadow-xl border-l border-slate-200 h-full flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3 bg-[#e6eff9]">
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${CAT_CHIP[template.category] || CAT_CHIP.general}`}>
            {categoryLabel(template.category)}
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg font-semibold text-slate-900 truncate">{template.name}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-200"><X size={14} /></button>
        </div>
        <div className="px-6 py-5 overflow-y-auto space-y-4 flex-1">
          {template.description && (
            <p className="text-sm text-slate-700 leading-relaxed">{template.description}</p>
          )}
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">Fields ({(template.fields || []).length})</div>
          <div className="space-y-2">
            {(template.fields || []).map((f) => (
              <div key={f.id} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`detail-field-${f.id}`}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{f.type}</span>
                  <span className="text-sm font-semibold text-slate-900">{f.label}</span>
                  {f.required && <span className="text-[10px] text-[#a8324c] font-semibold">required</span>}
                </div>
                {f.placeholder && <div className="text-xs text-slate-500 mt-1">Placeholder: {f.placeholder}</div>}
                {(f.options || []).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {f.options.map((o) => (
                      <span key={o} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-700 border border-slate-200">{o}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onFill} data-testid="open-fillout-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#143263]">
            <FilePlus size={14} /> Fill out this form
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ onClose, onImported }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const doImport = async () => {
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { toast.error('Invalid JSON'); return; }
    if (!parsed || !Array.isArray(parsed.templates)) {
      toast.error('JSON must include a "templates" array');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/forms/templates/import', parsed);
      const skippedN = (data.skipped || []).length;
      toast.success(`Imported ${data.created} template${data.created === 1 ? '' : 's'}${skippedN ? ` · skipped ${skippedN}` : ''}`);
      onImported();
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="forms-import-modal">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-6 py-4 border-b border-slate-200 bg-[#e6eff9]">
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#1e4a8c]">Import</div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Import form templates</h2>
          <p className="text-xs text-slate-600/80 mt-1">Paste a JSON payload or upload a .json file. Existing templates with the same name are skipped.</p>
        </div>
        <div className="px-6 py-4 space-y-3 flex-1 overflow-y-auto">
          <button onClick={() => fileRef.current?.click()} data-testid="import-file-btn"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            <UploadCloud size={12} /> Upload .json file
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          <textarea value={text} onChange={(e) => setText(e.target.value)}
            placeholder='{"templates":[{"name":"...","category":"...","fields":[...]}]}'
            data-testid="import-textarea"
            className="w-full h-64 px-3 py-2 border border-slate-300 rounded-lg font-mono text-xs" />
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={doImport} disabled={busy || !text.trim()} data-testid="import-confirm"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Import
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Forms() {
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [openDetail, setOpenDetail] = useState(null);
  const [fillTemplate, setFillTemplate] = useState(null);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/forms/templates');
      setRows(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = { all: rows.length, incident: 0, inspection: 0, toolbox: 0, near_miss: 0, general: 0 };
    for (const r of rows) if (c[r.category] !== undefined) c[r.category]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => filter === 'all' ? true : r.category === filter)
      .filter((r) => !q || `${r.name} ${r.description || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rows, filter, search]);

  const removeTemplate = async (t) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    try {
      await api.delete(`/forms/templates/${t.id}`);
      toast.success(`${t.name} deleted`);
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const exportAll = () => {
    const payload = {
      app: 'Paneltec Civil',
      exported_at: new Date().toISOString(),
      version: 1,
      count: rows.length,
      templates: rows.map((r) => ({
        name: r.name, category: r.category, description: r.description,
        fields: r.fields,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `forms-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="forms-page">
      <PageHeader crumb="Compliance / Forms" title="Forms Library"
        subtitle="Inspection, incident, toolbox and permit templates — fillable from the office or the field." />

      <div className="mb-5 rounded-2xl border border-[#b9d2ec] bg-[#eff5fc] px-4 py-3 flex items-center gap-3">
        <div className="rounded-xl bg-[#d8e6f4] p-2.5"><ClipboardList size={20} className="text-[#1e4a8c]" /></div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-[#1e3a6b]">Bring your existing forms</div>
          <div className="text-xs text-[#1e4a8c]/80 mt-0.5">Import JSON exported from another safety app, or build from scratch. Field types supported now: text, textarea, date, number, select, radio. Photo / signature / GPS arrive in Phase 2.</div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c.key} onClick={() => setFilter(c.key)} data-testid={`filter-${c.key}`}
              className={`text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full transition ${
                filter === c.key ? `${c.cls} ring-2 ring-offset-1 ring-[#1e4a8c]/30` : `${c.cls} opacity-70 hover:opacity-100`
              }`}>
              {c.label} <span className="ml-1 opacity-70">{counts[c.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            data-testid="forms-search" placeholder="Search by name…"
            className="pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg bg-white w-64" />
        </div>
        <button onClick={exportAll} disabled={rows.length === 0} data-testid="export-forms-btn"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download size={14} /> Export
        </button>
        {canEdit && (
          <button onClick={() => setImporting(true)} data-testid="import-forms-btn"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#e6eff9] text-[#1e4a8c] text-sm font-medium hover:bg-[#d8e6f4]">
            <Upload size={14} /> Import
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center" data-testid="forms-empty">
          <FileText size={28} className="mx-auto text-slate-300 mb-2" />
          <div className="text-sm font-medium text-slate-700">No templates yet</div>
          <div className="text-xs text-slate-500 mt-1">Import your existing JSON or build a new template from scratch.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="forms-grid">
          {filtered.map((t) => (
            <div key={t.id} className="group rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-blue/40 hover:shadow-card transition-all"
              data-testid={`template-card-${t.id}`}>
              <div className="flex items-start gap-2 mb-2">
                <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${CAT_CHIP[t.category] || CAT_CHIP.general}`}>
                  {categoryLabel(t.category)}
                </span>
                {t.source === 'imported' && (
                  <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">imported</span>
                )}
                <div className="flex-1" />
                {canEdit && (
                  <button onClick={(e) => { e.stopPropagation(); removeTemplate(t); }}
                    data-testid={`delete-${t.id}`}
                    className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-6 h-6 rounded bg-[#fbe4e7] text-[#7a1f33] hover:bg-[#f4c7cd]">
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
              <button onClick={() => setOpenDetail(t)} className="block w-full text-left">
                <h3 className="font-display text-base font-semibold text-slate-900 leading-snug">{t.name}</h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed line-clamp-2">{t.description || '—'}</p>
                <div className="mt-2 text-[11px] text-slate-500">{(t.fields || []).length} fields</div>
              </button>
              <button onClick={() => setFillTemplate(t)} data-testid={`fillout-${t.id}`}
                className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#e6eff9] text-[#1e4a8c] text-xs font-semibold uppercase tracking-wider hover:bg-[#d8e6f4]">
                <FilePlus size={12} /> Fill out
              </button>
            </div>
          ))}
        </div>
      )}

      {importing && <ImportModal onClose={() => setImporting(false)} onImported={load} />}
      {openDetail && (
        <DetailDrawer template={openDetail} onClose={() => setOpenDetail(null)}
          onChanged={load} canEdit={canEdit}
          onFill={() => { setFillTemplate(openDetail); setOpenDetail(null); }} />
      )}
      {fillTemplate && <FillOutModal template={fillTemplate} onClose={() => setFillTemplate(null)} />}
    </div>
  );
}
