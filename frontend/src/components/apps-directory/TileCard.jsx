import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  ExternalLink, Settings, X, Lock, MoreVertical, Copy, EyeOff,
  GripVertical, ShieldCheck, Loader2, X as XIcon,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import api, { apiError } from '../../lib/api';

/**
 * v58.13.132g3 — Shared Apps Directory tile primitives.
 *
 * Extracted from `pages/AppsDirectory.jsx` so the launcher modal
 * (`components/AppsDirectoryModal.jsx`) can reuse the same 3-dots
 * menu + drag-to-reorder + PIN gate + credential auto-launch that
 * `.132g1` shipped on the standalone page. Any change to tile
 * interaction now lives in ONE file.
 *
 * Public exports:
 *   · `useHiddenTiles(userId)`     → session-scoped hide state hook.
 *   · `TilePinModal`               → portalled 4-digit PIN keypad.
 *   · `openCheatSheet(...)`        → credential cheat-sheet popup.
 *   · `TileCard`                   → the visual tile card.
 *   · `SortableTileCard`           → `TileCard` wrapped for @dnd-kit.
 *   · `DEFAULT_TILE_COLOR`         → brand accent fallback.
 *
 * All testids include a `testIdPrefix` (e.g. `apps-directory-hub-tile`
 * or `apps-directory-modal-tile`) so both surfaces stay uniquely
 * addressable by Playwright.
 */

export const DEFAULT_TILE_COLOR = '#1d6fb8';

// ── Session hide (per-user) ────────────────────────────────────

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
  } catch { /* private mode — noop */ }
}

/**
 * v58.13.132g9 — `useHiddenTiles` retained as a NO-OP compatibility
 * shim so existing imports don't break. Hide is now a server field
 * (`org_url_tiles.hidden`) — the parent grids handle the PATCH and
 * refetch cycle directly. The hook returns empty state; the real
 * work lives in the parent's `hideTile` / `resetHidden` handlers
 * (which call the server and refresh).
 */
export function useHiddenTiles(_userId) {
  return {
    hidden: new Set(),
    hideTile: () => {},
    resetHidden: () => {},
  };
}

// ── PIN modal (portalled) ──────────────────────────────────────

