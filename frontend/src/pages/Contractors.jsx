import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, FileBadge, Link2, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import api, { API_BASE, apiError } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { PageHeader, NewButton, BackButton, PrimaryButton, GhostButton, Field, inputClass, EmptyState, StatusBadge } from '../components/capture/Ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import DeleteRecordButton from '../components/DeleteRecordButton';

const DOC_TYPES = [
  ['public_liability', 'Public liability'],
  ['workers_comp', 'Workers compensation'],
  ['white_card', 'White card'],
  ['sw_license', 'SafeWork licence'],
  ['induction', 'Induction'],
  ['other', 'Other'],
];

const STATUS_OPTIONS = ['active', 'inactive', 'suspended'];

export default function ContractorsList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', expiring: '' });

  useEffect(() => {
    const params = {};
    if (filter.status) params.status = filter.status;
    if (filter.expiring) params.expiring_within_days = filter.expiring;
    api.get('/contractors', { params }).then((r) => setItems(r.data)).finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="max-w-6xl mx-auto" data-testid="contractors-list">
      <PageHeader crumb="Compliance / Contractors" title="Contractor Register"
        subtitle="Companies, ABNs, insurances and licences — with auto-computed expiry status."
        action={<NewButton to="/app/contractors/new" label="Add contractor" testid="contractor-create-btn" />} />

      <div className="flex flex-wrap gap-2 mb-4">
        <select className={inputClass + ' w-auto'} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} data-testid="contractor-filter-status">
          <option value="">All statuses</option>{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={inputClass + ' w-auto'} value={filter.expiring} onChange={(e) => setFilter({ ...filter, expiring: e.target.value })} data-testid="contractor-filter-expiring">
          <option value="">Any expiry</option><option value="30">Expiring ≤30 days</option><option value="60">Expiring ≤60 days</option><option value="90">Expiring ≤90 days</option>
        </select>
      </div>

      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : items.length === 0 ? <EmptyState title="No contractors" body="Add your first contractor." action={<NewButton to="/app/contractors/new" label="Add contractor" testid="contractor-empty-create" />} />
       : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider"><tr><th className="text-left px-4 py-3">Company</th><th className="text-left px-4 py-3">Trade</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Compliance</th><th className="text-right px-4 py-3">Actions</th></tr></thead>
            <tbody>
              {items.map((c) => {
                const s = c.compliance_summary || { valid: 0, expiring_soon: 0, expired: 0, total: 0 };
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`contractor-row-${c.id}`}>
                    <td className="px-4 py-3"><Link to={`/app/contractors/${c.id}`} className="font-medium text-slate-900 hover:text-brand-blue">{c.name}</Link><div className="text-xs text-slate-500">{c.abn || '—'}</div></td>
                    <td className="px-4 py-3 text-slate-600">{c.trade}</td>
                    <td className="px-4 py-3"><StatusBadge value={c.status} /></td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-emerald-700 font-medium">{s.valid}</span>/{s.total} valid
                      {s.expiring_soon > 0 && <span className="ml-2 text-amber-700">· {s.expiring_soon} expiring</span>}
                      {s.expired > 0 && <span className="ml-2 text-red-700">· {s.expired} expired</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DeleteRecordButton resourceKind="contractors" apiPath="contractors" recordId={c.id} label="Contractor" recordTitle={c.name} onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
       )}
    </div>
  );
}

export function ContractorNew() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', abn: '', contact_name: '', contact_email: '', contact_phone: '', trade: '', status: 'active' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!form.name) { toast.error('Name required'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/contractors', form);
      toast.success('Contractor added');
      navigate(`/app/contractors/${data.id}`);
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-2xl mx-auto" data-testid="contractor-new">
      <BackButton to="/app/contractors" />
      <PageHeader crumb="Compliance / Contractors / New" title="Add contractor" />
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <Field label="Company name" required><input data-testid="c-name" className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="ABN"><input data-testid="c-abn" className={inputClass} value={form.abn} onChange={(e) => setForm({ ...form, abn: e.target.value })} /></Field>
          <Field label="Trade"><input data-testid="c-trade" className={inputClass} value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} /></Field>
          <Field label="Contact name"><input className={inputClass} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></Field>
          <Field label="Contact email"><input data-testid="c-email" type="email" className={inputClass} value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></Field>
          <Field label="Contact phone"><input className={inputClass} value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></Field>
          <Field label="Status">
            <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <GhostButton onClick={() => navigate('/app/contractors')}>Cancel</GhostButton>
        <PrimaryButton onClick={save} busy={busy} testid="c-submit">Save contractor</PrimaryButton>
      </div>
    </div>
  );
}

