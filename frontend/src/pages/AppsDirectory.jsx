import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Settings, X, Rocket } from 'lucide-react';
import api, { apiError } from '../lib/api';

/**
 * v58.13.132es — Standalone "Paneltec Group · Apps Directory" hub.
 *
 * Rendered on the public `/apps-directory` route (outside AppShell)
 * so it can be popped in a dedicated browser window via
 * `window.open` from the sidebar entry. Uses the SAME
 * `GET /org/url-tiles` endpoint the `.132eq` Quick Links page
 * consumes, so tiles + enabled/color/remote_icon_url all flow
 * through unchanged. Read-only for this ship — credentials-management
 * lands in a follow-up (`.132et`).
 */

const DEFAULT_COLOR = '#1d6fb8';

export default function AppsDirectory() {
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locallyHidden, setLocallyHidden] = useState(() => {
    try {
      const raw = localStorage.getItem('apps_directory_hidden');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });

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

  const persistHidden = (next) => {
    setLocallyHidden(next);
    try {
      localStorage.setItem('apps_directory_hidden',
        JSON.stringify(Array.from(next)));
    } catch { /* noop */ }
  };
  const hide = (id) => {
    const n = new Set(locallyHidden); n.add(id); persistHidden(n);
  };
  const showAll = () => persistHidden(new Set());

  const visible = tiles.filter((t) => !locallyHidden.has(t.id));
  const hiddenCount = tiles.length - visible.length;

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
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-8">
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500"
               data-testid="apps-directory-hub-empty">
            No apps configured yet. An admin can add them in Settings → Organisation → Quick Links.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
            data-testid="apps-directory-hub-grid">
            {visible.map((t) => (
              <HubTile key={t.id} tile={t} onHide={() => hide(t.id)} />
            ))}
          </div>
        )}
      </main>

      {tiles.length > 0 && (
        <footer className="border-t border-slate-200 bg-white px-8 py-4 text-center text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500"
          data-testid="apps-directory-hub-footer">
          <span data-testid="apps-directory-hidden-count">{hiddenCount}</span>{' '}apps hidden from your hub ·{' '}
          {hiddenCount > 0 ? (
            <button type="button" onClick={showAll}
              data-testid="apps-directory-show-manage"
              className="text-emerald-600 hover:underline">
              Show &amp; manage
            </button>
          ) : (
            <span className="text-slate-400">Show &amp; manage</span>
          )}
        </footer>
      )}
    </div>
  );
}

function HubTile({ tile, onHide }) {
  const [imgError, setImgError] = useState(false);
  const showRemote = tile.remote_icon_url && !imgError;
  const accent = tile.color || DEFAULT_COLOR;
  return (
    <div className="relative rounded-2xl bg-white border border-slate-200 hover:shadow-lg transition p-5 flex flex-col gap-3"
      style={{ borderTopColor: accent, borderTopWidth: 4 }}
      data-testid={`apps-directory-hub-tile-${tile.id}`}>
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button type="button"
          onClick={() => window.open('/app/settings/org', '_blank',
                                      'noopener,noreferrer')}
          data-testid={`apps-directory-hub-tile-settings-${tile.id}`}
          title="Manage in Org Settings"
          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600">
          <Settings size={12} />
        </button>
        <button type="button" onClick={onHide}
          data-testid={`apps-directory-hub-tile-hide-${tile.id}`}
          title="Hide from my hub"
          className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
          <X size={12} />
        </button>
      </div>
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
          <div className="text-xs text-slate-500 truncate" title={tile.url}>{tile.url}</div>
        </div>
      </div>
      {tile.description && (
        <p className="text-xs text-slate-600 line-clamp-2">{tile.description}</p>
      )}
      <a href={tile.url} target="_blank" rel="noopener noreferrer"
        style={{ color: accent }}
        data-testid={`apps-directory-hub-tile-launch-${tile.id}`}
        className="mt-auto inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider hover:underline">
        Launch {tile.label} <ExternalLink size={12} />
      </a>
    </div>
  );
}
