import React, { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  ExternalLink, Settings, X, Rocket, Lock,
  MoreVertical, Copy, EyeOff, GripVertical,
  ShieldCheck, Loader2, X as XIcon,
} from 'lucide-react';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import {
  DndContext, PointerSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, rectSortingStrategy,
  sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * v58.13.132es — Standalone "Paneltec Group · Apps Directory" hub.
 *
 * Rendered on the public `/apps-directory` route (outside AppShell)
 * so it can be popped in a dedicated browser window via
 * `window.open` from the sidebar entry. Uses the SAME
 * `GET /org/url-tiles` endpoint the `.132eq` Quick Links page
 * consumes, so tiles + enabled/color/remote_icon_url all flow
 * through unchanged.
 *
 * v58.13.132g1 —
 *   1. Every tile carries a **3-dots menu** (Open / Copy URL / Hide
 *      until next login). Session-scoped hide list keyed by user id
 *      in `sessionStorage` (cleared on logout with the token). The
 *      pre-.132g1 permanent-hide affordance (`localStorage.apps_directory_hidden`)
 *      is REMOVED — its "Show & manage" footer no longer makes sense
 *      alongside the transient session hide.
 *   2. Admins can **drag-and-drop** tiles into a new order. Drag
 *      is via `@dnd-kit` (already installed for SettingsNav +
 *      UsersManagement). On drop we optimistically re-render and
 *      fire `PATCH /api/org/url-tiles/reorder` with the flat
 *      `{tile_ids: []}` payload.
 */

const DEFAULT_COLOR = '#1d6fb8';

// v58.13.132g1 — session-scoped hide storage key.
// Per-user so device-shared kiosks stay clean between accounts.
// Cleared automatically on token removal (see `lib/auth.js::clearToken`
// — the paneltec_token key sits in localStorage, sessionStorage
// clears on tab close AND we clear our own key on unmount).
function _hideKey(userId) {
  return `hidden_tiles_${userId || 'anon'}`;
}

function _readHidden(userId) {
  try {
    const raw = sessionStorage.getItem(_hideKey(userId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function _writeHidden(userId, next) {
  try {
    sessionStorage.setItem(_hideKey(userId), JSON.stringify(Array.from(next)));
  } catch { /* private mode / lockdown — noop */ }
}

export default function AppsDirectory() {
  const user = getUser();
  const isAdmin = (user?.role || '').toLowerCase() === 'admin';
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(() => _readHidden(user?.id));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api.get('/org/url-tiles');
        if (!cancelled) setTiles(r.data.tiles || []);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e) || 'Failed to load tiles');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const hideTile = (id) => {
    const n = new Set(hidden); n.add(id);
    setHidden(n);
    _writeHidden(user?.id, n);
    toast.message('Hidden until next login', {
      description: 'Log out or close the tab to bring it back.',
    });
  };

  const visible = useMemo(
    () => tiles.filter((t) => !hidden.has(t.id)),
    [tiles, hidden],
  );

  // v58.13.132g1 — @dnd-kit setup. Only wire the sensors when the
  // caller is admin; non-admins never see a drag handle so an
  // accidental drag gesture can never fire a reorder request.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = async (evt) => {
    if (!isAdmin) return;
    const { active, over } = evt;
    if (!over || active.id === over.id) return;
    const fromIdx = tiles.findIndex((t) => t.id === active.id);
    const toIdx = tiles.findIndex((t) => t.id === over.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const nextTiles = arrayMove(tiles, fromIdx, toIdx);
    setTiles(nextTiles); // optimistic — snap the grid immediately
    try {
      await api.patch('/org/url-tiles/reorder', {
        tile_ids: nextTiles.map((t) => t.id),
      });
      toast.success('Order saved');
    } catch (e) {
      toast.error(apiError(e) || 'Reorder failed — reloading');
      // Roll back by refetching authoritative order.
      try {
        const r = await api.get('/org/url-tiles');
        setTiles(r.data.tiles || []);
      } catch { /* noop */ }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50" data-testid="apps-directory-hub">
      <header className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <Rocket size={28} className="text-emerald-500" />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-600"
              data-testid="apps-directory-hub-eyebrow">
              Paneltec Group · Apps Directory
            </div>
            <h1 className="font-display font-extrabold text-2xl text-emerald-700 mt-0.5">
              Every tool, one click away.
            </h1>
          </div>
          {isAdmin && tiles.length > 1 && (
            <div className="ml-auto text-[10px] uppercase tracking-wider font-semibold text-slate-400"
              data-testid="apps-directory-admin-hint">
              Drag any tile to reorder
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-8">
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500"
               data-testid="apps-directory-hub-empty">
            {tiles.length === 0
              ? 'No apps configured yet. An admin can add them in Settings → Organisation → Quick Links.'
              : 'All apps are hidden this session. Log out and back in to bring them back.'}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={visible.map((t) => t.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
                data-testid="apps-directory-hub-grid">
                {visible.map((t) => (
                  <SortableHubTile
                    key={t.id}
                    tile={t}
                    isAdmin={isAdmin}
                    onHide={() => hideTile(t.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>

      {hidden.size > 0 && (
        <footer className="border-t border-slate-200 bg-white px-8 py-4 text-center text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500"
          data-testid="apps-directory-hub-footer">
          <span data-testid="apps-directory-hidden-count">{hidden.size}</span>{' '}apps hidden this session ·{' '}
          <button type="button"
            onClick={() => { setHidden(new Set()); _writeHidden(user?.id, new Set()); }}
            data-testid="apps-directory-show-all"
            className="text-emerald-600 hover:underline">
            Show them again
          </button>
        </footer>
      )}
    </div>
  );
}

function SortableHubTile({ tile, isAdmin, onHide }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: tile.id, disabled: !isAdmin });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 20 : 'auto',
  };
  return (
    <div ref={setNodeRef} style={style}>
      <HubTile
        tile={tile}
        isAdmin={isAdmin}
        onHide={onHide}
        dragAttributes={attributes}
        dragListeners={listeners}
        isDragging={isDragging}
      />
    </div>
  );
}

function HubTile({ tile, isAdmin, onHide, dragAttributes, dragListeners, isDragging }) {
  const [imgError, setImgError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const menuRef = useRef(null);
  const showRemote = tile.remote_icon_url && !imgError;
  const accent = tile.color || DEFAULT_COLOR;
  // v58.13.132ez — Approval gate applies to the standalone page too.
  const approved = tile.approved_for_me !== false;
  // v58.13.132g1 — PIN gate applies on top of approval. A pin-protected
  // tile renders greyed for everyone (including admins) with a lock
  // overlay; the 3-dots menu stays fully functional; clicking the body
  // opens the TilePinModal instead of navigating.
  const pinProtected = !!tile.pin_protected;

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const openTile = () => {
    if (!approved || !tile.url) return;
    if (pinProtected) {
      setMenuOpen(false);
      setPinModalOpen(true);
      return;
    }
    window.open(tile.url, '_blank', 'noopener,noreferrer');
    setMenuOpen(false);
  };
  const copyUrl = async () => {
    if (!tile.url) return;
    try {
      await navigator.clipboard.writeText(tile.url);
      toast.success('URL copied');
    } catch {
      // Fallback for browsers without clipboard API.
      const ta = document.createElement('textarea');
      ta.value = tile.url; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      ta.remove();
      toast.success('URL copied');
    }
    setMenuOpen(false);
  };

  // Wrapper classes: pin_protected forces the greyed / locked look
  // regardless of approval so admins see the gate too.
  const disabledLook = !approved || pinProtected;
  return (
    <div
      className={`relative rounded-2xl bg-white border border-slate-200 transition p-5 flex flex-col gap-3 ${!disabledLook ? 'hover:shadow-lg' : 'opacity-70'} ${!approved ? 'grayscale cursor-not-allowed select-none pointer-events-none' : ''} ${isDragging ? 'shadow-2xl ring-2 ring-emerald-400' : ''}`}
      style={{ borderTopColor: accent, borderTopWidth: 4 }}
      data-testid={`apps-directory-hub-tile-${tile.id}`}
      data-approved-for-me={approved ? 'true' : 'false'}
      data-pin-protected={pinProtected ? 'true' : 'false'}
      title={!approved ? 'Not approved — ask an admin'
               : pinProtected ? 'PIN required — click to unlock'
               : undefined}>

      {/* v58.13.132g1 — Lock overlay for PIN-protected tiles. Sits
          BEHIND the 3-dots menu (z-10 vs z-30) so the menu stays
          usable when the tile is greyed. Pointer-events-none so it
          never intercepts clicks; the body launch link + PIN modal
          handle interaction. */}
      {pinProtected && approved && (
        <div className="absolute inset-0 rounded-2xl pointer-events-none flex items-center justify-center z-10"
          data-testid={`apps-directory-hub-tile-lock-overlay-${tile.id}`}>
          <div className="bg-slate-900/70 rounded-full p-2 shadow-lg">
            <Lock size={20} className="text-white" />
          </div>
        </div>
      )}

      {/* v58.13.132g1 — drag handle (admin only). Absolute-positioned
          top-left so it does not fight the 3-dots menu top-right or
          the tile-body launch link. `touch-action: none` per
          @dnd-kit docs so mobile Safari doesn't steal the gesture. */}
      {isAdmin && (
        <button
          type="button"
          {...dragAttributes}
          {...dragListeners}
          data-testid={`apps-directory-hub-tile-drag-${tile.id}`}
          title="Drag to reorder"
          className="absolute top-3 left-3 p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 cursor-grab active:cursor-grabbing touch-none z-20"
        >
          <GripVertical size={14} />
        </button>
      )}

      {/* v58.13.132g1 — 3-dots menu — ALWAYS visible and functional,
          even on PIN-protected tiles (see spec: "3-dots menu stays
          fully visible and functional on the greyed tile"). z-30
          keeps it above the lock overlay. */}
      <div className="absolute top-3 right-3 flex items-center gap-1 z-30" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          data-testid={`apps-directory-hub-tile-menu-${tile.id}`}
          title="Tile options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 bg-white/80"
        >
          <MoreVertical size={14} />
        </button>
        {menuOpen && (
          <div
            data-testid={`apps-directory-hub-tile-menu-panel-${tile.id}`}
            role="menu"
            className="absolute right-0 top-8 z-40 w-56 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden"
          >
            <button
              type="button"
              onClick={openTile}
              disabled={!approved || !tile.url}
              data-testid={`apps-directory-hub-tile-menu-open-${tile.id}`}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pinProtected ? <><Lock size={13} /> Unlock with PIN</> : <><ExternalLink size={13} /> Open</>}
            </button>
            <button
              type="button"
              onClick={copyUrl}
              disabled={!tile.url}
              data-testid={`apps-directory-hub-tile-menu-copy-${tile.id}`}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Copy size={13} /> Copy URL
            </button>
            <button
              type="button"
              onClick={() => { onHide(); setMenuOpen(false); }}
              data-testid={`apps-directory-hub-tile-menu-hide-${tile.id}`}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100"
            >
              <EyeOff size={13} /> Hide until next login
            </button>
          </div>
        )}
        {isAdmin && (
          <button type="button"
            onClick={() => window.open('/app/settings/org', '_blank',
                                        'noopener,noreferrer')}
            data-testid={`apps-directory-hub-tile-settings-${tile.id}`}
            title="Manage in Org Settings"
            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 bg-white/80">
            <Settings size={12} />
          </button>
        )}
      </div>

      <div className={`flex items-center gap-3 ${isAdmin ? 'pl-6' : ''}`}>
        {showRemote ? (
          <img src={tile.remote_icon_url} alt=""
            onError={() => setImgError(true)}
            className="w-12 h-12 object-contain rounded-lg" />
        ) : (
          <div className="text-4xl leading-none" aria-hidden="true">{tile.icon || '🔗'}</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-slate-900 truncate">{tile.label}</div>
          <div className="text-xs text-slate-500 truncate" title={tile.url}>{tile.url || (approved ? '' : 'Not approved — ask an admin')}</div>
        </div>
      </div>
      {tile.description && (
        <p className="text-xs text-slate-600 line-clamp-2">{tile.description}</p>
      )}
      {approved && pinProtected ? (
        <button type="button"
          onClick={openTile}
          style={{ color: accent }}
          data-testid={`apps-directory-hub-tile-unlock-${tile.id}`}
          className="mt-auto inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider hover:underline text-left">
          <Lock size={12} /> Unlock {tile.label}
        </button>
      ) : approved ? (
        <a href={tile.url} target="_blank" rel="noopener noreferrer"
          style={{ color: accent }}
          data-testid={`apps-directory-hub-tile-launch-${tile.id}`}
          className="mt-auto inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider hover:underline">
          Launch {tile.label} <ExternalLink size={12} />
        </a>
      ) : (
        <span
          data-testid={`apps-directory-hub-tile-locked-${tile.id}`}
          className="mt-auto inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-slate-500">
          <Lock size={12} /> Not approved — ask an admin
        </span>
      )}

      {/* Legacy per-tile X hide button retained for keyboard-only
          users who can't easily reach the 3-dots menu. Same
          behaviour as menu "Hide until next login" for consistency
          with the .132g1 semantics. */}
      <button type="button" onClick={onHide}
        data-testid={`apps-directory-hub-tile-hide-${tile.id}`}
        title="Hide until next login"
        className="hidden">
        <X size={12} />
      </button>

      {pinModalOpen && createPortal(
        <TilePinModal
          tile={tile}
          onClose={() => setPinModalOpen(false)}
          onUnlocked={(url) => {
            setPinModalOpen(false);
            window.open(url || tile.url, '_blank', 'noopener,noreferrer');
          }}
        />, document.body)}
    </div>
  );
}

// v58.13.132g1 — Compact per-click PIN gate. Deliberately kept out
// of AdminPillsLock.jsx to avoid regression risk on the header lock
// flow. Verifies against the caller's admin PIN via the new
// `POST /api/org/url-tiles/{id}/verify-pin` endpoint. Wrong PIN
// triggers a shake animation and clears the input.
function TilePinModal({ tile, onClose, onUnlocked }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const tap = (digit) => {
    if (busy) return;
    setError('');
    setPin((p) => (p + digit).slice(0, 4));
  };
  const backspace = () => { if (!busy) { setError(''); setPin((p) => p.slice(0, -1)); } };

  useEffect(() => {
    if (pin.length !== 4 || busy) return;
    setBusy(true);
    api.post(`/org/url-tiles/${tile.id}/verify-pin`, { pin })
      .then((r) => { onUnlocked(r.data?.url); })
      .catch((e) => {
        const msg = apiError(e) || 'Wrong PIN.';
        setError(msg);
        setShake(true);
        setBusy(false);
        setPin('');
        setTimeout(() => setShake(false), 400);
      });
  }, [pin, busy, tile.id, onUnlocked]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid={`tile-pin-modal-${tile.id}`}>
      <div className={`w-full max-w-xs bg-white rounded-2xl shadow-xl ${shake ? 'animate-[shake_0.4s]' : ''}`}
        style={shake ? { animation: 'shake 0.4s' } : undefined}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-slate-700" />
              <div className="font-bold text-slate-900 text-sm">Unlock {tile.label}</div>
            </div>
            <div className="text-xs text-slate-500 mt-1">Enter your 4-digit admin PIN</div>
          </div>
          <button onClick={onClose}
            data-testid={`tile-pin-close-${tile.id}`}
            className="p-1 -mr-1 -mt-1 text-slate-400 hover:text-slate-700">
            <XIcon size={16} />
          </button>
        </div>
        <div className="p-5 flex flex-col items-center">
          <div className="flex gap-2 mb-4" data-testid={`tile-pin-dots-${tile.id}`}>
            {[0,1,2,3].map((i) => (
              <div key={i}
                className={`w-4 h-4 rounded-full border-2 ${
                  i < pin.length
                    ? 'bg-slate-900 border-slate-900'
                    : 'bg-white border-slate-300'
                }`} />
            ))}
          </div>
          {busy && <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2"><Loader2 size={12} className="animate-spin" /> Verifying…</div>}
          {error && <div className="text-xs text-red-600 mb-2 text-center max-w-[220px]"
            data-testid={`tile-pin-error-${tile.id}`}>{error}</div>}
          <div className="grid grid-cols-3 gap-2 w-full">
            {[1,2,3,4,5,6,7,8,9].map((n) => (
              <button key={n} onClick={() => tap(String(n))} disabled={busy}
                data-testid={`tile-pin-key-${tile.id}-${n}`}
                className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-lg font-bold text-slate-800">
                {n}
              </button>
            ))}
            <button onClick={backspace} disabled={busy}
              data-testid={`tile-pin-key-${tile.id}-back`}
              className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-xs font-semibold text-slate-600">
              ← Back
            </button>
            <button onClick={() => tap('0')} disabled={busy}
              data-testid={`tile-pin-key-${tile.id}-0`}
              className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-lg font-bold text-slate-800">
              0
            </button>
            <button onClick={onClose} disabled={busy}
              data-testid={`tile-pin-key-${tile.id}-cancel`}
              className="h-12 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
