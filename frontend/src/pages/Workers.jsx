// Workers (Phase 1 + 2) — field-ops directory.
// Phase 1: identity, contact, Simpro sync, manual CRUD, soft delete.
// Phase 2: Personal section (birth date + address), Availability scheduler,
// Clients multi-select from Simpro customers, plus table chips (state + clients).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Award, Calendar, CheckSquare, ChevronDown, ChevronRight, Download, Edit3,
  FileText, HardHat, Loader2, Mail, MapPin, Plug, Plus, RefreshCw, Search, Square,
  Trash2, Upload, UploadCloud, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader, EmptyState } from '../components/capture/Ui';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);
const SYNC_OPTIONS = [
  { value: 'paneltec', label: 'Paneltec only' },
  { value: 'viatec',   label: 'Viatec only' },
  { value: 'both',     label: 'Paneltec + Viatec' },
];
const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];
const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
const CLIENT_SOURCES = [
  { value: 'paneltec', label: 'Paneltec', tint: 'bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4]' },
  { value: 'viatec',   label: 'Viatec',   tint: 'bg-[#ece6f4] text-[#4f3a8c] hover:bg-[#e0d8ec]' },
  { value: 'both',     label: 'Both',     tint: 'bg-[#d8ecdd] text-[#1f7a3f] hover:bg-[#c8e0cf]' },
];

function fullName(w) { return `${w.first_name || ''} ${w.last_name || ''}`.trim() || '(unnamed)'; }

function emptyAvailability() {
  const a = {};
  DAYS.forEach((d) => { a[d.key] = { enabled: false, start: '07:00', end: '17:00' }; });
  return a;
}

function normaliseAvailability(av) {
  const out = emptyAvailability();
  if (av && typeof av === 'object') {
    DAYS.forEach((d) => {
      const row = av[d.key] || {};
      out[d.key] = {
        enabled: !!row.enabled,
        start: row.start || '07:00',
        end: row.end || '17:00',
      };
    });
  }
  return out;
}

function StatusBadge({ active }) {
  if (active) {
    return <span data-testid="worker-active" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]">Active</span>;
  }
  return <span data-testid="worker-inactive" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border bg-slate-100 text-slate-600 border-slate-200">Inactive</span>;
}

