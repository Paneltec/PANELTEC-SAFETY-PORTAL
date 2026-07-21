// v160.3.8.1 — Draggable Settings sub-nav.
//
// Replaces the old flat "Settings" section in `AppShell.jsx`. Layout is
// persisted per-org in Mongo (`settings_nav_layout`) and read/written
// via `/api/settings/nav-layout`. Admins get drag handles, "+ New
// folder", inline rename (double-click), and per-folder delete;
// non-admins see the same layout as read-only nav.
//
// Powered by @dnd-kit for accessibility (arrow keys move focused item,
// space activates the drag). Two SortableContext scopes: root and one
// per folder — dragging BETWEEN scopes uses `onDragOver` to move the
// item into the destination scope.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { toast } from 'sonner';
import {
  DndContext, PointerSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy,
  sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown20Regular, ChevronRight20Regular,
  ReOrderDotsVertical20Regular, Add20Regular,
  Delete20Regular, FolderAdd20Regular,
} from '@fluentui/react-icons';

import api, { apiError } from '../../lib/api';
import useLockBodyScroll from '../../lib/useLockBodyScroll';
import { useCan } from '../../lib/permissions';
import {
  SETTINGS_NAV_BY_KEY, defaultSettingsLayout,
} from '../../lib/settingsNavRegistry';

const COLLAPSE_KEY = 'paneltec_settings_nav_collapsed';

// Load per-user collapsed state; wrap in try/catch for Safari private.
function loadCollapsed() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : { folder_admin: true };
  } catch { return { folder_admin: true }; }
}
function saveCollapsed(state) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state)); } catch { /* noop */ }
}

// Fresh org id — used for a new folder. Timestamp keeps it unique.
function newFolderId() {
  return 'folder_' + Math.random().toString(36).slice(2, 8) + '_' + Date.now().toString(36);
}

// Walk the layout and yield {node, path[]} for each leaf.
function findItem(layout, id) {
  for (let i = 0; i < layout.length; i++) {
    const n = layout[i];
    if (n.type === 'item' && n.key === id) return { path: [i], node: n };
    if (n.type === 'folder') {
      if (n.id === id) return { path: [i], node: n };
      const c = n.children || [];
      for (let j = 0; j < c.length; j++) {
        if (c[j].type === 'item' && c[j].key === id) return { path: [i, j], node: c[j] };
      }
    }
  }
  return null;
}

function removeAtPath(layout, path) {
  const copy = JSON.parse(JSON.stringify(layout));
  if (path.length === 1) {
    const [n] = copy.splice(path[0], 1);
    return { next: copy, node: n };
  }
  const [fi, ci] = path;
  const [n] = copy[fi].children.splice(ci, 1);
  return { next: copy, node: n };
}

function insertAtIndex(layout, targetPath, node) {
  const copy = JSON.parse(JSON.stringify(layout));
  if (targetPath.length === 1) copy.splice(targetPath[0], 0, node);
  else copy[targetPath[0]].children.splice(targetPath[1], 0, node);
  return copy;
}

