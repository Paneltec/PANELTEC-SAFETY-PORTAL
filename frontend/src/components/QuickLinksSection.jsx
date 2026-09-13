import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Link2, Plus, Pencil, Trash2, ExternalLink, X, Rocket, Lock,
} from 'lucide-react';
import api, { apiError } from '../lib/api';
import { useCan } from '../lib/permissions';

/**
 * v58.13.132eo — <QuickLinksSection />
 *
 * Admin-managed URL tiles on Org Settings. Displays existing tiles
 * as a compact preview + a "Manage tiles" button that opens the
 * management popup.
 *
 * v58.13.132er — Manager popup redesigned to the "Paneltec Group
 * Portal · APPS DIRECTORY · QUICK TOOLS" table layout per Stephen's
 * reference image. 7 columns: ON · ICON · NAME · LOGIN URL ·
 * DESCRIPTION · COLOR · ACTIONS. Inline "+ ADD TILE" row at the
 * bottom. ON/OFF pill hides tiles without deleting; disabled tiles
 * are filtered out of the read-only Quick Links page.
 */

const CLIENT_URL_RE = /^https?:\/\//i;
const DEFAULT_COLOR = '#1d6fb8';

// v58.13.132ew — Auto-assign a distinct accent colour per tile based
// on a stable hash of the tile's name. Palette + hash MUST mirror
// `backend/org_url_tiles.py::_AUTO_PALETTE` / `_auto_color_for()` so
// the live editor preview matches what the server returns on read.
// Sentinel `DEFAULT_COLOR` is deliberately absent so it can act as
// "unset / auto" without being ambiguous with a legitimate blue
// pick.
export const AUTO_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#7c3aed',
  '#14b8a6', '#f97316', '#ec4899', '#6366f1',
  '#f59e0b', '#06b6d4', '#f43f5e', '#10b981',
];

export function autoColor(seed) {
  const s = (seed || '').trim().toLowerCase();
  if (!s) return AUTO_PALETTE[0];
  let total = 0;
  for (let i = 0; i < s.length; i += 1) total += s.charCodeAt(i);
  return AUTO_PALETTE[total % AUTO_PALETTE.length];
}

function validateUrl(raw) {
  const url = (raw || '').trim();
  if (!url) return 'URL is required';
  if (!CLIENT_URL_RE.test(url)) return 'URL must start with http:// or https://';
  try { new URL(url); } catch { return 'URL is malformed'; }
  return null;
}