function CompanyChip({ label }) {
  const tints = {
    Paneltec: 'bg-[#e6eff9] text-[#1e4a8c]',
    Viatec:   'bg-[#ece6f4] text-[#4f3a8c]',
    Manual:   'bg-slate-100 text-slate-600',
  };
  return <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${tints[label] || tints.Manual}`}>{label}</span>;
}

function Section({ icon: Icon, title, badge, defaultOpen = false, testid, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white" data-testid={testid}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-left"
        data-testid={`${testid}-toggle`}>
        <Icon size={14} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-800 flex-1">{title}</span>
        {badge ? <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#e6eff9] text-[#1e4a8c]">{badge}</span> : null}
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 py-4 border-t border-slate-200">{children}</div>}
    </div>
  );
}

function ClientPicker({ company, onClose, selectedIds, onApply }) {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(() => new Set(selectedIds || []));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/integrations/simpro/customers?company=${company}`);
        if (!cancelled) setCustomers(data.customers || []);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [company]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, search]);

  const toggle = (id) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const selectAll = () => setPicked(new Set([...picked, ...filtered.map((c) => c.simpro_customer_id)]));
  const clearAll = () => setPicked(new Set());

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="client-picker">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[80vh] flex flex-col">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">Simpro customers</div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Pick clients ({CLIENT_SOURCES.find((s) => s.value === company)?.label || company})
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-200" data-testid="client-picker-close"><X size={14} /></button>
        </div>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers…" data-testid="client-picker-search"
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div className="text-xs text-slate-500" data-testid="client-picker-count">
            {picked.size} of {customers.length} selected
          </div>
          <button onClick={selectAll} data-testid="client-picker-select-all"
            className="text-xs px-2 py-1 rounded bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4] font-medium">Select filtered</button>
          <button onClick={clearAll} data-testid="client-picker-clear-all"
            className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium">Clear all</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500 inline-flex items-center gap-2 w-full justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading customers from Simpro…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">No customers match.</div>
          ) : filtered.slice(0, 500).map((c) => {
            const checked = picked.has(c.simpro_customer_id);
            return (
              <button type="button" key={`${c.simpro_company_id}-${c.simpro_customer_id}`}
                onClick={() => toggle(c.simpro_customer_id)}
                data-testid={`client-row-${c.simpro_customer_id}`}
                className={`w-full px-5 py-2.5 flex items-center gap-3 text-left border-b border-slate-100 ${checked ? 'bg-[#e6eff9]' : 'hover:bg-slate-50'}`}>
                {checked ? <CheckSquare size={15} className="text-[#1e4a8c]" /> : <Square size={15} className="text-slate-400" />}
                <span className="flex-1 text-sm text-slate-800">{c.name}</span>
                <CompanyChip label={c.company_label} />
              </button>
            );
          })}
          {!loading && filtered.length > 500 && (
            <div className="px-5 py-2 text-[11px] text-slate-400">Showing first 500 — refine search to narrow.</div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100" data-testid="client-picker-cancel">Cancel</button>
          <button onClick={() => onApply([...picked])} data-testid="client-picker-apply"
            className="px-3 py-1.5 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold hover:bg-[#143263]">
            Apply {picked.size} selection{picked.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Certifications ───────────────────

const STATUS_BADGES = {
  valid:         { bg: 'bg-[#d8ecdd]', ink: 'text-[#1f7a3f]', border: 'border-[#b6dcbf]' },
  expiring_soon: { bg: 'bg-[#f7eed1]', ink: 'text-[#8c6a1a]', border: 'border-[#e6d995]' },
  expired:       { bg: 'bg-[#f7d8dc]', ink: 'text-[#a8324c]', border: 'border-[#e69aa3]' },
  no_expiry:     { bg: 'bg-[#d8e6f4]', ink: 'text-[#1e4a8c]', border: 'border-[#b9d2ec]' },
  // Butter pastel so a worker with no file uploaded reads as a warning, not neutral.
  missing_file:  { bg: 'bg-[#f7eed1]', ink: 'text-[#8c6a1a]', border: 'border-[#e6d995]' },
};

function StatusBadgeCert({ status }) {
  const cfg = STATUS_BADGES[status?.key] || STATUS_BADGES.missing_file;
  const Icon = status?.key === 'missing_file' ? AlertTriangle : null;
  return (
    <span data-testid={`cert-status-${status?.key}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${cfg.bg} ${cfg.ink} ${cfg.border}`}>
      {Icon && <Icon size={9} />} {status?.label || '—'}
    </span>
  );
}

function CertificationsPanel({ workerId, canEdit }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const fileInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/workers/${workerId}/certifications`);
      setRows(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) load(); }, [open, workerId]);

  const upload = async (fileList) => {
    if (!fileList || !fileList.length) return;
    setUploading(true);
    try {
      let lastCertId = null;
      for (const f of Array.from(fileList)) {
        const form = new FormData();
        form.append('file', f);
        const { data } = await api.post(
          `/workers/${workerId}/certifications/upload`,
          form,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        lastCertId = data?.cert?.id;
      }
      toast.success(`${fileList.length} certification${fileList.length === 1 ? '' : 's'} uploaded`);
      await load();
      // Auto-open inline edit on the last upload so the user fills in dates.
      if (lastCertId) setEditingId(lastCertId);
    } catch (e) { toast.error(apiError(e)); }
    finally { setUploading(false); }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
  };

  const addManual = async () => {
    try {
      const { data } = await api.post(`/workers/${workerId}/certifications`,
        { name: 'New certification' });
      await load();
      setEditingId(data.id);
    } catch (e) { toast.error(apiError(e)); }
  };

  const removeCert = async (cert) => {
    try {
      await api.delete(`/workers/certifications/${cert.id}`);
      toast.success(`${cert.name} removed`);
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white" data-testid="section-certifications">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-left"
        data-testid="section-certifications-toggle">
        <Award size={14} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-800 flex-1">Certifications</span>
        {rows.length > 0 && (
          <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#e6eff9] text-[#1e4a8c]">{rows.length}</span>
        )}
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 py-4 border-t border-slate-200 space-y-3">
          {/* Drop zone */}
          {canEdit && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="cert-dropzone"
              className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
                dragOver ? 'border-[#1e4a8c] bg-[#e6eff9]' : 'border-[#b9d2ec] bg-[#e6eff9]/40 hover:bg-[#e6eff9]'
              }`}
            >
              <UploadCloud size={22} className="mx-auto text-[#1e4a8c] mb-1.5" />
              <div className="text-sm font-medium text-[#1e4a8c]">
                {uploading ? 'Uploading…' : 'Drop certification files here (PDF, JPG, PNG) or click to browse'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Up to 50MB · auto-files to Document Library &quot;Licences &amp; Tickets&quot;</div>
              <input
                ref={fileInputRef} type="file" multiple
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => upload(e.target.files)}
                className="hidden" data-testid="cert-file-input"
              />
            </div>
          )}

          {canEdit && (
            <div className="flex justify-end">
              <button type="button" onClick={addManual} data-testid="cert-add-manual"
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                <Plus size={12} /> Add certification (no file)
              </button>
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-400 italic" data-testid="cert-empty">
              No certifications recorded yet. Drop a file above to add one.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs" data-testid="cert-table">
                <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2 hidden md:table-cell">Issuer</th>
                    <th className="text-left px-3 py-2 hidden lg:table-cell">Issued</th>
                    <th className="text-left px-3 py-2">Expiry</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">File</th>
                    <th className="text-right px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    editingId === c.id
                      ? <CertEditRow key={c.id} cert={c}
                          onSaved={() => { setEditingId(null); load(); }}
                          onCancel={() => setEditingId(null)} />
                      : (
                        <tr key={c.id} className="border-t border-slate-100" data-testid={`cert-row-${c.id}`}>
                          <td className="px-3 py-2 font-semibold text-slate-900">{c.name}</td>
                          <td className="px-3 py-2 text-slate-600 hidden md:table-cell">{c.issuer || '—'}</td>
                          <td className="px-3 py-2 text-slate-500 hidden lg:table-cell">{c.issue_date || '—'}</td>
                          <td className="px-3 py-2 text-slate-500">{c.expiry_date || '—'}</td>
                          <td className="px-3 py-2"><StatusBadgeCert status={c.status} /></td>
                          <td className="px-3 py-2">
                            {c.doc_file_id ? (
                              <a href={`${process.env.REACT_APP_BACKEND_URL}/api/document-library/files/${c.doc_file_id}/download`}
                                 target="_blank" rel="noreferrer"
                                 data-testid={`cert-file-${c.id}`}
                                 className="inline-flex items-center gap-1 text-[#1e4a8c] hover:underline">
                                <FileText size={11} /> View
                              </a>
                            ) : <span className="text-[10px] text-slate-400 italic">no file</span>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canEdit && (
                              <div className="inline-flex gap-1 items-center">
                                <button type="button" onClick={() => setEditingId(c.id)} data-testid={`cert-edit-${c.id}`}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4]"><Edit3 size={11} /></button>
                                <button type="button" onClick={() => removeCert(c)} data-testid={`cert-delete-${c.id}`}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded bg-[#fbe4e7] text-[#7a1f33] hover:bg-[#f4c7cd]"><Trash2 size={11} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CertEditRow({ cert, onSaved, onCancel }) {
  const [f, setF] = useState({
    name: cert.name || '',
    issuer: cert.issuer || '',
    issue_date: cert.issue_date || '',
    expiry_date: cert.expiry_date || '',
    notes: cert.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!f.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      await api.patch(`/workers/certifications/${cert.id}`, {
        name: f.name.trim(),
        issuer: f.issuer.trim(),
        issue_date: f.issue_date || null,
        expiry_date: f.expiry_date || null,
        notes: f.notes,
      });
      toast.success('Certification updated');
      onSaved();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };
  return (
    <tr className="border-t border-slate-100 bg-[#e6eff9]/40" data-testid={`cert-edit-row-${cert.id}`}>
      <td colSpan={7} className="px-3 py-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="col-span-2 lg:col-span-1"><span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Name *</span>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
              data-testid="cert-form-name" className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" /></label>
          <label><span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Issuer</span>
            <input value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })}
              data-testid="cert-form-issuer" className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" /></label>
          <label><span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Issue date</span>
            <input type="date" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })}
              data-testid="cert-form-issue-date" className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" /></label>
          <label><span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Expiry date</span>
            <input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })}
              data-testid="cert-form-expiry-date" className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" /></label>
          <label className="col-span-2 lg:col-span-4"><span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Notes</span>
            <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })}
              data-testid="cert-form-notes" className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" /></label>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onCancel} data-testid="cert-form-cancel"
            className="px-3 py-1 text-xs border border-slate-300 bg-white rounded text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={save} disabled={saving} data-testid="cert-form-save"
            className="px-3 py-1 text-xs bg-[#1e4a8c] text-white rounded font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </td>
    </tr>
  );
}



