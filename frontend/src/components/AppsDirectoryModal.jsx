import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { X, Rocket } from 'lucide-react';
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
} from './apps-directory/TileCard';

/**
 * v58.13.132es — <AppsDirectoryModal /> — in-app launcher modal
 * version of the Apps Directory hub. Toggled by the global
 * `paneltec:open-apps-directory` CustomEvent.
 *
 * v58.13.132g3 — Aligned with the shared `TileCard` primitives so
 * this modal picks up 3-dots menu · session-hide · drag-to-reorder
 * · per-tile PIN gate · credential auto-launch that the .132g1 ship
 * already put on the standalone `/apps-directory` page.
 * `.132g1` missed this component; screenshot from Stephen showed 10
 * plain "LAUNCH X" tiles with none of the new affordances.
 */

export default function AppsDirectoryModal({ open, onClose }) {
  const user = getUser();
  const isAdmin = (user?.role || '').toLowerCase() === 'admin';
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const { hidden, hideTile, resetHidden } = useHiddenTiles(user?.id);
  // v58.13.132g6 — probe `/auth/admin-console/status` once so we
  // know whether to render the 3-dots at all. Non-admins receive
  // 403 and the flag stays false.
  const [hasAdminPin, setHasAdminPin] = useState(false);

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

  const visible = useMemo(
    () => tiles.filter((t) => !hidden.has(t.id)),
    [tiles, hidden],
  );

  // v58.13.132g4 — Sensor tuning. `.132g3` used
  // `PointerSensor { distance: 6 }` which was too high for
  // MacBook trackpad — Stephen was triggering clicks before the
  // drag activated. Lower the threshold to 3px and add
  // `TouchSensor` (with a short delay to disambiguate from taps)
  // so iPad admins can reorder too.
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
          {isAdmin && tiles.length > 1 && (
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400"
              data-testid="apps-directory-modal-admin-hint">
              Drag any tile to reorder
            </div>
          )}
          <button type="button" onClick={() => onCloseRef.current?.()}
            data-testid="apps-directory-modal-close"
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
            <X size={22} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {loading ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500"
                 data-testid="apps-directory-modal-empty">
              {tiles.length === 0
                ? 'No tiles yet — Admin can add them in Settings → Organisation → Apps Directory · Tile management.'
                : 'All tiles hidden this session. Close and reopen the launcher, or log out, to bring them back.'}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={visible.map((t) => t.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
                  data-testid="apps-directory-modal-grid">
                  {visible.map((t) => (
                    <SortableTileCard
                      key={t.id}
                      tile={t}
                      isAdmin={isAdmin}
                      hasAdminPin={hasAdminPin}
                      onHide={hideTile}
                      testIdPrefix="apps-directory-modal-tile"
                      credentialLaunch
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {hidden.size > 0 && (
          <footer className="border-t border-slate-200 bg-white px-8 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500"
            data-testid="apps-directory-modal-footer">
            <span data-testid="apps-directory-modal-hidden-count">{hidden.size}</span>{' '}tiles hidden this session ·{' '}
            <button type="button"
              onClick={resetHidden}
              data-testid="apps-directory-modal-show-all"
              className="text-emerald-600 hover:underline">
              Show them again
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
