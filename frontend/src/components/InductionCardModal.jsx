// Phase 3.12 — Induction Card Popup (detail + document preview + edit + add).
//
// Two-pane modal opened from any induction card (worker edit modal grid)
// or any cell in the InductionsMatrix. LEFT pane = record detail / inline
// edit; RIGHT pane = cert document iframe (signed-token preview) or
// drop-zone when no doc is attached.
import { useEffect, useRef, useState } from 'react';
import {
  X, Loader2, Edit3, Trash2, Save, Upload, FileText, ExternalLink, Download,
  CalendarOff, Check, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getToken, getUser } from '../lib/auth';
import { stashInlinePdf } from '../lib/pdfStash';

const API_BASE = process.env.REACT_APP_BACKEND_URL + '/api';
const WRITE_ROLES = new Set(['admin', 'manager', 'hseq_lead']);

// Same chip palette as InductionsMatrix to stay visually consistent.
const STATUS = {
  current:        { label: 'Current',      cls: 'bg-[#d8ecdd] text-[#1f7a3f] border border-[#b6dcbf]' },
  expiring:       { label: 'Expiring 30d', cls: 'bg-[#fef3c7] text-[#92400e] border border-[#fcd34d]' },
  expiring_90:    { label: 'Expiring 90d', cls: 'bg-slate-100 text-slate-600 border border-slate-300' },
  expired:        { label: 'Expired',      cls: 'bg-[#fbe4e7] text-[#7a1f33] border border-[#e69aa3]' },
  not_held:       { label: 'Not held',     cls: 'bg-slate-100 text-slate-500 border border-slate-200' },
  held_no_expiry: { label: 'Held',         cls: 'bg-[#e6eff9] text-[#1e4a8c] border border-[#bcd2ee]' },
  invalid_date:   { label: 'Invalid date', cls: 'bg-[#fbe4e7] text-[#7a1f33] border border-[#e69aa3]' },
  unknown:        { label: '—',            cls: 'bg-slate-50 text-slate-400 border border-dashed border-slate-300' },
};

const TYPE_LABEL = {
  site_induction: 'Site induction',
  competency:     'Competency',
  license:        'Licence',
};

