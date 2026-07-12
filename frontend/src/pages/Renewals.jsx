import React, { useEffect, useMemo, useState } from 'react';
import { HelpCircle, Loader2, Settings, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { copyToClipboard } from '../lib/clipboard';
import { PageHeader, PrimaryButton, GhostButton, Field, inputClass, EmptyState, StatusBadge } from '../components/capture/Ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import EmailButton from '../components/EmailButton';
import DeleteRecordButton from '../components/DeleteRecordButton';
import { getUser } from '../lib/auth';
import SimproSupplierImportModal from '../components/SimproSupplierImportModal';
// v160.3.6w — Onboarding guide + AlertDialog for the bulk-delete confirm.
import RenewalLinksGuide from '../components/renewals/RenewalLinksGuide';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '../components/ui/alert-dialog';

// Phase 3.20 Wave 2 — lucide row-action/toolbar icons swapped
// to @fluentui/react-icons. Aliased back to the original lucide
// names so existing JSX call sites don't need to change.
import {
  Add20Regular as Plus,
  ArrowDownload20Regular as Download,
  Copy20Regular as Copy,
  Delete20Regular as Trash2,
  Edit20Regular as Pencil,
  Warning20Filled,
  Save20Regular,
} from '@fluentui/react-icons';

const WRITE_ROLES = new Set(['admin', 'hseq_lead', 'manager']);
const IMPORT_ROLES = new Set(['admin', 'manager']);

// v160.3.6j — Same relative-days chip pattern used across the app (v6f/v6g).
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d.setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
}