export function ContractorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [renewalOpen, setRenewalOpen] = useState(false);
  const [renewForm, setRenewForm] = useState({ doc_types_requested: [], expires_in_days: 14 });
  const [created, setCreated] = useState(null);
  const [upload, setUpload] = useState({ type: 'public_liability', expiry_date: '' });
  const fileRef = React.useRef(null);

  const load = () => api.get(`/contractors/${id}`).then((r) => setDoc(r.data)).catch(() => { toast.error('Not found'); navigate('/app/contractors'); });
  useEffect(() => { load(); }, [id]);

  if (!doc) return <div className="text-sm text-slate-500">Loading…</div>;

  const submitDoc = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData(); fd.append('file', file); fd.append('type', upload.type);
    if (upload.expiry_date) fd.append('expiry_date', upload.expiry_date);
    setBusy(true);
    try { await api.post(`/contractors/${id}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); toast.success('Document uploaded'); load(); }
    catch (err) { toast.error(apiError(err)); } finally { setBusy(false); e.target.value = ''; }
  };

  const delDoc = async (docId) => {
    if (!window.confirm('Delete this document?')) return;
    await api.delete(`/contractors/${id}/documents/${docId}`); toast.success('Removed'); load();
  };

  const toggleType = (t) => setRenewForm((f) => ({ ...f, doc_types_requested: f.doc_types_requested.includes(t) ? f.doc_types_requested.filter((x) => x !== t) : [...f.doc_types_requested, t] }));

  const createRenewal = async () => {
    if (renewForm.doc_types_requested.length === 0) { toast.error('Pick at least one document type'); return; }
    try {
      const { data } = await api.post('/renewals', { contractor_id: id, ...renewForm });
      setCreated(data);
      toast.success('Renewal link created');
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="max-w-4xl mx-auto" data-testid="contractor-detail">
      <BackButton to="/app/contractors" />
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <div className="text-xs text-slate-500 mb-1">Compliance / Contractors / {doc.name}</div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{doc.name}</h1>
          <div className="mt-2 flex items-center gap-2"><StatusBadge value={doc.status} /><span className="text-xs text-slate-500">{doc.trade} · {doc.abn || '—'}</span></div>
        </div>
        <GhostButton onClick={() => setRenewalOpen(true)} testid="send-renewal-btn"><Link2 size={14} className="mr-1" /> Send renewal link</GhostButton>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4 grid sm:grid-cols-2 gap-3 text-sm">
        <div><span className="text-slate-500">Contact:</span> {doc.contact_name || '—'}</div>
        <div><span className="text-slate-500">Email:</span> {doc.contact_email || '—'}</div>
        <div><span className="text-slate-500">Phone:</span> {doc.contact_phone || '—'}</div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold">Documents · {doc.documents?.length || 0}</h3>
          <div className="flex items-center gap-2">
            <select className={inputClass + ' w-auto text-xs py-1'} value={upload.type} onChange={(e) => setUpload({ ...upload, type: e.target.value })}>{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input type="date" className={inputClass + ' w-auto text-xs py-1'} value={upload.expiry_date} onChange={(e) => setUpload({ ...upload, expiry_date: e.target.value })} placeholder="Expiry" />
            <input ref={fileRef} type="file" className="hidden" onChange={submitDoc} data-testid="doc-file-input" />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-blue text-white text-xs font-medium hover:bg-blue-600 disabled:opacity-60"><Upload size={12} /> Upload</button>
          </div>
        </div>
        {(!doc.documents || doc.documents.length === 0)
          ? <div className="text-sm text-slate-400 italic">No documents yet.</div>
          : (
            <table className="w-full text-sm">
              <tbody>
                {doc.documents.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100" data-testid={`doc-row-${d.id}`}>
                    <td className="py-2"><FileBadge size={14} className="inline mr-2 text-slate-400" />{(DOC_TYPES.find(([k]) => k === d.type) || [])[1] || d.type}</td>
                    <td className="py-2 text-slate-500 text-xs">expires {d.expiry_date || '—'}</td>
                    <td className="py-2"><StatusBadge value={d.status} /></td>
                    <td className="py-2 text-right"><button onClick={() => delDoc(d.id)} className="p-1 text-slate-400 hover:text-brand-red"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      <Dialog open={renewalOpen} onOpenChange={(o) => { setRenewalOpen(o); if (!o) setCreated(null); }}>
        <DialogContent data-testid="renewal-modal">
          <DialogHeader>
            <DialogTitle className="font-display">Send renewal link to {doc.name}</DialogTitle>
            <DialogDescription>Email delivery is pending TextMagic/M365 — for now use the Copy link button to send manually.</DialogDescription>
          </DialogHeader>
          {!created ? (
            <div className="space-y-3 pt-2">
              <Field label="Documents requested">
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {DOC_TYPES.map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={renewForm.doc_types_requested.includes(k)} onChange={() => toggleType(k)} /> {l}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Expires in (days)"><input type="number" min={1} max={90} className={inputClass} value={renewForm.expires_in_days} onChange={(e) => setRenewForm({ ...renewForm, expires_in_days: Number(e.target.value) })} /></Field>
            </div>
          ) : (
            <div className="space-y-2 pt-2">
              <div className="text-xs text-slate-500">Public link (single-use, expires {created.expires_at?.slice(0, 10)}):</div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs break-all" data-testid="renewal-public-url">{created.public_url}</div>
              <button onClick={() => { navigator.clipboard.writeText(created.public_url); toast.success('Link copied'); }} className="text-xs text-brand-blue hover:underline">Copy link</button>
            </div>
          )}
          <DialogFooter>
            {!created
              ? (<><GhostButton onClick={() => setRenewalOpen(false)}>Cancel</GhostButton><PrimaryButton onClick={createRenewal} testid="create-renewal-submit">Create link</PrimaryButton></>)
              : <PrimaryButton onClick={() => setRenewalOpen(false)}>Done</PrimaryButton>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