export default function QuickLinksSection() {
  const can = useCan();
  // v58.13.132ex — Admin-only gate on the "Manage tiles" button.
  // Stephen reported Amanda (non-admin) could reach Tile Management
  // through this section. Non-admins now see the button greyed out
  // with an "Admin only" tooltip; click is a no-op. Backend already
  // guards the mutating endpoints with `_admin(user)` (defense in
  // depth) — this is the UX layer to match. Same permission token
  // (`users.edit`) used by other admin-only affordances across the
  // shell.
  const isAdmin = can('users', 'edit');
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [managerOpen, setManagerOpen] = useState(false);

  // Preview grid uses the "public" filter (enabled only). Manager uses
  // ?include_disabled=true so admins can toggle hidden tiles back on.
  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/org/url-tiles');
      setTiles(r.data.tiles || []);
    } catch (e) {
      toast.error(apiError(e) || 'Failed to load Quick Links');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5" data-testid="org-quick-links-section">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-orange-50 flex items-center justify-center">
            <Link2 size={14} className="text-orange-600" />
          </div>
          <h3 className="font-display font-semibold text-base text-slate-800">Apps Directory · Tile management</h3>
        </div>
        <button type="button"
          onClick={() => { if (isAdmin) setManagerOpen(true); }}
          disabled={!isAdmin}
          aria-disabled={!isAdmin}
          title={isAdmin ? undefined : 'Admin only'}
          data-testid="org-quick-links-manage-btn"
          data-admin-only={isAdmin ? 'false' : 'true'}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-900 text-white ${isAdmin ? 'hover:bg-slate-800' : 'opacity-50 cursor-not-allowed pointer-events-none'}`}>
          <Pencil size={12} /> Manage tiles
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Bookmark-style tiles that open in a new window. Useful for the banking portal, supplier logins, and any external
        surface your team hits on a daily basis.
      </p>

      {loading ? (
        <div className="text-sm text-slate-500" data-testid="org-quick-links-loading">Loading…</div>
      ) : tiles.length === 0 ? (
        <div className="text-sm text-slate-500" data-testid="org-quick-links-empty">
          No tiles yet — {isAdmin
            ? <>click <span className="font-semibold">Manage tiles</span> to add your first Quick Link.</>
            : <>Admin can add them in Settings → Organisation → Apps Directory · Tile management.</>}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="org-quick-links-preview-grid">
          {tiles.map((t) => (
            <TilePreviewCard key={t.id} tile={t} />
          ))}
        </div>
      )}

      {isAdmin && managerOpen && (
        <AppsDirectoryManager onClose={() => { setManagerOpen(false); load(); }} />
      )}
    </div>
  );
}

function TilePreviewCard({ tile }) {
  const [imgError, setImgError] = useState(false);
  const showRemote = tile.remote_icon_url && !imgError;
  const accent = tile.color || DEFAULT_COLOR;
  // v58.13.132ez — Grey-out un-approved tiles. Every user still sees
  // the tile (name / icon / colour) but the click is disabled and
  // the URL has been redacted server-side.
  const approved = tile.approved_for_me !== false;
  const commonProps = {
    'data-testid': `org-quick-links-tile-${tile.id}`,
    'data-approved-for-me': approved ? 'true' : 'false',
    style: { borderLeftColor: accent, borderLeftWidth: 4 },
    title: approved ? (tile.description || tile.url) : 'Not approved — ask an admin',
  };
  const cardContent = (
    <>
      {showRemote ? (
        <img src={tile.remote_icon_url} alt=""
          onError={() => setImgError(true)}
          data-testid={`org-quick-links-tile-img-${tile.id}`}
          className="w-10 h-10 object-contain rounded" />
      ) : (
        <div className="text-3xl leading-none" aria-hidden="true">{tile.icon || '🔗'}</div>
      )}
      <div className="text-xs font-semibold text-slate-800 text-center line-clamp-2">{tile.label}</div>
      {approved ? (
        <ExternalLink size={11} className="absolute top-2 right-2 text-slate-400 group-hover:text-orange-500" />
      ) : (
        <Lock size={11} className="absolute top-2 right-2 text-slate-400"
          data-testid={`org-quick-links-tile-locked-${tile.id}`} />
      )}
    </>
  );
  if (!approved) {
    return (
      <div {...commonProps}
        className="group relative flex flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-4 min-h-[110px] opacity-40 grayscale cursor-not-allowed select-none">
        {cardContent}
      </div>
    );
  }
  return (
    <a href={tile.url} target="_blank" rel="noopener noreferrer"
      {...commonProps}
      className="group relative flex flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:shadow-sm transition p-4 min-h-[110px]">
      {cardContent}
    </a>
  );
}

// ── v58.13.132er — Apps Directory table manager ────────────────────
function AppsDirectoryManager({ onClose }) {
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editorTile, setEditorTile] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  // v58.13.132fa — Cache eligible-users at manager scope so the inline
  // "Approved users" chip row on each restricted TileRow can look up
  // display names without an N+1 fetch. Non-blocking: the table
  // renders immediately; chip labels fall back to raw IDs if the
  // fetch is still in flight.
  const [usersById, setUsersById] = useState({});

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      // Include disabled tiles so admins can flip them back on.
      const r = await api.get('/org/url-tiles?include_disabled=true');
      setTiles(r.data.tiles || []);
    } catch (e) {
      toast.error(apiError(e) || 'Failed to refresh');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    api.get('/org/url-tiles/eligible-users')
      .then((r) => {
        if (cancelled) return;
        const map = {};
        for (const u of (r.data?.users || [])) map[u.id] = u;
        setUsersById(map);
      })
      .catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, []);

  const toggleEnabled = async (tile) => {
    // Optimistic — flip local + PATCH; revert on failure.
    const next = tiles.map((t) => t.id === tile.id
      ? { ...t, enabled: !t.enabled } : t);
    setTiles(next);
    try {
      await api.patch(`/org/url-tiles/${tile.id}`, { enabled: !tile.enabled });
    } catch (e) {
      toast.error(apiError(e) || 'Toggle failed');
      setTiles(tiles);
    }
  };

  const onDelete = async (tile) => {
    try {
      await api.delete(`/org/url-tiles/${tile.id}`);
      toast.success(`Deleted "${tile.label}"`);
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      toast.error(apiError(e) || 'Delete failed');
    }
  };

  const onSaved = async () => { setEditorTile(null); await refresh(); };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 flex items-center justify-center p-4"
      role="dialog" aria-modal="true"
      data-testid="org-quick-links-manager">
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header — dark navy with rocket, per reference image. */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-start gap-3">
          <div className="mt-0.5">
            <Rocket size={22} className="text-orange-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-display font-semibold text-base tracking-wide uppercase"
              data-testid="apps-directory-title">
              Apps Directory · Quick Tools
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              One row = one tile on the Hub home page. Edit the URL here once, staff click the tile and land in the right place.
            </p>
          </div>
          <button type="button" onClick={onClose}
            data-testid="org-quick-links-manager-close"
            className="p-1 rounded hover:bg-slate-800 text-slate-300">
            <X size={20} />
          </button>
        </div>

        {/* Body — table. */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading…</div>
          ) : (
            <table className="min-w-full text-sm" data-testid="apps-directory-table">
              <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 z-10">
                <tr>
                  <Th>On</Th>
                  <Th>Icon</Th>
                  <Th>Name</Th>
                  <Th>Login URL (where the tile takes you)</Th>
                  <Th>Description</Th>
                  <Th>Color</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {tiles.map((t, idx) => (
                  <TileRow key={t.id} tile={t} zebra={idx % 2 === 1}
                    usersById={usersById}
                    onToggle={() => toggleEnabled(t)}
                    onEdit={() => setEditorTile({ mode: 'edit', tile: t })}
                    onDelete={() => setConfirmDelete(t)} />
                ))}
                {/* Inline add row. */}
                <AddTileRow onSaved={onSaved} />
                {tiles.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500"
                      data-testid="org-quick-links-manager-empty">
                      No tiles yet. Use the row below to add your first bookmark.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer hint — yellow-lit. Copy adjusted: no `office.launch_*`
            permission exists in this codebase (verified via grep) so
            that clause from the reference image is dropped, per
            Stephen's "adjust if it doesn't exist" directive. */}
        <div className="bg-amber-50 border-t border-amber-200 px-6 py-3 text-xs text-amber-900"
          data-testid="apps-directory-hint-bar">
          <span className="mr-1">💡</span>
          Edits land instantly on every staff member's Quick Links page. The
          {' '}<span className="font-semibold">ON</span>/<span className="font-semibold">OFF</span> pill hides a tile without deleting it — flip it back to make it visible again.
        </div>
      </div>

      {editorTile && (
        <TileEditor
          mode={editorTile.mode}
          tile={editorTile.tile}
          onCancel={() => setEditorTile(null)}
          onSaved={onSaved}
        />
      )}

      {confirmDelete && (
        <ConfirmDelete
          tile={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => onDelete(confirmDelete)}
        />
      )}
    </div>
  );
}

function Th({ children, className = '' }) {
  return (
    <th className={`px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-600 whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

function TileRow({ tile, zebra, usersById, onToggle, onEdit, onDelete }) {
  const [imgError, setImgError] = useState(false);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const showRemote = tile.remote_icon_url && !imgError;
  const allowed = Array.isArray(tile.allowed_user_ids) ? tile.allowed_user_ids : [];
  const restricted = allowed.length > 0;
  // v58.13.132fa — Resolve display names from the manager-scope
  // eligible-users cache. Falls back to the raw ID (truncated) if
  // the fetch hasn't landed yet — better than blocking the row.
  const approvedUsers = restricted ? allowed.map((uid) => {
    const u = usersById?.[uid];
    return {
      id: uid,
      name: (u?.name || u?.email || uid.slice(0, 8)).trim(),
      is_admin: !!u?.is_admin,
    };
  }).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const chipCap = 6;
  const visibleChips = chipsExpanded ? approvedUsers : approvedUsers.slice(0, chipCap);
  const overflow = Math.max(0, approvedUsers.length - chipCap);
  return (
    <>
    <tr data-testid={`apps-directory-row-${tile.id}`}
        data-enabled={tile.enabled ? 'true' : 'false'}
        className={
          'border-t border-slate-100 ' +
          (zebra ? 'bg-slate-50 ' : 'bg-white ') +
          (tile.enabled ? '' : 'opacity-60 ')
        }>
      <td className="px-3 py-2">
        <OnPill enabled={tile.enabled} onToggle={onToggle}
          testid={`apps-directory-on-pill-${tile.id}`} />
      </td>
      <td className="px-3 py-2">
        {showRemote ? (
          <img src={tile.remote_icon_url} alt=""
            onError={() => setImgError(true)}
            className="w-7 h-7 object-contain rounded" />
        ) : (
          <div className="text-2xl leading-none" aria-hidden="true">{tile.icon || '🔗'}</div>
        )}
      </td>
      <td className="px-3 py-2 text-sm font-semibold text-slate-800">
        <div className="inline-flex items-center gap-1.5">
          {tile.label}
          {restricted && (
            <span
              data-testid={`apps-directory-row-restricted-${tile.id}`}
              title={`Approved · ${allowed.length} user${allowed.length === 1 ? '' : 's'}`}
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 uppercase tracking-wider">
              <Lock size={10} /> Approved · {allowed.length} user{allowed.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <a href={tile.url} target="_blank" rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline break-all">
          {tile.url}
        </a>
      </td>
      <td className="px-3 py-2 text-xs text-slate-600 max-w-xs truncate" title={tile.description}>
        {tile.description || '—'}
      </td>
      <td className="px-3 py-2">
        <ColorSwatch hex={tile.color || DEFAULT_COLOR} />
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button type="button" onClick={onEdit}
          data-testid={`apps-directory-edit-${tile.id}`}
          title="Edit"
          className="p-1.5 rounded hover:bg-slate-200 text-slate-600">
          <Pencil size={14} />
        </button>
        <button type="button" onClick={onDelete}
          data-testid={`apps-directory-delete-${tile.id}`}
          title="Delete"
          className="p-1.5 rounded hover:bg-red-50 text-red-600 ml-1">
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
    {restricted && (
      <tr data-testid={`apps-directory-row-approved-users-${tile.id}`}
          className={(zebra ? 'bg-slate-50 ' : 'bg-white ') + 'border-t border-slate-100/60'}>
        <td colSpan={7} className="px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5 pl-1"
            data-testid={`apps-directory-row-approved-users-list-${tile.id}`}>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mr-1">
              Approved users
            </span>
            {visibleChips.map((u) => (
              <span key={u.id}
                data-testid={`apps-directory-row-approved-chip-${tile.id}-${u.id}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                {u.name}
                {u.is_admin && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-violet-600">admin</span>
                )}
              </span>
            ))}
            {overflow > 0 && !chipsExpanded && (
              <button type="button" onClick={() => setChipsExpanded(true)}
                data-testid={`apps-directory-row-approved-more-${tile.id}`}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 underline">
                +{overflow} more
              </button>
            )}
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

function OnPill({ enabled, onToggle, testid }) {
  return (
    <button type="button" onClick={onToggle}
      data-testid={testid}
      aria-pressed={enabled}
      className={`relative inline-flex items-center h-5 w-9 rounded-full transition ${
        enabled ? 'bg-emerald-500' : 'bg-slate-300'
      }`}>
      <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition ${
        enabled ? 'translate-x-4' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

function ColorSwatch({ hex }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span aria-hidden="true"
        style={{ background: hex }}
        className="inline-block w-4 h-4 rounded border border-slate-200" />
      <code className="text-[10px] text-slate-500 uppercase">{hex}</code>
    </div>
  );
}

function AddTileRow({ onSaved }) {
  const [form, setForm] = useState({
    url: '', label: '', icon: '', description: '',
    color: DEFAULT_COLOR, enabled: true,
    remote_icon_url: '',
  });
  // v58.13.132ew — `colorAuto` tracks whether the accent colour is
  // still being auto-picked from the label hash. Interacting with the
  // colour picker flips this to false and locks the manual choice.
  const [colorAuto, setColorAuto] = useState(true);
  const effectiveColor = colorAuto ? autoColor(form.label) : form.color;
  const [busy, setBusy] = useState(false);
  const [iconState, setIconState] = useState('idle');

  const runIconFetch = async () => {
    const url = form.url.trim();
    if (!url || validateUrl(url)) return;
    setIconState('fetching');
    try {
      const r = await api.post('/org/url-tiles/fetch-icon', { url });
      const { icon_url } = r.data || {};
      if (icon_url) {
        setForm((f) => ({ ...f, remote_icon_url: icon_url }));
        setIconState('detected');
      } else {
        setIconState('not_found');
      }
    } catch { setIconState('error'); }
  };

  const add = async () => {
    const urlErr = validateUrl(form.url);
    if (urlErr) { toast.error(urlErr); return; }
    if (!form.label.trim()) { toast.error('Name is required'); return; }
    setBusy(true);
    try {
      // v58.13.132ew — Send `null` when the swatch is still auto so
      // the backend records the sentinel default; `_out()` hash-picks
      // the display colour on the return path. Manual picks send
      // through as-is.
      await api.post('/org/url-tiles', {
        ...form,
        color: colorAuto ? null : form.color,
        remote_icon_url: form.remote_icon_url || null,
      });
      toast.success(`Added "${form.label.trim()}"`);
      setForm({ url: '', label: '', icon: '', description: '',
                color: DEFAULT_COLOR, enabled: true, remote_icon_url: '' });
      setColorAuto(true);
      setIconState('idle');
      onSaved?.();
    } catch (e) {
      toast.error(apiError(e) || 'Add failed');
    } finally { setBusy(false); }
  };

  return (
    <tr className="border-t-2 border-slate-200 bg-orange-50/40"
        data-testid="apps-directory-add-row">
      <td className="px-3 py-2">
        <OnPill enabled={form.enabled}
          onToggle={() => setForm({ ...form, enabled: !form.enabled })}
          testid="apps-directory-add-on-pill" />
      </td>
      <td className="px-3 py-2">
        <input type="text" maxLength={4} value={form.icon}
          onChange={(e) => setForm({ ...form, icon: e.target.value })}
          placeholder="🚀"
          data-testid="apps-directory-add-icon"
          className="w-12 text-center text-lg px-1 py-1 rounded border border-slate-300" />
      </td>
      <td className="px-3 py-2">
        <input type="text" maxLength={80} value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="App name"
          data-testid="apps-directory-add-name"
          className="text-sm px-2 py-1 rounded border border-slate-300 w-40" />
      </td>
      <td className="px-3 py-2">
        <input type="url" value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          onBlur={runIconFetch}
          placeholder="https://…"
          data-testid="apps-directory-add-url"
          className="text-sm px-2 py-1 rounded border border-slate-300 w-64" />
        {iconState === 'fetching' && (
          <span className="ml-2 text-[10px] text-slate-500">detecting…</span>
        )}
        {iconState === 'detected' && form.remote_icon_url && (
          <img src={form.remote_icon_url} alt=""
            className="inline-block ml-2 w-5 h-5 object-contain align-middle rounded" />
        )}
      </td>
      <td className="px-3 py-2">
        <input type="text" maxLength={280} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Short description"
          data-testid="apps-directory-add-description"
          className="text-sm px-2 py-1 rounded border border-slate-300 w-48" />
      </td>
      <td className="px-3 py-2">
        <div className="inline-flex items-center gap-1.5">
          <input type="color" value={effectiveColor}
            onChange={(e) => { setColorAuto(false); setForm({ ...form, color: e.target.value }); }}
            data-testid="apps-directory-add-color"
            className="w-6 h-6 rounded border border-slate-300 cursor-pointer" />
          <code className="text-[10px] text-slate-500 uppercase"
            data-testid="apps-directory-add-color-hex">{effectiveColor}</code>
          {colorAuto && (
            <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-600"
              data-testid="apps-directory-add-color-auto-tag"
              title="Auto-picked from name. Click the swatch to override.">auto</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <button type="button" onClick={add} disabled={busy}
          data-testid="apps-directory-add-btn"
          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50">
          <Plus size={12} /> {busy ? 'Adding…' : 'Add'}
        </button>
      </td>
    </tr>
  );
}

// ── Edit tile modal — retained from .132ep with `color` + `enabled` ─
function TileEditor({ mode, tile, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({
    url: tile?.url || '',
    label: tile?.label || '',
    icon: tile?.icon || '',
    description: tile?.description || '',
    remote_icon_url: tile?.remote_icon_url || '',
    color: tile?.color || DEFAULT_COLOR,
    enabled: tile?.enabled ?? true,
  }));
  // v58.13.132ey — Per-tile ACL state.
  // `restrict` true → send `allowedUserIds` verbatim; false → send
  // an empty list so the tile becomes public. Initial state derived
  // from whatever the server returned for the tile.
  const initialAllowed = Array.isArray(tile?.allowed_user_ids) ? tile.allowed_user_ids : [];
  const [restrict, setRestrict] = useState(initialAllowed.length > 0);
  const [allowedUserIds, setAllowedUserIds] = useState(initialAllowed);
  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [eligibleError, setEligibleError] = useState(null);
  const [userSearch, setUserSearch] = useState('');
  // v58.13.132ew — Auto-colour mode. On add mode we start in auto.
  // On edit mode we start manual (the server has already told us
  // what colour to render); if the admin clears the swatch to the
  // sentinel default they can re-enter auto by clicking the "auto
  // pick" hint button.
  const [colorAuto, setColorAuto] = useState(() => (mode === 'add'));
  const effectiveColor = colorAuto ? autoColor(form.label) : form.color;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [iconState, setIconState] = useState({
    status: form.remote_icon_url ? 'detected' : 'idle',
    source: null, error: null,
  });
  const iconAbortRef = React.useRef(null);

  // v58.13.132ey — Lazy-load the eligible-users picker feed. Only
  // fires when the admin turns "Restrict access" ON to keep the
  // editor snappy for the (default) public-tile flow.
  useEffect(() => {
    if (!restrict || eligibleUsers.length > 0 || eligibleLoading) return;
    let cancelled = false;
    setEligibleLoading(true);
    setEligibleError(null);
    api.get('/org/url-tiles/eligible-users')
      .then((r) => { if (!cancelled) setEligibleUsers(r.data?.users || []); })
      .catch((err) => { if (!cancelled) setEligibleError(apiError(err) || 'Failed to load users'); })
      .finally(() => { if (!cancelled) setEligibleLoading(false); });
    return () => { cancelled = true; };
  }, [restrict, eligibleUsers.length, eligibleLoading]);

  const toggleUser = (userId) => {
    setAllowedUserIds((prev) => (prev.includes(userId)
      ? prev.filter((id) => id !== userId)
      : [...prev, userId]));
  };

  const runIconFetch = React.useCallback(async () => {
    const url = form.url.trim();
    if (!url || validateUrl(url)) {
      setIconState({ status: 'idle', source: null, error: null });
      return;
    }
    if (iconAbortRef.current === url) return;
    iconAbortRef.current = url;
    setIconState({ status: 'fetching', source: null, error: null });
    try {
      const r = await api.post('/org/url-tiles/fetch-icon', { url });
      const { icon_url, source } = r.data || {};
      if (iconAbortRef.current !== url) return;
      if (icon_url) {
        setForm((f) => ({ ...f, remote_icon_url: icon_url }));
        setIconState({ status: 'detected', source, error: null });
      } else {
        setIconState({ status: 'not_found', source: null, error: null });
      }
    } catch (err) {
      if (iconAbortRef.current !== url) return;
      setIconState({ status: 'error', source: null,
        error: apiError(err) || 'Icon lookup failed' });
    }
  }, [form.url]);

  const clearIcon = () => {
    iconAbortRef.current = null;
    setForm((f) => ({ ...f, remote_icon_url: '' }));
    setIconState({ status: 'idle', source: null, error: null });
  };

  const save = async (e) => {
    e?.preventDefault?.();
    const urlErr = validateUrl(form.url);
    if (urlErr) { setError(urlErr); return; }
    if (!form.label.trim()) { setError('Label is required'); return; }
    setBusy(true);
    setError(null);
    try {
      // v58.13.132ew — Auto-mode sends `null` for `color`; server
      // records the sentinel default and `_out()` hash-picks on read.
      // v58.13.132ey — ACL toggle OFF → send `[]` (public). ON → send
      // whatever's ticked. Server intersects against active users so
      // stale IDs are silently dropped.
      const payload = { ...form,
        color: colorAuto ? null : form.color,
        remote_icon_url: form.remote_icon_url ? form.remote_icon_url : null,
        allowed_user_ids: restrict ? allowedUserIds : [] };
      if (mode === 'add') {
        await api.post('/org/url-tiles', payload);
        toast.success(`Added "${form.label.trim()}"`);
      } else {
        await api.patch(`/org/url-tiles/${tile.id}`, payload);
        toast.success(`Updated "${form.label.trim()}"`);
      }
      onSaved?.();
    } catch (err) {
      setError(apiError(err) || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4"
      data-testid={`org-quick-links-editor-${mode}`}>
      <form onSubmit={save} className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <h4 className="font-display font-semibold text-lg text-slate-800 mb-4">
          {mode === 'add' ? 'Add tile' : 'Edit tile'}
        </h4>
        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">URL <span className="text-red-500">*</span></span>
            <input type="url" required value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              onBlur={runIconFetch}
              placeholder="https://…"
              data-testid="org-quick-links-editor-url"
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </label>
          <div data-testid="org-quick-links-editor-icon-preview">
            {iconState.status === 'fetching' && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-orange-500 rounded-full animate-spin" />
                Detecting icon…
              </div>
            )}
            {iconState.status === 'detected' && form.remote_icon_url && (
              <div className="flex items-center gap-2 text-xs text-slate-700 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <img src={form.remote_icon_url} alt="Detected icon"
                  onError={() => setIconState((s) => ({ ...s, status: 'error',
                    error: 'Icon URL did not load' }))}
                  data-testid="org-quick-links-editor-icon-thumb"
                  className="w-8 h-8 object-contain rounded bg-white border border-slate-200" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-emerald-800">Icon detected</div>
                  <div className="text-[10px] text-slate-500 truncate" title={form.remote_icon_url}>
                    {iconState.source ? `via ${iconState.source} · ` : ''}
                    {form.remote_icon_url}
                  </div>
                </div>
                <button type="button" onClick={clearIcon}
                  data-testid="org-quick-links-editor-icon-clear"
                  className="text-[11px] font-semibold text-slate-500 hover:text-red-600">
                  Use emoji
                </button>
              </div>
            )}
            {iconState.status === 'not_found' && (
              <div className="text-xs text-slate-500">
                No branded icon found. Emoji fallback will be used.
              </div>
            )}
            {iconState.status === 'error' && iconState.error && (
              <div className="text-xs text-amber-700">{iconState.error}</div>
            )}
          </div>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">Label <span className="text-red-500">*</span></span>
            <input type="text" required maxLength={80} value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Westpac Banking"
              data-testid="org-quick-links-editor-label"
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">Icon / emoji (fallback)</span>
            <input type="text" maxLength={8} value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              placeholder="🏦"
              data-testid="org-quick-links-editor-icon"
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">Icon URL override (optional)</span>
            <input type="url" value={form.remote_icon_url}
              onChange={(e) => {
                setForm({ ...form, remote_icon_url: e.target.value });
                setIconState({ status: e.target.value ? 'detected' : 'idle',
                                source: 'manual', error: null });
              }}
              placeholder="Paste an image URL to override the auto-detected icon"
              data-testid="org-quick-links-editor-remote-icon-url"
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">Description</span>
            <textarea rows={2} maxLength={280} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Shown as tooltip on hover"
              data-testid="org-quick-links-editor-description"
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </label>
          {mode === 'edit' && tile?.id && (
            <CredentialSubEditor tileId={tile.id} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">Accent color</span>
              <div className="flex items-center gap-2">
                <input type="color" value={effectiveColor}
                  onChange={(e) => { setColorAuto(false); setForm({ ...form, color: e.target.value }); }}
                  data-testid="org-quick-links-editor-color"
                  className="w-10 h-9 rounded border border-slate-300 cursor-pointer" />
                <code className="text-xs text-slate-500 uppercase"
                  data-testid="org-quick-links-editor-color-hex">{effectiveColor}</code>
                {colorAuto ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600"
                    data-testid="org-quick-links-editor-color-auto-tag"
                    title="Auto-picked from name. Click the swatch to override.">auto</span>
                ) : (
                  <button type="button"
                    onClick={() => setColorAuto(true)}
                    data-testid="org-quick-links-editor-color-auto-reset"
                    className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-emerald-600 underline"
                    title="Restore auto-picked colour from the name">reset auto</button>
                )}
              </div>
            </label>
            <label className="flex items-center gap-2 mt-6">
              <input type="checkbox" checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                data-testid="org-quick-links-editor-enabled"
                className="rounded border-slate-300" />
              <span className="text-xs font-semibold text-slate-700">Visible on Quick Links page</span>
            </label>
          </div>
          {/* v58.13.132ey — Per-tile ACL section. v58.13.132fa —
              Positive-framing rewrite: "Restrict" → "Approve".
              Toggle ON means "only ticked users can see this tile";
              OFF means public. Strict admin rule preserved — admins
              are NOT bypassed and must tick themselves. */}
          <div className="pt-3 mt-2 border-t border-slate-200"
            data-testid="org-quick-links-editor-access-section">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={restrict}
                onChange={(e) => {
                  setRestrict(e.target.checked);
                  if (!e.target.checked) setAllowedUserIds([]);
                }}
                data-testid="org-quick-links-editor-restrict-toggle"
                className="mt-0.5 rounded border-slate-300" />
              <span className="text-xs font-semibold text-slate-700">
                Approved users only
                <span className="block font-normal text-slate-500 mt-0.5">
                  When ON, only the users you tick below can see this tile. When OFF, everyone sees it (public).
                </span>
              </span>
            </label>
            {restrict && (
              <div className="mt-3 space-y-2"
                data-testid="org-quick-links-editor-access-picker">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-700"
                    data-testid="org-quick-links-editor-approved-users-heading">
                    Approved users
                  </div>
                  <div className="text-[11px] text-slate-500"
                    data-testid="org-quick-links-editor-selected-count">
                    {allowedUserIds.length} approved
                  </div>
                </div>
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5"
                  data-testid="org-quick-links-editor-restrict-hint">
                  Tick everyone who should have access. Include yourself if you want to see the tile.
                </p>
                <input type="search"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search users by name or email…"
                  data-testid="org-quick-links-editor-user-search"
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-400" />
                {eligibleLoading && (
                  <div className="text-xs text-slate-500"
                    data-testid="org-quick-links-editor-users-loading">
                    Loading users…
                  </div>
                )}
                {eligibleError && (
                  <div className="text-xs text-red-600"
                    data-testid="org-quick-links-editor-users-error">
                    {eligibleError}
                  </div>
                )}
                {!eligibleLoading && !eligibleError && (
                  <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100"
                    data-testid="org-quick-links-editor-user-list">
                    {(() => {
                      const q = userSearch.trim().toLowerCase();
                      const filtered = q
                        ? eligibleUsers.filter((u) => (
                            (u.name || '').toLowerCase().includes(q) ||
                            (u.email || '').toLowerCase().includes(q)))
                        : eligibleUsers;
                      if (filtered.length === 0) {
                        return (
                          <div className="text-xs text-slate-500 px-3 py-2"
                            data-testid="org-quick-links-editor-user-empty">
                            {eligibleUsers.length === 0
                              ? 'No users to choose from.'
                              : 'No users match that search.'}
                          </div>
                        );
                      }
                      return filtered.map((u) => {
                        const checked = allowedUserIds.includes(u.id);
                        return (
                          <label key={u.id}
                            data-testid={`org-quick-links-editor-user-row-${u.id}`}
                            data-checked={checked ? 'true' : 'false'}
                            className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ${checked ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                            <input type="checkbox"
                              checked={checked}
                              onChange={() => toggleUser(u.id)}
                              data-testid={`org-quick-links-editor-user-checkbox-${u.id}`}
                              className="rounded border-slate-300" />
                            <span className="flex-1 truncate">
                              <span className="font-semibold text-slate-800">{u.name || u.email}</span>
                              {u.email && u.email !== u.name && (
                                <span className="text-slate-500 ml-1">· {u.email}</span>
                              )}
                            </span>
                            {u.is_admin && (
                              <span className="text-[9px] font-semibold uppercase tracking-wider text-violet-600">admin</span>
                            )}
                          </label>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {error && (
          <div className="mt-3 text-xs text-red-600" data-testid="org-quick-links-editor-error">{error}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            data-testid="org-quick-links-editor-cancel"
            className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            data-testid="org-quick-links-editor-save"
            className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDelete({ tile, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4"
      data-testid="org-quick-links-delete-confirm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
        <h4 className="font-display font-semibold text-lg text-slate-800 mb-2">Delete tile?</h4>
        <p className="text-sm text-slate-600 mb-4">
          Delete tile <span className="font-semibold">"{tile.label}"</span>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            data-testid="org-quick-links-delete-cancel"
            className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            data-testid="org-quick-links-delete-confirm-btn"
            className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// v58.13.132ev — Per-admin credential editor for a specific tile.
// Renders inline inside the TileEditor when editing an existing tile.
// Stores encrypted at rest on the backend; only the current admin
// can read/write their own credentials for the tile.
function CredentialSubEditor({ tileId }) {
  const [meta, setMeta] = React.useState(null);
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [qaPairs, setQaPairs] = React.useState([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await api.get(`/tile-credentials/${tileId}`);
        setMeta(r.data);
        setUsername(r.data.username || '');
        setQaPairs((r.data.qa_pairs || []).map((qa) =>
          ({ label: qa.label, answer: '' })));
      } catch { /* noop */ }
    })();
  }, [tileId]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { username, qa_pairs: qaPairs.filter((qa) => qa.label.trim()) };
      if (password) payload.password = password;
      await api.put(`/tile-credentials/${tileId}`, payload);
      toast.success('Credentials saved');
      setPassword('');
    } catch (e) {
      toast.error(apiError(e) || 'Save failed');
    } finally { setBusy(false); }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      await api.delete(`/tile-credentials/${tileId}`);
      setMeta({ has_password: false, username: null, password_preview: '', qa_pairs: [] });
      setUsername(''); setPassword(''); setQaPairs([]);
      toast.success('Credentials cleared');
    } catch (e) {
      toast.error(apiError(e) || 'Clear failed');
    } finally { setBusy(false); }
  };

  const addQa = () => {
    if (qaPairs.length >= 6) return;
    setQaPairs([...qaPairs, { label: '', answer: '' }]);
  };

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
         data-testid="credential-sub-editor">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
        Your credentials for this tile
      </div>
      <p className="text-[10px] text-slate-500 mb-2">
        Encrypted at rest. Only you can see these. Password preview: <code className="text-slate-700">{meta?.password_preview || '—'}</code>
      </p>
      <label className="block mb-2">
        <span className="text-[10px] font-semibold text-slate-600">Username</span>
        <input type="text" value={username}
          onChange={(e) => setUsername(e.target.value)}
          data-testid="credential-editor-username"
          className="w-full text-sm px-2 py-1.5 rounded border border-slate-300" />
      </label>
      <label className="block mb-2">
        <span className="text-[10px] font-semibold text-slate-600">Password (leave blank to keep existing)</span>
        <div className="flex gap-1">
          <input type={showPassword ? 'text' : 'password'} value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="credential-editor-password"
            placeholder={meta?.has_password ? '(unchanged)' : ''}
            className="flex-1 text-sm px-2 py-1.5 rounded border border-slate-300" />
          <button type="button" onClick={() => setShowPassword(!showPassword)}
            className="text-[10px] font-semibold px-2 rounded border border-slate-300 bg-white">
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>
      <div className="mb-2">
        <div className="text-[10px] font-semibold text-slate-600 mb-1">Q&amp;A pairs (up to 6)</div>
        {qaPairs.map((qa, idx) => (
          <div key={idx} className="flex gap-1 mb-1">
            <input type="text" placeholder="Question label" value={qa.label}
              onChange={(e) => {
                const next = [...qaPairs]; next[idx] = { ...qa, label: e.target.value }; setQaPairs(next);
              }}
              data-testid={`credential-editor-qa-label-${idx}`}
              className="flex-1 text-xs px-2 py-1 rounded border border-slate-300" />
            <input type="text" placeholder="Answer" value={qa.answer}
              onChange={(e) => {
                const next = [...qaPairs]; next[idx] = { ...qa, answer: e.target.value }; setQaPairs(next);
              }}
              data-testid={`credential-editor-qa-answer-${idx}`}
              className="flex-1 text-xs px-2 py-1 rounded border border-slate-300" />
            <button type="button" onClick={() => setQaPairs(qaPairs.filter((_, i) => i !== idx))}
              className="text-xs text-red-600 px-1">✕</button>
          </div>
        ))}
        {qaPairs.length < 6 && (
          <button type="button" onClick={addQa}
            data-testid="credential-editor-add-qa"
            className="text-[10px] font-semibold text-orange-600 hover:underline">+ Add Q&amp;A</button>
        )}
      </div>
      <div className="flex justify-end gap-1">
        <button type="button" onClick={clearAll} disabled={busy}
          data-testid="credential-editor-clear"
          className="text-[10px] font-semibold px-2 py-1 rounded bg-slate-200 text-slate-700 hover:bg-slate-300">
          Clear
        </button>
        <button type="button" onClick={save} disabled={busy}
          data-testid="credential-editor-save"
          className="text-[10px] font-semibold px-3 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save credentials'}
        </button>
      </div>
    </div>
  );
}

