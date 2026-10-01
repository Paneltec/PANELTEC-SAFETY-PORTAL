// Settings → Organisation → Apps Directory — the management side.
//
//   · Add / edit / delete tiles, reorder them.
//   · "Who can use it": Everyone · Selected people · Locked (PIN) · Hidden.
//   · Your saved login for a tile (username / password / extra answers),
//     only readable or editable inside a PIN unlock window (server-side).
//   · Activity log (PIN attempts and every use of a saved login).
//
// Backend: org_url_tiles.py, tile_credentials.py, tile_unlock.py.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Rocket, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Lock, Unlock, KeyRound,
  ScrollText, X, Loader2, Users, EyeOff, Globe, Download, Check,
} from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { TilePinModal } from './TileCard';
import { TileActivityLog } from './TileActivityLog';

// ── "Who can use it" ────────────────────────────────────────────────

export const ACCESS = [
  { key: 'everyone', label: 'Everyone', icon: Globe, help: 'Anyone signed in can open it.' },
  { key: 'selected', label: 'Selected people', icon: Users, help: 'Only the people you tick; others see it greyed out.' },
  { key: 'locked', label: 'Locked (PIN)', icon: Lock, help: 'Greyed out for everyone until an admin enters their PIN.' },
  { key: 'hidden', label: 'Hidden', icon: EyeOff, help: 'Not shown to anyone.' },
];

export function accessOf(tile) {
  if (tile.hidden) return 'hidden';
  if (tile.pin_protected) return 'locked';
  if (tile.access_mode === 'private') return 'selected';
  return 'everyone';
}

/** Fields to PATCH/POST for a chosen access key. */
export function accessPatch(key, allowedUserIds = []) {
  switch (key) {
    case 'selected': return { access_mode: 'private', allowed_user_ids: allowedUserIds, pin_protected: false, hidden: false };
    case 'locked': return { access_mode: 'public', allowed_user_ids: [], pin_protected: true, hidden: false };
    case 'hidden': return { hidden: true };
    default: return { access_mode: 'public', allowed_user_ids: [], pin_protected: false, hidden: false };
  }
}

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url || ''; }
}

function fmtRemaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Small UI bits ───────────────────────────────────────────────────

