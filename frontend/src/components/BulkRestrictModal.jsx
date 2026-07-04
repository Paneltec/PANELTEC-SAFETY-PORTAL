// v159.4 — Bulk restrict modal (Doc Library toolbar action).
//
// Wraps `POST /api/permissions/bulk-restrict` in a searchable multi-select
// dialog. Used by the Document Library "Restrict access" toolbar and
// designed to be reusable — pass a different `resource`/`action` prop and
// it becomes a generic bulk-deny UI.
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ShieldOff, Search as SearchIcon, X } from 'lucide-react';
import api, { apiError } from '../lib/api';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog';

const ROLE_LABEL = { admin: 'Admin', hseq_lead: 'HSEQ Lead', supervisor: 'Supervisor', worker: 'Worker', contractor: 'Contractor', auditor: 'Auditor' };

export default function BulkRestrictModal({
  open, onClose,
  resource = 'documents', action = 'view',
  resourceLabel = 'Document Library',
  onApplied,
}) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setQuery('');
    setRoleFilter('');
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/users');
        setUsers(data || []);
      } catch (e) { toast.error(apiError(e)); }
      finally { setLoading(false); }
    })();
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users || []).filter((u) => {
      if (roleFilter && (u.role || '').toLowerCase() !== roleFilter) return false;
      if (!q) return true;
      return (u.name || '').toLowerCase().includes(q)
          || (u.email || '').toLowerCase().includes(q)
          || (u.role || '').toLowerCase().includes(q);
    });
  }, [users, query, roleFilter]);

  const toggle = (id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllVisible = () => {
    setSelected((s) => {
      const next = new Set(s);
      const visibleIds = filtered.map((u) => u.id);
      const allIn = visibleIds.every((id) => next.has(id));
      if (allIn) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const apply = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const r = await api.post('/permissions/bulk-restrict', {
        user_ids: Array.from(selected),
        resource, action, value: false,
        reason: `Bulk restrict from ${resourceLabel} toolbar`,
      });
      toast.success(`Restricted ${r.data.updated} user${r.data.updated === 1 ? '' : 's'} from ${resourceLabel}.`);
      onApplied?.(r.data);
      onClose?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid="bulk-restrict-modal" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ShieldOff size={18} className="text-orange-600" />
            Restrict {resourceLabel} access
          </DialogTitle>
          <DialogDescription>
            Deny selected users the ability to view the {resourceLabel}.
            They will lose access immediately on their next request.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                data-testid="bulk-restrict-search"
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, email or role…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/30"
              />
            </div>
            <select
              value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
              data-testid="bulk-restrict-role-filter"
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="">All roles</option>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
            <button onClick={toggleAllVisible} type="button" data-testid="bulk-restrict-toggle-all"
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
              Select all visible ({filtered.length})
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
            {loading ? (
              <div className="p-6 text-center text-sm text-slate-500">Loading users…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">No users match.</div>
            ) : filtered.map((u, i) => {
              const on = selected.has(u.id);
              return (
                <label key={u.id}
                  data-testid={`bulk-restrict-user-${u.id}`}
                  className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50 ${on ? 'bg-orange-50' : (i % 2 ? 'bg-slate-50/40' : '')}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(u.id)}
                    className="w-4 h-4 accent-orange-600" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-800 truncate">{u.name || '—'}</div>
                    <div className="text-xs text-slate-500 truncate">{u.email}</div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 px-2 py-0.5 rounded-full bg-slate-100">
                    {ROLE_LABEL[u.role] || u.role}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-[12px] text-orange-900 leading-relaxed" data-testid="bulk-restrict-warning">
            <strong>Restricting {selected.size} user{selected.size === 1 ? '' : 's'}.</strong>
            &nbsp;This applies <code className="px-1 bg-white rounded border border-orange-200">{resource}.{action} = deny</code> to each selected user's overrides.
            Existing overrides on other resources are preserved.
          </div>
        </div>

        <DialogFooter>
          <button onClick={() => onClose?.()} type="button"
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700">
            <X size={12} className="inline mr-1" /> Cancel
          </button>
          <button onClick={apply} disabled={busy || selected.size === 0}
            data-testid="bulk-restrict-apply"
            className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 disabled:opacity-60">
            <ShieldOff size={12} className="inline mr-1" />
            {busy ? 'Applying…' : `Deny access to ${selected.size} user${selected.size === 1 ? '' : 's'}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