export default function InductionCardModal({
  workerId, workerName, inductionId, inductionNameHint,
  initialMode = 'view',  // 'view' | 'edit' | 'add'
  onClose, onSaved,
}) {
  const user = getUser();
  const canWrite = WRITE_ROLES.has(user?.role);
  const canDelete = user?.role === 'admin';
  // In add-mode there's no induction yet — go straight into editing.
  const [mode, setMode] = useState(initialMode === 'add' ? 'add' : initialMode);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(initialMode !== 'add');
  const [saving, setSaving] = useState(false);
  // Editable buffer (only used in edit/add modes).
  const [form, setForm] = useState({
    name: inductionNameHint || '',
    type: 'competency',
    issuer: '', issue_date: '', expiry_date: '',
    notes: '', not_held: false, held_no_expiry: false,
  });
  // Document preview state — iframe blob URL (mode 2 of PdfPreviewModal style).
  const [docSrc, setDocSrc] = useState(null);
  const [docErr, setDocErr] = useState(null);
  const fileInputRef = useRef(null);

  // Load existing induction in view/edit mode.
  useEffect(() => {
    if (mode === 'add') return;
    if (!inductionId) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.get(`/workers/${workerId}/inductions/${inductionId}`);
        if (!alive) return;
        setData(data);
        setForm({
          name: data.name || '',
          type: data.type || 'competency',
          issuer: data.issuer || '',
          issue_date: data.issue_date || '',
          expiry_date: data.expiry_date || '',
          notes: data.notes || '',
          not_held: !!data.not_held,
          held_no_expiry: !!data.held_no_expiry,
        });
      } catch (e) {
        if (alive) toast.error(apiError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [workerId, inductionId, mode]);

  // Fetch document preview when we have a doc_file_id (signed token blob).
  useEffect(() => {
    if (!data?.doc_file_id) { setDocSrc(null); setDocErr(null); return; }
    let alive = true;
    setDocErr(null);
    (async () => {
      try {
        const r = await api.post(`/files/${data.doc_file_id}/preview-token`);
        if (!alive) return;
        const t = r.data?.token;
        setDocSrc(`${API_BASE}/files/${data.doc_file_id}/pdf?t=${encodeURIComponent(t)}`);
      } catch (e) {
        if (alive) setDocErr(apiError(e));
      }
    })();
    return () => { alive = false; };
  }, [data?.doc_file_id]);

  // ESC closes.
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const statusMeta = STATUS[data?.status] || STATUS.unknown;

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        issuer: form.issuer || '',
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes || '',
        not_held: !!form.not_held,
        held_no_expiry: !!form.held_no_expiry,
      };
      if (mode === 'add') {
        if (!form.name.trim()) throw new Error('Name is required');
        const { data: created } = await api.post(`/workers/${workerId}/inductions`, {
          name: form.name.trim(),
          type: form.type,
          ...payload,
        });
        setData(created);
        setMode('view');
        toast.success('Induction added');
        onSaved?.(created);
      } else {
        const { data: updated } = await api.patch(
          `/workers/${workerId}/inductions/${inductionId}`,
          payload,
        );
        setData(updated);
        setMode('view');
        toast.success('Induction updated');
        onSaved?.(updated);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || 'Save failed');
    } finally { setSaving(false); }
  };

  const deleteInduction = async () => {
    if (!data?.id) return;
    if (!window.confirm(`Delete "${data.name}" for this worker? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await api.delete(`/workers/${workerId}/inductions/${data.id}`);
      toast.success('Induction deleted');
      onSaved?.(null);
      onClose?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally { setSaving(false); }
  };

  const onFileChosen = async (file) => {
    if (!file) return;
    const targetId = data?.id;
    if (!targetId) {
      toast.error('Save the induction first, then upload the document.');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/workers/${workerId}/inductions/${targetId}/file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setData(j.induction);
      toast.success('Document attached');
      onSaved?.(j.induction);
    } catch (e) {
      toast.error(e.message || 'Upload failed');
    } finally { setSaving(false); }
  };

  // Drag-drop handler for the doc pane.
  const onDrop = (e) => {
    e.preventDefault();
    if (!canWrite) return;
    const f = e.dataTransfer?.files?.[0];
    if (f) onFileChosen(f);
  };
  const onDragOver = (e) => { if (canWrite) e.preventDefault(); };

  const downloadDoc = async () => {
    if (!data?.doc_file_id) return;
    try {
      const r = await api.get(`/files/${data.doc_file_id}/pdf`, {
        params: { dl: 1 }, responseType: 'blob',
      });
      // v148 — stashInlinePdf → same-origin URL (ad-blocker-safe)
      const filename = (data.name || 'induction').replace(/[^a-zA-Z0-9_\-]+/g, '_') + '.pdf';
      const { src } = await stashInlinePdf(r.data, filename);
      const a = document.createElement('a');
      a.href = src;
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 grid place-items-center p-0 md:p-6"
         onClick={(e) => e.target === e.currentTarget && onClose?.()}
         data-testid={mode === 'add' ? 'induction-add-mode' : 'induction-card-modal'}
         data-modal="induction-card-modal"
         {...(mode === 'add' ? { 'data-mode': 'add' } : {})}>
      <div className="w-full h-full md:max-w-6xl md:h-[88vh] bg-white md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* HEADER */}
        <div className="flex items-start gap-3 px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">
              {workerName || 'Worker'}{data?.column_key ? ` · ${data.column_key}` : ''}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <h2 className="text-lg font-bold text-slate-900 truncate">
                {mode === 'add' ? (form.name || 'New induction') : (data?.name || '—')}
              </h2>
              {data && (
                <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                  {TYPE_LABEL[data.type] || data.type}
                </span>
              )}
              {data && (
                <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${statusMeta.cls}`}>
                  {data.not_held ? <CalendarOff size={9} className="mr-1" /> : null}
                  {data.held_no_expiry ? <Check size={9} className="mr-1" /> : null}
                  {statusMeta.label}
                </span>
              )}
            </div>
            {data?.issuer && (
              <div className="text-[11px] text-slate-500 mt-0.5">
                Issuer: <span className="text-slate-700">{data.issuer}</span>
                {data.expiry_date && <span className="ml-3">Expires: <span className="text-slate-700 font-mono">{data.expiry_date}</span></span>}
              </div>
            )}
          </div>
          {mode === 'view' && canWrite && (
            <button onClick={() => setMode('edit')} data-testid="induction-edit-btn"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Edit3 size={12} /> Edit
            </button>
          )}
          {mode === 'view' && canDelete && data?.id && (
            <button onClick={deleteInduction} disabled={saving}
              data-testid="induction-delete-btn"
              title="Delete induction"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 bg-white text-[#7a1f33] hover:bg-[#fbe4e7]">
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={onClose} title="Close (Esc)"
            data-testid="induction-modal-close"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-200">
            <X size={16} />
          </button>
        </div>

        {/* BODY — two pane */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* LEFT pane — details / edit */}
          <div className="md:w-1/2 border-b md:border-b-0 md:border-r border-slate-200 p-5 overflow-y-auto">
            {loading ? (
              <div className="inline-flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : mode === 'add' || mode === 'edit' ? (
              <DetailEditor form={form} setForm={setForm} mode={mode} />
            ) : (
              <DetailView data={data} />
            )}
          </div>

          {/* RIGHT pane — document */}
          <div className="md:w-1/2 bg-slate-100 relative flex flex-col"
               onDrop={onDrop} onDragOver={onDragOver}>
            <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center gap-2 text-[11px] text-slate-500">
              <FileText size={12} />
              <span className="flex-1 truncate">
                {data?.doc_file_id ? 'Certificate document' : 'No certificate uploaded'}
              </span>
              {data?.doc_file_id && (
                <>
                  <button onClick={() => window.open(docSrc, '_blank')} disabled={!docSrc}
                    data-testid="induction-doc-newtab"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">
                    <ExternalLink size={11} /> New tab
                  </button>
                  <button onClick={downloadDoc}
                    data-testid="induction-doc-download"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-slate-600 hover:bg-slate-100">
                    <Download size={11} /> Download
                  </button>
                </>
              )}
              {canWrite && data?.id && (
                <button onClick={() => fileInputRef.current?.click()}
                  data-testid="induction-doc-replace"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-[#1e4a8c] hover:bg-[#e6eff9]">
                  <Upload size={11} /> {data?.doc_file_id ? 'Replace' : 'Upload'}
                </button>
              )}
              <input ref={fileInputRef} type="file" hidden
                accept=".pdf,.png,.jpg,.jpeg,.heic,.heif,.webp"
                onChange={(e) => onFileChosen(e.target.files?.[0])} />
            </div>
            <div className="flex-1 relative">
              {data?.doc_file_id && docSrc && !docErr ? (
                <iframe data-testid="induction-doc-iframe"
                  title="Certificate document"
                  src={docSrc}
                  className="w-full h-full border-0" />
              ) : data?.doc_file_id && docErr ? (
                <div className="absolute inset-0 grid place-items-center px-6">
                  <div className="text-center max-w-sm">
                    <AlertTriangle size={20} className="text-amber-600 mx-auto mb-2" />
                    <div className="text-sm font-semibold text-slate-900">Couldn't load preview</div>
                    <div className="text-[12px] text-slate-600 mt-1">{docErr}</div>
                  </div>
                </div>
              ) : data?.doc_file_id ? (
                <div className="absolute inset-0 grid place-items-center">
                  <Loader2 size={20} className="text-slate-400 animate-spin" />
                </div>
              ) : (
                <div className="absolute inset-0 grid place-items-center px-6"
                     data-testid="induction-doc-dropzone">
                  <div className="text-center max-w-sm">
                    <FileText size={28} className="text-slate-300 mx-auto mb-2" />
                    <div className="text-sm font-semibold text-slate-700">No certificate uploaded</div>
                    <p className="text-[12px] text-slate-500 mt-1">
                      {canWrite && data?.id
                        ? 'Drop a PDF or image here, or click Upload above.'
                        : canWrite
                          ? 'Save the induction first, then upload the document.'
                          : 'A certificate document has not been attached.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          {(mode === 'edit' || mode === 'add') && (
            <button onClick={() => {
                if (mode === 'add') onClose?.();
                else setMode('view');
              }}
              data-testid="induction-cancel-btn"
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100">
              Cancel
            </button>
          )}
          {(mode === 'edit' || mode === 'add') ? (
            <button onClick={save} disabled={saving}
              data-testid="induction-save-btn"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {mode === 'add' ? 'Add induction' : 'Save changes'}
            </button>
          ) : (
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold uppercase tracking-wider hover:bg-slate-800">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────── helpers ───────────

function DetailView({ data }) {
  if (!data) return <div className="text-sm text-slate-500">No record.</div>;
  return (
    <div className="space-y-3 text-sm" data-testid="induction-detail-view">
      <Row label="Name"        value={data.name} />
      <Row label="Type"        value={TYPE_LABEL[data.type] || data.type} />
      <Row label="Status"      value={STATUS[data.status]?.label || data.status} />
      <Row label="Issuer"      value={data.issuer || '—'} />
      <Row label="Issue date"  value={data.issue_date || '—'} mono />
      <Row label="Expiry date" value={data.expiry_date || '—'} mono />
      <Row label="Updated"     value={data.updated_at ? data.updated_at.slice(0, 10) : '—'} mono />
      {data.notes && (
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Notes</div>
          <div className="text-sm text-slate-700 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            {data.notes}
          </div>
        </div>
      )}
      {data.import_confidence === 'low' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[11px] text-amber-800 flex items-start gap-2">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          This record was flagged during import as low-confidence. Please verify the dates.
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="grid grid-cols-3 gap-3 items-baseline">
      <div className="col-span-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
      <div className={`col-span-2 text-slate-800 ${mono ? 'font-mono text-[13px]' : ''}`}>{value || '—'}</div>
    </div>
  );
}

function DetailEditor({ form, setForm, mode }) {
  const set = (k, v) => setForm({ ...form, [k]: v });
  return (
    <div className="space-y-4 text-sm" data-testid="induction-detail-editor">
      {mode === 'add' && (
        <>
          <Field label="Name" required>
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              data-testid="induction-field-name"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e4a8c]/30" />
          </Field>
          <Field label="Type">
            <select value={form.type} onChange={(e) => set('type', e.target.value)}
              data-testid="induction-field-type"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1e4a8c]/30">
              <option value="competency">Competency</option>
              <option value="site_induction">Site induction</option>
              <option value="license">Licence</option>
            </select>
          </Field>
        </>
      )}
      <Field label="Issuer">
        <input value={form.issuer} onChange={(e) => set('issuer', e.target.value)}
          data-testid="induction-field-issuer"
          placeholder="e.g. TasTAFE, RTO 12345"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e4a8c]/30" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Issue date">
          <input type="date" value={form.issue_date || ''} onChange={(e) => set('issue_date', e.target.value)}
            data-testid="induction-field-issue"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e4a8c]/30" />
        </Field>
        <Field label="Expiry date">
          <input type="date" value={form.expiry_date || ''} onChange={(e) => set('expiry_date', e.target.value)}
            data-testid="induction-field-expiry"
            disabled={form.not_held}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e4a8c]/30 disabled:bg-slate-100" />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.not_held}
            data-testid="induction-field-notheld"
            onChange={(e) => setForm({ ...form, not_held: e.target.checked, ...(e.target.checked ? { expiry_date: '', held_no_expiry: false } : {}) })}
            className="w-4 h-4" />
          <span className="text-sm text-slate-700 flex items-center gap-1.5">
            <CalendarOff size={12} className="text-slate-400" /> Not held
          </span>
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.held_no_expiry}
            data-testid="induction-field-held"
            onChange={(e) => setForm({ ...form, held_no_expiry: e.target.checked, ...(e.target.checked ? { not_held: false } : {}) })}
            className="w-4 h-4" />
          <span className="text-sm text-slate-700 flex items-center gap-1.5">
            <Check size={12} className="text-emerald-500" /> Held (no expiry on file)
          </span>
        </label>
      </div>
      <Field label="Notes">
        <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
          data-testid="induction-field-notes"
          rows={3}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e4a8c]/30" />
      </Field>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
        {label} {required && <span className="text-[#7a1f33]">*</span>}
      </div>
      {children}
    </label>
  );
}
