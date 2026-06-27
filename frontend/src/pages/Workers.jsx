// Workers (Phase 1) — field-ops directory. Pulls from Simpro per company
// (Paneltec=2, Viatec=3) and supports manual entries.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, Download, Edit3, HardHat, Loader2, Plug, Plus,
  RefreshCw, Search, Trash2, X,
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

function fullName(w) { return `${w.first_name || ''} ${w.last_name || ''}`.trim() || '(unnamed)'; }

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
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    if (!f.first_name.trim()) return;
    setSaving(true);
    try {
      if (isNew) {
        await api.post('/workers', f);
        toast.success('Worker added');
      } else {
        await api.patch(`/workers/${worker.id}`, f);
        toast.success('Worker updated');
      }
      onSaved();
    } catch (err) { toast.error(apiError(err)); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="worker-edit-modal">
      <form onSubmit={submit} className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-[#e6eff9]">
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#1e4a8c]">{isNew ? 'New worker' : 'Edit worker'}</div>
          <h2 className="font-display text-xl font-semibold text-slate-900 mt-0.5">{isNew ? 'Add worker' : fullName(worker)}</h2>
        </div>
        {isSimpro && (
          <div className="px-6 py-2 text-xs text-[#1e4a8c] bg-[#e6eff9]/60 border-b border-[#b9d2ec] flex items-center gap-1.5">
            <Plug size={12} /> Synced from Simpro — name and email get overwritten on the next sync.
          </div>
        )}
        <div className="px-6 py-5 grid grid-cols-2 gap-3 text-sm">
          <label><span className="block text-xs font-medium text-slate-700 mb-1">First name *</span>
            <input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })}
              data-testid="worker-first-name"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg" required /></label>
          <label><span className="block text-xs font-medium text-slate-700 mb-1">Last name</span>
            <input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })}
              data-testid="worker-last-name"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
          <label className="col-span-2"><span className="block text-xs font-medium text-slate-700 mb-1">Email</span>
            <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })}
              data-testid="worker-email"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
          <label><span className="block text-xs font-medium text-slate-700 mb-1">Phone</span>
            <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })}
              data-testid="worker-phone"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
          <label><span className="block text-xs font-medium text-slate-700 mb-1">Mobile</span>
            <input value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })}
              data-testid="worker-mobile"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
          <label className="col-span-2"><span className="block text-xs font-medium text-slate-700 mb-1">Position</span>
            <input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })}
              data-testid="worker-position"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
          <label className="col-span-2 inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })}
              data-testid="worker-active-toggle" className="w-4 h-4 rounded text-emerald-500" />
            <span className="text-sm text-slate-700">Active</span>
          </label>
          <div className="col-span-2 text-[11px] text-slate-400 mt-1">
            Address, birth date, availability and clients ship in Phase 2.
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100" data-testid="modal-cancel">Cancel</button>
          <button type="submit" disabled={saving} data-testid="modal-save"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#143263] disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} {isNew ? 'Create' : 'Update'}
          </button>
        </div>
      </form>
    </div>
  );
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv(rows) {
  const headers = ['first_name', 'last_name', 'email', 'phone', 'mobile', 'position', 'company_label', 'active', 'simpro_employee_id'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => csvCell(r[h])).join(','));
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
      const blob = `${fullName(r)} ${r.email || ''} ${r.phone || ''} ${r.mobile || ''}`.toLowerCase();
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
            placeholder="Search by name, email or phone…" data-testid="search-input"
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
                <th className="text-left px-3 py-3">Status</th>
                <th className="text-right px-3 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`worker-row-${w.id}`}>
                  <td className="px-3 py-3"><input type="checkbox" checked={selected.has(w.id)} onChange={() => toggleSel(w.id)} className="w-3.5 h-3.5" /></td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-slate-900">{fullName(w)}</div>
                    {w.position && <div className="text-xs text-slate-500 mt-0.5">{w.position}</div>}
                  </td>
                  <td className="px-3 py-3 text-slate-600 hidden md:table-cell">{w.email || '—'}</td>
                  <td className="px-3 py-3 text-slate-500 hidden lg:table-cell">{w.mobile || w.phone || '—'}</td>
                  <td className="px-3 py-3"><CompanyChip label={w.company_label} /></td>
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
              ))}
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
