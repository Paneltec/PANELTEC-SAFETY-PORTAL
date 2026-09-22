// v58.13.132gz — Document Library Frontend Tree UI (extracted).
//
// Flat-list rendering strategy: we compute the visible node list
// (respecting the expanded map) into a single array and map over it
// once. This deliberately avoids JSX component self-recursion, which
// was tripping react-refresh's signature analyser in the current
// babel-loader stack ("Maximum call stack size exceeded" during
// traverse).
import React, { useMemo } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, X } from 'lucide-react';
import { Add20Regular as Plus, Edit20Regular as Pencil } from '@fluentui/react-icons';
import { EmptyState } from '../components/capture/Ui';

export function treeStorageKey(userId) {
  return `paneltec_doclib_tree_expanded_v1_${userId || 'anon'}`;
}
export function loadExpandedFromStorage(userId) {
  try {
    const raw = window.localStorage.getItem(treeStorageKey(userId));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch (_e) { return null; }
}
export function saveExpandedToStorage(userId, obj) {
  try {
    window.localStorage.setItem(treeStorageKey(userId), JSON.stringify(obj));
  } catch (_e) { /* Safari private-mode etc - no-op */ }
}

export function buildFolderIndex(allFolders) {
  const byId = {};
  const childrenOf = {};
  const roots = [];
  for (let i = 0; i < allFolders.length; i++) {
    const f = allFolders[i];
    byId[f.id] = f;
    if (!f.parent_folder_id) {
      roots.push(f.id);
    } else {
      const bucket = childrenOf[f.parent_folder_id] || [];
      bucket.push(f.id);
      childrenOf[f.parent_folder_id] = bucket;
    }
  }
  function cmp(a, b) {
    const A = byId[a]; const B = byId[b];
    const so = ((A && A.sort_order) || 0) - ((B && B.sort_order) || 0);
    if (so !== 0) return so;
    return String((A && A.name) || '').localeCompare(String((B && B.name) || ''));
  }
  roots.sort(cmp);
  Object.keys(childrenOf).forEach(function (pid) { childrenOf[pid].sort(cmp); });

  const totalCache = {};
  function totalFor(id, seen) {
    if (totalCache[id] !== undefined) return totalCache[id];
    const s = seen || new Set();
    if (s.has(id)) return 0;
    s.add(id);
    const node = byId[id];
    if (!node) return 0;
    let total = node.file_count || 0;
    const kids = childrenOf[id] || [];
    for (let i = 0; i < kids.length; i++) total += totalFor(kids[i], s);
    totalCache[id] = total;
    return total;
  }
  return { byId: byId, childrenOf: childrenOf, roots: roots, totalFor: totalFor };
}

export function computeDefaultExpanded(index) {
  const byId = index.byId;
  const roots = index.roots;
  const expanded = {};
  for (let i = 0; i < roots.length; i++) {
    if (byId[roots[i]] && byId[roots[i]].is_system) {
      expanded[roots[i]] = true;
      break;
    }
  }
  const ranked = [];
  for (let i = 0; i < roots.length; i++) {
    if (expanded[roots[i]]) continue;
    const node = byId[roots[i]];
    ranked.push({ id: roots[i], fc: (node && node.file_count) || 0 });
  }
  ranked.sort(function (a, b) { return b.fc - a.fc; });
  for (let i = 0; i < Math.min(2, ranked.length); i++) expanded[ranked[i].id] = true;
  return expanded;
}

export function isDescendantOrSelf(index, nodeId, candidateParentId) {
  if (!nodeId || !candidateParentId) return false;
  if (candidateParentId === nodeId) return true;
  const stack = [nodeId];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const kids = index.childrenOf[cur] || [];
    for (let i = 0; i < kids.length; i++) {
      if (kids[i] === candidateParentId) return true;
      stack.push(kids[i]);
    }
  }
  return false;
}

