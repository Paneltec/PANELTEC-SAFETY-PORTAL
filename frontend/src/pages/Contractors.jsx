import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, FileBadge, Link2, Loader2, Plus, Printer, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import api, { API_BASE, apiError } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { PageHeader, NewButton, BackButton, PrimaryButton, GhostButton, Field, inputClass, EmptyState, StatusBadge } from '../components/capture/Ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import DeleteRecordButton from '../components/DeleteRecordButton';
import PdfPreviewModal from '../components/PdfPreviewModal';
import { stashInlinePdf } from '../lib/pdfStash';

const DOC_TYPES = [
  ['public_liability', 'Public liability'],
  ['workers_comp', 'Workers compensation'],
  ['white_card', 'White card'],
  ['sw_license', 'SafeWork licence'],
  ['induction', 'Induction'],
  ['other', 'Other'],
];

const STATUS_OPTIONS = ['active', 'inactive', 'suspended'];

const TABS = [
  { key: 'all',     label: 'All contractors',     testid: 'contractor-tab-all' },
  { key: 'missing', label: 'Needs renewal link',  testid: 'contractor-tab-missing' },
  { key: 'active',  label: 'Has active link',     testid: 'contractor-tab-active' },
];

export default function ContractorsList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', expiring: '' });
  const [tab, setTab] = useState('all');
  const [picked, setPicked] = useState(() => new Set());
  const [linkModal, setLinkModal] = useState(null); // { contractors:[{id,name,contact_email}], bulk:bool }
  const [printFor, setPrintFor] = useState(null); // contractor record

  useEffect(() => {
    const params = {};
    if (filter.status) params.status = filter.status;
    if (filter.expiring) params.expiring_within_days = filter.expiring;
    api.get('/contractors', { params })
      .then((r) => setItems(r.data))
      .finally(() => setLoading(false));
  }, [filter]);

  const visibleItems = useMemo(() => {
    if (tab === 'missing') return items.filter((c) => !c.has_active_renewal_link);
    if (tab === 'active')  return items.filter((c) =>  c.has_active_renewal_link);
    return items;
  }, [items, tab]);

  const pickedRows = useMemo(
    () => items.filter((c) => picked.has(c.id)),
    [items, picked],
  );

  const togglePicked = (id) => setPicked((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const openSingle = (c) => setLinkModal({
    contractors: [{ id: c.id, name: c.name, contact_email: c.contact_email }],
    bulk: false,
  });
  const openBulk = () => {
    if (pickedRows.length === 0) return;
    setLinkModal({ contractors: pickedRows.map((c) => ({ id: c.id, name: c.name, contact_email: c.contact_email })), bulk: true });
  };

  const reload = () => {
    setLoading(true);
    const params = {};
    if (filter.status) params.status = filter.status;
    if (filter.expiring) params.expiring_within_days = filter.expiring;
    api.get('/contractors', { params }).then((r) => setItems(r.data)).finally(() => setLoading(false));
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="contractors-list">
      <PageHeader crumb="Compliance / Contractors" title="Contractor Register"
        subtitle="Companies, ABNs, insurances and licences — with auto-computed expiry status."
        action={<NewButton to="/app/contractors/new" label="Add contractor" testid="contractor-create-btn" />} />

      {/* Phase 3.14b — tab strip */}
      <div className="flex items-center gap-1 mb-3 border-b border-slate-200" data-testid="contractor-tabs">
        {TABS.map((t) => {
          const count = t.key === 'missing' ? items.filter((c) => !c.has_active_renewal_link).length
                       : t.key === 'active' ? items.filter((c) =>  c.has_active_renewal_link).length
                       : items.length;
          const isActive = tab === t.key;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              data-testid={t.testid}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                isActive ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}>
              {t.label} <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select className={inputClass + ' w-auto'} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} data-testid="contractor-filter-status">
          <option value="">All statuses</option>{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={inputClass + ' w-auto'} value={filter.expiring} onChange={(e) => setFilter({ ...filter, expiring: e.target.value })} data-testid="contractor-filter-expiring">
          <option value="">Any expiry</option><option value="30">Expiring ≤30 days</option><option value="60">Expiring ≤60 days</option><option value="90">Expiring ≤90 days</option>
        </select>
        {pickedRows.length > 0 && (
          <button type="button" onClick={openBulk}
            data-testid="contractor-bulk-renewal"
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
            <Link2 size={12} /> Add {pickedRows.length} to Renewal Links
          </button>
        )}
      </div>

      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : visibleItems.length === 0 ? <EmptyState title="No contractors" body={tab === 'missing' ? 'Every active contractor has an open renewal link.' : 'Add your first contractor.'} action={<NewButton to="/app/contractors/new" label="Add contractor" testid="contractor-empty-create" />} />
       : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider"><tr>
              <th className="px-3 py-3 w-8"></th>
              <th className="text-left px-4 py-3">Company</th>
              <th className="text-left px-4 py-3">Trade</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Compliance</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr></thead>
            <tbody>
              {visibleItems.map((c) => {
                const s = c.compliance_summary || { valid: 0, expiring_soon: 0, expired: 0, total: 0 };
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`contractor-row-${c.id}`}>
                    <td className="px-3 py-3"><input type="checkbox" checked={picked.has(c.id)} onChange={() => togglePicked(c.id)} data-testid={`contractor-checkbox-${c.id}`} className="h-3.5 w-3.5" /></td>
                    <td className="px-4 py-3"><Link to={`/app/contractors/${c.id}`} className="font-medium text-slate-900 hover:text-brand-blue">{c.name}</Link>{c.simpro_vendor_id && <span title={`Simpro vendor ${c.simpro_vendor_id}`} className="ml-1.5 inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#fff1e1] text-[#8a4b00] border border-[#f5cf91]" data-testid={`contractor-simpro-chip-${c.id}`}>Simpro</span>}{c.needs_email && <span title="No email — fill in before sending renewal link" className="ml-1.5 inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#fef3c7] text-[#92400e] border border-[#fcd34d]">needs email</span>}{c.has_active_renewal_link && <span title="Has a pending renewal link" className="ml-1.5 inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">link active</span>}<div className="text-xs text-slate-500">{c.abn || '—'}</div></td>
                    <td className="px-4 py-3 text-slate-600">{c.trade}</td>
                    <td className="px-4 py-3"><StatusBadge value={c.status} /></td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-emerald-700 font-medium">{s.valid}</span>/{s.total} valid
                      {s.expiring_soon > 0 && <span className="ml-2 text-amber-700">· {s.expiring_soon} expiring</span>}
                      {s.expired > 0 && <span className="ml-2 text-red-700">· {s.expired} expired</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1 justify-end">
                        <button type="button" onClick={() => setPrintFor(c)}
                          data-testid={`contractor-print-qr-btn-${c.id}`}
                          title="Print supplier induction QR"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 text-xs font-semibold hover:bg-violet-100">
                          <Printer size={11} /> Print supplier QR
                        </button>
                        <button type="button" onClick={() => openSingle(c)}
                          data-testid={`contractor-add-renewal-${c.id}`}
                          title={c.has_active_renewal_link ? 'Already has an active link — clicking will add a new one' : 'Add to Renewal Links'}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100">
                          <Link2 size={11} /> Add to Renewal Links
                        </button>
                        <DeleteRecordButton resourceKind="contractors" apiPath="contractors" recordId={c.id} label="Contractor" recordTitle={c.name} onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
       )}

      {linkModal && (
        <CreateRenewalLinkModal
          payload={linkModal}
          onClose={() => setLinkModal(null)}
          onCreated={() => { setPicked(new Set()); setLinkModal(null); reload(); }}
        />
      )}
      {printFor && (
        <SupplierPrintModal contractor={printFor} onClose={() => setPrintFor(null)} />
      )}
    </div>
  );
}

function SupplierPrintModal({ contractor, onClose }) {
  const [layout, setLayout] = useState('business_card');
  const [directUrl, setDirectUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    let alive = true;
    setBusy(true);
    api.get(`/contractors/${contractor.id}/scan-pdf`,
      { params: { layout }, responseType: 'blob' })
      .then(async (r) => {
        if (!alive) return;
        // Phase 3.13.1 — same-origin stash URL (ad-blocker friendly).
        const { src } = await stashInlinePdf(r.data, `${contractor.name || 'supplier'}-qr.pdf`);
        if (alive) setDirectUrl(src);
      })
      .catch((e) => alive && toast.error(apiError(e)))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [contractor.id, contractor.name, layout]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 grid place-items-center p-0 md:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="supplier-print-modal">
      <div className="w-full h-full md:max-w-5xl md:h-[88vh] bg-white md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-violet-700">Supplier induction QR</div>
            <div className="font-display font-bold text-slate-900 truncate">{contractor.name}</div>
          </div>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-semibold">
            <button onClick={() => setLayout('business_card')}
              data-testid="supplier-print-layout-business-card"
              className={`px-3 py-1.5 ${layout === 'business_card' ? 'bg-violet-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              Business card
            </button>
            <button onClick={() => setLayout('lanyard')}
              data-testid="supplier-print-layout-lanyard"
              className={`px-3 py-1.5 border-l border-slate-300 ${layout === 'lanyard' ? 'bg-violet-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              Lanyard
            </button>
          </div>
          <button onClick={onClose} data-testid="supplier-print-close"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-200">✕</button>
        </div>
        <div className="flex-1 bg-slate-100 relative">
          {busy ? (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 size={22} className="animate-spin text-violet-600" />
            </div>
          ) : directUrl ? (
            <iframe data-testid="supplier-print-iframe" title="Supplier QR PDF" src={directUrl}
              className="w-full h-full border-0" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CreateRenewalLinkModal({ payload, onClose, onCreated }) {
  const navigate = useNavigate();
  const [docTypes, setDocTypes] = useState(['public_liability', 'workers_comp']);
  const [expiresIn, setExpiresIn] = useState(14);
  const [busy, setBusy] = useState(false);
  const toggle = (v) => setDocTypes((d) => d.includes(v) ? d.filter((x) => x !== v) : [...d, v]);

  const submit = async () => {
    if (docTypes.length === 0) { toast.error('Pick at least one document type.'); return; }
    setBusy(true);
    try {
      if (payload.bulk) {
        const { data } = await api.post('/renewals/bulk', {
          contractor_ids: payload.contractors.map((c) => c.id),
          doc_types_requested: docTypes,
          expires_in_days: expiresIn,
        });
        toast.success(`${data.created} link${data.created === 1 ? '' : 's'} created · ${data.skipped} already existed.`, {
          action: { label: 'View →', onClick: () => navigate('/app/renewals') },
        });
      } else {
        await api.post('/renewals', {
          contractor_id: payload.contractors[0].id,
          doc_types_requested: docTypes,
          expires_in_days: expiresIn,
        });
        toast.success(`Renewal link created for ${payload.contractors[0].name}.`, {
          action: { label: 'View →', onClick: () => navigate('/app/renewals') },
        });
      }
      onCreated?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="sm:max-w-md" data-testid="create-renewal-link-modal">
        <DialogHeader>
          <DialogTitle>{payload.bulk ? `Bulk: creating ${payload.contractors.length} renewal links` : 'Add to Renewal Links'}</DialogTitle>
          <DialogDescription>
            {payload.bulk
              ? 'Same document set + expiry will apply to every selected contractor. Existing pending links covering the same documents are skipped.'
              : (<><span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-xs font-semibold mr-1.5">{payload.contractors[0].name}</span> A new pending renewal link will be created. The contractor receives a public submission URL.</>)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-1.5">Document types</div>
            <div className="flex flex-wrap gap-1.5">
              {DOC_TYPES.map(([v, l]) => {
                const on = docTypes.includes(v);
                return (
                  <button key={v} type="button" onClick={() => toggle(v)}
                    data-testid={`doc-type-${v}`}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{l}</button>
                );
              })}
            </div>
          </div>
          <Field label="Expires in">
            <select value={expiresIn} onChange={(e) => setExpiresIn(Number(e.target.value))}
              data-testid="expires-in"
              className={inputClass + ' w-auto'}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </Field>
        </div>
        <DialogFooter>
          <GhostButton onClick={onClose} disabled={busy}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={busy} data-testid={payload.bulk ? 'contractor-bulk-confirm' : 'contractor-add-renewal-confirm'}>
            {busy ? <Loader2 size={12} className="animate-spin mr-1" /> : <Link2 size={12} className="mr-1" />}
            {payload.bulk ? `Create ${payload.contractors.length} links` : 'Create link'}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
