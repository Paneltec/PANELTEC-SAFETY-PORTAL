import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, X, Rocket, Lock } from 'lucide-react';
import api, { apiError } from '../lib/api';

/**
 * v58.13.132es — <AppsDirectoryModal />
 *
 * In-app modal version of the "Paneltec Group · Apps Directory"
 * hub. Mounted at the AppShell level and toggled by the global
 * `paneltec:open-apps-directory` CustomEvent (dispatched by the
 * sidebar entry with `action: 'open-apps-directory'`).
 *
 * v58.13.132eu — Per-tile X (hide) and ⚙ (settings) buttons removed
 * per Stephen: "why would you give a user a delete x for thats a job
 * for super admin meaning me". Full-org tile visibility is now
 * controlled ONLY by the ON/OFF pill in the Org Settings management
 * table (Stephen's decision, applies to everyone). The per-user
 * localStorage "hidden" state + the "N APPS HIDDEN FROM YOUR HUB"
 * footer + "Show & manage" affordance were all removed. Tiles are
 * now clean launcher cards.
 */

const DEFAULT_COLOR = '#1d6fb8';

export default function AppsDirectoryModal({ open, onClose }) {
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  // v58.13.132et — Stabilise onClose via a ref so the Escape listener
  // doesn't churn every parent render.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api.get('/org/url-tiles');
        if (!cancelled) setTiles(r.data.tiles || []);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e) || 'Failed to load Apps Directory');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // v58.13.132et — Escape-to-close on `document` in the CAPTURE phase
  // so no descendant listener can swallow the event.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.stopPropagation();
        onCloseRef.current?.();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-center justify-center p-4"
      role="dialog" aria-modal="true"
      data-testid="apps-directory-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onCloseRef.current?.(); }}>
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-5 flex items-center gap-3">
          <Rocket size={26} className="text-emerald-500" />
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-600"
              data-testid="apps-directory-modal-eyebrow">
              Paneltec Group · Apps Directory
            </div>
            <h2 className="font-display font-extrabold text-2xl text-emerald-700 mt-0.5"
              data-testid="apps-directory-modal-tagline">
              Every tool, one click away.
            </h2>
          </div>
          <button type="button" onClick={() => onCloseRef.current?.()}
            data-testid="apps-directory-modal-close"
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
            <X size={22} />
          </button>
        </header>

        {/* Body — clean launcher grid, no per-tile controls. */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {loading ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : tiles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500"
                 data-testid="apps-directory-modal-empty">
              No tiles yet — Admin can add them in Settings → Organisation → Apps Directory · Tile management.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
              data-testid="apps-directory-modal-grid">
              {tiles.map((t) => (
                <HubTile key={t.id} tile={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HubTile({ tile }) {
  const [imgError, setImgError] = useState(false);
  const showRemote = tile.remote_icon_url && !imgError;
  const accent = tile.color || DEFAULT_COLOR;
  // v58.13.132ez — Approval gate. When the tile is not approved for
  // the current viewer, render a greyed / non-interactive card and
  // suppress the credential-vault reveal path.
  const approved = tile.approved_for_me !== false;
  // v58.13.132ev — Credential-aware click. If the current admin has
  // credentials stored for this tile, intercept the click: copy the
  // password to the clipboard, open the URL in a new tab, and pop a
  // cheat-sheet window with per-field COPY buttons. Otherwise fall
  // through to the plain `<a target="_blank">` behaviour.
  const onLaunch = async (e) => {
    if (!approved) {
      e.preventDefault();
      return;
    }
    try {
      const r = await api.get(`/tile-credentials/${tile.id}`);
      const meta = r.data || {};
      if (!meta.has_password && !(meta.qa_pairs || []).length && !meta.username) {
        return; // let anchor default fire
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
      window.open(tile.url, '_blank', 'noopener,noreferrer');
      openCheatSheet(tile, meta, plainPassword);
    } catch { /* GET failed — fall through */ }
  };
  const inner = (
    <>
      <div className="flex items-center gap-3">
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
      {approved ? (
        <span
          style={{ color: accent }}
          data-testid={`apps-directory-modal-tile-launch-${tile.id}`}
          className="mt-auto inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider group-hover:underline">
          Launch {tile.label} <ExternalLink size={12} />
        </span>
      ) : (
        <span
          data-testid={`apps-directory-modal-tile-locked-${tile.id}`}
          className="mt-auto inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-slate-500">
          <Lock size={12} /> Not approved — ask an admin
        </span>
      )}
    </>
  );
  if (!approved) {
    return (
      <div
        style={{ borderTopColor: accent, borderTopWidth: 4 }}
        data-testid={`apps-directory-modal-tile-${tile.id}`}
        data-approved-for-me="false"
        title="Not approved — ask an admin"
        className="group relative rounded-2xl bg-white border border-slate-200 p-5 flex flex-col gap-3 opacity-40 grayscale cursor-not-allowed select-none pointer-events-none">
        {inner}
      </div>
    );
  }
  return (
    <a href={tile.url} target="_blank" rel="noopener noreferrer"
      onClick={onLaunch}
      style={{ borderTopColor: accent, borderTopWidth: 4 }}
      data-testid={`apps-directory-modal-tile-${tile.id}`}
      data-approved-for-me="true"
      className="group relative rounded-2xl bg-white border border-slate-200 hover:shadow-lg transition p-5 flex flex-col gap-3">
      {inner}
    </a>
  );
}

// v58.13.132ev — Cheat-sheet popup helper. Uses `window.open` with a
// self-contained HTML doc listing COPY buttons per credential field.
// Falls back to no-op if the browser blocks the popup (rare — user-
// initiated click; browsers generally allow this). Password shown as
// last-4-mask only; full plaintext is passed in the initial `revealed`
// message for the clipboard copy that already happened synchronously
// in the parent, then wired to each COPY button via a data attr.
function openCheatSheet(tile, meta, revealed) {
  const w = window.open('', '_blank',
    'width=420,height=640,noopener,noreferrer');
  if (!w) return;
  const esc = (s) => String(s || '').replace(/[&<>"']/g,
    (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  const preview = meta.password_preview || '';
  const qaRows = (meta.qa_pairs || []).map((qa, i) => `
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

