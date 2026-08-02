// v160.3.9.32-4b — Phase 4b Simpro selective-import picker.
//
// Fetches unlinked Simpro employees, lets admin search/filter/multi-select,
// then POSTs the chosen employee_ids to /admin/simpro/import-employees/selective.
// Imported users land as activation_status='active' (admin explicitly picked them).

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search as SearchIcon, X as XIcon, CheckSquare, Square, User as UserIcon } from 'lucide-react';
import api, { apiError } from '@/lib/api';

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?';
}

export default function SimproImportPickerModal({ onClose, onDone }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [includeLinked, setIncludeLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sortKey, setSortKey] = useState('name');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params = includeLinked ? '?include_linked=true' : '';
        const { data } = await api.get(`/admin/simpro/employees/available${params}`);
        setRows(data?.employees || []);
      } catch (e) {
        toast.error(apiError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [includeLinked]);

  // v160.3.9.32-4c.1 — ESC-key close (backdrop click already handled).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = t
      ? rows.filter((r) =>
          (r.name || '').toLowerCase().includes(t) ||
          (r.email || '').toLowerCase().includes(t) ||
          (r.position || '').toLowerCase().includes(t)
        )
      : rows;
    const sorted = [...base].sort((a, b) => {
      if (sortKey === 'position') return (a.position || '').localeCompare(b.position || '');
      if (sortKey === 'id') return (a.simpro_employee_id || '').localeCompare(b.simpro_employee_id || '');
      if (sortKey === 'linked') return Number(a.already_in_paneltec) - Number(b.already_in_paneltec) || (a.name || '').localeCompare(b.name || '');
      return (a.name || '').localeCompare(b.name || '');
    });
    return sorted;
  }, [rows, q, sortKey]);

  const selectableIds = useMemo(
    () => filtered.filter((r) => !r.already_in_paneltec).map((r) => r.simpro_employee_id),
    [filtered],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleAll = () => {
    setSelected((s) => {
      const n = new Set(s);
      if (allSelected) selectableIds.forEach((id) => n.delete(id));
      else selectableIds.forEach((id) => n.add(id));
      return n;
    });
  };

  const toggleOne = (id) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const submit = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const { data } = await api.post('/admin/simpro/import-employees/selective', {
        employee_ids: Array.from(selected),
      });
      toast.success(`Created ${data.created} · Updated ${data.updated} · Archived ${data.archived}`);
      onDone?.();
      onClose?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" data-testid="simpro-picker-modal">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-white shadow-2xl flex flex-col h-full">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <div className="text-[11px] uppercase tracking-widest font-semibold text-slate-500">
              Import from Simpro
            </div>
            <h2 className="text-2xl font-semibold text-slate-900">Choose employees to import</h2>
            <p className="text-sm text-slate-500 mt-1">
              Selected employees land as <b>active</b>. Set a password from the drawer once imported.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-md hover:bg-slate-100" data-testid="simpro-picker-close">
            <XIcon className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <SearchIcon className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, email or position…"
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
              data-testid="simpro-picker-search"
            />
          </div>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-2 py-2"
            data-testid="simpro-picker-sort"
          >
            <option value="name">Sort: Name A-Z</option>
            <option value="position">Sort: Position</option>
            <option value="id">Sort: Employee ID</option>
            <option value="linked">Sort: Already imported</option>
          </select>
          <label className="text-xs text-slate-600 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={includeLinked}
              onChange={(e) => setIncludeLinked(e.target.checked)}
              data-testid="simpro-picker-include-linked"
              className="rounded border-slate-300"
            />
            Show already imported
          </label>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left border-b border-slate-200">
                <th className="py-2 px-3 w-10">
                  <button type="button" onClick={toggleAll} data-testid="simpro-picker-toggle-all">
                    {allSelected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-slate-400" />}
                  </button>
                </th>
                <th className="py-2 px-3 font-medium text-slate-600">Employee</th>
                <th className="py-2 px-3 font-medium text-slate-600">Position</th>
                <th className="py-2 px-3 font-medium text-slate-600">Email</th>
                <th className="py-2 px-3 font-medium text-slate-600 w-24">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (<tr><td colSpan={5} className="text-center py-8 text-slate-500">Loading Simpro employees…</td></tr>)}
              {!loading && filtered.length === 0 && !includeLinked && rows.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10">
                  <div className="text-2xl mb-1">✓</div>
                  <div className="text-sm font-semibold text-slate-800">All Simpro employees are already in Paneltec.</div>
                  <div className="text-xs text-slate-500 mt-1 max-w-lg mx-auto">
                    To manage roles or permissions on existing users, close this and click a user in the list.
                    To bring in <b>new</b> employees, add them in Simpro first, then click Sync from Simpro.
                  </div>
                  <button type="button" onClick={() => setIncludeLinked(true)}
                    className="mt-3 text-xs text-blue-700 hover:underline"
                    data-testid="simpro-picker-show-imported">
                    Show already-imported employees anyway →
                  </button>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (includeLinked || rows.length > 0) && (
                <tr><td colSpan={5} className="text-center py-8 text-slate-500">No matches.</td></tr>
              )}
              {!loading && filtered.map((r) => {
                const isLinked = r.already_in_paneltec;
                const isSelected = selected.has(r.simpro_employee_id);
                return (
                  <tr key={r.simpro_employee_id} className="border-t border-slate-100 hover:bg-slate-50/60" data-testid={`simpro-picker-row-${r.simpro_employee_id}`}>
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isLinked}
                        onChange={() => toggleOne(r.simpro_employee_id)}
                        className="rounded border-slate-300"
                        data-testid={`simpro-picker-check-${r.simpro_employee_id}`}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-semibold">
                          <UserIcon className="w-3.5 h-3.5" style={{ display: 'none' }} />
                          {initials(r.name)}
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">{r.name || '—'}</div>
                          <div className="text-[11px] text-slate-500">Simpro #{r.simpro_employee_id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-slate-700">{r.position || <span className="text-slate-400">—</span>}</td>
                    <td className="py-2 px-3 text-slate-700">{r.email || <span className="text-slate-400">no email</span>}</td>
                    <td className="py-2 px-3">
                      {isLinked && <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px] border border-slate-200">Imported</span>}
                      {!isLinked && r.archived && <span className="rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-[11px] border border-amber-200">Archived</span>}
                      {!isLinked && !r.archived && <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] border border-emerald-200">Ready</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-white">
          <div className="text-xs text-slate-500">
            {selected.size} selected · {filtered.length} shown · {rows.length} total
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || selected.size === 0}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-40"
              data-testid="simpro-picker-submit"
            >
              {busy ? 'Importing…' : `Import ${selected.size} selected`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
