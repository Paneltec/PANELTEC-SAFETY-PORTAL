// SupplierDrawer — right-side drawer holding the Tasks / Notes / Members /
// Folders panels for a single supplier. Phase 2 wiring (Folders panel is a
// placeholder until next turn).
import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar, Check, CheckSquare, FolderOpen, Loader2, Pencil, Plus,
  StickyNote, Trash2, User as UserIcon, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '../ui/sheet';
import api, { apiError } from '../../lib/api';
import { getUser } from '../../lib/auth';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

const PANEL_THEMES = {
  tasks:   { name: 'Tasks',   icon: CheckSquare,  bg: 'bg-[#fbf3df]', ink: 'text-[#8c6a1a]' },
  notes:   { name: 'Notes',   icon: StickyNote,   bg: 'bg-[#e6eff9]', ink: 'text-[#1e4a8c]' },
  folders: { name: 'Folders', icon: FolderOpen,   bg: 'bg-[#ece6f4]', ink: 'text-[#4f3a8c]' },
  members: { name: 'Members', icon: Users,        bg: 'bg-[#fbeadf]', ink: 'text-[#a8480f]' },
};

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}
function fmtDate(s) { return s ? s.slice(0, 10) : ''; }
function isOverdue(due, status) {
  if (!due || status === 'done' || status === 'cancelled') return false;
  return due < new Date().toISOString().slice(0, 10);
}

