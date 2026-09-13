import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ExternalLink, Bookmark, Pencil } from 'lucide-react';
import api, { apiError } from '../lib/api';
import { PageHeader } from '../components/capture/Ui';
import { useCan } from '../lib/permissions';

/**
 * v58.13.132eq — Read-only Quick Links page (route: /app/quick-links).
 *
 * Renders the org's URL tiles as a clickable grid. Visible to ALL
 * authenticated users (backend `GET /org/url-tiles` opened up in the
 * same ship). Admins get a "Manage tiles →" affordance that deep-
 * links to Settings → Organisation, where the CRUD popup lives.
 * Everyone else sees the grid only.
 */
export default function QuickLinks() {
  const can = useCan();
  const isAdmin = can('users', 'edit'); // matches OrgSettings' admin check
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api.get('/org/url-tiles');
        if (!cancelled) setTiles(r.data.tiles || []);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e) || 'Failed to load Quick Links');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-5xl mx-auto" data-testid="quick-links-page">
      <PageHeader
        crumb="Quick Links"
        title="Quick Links"
        subtitle="Shared organisation bookmarks — banking, integrations, supplier logins, and anything else your team hits daily."
        action={isAdmin ? (
          <Link
            to="/app/settings/org"
            data-testid="quick-links-manage-link"
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            <Pencil size={14} /> Manage tiles →
          </Link>
        ) : null}
      />

      {loading ? (
        <div className="text-sm text-slate-500" data-testid="quick-links-loading">Loading…</div>
      ) : tiles.length === 0 ? (
        <EmptyState isAdmin={isAdmin} />
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          data-testid="quick-links-grid"
        >
          {tiles.map((t) => <TileCard key={t.id} tile={t} />)}
        </div>
      )}
    </div>
  );
}

function TileCard({ tile }) {
  const [imgError, setImgError] = useState(false);
  const showRemote = tile.remote_icon_url && !imgError;
  // v58.13.132er — Apps Directory `color` field surfaces as a
  // left-border accent + a soft tint band at the top. Falls back to
  // the Paneltec Apps Directory blue when the record predates .132er.
  const accent = tile.color || '#1d6fb8';
  return (
    <a
      href={tile.url}
      target="_blank"
      rel="noopener noreferrer"
      title={tile.description || tile.url}
      data-testid={`quick-links-tile-${tile.id}`}
      style={{ borderLeftColor: accent, borderLeftWidth: 4 }}
      className="group relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white hover:shadow-md transition p-5 min-h-[150px] overflow-hidden"
    >
      <span aria-hidden="true"
        style={{ background: accent }}
        className="absolute top-0 left-0 right-0 h-1 opacity-70" />
      {showRemote ? (
        <img
          src={tile.remote_icon_url}
          alt=""
          onError={() => setImgError(true)}
          data-testid={`quick-links-tile-img-${tile.id}`}
          className="w-14 h-14 object-contain rounded-lg"
        />
      ) : (
        <div className="text-5xl leading-none" aria-hidden="true">
          {tile.icon || '🔗'}
        </div>
      )}
      <div className="text-sm font-semibold text-slate-800 text-center line-clamp-2">
        {tile.label}
      </div>
      <ExternalLink
        size={12}
        className="absolute top-3 right-3 text-slate-300 group-hover:text-orange-500"
      />
    </a>
  );
}

function EmptyState({ isAdmin }) {
  return (
    <div
      className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
      data-testid="quick-links-empty"
    >
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-orange-50 flex items-center justify-center">
        <Bookmark size={22} className="text-orange-500" />
      </div>
      <h3 className="text-base font-semibold text-slate-800 mb-1">No Quick Links yet</h3>
      <p className="text-sm text-slate-500">
        {isAdmin ? (
          <>
            Head to{' '}
            <Link
              to="/app/settings/org"
              data-testid="quick-links-empty-manage-link"
              className="text-orange-600 hover:underline font-semibold"
            >
              Settings → Organisation → Quick Links
            </Link>{' '}
            to add your first bookmark.
          </>
        ) : (
          <>Admin can add them in Settings → Organisation → Quick Links.</>
        )}
      </p>
    </div>
  );
}
