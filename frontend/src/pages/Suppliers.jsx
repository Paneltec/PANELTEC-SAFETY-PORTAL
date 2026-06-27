// Suppliers (Simpro Vendors) — pastel-themed table.
//
// Phase 1: live read from Simpro `/api/integrations/simpro/suppliers`, merged
// with org-local `supplier_meta` (active_override, location_on_map,
// parent_supplier_id, custom contact / phone / address / state / notes).
// Edit modal patches `supplier_meta`. CSV export. Search-by dropdown.
//
// MOCKED / Phase 2: Tasks, Notes, Folders, Members icon buttons currently
// show a "Coming soon" toast — backed collections exist but no UI yet.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckSquare, ChevronDown, Download, Edit3, Eye, FolderOpen, Loader2,
  Mail, MapPin, Plug, RefreshCw, Search, StickyNote, Trash2, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader, EmptyState } from '../components/capture/Ui';
import SupplierDrawer from '../components/suppliers/SupplierDrawer';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);
const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

// Apply org-local meta on top of the live Simpro feed.
function mergeSupplier(s, meta) {
  const m = meta || {};
  const activeFinal = m.active_override === null || m.active_override === undefined
    ? !!s.active : !!m.active_override;
  return {
    ...s,
    contact_name: m.custom_contact ?? s.contact_name,
    phone: m.custom_phone ?? s.phone,
    address: m.custom_address ?? s.address,
    state: m.custom_state ?? s.state,
    parent_supplier_id: m.parent_supplier_id || null,
    location_on_map: !!m.location_on_map,
    active_final: activeFinal,
    notes: m.notes || '',
  };
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(rows, cachedAt) {
  const headers = [
    'simpro_supplier_id', 'name', 'phone', 'address', 'state', 'contact_name',
    'email', 'active', 'location_on_map', 'parent_supplier_id', 'last_synced_at',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      csvCell(r.simpro_supplier_id), csvCell(r.name), csvCell(r.phone),
      csvCell(r.address), csvCell(r.state), csvCell(r.contact_name),
      csvCell(r.email), csvCell(r.active_final), csvCell(r.location_on_map),
      csvCell(r.parent_supplier_id || ''), csvCell(cachedAt || ''),
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `suppliers-export-${today}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function StatusBadge({ active }) {
  if (active) {
    return <span data-testid="status-active" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]">Active</span>;
  }
  return <span data-testid="status-inactive" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border bg-slate-100 text-slate-600 border-slate-200">Inactive</span>;
}

function IconChip({ pastel, title, onClick, children, testid, count }) {
  const tints = {
    butter:   'bg-[#fbf3df] text-[#8c6a1a] hover:bg-[#f7eed1]',
    sky:      'bg-[#e6eff9] text-[#1e4a8c] hover:bg-[#d8e6f4]',
    lavender: 'bg-[#ece6f4] text-[#4f3a8c] hover:bg-[#e2dcef]',
    peach:    'bg-[#fbeadf] text-[#a8480f] hover:bg-[#f7dfd1]',
    coral:    'bg-[#fbe4dc] text-[#a83a2e] hover:bg-[#f7d8d1]',
    blush:    'bg-[#fbe4e7] text-[#7a1f33] hover:bg-[#f4c7cd]',
  };
  return (
    <button type="button" onClick={onClick} title={title} data-testid={testid}
      className={`relative inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${tints[pastel] || tints.sky}`}>
      {children}
      {count > 0 && (
        <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[9px] font-bold rounded-full bg-slate-900 text-white inline-flex items-center justify-center leading-none`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

function ToggleSwitch({ checked, onChange, testid }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} data-testid={testid}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-emerald-400' : 'bg-slate-300'}`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
    </button>
  );
}

function EditModal({ supplier, allSuppliers, onClose, onSaved }) {
  const [form, setForm] = useState({
    custom_contact: supplier.contact_name || '',
    custom_phone: supplier.phone || '',
    custom_address: supplier.address || '',
    custom_state: supplier.state || '',
    parent_supplier_id: supplier.parent_supplier_id || '',
    active_override: supplier.active_final,
    notes: supplier.notes || '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/suppliers/${supplier.simpro_supplier_id}/meta`, {
        custom_contact: form.custom_contact || null,
        custom_phone: form.custom_phone || null,
        custom_address: form.custom_address || null,
        custom_state: form.custom_state || null,
        parent_supplier_id: form.parent_supplier_id || null,
        active_override: form.active_override,
        notes: form.notes || null,
      });
      toast.success('Supplier updated');
      onSaved();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="supplier-edit-modal">
      <form onSubmit={submit} className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-[#e8efe2]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#2e5e2e]">Edit Supplier</div>
            <h2 className="font-display text-xl font-semibold text-slate-900 mt-0.5">{supplier.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded text-slate-500 hover:bg-white" data-testid="modal-close">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pt-3 pb-1 text-xs text-slate-500 flex items-start gap-2 bg-[#fbf3df] border-b border-[#e6d99c]">
          <Plug size={12} className="mt-0.5 shrink-0 text-[#8c6a1a]" />
          <span>Name and Simpro ID are synced from Simpro and can&rsquo;t be edited here. Everything below is org-local and won&rsquo;t write back to Simpro.</span>
        </div>

        <div className="px-6 py-5 grid grid-cols-2 gap-4 text-sm">
          <label className="col-span-2">
            <span className="block text-xs font-medium text-slate-700 mb-1">Address</span>
            <textarea rows={2} value={form.custom_address}
              onChange={(e) => setForm({ ...form, custom_address: e.target.value })}
              data-testid="supplier-address-input"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
          </label>
          <label>
            <span className="block text-xs font-medium text-slate-700 mb-1">State</span>
            <select value={form.custom_state}
              onChange={(e) => setForm({ ...form, custom_state: e.target.value })}
              data-testid="supplier-state-select"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30">
              <option value="">—</option>
              {AU_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            <span className="block text-xs font-medium text-slate-700 mb-1">Phone</span>
            <input value={form.custom_phone}
              onChange={(e) => setForm({ ...form, custom_phone: e.target.value })}
              data-testid="supplier-phone-input"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
          </label>
          <label className="col-span-2">
            <span className="block text-xs font-medium text-slate-700 mb-1">Contact name</span>
            <input value={form.custom_contact}
              onChange={(e) => setForm({ ...form, custom_contact: e.target.value })}
              data-testid="supplier-contact-input"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
          </label>
          <label className="col-span-2">
            <span className="block text-xs font-medium text-slate-700 mb-1">Parent supplier</span>
            <select value={form.parent_supplier_id}
              onChange={(e) => setForm({ ...form, parent_supplier_id: e.target.value })}
              data-testid="supplier-parent-select"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30">
              <option value="">No parent</option>
              {allSuppliers
                .filter((s) => s.simpro_supplier_id !== supplier.simpro_supplier_id)
                .map((s) => <option key={s.simpro_supplier_id} value={s.simpro_supplier_id}>{s.name}</option>)}
            </select>
          </label>
          <label className="col-span-2">
            <span className="block text-xs font-medium text-slate-700 mb-1">Notes</span>
            <textarea rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              data-testid="supplier-notes-input"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
          </label>
          <label className="col-span-2 inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!form.active_override}
              onChange={(e) => setForm({ ...form, active_override: e.target.checked })}
              data-testid="supplier-active-checkbox"
              className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-400" />
            <span className="text-sm text-slate-700">Active</span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button type="button" onClick={onClose} data-testid="modal-cancel"
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={saving} data-testid="modal-update"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold uppercase tracking-wider hover:bg-blue-600 disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Update
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Suppliers() {
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);

  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [rawSuppliers, setRawSuppliers] = useState([]);
  const [metaMap, setMetaMap] = useState({});
  const [counts, setCounts] = useState({});
  const [cachedAt, setCachedAt] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState(null);
  const [drawerSupplier, setDrawerSupplier] = useState(null);
  const [drawerPanel, setDrawerPanel] = useState('tasks');
  const [renewalFor, setRenewalFor] = useState(null);
  const [selected, setSelected] = useState(new Set());

  const [searchBy, setSearchBy] = useState('name');
  const [searchQ, setSearchQ] = useState('');
  const [searchByOpen, setSearchByOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [supRes, metaRes] = await Promise.all([
        api.get('/integrations/simpro/suppliers'),
        api.get('/suppliers/meta'),
      ]);
      setRawSuppliers(supRes.data.suppliers || []);
      setConnected(supRes.data.connected !== false);
      setCachedAt(supRes.data.cached_at);
      setMetaMap(metaRes.data || {});
    } catch (e) {
      toast.error(apiError(e));
      setConnected(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/integrations/simpro/suppliers/sync');
      toast.success(`Synced ${data.count} suppliers from Simpro`);
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSyncing(false);
    }
  };

  const merged = useMemo(
    () => rawSuppliers.map((s) => mergeSupplier(s, metaMap[s.simpro_supplier_id])),
    [rawSuppliers, metaMap],
  );

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter((s) => {
      const field = (s[searchBy] || '').toString().toLowerCase();
      return field.includes(q);
    });
  }, [merged, searchBy, searchQ]);

  const toggleSelect = (sid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid); else next.add(sid);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected((prev) => prev.size === filtered.length ? new Set() : new Set(filtered.map((s) => s.simpro_supplier_id)));
  };

  const toggleMap = async (s) => {
    if (!canEdit) return;
    try {
      await api.patch(`/suppliers/${s.simpro_supplier_id}/meta`, { location_on_map: !s.location_on_map });
      setMetaMap((prev) => ({
        ...prev,
        [s.simpro_supplier_id]: { ...(prev[s.simpro_supplier_id] || {}), location_on_map: !s.location_on_map },
      }));
    } catch (e) { toast.error(apiError(e)); }
  };

  const phase2 = (label) => () => toast.info(`${label} — coming in Phase 2`);

  const openDrawer = (s, panel) => { setDrawerSupplier(s); setDrawerPanel(panel); };

  const exportCsv = () => downloadCsv(filtered, cachedAt);

  // ----- Empty / disconnected state -----
  if (!loading && !connected) {
    return (
      <div className="max-w-7xl mx-auto" data-testid="suppliers-page">
        <PageHeader crumb="Compliance / Suppliers" title="Suppliers"
          subtitle="Sourced live from Simpro. Org-local notes and overrides stay in Paneltec." />
        <EmptyState title="Simpro isn't connected"
          body="Suppliers are sourced from your Simpro account. Connect Simpro to populate this list."
          action={canEdit ? (
            <Link to="/app/settings/integrations" data-testid="connect-simpro"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600">
              <Plug size={14} /> Connect Simpro
            </Link>
          ) : null} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto" data-testid="suppliers-page">
      <PageHeader crumb="Compliance / Suppliers" title="Suppliers"
        subtitle="Sourced live from Simpro. Org-local notes and overrides stay in Paneltec." />

      {/* Toolbar */}
      <div className="mb-4 flex items-center gap-2 flex-wrap" data-testid="suppliers-toolbar">
        <div className="relative">
          <button type="button" onClick={() => setSearchByOpen((o) => !o)} data-testid="search-by-dropdown"
            className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg hover:bg-slate-50">
            Search by: <span className="font-medium capitalize">{searchBy.replace('_', ' ')}</span>
            <ChevronDown size={14} />
          </button>
          {searchByOpen && (
            <div className="absolute z-10 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
              {['name', 'phone', 'state'].map((f) => (
                <button key={f} type="button" onClick={() => { setSearchBy(f); setSearchByOpen(false); }}
                  data-testid={`search-by-${f}`}
                  className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 ${searchBy === f ? 'bg-slate-100 font-medium' : ''}`}>
                  {f === 'name' ? 'Supplier Name' : f === 'phone' ? 'Phone' : 'State'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
            placeholder={`Search by ${searchBy === 'name' ? 'supplier name' : searchBy}…`}
            data-testid="search-input"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
        </div>
        <button onClick={exportCsv} disabled={filtered.length === 0} data-testid="export-csv"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download size={14} /> Export CSV
        </button>
        {canEdit && (
          <button onClick={sync} disabled={syncing} data-testid="sync-simpro"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#ece6f4] text-[#4f3a8c] text-sm font-medium hover:bg-[#e2dcef] disabled:opacity-60">
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync from Simpro
          </button>
        )}
        <div className="flex-1" />
        {canEdit && (
          <button onClick={phase2('Create supplier')} data-testid="add-new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold uppercase tracking-wider hover:bg-blue-600">
            + Add New
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading suppliers…</div>
      ) : filtered.length === 0 ? (
        <EmptyState title={searchQ ? 'No suppliers match that search' : 'No suppliers from Simpro yet'}
          body={searchQ
            ? 'Try a different search term or clear the filter.'
            : 'Run a sync to pull suppliers from your Simpro account.'}
          action={canEdit && !searchQ ? (
            <button onClick={sync} disabled={syncing} data-testid="empty-sync"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#ece6f4] text-[#4f3a8c] text-sm font-medium hover:bg-[#e2dcef]">
              <RefreshCw size={14} /> Sync from Simpro
            </button>
          ) : null} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm" data-testid="suppliers-table">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll} data-testid="select-all" className="w-3.5 h-3.5 rounded" />
                </th>
                <th className="text-left px-3 py-3">Supplier Name</th>
                <th className="text-left px-3 py-3 hidden lg:table-cell">Created By</th>
                <th className="text-left px-3 py-3 hidden lg:table-cell">Created Date</th>
                <th className="text-center px-3 py-3">Tasks</th>
                <th className="text-center px-3 py-3">Notes</th>
                <th className="text-center px-3 py-3">Folders</th>
                <th className="text-center px-3 py-3">Members</th>
                <th className="text-center px-3 py-3">Location</th>
                <th className="text-left px-3 py-3">Status</th>
                <th className="text-right px-3 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.simpro_supplier_id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`supplier-row-${s.simpro_supplier_id}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selected.has(s.simpro_supplier_id)}
                      onChange={() => toggleSelect(s.simpro_supplier_id)}
                      data-testid={`row-select-${s.simpro_supplier_id}`}
                      className="w-3.5 h-3.5 rounded" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-slate-900">{s.name}</div>
                    {s.phone && <div className="text-xs text-slate-500 mt-0.5">{s.phone}</div>}
                  </td>
                  <td className="px-3 py-3 text-slate-500 hidden lg:table-cell">Simpro</td>
                  <td className="px-3 py-3 text-slate-500 hidden lg:table-cell">{(cachedAt || '').slice(0, 10) || '—'}</td>
                  <td className="px-3 py-3"><div className="flex justify-center">
                    <IconChip pastel="butter" title="Tasks" count={counts[s.simpro_supplier_id]?.tasks || 0}
                      onClick={() => openDrawer(s, 'tasks')} testid={`tasks-${s.simpro_supplier_id}`}><CheckSquare size={14} /></IconChip>
                  </div></td>
                  <td className="px-3 py-3"><div className="flex justify-center">
                    <IconChip pastel="sky" title="Notes" count={counts[s.simpro_supplier_id]?.notes || 0}
                      onClick={() => openDrawer(s, 'notes')} testid={`notes-${s.simpro_supplier_id}`}><StickyNote size={14} /></IconChip>
                  </div></td>
                  <td className="px-3 py-3"><div className="flex justify-center">
                    <IconChip pastel="lavender" title="Folders (Phase 2)" count={counts[s.simpro_supplier_id]?.folders || 0}
                      onClick={() => openDrawer(s, 'folders')} testid={`folders-${s.simpro_supplier_id}`}><FolderOpen size={14} /></IconChip>
                  </div></td>
                  <td className="px-3 py-3"><div className="flex justify-center">
                    <IconChip pastel="peach" title="Members" count={counts[s.simpro_supplier_id]?.members || 0}
                      onClick={() => openDrawer(s, 'members')} testid={`members-${s.simpro_supplier_id}`}><Users size={14} /></IconChip>
                  </div></td>
                  <td className="px-3 py-3"><div className="flex justify-center items-center gap-1">
                    <MapPin size={12} className="text-slate-400" />
                    <ToggleSwitch checked={!!s.location_on_map} onChange={() => toggleMap(s)} testid={`map-toggle-${s.simpro_supplier_id}`} />
                  </div></td>
                  <td className="px-3 py-3"><StatusBadge active={s.active_final} /></td>
                  <td className="px-3 py-3 text-right">
                    <div className="inline-flex gap-1 items-center">
                      <IconChip pastel="sky" title="Edit" onClick={() => canEdit && setEditing(s)} testid={`edit-${s.simpro_supplier_id}`}><Edit3 size={13} /></IconChip>
                      {canEdit && s.email && (
                        <IconChip pastel="lavender" title="Send renewal email" onClick={() => setRenewalFor(s)} testid={`renewal-${s.simpro_supplier_id}`}><Mail size={13} /></IconChip>
                      )}
                      <IconChip pastel="blush" title="Delete (Phase 2)" onClick={phase2('Delete supplier')} testid={`delete-${s.simpro_supplier_id}`}><Trash2 size={13} /></IconChip>
                      <IconChip pastel="coral" title="View" onClick={() => setEditing(s)} testid={`view-${s.simpro_supplier_id}`}><Eye size={13} /></IconChip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cachedAt && (
        <div className="mt-3 text-[11px] text-slate-400 text-right">
          Last synced from Simpro: {cachedAt.slice(0, 19).replace('T', ' ')}
        </div>
      )}

      {editing && (
        <EditModal supplier={editing} allSuppliers={merged}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
      {drawerSupplier && (
        <SupplierDrawer supplier={drawerSupplier} initialPanel={drawerPanel}
          onClose={() => setDrawerSupplier(null)}
          onChanged={load} />
      )}
      {renewalFor && (
        <RenewalEmailModal supplier={renewalFor}
          onClose={() => setRenewalFor(null)}
          onSent={() => setRenewalFor(null)} />
      )}
    </div>
  );
}

// ────────────────────── Renewal email modal ──────────────────────

function RenewalEmailModal({ supplier, onClose, onSent }) {
  const today = new Date();
  const due = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    recipient_email: supplier.email || '',
    subject: `Annual compliance renewal — ${supplier.name}`,
    body_html: `<p>Hi ${supplier.contact_name || supplier.name},</p>
<p>As part of our ongoing supplier compliance review, please confirm or update the following by <strong>${due}</strong>:</p>
<ul>
  <li>Current insurance certificates (public liability, workers compensation)</li>
  <li>Relevant licences and tickets for personnel performing work on site</li>
  <li>Safe Work Method Statements (SWMS) for high-risk activities</li>
  <li>Any other safety documentation we have on file</li>
</ul>
<p>You can reply to this email with attached documents, or upload them via the link we send separately.</p>
<p>Thanks for keeping us up to date.</p>
<p>— Paneltec Civil</p>`,
  });
  const [sending, setSending] = useState(false);

  const send = async (e) => {
    e?.preventDefault();
    if (!form.recipient_email.trim()) return;
    setSending(true);
    try {
      await api.post(`/suppliers/${supplier.simpro_supplier_id}/send-renewal`, form);
      toast.success(`Renewal email queued for ${supplier.name}`);
      onSent();
    } catch (err) { toast.error(apiError(err)); }
    finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="renewal-modal">
      <form onSubmit={send} className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="px-6 py-4 border-b border-slate-200 bg-[#ece6f4]">
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#4f3a8c]">Send renewal email</div>
          <h2 className="font-display text-xl font-semibold text-slate-900 mt-0.5">{supplier.name}</h2>
        </div>
        <div className="px-6 py-5 space-y-3 overflow-y-auto">
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">Recipient email</span>
            <input value={form.recipient_email} onChange={(e) => setForm({ ...form, recipient_email: e.target.value })}
              data-testid="renewal-recipient"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">Subject</span>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
              data-testid="renewal-subject"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">Body (HTML)</span>
            <textarea rows={10} value={form.body_html} onChange={(e) => setForm({ ...form, body_html: e.target.value })}
              data-testid="renewal-body"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg" />
          </label>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={sending} data-testid="renewal-send"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4f3a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#3f2e70] disabled:opacity-60">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Send
          </button>
        </div>
      </form>
    </div>
  );
}
