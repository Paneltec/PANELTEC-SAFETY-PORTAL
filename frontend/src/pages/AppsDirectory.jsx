// Paneltec Group · Apps Directory — the launcher page (Overview → Apps Directory).
//
// Everyone signed in sees every tile. Tiles marked "Locked (PIN)" are shown
// grey with a padlock until an admin enters their 4-digit PIN; the server
// then releases the link (and any saved login) to that person for a short
// window (tile_unlock.py), after which everything locks again.
//
// Managing tiles (add / edit / delete / who can use it / saved logins /
// activity log) lives in Settings → Organisation → Apps Directory.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Rocket, Lock, Unlock, Settings, ExternalLink, EyeOff, ScrollText, Users,
} from 'lucide-react';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { TilePinModal, openCheatSheet } from '../components/apps-directory/TileCard';
import { TileActivityLog } from '../components/apps-directory/TileActivityLog';
import {
  DndContext, PointerSensor, KeyboardSensor, TouchSensor,
  useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, arrayMove, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── helpers ──────────────────────────────────────────────────────────

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

function fmtRemaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Open a tile. Admins with a saved login get the password copied and a
 *  cheat-sheet window; everyone else gets a plain new tab. */
async function launchTile(tile, isAdmin) {
  const url = tile.url;
  if (!url) return;
  if (!isAdmin) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
  let meta = null;
  try { meta = (await api.get(`/tile-credentials/${tile.id}`)).data || null; } catch { meta = null; }
  const hasLogin = meta && !meta.locked && (meta.username || meta.has_password || (meta.qa_pairs || []).length);
  if (!hasLogin) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
  let plain = null;
  if (meta.has_password) {
    try {
      plain = (await api.post(`/tile-credentials/${tile.id}/reveal`)).data?.password || null;
      if (plain) { try { await navigator.clipboard.writeText(plain); } catch { /* clipboard blocked */ } }
    } catch { /* fall through to plain open */ }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  openCheatSheet(tile, meta, plain);
}

// ── Tile ─────────────────────────────────────────────────────────────

function TileIcon({ tile, muted }) {
  const [broken, setBroken] = useState(false);
  const accent = tile.color || '#0f766e';
  if (tile.remote_icon_url && !broken) {
    return (
      <img src={tile.remote_icon_url} alt="" onError={() => setBroken(true)}
        className={`w-12 h-12 rounded-xl object-contain bg-white border border-slate-200 p-1.5 ${muted ? 'grayscale' : ''}`} />
    );
  }
  return (
    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-extrabold text-white"
      style={{ background: muted ? '#94a3b8' : accent }}>
      {tile.icon ? tile.icon : (tile.label || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

function Tile({ tile, state, canUnlock, onOpen, dragHandle, isDragging }) {
  // state: 'open' | 'locked' | 'unlocked' | 'no-access' | 'hidden'
  const muted = state === 'locked' || state === 'no-access';
  const clickable = state === 'open' || state === 'unlocked' || (state === 'locked' && canUnlock);
  const accent = tile.color || '#0f766e';
  return (
    <div
      data-testid={`apps-tile-${tile.id}`}
      data-state={state}
      onClick={() => clickable && onOpen(tile)}
      onKeyDown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(tile); } }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : -1}
      title={state === 'locked' ? (canUnlock ? 'Locked — click and enter your PIN' : 'Locked — an admin can open this with their PIN')
        : state === 'no-access' ? 'Only selected people can use this app'
        : tile.url ? `Open ${tile.label}` : tile.label}
      className={[
        'relative rounded-2xl border bg-white p-4 flex flex-col gap-3 min-h-[132px] transition',
        clickable ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : 'cursor-default',
        muted ? 'border-slate-200 bg-slate-50' : 'border-slate-200 shadow-sm',
        state === 'hidden' ? 'border-dashed opacity-70' : '',
        isDragging ? 'opacity-60 ring-2 ring-emerald-300' : '',
      ].join(' ')}
      style={{ borderTopWidth: 4, borderTopColor: muted ? '#cbd5e1' : accent }}
    >
      <div className="flex items-start gap-3">
        <TileIcon tile={tile} muted={muted} />
        <div className="min-w-0 flex-1">
          <div className={`font-bold leading-tight ${muted ? 'text-slate-500' : 'text-slate-900'}`}>{tile.label}</div>
          {tile.description && (
            <div className={`text-xs mt-0.5 line-clamp-2 ${muted ? 'text-slate-400' : 'text-slate-500'}`}>{tile.description}</div>
          )}
        </div>
        {dragHandle}
      </div>
      <div className="mt-auto flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider">
        {state === 'locked' && (
          <span className="inline-flex items-center gap-1 text-slate-500"><Lock size={12} /> Locked · PIN</span>
        )}
        {state === 'unlocked' && (
          <span className="inline-flex items-center gap-1 text-emerald-700"><Unlock size={12} /> Unlocked</span>
        )}
        {state === 'no-access' && (
          <span className="inline-flex items-center gap-1 text-slate-400"><Users size={12} /> Selected people only</span>
        )}
        {state === 'hidden' && (
          <span className="inline-flex items-center gap-1 text-slate-400"><EyeOff size={12} /> Hidden</span>
        )}
        {state === 'open' && <span className="text-slate-400 normal-case tracking-normal font-medium">{hostOf(tile.url)}</span>}
        {clickable && <span className="inline-flex items-center gap-1 text-emerald-600">Open <ExternalLink size={12} /></span>}
      </div>
    </div>
  );
}

function SortableTile({ tile, isAdmin, ...rest }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tile.id, disabled: !isAdmin });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const handle = isAdmin ? (
    <button type="button" {...attributes} {...listeners}
      onClick={(e) => e.stopPropagation()}
      title="Drag to reorder"
      className="shrink-0 -mr-1 -mt-1 p-1 rounded text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
      data-testid={`apps-tile-drag-${tile.id}`}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="4" cy="3" r="1.3"/><circle cx="10" cy="3" r="1.3"/><circle cx="4" cy="7" r="1.3"/><circle cx="10" cy="7" r="1.3"/><circle cx="4" cy="11" r="1.3"/><circle cx="10" cy="11" r="1.3"/></svg>
    </button>
  ) : null;
  return (
    <div ref={setNodeRef} style={style}>
      <Tile tile={tile} dragHandle={handle} isDragging={isDragging} {...rest} />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AppsDirectory() {
  const user = getUser();
  const isAdmin = (user?.role || '').toLowerCase() === 'admin';

  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [unlockedUntil, setUnlockedUntil] = useState(null); // ISO string or null
  const [now, setNow] = useState(() => Date.now());
  const [pinFor, setPinFor] = useState(null);  // { tile, then: (url) => void }
  const [activityOpen, setActivityOpen] = useState(false);
  const [hasPin, setHasPin] = useState(false);

  const unlocked = !!unlockedUntil && new Date(unlockedUntil).getTime() > now;
  const wasUnlocked = useRef(false);

  const loadTiles = useCallback(async (includeHidden = showHidden) => {
    try {
      const r = await api.get('/org/url-tiles', { params: includeHidden ? { include_hidden: 'true' } : {} });
      setTiles(r.data.tiles || []);
    } catch (e) {
      toast.error(apiError(e) || 'Could not load the Apps Directory');
    } finally {
      setLoading(false);
    }
  }, [showHidden]);

  const loadStatus = useCallback(async () => {
    try {
      const r = await api.get('/org/url-tiles/unlock-status');
      setUnlockedUntil(r.data?.unlocked_until || null);
    } catch { setUnlockedUntil(null); }
  }, []);

  useEffect(() => { loadTiles(false); loadStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isAdmin) return;
    api.post('/auth/admin-console/status').then((r) => setHasPin(!!r.data?.has_pin)).catch(() => {});
  }, [isAdmin]);

  // 1-second tick while unlocked; when the window closes, reload so links vanish again.
  useEffect(() => {
    if (!unlockedUntil) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [unlockedUntil]);
  useEffect(() => {
    if (unlocked) { wasUnlocked.current = true; return; }
    if (wasUnlocked.current) {
      wasUnlocked.current = false;
      setUnlockedUntil(null);
      setShowHidden(false);
      loadTiles(false);
    }
  }, [unlocked, loadTiles]);

  const stateOf = (t) => {
    if (t.hidden) return 'hidden';
    if (t.approved_for_me === false) return 'no-access';
    if (t.pin_protected) return unlocked && t.url ? 'unlocked' : 'locked';
    return 'open';
  };

  const openTile = async (tile) => {
    const st = stateOf(tile);
    if (st === 'locked') {
      setPinFor({
        tile,
        then: async (url, until) => {
          if (until) setUnlockedUntil(until);
          await loadTiles();
          await launchTile({ ...tile, url: url || tile.url }, isAdmin);
        },
      });
      return;
    }
    if (st === 'open' || st === 'unlocked') await launchTile(tile, isAdmin);
  };

  const lockNow = async () => {
    try {
      await api.post('/org/url-tiles/lock-now');
      setUnlockedUntil(null);
      setShowHidden(false);
      await loadTiles(false);
      toast.success('Locked');
    } catch (e) { toast.error(apiError(e) || 'Could not lock'); }
  };

  const requirePin = (then) => {
    if (unlocked) { then(); return; }
    setPinFor({ tile: { id: '', label: 'Apps Directory' }, then: async (_url, until) => { if (until) setUnlockedUntil(until); then(); } });
  };

  const toggleHidden = () => {
    if (showHidden) { setShowHidden(false); loadTiles(false); return; }
    requirePin(() => { setShowHidden(true); loadTiles(true); });
  };

  // Drag to reorder (admins).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = async ({ active, over }) => {
    if (!isAdmin || !over || active.id === over.id) return;
    const from = tiles.findIndex((t) => t.id === active.id);
    const to = tiles.findIndex((t) => t.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(tiles, from, to);
    setTiles(next);
    try {
      await api.patch('/org/url-tiles/reorder', { tile_ids: next.map((t) => t.id) });
    } catch (e) {
      toast.error(apiError(e) || 'Reorder failed');
      loadTiles();
    }
  };

  const visible = useMemo(() => tiles.filter((t) => showHidden || !t.hidden), [tiles, showHidden]);
  const lockedCount = useMemo(() => tiles.filter((t) => t.pin_protected).length, [tiles]);

  return (
    <div className="max-w-6xl mx-auto" data-testid="apps-directory-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Rocket size={28} className="text-emerald-500 shrink-0" />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-600">Paneltec Group · Apps Directory</div>
            <h1 className="font-display font-extrabold text-2xl text-emerald-700 leading-tight">Every tool, one click away.</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(isAdmin && (lockedCount > 0 || unlocked)) && (
            unlocked ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-3 py-1.5"
                data-testid="apps-unlock-status">
                <Unlock size={13} /> Unlocked · {fmtRemaining(new Date(unlockedUntil).getTime() - now)} left
                <button type="button" onClick={lockNow} data-testid="apps-lock-now"
                  className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-900 text-white px-2.5 py-1 text-[11px] hover:bg-slate-700">
                  <Lock size={11} /> Lock now
                </button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold px-3 py-1.5"
                data-testid="apps-unlock-status">
                <Lock size={13} /> Locked
              </span>
            )
          )}
          {isAdmin && (
            <Link to="/app/settings/org#apps-directory" data-testid="apps-manage-link"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
              <Settings size={14} /> Manage tiles
            </Link>
          )}
        </div>
      </div>

      {isAdmin && lockedCount > 0 && !hasPin && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="apps-no-pin-warning">
          You don't have a PIN yet, so locked tiles can't be opened. Set one in{' '}
          <Link to="/app/profile" className="font-bold underline">My Profile</Link>.
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500" data-testid="apps-empty">
          {isAdmin ? (
            <>No tiles yet. <Link to="/app/settings/org#apps-directory" className="font-bold text-emerald-700 underline">Add your first app</Link>.</>
          ) : 'No apps have been added yet.'}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((t) => t.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="apps-grid">
              {visible.map((t) => (
                <SortableTile key={t.id} tile={t} isAdmin={isAdmin} canUnlock={isAdmin} state={stateOf(t)} onOpen={openTile} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Footer (admins) */}
      {isAdmin && tiles.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500"
          data-testid="apps-footer">
          <span>Drag a tile to reorder</span>
          <span className="text-slate-300">·</span>
          <button type="button" onClick={toggleHidden} className="inline-flex items-center gap-1 text-emerald-700 hover:underline" data-testid="apps-toggle-hidden">
            <EyeOff size={12} /> {showHidden ? 'Hide hidden tiles' : 'Show hidden tiles'}
          </button>
          <span className="text-slate-300">·</span>
          <button type="button" onClick={() => requirePin(() => setActivityOpen(true))} className="inline-flex items-center gap-1 text-emerald-700 hover:underline" data-testid="apps-activity">
            <ScrollText size={12} /> Activity log
          </button>
        </div>
      )}

      {pinFor && (
        <TilePinModal
          tile={pinFor.tile}
          onClose={() => setPinFor(null)}
          onUnlocked={(url, until) => { const f = pinFor.then; setPinFor(null); f(url, until); }}
        />
      )}
      {activityOpen && <TileActivityLog pinTileId="" onClose={() => setActivityOpen(false)} />}
    </div>
  );
}