// ────────────────────── Tasks panel ──────────────────────
function TasksPanel({ supplierId, canEdit, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null); // null | "new" | task object

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/suppliers/${supplierId}/tasks`);
      setItems(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supplierId]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((t) => t.status === filter);
  }, [items, filter]);

  const toggleDone = async (t) => {
    const next = t.status === 'done' ? 'open' : 'done';
    try {
      await api.patch(`/suppliers/tasks/${t.id}`, { status: next });
      await load(); onChanged?.();
    } catch (e) { toast.error(apiError(e)); }
  };

  const saveTask = async (form) => {
    try {
      if (editing === 'new') {
        await api.post(`/suppliers/${supplierId}/tasks`, form);
        toast.success('Task added');
      } else {
        await api.patch(`/suppliers/tasks/${editing.id}`, form);
        toast.success('Task updated');
      }
      setEditing(null); await load(); onChanged?.();
    } catch (e) { toast.error(apiError(e)); }
  };

  const remove = async (t) => {
    try {
      await api.delete(`/suppliers/tasks/${t.id}`);
      toast.success('Task deleted'); await load(); onChanged?.();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="tasks-panel">
      <div className="flex items-center gap-2 flex-wrap">
        {canEdit && (
          <button onClick={() => setEditing('new')} data-testid="task-add"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#8c6a1a] text-white text-xs font-medium hover:bg-[#6f5314]">
            <Plus size={12} /> Add task
          </button>
        )}
        <div className="flex gap-1 ml-auto">
          {['all', 'open', 'in_progress', 'done'].map((f) => (
            <button key={f} onClick={() => setFilter(f)} data-testid={`task-filter-${f}`}
              className={`text-[11px] px-2 py-1 rounded-full uppercase tracking-wider ${
                filter === f ? 'bg-[#fbf3df] text-[#8c6a1a] font-semibold' : 'text-slate-500 hover:bg-slate-100'
              }`}>{f.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      {editing === 'new' && <TaskForm onSave={saveTask} onCancel={() => setEditing(null)} />}

      {loading ? (
        <div className="text-xs text-slate-500"><Loader2 size={12} className="inline animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-slate-500 py-6 text-center bg-slate-50 rounded-lg">No tasks{filter !== 'all' ? ' in this status' : ''}.</div>
      ) : filtered.map((t) => (
        editing && editing.id === t.id ? (
          <TaskForm key={t.id} initial={t} onSave={saveTask} onCancel={() => setEditing(null)} />
        ) : (
          <div key={t.id} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`task-row-${t.id}`}>
            <div className="flex items-start gap-2">
              <button onClick={() => canEdit && toggleDone(t)} disabled={!canEdit}
                data-testid={`task-toggle-${t.id}`}
                className={`mt-0.5 w-4 h-4 rounded border ${t.status === 'done' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300'} flex items-center justify-center shrink-0`}>
                {t.status === 'done' && <Check size={11} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium ${t.status === 'done' ? 'line-through text-slate-400' : 'text-slate-900'}`}>{t.title}</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <PriorityBadge value={t.priority} />
                  {t.due_date && (
                    <span className={`text-[11px] inline-flex items-center gap-1 ${isOverdue(t.due_date, t.status) ? 'text-[#7a1f33] font-semibold' : 'text-slate-500'}`}>
                      <Calendar size={10} /> {fmtDate(t.due_date)}{isOverdue(t.due_date, t.status) ? ' · overdue' : ''}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">{t.status.replace('_', ' ')}</span>
                </div>
                {t.description && <p className="mt-2 text-xs text-slate-600 whitespace-pre-wrap">{t.description}</p>}
              </div>
              {canEdit && (
                <div className="flex gap-0.5 shrink-0">
                  <button onClick={() => setEditing(t)} data-testid={`task-edit-${t.id}`} className="p-1 rounded text-slate-400 hover:text-brand-blue hover:bg-slate-100"><Pencil size={11} /></button>
                  <button onClick={() => remove(t)} data-testid={`task-delete-${t.id}`} className="p-1 rounded text-slate-400 hover:text-brand-red hover:bg-slate-100"><Trash2 size={11} /></button>
                </div>
              )}
            </div>
          </div>
        )
      ))}
    </div>
  );
}

function PriorityBadge({ value }) {
  const map = {
    low:  'bg-slate-100 text-slate-600',
    med:  'bg-[#fbf3df] text-[#8c6a1a]',
    high: 'bg-[#fbeadf] text-[#a8480f]',
  };
  return <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full ${map[value] || map.med}`}>{value}</span>;
}

function TaskForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    due_date: initial?.due_date || '',
    priority: initial?.priority || 'med',
    status: initial?.status || 'open',
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    if (!f.title.trim()) return;
    setSaving(true);
    try { await onSave({ ...f, due_date: f.due_date || null }); }
    finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className="rounded-lg border border-[#e6d99c] bg-[#fbf3df]/40 p-3 space-y-2" data-testid="task-form">
      <input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}
        placeholder="Task title" data-testid="task-title"
        className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded bg-white" />
      <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })}
        placeholder="Description (optional)" rows={2} data-testid="task-description"
        className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white" />
      <div className="flex gap-2 flex-wrap">
        <input type="date" value={f.due_date || ''} onChange={(e) => setF({ ...f, due_date: e.target.value })}
          data-testid="task-due" className="px-2 py-1 text-xs border border-slate-300 rounded bg-white" />
        <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}
          data-testid="task-priority" className="px-2 py-1 text-xs border border-slate-300 rounded bg-white">
          <option value="low">Low</option><option value="med">Medium</option><option value="high">High</option>
        </select>
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}
          data-testid="task-status" className="px-2 py-1 text-xs border border-slate-300 rounded bg-white">
          <option value="open">Open</option><option value="in_progress">In progress</option>
          <option value="done">Done</option><option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onCancel} className="text-xs px-3 py-1 rounded border border-slate-300 bg-white">Cancel</button>
        <button type="submit" disabled={saving} data-testid="task-save"
          className="text-xs px-3 py-1 rounded bg-[#8c6a1a] text-white font-medium disabled:opacity-60">
          {saving ? <Loader2 size={11} className="inline animate-spin" /> : 'Save'}
        </button>
      </div>
    </form>
  );
}