function EditModal({ worker, onClose, onSaved }) {
  const isNew = !worker.id;
  const isSimpro = worker.source === 'simpro';
  const [f, setF] = useState({
    first_name: worker.first_name || '',
    last_name:  worker.last_name  || '',
    email:      worker.email      || '',
    phone:      worker.phone      || '',
    mobile:     worker.mobile     || '',
    position:   worker.position   || '',
    active:     worker.active !== false,
    birth_date:     worker.birth_date     || '',
    country:        worker.country        || 'Australia',
    state:          worker.state          || '',
    street_address: worker.street_address || '',
    suburb:         worker.suburb         || '',
    postal_code:    worker.postal_code    || '',
    additional_notes: worker.additional_notes || '',
    availability: normaliseAvailability(worker.availability),
    client_ids: Array.isArray(worker.client_ids) ? worker.client_ids : [],
  });
  const [saving, setSaving] = useState(false);
  const [pickerCompany, setPickerCompany] = useState(null);
  const [clientCache, setClientCache] = useState({});  // {id: {name, company_label}}

  // Validate availability: every enabled day must have end > start.
  const availabilityError = useMemo(() => {
    for (const d of DAYS) {
      const row = f.availability[d.key];
      if (row.enabled && row.start >= row.end) {
        return `${d.label}: end time must be after start time`;
      }
    }
    return null;
  }, [f.availability]);

  // Hydrate client cache for any already-selected IDs we don't have names for.
  useEffect(() => {
    const missing = f.client_ids.filter((id) => !clientCache[id]);
    if (!missing.length) return;
    (async () => {
      try {
        const { data } = await api.get('/integrations/simpro/customers?company=both');
        const cache = {};
        (data.customers || []).forEach((c) => {
          cache[c.simpro_customer_id] = { name: c.name, company_label: c.company_label };
        });
        setClientCache((prev) => ({ ...prev, ...cache }));
      } catch (e) { /* silent — chips will fall back to raw id */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.client_ids.length]);

  const submit = async (e) => {
    e?.preventDefault();
    if (!f.first_name.trim()) return;
    if (availabilityError) { toast.error(availabilityError); return; }
    if (f.postal_code && !/^\d{4}$/.test(f.postal_code)) { toast.error('Postal code must be 4 digits'); return; }
    setSaving(true);
    try {
      const body = {
        ...f,
        // Compact availability — only send rows that are enabled OR have non-default times.
        availability: f.availability,
      };
      if (isNew) {
        await api.post('/workers', body);
        toast.success('Worker added');
      } else {
        await api.patch(`/workers/${worker.id}`, body);
        toast.success('Worker updated');
      }
      onSaved();
    } catch (err) { toast.error(apiError(err)); }
    finally { setSaving(false); }
  };

  const dayRow = (d) => {
    const row = f.availability[d.key];
    const setRow = (patch) => setF({ ...f, availability: { ...f.availability, [d.key]: { ...row, ...patch } } });
    const enabled = row.enabled;
    const invalid = enabled && row.start >= row.end;
    return (
      <div key={d.key}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg ${enabled ? 'bg-[#e6eff9]' : 'bg-slate-50'} ${invalid ? 'ring-1 ring-[#e69aa3]' : ''}`}
        data-testid={`availability-${d.key}`}>
        <label className="inline-flex items-center gap-2 w-28 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setRow({ enabled: e.target.checked })}
            data-testid={`availability-${d.key}-toggle`}
            className="w-4 h-4 rounded text-[#1e4a8c]" />
          <span className={`text-sm font-medium ${enabled ? 'text-[#1e4a8c]' : 'text-slate-500'}`}>{d.label}</span>
        </label>
        <input type="time" value={row.start} onChange={(e) => setRow({ start: e.target.value })}
          disabled={!enabled} data-testid={`availability-${d.key}-start`}
          className="px-2 py-1 text-sm border border-slate-300 rounded disabled:bg-slate-100 disabled:text-slate-400" />
        <span className="text-xs text-slate-400">to</span>
        <input type="time" value={row.end} onChange={(e) => setRow({ end: e.target.value })}
          disabled={!enabled} data-testid={`availability-${d.key}-end`}
          className="px-2 py-1 text-sm border border-slate-300 rounded disabled:bg-slate-100 disabled:text-slate-400" />
        {invalid && <span className="text-[11px] text-[#7a1f33] font-medium">End must be after start</span>}
      </div>
    );
  };

  const enabledDayCount = Object.values(f.availability).filter((r) => r.enabled).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="worker-edit-modal">
      <form onSubmit={submit} className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 bg-[#e6eff9]">
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#1e4a8c]">{isNew ? 'New worker' : 'Edit worker'}</div>
          <h2 className="font-display text-xl font-semibold text-slate-900 mt-0.5">{isNew ? 'Add worker' : fullName(worker)}</h2>
        </div>
        {isSimpro && (
          <div className="px-6 py-2 text-xs text-[#1e4a8c] bg-[#e6eff9]/60 border-b border-[#b9d2ec] flex items-center gap-1.5">
            <Plug size={12} /> Synced from Simpro — name, email and phone get refreshed on the next sync. Personal, availability and client assignments are safe to edit here.
          </div>
        )}

        <div className="px-6 py-4 overflow-y-auto space-y-3 text-sm flex-1">
          {/* Identity — always-on */}
          <div className="border border-slate-200 rounded-xl px-4 py-4 bg-white" data-testid="section-identity">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-semibold text-sm"><HardHat size={14} className="text-slate-500" /> Identity & contact</div>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="block text-xs font-medium text-slate-700 mb-1">First name *</span>
                <input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })}
                  data-testid="worker-first-name" className="w-full px-3 py-2 border border-slate-300 rounded-lg" required /></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Last name</span>
                <input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })}
                  data-testid="worker-last-name" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="col-span-2"><span className="block text-xs font-medium text-slate-700 mb-1">Email</span>
                <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })}
                  data-testid="worker-email" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Phone</span>
                <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })}
                  data-testid="worker-phone" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Mobile</span>
                <input value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })}
                  data-testid="worker-mobile" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="col-span-2"><span className="block text-xs font-medium text-slate-700 mb-1">Position</span>
                <input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })}
                  data-testid="worker-position" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="col-span-2 inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })}
                  data-testid="worker-active-toggle" className="w-4 h-4 rounded text-emerald-500" />
                <span className="text-sm text-slate-700">Active</span>
              </label>
            </div>
          </div>

          {/* Personal */}
          <Section icon={MapPin} title="Personal" testid="section-personal"
            badge={[f.state, f.suburb].filter(Boolean).join(', ') || null}
            defaultOpen={false}>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Birth date</span>
                <input type="date" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })}
                  data-testid="worker-birth-date" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Country</span>
                <select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}
                  data-testid="worker-country" className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="Australia">Australia</option>
                  <option value="Other">Other</option>
                </select></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">State</span>
                <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}
                  data-testid="worker-state" className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="">—</option>
                  {AU_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></label>
              <label><span className="block text-xs font-medium text-slate-700 mb-1">Postal code</span>
                <input value={f.postal_code} maxLength={4}
                  onChange={(e) => setF({ ...f, postal_code: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  data-testid="worker-postal-code" placeholder="2000"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="col-span-2"><span className="block text-xs font-medium text-slate-700 mb-1">Street address</span>
                <input value={f.street_address} onChange={(e) => setF({ ...f, street_address: e.target.value })}
                  data-testid="worker-street-address" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="col-span-2"><span className="block text-xs font-medium text-slate-700 mb-1">Suburb</span>
                <input value={f.suburb} onChange={(e) => setF({ ...f, suburb: e.target.value })}
                  data-testid="worker-suburb" className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
            </div>
          </Section>

          {/* Availability */}
          <Section icon={Calendar} title="Availability" testid="section-availability"
            badge={enabledDayCount > 0 ? `${enabledDayCount} day${enabledDayCount === 1 ? '' : 's'}` : null}
            defaultOpen={false}>
            <div className="space-y-1.5">
              {DAYS.map(dayRow)}
            </div>
            {availabilityError && (
              <div className="mt-2 text-xs text-[#7a1f33] font-medium" data-testid="availability-error">{availabilityError}</div>
            )}
          </Section>

          {/* Clients */}
          <Section icon={Users} title="Clients" testid="section-clients"
            badge={f.client_ids.length ? `${f.client_ids.length} selected` : null}
            defaultOpen={false}>
            <div className="text-xs text-slate-500 mb-2">Populate from SimPRO:</div>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {CLIENT_SOURCES.map((s) => (
                <button key={s.value} type="button" onClick={() => setPickerCompany(s.value)}
                  data-testid={`populate-${s.value}`}
                  className={`text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full ${s.tint}`}>
                  {s.label}
                </button>
              ))}
            </div>
            {f.client_ids.length === 0 ? (
              <div className="text-xs text-slate-400 italic">No clients assigned yet.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {f.client_ids.map((id) => {
                  const meta = clientCache[id];
                  return (
                    <span key={id} data-testid={`client-chip-${id}`}
                      className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 border border-slate-200 rounded-full text-xs">
                      <span className="text-slate-700">{meta?.name || `Customer #${id}`}</span>
                      {meta?.company_label && <CompanyChip label={meta.company_label} />}
                      <button type="button" onClick={() => setF({ ...f, client_ids: f.client_ids.filter((x) => x !== id) })}
                        data-testid={`client-chip-remove-${id}`}
                        className="text-slate-400 hover:text-[#7a1f33]"><X size={11} /></button>
                    </span>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Certifications */}
          {!isNew && (
            <CertificationsPanel workerId={worker.id} canEdit={true} />
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center gap-2 bg-slate-50">
          <div className="text-[11px] text-slate-400">{availabilityError ? availabilityError : ''}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100" data-testid="modal-cancel">Cancel</button>
            <button type="submit" disabled={saving || !!availabilityError} data-testid="modal-save"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60 disabled:cursor-not-allowed">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null} {isNew ? 'Create' : 'Update'}
            </button>
          </div>
        </div>
      </form>

      {pickerCompany && (
        <ClientPicker company={pickerCompany} selectedIds={f.client_ids}
          onClose={() => setPickerCompany(null)}
          onApply={(ids) => { setF({ ...f, client_ids: ids }); setPickerCompany(null); }} />
      )}
    </div>
  );
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv(rows) {
  const headers = ['first_name', 'last_name', 'email', 'phone', 'mobile', 'position',
                   'company_label', 'state', 'suburb', 'active', 'simpro_employee_id', 'clients_count'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const enriched = { ...r, clients_count: (r.client_ids || []).length };
    lines.push(headers.map((h) => csvCell(enriched[h])).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `workers-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function Workers() {
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/workers');
      setRows(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const blob = `${fullName(r)} ${r.email || ''} ${r.phone || ''} ${r.mobile || ''} ${r.suburb || ''} ${r.state || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search]);

  const sync = async (company) => {
    setSyncOpen(false);
    setSyncing(true);
    try {
      const { data } = await api.post('/workers/sync-from-simpro', { company });
      toast.success(`Sync complete · ${data.created} new, ${data.updated} updated, ${data.skipped} skipped`);
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSyncing(false); }
  };

  const remove = async (w) => {
    try {
      await api.delete(`/workers/${w.id}`);
      toast.success(`${fullName(w)} removed`);
      setConfirmDelete(null);
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const toggleSel = (id) => setSelected((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <div className="max-w-7xl mx-auto" data-testid="workers-page">
      <PageHeader crumb="Settings / Workers" title="Workers"
        subtitle="Your field crew — synced from Simpro or added manually." />

      <div className="mb-4 flex items-center gap-2 flex-wrap" data-testid="workers-toolbar">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone or state…" data-testid="search-input"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
        </div>
        <button onClick={() => exportCsv(filtered)} disabled={filtered.length === 0} data-testid="export-csv"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download size={14} /> Export CSV
        </button>
        {canEdit && (
          <div className="relative">
            <button onClick={() => setSyncOpen((v) => !v)} disabled={syncing} data-testid="sync-dropdown"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#e6eff9] text-[#1e4a8c] text-sm font-medium hover:bg-[#d8e6f4] disabled:opacity-60">
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync from Simpro <ChevronDown size={12} />
            </button>
            {syncOpen && (
              <div className="absolute right-0 z-20 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                {SYNC_OPTIONS.map((o) => (
                  <button key={o.value} onClick={() => sync(o.value)} data-testid={`sync-${o.value}`}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-[#e6eff9] hover:text-[#1e4a8c]">
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex-1" />
        {canEdit && (
          <button onClick={() => setEditing({})} data-testid="add-worker"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#143263]">
            <Plus size={14} /> Add worker
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading workers…</div>
      ) : filtered.length === 0 ? (
        <EmptyState title={search ? 'No workers match' : 'No workers yet'}
          body={search ? 'Try a different search term.' : 'Sync from Simpro or add a worker manually to get started.'}
          action={canEdit && !search ? (
            <button onClick={() => setEditing({})} data-testid="empty-add"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1e4a8c] text-white text-sm font-medium">
              <Plus size={14} /> Add worker
            </button>
          ) : null} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm" data-testid="workers-table">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3 w-8"></th>
                <th className="text-left px-3 py-3">Name</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Email</th>
                <th className="text-left px-3 py-3 hidden lg:table-cell">Phone</th>
                <th className="text-left px-3 py-3">Company</th>
                <th className="text-left px-3 py-3 hidden xl:table-cell">Profile</th>
                <th className="text-left px-3 py-3">Status</th>
                <th className="text-right px-3 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => {
                const clientsCount = (w.client_ids || []).length;
                return (
                  <tr key={w.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`worker-row-${w.id}`}>
                    <td className="px-3 py-3"><input type="checkbox" checked={selected.has(w.id)} onChange={() => toggleSel(w.id)} className="w-3.5 h-3.5" /></td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{fullName(w)}</div>
                      {w.position && <div className="text-xs text-slate-500 mt-0.5">{w.position}</div>}
                    </td>
                    <td className="px-3 py-3 text-slate-600 hidden md:table-cell">{w.email || '—'}</td>
                    <td className="px-3 py-3 text-slate-500 hidden lg:table-cell">{w.mobile || w.phone || '—'}</td>
                    <td className="px-3 py-3"><CompanyChip label={w.company_label} /></td>
                    <td className="px-3 py-3 hidden xl:table-cell">
                      <div className="inline-flex items-center gap-1.5">
                        {w.state ? (
                          <span data-testid={`chip-state-${w.id}`}
                            className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                            <MapPin size={9} /> {w.state}
                          </span>
                        ) : null}
                        {clientsCount > 0 ? (
                          <span data-testid={`chip-clients-${w.id}`}
                            className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#e6eff9] text-[#1e4a8c]">
                            <Users size={9} /> {clientsCount}
                          </span>
                        ) : null}
                        {!w.state && clientsCount === 0 && <span className="text-[11px] text-slate-300">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3"><StatusBadge active={w.active} /></td>
                    <td className="px-3 py-3 text-right">
                      {canEdit && confirmDelete !== w.id && (
                        <div className="inline-flex gap-1 items-center">
                          <button onClick={() => setEditing(w)} title="Edit" data-testid={`edit-${w.id}`}
                            className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4]"><Edit3 size={13} /></button>
                          <button onClick={() => setConfirmDelete(w.id)} title="Delete" data-testid={`delete-${w.id}`}
                            className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#fbe4e7] text-[#7a1f33] hover:bg-[#f4c7cd]"><Trash2 size={13} /></button>
                        </div>
                      )}
                      {canEdit && confirmDelete === w.id && (
                        <span className="inline-flex items-center gap-1 bg-[#fbe4e7] border border-[#e69aa3] rounded px-2 py-1">
                          <span className="text-[10px] font-semibold text-[#7a1f33] uppercase tracking-wider">Delete?</span>
                          <button onClick={() => remove(w)} data-testid={`delete-confirm-${w.id}`} className="text-[10px] font-semibold text-[#7a1f33] hover:underline">Yes</button>
                          <button onClick={() => setConfirmDelete(null)} className="text-[10px] text-slate-500 hover:underline">No</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditModal worker={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}