// Walk the tree in display order, honouring the expanded map, and
// emit a flat list of { id, depth } tuples. Rendering iterates this
// list once — no JSX component self-recursion needed.
function flattenVisible(index, expanded) {
  const out = [];
  const stack = [];
  for (let i = index.roots.length - 1; i >= 0; i--) {
    stack.push({ id: index.roots[i], depth: 0 });
  }
  while (stack.length) {
    const frame = stack.pop();
    out.push(frame);
    if (expanded[frame.id]) {
      const kids = index.childrenOf[frame.id] || [];
      for (let i = kids.length - 1; i >= 0; i--) {
        stack.push({ id: kids[i], depth: frame.depth + 1 });
      }
    }
  }
  return out;
}

function computeRowClass(dragging, dropTarget, invalidTarget) {
  let c = 'group flex items-center gap-2 py-1.5 pr-2 rounded-lg transition-colors';
  if (dragging) c += ' opacity-40';
  if (dropTarget && !invalidTarget) c += ' bg-brand-blue-soft/40 ring-1 ring-brand-blue/40';
  if (invalidTarget) c += ' bg-rose-50 ring-1 ring-rose-300';
  else if (!dropTarget) c += ' hover:bg-slate-50';
  return c;
}

// Presentation-only row. No JSX self-recursion — the parent maps a
// flat visible-nodes list.
function TreeRow(props) {
  const node = props.node;
  const index = props.index;
  const depth = props.depth;
  const isOpen = props.isOpen;
  const hasKids = props.hasKids;
  const canEdit = props.canEdit;
  const canDelete = props.canDelete;
  const dragState = props.dragState;
  const setDragState = props.setDragState;
  const reparent = props.reparent;
  const onToggle = props.onToggle;
  const onOpen = props.onOpen;
  const onRename = props.onRename;
  const onDelete = props.onDelete;
  const PASTEL_DOT = props.PASTEL_DOT;
  const PASTEL_LABEL = props.PASTEL_LABEL;

  const total = index.totalFor(node.id);
  const direct = node.file_count || 0;
  const showRollup = hasKids && total !== direct;
  const draggable = canEdit && !node.is_system;
  const dragging = dragState.draggingId === node.id;
  const dropTarget = dragState.overId === node.id;
  const invalidTarget = dropTarget && dragState.invalid;

  function onDragStart(e) {
    if (!draggable) return;
    e.dataTransfer.setData('text/paneltec-folder', node.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragState({ draggingId: node.id, overId: null, invalid: false });
  }
  function onDragEnd() {
    setDragState({ draggingId: null, overId: null, invalid: false });
  }
  function onDragOver(e) {
    if (!dragState.draggingId || dragState.draggingId === node.id) return;
    const dn = index.byId[dragState.draggingId];
    const bad = isDescendantOrSelf(index, dragState.draggingId, node.id)
      || (dn && dn.parent_folder_id === node.id);
    e.preventDefault();
    e.dataTransfer.dropEffect = bad ? 'none' : 'move';
    if (dragState.overId !== node.id || dragState.invalid !== bad) {
      setDragState({ draggingId: dragState.draggingId, overId: node.id, invalid: bad });
    }
  }
  function onDragLeave() {
    if (dragState.overId === node.id) {
      setDragState({ draggingId: dragState.draggingId, overId: null, invalid: false });
    }
  }
  function onDrop(e) {
    e.preventDefault();
    const src = e.dataTransfer.getData('text/paneltec-folder') || dragState.draggingId;
    setDragState({ draggingId: null, overId: null, invalid: false });
    if (!src || src === node.id) return;
    if (isDescendantOrSelf(index, src, node.id)) {
      toast.error('Cannot move a folder inside one of its own descendants.');
      return;
    }
    const sn = index.byId[src];
    if (sn && sn.parent_folder_id === node.id) return;
    reparent(src, node.id);
  }

  const rowClass = computeRowClass(dragging, dropTarget, invalidTarget);
  const rowStyle = { paddingLeft: (depth * 20 + 4) + 'px' };
  const dotClass = 'inline-block w-2.5 h-2.5 rounded-full border border-black/5 shrink-0 ' + PASTEL_DOT[node.color_key || 'sky'];
  const chevClass = 'transition-transform' + (isOpen ? ' rotate-90' : '');

  return (
    <div
      data-testid={'tree-row-' + node.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={rowClass}
      style={rowStyle}
    >
      {hasKids ? (
        <button
          type="button"
          onClick={function () { onToggle(node.id); }}
          data-testid={'tree-chevron-' + node.id}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:bg-slate-100"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className={chevClass}>
            <path d="M3 1.5 L7 5 L3 8.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <span className="w-5 h-5 inline-block" aria-hidden />
      )}
      <span className={dotClass} title={PASTEL_LABEL[node.color_key || 'sky']} />
      <button
        type="button"
        onClick={function () { onOpen(node.id); }}
        data-testid={'tree-open-' + node.id}
        className="flex-1 min-w-0 text-left text-sm text-slate-900 font-medium truncate hover:text-brand-blue"
      >
        {node.name}
        {node.is_system ? (
          <span className="ml-2 text-[9px] uppercase tracking-wider font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">System</span>
        ) : null}
        {/* v58.13.132km — Visible SHARED marker in the default tree view so
            admins can see at-a-glance which folders are worker-visible.
            The interactive Globe toggle lives in the card-grid render
            (accessible by activating a filter). WHS Reg 344 rationale in
            the ship memo. */}
        {node.shared_reference ? (
          <span
            data-testid={'tree-shared-pill-' + node.id}
            title="Shared reference — visible to all workers on mobile Docs tab"
            className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-semibold uppercase tracking-wider"
          >
            Shared
          </span>
        ) : null}
      </button>
      <span className="text-[11px] text-slate-500 tabular-nums shrink-0" data-testid={'tree-count-' + node.id}>
        {showRollup ? (
          <>
            <span className="text-slate-600 font-medium">{direct}</span>
            <span className="text-slate-400"> ({total})</span>
          </>
        ) : (
          <span className="text-slate-600">{direct}</span>
        )}
      </span>
      {canEdit && !node.is_system ? (
        <span
          className="inline-flex items-center gap-0.5 opacity-40 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          data-testid={'tree-actions-' + node.id}
        >
          {/* v58.13.132ht — Always-visible action pill (opacity-40 idle,
              full on hover / focus-within). The prior `hidden
              group-hover:inline-flex` guard silently hid the delete +
              rename affordances on touch devices (iPad in the field —
              Stephen's primary form factor), leaving admins with no
              way to remove folders from the tree. Desktop hover still
              gets the crisp brighten treatment. */}
          <button
            type="button"
            onClick={function (e) { e.stopPropagation(); onRename(node); }}
            data-testid={'tree-rename-' + node.id}
            title="Rename"
            className="w-6 h-6 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-brand-blue"
          >
            <Pencil />
          </button>
          {canDelete ? (
            <button
              type="button"
              onClick={function (e) { e.stopPropagation(); onDelete(node); }}
              data-testid={'tree-delete-' + node.id}
              title="Delete"
              className="w-6 h-6 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-rose-600"
            >
              <X size={11} />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function RenameRow(props) {
  const nodeId = props.nodeId;
  const depth = props.depth || 0;
  const value = props.value;
  const setValue = props.setValue;
  const onSave = props.onSave;
  const onCancel = props.onCancel;
  const busy = props.busy;
  function onKey(e) {
    if (e.key === 'Enter') onSave();
    else if (e.key === 'Escape') onCancel();
  }
  return (
    <div
      className="flex items-center gap-2 py-1.5 pr-2"
      style={{ paddingLeft: (depth * 20 + 4) + 'px' }}
      data-testid={'tree-rename-row-' + nodeId}
    >
      <input
        autoFocus
        value={value}
        onChange={function (e) { setValue(e.target.value); }}
        onKeyDown={onKey}
        maxLength={80}
        data-testid={'tree-rename-input-' + nodeId}
        className="flex-1 px-2 py-1 text-sm border border-brand-blue/40 rounded bg-white"
      />
      <button
        onClick={onSave}
        disabled={busy}
        data-testid={'tree-rename-save-' + nodeId}
        className="px-2 py-1 rounded bg-brand-blue text-white text-xs font-medium"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
      </button>
      <button onClick={onCancel} className="px-2 py-1 rounded border border-slate-300 bg-white text-xs">Cancel</button>
    </div>
  );
}

export default function FolderTreeView(props) {
  const allFolders = props.allFolders;
  const expanded = props.expanded;
  const onToggle = props.onToggle;
  const canEdit = props.canEdit;
  const canDelete = props.canDelete;
  const navigate = props.navigate;
  const dragState = props.dragState;
  const setDragState = props.setDragState;
  const reparent = props.reparent;
  const onRename = props.onRename;
  const onDelete = props.onDelete;
  const renamingId = props.renamingId;
  const renameValue = props.renameValue;
  const setRenameValue = props.setRenameValue;
  const onSaveRename = props.onSaveRename;
  const onCancelRename = props.onCancelRename;
  const busy = props.busy;
  const PASTEL_DOT = props.PASTEL_DOT;
  const PASTEL_LABEL = props.PASTEL_LABEL;
  const onCreateEmpty = props.onCreateEmpty;

  const index = useMemo(function () { return buildFolderIndex(allFolders); }, [allFolders]);
  const visible = useMemo(function () { return flattenVisible(index, expanded); }, [index, expanded]);

  if (!allFolders.length) {
    return (
      <EmptyState
        title="No folders yet"
        body="Create your first document folder to get started."
        action={canEdit ? (
          <button onClick={onCreateEmpty} data-testid="folder-empty-create"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium">
            <Plus /> New folder
          </button>
        ) : null}
      />
    );
  }

  const draggingNode = dragState.draggingId ? index.byId[dragState.draggingId] : null;
  const rootDropInvalid = draggingNode && !draggingNode.parent_folder_id;
  const rootDropActive = dragState.draggingId && !rootDropInvalid;

  function onRootDropOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function onRootDrop(e) {
    e.preventDefault();
    const src = e.dataTransfer.getData('text/paneltec-folder') || dragState.draggingId;
    setDragState({ draggingId: null, overId: null, invalid: false });
    if (!src) return;
    const srcNode = index.byId[src];
    if (!srcNode || !srcNode.parent_folder_id) return;
    reparent(src, '-');
  }

  function openFolder(id) { navigate('/app/document-library/' + id); }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-2" data-testid="folder-tree">
      {rootDropActive ? (
        <div
          data-testid="tree-root-drop-zone"
          onDragOver={onRootDropOver}
          onDrop={onRootDrop}
          className="mb-1 px-3 py-2 rounded-lg border-2 border-dashed border-brand-blue/40 bg-brand-blue-soft/20 text-xs text-brand-blue font-medium text-center"
        >
          Drop here to move to root
        </div>
      ) : null}
      <div role="tree" aria-label="Document Library folder tree">
        {visible.map(function (frame) {
          const node = index.byId[frame.id];
          if (!node) return null;
          if (renamingId === frame.id) {
            return (
              <RenameRow
                key={frame.id}
                nodeId={frame.id}
                depth={frame.depth}
                value={renameValue}
                setValue={setRenameValue}
                onSave={onSaveRename}
                onCancel={onCancelRename}
                busy={busy}
              />
            );
          }
          const kids = index.childrenOf[frame.id] || [];
          return (
            <TreeRow
              key={frame.id}
              node={node}
              index={index}
              depth={frame.depth}
              isOpen={!!expanded[frame.id]}
              hasKids={kids.length > 0}
              canEdit={canEdit}
              canDelete={canDelete}
              dragState={dragState}
              setDragState={setDragState}
              reparent={reparent}
              onToggle={onToggle}
              onOpen={openFolder}
              onRename={onRename}
              onDelete={onDelete}
              PASTEL_DOT={PASTEL_DOT}
              PASTEL_LABEL={PASTEL_LABEL}
            />
          );
        })}
      </div>
    </div>
  );
}