function Modal({ title, subtitle, onClose, children, width = 'max-w-lg', testid }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid={testid}>
      <div className={`w-full ${width} max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-xl`}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100">
          <div>
            <div className="font-bold text-slate-900">{title}</div>
            {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="overflow-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-3 py-2 text-sm font-bold hover:bg-slate-700 disabled:opacity-50';
const btnGhost = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';

function TileGlyph({ tile, size = 'sm' }) {
  const [broken, setBroken] = useState(false);
  const cls = `${size === 'lg' ? 'w-12 h-12' : 'w-9 h-9'} rounded-lg shrink-0`;
  if (tile.remote_icon_url && !broken) {
    return <img src={tile.remote_icon_url} alt="" onError={() => setBroken(true)} className={`${cls} object-contain bg-white border border-slate-200 p-1`} />;
  }
  return (
    <div className={`${cls} flex items-center justify-center text-sm font-extrabold text-white`} style={{ background: tile.color || '#0f766e' }}>
      {tile.icon || (tile.label || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

// ── People picker ───────────────────────────────────────────────────

function PeoplePicker({ users, value, onChange }) {
  const [q, setQ] = useState('');
  const shown = users.filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="rounded-lg border border-slate-200">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…"
        className="w-full px-3 py-2 text-sm border-b border-slate-200 rounded-t-lg focus:outline-none" data-testid="people-search" />
      <div className="max-h-48 overflow-auto p-1">
        {shown.length === 0 && <div className="p-3 text-xs text-slate-500">No one matches.</div>}
        {shown.map((u) => (
          <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm">
            <input type="checkbox" checked={value.includes(u.id)} onChange={() => toggle(u.id)} data-testid={`people-${u.id}`} />
            <span className="flex-1 truncate">{u.name}</span>
            <span className="text-xs text-slate-400 truncate">{u.email}</span>
            {u.is_admin && <span className="text-[10px] uppercase font-bold text-emerald-700">admin</span>}
          </label>
        ))}
      </div>
      <div className="px-3 py-1.5 text-xs text-slate-500 border-t border-slate-200">{value.length} selected</div>
    </div>
  );
}

// ── Add / Edit tile ─────────────────────────────────────────────────

function TileForm({ tile, users, onClose, onSaved }) {
  const editing = !!tile?.id;
  const [form, setForm] = useState({
    label: tile?.label || '',
    url: tile?.url || '',
    description: tile?.description || '',
    icon: tile?.icon || '',
    color: tile?.color || '#0f766e',
    remote_icon_url: tile?.remote_icon_url || '',
    access: tile ? accessOf(tile) : 'everyone',
    allowed: tile?.allowed_user_ids || [],
  });
  const [busy, setBusy] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const fetchIcon = async () => {
    if (!/^https?:\/\//i.test(form.url.trim())) { toast.error('Enter the link first (it must start with http:// or https://)'); return; }
    setIconBusy(true);
    try {
      const r = await api.post('/org/url-tiles/fetch-icon', { url: form.url.trim() });
      if (r.data?.icon_url) { set('remote_icon_url', r.data.icon_url); toast.success('Icon found'); }
      else toast.error('No icon found on that site — use a letter or emoji instead');
    } catch (e) { toast.error(apiError(e) || 'Could not fetch an icon'); }
    finally { setIconBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.label.trim()) { toast.error('Give the tile a name'); return; }
    if (!/^https?:\/\//i.test(form.url.trim())) { toast.error('The link must start with http:// or https://'); return; }
    if (form.access === 'selected' && form.allowed.length === 0) { toast.error('Tick at least one person, or choose Everyone'); return; }
    setBusy(true);
    const body = {
      label: form.label.trim(),
      url: form.url.trim(),
      description: form.description.trim(),
      icon: form.icon.trim(),
      color: form.color,
      remote_icon_url: form.remote_icon_url || '',
      ...accessPatch(form.access, form.allowed),
    };
    try {
      if (editing) await api.patch(`/org/url-tiles/${tile.id}`, body);
      else await api.post('/org/url-tiles', body);
      toast.success(editing ? 'Tile updated' : 'Tile added');
      onSaved();
    } catch (err) { toast.error(apiError(err) || 'Could not save the tile'); }
    finally { setBusy(false); }
  };

  const preview = { ...form, label: form.label || 'New tile' };

  return (
    <Modal title={editing ? `Edit ${tile.label}` : 'Add a tile'} onClose={onClose} width="max-w-xl" testid="tile-form">
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 p-3">
          <TileGlyph tile={preview} size="lg" />
          <div className="min-w-0">
            <div className="font-bold text-slate-900 truncate">{preview.label}</div>
            <div className="text-xs text-slate-500 truncate">{form.description || hostOf(form.url) || 'How the tile will look'}</div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Name</span>
            <input value={form.label} onChange={(e) => set('label', e.target.value)} className={inputCls} placeholder="e.g. Xero" maxLength={80} data-testid="tile-label" autoFocus />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Link</span>
            <input value={form.url} onChange={(e) => set('url', e.target.value)} className={inputCls} placeholder="https://…" data-testid="tile-url" />
          </label>
        </div>
        <label className="block text-sm">
          <span className="font-semibold text-slate-700">Short description <span className="font-normal text-slate-400">(optional)</span></span>
          <input value={form.description} onChange={(e) => set('description', e.target.value)} className={inputCls} maxLength={280} data-testid="tile-description" />
        </label>

        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Letter or emoji</span>
            <input value={form.icon} onChange={(e) => set('icon', e.target.value)} className={inputCls} placeholder="X or 💰" maxLength={8} data-testid="tile-icon" />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Colour</span>
            <div className="flex items-center gap-2">
              <input type="color" value={form.color} onChange={(e) => set('color', e.target.value)} className="h-9 w-12 rounded border border-slate-300 p-0.5" data-testid="tile-color" />
              <span className="text-xs text-slate-500">{form.color}</span>
            </div>
          </label>
          <div className="text-sm">
            <span className="font-semibold text-slate-700">Website icon</span>
            <div className="flex items-center gap-2 mt-1">
              <button type="button" onClick={fetchIcon} disabled={iconBusy} className={btnGhost} data-testid="tile-fetch-icon">
                {iconBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Fetch from site
              </button>
              {form.remote_icon_url && (
                <button type="button" onClick={() => set('remote_icon_url', '')} className="text-xs text-slate-500 underline">remove</button>
              )}
            </div>
          </div>
        </div>

        <fieldset className="text-sm">
          <legend className="font-semibold text-slate-700 mb-1.5">Who can use it</legend>
          <div className="grid sm:grid-cols-2 gap-2">
            {ACCESS.map((a) => {
              const Icon = a.icon;
              const on = form.access === a.key;
              return (
                <label key={a.key} className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer ${on ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="access" value={a.key} checked={on} onChange={() => set('access', a.key)} className="mt-0.5" data-testid={`tile-access-${a.key}`} />
                  <span>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800"><Icon size={14} /> {a.label}</span>
                    <span className="block text-xs text-slate-500">{a.help}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {form.access === 'selected' && (
            <div className="mt-2"><PeoplePicker users={users} value={form.allowed} onChange={(v) => set('allowed', v)} /></div>
          )}
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={busy} className={btnPrimary} data-testid="tile-save">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {editing ? 'Save changes' : 'Add tile'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Saved login (per admin, per tile) ───────────────────────────────

function LoginEditor({ tile, onClose, onChanged }) {
  const [meta, setMeta] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [qa, setQa] = useState([]); // [{label, answer}]
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/tile-credentials/${tile.id}`);
      setMeta(r.data || {});
      setUsername(r.data?.username || '');
      setQa((r.data?.qa_pairs || []).map((p) => ({ label: p.label, answer: '' })));
    } catch (e) { toast.error(apiError(e) || 'Could not load the saved login'); onClose(); }
  }, [tile.id, onClose]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = { username, qa_pairs: qa.filter((p) => p.label.trim()) };
    if (password) body.password = password;
    try {
      await api.put(`/tile-credentials/${tile.id}`, body);
      toast.success('Saved login updated');
      onChanged(); onClose();
    } catch (err) { toast.error(apiError(err) || 'Could not save'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Remove your saved login for ${tile.label}?`)) return;
    try { await api.delete(`/tile-credentials/${tile.id}`); toast.success('Saved login removed'); onChanged(); onClose(); }
    catch (err) { toast.error(apiError(err) || 'Could not remove'); }
  };

  const hasAny = meta && (meta.username || meta.has_password || (meta.qa_pairs || []).length > 0);

  return (
    <Modal title={`Saved login · ${tile.label}`} subtitle="Only you can use this login. When you open the tile, the password is copied for you." onClose={onClose} testid="login-editor">
      {!meta ? <div className="text-sm text-slate-500">Loading…</div> : (
        <form onSubmit={save} className="space-y-3">
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Username or email</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} data-testid="login-username" autoComplete="off" />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls}
              placeholder={meta.has_password ? `Saved (${meta.password_preview || '••••'}) — type to replace` : 'Type the password'} data-testid="login-password" autoComplete="new-password" />
          </label>
          <div className="text-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-slate-700">Extra answers <span className="font-normal text-slate-400">(security questions, PINs)</span></span>
              {qa.length < 6 && <button type="button" onClick={() => setQa([...qa, { label: '', answer: '' }])} className="text-xs font-semibold text-emerald-700 hover:underline">+ add</button>}
            </div>
            {qa.map((p, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={p.label} onChange={(e) => setQa(qa.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} className={inputCls} placeholder="Question / label" />
                <input value={p.answer} onChange={(e) => setQa(qa.map((x, j) => j === i ? { ...x, answer: e.target.value } : x))} className={inputCls} placeholder={p.answer ? '' : 'Answer (kept as is if blank)'} />
                <button type="button" onClick={() => setQa(qa.filter((_, j) => j !== i))} className="p-2 text-slate-400 hover:text-rose-600" aria-label="Remove"><X size={14} /></button>
              </div>
            ))}
            {qa.length === 0 && <div className="text-xs text-slate-400">None.</div>}
          </div>
          <div className="flex items-center justify-between pt-2">
            {hasAny ? <button type="button" onClick={remove} className="text-xs font-semibold text-rose-600 hover:underline" data-testid="login-remove">Remove saved login</button> : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
              <button type="submit" disabled={busy} className={btnPrimary} data-testid="login-save">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save</button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── The section ─────────────────────────────────────────────────────

export default function AppsDirectoryManager() {
  const [tiles, setTiles] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasPin, setHasPin] = useState(null);
  const [unlockedUntil, setUnlockedUntil] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [loginMeta, setLoginMeta] = useState({}); // tile id -> {has_password, has_username, n_qa}
  const [form, setForm] = useState(null);         // null | {} (add) | tile (edit)
  const [loginFor, setLoginFor] = useState(null);
  const [pinThen, setPinThen] = useState(null);    // () => void
  const [activityOpen, setActivityOpen] = useState(false);
  const [peopleFor, setPeopleFor] = useState(null); // tile whose "selected people" list is being edited
  const [peopleDraft, setPeopleDraft] = useState([]);

  const unlocked = !!unlockedUntil && new Date(unlockedUntil).getTime() > now;

  const load = useCallback(async () => {
    try {
      const [t, u, s] = await Promise.all([
        api.get('/org/url-tiles', { params: { include_hidden: 'true', include_disabled: 'true' } }),
        api.get('/org/url-tiles/eligible-users').catch(() => ({ data: { users: [] } })),
        api.get('/org/url-tiles/unlock-status').catch(() => ({ data: {} })),
      ]);
      setTiles(t.data.tiles || []);
      setUsers(u.data.users || []);
      setUnlockedUntil(s.data?.unlocked_until || null);
    } catch (e) { toast.error(apiError(e) || 'Could not load the Apps Directory'); }
    finally { setLoading(false); }
  }, []);

  const loadLogins = useCallback(async (list) => {
    const out = {};
    await Promise.all((list || []).map(async (t) => {
      try {
        const r = await api.get(`/tile-credentials/${t.id}`);
        const d = r.data || {};
        out[t.id] = { saved: !!(d.has_password || d.has_username || d.username || (d.qa_pairs || []).length) };
      } catch { out[t.id] = { saved: false }; }
    }));
    setLoginMeta(out);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (window.location.hash === '#apps-directory') {
      setTimeout(() => document.getElementById('apps-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }
  }, []);
  useEffect(() => { if (tiles.length) loadLogins(tiles); }, [tiles, loadLogins]);
  useEffect(() => {
    api.post('/auth/admin-console/status').then((r) => setHasPin(!!r.data?.has_pin)).catch(() => setHasPin(false));
  }, []);
  useEffect(() => {
    if (!unlockedUntil) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [unlockedUntil]);

  // Run `fn` inside a PIN unlock window (asks for the PIN if needed).
  const withPin = (fn) => {
    if (unlocked) { fn(); return; }
    if (hasPin === false) { toast.error('Set your 4-digit PIN in My Profile first'); return; }
    setPinThen(() => fn);
  };

  const patch = async (tile, body, okMsg) => {
    try {
      await api.patch(`/org/url-tiles/${tile.id}`, body);
      if (okMsg) toast.success(okMsg);
      await load();
    } catch (e) { toast.error(apiError(e) || 'Could not update the tile'); }
  };

  const changeAccess = (tile, key) => {
    if (key === accessOf(tile)) return;
    if (key === 'selected') {
      setPeopleDraft(tile.allowed_user_ids || []);
      setPeopleFor(tile);
      return;
    }
    patch(tile, accessPatch(key), `${tile.label}: ${ACCESS.find((a) => a.key === key)?.label}`);
  };

  const savePeople = async () => {
    if (peopleDraft.length === 0) { toast.error('Tick at least one person'); return; }
    const t = peopleFor;
    setPeopleFor(null);
    await patch(t, accessPatch('selected', peopleDraft), `${t.label}: selected people`);
  };

  const move = async (idx, dir) => {
    const to = idx + dir;
    if (to < 0 || to >= tiles.length) return;
    const next = [...tiles];
    [next[idx], next[to]] = [next[to], next[idx]];
    setTiles(next);
    try { await api.patch('/org/url-tiles/reorder', { tile_ids: next.map((t) => t.id) }); }
    catch (e) { toast.error(apiError(e) || 'Reorder failed'); load(); }
  };

  const remove = async (tile) => {
    if (!window.confirm(`Delete "${tile.label}" from the Apps Directory?\n\nThis also removes any saved logins for it.`)) return;
    try { await api.delete(`/org/url-tiles/${tile.id}`); toast.success('Tile deleted'); await load(); }
    catch (e) { toast.error(apiError(e) || 'Could not delete'); }
  };

  const lockNow = async () => {
    try { await api.post('/org/url-tiles/lock-now'); setUnlockedUntil(null); toast.success('Locked'); }
    catch (e) { toast.error(apiError(e) || 'Could not lock'); }
  };

  const counts = useMemo(() => tiles.reduce((acc, t) => { const k = accessOf(t); acc[k] = (acc[k] || 0) + 1; return acc; }, {}), [tiles]);

  return (
    <section id="apps-directory" className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm" data-testid="apps-directory-manager">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-100">
        <Rocket size={22} className="text-emerald-500" />
        <div className="flex-1 min-w-[200px]">
          <div className="font-bold text-slate-900">Apps Directory</div>
          <div className="text-xs text-slate-500">
            {tiles.length} tile{tiles.length === 1 ? '' : 's'}
            {counts.locked ? ` · ${counts.locked} locked` : ''}{counts.selected ? ` · ${counts.selected} selected people` : ''}{counts.hidden ? ` · ${counts.hidden} hidden` : ''}
            {' · '}<Link to="/app/apps-directory" className="text-emerald-700 underline">open the directory</Link>
          </div>
        </div>
        {unlocked ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-3 py-1.5" data-testid="mgr-unlock-status">
            <Unlock size={13} /> Unlocked · {fmtRemaining(new Date(unlockedUntil).getTime() - now)}
            <button type="button" onClick={lockNow} className="ml-1 rounded-full bg-slate-900 text-white px-2.5 py-1 text-[11px] hover:bg-slate-700" data-testid="mgr-lock-now">Lock now</button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold px-3 py-1.5" data-testid="mgr-unlock-status"><Lock size={13} /> Locked</span>
        )}
        <button type="button" onClick={() => withPin(() => setActivityOpen(true))} className={btnGhost} data-testid="mgr-activity"><ScrollText size={14} /> Activity log</button>
        <button type="button" onClick={() => setForm({})} className={btnPrimary} data-testid="mgr-add"><Plus size={14} /> Add tile</button>
      </div>

      {hasPin === false && (
        <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="mgr-no-pin">
          <KeyRound size={14} className="inline mr-1 -mt-0.5" />
          You haven't set a PIN yet. Locked tiles, saved logins and the activity log all need it. Set one in{' '}
          <Link to="/app/profile" className="font-bold underline">My Profile</Link>.
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? <div className="p-6 text-sm text-slate-500">Loading…</div> : tiles.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No tiles yet. Click <strong>Add tile</strong> to put your first app in the directory.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-slate-500 text-left bg-slate-50">
              <tr>
                <th className="px-3 py-2 font-semibold">App</th>
                <th className="px-2 py-2 font-semibold hidden xl:table-cell">Link</th>
                <th className="px-2 py-2 font-semibold">Who can use it</th>
                <th className="px-1 py-2 font-semibold text-center" title="Your saved login for this app">Login</th>
                <th className="px-1 py-2 font-semibold text-center">Order</th>
                <th className="px-1 py-2 font-semibold text-right pr-3">Edit</th>
              </tr>
            </thead>
            <tbody>
              {tiles.map((t, i) => {
                const acc = accessOf(t);
                const saved = loginMeta[t.id]?.saved;
                return (
                  <tr key={t.id} className={`border-t border-slate-100 ${acc === 'hidden' ? 'opacity-60' : ''}`} data-testid={`mgr-row-${t.id}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-[150px] max-w-[220px]">
                        <TileGlyph tile={t} />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate" title={t.description || t.label}>{t.label}</div>
                          <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:underline truncate block xl:hidden" title={t.url}>{hostOf(t.url)}</a>
                          {t.description && <div className="text-xs text-slate-500 truncate hidden xl:block">{t.description}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-slate-600 hidden xl:table-cell">
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="hover:underline truncate block max-w-[200px]" title={t.url}>{hostOf(t.url)}</a>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <select value={acc} onChange={(e) => changeAccess(t, e.target.value)}
                          className="rounded-lg border border-slate-300 px-1.5 py-1.5 text-sm bg-white max-w-[150px]" data-testid={`mgr-access-${t.id}`}>
                          {ACCESS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                        </select>
                        {acc === 'selected' && (
                          <button type="button" onClick={() => { setPeopleDraft(t.allowed_user_ids || []); setPeopleFor(t); }}
                            className="text-xs font-semibold text-emerald-700 hover:underline whitespace-nowrap" data-testid={`mgr-people-${t.id}`}>
                            {(t.allowed_user_ids || []).length} people
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-2.5 text-center">
                      <button type="button" onClick={() => withPin(() => setLoginFor(t))}
                        title={saved ? 'Your saved login: saved. Click to change.' : 'Set up your saved login for this app'}
                        aria-label={saved ? 'Saved login (saved)' : 'Set up saved login'}
                        className={`inline-flex items-center justify-center gap-1 rounded-lg border w-10 h-9 text-xs font-semibold ${saved ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                        data-testid={`mgr-login-${t.id}`}>
                        <KeyRound size={14} />{saved && <Check size={12} />}
                      </button>
                    </td>
                    <td className="px-1 py-2.5 text-center whitespace-nowrap">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Move up" data-testid={`mgr-up-${t.id}`}><ArrowUp size={14} /></button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === tiles.length - 1} className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Move down" data-testid={`mgr-down-${t.id}`}><ArrowDown size={14} /></button>
                    </td>
                    <td className="px-1 py-2.5 text-right whitespace-nowrap pr-3">
                      <button type="button" onClick={() => setForm(t)} className="p-1.5 rounded text-slate-600 hover:bg-slate-100" aria-label="Edit" title="Edit" data-testid={`mgr-edit-${t.id}`}><Pencil size={15} /></button>
                      <button type="button" onClick={() => remove(t)} className="p-1.5 rounded text-rose-600 hover:bg-rose-50" aria-label="Delete" title="Delete" data-testid={`mgr-delete-${t.id}`}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1"><KeyRound size={11} /> <strong>Login:</strong> your own saved username and password for that app (needs your PIN).</span>
        {ACCESS.map((a) => { const Icon = a.icon; return <span key={a.key} className="inline-flex items-center gap-1"><Icon size={11} /> <strong>{a.label}:</strong> {a.help}</span>; })}
      </div>

      {/* Modals */}
      {form && <TileForm tile={form.id ? form : null} users={users} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
      {loginFor && <LoginEditor tile={loginFor} onClose={() => setLoginFor(null)} onChanged={() => loadLogins(tiles)} />}
      {peopleFor && (
        <Modal title={`Who can use ${peopleFor.label}`} subtitle="Only the people you tick will be able to open it." onClose={() => setPeopleFor(null)} testid="people-modal">
          <PeoplePicker users={users} value={peopleDraft} onChange={setPeopleDraft} />
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setPeopleFor(null)} className={btnGhost}>Cancel</button>
            <button type="button" onClick={savePeople} className={btnPrimary} data-testid="people-save"><Check size={14} /> Save</button>
          </div>
        </Modal>
      )}
      {pinThen && (
        <TilePinModal tile={{ id: '', label: 'Apps Directory' }}
          onClose={() => setPinThen(null)}
          onUnlocked={(_url, until) => { const f = pinThen; setPinThen(null); if (until) setUnlockedUntil(until); f(); }} />
      )}
      {activityOpen && <TileActivityLog pinTileId="" onClose={() => setActivityOpen(false)} />}
    </section>
  );
}
