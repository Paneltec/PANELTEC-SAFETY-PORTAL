import React, { useEffect, useState, useMemo } from 'react';
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
  SortableTileCard, useHiddenTiles,
} from '../components/apps-directory/TileCard';

/**
 * v58.13.132es — Standalone "Paneltec Group · Apps Directory" hub.
 *
 * Renders on the public `/apps-directory` route. Uses the shared
 * `TileCard` primitives so the 3-dots menu / drag-to-reorder / PIN
 * gate stay lock-step with `AppsDirectoryModal.jsx`
 * (v58.13.132g3).
 */

export default function AppsDirectory() {
  const user = getUser();
  const isAdmin = (user?.role || '').toLowerCase() === 'admin';
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const { hidden, hideTile, resetHidden } = useHiddenTiles(user?.id);

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
    () => tiles.filter((t) => !hidden.has(t.id)),
    [tiles, hidden],
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
                  <SortableTileCard
                    key={t.id}
                    tile={t}
                    isAdmin={isAdmin}
                    onHide={hideTile}
                    testIdPrefix="apps-directory-hub-tile"
                    showAdminSettingsIcon
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
            onClick={resetHidden}
            data-testid="apps-directory-show-all"
            className="text-emerald-600 hover:underline">
            Show them again
          </button>
        </footer>
      )}
    </div>
  );
}
