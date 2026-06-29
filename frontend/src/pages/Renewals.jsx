import React, { useEffect, useMemo, useState } from 'react';
import { HelpCircle, Loader2, Settings, X } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { PageHeader, PrimaryButton, GhostButton, Field, inputClass, EmptyState, StatusBadge } from '../components/capture/Ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import EmailButton from '../components/EmailButton';
import DeleteRecordButton from '../components/DeleteRecordButton';
import { getUser } from '../lib/auth';
import SimproSupplierImportModal from '../components/SimproSupplierImportModal';

// Phase 3.20 Wave 2 — lucide row-action/toolbar icons swapped
// to @fluentui/react-icons. Aliased back to the original lucide
// names so existing JSX call sites don't need to change.
import {
  Add20Regular as Plus,
  ArrowDownload20Regular as Download,
  Copy20Regular as Copy,
  Delete20Regular as Trash2,
  Edit20Regular as Pencil,
} from '@fluentui/react-icons';

const WRITE_ROLES = new Set(['admin', 'hseq_lead', 'manager']);
const IMPORT_ROLES = new Set(['admin', 'manager']);

export default function Renewals() {
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);
  const canImport = IMPORT_ROLES.has(user?.role);
  const [items, setItems] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contractor_id: '', doc_types_requested: [], expires_in_days: 14, subject: '', message: '' });
  const [created, setCreated] = useState(null);
  const [editing, setEditing] = useState(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const typeLabel = useMemo(() => Object.fromEntries(docTypes.map((t) => [t.slug, t.label])), [docTypes]);

  const load = () => api.get('/renewals').then((r) => setItems(r.data));
  const loadDocTypes = () => api.get('/renewals/doc-types').then((r) => setDocTypes(r.data || []));
  useEffect(() => {
    load();
    api.get('/contractors').then((r) => setContractors(r.data));
    loadDocTypes();
  }, []);

  const toggleType = (slug) => setForm((f) => ({
    ...f,
    doc_types_requested: f.doc_types_requested.includes(slug)
      ? f.doc_types_requested.filter((x) => x !== slug)
      : [...f.doc_types_requested, slug],
  }));

  const createLink = async () => {
    if (!form.contractor_id || form.doc_types_requested.length === 0) { toast.error('Pick contractor + at least one doc type'); return; }
    try { const { data } = await api.post('/renewals', form); setCreated(data); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  const revoke = async (id) => {
    if (!window.confirm('Revoke this link?')) return;
    try { await api.post(`/renewals/${id}/revoke`); toast.success('Revoked'); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="renewals-list">
      <PageHeader crumb="Compliance / Renewal Links" title="Renewal Links"
        subtitle="Single-use links contractors can use to upload renewed documents without a login."
        action={canEdit && (
          <div className="flex items-center gap-2">
            {canImport && (
              <button onClick={() => setImportOpen(true)} data-testid="import-from-simpro-btn"
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Download /> Import from Simpro
              </button>
            )}
            <button onClick={() => setManageOpen(true)} data-testid="renewals-manage-doc-types-btn"
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Settings size={14} /> Manage doc types
            </button>
            <button onClick={() => { setOpen(true); setCreated(null); setForm({ contractor_id: '', doc_types_requested: [], expires_in_days: 14, subject: '', message: '' }); }}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600" data-testid="renewal-create-btn">
              + Create renewal link
            </button>
          </div>
        )} />

      {items.length === 0 ? <EmptyState title="No renewal links yet" body="Create a link and send it to a contractor." />
       : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider"><tr><th className="text-left px-4 py-3">Contractor</th><th className="text-left px-4 py-3">Subject / Docs</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Expires</th><th className="text-left px-4 py-3"></th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t border-slate-100" data-testid={`renewal-row-${r.id}`}>
                  <td className="px-4 py-3 font-medium">{r.contractor_name}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">
                    {r.subject && <div className="font-semibold text-slate-700 mb-0.5">{r.subject}</div>}
                    <div className="flex flex-wrap gap-1">
                      {(r.doc_types_requested || []).map((slug) => {
                        const known = !!typeLabel[slug];
                        return (
                          <span key={slug}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${known ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}
                            title={known ? '' : 'Type no longer exists in this org — legacy data.'}>
                            {!known && <HelpCircle size={9} />}
                            {typeLabel[slug] || slug}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge value={r.status} /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{(r.expires_at || '').slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1 items-center">
                      {r.status === 'pending' && (
                        <>
                          <EmailButton
                            resourceKind="renewals"
                            recordId={r.id}
                            subject={r.subject || `Document Renewal Request — Paneltec Civil`}
                            body={r.message || `Hi ${r.contractor_name},\n\nPlease re-submit the following document(s) via the secure link below:\n${(r.doc_types_requested || []).map((t) => typeLabel[t] || t).join(', ')}\n\nThe link expires on ${(r.expires_at || '').slice(0, 10)}.\n\nThanks,\nPaneltec Civil`}
                            recipients={r.contractor_email ? [r.contractor_email] : []}
                            variant="primary" size="sm" label="Email link"
                          />
                          <button onClick={() => { navigator.clipboard.writeText(r.public_url); toast.success('Link copied'); }} className="px-2 py-1 text-xs rounded border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1"><Copy /> Copy</button>
                        </>
                      )}
                      {canEdit && r.status !== 'used' && (
                        <button onClick={() => setEditing({ ...r, expires_date: (r.expires_at || '').slice(0, 10) })}
                          data-testid={`renewal-edit-${r.id}`} title="Edit renewal link"
                          className="p-1.5 rounded text-[#1e4a8c] bg-[#e6eff9] hover:bg-[#d8e6f4]">
                          <Pencil />
                        </button>
                      )}
                      {canEdit && r.status === 'pending' && (
                        <button onClick={() => revoke(r.id)} className="px-2 py-1 text-xs rounded border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-1" data-testid={`revoke-${r.id}`}><X size={12} /> Revoke</button>
                      )}
                      {canEdit && (
                        <DeleteRecordButton resourceKind="renewals" apiPath="renewals" recordId={r.id} label="Renewal link" recordTitle={r.contractor_name} onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
       )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="renewal-create-modal">
          <DialogHeader>
            <DialogTitle className="font-display">Create renewal link</DialogTitle>
            <DialogDescription>Email delivery via TextMagic/M365 is pending — copy the link for now.</DialogDescription>
          </DialogHeader>
          {!created ? (
            <div className="space-y-3 pt-2">
              <Field label="Contractor" required>
                <select className={inputClass} value={form.contractor_id} onChange={(e) => setForm({ ...form, contractor_id: e.target.value })} data-testid="renewal-contractor">
                  <option value="">Select…</option>
                  {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Subject / title">
                <input type="text" className={inputClass} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Annual COI renewal" data-testid="renewal-subject" />
              </Field>
              <Field label="Documents requested" required>
                <div className="grid grid-cols-2 gap-1 mt-1" data-testid="renewal-doctype-checkboxes">
                  {docTypes.filter((t) => t.active).map((t) => (
                    <label key={t.slug} className="flex items-center gap-2 text-sm" title={t.description || ''}>
                      <input type="checkbox" checked={form.doc_types_requested.includes(t.slug)} onChange={() => toggleType(t.slug)} data-testid={`renewal-doc-${t.slug}`} /> {t.label}
                    </label>
                  ))}
                </div>
                {docTypes.length === 0 && <p className="text-xs text-slate-500 mt-1">No document types configured. Open <strong>Manage doc types</strong> to add some.</p>}
              </Field>
              <Field label="Custom message">
                <textarea rows={3} className={inputClass} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Optional — overrides the default email body" data-testid="renewal-message" />
              </Field>
              <Field label="Expires in (days)"><input type="number" min={1} max={90} className={inputClass} value={form.expires_in_days} onChange={(e) => setForm({ ...form, expires_in_days: Number(e.target.value) })} /></Field>
            </div>
          ) : (
            <div className="space-y-2 pt-2">
              <div className="text-xs text-slate-500">Public link (single-use, expires {created.expires_at?.slice(0, 10)}):</div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs break-all" data-testid="generated-public-url">{created.public_url}</div>
              <button onClick={() => { navigator.clipboard.writeText(created.public_url); toast.success('Link copied'); }} className="text-xs text-brand-blue hover:underline">Copy link</button>
            </div>
          )}
          <DialogFooter>
            {!created
              ? (<><GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton><PrimaryButton onClick={createLink} testid="renewal-submit">Create link</PrimaryButton></>)
              : <PrimaryButton onClick={() => setOpen(false)}>Done</PrimaryButton>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditRenewalDialog open={!!editing} record={editing} contractors={contractors} docTypes={docTypes}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />

      <ManageDocTypesDialog open={manageOpen} onClose={() => setManageOpen(false)}
        docTypes={docTypes} onChanged={loadDocTypes} />

      {importOpen && (
        <SimproSupplierImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => {
            api.get('/contractors').then((r) => setContractors(r.data));
          }} />
      )}
    </div>
  );
}

function EditRenewalDialog({ open, record, contractors, docTypes, onClose, onSaved }) {
  const [form, setForm] = useState({ contractor_id: '', doc_types_requested: [], subject: '', message: '', expires_date: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!record) return;
    setForm({
      contractor_id: record.contractor_id || '',
      doc_types_requested: [...(record.doc_types_requested || [])],
      subject: record.subject || '',
      message: record.message || '',
      expires_date: record.expires_date || (record.expires_at || '').slice(0, 10),
    });
  }, [record]);

  const toggleType = (t) => setForm((f) => ({ ...f, doc_types_requested: f.doc_types_requested.includes(t) ? f.doc_types_requested.filter((x) => x !== t) : [...f.doc_types_requested, t] }));

  const save = async () => {
    if (!form.contractor_id || form.doc_types_requested.length === 0) { toast.error('Pick contractor + at least one doc type'); return; }
    setSaving(true);
    try {
      const expires_at = form.expires_date ? `${form.expires_date}T23:59:59Z` : undefined;
      await api.patch(`/renewals/${record.id}`, {
        contractor_id: form.contractor_id,
        doc_types_requested: form.doc_types_requested,
        subject: form.subject,
        message: form.message,
        ...(expires_at ? { expires_at } : {}),
      });
      toast.success('Renewal link updated');
      onSaved?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  const activeSlugs = new Set(docTypes.filter((t) => t.active).map((t) => t.slug));
  const legacySlugs = (record?.doc_types_requested || []).filter((s) => !activeSlugs.has(s));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="renewal-edit-modal">
        <DialogHeader>
          <DialogTitle className="font-display">Edit renewal link</DialogTitle>
          <DialogDescription>The public token stays the same — only the displayed info changes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <Field label="Contractor" required>
            <select className={inputClass} value={form.contractor_id} onChange={(e) => setForm({ ...form, contractor_id: e.target.value })} data-testid="renewal-edit-contractor">
              <option value="">Select…</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Subject / title">
            <input type="text" className={inputClass} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Annual COI renewal" data-testid="renewal-edit-subject" />
          </Field>
          <Field label="Documents requested" required>
            <div className="grid grid-cols-2 gap-1 mt-1">
              {docTypes.filter((t) => t.active).map((t) => (
                <label key={t.slug} className="flex items-center gap-2 text-sm" title={t.description || ''}>
                  <input type="checkbox" checked={form.doc_types_requested.includes(t.slug)} onChange={() => toggleType(t.slug)} data-testid={`renewal-edit-doc-${t.slug}`} /> {t.label}
                </label>
              ))}
              {legacySlugs.map((slug) => (
                <label key={slug} className="flex items-center gap-2 text-sm text-amber-800" title="Legacy doc type — no longer configured for this org.">
                  <input type="checkbox" checked={form.doc_types_requested.includes(slug)} onChange={() => toggleType(slug)} />
                  <HelpCircle size={11} className="text-amber-600" /> {slug}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Custom message">
            <textarea rows={3} className={inputClass} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} data-testid="renewal-edit-message" />
          </Field>
          <Field label="Expires on">
            <input type="date" className={inputClass} value={form.expires_date} onChange={(e) => setForm({ ...form, expires_date: e.target.value })} data-testid="renewal-edit-expires" />
          </Field>
        </div>
        <DialogFooter>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={saving} testid="renewal-edit-save">
            {saving ? 'Saving…' : 'Save changes'}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageDocTypesDialog({ open, onClose, docTypes, onChanged }) {
  const [rows, setRows] = useState([]);
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setRows(docTypes.map((t) => ({ ...t })));
  }, [open, docTypes]);

  const update = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, _dirty: true } : r)));

  const saveRow = async (row) => {
    if (!row._dirty) return;
    try {
      const { data } = await api.patch(`/renewals/doc-types/${row.id}`, {
        label: row.label, description: row.description || null, active: row.active,
      });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...data, _dirty: false } : r)));
      toast.success(`Saved "${data.label}"`);
      onChanged?.();
    } catch (e) { toast.error(apiError(e)); }
  };

  const deleteRow = async (row) => {
    if (!window.confirm(`Delete "${row.label}"?`)) return;
    try {
      await api.delete(`/renewals/doc-types/${row.id}`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success(`Deleted "${row.label}"`);
      onChanged?.();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const addRow = async () => {
    if (!newLabel.trim()) { toast.error('Label is required'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/renewals/doc-types', {
        label: newLabel.trim(),
        description: newDesc.trim() || undefined,
      });
      setRows((prev) => [...prev, data]);
      setNewLabel(''); setNewDesc('');
      toast.success(`Added "${data.label}"`);
      onChanged?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="manage-doc-types-modal">
        <DialogHeader>
          <DialogTitle className="font-display">Manage requested document types</DialogTitle>
          <DialogDescription>These appear as checkboxes when admins create or edit a renewal link.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 pt-2 max-h-[60vh] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="text-sm text-slate-500 italic">No doc types yet — add one below.</div>
          ) : rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`doc-type-row-${r.id}`}>
              <div className="flex items-center gap-2">
                <input value={r.label} onChange={(e) => update(r.id, { label: e.target.value })}
                  data-testid={`doc-type-label-${r.id}`}
                  className="flex-1 px-2 py-1.5 text-sm font-semibold border border-slate-300 rounded bg-white" />
                <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                  <input type="checkbox" checked={!!r.active} onChange={(e) => update(r.id, { active: e.target.checked })} data-testid={`doc-type-active-${r.id}`} /> active
                </label>
                <button onClick={() => saveRow(r)} disabled={!r._dirty}
                  data-testid={`doc-type-save-${r.id}`}
                  className="px-3 py-1.5 text-xs font-semibold rounded bg-brand-blue text-white hover:bg-blue-600 disabled:opacity-40">
                  Save
                </button>
                <button onClick={() => deleteRow(r)} title="Delete"
                  data-testid={`doc-type-delete-${r.id}`}
                  className="p-1.5 rounded text-rose-600 hover:bg-rose-50">
                  <Trash2 />
                </button>
              </div>
              <input value={r.description || ''} placeholder="Optional description"
                onChange={(e) => update(r.id, { description: e.target.value })}
                data-testid={`doc-type-desc-${r.id}`}
                className="mt-2 w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 text-slate-700" />
              <div className="text-[10px] text-slate-400 mt-1">slug: <code className="text-slate-500">{r.slug}</code></div>
            </div>
          ))}
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-slate-600">Add a new doc type</div>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (e.g. Public Liability)"
              data-testid="new-doc-type-label"
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded bg-white" />
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              data-testid="new-doc-type-desc"
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-700" />
            <button onClick={addRow} disabled={busy || !newLabel.trim()}
              data-testid="new-doc-type-add"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-brand-blue text-white hover:bg-blue-600 disabled:opacity-40">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus />} Add type
            </button>
          </div>
        </div>
        <DialogFooter>
          <PrimaryButton onClick={onClose}>Done</PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