export default function SettingsNav({ collapsed: navCollapsed, onItemClick, isAdmin }) {
  const can = useCan();
  const [layout, setLayout] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [folderCollapsed, setFolderCollapsed] = useState(loadCollapsed);
  const [activeId, setActiveId] = useState(null);
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [newFolderInput, setNewFolderInput] = useState(null); // { label: '' } when adding
  const [deleteFolder, setDeleteFolder] = useState(null);
  const saveTimer = useRef(null);
  const lastSaved = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Load from server; fall back to default seed on error.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await api.get('/settings/nav-layout');
        if (!live) return;
        setLayout(data.layout || defaultSettingsLayout());
        lastSaved.current = JSON.stringify(data.layout || []);
      } catch {
        if (!live) return;
        setLayout(defaultSettingsLayout());
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => { live = false; };
  }, []);

  const persist = useCallback((nextLayout) => {
    if (!isAdmin) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.put('/settings/nav-layout', { layout: nextLayout });
        lastSaved.current = JSON.stringify(nextLayout);
      } catch (e) {
        toast.error(apiError(e));
        // Revert to last-known-good so the UI doesn't lie.
        try {
          if (lastSaved.current) setLayout(JSON.parse(lastSaved.current));
        } catch { /* noop */ }
      }
    }, 500);
  }, [isAdmin]);

  const toggleFolder = (fid) => {
    const next = { ...folderCollapsed, [fid]: !folderCollapsed[fid] };
    setFolderCollapsed(next);
    saveCollapsed(next);
  };

  const commitLayout = (nextLayout) => {
    setLayout(nextLayout);
    persist(nextLayout);
  };

  const handleDragStart = (evt) => setActiveId(evt.active.id);

  const handleDragEnd = (evt) => {
    setActiveId(null);
    const { active, over } = evt;
    if (!over || active.id === over.id) return;
    const src = findItem(layout, active.id);
    const dst = findItem(layout, over.id);
    if (!src || !dst) return;

    // Both at root & no folder involved → simple arrayMove
    if (src.path.length === 1 && dst.path.length === 1
        && src.node.type === 'item' && dst.node.type === 'item') {
      const from = src.path[0], to = dst.path[0];
      commitLayout(arrayMove(layout, from, to));
      return;
    }

    // If we dropped onto a folder header, put us at the FRONT of its
    // children.
    if (dst.node.type === 'folder' && src.node.type === 'item') {
      const { next: removed } = removeAtPath(layout, src.path);
      const folderIdx = findItem(removed, dst.node.id).path[0];
      const withInsert = JSON.parse(JSON.stringify(removed));
      withInsert[folderIdx].children.unshift(src.node);
      commitLayout(withInsert);
      return;
    }

    // Otherwise: same container reorder OR cross-container move.
    const srcContainer = src.path.length === 1 ? 'root' : layout[src.path[0]].id;
    const dstContainer = dst.path.length === 1 ? 'root' : layout[dst.path[0]].id;
    const { next: removed } = removeAtPath(layout, src.path);
    // Recompute dst path AFTER removal (indices may have shifted).
    const dstAfter = findItem(removed, over.id);
    if (!dstAfter) {
      commitLayout(removed);
      return;
    }
    const insertPath = [...dstAfter.path];
    if (srcContainer === dstContainer && src.path[src.path.length - 1] < dst.path[dst.path.length - 1]) {
      // Same container, moving DOWN → dst index was decremented by removal, so drop AFTER.
      insertPath[insertPath.length - 1] += 1;
    }
    commitLayout(insertAtIndex(removed, insertPath, src.node));
  };

  const handleAddFolder = () => setNewFolderInput({ label: '' });

  const commitNewFolder = () => {
    const label = (newFolderInput?.label || '').trim() || 'New folder';
    const folder = { type: 'folder', id: newFolderId(), label, children: [] };
    commitLayout([...layout, folder]);
    setNewFolderInput(null);
  };

  const startRename = (folder) => {
    if (!isAdmin) return;
    setRenamingFolderId(folder.id);
    setRenameDraft(folder.label);
  };
  const commitRename = () => {
    if (!renamingFolderId) return;
    const label = (renameDraft || '').trim() || 'Folder';
    commitLayout(layout.map((n) =>
      n.type === 'folder' && n.id === renamingFolderId ? { ...n, label } : n,
    ));
    setRenamingFolderId(null);
    setRenameDraft('');
  };

  const doDeleteFolder = (folder) => {
    // Cascade children back to root at the folder's original position.
    const idx = layout.findIndex((n) => n.type === 'folder' && n.id === folder.id);
    if (idx < 0) return;
    const next = JSON.parse(JSON.stringify(layout));
    const children = next[idx].children || [];
    next.splice(idx, 1, ...children);
    commitLayout(next);
    setDeleteFolder(null);
  };

  const visibleAt = (nodes) => nodes.filter((n) => {
    if (n.type !== 'item') return true;
    const reg = SETTINGS_NAV_BY_KEY[n.key];
    if (!reg) return false;
    if (reg.adminOnly && !isAdmin) return false;
    if (reg.resource && !can(reg.resource, 'open')) return false;
    return true;
  });

  const visibleRoot = useMemo(() => visibleAt(layout), [layout, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  const rootIds = visibleRoot.map((n) => n.type === 'item' ? n.key : n.id);

  if (!loaded) {
    return (
      <div className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        Settings
      </div>
    );
  }

  return (
    <div className="mb-5" data-testid="settings-nav">
      {!navCollapsed && (
        <div className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          Settings
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5">
            {visibleRoot.map((n) => (
              n.type === 'item' ? (
                <SortableItem
                  key={n.key} id={n.key} node={n}
                  navCollapsed={navCollapsed} onItemClick={onItemClick}
                  isAdmin={isAdmin} inFolder={false}
                />
              ) : (
                <SortableFolder
                  key={n.id} folder={n}
                  collapsed={!!folderCollapsed[n.id]}
                  onToggle={() => toggleFolder(n.id)}
                  isRenaming={renamingFolderId === n.id}
                  renameDraft={renameDraft}
                  onRenameDraftChange={setRenameDraft}
                  onStartRename={() => startRename(n)}
                  onCommitRename={commitRename}
                  onDelete={() => setDeleteFolder(n)}
                  onItemClick={onItemClick} navCollapsed={navCollapsed}
                  isAdmin={isAdmin}
                  visibleAt={visibleAt}
                />
              )
            ))}
          </ul>
        </SortableContext>
        <DragOverlay>
          {activeId ? <div className="rounded-lg bg-white shadow-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700">Moving…</div> : null}
        </DragOverlay>
      </DndContext>
      {isAdmin && !navCollapsed && (
        <div className="mt-2 px-2">
          {newFolderInput ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newFolderInput.label}
                onChange={(e) => setNewFolderInput({ label: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitNewFolder();
                  if (e.key === 'Escape') setNewFolderInput(null);
                }}
                onBlur={commitNewFolder}
                placeholder="Folder name"
                data-testid="settings-nav-new-folder-input"
                className="flex-1 text-xs px-2 py-1 rounded border border-slate-300 focus:border-blue-500 focus:outline-none"
              />
            </div>
          ) : (
            <button type="button" onClick={handleAddFolder}
              data-testid="settings-nav-new-folder-btn"
              className="w-full flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded px-1.5 py-1"
            >
              <FolderAdd20Regular style={{ width: 14, height: 14 }} />
              New folder
            </button>
          )}
        </div>
      )}
      {deleteFolder && (
        <DeleteFolderModal
          folder={deleteFolder}
          onCancel={() => setDeleteFolder(null)}
          onConfirm={() => doDeleteFolder(deleteFolder)}
        />
      )}
    </div>
  );
}

function SortableItem({ id, node, navCollapsed, onItemClick, isAdmin, inFolder }) {
  const reg = SETTINGS_NAV_BY_KEY[node.key];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !isAdmin });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  if (!reg) return null;
  const IconFilled = reg.iconActive || reg.icon;
  return (
    <li ref={setNodeRef} style={style} className="group relative">
      {isAdmin && !navCollapsed && (
        <button
          type="button"
          className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing p-0.5"
          data-testid={`${reg.testid}-drag-handle`}
          {...attributes} {...listeners}
          title="Drag to reorder"
        >
          <ReOrderDotsVertical20Regular style={{ width: 12, height: 12 }} />
        </button>
      )}
      <NavLink
        to={reg.route}
        onClick={onItemClick}
        data-testid={reg.testid}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-lg py-2 text-sm transition-all ${
            inFolder ? 'pr-2.5 pl-6' : 'pr-2.5 pl-4'
          } ${
            isActive
              ? 'sidebar-active text-slate-900'
              : 'sidebar-idle text-slate-700 hover:text-slate-900'
          }`}
        title={navCollapsed ? reg.label : undefined}
      >
        {({ isActive }) => (
          <>
            <IconFilled
              className={`shrink-0 transition-colors sidebar-icon ${isActive ? 'text-orange-500' : 'text-slate-500 group-hover:text-slate-700'}`}
              style={{ width: 20, height: 20 }}
            />
            {!navCollapsed && <span className="truncate flex-1">{reg.label}</span>}
          </>
        )}
      </NavLink>
    </li>
  );
}

function SortableFolder({
  folder, collapsed, onToggle,
  isRenaming, renameDraft, onRenameDraftChange, onStartRename, onCommitRename,
  onDelete, onItemClick, navCollapsed, isAdmin, visibleAt,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: folder.id, disabled: !isAdmin });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const kids = visibleAt(folder.children || []);
  const kidIds = kids.map((k) => k.key);
  const Chevron = collapsed ? ChevronRight20Regular : ChevronDown20Regular;
  return (
    <li ref={setNodeRef} style={style} className="group/folder relative"
        data-testid={`settings-nav-folder-${folder.id}`}>
      <div className="flex items-stretch gap-1">
        {isAdmin && !navCollapsed && (
          <button
            type="button"
            className="opacity-0 group-hover/folder:opacity-100 text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing px-0.5 self-center"
            data-testid={`settings-nav-folder-${folder.id}-drag-handle`}
            {...attributes} {...listeners}
            title="Drag folder"
          >
            <ReOrderDotsVertical20Regular style={{ width: 12, height: 12 }} />
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          onDoubleClick={() => !isRenaming && onStartRename()}
          data-testid={`settings-nav-folder-${folder.id}-toggle`}
          className="flex-1 flex items-center gap-1.5 rounded-lg pr-2.5 pl-1.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-800 hover:bg-slate-50"
        >
          <Chevron style={{ width: 14, height: 14 }} />
          {isRenaming ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => onRenameDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitRename();
                if (e.key === 'Escape') onCommitRename();
              }}
              onBlur={onCommitRename}
              onClick={(e) => e.stopPropagation()}
              data-testid={`settings-nav-folder-${folder.id}-rename-input`}
              className="flex-1 bg-transparent border-b border-blue-400 text-slate-800 focus:outline-none text-[11px] uppercase tracking-wider"
            />
          ) : (
            !navCollapsed && <span className="truncate flex-1 text-left">{folder.label}</span>
          )}
        </button>
        {isAdmin && !navCollapsed && !isRenaming && (
          <button type="button" onClick={onDelete}
            data-testid={`settings-nav-folder-${folder.id}-delete`}
            title="Delete folder"
            className="opacity-0 group-hover/folder:opacity-100 text-slate-400 hover:text-rose-600 px-1 self-center"
          >
            <Delete20Regular style={{ width: 12, height: 12 }} />
          </button>
        )}
      </div>
      {!collapsed && (
        <SortableContext items={kidIds} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5 ml-1">
            {kids.map((k) => (
              <SortableItem
                key={k.key} id={k.key} node={k}
                navCollapsed={navCollapsed} onItemClick={onItemClick}
                isAdmin={isAdmin} inFolder={true}
              />
            ))}
            {kids.length === 0 && !navCollapsed && (
              <li className="text-[10px] text-slate-400 italic pl-6 py-1">Drop items here</li>
            )}
          </ul>
        </SortableContext>
      )}
    </li>
  );
}

function DeleteFolderModal({ folder, onCancel, onConfirm }) {
  useLockBodyScroll(true);
  const childCount = (folder.children || []).length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
      data-testid={`settings-nav-folder-${folder.id}-delete-modal`}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            Delete folder “{folder.label}”?
          </h2>
        </div>
        <div className="px-5 py-4 text-sm text-slate-700 space-y-2">
          {childCount === 0
            ? <p>This folder is empty. Deleting it just removes the header — no nav items are affected.</p>
            : (
              <>
                <p>
                  This folder contains {childCount} item{childCount === 1 ? '' : 's'}.
                </p>
                <p className="text-xs text-slate-500">
                  Deleting the folder moves those items back to the Settings root — they’re not deleted.
                </p>
              </>
            )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            data-testid={`settings-nav-folder-${folder.id}-delete-cancel`}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            data-testid={`settings-nav-folder-${folder.id}-delete-confirm`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
          >
            Delete folder
          </button>
        </div>
      </div>
    </div>
  );
}