// ────────────────────── Notes panel ──────────────────────
function NotesPanel({ supplierId, canEdit, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const user = getUser();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/suppliers/${supplierId}/notes`);
      setItems(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supplierId]);

  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await api.post(`/suppliers/${supplierId}/notes`, { body_md: draft.trim() });
      toast.success('Note added'); setDraft(''); await load(); onChanged?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };
  const saveEdit = async (id) => {
    try {
      await api.patch(`/suppliers/notes/${id}`, { body_md: editValue.trim() });
      toast.success('Note updated'); setEditingId(null); await load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const remove = async (n) => {
    try {
      await api.delete(`/suppliers/notes/${n.id}`);
      toast.success('Note deleted'); await load(); onChanged?.();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="notes-panel">
      {canEdit && (
        <div className="rounded-lg border border-[#b9d2ec] bg-[#e6eff9]/40 p-2.5">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a note… (Markdown supported)" rows={3}
            data-testid="note-draft"
            className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded bg-white" />
          <div className="flex justify-end mt-2">
            <button onClick={add} disabled={saving || !draft.trim()} data-testid="note-add"
              className="text-xs px-3 py-1.5 rounded bg-[#1e4a8c] text-white font-medium disabled:opacity-60 inline-flex items-center gap-1">
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add note
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <div className="text-xs text-slate-500"><Loader2 size={12} className="inline animate-spin" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-slate-500 py-6 text-center bg-slate-50 rounded-lg">No notes yet.</div>
      ) : items.map((n) => {
        const mine = n.created_by === user?.id;
        const editable = canEdit || mine;
        return (
          <div key={n.id} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`note-row-${n.id}`}>
            <div className="flex items-start gap-2">
              <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold flex items-center justify-center shrink-0">{initials(n.created_by_name)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{n.created_by_name || 'Unknown'}</span> · {fmtDate(n.created_at)}
                </div>
                {editingId === n.id ? (
                  <div className="mt-1">
                    <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={3}
                      className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded bg-white" />
                    <div className="flex justify-end gap-1 mt-1">
                      <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 rounded border border-slate-300 bg-white">Cancel</button>
                      <button onClick={() => saveEdit(n.id)} className="text-xs px-2 py-1 rounded bg-[#1e4a8c] text-white">Save</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-800 whitespace-pre-wrap mt-0.5">{n.body_md}</p>
                )}
              </div>
              {editable && editingId !== n.id && (
                <div className="flex gap-0.5 shrink-0">
                  <button onClick={() => { setEditingId(n.id); setEditValue(n.body_md); }} data-testid={`note-edit-${n.id}`}
                    className="p-1 rounded text-slate-400 hover:text-brand-blue hover:bg-slate-100"><Pencil size={11} /></button>
                  <button onClick={() => remove(n)} data-testid={`note-delete-${n.id}`}
                    className="p-1 rounded text-slate-400 hover:text-brand-red hover:bg-slate-100"><Trash2 size={11} /></button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────── Members panel ──────────────────────
function MembersPanel({ supplierId, canEdit, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/suppliers/${supplierId}/members`);
      setItems(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supplierId]);

  const save = async (form) => {
    try {
      if (editing === 'new') {
        await api.post(`/suppliers/${supplierId}/members`, form);
        toast.success('Member added');
      } else {
        await api.patch(`/suppliers/members/${editing.id}`, form);
        toast.success('Member updated');
      }
      setEditing(null); await load(); onChanged?.();
    } catch (e) { toast.error(apiError(e)); }
  };
  const remove = async (m) => {
    try {
      await api.delete(`/suppliers/members/${m.id}`);
      toast.success('Member removed'); await load(); onChanged?.();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="members-panel">
      {canEdit && editing !== 'new' && (
        <button onClick={() => setEditing('new')} data-testid="member-add"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#a8480f] text-white text-xs font-medium hover:bg-[#8a3a0c]">
          <Plus size={12} /> Add member
        </button>
      )}
      {editing === 'new' && <MemberForm onSave={save} onCancel={() => setEditing(null)} />}
      {loading ? (
        <div className="text-xs text-slate-500"><Loader2 size={12} className="inline animate-spin" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-slate-500 py-6 text-center bg-slate-50 rounded-lg">No members linked.</div>
      ) : items.map((m) => (
        editing && editing.id === m.id ? (
          <MemberForm key={m.id} initial={m} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <div key={m.id} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`member-row-${m.id}`}>
            <div className="flex items-start gap-2">
              <div className="w-9 h-9 rounded-full bg-[#fbeadf] text-[#a8480f] text-xs font-semibold flex items-center justify-center shrink-0">{initials(m.name)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium text-slate-900">{m.name}</span>
                  {m.is_primary_contact && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full bg-[#d8ecdd] text-[#1f7a3f]">Primary</span>
                  )}
                </div>
                {m.role && <div className="text-xs text-slate-500">{m.role}</div>}
                <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                  {m.email && <div className="truncate">{m.email}</div>}
                  {m.phone && <div>{m.phone}</div>}
                </div>
              </div>
              {canEdit && (
                <div className="flex gap-0.5 shrink-0">
                  <button onClick={() => setEditing(m)} data-testid={`member-edit-${m.id}`} className="p-1 rounded text-slate-400 hover:text-brand-blue hover:bg-slate-100"><Pencil size={11} /></button>
                  <button onClick={() => remove(m)} data-testid={`member-delete-${m.id}`} className="p-1 rounded text-slate-400 hover:text-brand-red hover:bg-slate-100"><Trash2 size={11} /></button>
                </div>
              )}
            </div>
          </div>
        )
      ))}
    </div>
  );
}

function MemberForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({
    name: initial?.name || '', role: initial?.role || '',
    email: initial?.email || '', phone: initial?.phone || '',
    is_primary_contact: !!initial?.is_primary_contact,
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    if (!f.name.trim()) return;
    setSaving(true);
    try { await onSave(f); } finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className="rounded-lg border border-[#e9c0a5] bg-[#fbeadf]/40 p-3 space-y-2" data-testid="member-form">
      <input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
        placeholder="Full name" data-testid="member-name"
        className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded bg-white" />
      <input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}
        placeholder="Role / title (optional)" data-testid="member-role"
        className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded bg-white" />
      <div className="grid grid-cols-2 gap-2">
        <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })}
          placeholder="email@example.com" data-testid="member-email"
          className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white" />
        <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })}
          placeholder="Phone" data-testid="member-phone"
          className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white" />
      </div>
      <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
        <input type="checkbox" checked={f.is_primary_contact}
          onChange={(e) => setF({ ...f, is_primary_contact: e.target.checked })}
          data-testid="member-primary" className="w-3.5 h-3.5 rounded" />
        Primary contact
      </label>
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onCancel} className="text-xs px-3 py-1 rounded border border-slate-300 bg-white">Cancel</button>
        <button type="submit" disabled={saving} data-testid="member-save"
          className="text-xs px-3 py-1 rounded bg-[#a8480f] text-white font-medium disabled:opacity-60">
          {saving ? <Loader2 size={11} className="inline animate-spin" /> : 'Save'}
        </button>
      </div>
    </form>
  );
}

// ────────────────────── Folders placeholder ──────────────────────
function FoldersPanel() {
  return (
    <div className="rounded-lg border border-[#e2dcef] bg-[#ece6f4]/40 p-6 text-center text-sm text-[#4f3a8c]" data-testid="folders-panel-placeholder">
      <FolderOpen size={28} className="mx-auto mb-2 text-[#4f3a8c]" />
      <div className="font-medium">Per-supplier folders coming next turn.</div>
      <p className="text-xs text-slate-600 mt-1.5">Use the main <UserIcon size={11} className="inline" /> Document Library for now — supplier-scoped folders ship in the next iteration.</p>
    </div>
  );
}

// ────────────────────── Drawer wrapper ──────────────────────

export default function SupplierDrawer({ supplier, initialPanel, onClose, onChanged }) {
  const [panel, setPanel] = useState(initialPanel || 'tasks');
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);

  useEffect(() => { setPanel(initialPanel || 'tasks'); }, [initialPanel]);
  if (!supplier) return null;
  const theme = PANEL_THEMES[panel] || PANEL_THEMES.tasks;
  const Icon = theme.icon;

  return (
    <Sheet open={!!supplier} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col" data-testid="supplier-drawer">
        <SheetHeader className={`${theme.bg} px-5 py-4 border-b border-slate-200`}>
          <div className={`text-[10px] uppercase tracking-[0.16em] font-semibold ${theme.ink} flex items-center gap-1.5`}>
            <Icon size={12} /> {theme.name}
          </div>
          <SheetTitle className="text-lg font-display font-semibold text-slate-900 truncate">
            {supplier.name}
          </SheetTitle>
        </SheetHeader>

        <div className="border-b border-slate-200 flex bg-white">
          {(['tasks', 'notes', 'folders', 'members']).map((k) => {
            const PI = PANEL_THEMES[k].icon;
            const active = panel === k;
            return (
              <button key={k} onClick={() => setPanel(k)} data-testid={`tab-${k}`}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                  active ? `${PANEL_THEMES[k].bg} ${PANEL_THEMES[k].ink}` : 'text-slate-500 hover:bg-slate-50'
                }`}>
                <PI size={12} /> {PANEL_THEMES[k].name}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {panel === 'tasks'   && <TasksPanel supplierId={supplier.simpro_supplier_id} canEdit={canEdit} onChanged={onChanged} />}
          {panel === 'notes'   && <NotesPanel supplierId={supplier.simpro_supplier_id} canEdit={canEdit} onChanged={onChanged} />}
          {panel === 'members' && <MembersPanel supplierId={supplier.simpro_supplier_id} canEdit={canEdit} onChanged={onChanged} />}
          {panel === 'folders' && <FoldersPanel />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
