import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Rocket } from 'lucide-react';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import {
  DndContext, PointerSensor, KeyboardSensor, TouchSensor,
  useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy,
  sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable';
import {
  SortableTileCard, TilePinModal,
} from '../components/apps-directory/TileCard';

/**
 * v58.13.132es — Standalone "Paneltec Group · Apps Directory" hub.
 *
 * Renders on the public `/apps-directory` route. Uses the shared
 * `TileCard` primitives so the 3-dots menu / drag-to-reorder / PIN
 * gate stay lock-step with `AppsDirectoryModal.jsx`
 * (v58.13.132g3).
 *
 * v58.13.132g9 — Hide is now an ORG-WIDE server field
 * (`org_url_tiles.hidden`) instead of per-user sessionStorage.
 * "Show hidden" toggle is PIN-gated; per-tile "Restore" is inside
 * the 3-dots menu which is already PIN-gated by .132g6.
 */

export default function AppsDirectory() {
  const user = getUser();
  const isAdmin = (user?.role || '').toLowerCase() === 'admin';
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasAdminPin, setHasAdminPin] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [restorePinOpen, setRestorePinOpen] = useState(false);

  const loadTiles = useCallback(async (includeHidden) => {
    try {
      const params = includeHidden ? { include_hidden: 'true' } : {};
      const r = await api.get('/org/url-tiles', { params });
      setTiles(r.data.tiles || []);
    } catch (e) {
      toast.error(apiError(e) || 'Failed to load tiles');
    }
  }, []);

  const hideTile = async (id) => {
    // The 3-dots menu that hosts this action is already PIN-gated
    // by .132g6 — reaching here means the PIN was verified.
    try {
      await api.patch(`/org/url-tiles/${id}`, { hidden: true });
      toast.success('Tile hidden org-wide');
      await loadTiles(showHidden);
    } catch (e) { toast.error(apiError(e) || 'Hide failed'); }
  };

  const restoreTile = async (id) => {
    try {
      await api.patch(`/org/url-tiles/${id}`, { hidden: false });
      toast.success('Tile restored');
      await loadTiles(showHidden);
    } catch (e) { toast.error(apiError(e) || 'Restore failed'); }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.post('/auth/admin-console/status');
        if (!cancelled) setHasAdminPin(!!r.data?.has_pin);
      } catch { /* non-admin or no PIN — keep flag false */ }
    })();
    return () => { cancelled = true; };
  }, []);

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

  const visible = useMemo(
    () => (showHidden ? tiles : tiles.filter((t) => !t.hidden)),
    [tiles, showHidden],
  );
  const hiddenCount = useMemo(
    () => tiles.filter((t) => t.hidden).length,
    [tiles],
  );

  // v58.13.132g4 — Sensor tuning (matches AppsDirectoryModal).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async (evt) => {
    if (!isAdmin) return;
    const { active, over } = evt;
    if (!over || active.id === over.id) return;
    const fromIdx = tiles.findIndex((t) => t.id === active.id);
    const toIdx = tiles.findIndex((t) => t.id === over.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const nextTiles = arrayMove(tiles, fromIdx, toIdx);
    setTiles(nextTiles);
    try {
      await api.patch('/org/url-tiles/reorder', {
        tile_ids: nextTiles.map((t) => t.id),
      });
      toast.success('Order saved');
    } catch (e) {
      toast.error(apiError(e) || 'Reorder failed — reloading');
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
              : 'All tiles are hidden org-wide. Admins with a PIN can restore them from Show hidden tiles.'}
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
                  <SortableTileCard
                    key={t.id}
                    tile={t}
                    isAdmin={isAdmin}
                    hasAdminPin={hasAdminPin}
                    onHide={hideTile}
                    onRestore={restoreTile}
                    testIdPrefix="apps-directory-hub-tile"
                    showAdminSettingsIcon
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>

      {isAdmin && hasAdminPin && (
        <footer className="border-t border-slate-200 bg-white px-8 py-4 text-center text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500"
          data-testid="apps-directory-hub-footer">
          {showHidden ? (
            <>
              <span data-testid="apps-directory-hidden-count">{hiddenCount}</span>{' '}tiles hidden org-wide · Showing all ·{' '}
              <button type="button"
                onClick={() => { setShowHidden(false); loadTiles(false); }}
                data-testid="apps-directory-hide-again"
                className="text-emerald-600 hover:underline">
                Back to visible only
              </button>
            </>
          ) : (
            <>
              <button type="button"
                onClick={() => {
                  // v58.13.132g9 — PIN-gate the reveal. Restore of
                  // individual tiles happens via each tile's 3-dots
                  // menu (already PIN-gated by .132g6).
                  if (tiles.length && hasAdminPin) {
                    setRestorePinOpen(true);
                  } else {
                    setShowHidden(true);
                    loadTiles(true);
                  }
                }}
                data-testid="apps-directory-show-all"
                className="text-emerald-600 hover:underline">
                Show hidden tiles
              </button>
            </>
          )}
        </footer>
      )}

      {restorePinOpen && tiles.length > 0 && (
        <TilePinModal
          tile={{ id: tiles[0].id, label: 'Show hidden tiles' }}
          onClose={() => setRestorePinOpen(false)}
          onUnlocked={() => {
            setRestorePinOpen(false);
            setShowHidden(true);
            loadTiles(true);
          }}
        />
      )}
    </div>
  );
}
