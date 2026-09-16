/**
 * v58.13.132gl-b — Equipment Register page.
 * v58.13.132gs — Phase 1 extensions:
 *   · Editable Category CRUD (admin-only "Manage categories" modal).
 *   · Model Number field + column.
 *   · Multiple supporting documents per equipment (GridFS-backed),
 *     distinct from calibration certs.
 *
 * Admin-only surface at /app/equipment. Table view with:
 *   - Expiry-tinted rows (red = expired, amber = ≤30 days).
 *   - Row-level add cert / add document / edit / delete.
 *   - Top-bar Add Equipment + Manage Categories buttons.
 *
 * Backed by /api/equipment CRUD + /api/equipment/categories CRUD.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import useClipboardPaste from '@/lib/useClipboardPaste';
import { getUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Loader2, Plus, Pencil, Trash2, Upload, FileText, AlertTriangle,
  RefreshCw, Clipboard, Folder, Tag, X, Check,
} from 'lucide-react';

function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso.slice(0, 10) + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function rowTint(iso) {
  const d = daysUntil(iso);
  if (d === null || d === undefined) return '';
  if (d < 0) return 'bg-rose-50 border-rose-200';
  if (d <= 30) return 'bg-amber-50 border-amber-200';
  return '';
}

// Fallback list — kept for graceful degradation if the categories
// API errors out. In practice the backend auto-seeds these on first
// list call so the fallback is very rarely hit.
const FALLBACK_CATEGORIES = [
  'Gas monitor', 'Test gauge', 'Torque wrench', 'Pressure tester',
  'Multimeter', 'Insulation tester', 'Traffic-management sign', 'Other',
];

function ManageCategoriesModal({ categories, onClose, onChanged }) {
  const [items, setItems] = useState(categories);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/equipment/categories');
      setItems(r.data.items || []);
      onChanged?.(r.data.items || []);
    } catch (e) { toast.error(apiError(e)); }
  }, [onChanged]);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.post('/equipment/categories', { name });
      setNewName('');
      toast.success(`Added "${name}"`);
      await refresh();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setEditValue(cat.name);
  };

  const saveEdit = async (cat) => {
    const name = editValue.trim();
    if (!name || name === cat.name) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/equipment/categories/${cat.id}`, { name });
      toast.success(`Renamed to "${name}"`);
      setEditingId(null);
      await refresh();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const remove = async (cat) => {
    if (!window.confirm(
      `Remove category "${cat.name}"?\n\n` +
      'Existing equipment tagged with this category keeps the name ' +
      'but the category will no longer appear in the dropdown for new ' +
      'equipment.'
    )) return;
    setBusy(true);
    try {
      await api.delete(`/equipment/categories/${cat.id}`);
      toast.success(`Removed "${cat.name}"`);
      await refresh();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/60 flex items-center justify-center p-4"
         onClick={onClose} data-testid="equipment-categories-modal">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900 text-lg">Manage categories</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="New category name"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm"
            disabled={busy}
            data-testid="equipment-category-new-input"
          />
          <Button onClick={add} disabled={busy || !newName.trim()}
                  data-testid="equipment-category-add-btn">
            <Plus size={14} className="mr-1" /> Add
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
          {items.length === 0 && (
            <div className="p-4 text-sm text-slate-500 text-center">No categories yet.</div>
          )}
          {items.map((cat) => (
            <div key={cat.id} className="flex items-center gap-2 p-2"
                 data-testid={`equipment-category-row-${cat.id}`}>
              {editingId === cat.id ? (
                <>
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(cat)}
                    className="flex-1 px-2 py-1 rounded border border-slate-300 text-sm"
                    autoFocus
                    data-testid={`equipment-category-edit-input-${cat.id}`}
                  />
                  <Button size="sm" onClick={() => saveEdit(cat)} disabled={busy}
                          data-testid={`equipment-category-save-${cat.id}`}>
                    <Check size={12} />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)} disabled={busy}>
                    <X size={12} />
                  </Button>
                </>
              ) : (
                <>
                  <Tag size={12} className="text-slate-400 shrink-0" />
                  <span className="flex-1 text-sm text-slate-700">{cat.name}</span>
                  <button onClick={() => startEdit(cat)}
                          className="text-slate-400 hover:text-slate-700 p-1"
                          disabled={busy}
                          data-testid={`equipment-category-rename-${cat.id}`}
                          aria-label="Rename">
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => remove(cat)}
                          className="text-slate-400 hover:text-rose-600 p-1"
                          disabled={busy}
                          data-testid={`equipment-category-delete-${cat.id}`}
                          aria-label="Delete">
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>Done</Button>
        </div>
      </div>
    </div>
  );
}

function EquipmentModal({ initial, categories, onClose, onSaved, onCertsChanged }) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({
    name: initial?.name || '',
    category: initial?.category || (categories[0]?.name || 'Other'),
    model_number: initial?.model_number || '',
    serial_number: initial?.serial_number || '',
    last_calibration_date: initial?.last_calibration_date || '',
    expiry_date: initial?.expiry_date || '',
    notes: initial?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [pasteBusy, setPasteBusy] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const docInputRef = useRef(null);

  // Clipboard paste for cert files. Only enabled when editing.
  const uploadPasted = useCallback(async (files) => {
    if (!isEdit || !initial?.id) return;
    setPasteBusy(true);
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f, f.name);
        // eslint-disable-next-line no-await-in-loop
        await api.post(`/equipment/${initial.id}/certs`, fd,
          { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success(`Cert added from clipboard · ${f.name}`);
      }
      onCertsChanged?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally { setPasteBusy(false); }
  }, [isEdit, initial?.id, onCertsChanged]);

  useClipboardPaste(uploadPasted, isEdit, [initial?.id]);

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        category: form.category,
        model_number: form.model_number.trim() || null,
        serial_number: form.serial_number.trim() || null,
        last_calibration_date: form.last_calibration_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes.trim() || null,
      };
      if (isEdit) await api.patch(`/equipment/${initial.id}`, body);
      else await api.post('/equipment', body);
      toast.success(isEdit ? 'Equipment updated' : 'Equipment added');
      onSaved();
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const uploadDocument = async (file) => {
    if (!isEdit || !initial?.id || !file) return;
    setDocBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      await api.post(`/equipment/${initial.id}/documents`, fd,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Document added · ${file.name}`);
      onCertsChanged?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setDocBusy(false); }
  };

  const removeDocument = async (docId) => {
    if (!window.confirm('Remove this document?')) return;
    setDocBusy(true);
    try {
      await api.delete(`/equipment/${initial.id}/documents/${docId}`);
      toast.success('Document removed');
      onCertsChanged?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setDocBusy(false); }
  };

  const activeDocuments = (initial?.documents || []).filter((d) => !d.deleted_at);
  const dropdownCategories = useMemo(() => {
    // Ensure the current form.category is present even if the
    // category has been soft-deleted since the record was created —
    // snapshot semantics: existing rows keep their category string.
    const names = categories.map((c) => c.name);
    if (form.category && !names.includes(form.category)) {
      return [{ id: '__snapshot', name: form.category, snapshot: true }, ...categories];
    }
    return categories;
  }, [categories, form.category]);

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/60 flex items-center justify-center p-4" onClick={onClose} data-testid="equipment-modal">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-900 text-lg mb-4">{isEdit ? 'Edit equipment' : 'Add equipment'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs text-slate-600">
            <span className="block mb-1 font-medium">Name *</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" data-testid="equipment-name-input" />
          </label>
          <label className="text-xs text-slate-600">
            <span className="block mb-1 font-medium">Category</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" data-testid="equipment-category-input">
              {dropdownCategories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}{c.snapshot ? ' (removed)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            <span className="block mb-1 font-medium">Model number</span>
            <input value={form.model_number} onChange={(e) => setForm({ ...form, model_number: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" data-testid="equipment-model-input" />
          </label>
          <label className="text-xs text-slate-600">
            <span className="block mb-1 font-medium">Serial number</span>
            <input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" data-testid="equipment-serial-input" />
          </label>
          <label className="text-xs text-slate-600">
            <span className="block mb-1 font-medium">Last calibration</span>
            <input type="date" value={form.last_calibration_date} onChange={(e) => setForm({ ...form, last_calibration_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" data-testid="equipment-lastcal-input" />
          </label>
          <label className="text-xs text-slate-600">
            <span className="block mb-1 font-medium">Expiry date</span>
            <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" data-testid="equipment-expiry-input" />
          </label>
          <label className="col-span-2 text-xs text-slate-600">
            <span className="block mb-1 font-medium">Notes</span>
            <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" data-testid="equipment-notes-input" />
          </label>
        </div>

        {isEdit && (
          <div className="mt-5 border-t border-slate-200 pt-4" data-testid="equipment-documents-section">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                <Folder size={14} className="text-slate-500" />
                Supporting documents
                <span className="text-xs font-normal text-slate-400">
                  ({activeDocuments.length})
                </span>
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => docInputRef.current?.click()}
                disabled={docBusy}
                data-testid="equipment-doc-upload-btn"
              >
                {docBusy ? <Loader2 size={12} className="animate-spin mr-1" /> : <Upload size={12} className="mr-1" />}
                Add document
              </Button>
              <input
                ref={docInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) uploadDocument(f);
                }}
                data-testid="equipment-doc-file-input"
              />
            </div>
            {activeDocuments.length === 0 ? (
              <p className="text-xs text-slate-400 italic">
                No documents attached. Add spec sheets, manuals, or warranty PDFs here.
              </p>
            ) : (
              <ul className="space-y-1">
                {activeDocuments.map((d) => (
                  <li key={d.id}
                      className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-slate-50 border border-slate-200"
                      data-testid={`equipment-doc-row-${d.id}`}>
                    <FileText size={12} className="text-slate-500 shrink-0" />
                    <a
                      href={`/api/equipment/${initial.id}/documents/${d.id}`}
                      target="_blank" rel="noreferrer"
                      className="flex-1 truncate text-slate-700 hover:underline"
                      onClick={async (e) => {
                        e.preventDefault();
                        try {
                          const r = await api.get(`/equipment/${initial.id}/documents/${d.id}`,
                            { responseType: 'blob' });
                          const url = URL.createObjectURL(r.data);
                          window.open(url, '_blank');
                          setTimeout(() => URL.revokeObjectURL(url), 60_000);
                        } catch (err) { toast.error(apiError(err)); }
                      }}
                    >
                      {d.filename}
                    </a>
                    {d.label && <span className="text-slate-400">· {d.label}</span>}
                    <button
                      onClick={() => removeDocument(d.id)}
                      disabled={docBusy}
                      className="text-slate-400 hover:text-rose-600"
                      aria-label="Remove"
                      data-testid={`equipment-doc-delete-${d.id}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Clipboard paste hint (calibration certs). */}
        <div
          className={`mt-4 rounded-lg border border-dashed px-3 py-2.5 text-xs flex items-start gap-2 ${
            isEdit ? 'border-slate-300 bg-slate-50 text-slate-600' : 'border-slate-200 bg-slate-50/50 text-slate-400'
          }`}
          data-testid="equipment-paste-hint"
        >
          <Clipboard size={14} className="mt-0.5 shrink-0" />
          <div>
            {isEdit ? (
              <>
                <b>Paste (Ctrl/Cmd&nbsp;+&nbsp;V)</b> a screenshot or file here to attach it as a calibration cert.
                {pasteBusy && <span className="ml-2 inline-flex items-center gap-1 text-brand-blue"><Loader2 size={11} className="animate-spin" /> Uploading…</span>}
              </>
            ) : (
              <>Save this equipment first, then reopen to attach documents and calibration certs.</>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy} data-testid="equipment-save-btn">
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isEdit ? 'Save' : 'Add'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function EquipmentRegister() {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [summary, setSummary] = useState({ total: 0, expired: 0, expiring_30d: 0 });
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState(null);
  const [categoriesModal, setCategoriesModal] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const uploadInputRef = useRef(null);
  const uploadTarget = useRef(null);
  const currentUser = useMemo(() => getUser(), []);
  const isAdmin = currentUser?.role === 'admin';

  const loadCategories = useCallback(async () => {
    try {
      const r = await api.get('/equipment/categories');
      setCategories(r.data.items || []);
    } catch {
      // Fall back to hardcoded list so the modal isn't unusable.
      setCategories(FALLBACK_CATEGORIES.map((name, i) => ({ id: `fb-${i}`, name })));
    }
  }, []);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [list, sum] = await Promise.all([
        api.get('/equipment'),
        api.get('/equipment/summary'),
      ]);
      setState({ loading: false, items: list.data.items || [], error: null });
      setSummary(sum.data || { total: 0, expired: 0, expiring_30d: 0 });
    } catch (e) {
      setState({ loading: false, items: [], error: apiError(e) });
    }
  }, []);

  useEffect(() => { load(); loadCategories(); }, [load, loadCategories]);

  const removeRow = async (row) => {
    if (!window.confirm(`Remove "${row.name}"?`)) return;
    setBusyId(row.id);
    try {
      await api.delete(`/equipment/${row.id}`);
      toast.success('Equipment removed');
      load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusyId(null); }
  };

  const triggerUpload = (row) => {
    uploadTarget.current = row;
    uploadInputRef.current?.click();
  };

  const onFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const row = uploadTarget.current;
    uploadTarget.current = null;
    if (!file || !row) return;
    setBusyId(row.id);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      await api.post(`/equipment/${row.id}/certs`, fd,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Uploaded ${file.name}`);
      load();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusyId(null); }
  };

  const openCert = async (row, cert) => {
    try {
      const r = await api.get(`/equipment/${row.id}/certs/${cert.id}`,
        { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { toast.error(apiError(e)); }
  };

  // Refresh the modal's `initial` reference after documents/certs
  // mutate so newly-uploaded rows show up without closing.
  const refreshModalRow = useCallback(async () => {
    if (!modal?.id) { load(); return; }
    try {
      const r = await api.get(`/equipment/${modal.id}`);
      setModal(r.data);
      load();
    } catch { load(); }
  }, [modal?.id, load]);

  const rows = useMemo(() => state.items, [state.items]);

  return (
    <div className="p-6 space-y-6" data-testid="equipment-register-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Equipment Register</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Track calibrated equipment (gas monitors, test gauges, etc). Upload calibration certs, attach supporting documents, and monitor expiry dates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} disabled={state.loading} data-testid="equipment-refresh-btn">
            <RefreshCw className={`h-4 w-4 mr-2 ${state.loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {isAdmin && (
            <Button variant="outline" onClick={() => setCategoriesModal(true)} data-testid="equipment-manage-categories-btn">
              <Tag className="h-4 w-4 mr-2" /> Manage categories
            </Button>
          )}
          <Button onClick={() => setModal({})} data-testid="equipment-add-btn">
            <Plus className="h-4 w-4 mr-2" /> Add equipment
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="border-slate-200">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Total</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold" data-testid="equipment-total-count">{summary.total}</CardContent>
        </Card>
        <Card className={summary.expired > 0 ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Expired</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold text-rose-700" data-testid="equipment-expired-count">{summary.expired}</CardContent>
        </Card>
        <Card className={summary.expiring_30d > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Expiring ≤30 days</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold text-amber-700" data-testid="equipment-expiring-count">{summary.expiring_30d}</CardContent>
        </Card>
      </div>

      {state.error && (
        <Card className="border-rose-300 bg-rose-50">
          <CardContent className="p-4 text-sm text-rose-900">{state.error}</CardContent>
        </Card>
      )}

      {state.loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!state.loading && rows.length === 0 && (
        <Card className="border-dashed border-slate-300">
          <CardContent className="p-8 text-center text-sm text-slate-500">
            No equipment yet. Click <b>Add equipment</b> to register your first gas monitor or test gauge.
          </CardContent>
        </Card>
      )}

      {!state.loading && rows.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden" data-testid="equipment-table">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">Model</th>
                <th className="text-left px-3 py-2">Serial</th>
                <th className="text-left px-3 py-2">Last cal.</th>
                <th className="text-left px-3 py-2">Expiry</th>
                <th className="text-left px-3 py-2">Certs</th>
                <th className="text-left px-3 py-2">Docs</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tint = rowTint(r.expiry_date);
                const d = r.days_until_expiry;
                const activeCerts = (r.certs || []).filter((c) => !c.deleted_at);
                const activeDocs = (r.documents || []).filter((doc) => !doc.deleted_at);
                return (
                  <tr key={r.id} className={`border-t border-slate-100 ${tint}`} data-testid={`equipment-row-${r.id}`}>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-slate-600">{r.category}</td>
                    <td className="px-3 py-2 text-slate-600 font-mono text-xs" data-testid={`equipment-row-model-${r.id}`}>{r.model_number || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 font-mono text-xs">{r.serial_number || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.last_calibration_date || '—'}</td>
                    <td className="px-3 py-2">
                      {r.expiry_date ? (
                        <span className="inline-flex items-center gap-1">
                          {d !== null && d < 0 && <AlertTriangle size={12} className="text-rose-600" />}
                          {r.expiry_date}
                          {d !== null && (
                            <span className={`text-xs ${d < 0 ? 'text-rose-700' : d <= 30 ? 'text-amber-700' : 'text-slate-400'}`}>
                              {d < 0 ? `(${Math.abs(d)}d overdue)` : d <= 30 ? `(${d}d)` : ''}
                            </span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {activeCerts.length === 0 ? <span className="text-slate-400 text-xs">None</span> : (
                        <div className="flex flex-wrap gap-1">
                          {activeCerts.map((c) => (
                            <button key={c.id} type="button" onClick={() => openCert(r, c)}
                              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200"
                              data-testid={`equipment-cert-${c.id}`}>
                              <FileText size={11} /> {c.filename}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2" data-testid={`equipment-row-docs-${r.id}`}>
                      {activeDocs.length === 0 ? <span className="text-slate-400 text-xs">—</span> : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
                          <Folder size={11} /> {activeDocs.length}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button variant="outline" size="sm" onClick={() => triggerUpload(r)} disabled={busyId === r.id} data-testid={`equipment-upload-cert-${r.id}`}>
                          <Upload size={12} /> Cert
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setModal(r)} data-testid={`equipment-edit-${r.id}`}>
                          <Pencil size={12} />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => removeRow(r)} disabled={busyId === r.id} data-testid={`equipment-delete-${r.id}`}>
                          <Trash2 size={12} className="text-rose-600" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <EquipmentModal
          initial={modal.id ? modal : null}
          categories={categories}
          onClose={() => setModal(null)}
          onSaved={load}
          onCertsChanged={refreshModalRow}
        />
      )}
      {categoriesModal && (
        <ManageCategoriesModal
          categories={categories}
          onClose={() => setCategoriesModal(false)}
          onChanged={(items) => setCategories(items)}
        />
      )}
      <input ref={uploadInputRef} type="file" className="hidden" onChange={onFilePicked} data-testid="equipment-cert-file-input" />
    </div>
  );
}