export function TilePinModal({ tile, onClose, onUnlocked }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  // v58.13.132g7 — Surface backend 429 (lockout) with a live
  // countdown instead of the generic shake. Prevents repeated
  // ".132g4/g5/g6"-style Playwright hammering from silently
  // burning through Stephen's PIN attempts — now the modal blocks
  // input and tells the user exactly how long to wait.
  const [lockedUntil, setLockedUntil] = useState(0); // epoch ms; 0 = unlocked
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lockedUntil) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);
  const lockedRemaining = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const isLocked = lockedRemaining > 0;

  const tap = (digit) => {
    if (busy || isLocked) return;
    setError('');
    setPin((p) => (p + digit).slice(0, 4));
  };
  const backspace = () => { if (!busy && !isLocked) { setError(''); setPin((p) => p.slice(0, -1)); } };

  useEffect(() => {
    if (pin.length !== 4 || busy) return;
    setBusy(true);
    api.post(`/org/url-tiles/${tile.id}/verify-pin`, { pin })
      .then((r) => { onUnlocked(r.data?.url); })
      .catch((e) => {
        const status = e?.response?.status;
        const detail = e?.response?.data?.detail || '';
        if (status === 429) {
          // Parse the "in Ns" from the detail; fall back to
          // Retry-After header if the detail shape ever changes.
          const m = /in\s+(\d+)\s*s/i.exec(detail);
          const secs = m ? parseInt(m[1], 10)
            : parseInt(e?.response?.headers?.['retry-after'] || '60', 10);
          setLockedUntil(Date.now() + Math.max(1, secs) * 1000);
          setError(''); // countdown UI replaces the error line
        } else {
          setError(apiError(e) || 'Wrong PIN.');
        }
        setShake(true);
        setBusy(false);
        setPin('');
        setTimeout(() => setShake(false), 400);
      });
  }, [pin, busy, tile.id, onUnlocked]);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid={`tile-pin-modal-${tile.id}`}>
      <div className="w-full max-w-xs bg-white rounded-2xl shadow-xl"
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
                  i < pin.length ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-300'
                }`} />
            ))}
          </div>
          {busy && <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2"><Loader2 size={12} className="animate-spin" /> Verifying…</div>}
          {isLocked && (
            <div className="w-full mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-center"
              data-testid={`tile-pin-locked-${tile.id}`}>
              <div className="text-xs font-bold text-red-700 uppercase tracking-wider">PIN locked</div>
              <div className="text-[11px] text-red-600 mt-0.5">
                Try again in {Math.floor(lockedRemaining / 60)}m {lockedRemaining % 60}s
              </div>
            </div>
          )}
          {error && !isLocked && <div className="text-xs text-red-600 mb-2 text-center max-w-[220px]"
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
              className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-xs font-semibold text-slate-600">← Back</button>
            <button onClick={() => tap('0')} disabled={busy}
              data-testid={`tile-pin-key-${tile.id}-0`}
              className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-lg font-bold text-slate-800">0</button>
            <button onClick={onClose} disabled={busy}
              data-testid={`tile-pin-key-${tile.id}-cancel`}
              className="h-12 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600">Cancel</button>
          </div>
        </div>
      </div>
    </div>, document.body);
}

// ── Credential cheat-sheet popup ───────────────────────────────

export function openCheatSheet(tile, meta, revealed) {
  const w = window.open('', '_blank', 'width=420,height=640,noopener,noreferrer');
  if (!w) return;
  const esc = (s) => String(s || '').replace(/[&<>"']/g,
    (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  const preview = meta.password_preview || '';
  const qaRows = (meta.qa_pairs || []).map((qa) => `
    <div class="row"><div class="label">${esc(qa.label)}</div>
    <button class="copy-btn" data-field="${esc(qa.label)}">COPY</button></div>`).join('');
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Your ${esc(tile.label)} cheat sheet</title>
<style>
  body{margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;}
  h1{font-size:16px;margin:0 0 4px;}
  .eyebrow{font-size:10px;font-weight:800;letter-spacing:0.2em;color:#059669;text-transform:uppercase;margin:0 0 12px;}
  .tick{color:#10b981;font-weight:bold;margin-right:4px;}
  p.body{font-size:12px;color:#475569;line-height:1.5;margin:0 0 16px;}
  .row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;}
  .label{font-size:11px;font-weight:600;color:#334155;flex:1;overflow:hidden;text-overflow:ellipsis;}
  .value{font-family:monospace;font-size:11px;color:#64748b;margin-right:8px;}
  .copy-btn{background:#0f172a;color:#fff;border:0;border-radius:6px;padding:6px 10px;font-size:11px;font-weight:700;letter-spacing:0.05em;cursor:pointer;}
  .copy-btn:hover{background:#1e293b;}
  .copied{background:#10b981;}
  .pin{position:sticky;bottom:0;background:#f8fafc;padding-top:12px;margin-top:12px;text-align:center;}
  .pin button{background:#f59e0b;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;font-size:12px;}
</style></head><body>
<div class="eyebrow">Your ${esc(tile.label)} cheat sheet</div>
<h1><span class="tick">✓</span>${esc(tile.label).toUpperCase()} OPENED IN A NEW TAB</h1>
<p class="body">Your password has been copied to the clipboard. Use the buttons below to copy each remaining field as ${esc(tile.label)} asks for it.</p>
<div class="row"><div class="label">Company URL</div><span class="value">${esc(tile.url)}</span><button class="copy-btn" data-field="__url__">COPY</button></div>
${meta.username ? `<div class="row"><div class="label">Username</div><span class="value">${esc(meta.username)}</span><button class="copy-btn" data-field="username">COPY</button></div>` : ''}
${meta.has_password ? `<div class="row"><div class="label">Password</div><span class="value">${esc(preview)}</span><button class="copy-btn" data-field="password">COPY</button></div>` : ''}
${qaRows}
<div class="pin"><button id="pin-btn" title="Best-effort — focus this window">📌 PIN ON TOP</button></div>
<script>
  const TILE_ID = ${JSON.stringify(tile.id)};
  const TILE_URL = ${JSON.stringify(tile.url)};
  const REVEALED = ${JSON.stringify(revealed || null)};
  const API = ${JSON.stringify(window.location.origin)};
  const TOKEN = ${JSON.stringify(localStorage.getItem('paneltec_token') || '')};
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const f = btn.getAttribute('data-field');
      let val = '';
      if (f === '__url__') { val = TILE_URL; }
      else if (f === 'password' && REVEALED) { val = REVEALED; }
      else {
        try {
          const r = await fetch(API + '/api/tile-credentials/' + TILE_ID + '/copy-field', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
            body: JSON.stringify({ field: f }),
          });
          const j = await r.json();
          val = j.value || '';
        } catch (e) {}
      }
      try { await navigator.clipboard.writeText(val); } catch (e) {}
      btn.textContent = 'COPIED';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'COPY'; btn.classList.remove('copied'); }, 1500);
    });
  });
  document.getElementById('pin-btn').addEventListener('click', () => {
    try { window.focus(); } catch (e) {}
  });
</script>
</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ── Tile card ──────────────────────────────────────────────────

/**
 * @param {object}   props
 * @param {object}   props.tile
 * @param {boolean}  props.isAdmin
 * @param {boolean=} props.hasAdminPin           v58.13.132g6 — flows in
 *                                               from the parent's
 *                                               `/auth/admin-console/status`
 *                                               probe. Without a
 *                                               configured PIN the
 *                                               3-dots button is NOT
 *                                               rendered (can't gate
 *                                               a PIN that doesn't
 *                                               exist). Backend
 *                                               endpoint is admin-only,
 *                                               so non-admins fall
 *                                               through here naturally.
 * @param {(id: string) => void} props.onHide
 * @param {(id: string) => void=} props.onRestore   v58.13.132g9 — Server-
 *                                                  side restore (flips
 *                                                  `hidden` → false). When
 *                                                  `tile.hidden === true`
 *                                                  the menu swaps "Hide"
 *                                                  for "Restore". Menu is
 *                                                  already PIN-gated by
 *                                                  .132g6 so the PIN
 *                                                  requirement holds.
 * @param {string}   props.testIdPrefix         `apps-directory-hub-tile` OR `apps-directory-modal-tile`
 * @param {boolean=} props.credentialLaunch      When true, tapping the launch link
 *                                               intercepts to auto-copy password
 *                                               and pop the cheat-sheet (modal
 *                                               surface). When false, plain
 *                                               `window.open`.
 * @param {boolean=} props.showAdminSettingsIcon Renders the ⚙ shortcut to
 *                                               `/app/settings/org`. Standalone
 *                                               page only — the modal has its
 *                                               own admin path.
 * @param {object=}  props.dragAttributes  from useSortable
 * @param {object=}  props.dragListeners   from useSortable
 * @param {boolean=} props.isDragging      from useSortable
 */
export function TileCard({
  tile, isAdmin, hasAdminPin = false, onHide, onRestore, testIdPrefix,
  credentialLaunch = false, showAdminSettingsIcon = false,
  dragAttributes, dragListeners, isDragging,
}) {
  const [imgError, setImgError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  // v58.13.132g5 — PIN gate on the 3-dots menu too. Stephen:
  // "so it looks like you have given everybody the ability with
  // out signing in on the 3 dots". Track WHAT a PIN unlock is
  // intended to trigger — either the URL launch OR revealing the
  // dropdown menu. Reset on every close so unlocks are per-click.
  const [pinIntent, setPinIntent] = useState(null); // 'launch' | 'menu' | null
  const menuRef = useRef(null);
  const showRemote = tile.remote_icon_url && !imgError;
  const accent = tile.color || DEFAULT_TILE_COLOR;
  const approved = tile.approved_for_me !== false;
  const pinProtected = !!tile.pin_protected;

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const doPlainOpen = (url) => {
    window.open(url || tile.url, '_blank', 'noopener,noreferrer');
  };

  // v58.13.132ev — Credential-aware launch. When `credentialLaunch`
  // is true (launcher modal path), a GET on `/tile-credentials/{id}`
  // decides whether to intercept the anchor and pop the cheat-sheet
  // window; otherwise the anchor's default `target=_blank` fires.
  // Saved logins are only released by the server after the PIN has
  // been entered (tile_unlock.py). `meta.locked` → ask for the PIN,
  // then run this again with the unlocked URL.
  const credentialAwareLaunch = async (e, urlOverride) => {
    if (!approved) { e.preventDefault(); return; }
    const launchUrl = urlOverride || tile.url;
    try {
      const r = await api.get(`/tile-credentials/${tile.id}`);
      const meta = r.data || {};
      if (meta.locked && (meta.has_password || meta.has_username || (meta.qa_pairs || []).length)) {
        e.preventDefault();
        setPinIntent('launch');
        setPinModalOpen(true);
        return;
      }
      if (!meta.has_password && !(meta.qa_pairs || []).length && !meta.username) {
        if (urlOverride) doPlainOpen(urlOverride);
        return;
      }
      e.preventDefault();
      let plainPassword = null;
      if (meta.has_password) {
        try {
          const rp = await api.post(`/tile-credentials/${tile.id}/reveal`);
          plainPassword = rp.data?.password || null;
          if (plainPassword) {
            try { await navigator.clipboard.writeText(plainPassword); } catch { /* noop */ }
          }
        } catch { /* noop */ }
      }
      window.open(launchUrl, '_blank', 'noopener,noreferrer');
      openCheatSheet(tile, meta, plainPassword);
    } catch { /* GET failed — anchor default fires */ }
  };

  const openTile = (e) => {
    // PIN-protected tiles arrive without their link until the PIN is
    // entered, so don't require `tile.url` for them.
    if (!approved || (!tile.url && !pinProtected)) return;
    if (pinProtected) {
      if (e) e.preventDefault?.();
      setMenuOpen(false);
      // v58.13.132g5 — PIN unlock is intended to launch the URL.
      setPinIntent('launch');
      setPinModalOpen(true);
      return;
    }
    setMenuOpen(false);
    if (credentialLaunch) {
      credentialAwareLaunch(e || { preventDefault(){} });
    } else {
      doPlainOpen();
    }
  };

  // v58.13.132g6 — 3-dots click. Now ALWAYS prompts for the admin
  // PIN, on every tile (public + PIN-protected). The `.132g5`
  // behaviour where only pin_protected tiles gated the menu let
  // any authenticated user peel URLs / hide tiles / read metadata
  // through the 3-dots on public tiles, which Stephen flagged:
  // "why do you give every body the ability to log the view and
  // the ability to bring them back again and not password
  // control". `hasAdminPin` gates whether the 3-dots renders at
  // all — see the render below.
  const toggleMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    // Every menu-open re-prompts (per-click, not per-session).
    setPinIntent('menu');
    setPinModalOpen(true);
  };

  const copyUrl = async () => {
    if (!tile.url) return;
    try {
      await navigator.clipboard.writeText(tile.url);
      toast.success('URL copied');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = tile.url; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      ta.remove();
      toast.success('URL copied');
    }
    setMenuOpen(false);
  };

  const disabledLook = !approved || pinProtected;
  return (
    <div
      className={`relative rounded-2xl bg-white border border-slate-200 transition p-5 flex flex-col gap-3 ${!disabledLook ? 'hover:shadow-lg' : 'opacity-70'} ${!approved ? 'grayscale' : ''} ${isDragging ? 'shadow-2xl ring-2 ring-emerald-400' : ''}`}
      style={{ borderTopColor: accent, borderTopWidth: 4 }}
      data-testid={`${testIdPrefix}-${tile.id}`}
      data-approved-for-me={approved ? 'true' : 'false'}
      data-pin-protected={pinProtected ? 'true' : 'false'}
      title={!approved ? 'Not approved — ask an admin'
               : pinProtected ? 'PIN required — click to unlock'
               : undefined}>

      {pinProtected && approved && (
        <div className="absolute inset-0 rounded-2xl pointer-events-none flex items-center justify-center z-10"
          data-testid={`${testIdPrefix}-lock-overlay-${tile.id}`}>
          <div className="bg-slate-900/70 rounded-full p-2 shadow-lg">
            <Lock size={20} className="text-white" />
          </div>
        </div>
      )}

      {/* v58.13.132g4 — Prominent drag handle. Stephen's .132g3
          feedback was "i cant drag the tils around" — the .132g3
          handle was a 14px slate-300 grip that was almost invisible
          on light backgrounds. Now: 18px, slate-500 by default,
          slate-800 on hover with a soft slate-100 background,
          `cursor-grab` on hover / `cursor-grabbing` when held.
          Sits at top-left with a title="Drag to reorder" tooltip
          and `touch-action: none` per @dnd-kit docs so mobile
          Safari doesn't steal the gesture. Admin-only. */}
      {isAdmin && (
        <button
          type="button"
          {...(dragAttributes || {})}
          {...(dragListeners || {})}
          data-testid={`${testIdPrefix}-drag-${tile.id}`}
          title="Drag to reorder"
          aria-label="Drag to reorder"
          className="absolute top-2.5 left-2.5 p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-grab active:cursor-grabbing touch-none z-20 bg-white/90 border border-slate-200 shadow-sm"
        >
          <GripVertical size={18} />
        </button>
      )}

      <div className="absolute top-3 right-3 flex items-center gap-1 z-30" ref={menuRef}>
        {/* v58.13.132g6 — 3-dots button only renders when the caller
            has an admin PIN configured. Everyone else can't clear
            the gate anyway, so hiding the affordance is honest —
            the pre-.132g6 always-visible button set the wrong
            expectation. `hasAdminPin` is fetched once by each
            parent grid via /auth/admin-console/status (admin-only;
            non-admins get 403 and hasAdminPin stays false). */}
        {hasAdminPin && (
          <button
            type="button"
            onClick={toggleMenu}
            data-testid={`${testIdPrefix}-menu-${tile.id}`}
            // v58.13.132g6 — every menu open requires a PIN, so the
            // tooltip is unconditional now.
            title="PIN required · actions for this tile"
            aria-label="PIN required · actions for this tile"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 bg-white/90"
          >
            <MoreVertical size={14} />
          </button>
        )}
        {menuOpen && (
          <div
            data-testid={`${testIdPrefix}-menu-panel-${tile.id}`}
            role="menu"
            className="absolute right-0 top-8 z-40 w-64 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* v58.13.132g4 — On PIN-protected tiles the top action
                becomes the ONLY launch affordance (was "Open" alongside
                a locked card body). One clear primary action removes
                the confusion Stephen flagged between Hide and PIN. */}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); openTile(); }}
              disabled={!approved || (!tile.url && !pinProtected)}
              data-testid={`${testIdPrefix}-menu-open-${tile.id}`}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pinProtected ? <><Lock size={13} /> Unlock with PIN</> : <><ExternalLink size={13} /> Open</>}
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); copyUrl(); }}
              disabled={!tile.url}
              data-testid={`${testIdPrefix}-menu-copy-${tile.id}`}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Copy size={13} /> Copy URL
            </button>
            {/* v58.13.132g4 — Copy rewrite. Stephen confused Hide with
                PIN protection. New label + sub-label makes clear this
                is a view-only, per-user, non-secure toggle. Distinct
                testid preserved for source pins / Playwright.

                v58.13.132g9 — Hide is now ORG-WIDE via a server field
                (`org_url_tiles.hidden`). When the tile is already
                hidden, this row becomes "Restore" instead of "Hide"
                so admins in `Show hidden` mode can put it back. The
                sub-label is updated to reflect org-wide scope. */}
            {tile.hidden ? (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); if (onRestore) onRestore(tile.id); setMenuOpen(false); }}
                data-testid={`${testIdPrefix}-menu-restore-${tile.id}`}
                className="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100"
              >
                <span className="flex items-center gap-2"><EyeOff size={13} /> Restore tile for the whole org</span>
                <span className="text-[10px] text-slate-400 ml-5 italic">Makes this tile visible again for every user.</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); onHide(tile.id); setMenuOpen(false); }}
                data-testid={`${testIdPrefix}-menu-hide-${tile.id}`}
                className="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100"
              >
                <span className="flex items-center gap-2"><EyeOff size={13} /> Hide tile for the whole org</span>
                <span className="text-[10px] text-slate-400 ml-5 italic">Removes this tile from every user's view. Admins with PIN can restore it.</span>
              </button>
            )}
          </div>
        )}
        {isAdmin && showAdminSettingsIcon && (
          <button type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation();
              window.open('/app/settings/org', '_blank', 'noopener,noreferrer'); }}
            data-testid={`${testIdPrefix}-settings-${tile.id}`}
            title="Manage in Org Settings"
            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 bg-white/90">
            <Settings size={12} />
          </button>
        )}
      </div>

      {/* Body — clicking this area launches unless PIN-gated. */}
      <a
        href={approved && !pinProtected ? tile.url : '#'}
        target="_blank"
        rel="noopener noreferrer"
        onClick={openTile}
        data-testid={`${testIdPrefix}-body-${tile.id}`}
        className={`flex-1 flex flex-col gap-3 ${!approved ? 'cursor-not-allowed pointer-events-none' : ''}`}>
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
          <span
            style={{ color: accent }}
            data-testid={`${testIdPrefix}-unlock-${tile.id}`}
            className="mt-auto inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider hover:underline">
            <Lock size={12} /> Unlock {tile.label}
          </span>
        ) : approved ? (
          <span
            style={{ color: accent }}
            data-testid={`${testIdPrefix}-launch-${tile.id}`}
            className="mt-auto inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider hover:underline">
            Launch {tile.label} <ExternalLink size={12} />
          </span>
        ) : (
          <span
            data-testid={`${testIdPrefix}-locked-${tile.id}`}
            className="mt-auto inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-slate-500">
            <Lock size={12} /> Not approved — ask an admin
          </span>
        )}
      </a>

      {pinModalOpen && (
        <TilePinModal
          tile={tile}
          onClose={() => { setPinModalOpen(false); setPinIntent(null); }}
          onUnlocked={(url) => {
            const intent = pinIntent;
            setPinModalOpen(false);
            setPinIntent(null);
            // v58.13.132g5 — Branch on intent. `menu` reveals the
            // dropdown (still per-click — closing + reopening the
            // 3-dots re-prompts); `launch` opens the URL in a new
            // tab. Any other value is a no-op fallback.
            if (intent === 'menu') {
              setMenuOpen(true);
            } else if (intent === 'launch') {
              if (credentialLaunch) credentialAwareLaunch({ preventDefault() {} }, url);
              else doPlainOpen(url);
            }
          }}
        />
      )}
    </div>
  );
}

// ── @dnd-kit wrapper ───────────────────────────────────────────

export function SortableTileCard({ tile, isAdmin, ...rest }) {
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
      <TileCard
        tile={tile}
        isAdmin={isAdmin}
        dragAttributes={attributes}
        dragListeners={listeners}
        isDragging={isDragging}
        {...rest}
      />
    </div>
  );
}