// v160.3.6j — Twin of the SortHeaderBtn on Workers/Certifications.
function SortHeaderBtn({ label, k, sortKey, sortDir, onClick }) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      data-testid={`renewal-sort-${k}`}
      onClick={() => onClick(k)}
      className={
        'inline-flex items-center gap-1 uppercase tracking-wider text-[10px] font-semibold text-left ' +
        (active ? 'text-[#1e4a8c]' : 'text-slate-500 hover:text-slate-700')
      }
    >
      {label}
      <Icon size={10} className={active ? '' : 'opacity-50'} />
    </button>
  );
}

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
  // Phase 3.21 Item 2 — Needs-email banner. Re-counts on every contractors
  // refresh; sessionStorage flag lets the admin dismiss for this session.
  const [needsEmailDrawerOpen, setNeedsEmailDrawerOpen] = useState(false);
  const [needsEmailDismissed, setNeedsEmailDismissed] = useState(() => {
    try { return sessionStorage.getItem('paneltec_needs_email_dismissed') === '1'; } catch (_) { return false; }
  });
  const needsEmailList = useMemo(() => contractors.filter((c) => c.needs_email), [contractors]);
  const needsEmailCount = needsEmailList.length;
  const dismissBanner = () => {
    setNeedsEmailDismissed(true);
    try { sessionStorage.setItem('paneltec_needs_email_dismissed', '1'); } catch (_) { /* noop */ }
  };
  const refreshContractors = () => api.get('/contractors').then((r) => setContractors(r.data));

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

  // v160.3.6j — sortable columns on the grid layout.
  const [sortKey, setSortKey] = useState('contractor');
  const [sortDir, setSortDir] = useState('asc');

  // v160.3.6w — per-row selection + bulk delete (Outbox v6d pattern)
  const [selected, setSelected] = useState(() => new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };
  const sortedItems = useMemo(() => {
    const dir = sortDir === 'desc' ? -1 : 1;
    const arr = items.slice();
    const cmp = (a, b) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return String(a).localeCompare(String(b)) * dir;
    };
    if (sortKey === 'contractor')   arr.sort((a, b) => cmp((a.contractor_name || '').toLowerCase(), (b.contractor_name || '').toLowerCase()));
    else if (sortKey === 'subject') arr.sort((a, b) => cmp((a.subject || '').toLowerCase(), (b.subject || '').toLowerCase()));
    else if (sortKey === 'status')  arr.sort((a, b) => cmp(a.status || '', b.status || ''));
    else if (sortKey === 'expires') arr.sort((a, b) => cmp(a.expires_at || 'z', b.expires_at || 'z'));
    return arr;
  }, [items, sortKey, sortDir]);

  // v160.3.6w — selection helpers (mirrors Outbox v6d / ActiveSessions v6v)
  const visibleIds = sortedItems.map((r) => r.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = !allSelected && visibleIds.some((id) => selected.has(id));
  const toggleRow = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (visibleIds.every((id) => next.has(id))) {
      visibleIds.forEach((id) => next.delete(id));
    } else {
      visibleIds.forEach((id) => next.add(id));
    }
    return next;
  });
  const clearSelection = () => setSelected(new Set());
  const doBulkDelete = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setBulkBusy(true);
    try {
      const { data } = await api.post('/renewals/bulk-delete', { ids });
      const n = data?.deleted || 0;
      const missing = data?.not_found?.length || 0;
      let msg = `${n} renewal link${n === 1 ? '' : 's'} deleted`;
      if (missing > 0) msg += ` · ${missing} already gone`;
      toast.success(msg);
      setBulkConfirmOpen(false);
      clearSelection();
      await load();
    } catch (e) { toast.error(apiError(e) || 'Bulk delete failed'); }
    finally { setBulkBusy(false); }
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

      {/* v160.3.6w — Feature purpose + how-to guide (collapsible, default open) */}
      <RenewalLinksGuide />

      {needsEmailCount > 0 && !needsEmailDismissed && (
        <div data-testid="needs-email-banner"
          className="mb-4 flex items-start gap-3 rounded-xl border border-amber-400 bg-amber-100 px-4 py-3 text-amber-900">
          <Warning20Filled className="shrink-0 mt-0.5 text-amber-700" />
          <div className="flex-1 min-w-0 text-sm">
            <span data-testid="needs-email-count" className="font-semibold">{needsEmailCount} contractor{needsEmailCount === 1 ? '' : 's'}</span>{' '}
            {needsEmailCount === 1 ? 'is' : 'are'} missing an email. Add their email before sending a renewal link.
          </div>
          <button onClick={() => setNeedsEmailDrawerOpen(true)} data-testid="needs-email-fix-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700">
            Fix now →
          </button>
          <button onClick={dismissBanner} aria-label="Dismiss"
            className="text-amber-800/70 hover:text-amber-900 rounded-md p-1"><X size={14} /></button>
        </div>
      )}
      {items.length === 0 ? <EmptyState title="No renewal links yet" body="Create a link and send it to a contractor." />
       : (
        // v160.3.6j — CSS-Grid card-row layout (Path B pattern shared with
        // Workers v6e / Certifications v6f/g). Header + rows share one
        // gridTemplateColumns so columns cannot drift, "Email link" no longer
        // wraps to two lines, and every action button is a normalised 32×32
        // icon-only pill colour-coded by role (blue Email, slate Copy/Edit,
        // rose Revoke/Delete). Tooltip on hover carries the full label.
        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto" data-testid="renewals-grid">
          <div className="min-w-[900px]">
            {/* Sort header row */}
            <div
              className="grid items-center bg-slate-50 border-b border-slate-200 text-slate-500 text-[10px] uppercase tracking-wider px-4 py-3 gap-3"
              style={{ gridTemplateColumns: '32px minmax(180px, 1.4fr) minmax(240px, 2fr) 120px minmax(140px, 1fr) 200px' }}
            >
              {/* v160.3.6w — master checkbox */}
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={toggleAll}
                disabled={visibleIds.length === 0 || !canEdit}
                aria-label={allSelected ? 'Deselect all visible renewal links' : 'Select all visible renewal links'}
                data-testid="renewals-select-all"
                className="w-3.5 h-3.5 cursor-pointer disabled:opacity-40"
              />
              <SortHeaderBtn label="Contractor" k="contractor" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeaderBtn label="Subject / Docs" k="subject" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeaderBtn label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeaderBtn label="Expires" k="expires" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <div className="text-right">Action</div>
            </div>
            {sortedItems.map((r) => {
              const d = daysUntil(r.expires_at);
              const isSelected = selected.has(r.id);
              return (
                <div key={r.id} data-testid={`renewal-row-${r.id}`}
                  className={`grid items-center border-t border-slate-100 px-4 py-3 gap-3 ${isSelected ? 'bg-[#e6eff9]/40' : 'hover:bg-slate-50'}`}
                  style={{ gridTemplateColumns: '32px minmax(180px, 1.4fr) minmax(240px, 2fr) 120px minmax(140px, 1fr) 200px' }}>
                  {/* v160.3.6w — per-row checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRow(r.id)}
                    disabled={!canEdit}
                    aria-label={`Select ${r.contractor_name}'s renewal link`}
                    data-testid={`renewal-select-${r.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="w-3.5 h-3.5 cursor-pointer disabled:opacity-40"
                  />
                  {/* Contractor */}
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{r.contractor_name}</div>
                    {r.contractor_email && (
                      <div className="text-[11px] text-slate-500 truncate" title={r.contractor_email}>{r.contractor_email}</div>
                    )}
                  </div>
                  {/* Subject / Docs */}
                  <div className="min-w-0 text-xs text-slate-600">
                    {r.subject && <div className="font-semibold text-slate-700 mb-0.5 truncate" title={r.subject}>{r.subject}</div>}
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
                  </div>
                  {/* Status */}
                  <div className="min-w-0"><StatusBadge value={r.status} /></div>
                  {/* Expires */}
                  <div className="min-w-0 text-xs">
                    <div className="text-slate-700">{(r.expires_at || '').slice(0, 10) || '—'}</div>
                    {r.expires_at && d !== null && (
                      <div
                        className={`inline-flex items-center gap-0.5 mt-0.5 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          d < 0
                            ? 'bg-[#fbe4e7] text-[#7a1f33] border border-[#e69aa3]'
                            : d <= 7
                              ? 'bg-[#fef3c7] text-[#92400e] border border-[#f6d99e]'
                              : 'bg-[#e6eff9] text-[#1e4a8c] border border-[#b9d2ec]'
                        }`}
                      >
                        {d < 0 ? `${Math.abs(d)}d ago` : d === 0 ? 'today' : `in ${d}d`}
                      </div>
                    )}
                  </div>
                  {/* Actions — every button is a 32×32 icon-only pill colour-coded by role. */}
                  <div className="flex items-center justify-end gap-1 flex-wrap">
                    {r.status === 'pending' && (
                      <>
                        <EmailButton
                          resourceKind="renewals"
                          recordId={r.id}
                          subject={r.subject || `Document Renewal Request — Paneltec Civil`}
                          body={r.message || `Hi ${r.contractor_name},\n\nPlease re-submit the following document(s) via the secure link below:\n${(r.doc_types_requested || []).map((t) => typeLabel[t] || t).join(', ')}\n\nThe link expires on ${(r.expires_at || '').slice(0, 10)}.\n\nThanks,\nPaneltec Civil`}
                          recipients={r.contractor_email ? [r.contractor_email] : []}
                          variant="primary" size="sm" label=""
                          className="!inline-flex !items-center !justify-center !w-8 !h-8 !p-0 !rounded-lg !bg-[#1e4a8c] hover:!bg-[#163a70]"
                        />
                        <button onClick={() => copyToClipboard(r.public_url, { successMsg: 'Link copied' })}
                          title="Copy public link"
                          aria-label="Copy public link"
                          data-testid={`renewal-copy-${r.id}`}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                          <Copy />
                        </button>
                      </>
                    )}
                    {canEdit && r.status !== 'used' && (
                      <button onClick={() => setEditing({ ...r, expires_date: (r.expires_at || '').slice(0, 10) })}
                        data-testid={`renewal-edit-${r.id}`} title="Edit renewal link" aria-label="Edit renewal link"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-[#1e4a8c]">
                        <Pencil />
                      </button>
                    )}
                    {canEdit && r.status === 'pending' && (
                      <button onClick={() => revoke(r.id)}
                        title="Revoke renewal link" aria-label="Revoke renewal link"
                        data-testid={`revoke-${r.id}`}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50">
                        <X size={13} />
                      </button>
                    )}
                    {canEdit && (
                      <DeleteRecordButton resourceKind="renewals" apiPath="renewals" recordId={r.id} label="Renewal link" recordTitle={r.contractor_name} iconOnly onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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
              <button onClick={() => copyToClipboard(created.public_url, { successMsg: 'Link copied' })} className="text-xs text-brand-blue hover:underline">Copy link</button>
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

      <NeedsEmailDrawer open={needsEmailDrawerOpen} contractors={needsEmailList}
        onClose={() => setNeedsEmailDrawerOpen(false)}
        onSaved={() => { refreshContractors(); }} />
    </div>
  );
}

function NeedsEmailDrawer({ open, contractors, onClose, onSaved }) {
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial = {};
    contractors.forEach((c) => { initial[c.id] = c.email || c.contact_email || ''; });
    setDrafts(initial);
  }, [open, contractors]);

  if (!open) return null;

  const dirty = contractors.filter((c) => (drafts[c.id] || '').trim() && (drafts[c.id] || '').trim() !== (c.email || c.contact_email || ''));

  const saveAll = async () => {
    if (dirty.length === 0) { toast.info('No changes to save'); return; }
    setSaving(true);
    let okCount = 0;
    for (const c of dirty) {
      const email = (drafts[c.id] || '').trim();
      if (!email) continue;
      try {
        await api.patch(`/contractors/${c.id}`, { email });
        okCount += 1;
      } catch (e) { toast.error(`${c.name}: ${apiError(e)}`); }
    }
    setSaving(false);
    if (okCount > 0) {
      toast.success(`Saved email for ${okCount} contractor${okCount === 1 ? '' : 's'}`);
      onSaved?.();
    }
    if (okCount === dirty.length) onClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose} data-testid="needs-email-drawer">
      <div className="flex-1 bg-slate-900/50" />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-amber-700">Compliance</div>
            <h2 className="font-display text-xl font-semibold text-slate-900">Add missing contractor emails</h2>
            <p className="text-xs text-slate-500 mt-0.5">{contractors.length} contractor{contractors.length === 1 ? '' : 's'} need an email before you can send a renewal link.</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 p-1"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {contractors.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-200 px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="text-sm font-medium text-slate-900 truncate flex-1">{c.name}</div>
                {c.abn && <span className="text-[10px] uppercase tracking-wider text-slate-500">ABN {c.abn}</span>}
                {c.simpro_vendor_id && <span className="text-[10px] uppercase tracking-wider font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">Simpro</span>}
              </div>
              <input type="email" placeholder="contractor@example.com"
                value={drafts[c.id] || ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                data-testid={`needs-email-input-${c.id}`}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700">Cancel</button>
          <button onClick={saveAll} disabled={saving || dirty.length === 0} data-testid="needs-email-save-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50">
            <Save20Regular /> {saving ? 'Saving…' : `Save all (${dirty.length})`}
          </button>
        </div>
      </div>
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
