// v58.13.132n2 — Dropbox in-app file browser page.
//
// `.132n5` — Drag-and-drop MOVE.  In-app row drags move files
// and folders into any folder-row / breadcrumb-ancestor /
// back-arrow drop target via the existing `/api/dropbox/browse/
// move` endpoint.  Multi-select drag = batch move.  OS-file
// drag-drop upload continues to work (discriminated via
// `DataTransfer.types` — presence of `Files` = upload,
// `application/x-paneltec-dropbox-move` = in-app move).
//
// `.132n4c` — Preview reliability.  PDFs now render through
// `<object>` with a native "Download instead" fallback rather
// than a bare `<iframe>` that painted a broken-doc icon on some
// browsers.  Adds a 50 MB size guard (backend 413 + FE skip),
// retry-once on 5xx/network, and per-kind error panels.
//
// `.132n4b` — Dropbox Share modal.
//
// `.132n4a` — Dropbox-native UX polish. Adds:
//   · Lazy `/count` fetch per visible folder row + subtle badge.
//   · Row-level ⋯ menu (Preview/Download/Rename/Copy path/Move/
//     Version history/Delete). Share slot rendered but disabled;
//     `.132n4b` unhooks it once the App Console grants
//     `sharing.write`.
//   · Rename dialog + Move-picker modal + Version history drawer.
//   · Right details panel on single-click of a FILE row.
//     Double-click still opens the preview modal. Folder rows
//     keep their single-click-navigates behaviour.
//
// `.132n2c` — UX polish pass. Adds:
//   · Back arrow (up one folder) button beside the breadcrumb.
//   · Row-level checkboxes + header tri-state "select all".
//   · Selection toolbar: bulk Download + bulk Delete + Deselect.
//   · Richer row display (Modified with time, human-readable Size).
//   · Dropbox brand blue (#0061FF) on primary buttons, checkboxes,
//     row-hover accent, and active breadcrumb.
//
// `.132n2b` — File-row clicks now open <FilePreviewModal> instead
// of popping the raw Dropbox temp link in a new tab. Downloads
// still available from inside the modal.
//
// Replaces the external-tab launcher from `.132n0`. Renders at
// `/app/dropbox` (gated on `integrations.view` via the sidebar
// entry + a route-level guard here for deep-links). Talks to
// `/api/dropbox/browse` — see `backend/dropbox_browse.py`.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useCan } from '@/lib/permissions';
import { PageHeader } from '@/components/capture/Ui';
import FilePreviewModal from '@/components/dropbox/FilePreviewModal';
import RowActionMenu from '@/components/dropbox/RowActionMenu';
import MovePickerModal from '@/components/dropbox/MovePickerModal';
import VersionHistoryDrawer from '@/components/dropbox/VersionHistoryDrawer';
import DetailsPanel from '@/components/dropbox/DetailsPanel';
import ShareModal from '@/components/dropbox/ShareModal';
import {
  Folder24Regular, Document24Regular, DocumentPdf24Regular,
  Image24Regular, Video24Regular, DocumentTable24Regular,
  ArrowUpload20Regular, FolderAdd20Regular, ArrowClockwise20Regular,
  ArrowDownload20Regular, Delete20Regular, Search20Regular,
  ChevronRight16Regular, Dismiss20Regular, ArrowUp20Regular, ArrowDown20Regular,
  ArrowLeft20Regular,
} from '@fluentui/react-icons';

// Dropbox brand blue for primary accents. Kept as an inline const
// (not a Tailwind theme colour) so index.css doesn't get widened
// beyond the browser's own scope — this colour is Dropbox-specific
// and shouldn't leak into other product surfaces.
const DBX_BLUE = '#0061FF';

const TEAM_ROOT_LABEL = 'Paneltec-General Administration';
// v58.13.132n2 — Frontend uses namespace-relative paths throughout
// (`""` = team folder root, `"/Foo/Bar"` = subfolder). Matches
// Dropbox's `path_display` shape for namespace-scoped clients (see
// `backend/dropbox_browse._normalise_path` for the full contract).
const ROOT_PATH = '';

export default function DropboxBrowser() {
  const can = useCan();
  const allowed = can('integrations', 'view');

  const [searchParams, setSearchParams] = useSearchParams();
  const path = searchParams.get('path') || ROOT_PATH;

  const [state, setState] = useState({ loading: true, error: null, entries: [] });
  // v58.13.132n6 — Dropbox global search state.  Was previously a
  // pure client-side "filter this folder" input; now backed by the
  // server-side `/api/dropbox/browse/search` endpoint (Dropbox
  // `search_v2` + highlight spans).  Behaviour:
  //   · <3 chars  → no request; results panel hidden; folder view
  //                 renders unfiltered.
  //   · >=3 chars → 300 ms debounce → GET /search → overlay panel
  //                 renders match rows with highlight bolding.
  // Tier 2 (LLM re-rank of top 20 with "why matched" reasons) is
  // deferred to `.132n6b` — the backend endpoint already accepts
  // `?rerank=true` so the FE can wire it later without another API
  // cut.
  const [search, setSearch] = useState({
    query: '', loading: false, results: [], error: null, hasMore: false,
  });
  const searchAbortRef = useRef(null);
  const [activityFilter, setActivityFilter] = useState('all');
  const [checking, setChecking] = useState(false);
  const refreshSequence = useRef(0);
  const [sortBy, setSortBy] = useState({ col: 'name', dir: 'asc' });
  const [uploads, setUploads] = useState([]); // {name, size, progress, status, error}
  const [confirmDelete, setConfirmDelete] = useState(null); // entry to delete
  const [mkdirModal, setMkdirModal] = useState(null); // null | { name: '' }
  const [dragOver, setDragOver] = useState(false);
  // `.132n2b` — file entry being previewed in the modal (null when closed).
  const [previewEntry, setPreviewEntry] = useState(null);
  // `.132n2c` — multi-select. `selectedIds` is a Set of entry
  // `path` strings (canonical, namespace-relative). Cleared on
  // folder change so selections don't quietly persist across
  // navigations.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(null); // null | array
  // `.132n4a` state.
  const [detailsEntry, setDetailsEntry] = useState(null);        // right details panel
  const [movePickerFor, setMovePickerFor] = useState(null);       // Move to… modal
  const [versionsFor, setVersionsFor] = useState(null);           // Version history drawer
  const [renameFor, setRenameFor] = useState(null);               // {entry, name}
  // `.132n4b` — Share modal target entry (null when closed).
  const [shareFor, setShareFor] = useState(null);
  // `.132n5` — Drag-and-drop MOVE state.  Distinct from
  // `.132n2c` OS-file drag-drop UPLOAD state (still handled via
  // `dragOver` + the page-level `onDrop`).  Discriminator:
  // `DataTransfer.types` — presence of `Files` = OS upload,
  // presence of our custom MIME `application/x-paneltec-move` =
  // in-app move.
  //
  //   · `draggingPaths` — paths currently being dragged (source
  //     rows render at half-opacity).  Populated on `dragstart`
  //     from either the single row or the multi-selection, and
  //     cleared on `dragend`/`drop`.
  //   · `dragTarget` — `{path, name, valid, reason}` for the
  //     folder-row/breadcrumb/back-arrow the pointer is currently
  //     over.  Drives ring styling + the floating tooltip.
  const [draggingPaths, setDraggingPaths] = useState([]);
  const [dragTarget, setDragTarget] = useState(null);
  // Live mouse position, tracked during dragover for the
  // floating "Move to <name>" tooltip.  Ref, not state, so the
  // 60 Hz updates don't force re-renders — only tooltip render
  // reads it.
  const dragMousePos = useRef({ x: 0, y: 0 });
  // Map<folderPath, {item_count, is_partial}> — filled lazily
  // by the folder-count effect. Cleared on `path` change so
  // stale counts don't flash for the wrong parent.
  const [folderCounts, setFolderCounts] = useState({});
  const fileInputRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!allowed) return;
    const sequence = ++refreshSequence.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await api.get('/dropbox/browse', { params: { path } });
      if (sequence !== refreshSequence.current) return;
      setState({ loading: false, error: null, entries: data.entries || [], activity: data.activity, path });
    } catch (e) {
      if (sequence !== refreshSequence.current) return;
      setState({ loading: false, error: apiError(e), entries: [] });
    }
  }, [path, allowed]);

  useEffect(() => { refresh(); return () => { refreshSequence.current += 1; }; }, [refresh]);

  const markFolderChecked = async () => {
    if (!state.activity?.observed_at || state.path !== path) return;
    setChecking(true);
    try {
      await api.post('/dropbox/browse/activity/check', {
        path: state.path, observed_at: state.activity.observed_at,
      });
      await refresh();
      toast.success('This folder is marked as checked for your account.');
    } catch (err) { toast.error(apiError(err)); }
    finally { setChecking(false); }
  };
  useEffect(() => { setSelectedIds(new Set()); }, [activityFilter]);


  // v58.13.132n6 — Debounced Dropbox global search.  Runs whenever
  // `search.query` changes AND is >= 3 chars after trim.  Cancels
  // any in-flight request via AbortController so a fast typist
  // doesn't get an out-of-order response painted over a newer one.
  useEffect(() => {
    const q = (search.query || '').trim();
    if (q.length < 3) {
      setSearch((s) => ({ ...s, loading: false, results: [], error: null, hasMore: false }));
      return undefined;
    }
    const controller = new AbortController();
    // Cancel prior request (if any) so results always match the
    // last query the user typed.
    if (searchAbortRef.current) {
      try { searchAbortRef.current.abort(); } catch (_) { /* noop */ }
    }
    searchAbortRef.current = controller;

    setSearch((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/dropbox/browse/search', {
          params: { q, max_results: 100 },
          signal: controller.signal,
        });
        // Guard: if a newer request has landed already (controller
        // replaced), don't overwrite its state with our older one.
        if (searchAbortRef.current !== controller) return;
        setSearch({
          query: q,
          loading: false,
          error: null,
          results: data.matches || [],
          hasMore: !!data.has_more,
        });
      } catch (err) {
        if (controller.signal.aborted) return;   // superseded — silent
        if (searchAbortRef.current !== controller) return;
        setSearch((s) => ({
          ...s, loading: false,
          error: apiError(err) || 'Search failed',
          results: [], hasMore: false,
        }));
      }
    }, 300);
    return () => {
      clearTimeout(t);
      try { controller.abort(); } catch (_) { /* noop */ }
    };
  }, [search.query]);

  const setPath = (p) => {
    // Empty string == root — omit the query param entirely so the
    // URL reads `/app/dropbox` instead of `/app/dropbox?path=`.
    if (!p || p === ROOT_PATH) setSearchParams({});
    else setSearchParams({ path: p });
  };

  const crumbs = useMemo(() => {
    // Path is namespace-relative: `""` (root) or `"/Foo/Bar"`.
    // Build breadcrumb from segments + cumulative paths so each
    // crumb can navigate back up the tree.
    const segs = (path || '').split('/').filter(Boolean);
    const parts = [{ label: TEAM_ROOT_LABEL, path: ROOT_PATH }];
    let cur = '';
    for (const s of segs) {
      cur = cur + '/' + s;
      parts.push({ label: s, path: cur });
    }
    return parts;
  }, [path]);

  const rows = useMemo(() => {
    // `.132n6` — client-side "filter this folder" narrowing was
    // retired when we moved to server-side search.  `rows` now
    // just sorts the folder's own entries; matching happens in
    // the overlay panel against `search.results`.
    let out = state.entries.filter((entry) => activityFilter === 'all'
      || (activityFilter === 'unread' && entry.new_since_check)
      || (activityFilter === 'week' && entry.new_last_week));
    out.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      const dir = sortBy.dir === 'asc' ? 1 : -1;
      if (sortBy.col === 'name') return dir * a.name.localeCompare(b.name);
      if (sortBy.col === 'size') return dir * ((a.size || 0) - (b.size || 0));
      if (sortBy.col === 'modified') {
        return dir * String(a.modified || '').localeCompare(String(b.modified || ''));
      }
      return 0;
    });
    return out;
  }, [state.entries, sortBy, activityFilter]);

  const toggleSort = (col) => setSortBy((s) => ({
    col,
    dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc',
  }));

  const openEntry = async (e) => {
    if (e.type === 'folder') {
      setPath(e.path);
      return;
    }
    // `.132n4a` — Single click on a file row opens the DETAILS
    // panel (right slide-in), not the preview modal. Double click
    // (or the "Preview" quick action inside the panel / row-menu)
    // still opens the preview modal. Matches the Dropbox web UX
    // convention: click to inspect metadata, double-click to view.
    setDetailsEntry(e);
  };

  const openPreview = (e) => {
    // Called from double-click, row-menu "Preview", details-panel
    // Preview button. Closes the details panel first so we don't
    // stack two right-side surfaces.
    setDetailsEntry(null);
    setPreviewEntry(e);
  };

  const downloadEntry = async (e) => {
    try {
      const { data } = await api.get('/dropbox/browse/download', { params: { path: e.path } });
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(`Download failed: ${apiError(err)}`);
    }
  };

  const copyPath = async (e) => {
    try {
      await navigator.clipboard.writeText(e.path);
      toast.success('Path copied.');
    } catch (err) {
      toast.error(`Copy failed: ${apiError(err)}`);
    }
  };

  // ── `.132n5` — drag-drop MOVE plumbing ────────────────────────
  //
  // MIME discriminator; also used as the payload key so drop
  // targets can pull the source paths back out.
  const DND_MIME = 'application/x-paneltec-dropbox-move';

  // Validate a proposed move.  Returns `{valid: bool, reason?: str}`.
  // Rules:
  //   · sources[i] must not equal target                     (can't move into itself)
  //   · target must not start with any source path + '/'     (no descendant-cycle)
  //   · parent(sources[i]) must not equal target             (already there — no-op)
  const validateDropTarget = (sources, targetPath) => {
    if (!sources || sources.length === 0) {
      return { valid: false, reason: 'nothing to move' };
    }
    const tgt = targetPath || '';
    for (const src of sources) {
      if (src === tgt) {
        return { valid: false, reason: 'Cannot move a folder into itself.' };
      }
      if (tgt.startsWith(src + '/')) {
        return { valid: false, reason: 'Cannot move a folder into its own subfolder.' };
      }
      // parent(src)
      const parentIdx = src.lastIndexOf('/');
      const parent = parentIdx <= 0 ? '' : src.substring(0, parentIdx);
      if (parent === tgt) {
        return { valid: false, reason: 'Already in this folder.' };
      }
    }
    return { valid: true };
  };

  const onRowDragStart = (entry, ev) => {
    // If the user starts dragging one of the currently-selected
    // rows, drag ALL of them (batch move).  Otherwise drag only
    // the single row and leave the current selection untouched.
    let paths;
    if (selectedIds.has(entry.path)) {
      paths = Array.from(selectedIds);
    } else {
      paths = [entry.path];
    }
    setDraggingPaths(paths);
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData(DND_MIME, JSON.stringify({ paths }));

    // Custom drag image — a compact chip that shows the file
    // name (or count) so multi-select drags feel intentional.
    const ghost = document.createElement('div');
    ghost.className = 'pointer-events-none px-3 py-1.5 rounded-lg bg-white shadow-xl border border-slate-200 text-xs font-semibold text-slate-800 flex items-center gap-1.5';
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    ghost.style.left = '-1000px';
    ghost.innerText = paths.length === 1
      ? entry.name
      : `${paths.length} items`;
    document.body.appendChild(ghost);
    ev.dataTransfer.setDragImage(ghost, 12, 12);
    // Ghost is only needed for the initial screenshot the browser
    // takes; drop the node right after.
    setTimeout(() => ghost.remove(), 0);
  };

  const onRowDragEnd = () => {
    setDraggingPaths([]);
    setDragTarget(null);
  };

  // Reads the DnD payload for the current drop attempt.  Falls
  // back to state.draggingPaths when the browser hasn't yet
  // exposed the payload (some browsers gate `getData` until
  // `drop` fires — for `dragover`/`dragenter` we can only see
  // `types`, not payloads).
  const readDragPayload = (ev) => {
    try {
      const raw = ev.dataTransfer.getData(DND_MIME);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.paths)) return parsed.paths;
      }
    } catch (_) { /* noop */ }
    return draggingPaths;
  };

  const hasMovePayload = (ev) =>
    Array.from(ev.dataTransfer?.types || []).includes(DND_MIME);

  // Folder-row / breadcrumb / back-arrow drop-target factory.
  // Wires up the four DnD handlers a component needs to accept
  // move drops.  Callers pass in the *target folder path* + a
  // display name (only used for the tooltip).
  const makeDropTargetHandlers = (targetPath, displayName) => ({
    onDragEnter: (ev) => {
      if (!hasMovePayload(ev)) return;
      ev.preventDefault();
      const validation = validateDropTarget(draggingPaths, targetPath);
      setDragTarget({ path: targetPath, name: displayName, ...validation });
    },
    onDragOver: (ev) => {
      if (!hasMovePayload(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      // Track mouse for the floating tooltip.  Ref-only so we
      // don't force re-renders 60×/sec — the tooltip reads from
      // it during its own render (driven by dragTarget changes).
      dragMousePos.current = { x: ev.clientX, y: ev.clientY };
      const validation = validateDropTarget(draggingPaths, targetPath);
      ev.dataTransfer.dropEffect = validation.valid ? 'move' : 'none';
      // Keep dragTarget in sync — cursor may have entered from a
      // sibling target without triggering our onDragEnter cleanly.
      if (!dragTarget || dragTarget.path !== targetPath) {
        setDragTarget({ path: targetPath, name: displayName, ...validation });
      }
    },
    onDragLeave: (ev) => {
      // Only clear when the pointer actually leaves this target —
      // moving between child elements still fires dragleave.
      if (ev.currentTarget.contains(ev.relatedTarget)) return;
      setDragTarget((cur) => (cur && cur.path === targetPath ? null : cur));
    },
    onDrop: async (ev) => {
      if (!hasMovePayload(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const paths = readDragPayload(ev);
      const validation = validateDropTarget(paths, targetPath);
      setDraggingPaths([]);
      setDragTarget(null);
      if (!validation.valid) {
        toast.error(validation.reason);
        return;
      }
      await doBatchMove(paths, targetPath, displayName);
    },
  });

  const doBatchMove = async (paths, toFolder, toFolderName) => {
    let okCount = 0;
    const failed = [];
    for (const src of paths) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.post('/dropbox/browse/move', {
          from_path: src, to_folder: toFolder || '',
        });
        okCount += 1;
      } catch (err) {
        const base = src.substring(src.lastIndexOf('/') + 1);
        failed.push(`${base}: ${apiError(err)}`);
      }
    }
    // Drop selections that were consumed by a successful move —
    // the paths those IDs point at no longer exist at the source.
    if (okCount > 0) {
      setSelectedIds((s) => {
        const next = new Set(s);
        for (const p of paths) next.delete(p);
        return next;
      });
    }
    await refresh();
    const dstLabel = toFolderName || (toFolder ? toFolder : '/');
    if (okCount > 0) {
      toast.success(
        `Moved ${okCount} item${okCount === 1 ? '' : 's'} to ${dstLabel}.`,
      );
    }
    if (failed.length > 0) {
      toast.error(failed.join('\n'));
    }
  };

  const doUpload = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const initial = list.map((f) => ({
      name: f.name, size: f.size, progress: 0, status: 'uploading', error: null,
    }));
    setUploads((prev) => [...prev, ...initial]);

    for (let idx = 0; idx < list.length; idx++) {
      const file = list[idx];
      const globalIdx = uploads.length + idx;
      const form = new FormData();
      form.append('path', path);
      form.append('file', file);
      try {
        await api.post('/dropbox/browse/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (evt) => {
            const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0;
            setUploads((prev) => prev.map((u, i) => i === globalIdx ? { ...u, progress: pct } : u));
          },
        });
        setUploads((prev) => prev.map((u, i) => i === globalIdx ? { ...u, progress: 100, status: 'done' } : u));
      } catch (err) {
        setUploads((prev) => prev.map((u, i) => i === globalIdx ? { ...u, status: 'error', error: apiError(err) } : u));
      }
    }
    refresh();
  };

  const doMkdir = async (name) => {
    const clean = (name || '').trim();
    if (!clean) return;
    // Path is namespace-relative; build `/…/newname` and let the
    // backend normalise. When at root (path === "") we get "/newname".
    const base = path && path !== ROOT_PATH ? path.replace(/\/$/, '') : '';
    const newPath = base + '/' + clean;
    try {
      await api.post('/dropbox/browse/mkdir', { path: newPath });
      toast.success(`Folder created: ${clean}`);
      setMkdirModal(null);
      refresh();
    } catch (err) {
      toast.error(`Create folder failed: ${apiError(err)}`);
    }
  };

  const doDelete = async (entry) => {
    try {
      await api.delete('/dropbox/browse', { params: { path: entry.path } });
      toast.success(`Deleted: ${entry.name}`);
      setConfirmDelete(null);
      refresh();
    } catch (err) {
      toast.error(`Delete failed: ${apiError(err)}`);
    }
  };

  // ── `.132n2c` — up-arrow navigation ──────────────────────
  const parentPath = useMemo(() => {
    // Namespace-relative paths: `""` = team folder root,
    // `"/Foo"` = one level below root, `"/Foo/Bar"` = two levels.
    // Up-from-root returns null (button will be disabled).
    if (!path || path === ROOT_PATH) return null;
    const segs = path.split('/').filter(Boolean);
    segs.pop();
    return segs.length === 0 ? ROOT_PATH : '/' + segs.join('/');
  }, [path]);

  const goUp = () => {
    if (parentPath === null) return;
    setPath(parentPath);
  };

  // ── `.132n2c` — multi-select ─────────────────────────────
  // Clear selection whenever the visible folder changes. Selections
  // that would silently persist across navigations are a common
  // "wait, I meant THIS folder!" trap in file managers.
  useEffect(() => { setSelectedIds(new Set()); }, [path]);

  // `.132n4a` — Lazy folder-count fetch. Fires AFTER the parent
  // list renders (state.loading transitions to false) and only
  // for FOLDER rows that don't already have a count in the map.
  // Concurrency capped at 5 parallel requests to match the
  // backend semaphore + spare cycles for the migration engine.
  useEffect(() => {
    if (state.loading || state.error) return undefined;
    const folders = state.entries.filter((e) => e.type === 'folder');
    if (folders.length === 0) return undefined;

    let cancelled = false;
    const pending = folders
      .map((f) => f.path)
      .filter((p) => folderCounts[p] === undefined);
    if (pending.length === 0) return undefined;

    const MAX_CONCURRENT = 5;
    let inFlight = 0;
    let idx = 0;

    const runNext = async () => {
      if (cancelled) return;
      if (idx >= pending.length) return;
      const target = pending[idx++];
      inFlight++;
      try {
        const { data } = await api.get('/dropbox/browse/count', {
          params: { path: target },
        });
        if (!cancelled) {
          setFolderCounts((prev) => ({
            ...prev,
            [target]: { item_count: data.item_count, is_partial: data.is_partial },
          }));
        }
      } catch {
        // Silent fail — badge is decorative. Cache the null so we
        // don't retry the same folder in a tight loop.
        if (!cancelled) {
          setFolderCounts((prev) => ({
            ...prev,
            [target]: { item_count: null, is_partial: false },
          }));
        }
      } finally {
        inFlight--;
        runNext();
      }
    };

    for (let i = 0; i < Math.min(MAX_CONCURRENT, pending.length); i++) {
      runNext();
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- folderCounts
    // is intentionally omitted; including it would re-fire the effect
    // after every count arrives.
  }, [state.entries, state.loading, state.error]);

  // Clear the count map on folder change so stale counts don't
  // flash on the wrong parent.
  useEffect(() => { setFolderCounts({}); }, [path]);

  const doRename = async () => {
    if (!renameFor) return;
    const { entry, name } = renameFor;
    const nextName = (name || '').trim();
    if (!nextName || nextName === entry.name) {
      setRenameFor(null);
      return;
    }
    try {
      await api.post('/dropbox/browse/rename', {
        from_path: entry.path,
        new_name:  nextName,
      });
      toast.success(`Renamed to ${nextName}`);
      setRenameFor(null);
      refresh();
    } catch (err) {
      toast.error(`Rename failed: ${apiError(err)}`);
    }
  };

  const toggleSelect = (entry) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      // If every visible row is already selected, deselect all.
      // Otherwise select every visible row (including folders — the
      // toolbar's bulk-download handler skips folders with a toast).
      const visibleIds = rows.map((r) => r.path);
      const allSelected = visibleIds.length > 0 &&
        visibleIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(visibleIds);
    });
  };

  const doBulkDownload = async () => {
    const selectedEntries = rows.filter((r) => selectedIds.has(r.path));
    const files = selectedEntries.filter((r) => r.type === 'file');
    const folders = selectedEntries.filter((r) => r.type === 'folder');
    if (folders.length > 0) {
      toast.info(`Skipping ${folders.length} folder${folders.length === 1 ? '' : 's'}: open them and select files inside for bulk download.`);
    }
    if (files.length === 0) return;
    toast.success(`Starting ${files.length} download${files.length === 1 ? '' : 's'}…`);
    // Sequential temp-link fetch + window.open. Serial (not
    // Promise.all) so we don't hammer the Dropbox rate limit and
    // so popup-blockers get one trigger at a time rather than a
    // 5-tab burst (which browsers reliably block).
    let ok = 0, fail = 0;
    for (const f of files) {
      try {
        const { data } = await api.get('/dropbox/browse/download', { params: { path: f.path } });
        // `noopener` still lets the download start in a new tab.
        // Some browsers block multiple back-to-back window.open;
        // this is documented in the ship memo — worst case the
        // user re-runs on the offending file.
        window.open(data.url, '_blank', 'noopener,noreferrer');
        ok++;
      } catch (err) {
        console.warn('[dropbox.bulkDownload]', f.name, err); // eslint-disable-line no-console
        fail++;
      }
    }
    if (fail === 0) {
      toast.success(`Downloaded ${ok} file${ok === 1 ? '' : 's'}.`);
    } else {
      toast.error(`Downloaded ${ok} · ${fail} failed. Popup blocker? Try individual downloads.`);
    }
  };

  const doBulkDelete = async () => {
    const selectedEntries = rows.filter((r) => selectedIds.has(r.path));
    if (selectedEntries.length === 0) return;
    const results = await Promise.allSettled(
      selectedEntries.map((e) =>
        api.delete('/dropbox/browse', { params: { path: e.path } })
      )
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (fail === 0) {
      toast.success(`Deleted ${ok} item${ok === 1 ? '' : 's'}.`);
    } else {
      toast.error(`Deleted ${ok} · ${fail} failed. Refresh to see the current state.`);
    }
    setBulkDeleteConfirm(null);
    clearSelection();
    refresh();
  };

  // ── access denied ────────────────────────────────────────
  if (!allowed) {
    return (
      <div className="max-w-3xl mx-auto rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500"
           data-testid="dropbox-browser-denied">
        <div className="text-sm font-semibold text-slate-800 mb-2">Dropbox browser locked</div>
        <p className="text-xs leading-relaxed max-w-md mx-auto">
          Your permission preset does not grant{' '}
          <span className="font-mono">integrations.view</span>.
          Ask an admin to tick that cell on your preset from Settings → Permission presets.
        </p>
      </div>
    );
  }

  return (
    <div
      className="max-w-[1400px] mx-auto"
      data-testid="dropbox-browser-page"
      /* `.132n5` — page-level drag handlers gate on the `Files`
         DataTransfer type so OS-file drops keep triggering the
         upload flow, but in-app row drags (which advertise the
         custom `application/x-paneltec-dropbox-move` type)
         bubble through untouched to their folder-row / breadcrumb
         drop targets. */
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer?.types || []);
        if (!types.includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={(e) => {
        const types = Array.from(e.dataTransfer?.types || []);
        if (!types.includes('Files')) return;
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) doUpload(e.dataTransfer.files);
      }}
    >
      <PageHeader
        crumb="Dropbox"
        title="Dropbox"
        subtitle="Browse, download, upload, and manage files in the Paneltec team folder without leaving the app."
      />

      {/* Breadcrumb + toolbar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <nav className="flex items-center flex-wrap gap-1 text-sm" data-testid="dropbox-breadcrumb">
            <button
              type="button"
              onClick={goUp}
              disabled={parentPath === null}
              title="Up one folder"
              aria-label="Up one folder"
              data-testid="dropbox-up-btn"
              className={`mr-1 p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${
                parentPath !== null && dragTarget?.path === parentPath
                  ? (dragTarget.valid
                      ? 'ring-2 ring-[#0061FF] bg-[rgba(0,97,255,0.10)]'
                      : 'ring-2 ring-rose-500 bg-rose-50')
                  : ''
              }`}
              {...(parentPath !== null
                ? makeDropTargetHandlers(parentPath, parentPath === '' ? 'Paneltec team folder' : (parentPath.split('/').pop() || 'parent'))
                : {})}
            >
              <ArrowLeft20Regular style={{ width: 16, height: 16 }} />
            </button>
            {crumbs.map((c, i) => {
              const isActive = i === crumbs.length - 1;
              const isTarget = dragTarget?.path === c.path;
              return (
                <React.Fragment key={c.path}>
                  {i > 0 && <ChevronRight16Regular className="text-slate-400" style={{ width: 14, height: 14 }} />}
                  <button
                    type="button"
                    onClick={() => setPath(c.path)}
                    className={`px-2 py-1 rounded-md hover:bg-slate-100 transition-colors ${
                      isActive ? 'font-semibold text-slate-900 border-b-2' : 'text-slate-600 border-b-2 border-transparent'
                    } ${
                      isTarget
                        ? (dragTarget.valid
                            ? 'ring-2 ring-[#0061FF] bg-[rgba(0,97,255,0.10)]'
                            : 'ring-2 ring-rose-500 bg-rose-50')
                        : ''
                    }`}
                    style={isActive ? { borderColor: DBX_BLUE } : undefined}
                    data-testid={`dropbox-crumb-${i}`}
                    {...(!isActive ? makeDropTargetHandlers(c.path, c.label) : {})}
                  >
                    {c.label}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropbox-upload-btn"
              className="inline-flex items-center gap-1.5 rounded-lg text-white text-xs font-semibold px-3 py-2 hover:brightness-110"
              style={{ backgroundColor: DBX_BLUE }}
            >
              <ArrowUpload20Regular style={{ width: 16, height: 16 }} />
              Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { doUpload(e.target.files); e.target.value = ''; }}
              data-testid="dropbox-upload-input"
            />
            <button
              type="button"
              onClick={() => setMkdirModal({ name: '' })}
              data-testid="dropbox-mkdir-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border text-xs font-semibold px-3 py-2 hover:bg-slate-50"
              style={{ borderColor: DBX_BLUE, color: DBX_BLUE }}
            >
              <FolderAdd20Regular style={{ width: 16, height: 16 }} />
              New folder
            </button>
            <button
              type="button"
              onClick={refresh}
              data-testid="dropbox-refresh-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2"
              title="Refresh"
            >
              <ArrowClockwise20Regular style={{ width: 16, height: 16 }} />
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-3 relative">
          <Search20Regular
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            style={{ width: 14, height: 14 }}
          />
          <input
            type="text"
            placeholder="Search Dropbox (min 3 chars)…"
            value={search.query}
            onChange={(e) => setSearch((s) => ({ ...s, query: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearch({ query: '', loading: false, results: [], error: null, hasMore: false });
              }
            }}
            data-testid="dropbox-search-input"
            className="w-full max-w-md pl-9 pr-9 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-slate-400 focus:outline-none text-sm"
          />
          {search.query && (
            <button
              type="button"
              onClick={() => setSearch({ query: '', loading: false, results: [], error: null, hasMore: false })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              aria-label="Clear search"
              data-testid="dropbox-search-clear-btn"
            >
              <Dismiss20Regular style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>
      </div>

      <section aria-label="New Dropbox entries" className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {[
            ['all', 'All entries', state.entries.length],
            ['unread', 'Since my last check', state.entries.filter(e => e.new_since_check).length],
            ['week', 'New in last 7 days', state.entries.filter(e => e.new_last_week).length],
          ].map(([value, label, count]) => (
            <button key={value} type="button" aria-pressed={activityFilter === value}
              onClick={() => setActivityFilter(value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${activityFilter === value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200'}`}>
              {label} ({state.loading ? '…' : count})
            </button>
          ))}
          <button type="button" onClick={markFolderChecked}
            disabled={checking || state.loading || !state.activity?.observed_at || state.path !== path}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50">
            {checking ? 'Saving…' : 'Mark this folder checked'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Flags apply to this folder. New means first detected after its initial scan; existing items start unflagged.
          Refresh to check for additions. Global search below is not filtered.
          {state.activity?.checked_at ? ` Last checked: ${new Date(state.activity.checked_at * 1000).toLocaleString()}.` : ''}
        </p>
        {state.activity?.error && <p role="alert" className="mt-2 text-sm text-amber-800">{state.activity.error}</p>}
      </section>

      {/* v58.13.132n6 — Global search results overlay. Renders only
          when the debounced search state is meaningful (query >= 3
          chars OR an in-flight/errored request from a prior query).
          Positioned inline BELOW the toolbar and ABOVE the folder
          listing so the user still sees their folder context while
          scanning search hits. */}
      {(search.query.trim().length >= 3 || search.loading) && (
        <DropboxSearchOverlay
          state={search}
          onClose={() => setSearch({ query: '', loading: false, results: [], error: null, hasMore: false })}
          onOpenFolder={(p) => {
            const parent = p.replace(/\/[^/]+$/, '') || ROOT_PATH;
            setPath(parent);
          }}
          onOpenFile={(entry) => {
            // Preview the file inline.  Navigation to its parent
            // folder is deliberately NOT triggered here — the user's
            // intent is "look at this file", not "leave my current
            // folder".
            setPreviewEntry(entry);
          }}
        />
      )}

      {selectedIds.size > 0 && (
        <div
          className="rounded-2xl border p-3 mb-4 flex items-center justify-between gap-3 flex-wrap"
          style={{ borderColor: DBX_BLUE, backgroundColor: '#0061FF0D' }}
          data-testid="dropbox-selection-toolbar"
        >
          <div className="text-sm font-semibold" style={{ color: DBX_BLUE }} data-testid="dropbox-selection-count">
            {selectedIds.size} selected
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={doBulkDownload}
              data-testid="dropbox-bulk-download-btn"
              className="inline-flex items-center gap-1.5 rounded-lg text-white text-xs font-semibold px-3 py-2 hover:brightness-110"
              style={{ backgroundColor: DBX_BLUE }}
            >
              <ArrowDownload20Regular style={{ width: 14, height: 14 }} />
              Download
            </button>
            <button
              type="button"
              onClick={() => setBulkDeleteConfirm(rows.filter((r) => selectedIds.has(r.path)))}
              data-testid="dropbox-bulk-delete-btn"
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-2"
            >
              <Delete20Regular style={{ width: 14, height: 14 }} />
              Delete
            </button>
            <button
              type="button"
              onClick={clearSelection}
              data-testid="dropbox-bulk-deselect-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2"
            >
              Deselect all
            </button>
          </div>
        </div>
      )}

      {/* Upload progress panel */}
      {uploads.length > 0 && (
        <UploadPanel uploads={uploads} onClear={() => setUploads([])} />
      )}

      {/* File list */}
      <div
        className={`rounded-2xl border ${dragOver ? 'bg-blue-50/40' : 'bg-white'} overflow-hidden`}
        style={dragOver ? { borderColor: DBX_BLUE } : { borderColor: '#e2e8f0' }}
        data-testid="dropbox-file-list"
      >
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="pl-4 w-10">
                <SelectAllCheckbox
                  visibleIds={rows.map((r) => r.path)}
                  selectedIds={selectedIds}
                  onToggle={toggleSelectAllVisible}
                />
              </th>
              <SortHeader label="Name" col="name" sortBy={sortBy} onClick={toggleSort} className="text-left" />
              <SortHeader label="Modified" col="modified" sortBy={sortBy} onClick={toggleSort} className="text-left w-56" />
              <SortHeader label="Size" col="size" sortBy={sortBy} onClick={toggleSort} className="text-right w-24" />
              <th className="w-16 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {state.loading && (
              <>
                {[0, 1, 2, 3].map((i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-4 bg-slate-100 rounded animate-pulse" />
                    </td>
                  </tr>
                ))}
              </>
            )}
            {!state.loading && state.error && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <div className="text-sm text-rose-600 font-medium mb-2" data-testid="dropbox-error">{state.error}</div>
                  <button
                    type="button"
                    onClick={refresh}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-1.5"
                  >
                    <ArrowClockwise20Regular style={{ width: 14, height: 14 }} />
                    Retry
                  </button>
                </td>
              </tr>
            )}
            {!state.loading && !state.error && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-500 text-sm" data-testid="dropbox-empty">
                  {activityFilter === 'all' ? 'This folder is empty. Upload a file or create a folder to get started.' : 'No new entries match this filter in this folder.'}
                </td>
              </tr>
            )}
            {!state.loading && !state.error && rows.map((e) => (
              <Row
                key={e.path}
                entry={e}
                selected={selectedIds.has(e.path)}
                onToggleSelect={() => toggleSelect(e)}
                onOpen={() => openEntry(e)}
                onPreview={() => openPreview(e)}
                onDelete={() => setConfirmDelete(e)}
                onDownload={() => downloadEntry(e)}
                onRename={() => setRenameFor({ entry: e, name: e.name })}
                onCopyPath={() => copyPath(e)}
                onMove={() => setMovePickerFor(e)}
                onShare={() => setShareFor(e)}
                onVersions={() => setVersionsFor(e)}
                folderCount={folderCounts[e.path]}
                /* `.132n5` — drag-drop MOVE wiring. */
                isDragging={draggingPaths.includes(e.path)}
                dragTarget={dragTarget}
                onRowDragStart={onRowDragStart}
                onRowDragEnd={onRowDragEnd}
                makeDropTargetHandlers={makeDropTargetHandlers}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirm delete modal */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)}>
          <div className="text-sm font-semibold text-slate-900 mb-2">
            Delete <span className="font-mono">{confirmDelete.name}</span>?
          </div>
          <p className="text-xs text-slate-600 mb-5 leading-relaxed">
            This removes {confirmDelete.type === 'folder' ? 'the folder AND everything inside it' : 'the file'} from Dropbox permanently. This action cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2"
              data-testid="dropbox-delete-cancel"
            >Cancel</button>
            <button
              type="button"
              onClick={() => doDelete(confirmDelete)}
              className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-3 py-2"
              data-testid="dropbox-delete-confirm"
            >Delete permanently</button>
          </div>
        </Modal>
      )}

      {/* mkdir modal */}
      {mkdirModal && (
        <Modal onClose={() => setMkdirModal(null)}>
          <div className="text-sm font-semibold text-slate-900 mb-3">New folder</div>
          <input
            autoFocus
            type="text"
            placeholder="Folder name"
            value={mkdirModal.name}
            onChange={(e) => setMkdirModal({ name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') doMkdir(mkdirModal.name); }}
            data-testid="dropbox-mkdir-input"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-slate-500 focus:outline-none text-sm mb-5"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setMkdirModal(null)}
              className="rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2"
            >Cancel</button>
            <button
              type="button"
              onClick={() => doMkdir(mkdirModal.name)}
              disabled={!mkdirModal.name.trim()}
              className="rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-2"
              data-testid="dropbox-mkdir-confirm"
            >Create</button>
          </div>
        </Modal>
      )}

      {dragOver && (
        <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-40">
          <div
            className="rounded-2xl text-white px-8 py-6 text-sm font-semibold shadow-2xl"
            style={{ backgroundColor: DBX_BLUE }}
          >
            Drop files to upload to <span className="font-mono">{path || TEAM_ROOT_LABEL}</span>
          </div>
        </div>
      )}

      {/* `.132n2c` — bulk delete confirm modal */}
      {bulkDeleteConfirm && (
        <Modal onClose={() => setBulkDeleteConfirm(null)}>
          <div className="text-sm font-semibold text-slate-900 mb-2">
            Delete {bulkDeleteConfirm.length} item{bulkDeleteConfirm.length === 1 ? '' : 's'}?
          </div>
          <p className="text-xs text-slate-600 mb-3 leading-relaxed">
            The following items will be permanently removed from Dropbox. This action cannot be undone.
          </p>
          <ul className="mb-5 max-h-40 overflow-y-auto text-xs text-slate-700 border border-slate-200 rounded-lg p-2 space-y-1"
              data-testid="dropbox-bulk-delete-list">
            {bulkDeleteConfirm.map((e) => (
              <li key={e.path} className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${e.type === 'folder' ? 'bg-slate-400' : 'bg-slate-300'}`} />
                <span className="font-mono truncate">{e.name}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-400">
                  {e.type}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setBulkDeleteConfirm(null)}
              className="rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2"
              data-testid="dropbox-bulk-delete-cancel"
            >Cancel</button>
            <button
              type="button"
              onClick={doBulkDelete}
              className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-2"
              data-testid="dropbox-bulk-delete-confirm"
            >Delete {bulkDeleteConfirm.length} permanently</button>
          </div>
        </Modal>
      )}

      {/* v58.13.132n2b — inline file preview modal. */}
      {previewEntry && (
        <FilePreviewModal
          entry={previewEntry}
          onClose={() => setPreviewEntry(null)}
        />
      )}

      {/* `.132n4a` — right details panel (single-click on file). */}
      {detailsEntry && !previewEntry && !movePickerFor && !versionsFor && !renameFor && !shareFor && (
        <DetailsPanel
          entry={detailsEntry}
          onClose={() => setDetailsEntry(null)}
          onPreview={openPreview}
          onDownload={downloadEntry}
          onRename={(e) => setRenameFor({ entry: e, name: e.name })}
          onCopyPath={copyPath}
          onMove={(e) => setMovePickerFor(e)}
          onShare={(e) => setShareFor(e)}
          onVersions={(e) => setVersionsFor(e)}
          onDelete={(e) => setConfirmDelete(e)}
        />
      )}

      {/* `.132n4b` — Share modal. */}
      {shareFor && (
        <ShareModal
          entry={shareFor}
          onClose={() => setShareFor(null)}
        />
      )}

      {/* `.132n5` — Floating "Move to <name>" tooltip that
          tracks the cursor while a drag is in flight over a
          valid or invalid target.  Positioned via mouseX/Y ref
          (updated in `onDragOver`); re-renders whenever
          `dragTarget` changes.  `position: fixed` + high z-index
          so it floats over every other surface. */}
      {dragTarget && draggingPaths.length > 0 && (
        <div
          className={`fixed z-[9999] pointer-events-none px-2.5 py-1.5 rounded-lg text-xs font-semibold shadow-lg ${
            dragTarget.valid
              ? 'bg-[#0061FF] text-white'
              : 'bg-rose-500 text-white'
          }`}
          style={{
            top: dragMousePos.current.y + 18,
            left: dragMousePos.current.x + 14,
          }}
          data-testid="dropbox-drag-tooltip"
        >
          {dragTarget.valid
            ? `Move to ${dragTarget.name || 'folder'}`
            : (dragTarget.reason || 'Cannot move here')}
        </div>
      )}

      {/* `.132n4a` — Move-picker modal. */}
      {movePickerFor && (
        <MovePickerModal
          entry={movePickerFor}
          onClose={() => setMovePickerFor(null)}
          onConfirm={() => {
            setMovePickerFor(null);
            setDetailsEntry(null);
            refresh();
          }}
        />
      )}

      {/* `.132n4a` — Version history drawer. */}
      {versionsFor && (
        <VersionHistoryDrawer
          entry={versionsFor}
          onClose={() => setVersionsFor(null)}
          onRestored={refresh}
        />
      )}

      {/* `.132n4a` — Rename dialog (compact inline modal). */}
      {renameFor && (
        <Modal onClose={() => setRenameFor(null)}>
          <div className="text-sm font-semibold text-slate-900 mb-3">
            Rename &ldquo;{renameFor.entry.name}&rdquo;
          </div>
          <input
            type="text"
            value={renameFor.name}
            onChange={(ev) => setRenameFor((s) => ({ ...s, name: ev.target.value }))}
            onKeyDown={(ev) => { if (ev.key === 'Enter') doRename(); }}
            className="w-full rounded-lg border border-slate-300 focus:border-slate-500 focus:outline-none px-3 py-2 text-sm mb-5"
            placeholder="New name"
            autoFocus
            data-testid="dropbox-rename-input"
          />
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setRenameFor(null)}
              className="rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2"
              data-testid="dropbox-rename-cancel">
              Cancel
            </button>
            <button
              type="button"
              onClick={doRename}
              className="rounded-lg text-white text-xs font-semibold px-3 py-2 hover:brightness-110"
              style={{ backgroundColor: DBX_BLUE }}
              data-testid="dropbox-rename-confirm"
            >
              Rename
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SortHeader({ label, col, sortBy, onClick, className }) {
  const active = sortBy.col === col;
  const Arrow = active && sortBy.dir === 'desc' ? ArrowDown20Regular : ArrowUp20Regular;
  return (
    <th className={`py-2.5 text-[11px] uppercase tracking-wider font-semibold text-slate-500 ${className}`}>
      <button
        type="button"
        onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1 hover:text-slate-800 ${active ? 'text-slate-900' : ''}`}
        data-testid={`dropbox-sort-${col}`}
      >
        {label}
        {active && <Arrow style={{ width: 12, height: 12 }} />}
      </button>
    </th>
  );
}

function SelectAllCheckbox({ visibleIds, selectedIds, onToggle }) {
  const ref = useRef(null);
  const total = visibleIds.length;
  const selectedInView = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = total > 0 && selectedInView === total;
  const someSelected = selectedInView > 0 && selectedInView < total;
  useEffect(() => {
    // Native tri-state via the `indeterminate` DOM property — no
    // equivalent JSX attribute, so we imperatively set it.
    if (ref.current) ref.current.indeterminate = someSelected;
  }, [someSelected]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allSelected}
      onChange={onToggle}
      disabled={total === 0}
      className="h-4 w-4 rounded border-slate-300 cursor-pointer disabled:opacity-30"
      style={{ accentColor: DBX_BLUE }}
      aria-label="Select all rows in this folder"
      data-testid="dropbox-select-all"
    />
  );
}

function Row({
  entry, selected, onToggleSelect, onOpen, onPreview, onDelete,
  onDownload, onRename, onCopyPath, onMove, onShare, onVersions, folderCount,
  /* `.132n5` — drag-drop MOVE props. */
  isDragging, dragTarget, onRowDragStart, onRowDragEnd, makeDropTargetHandlers,
}) {
  const Icon = iconFor(entry);
  // Folder rows accept drops from other in-app rows.  File rows
  // are only drag sources — files can't contain other files.
  const dropHandlers = entry.type === 'folder'
    ? makeDropTargetHandlers(entry.path, entry.name)
    : {};
  const isDropTarget = dragTarget?.path === entry.path;
  return (
    <tr
      draggable
      onDragStart={(ev) => onRowDragStart(entry, ev)}
      onDragEnd={onRowDragEnd}
      {...dropHandlers}
      className={`border-b border-slate-100 last:border-0 group transition-colors ${
        selected ? '' : 'hover:bg-[color:rgba(0,97,255,0.05)]'
      } ${isDragging ? 'opacity-40' : ''} ${
        isDropTarget
          ? (dragTarget.valid
              ? 'ring-2 ring-inset ring-[#0061FF] bg-[rgba(0,97,255,0.08)]'
              : 'ring-2 ring-inset ring-rose-500 bg-rose-50')
          : ''
      }`}
      style={selected && !isDropTarget ? { backgroundColor: 'rgba(0, 97, 255, 0.08)' } : undefined}
      data-testid={`dropbox-row-${entry.name}`}
    >
      <td className="pl-4 py-2.5 w-10">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-slate-300 cursor-pointer"
          style={{ accentColor: DBX_BLUE }}
          aria-label={`Select ${entry.name}`}
          data-testid={`dropbox-select-${entry.name}`}
        />
      </td>
      <td className="py-2.5">
        <button
          type="button"
          onClick={onOpen}
          onDoubleClick={entry.type === 'file' ? onPreview : undefined}
          className="inline-flex items-center gap-2.5 text-left"
          data-testid={`dropbox-open-${entry.name}`}
        >
          <Icon
            style={{ width: 20, height: 20, color: entry.type === 'folder' ? DBX_BLUE : undefined }}
            className={entry.type === 'folder' ? '' : 'text-slate-500'}
          />
          <span className="text-sm text-slate-800 font-medium hover:underline">{entry.name}</span>
          {entry.new_since_check && <span title="Added since you last marked this folder checked"
            className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">NEW</span>}
          {entry.new_last_week && <span title="First detected by Paneltec in the last seven days"
            className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">LAST 7 DAYS</span>}

          {/* `.132n4a` — folder file-count badge. Renders once the
              lazy `/count` fetch resolves. Nothing shown while
              loading (avoids a flash of "—" then a number). */}
          {entry.type === 'folder' && folderCount && folderCount.item_count != null && (
            <span
              className="ml-2 text-[10px] font-medium text-slate-500 bg-slate-100 rounded-full px-2 py-0.5"
              data-testid={`dropbox-folder-count-${entry.name}`}
            >
              {folderCount.item_count}
              {folderCount.is_partial ? '+' : ''} items
            </span>
          )}
        </button>
      </td>
      <td className="text-slate-600 text-xs whitespace-nowrap" data-testid={`dropbox-modified-${entry.name}`}>
        {formatModified(entry.modified)}
      </td>
      <td className="text-right text-slate-700 text-xs font-medium tabular-nums pr-2 whitespace-nowrap"
          data-testid={`dropbox-size-${entry.name}`}>
        {entry.type === 'file' ? formatSize(entry.size) : '—'}
      </td>
      <td className="pr-4 text-right">
        {/* `.132n4c` — visible at rest (opacity 50 %), full on
            row hover.  Blue tint applied on the button itself. */}
        <div className="inline-flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
          <RowActionMenu
            entry={entry}
            onOpen={entry.type === 'file' ? onPreview : onOpen}
            onDownload={onDownload}
            onRename={onRename}
            onCopyPath={onCopyPath}
            onMove={onMove}
            onShare={onShare}
            onVersions={onVersions}
            onDelete={onDelete}
          />
        </div>
      </td>
    </tr>
  );
}

function iconFor(entry) {
  if (entry.type === 'folder') return Folder24Regular;
  const ext = (entry.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return DocumentPdf24Regular;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return Image24Regular;
  if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext)) return Video24Regular;
  if (['xlsx', 'xls', 'csv'].includes(ext)) return DocumentTable24Regular;
  return Document24Regular;
}

function formatSize(bytes) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v < 10 && u > 0 ? 1 : 0)} ${units[u]}`;
}

function formatModified(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    // `.132n2c` — punchier format: "Sep 25, 2026 · 11:38 AM".
    // The middle dot separator makes date-vs-time scannable at a
    // glance. Uses the user's locale + timezone (no override —
    // Dropbox itself returns UTC ISO, the browser converts).
    const datePart = d.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    const timePart = d.toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit',
    });
    return `${datePart} · ${timePart}`;
  } catch { return iso; }
}

function UploadPanel({ uploads, onClear }) {
  const done = uploads.filter((u) => u.status === 'done').length;
  const errored = uploads.filter((u) => u.status === 'error').length;
  const active = uploads.filter((u) => u.status === 'uploading').length;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4" data-testid="dropbox-upload-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-slate-700">
          Uploads · {active} active · {done} done · {errored} errored
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-slate-500 hover:text-slate-800"
          data-testid="dropbox-upload-clear"
        >Clear</button>
      </div>
      <div className="space-y-2">
        {uploads.map((u, i) => (
          <div key={i} className="text-xs" data-testid={`dropbox-upload-${u.name}`}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="truncate flex-1 text-slate-700">{u.name}</span>
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${u.status === 'error' ? 'text-rose-600' : u.status === 'done' ? 'text-emerald-600' : 'text-slate-500'}`}>
                {u.status === 'error' ? 'Error' : u.status === 'done' ? 'Done' : `${u.progress}%`}
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${u.status === 'error' ? 'bg-rose-500' : u.status === 'done' ? 'bg-emerald-500' : ''}`}
                style={{
                  width: `${u.progress}%`,
                  backgroundColor: u.status === 'uploading' ? DBX_BLUE : undefined,
                }}
              />
            </div>
            {u.error && <div className="text-rose-600 mt-1">{u.error}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-700"
        >
          <Dismiss20Regular style={{ width: 18, height: 18 }} />
        </button>
        {children}
      </div>
    </div>
  );
}

// v58.13.132n6 — Dropbox global search results overlay.
//
// Rendered as an inline panel (not a modal) between the header
// toolbar and the folder listing.  Keeps folder context visible
// so the user knows where they are while scanning hits.  Match
// rows show:
//   · icon (extension-derived)
//   · filename with Dropbox's highlight spans bolded in DBX_BLUE
//   · full team-relative path (mono, muted)
//   · size + modified
//   · click → open preview (file) or navigate to parent (folder)
function DropboxSearchOverlay({ state, onClose, onOpenFolder, onOpenFile }) {
  const { query, loading, results, error, hasMore } = state;
  const q = (query || '').trim();

  return (
    <div
      className="rounded-2xl border bg-white overflow-hidden mb-4"
      style={{ borderColor: DBX_BLUE + '33' }}
      data-testid="dropbox-search-overlay"
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5 border-b"
        style={{ borderColor: DBX_BLUE + '22', backgroundColor: DBX_BLUE + '08' }}
      >
        <Search20Regular style={{ width: 14, height: 14, color: DBX_BLUE }} />
        <div className="text-xs font-semibold" style={{ color: DBX_BLUE }}
             data-testid="dropbox-search-overlay-heading">
          {loading
            ? <>Searching Dropbox for <span className="font-mono">{q}</span>…</>
            : error
              ? <>Search failed</>
              : results.length === 0
                ? <>No matches for <span className="font-mono">{q}</span></>
                : <>{results.length}{hasMore ? '+' : ''} matches for <span className="font-mono">{q}</span></>
          }
        </div>
        {hasMore && !loading && !error && (
          <div className="text-[11px] text-slate-500"
               data-testid="dropbox-search-overlay-hasmore">
            Type more to narrow — Dropbox truncated at 100.
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"
          aria-label="Close search"
          data-testid="dropbox-search-overlay-close-btn"
        >
          <Dismiss20Regular style={{ width: 14, height: 14 }} />
        </button>
      </div>

      <div className="max-h-96 overflow-auto">
        {loading && (
          <div className="px-4 py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-3"
               data-testid="dropbox-search-loading">
            <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
            <span>Querying Dropbox…</span>
          </div>
        )}
        {!loading && error && (
          <div className="px-4 py-4 text-xs text-rose-600" data-testid="dropbox-search-error">
            {error}
          </div>
        )}
        {!loading && !error && results.length === 0 && q.length >= 3 && (
          <div className="px-4 py-8 text-center text-xs text-slate-500"
               data-testid="dropbox-search-empty">
            No files, folders or content matched <span className="font-mono">{q}</span>.
            Try a broader term.
          </div>
        )}
        {!loading && !error && results.map((m, i) => (
          <SearchResultRow
            key={m.path + ':' + i}
            match={m}
            onFolder={() => onOpenFolder(m.path)}
            onFile={() => onOpenFile(m)}
            testid={`dropbox-search-result-row-${i}`}
          />
        ))}
      </div>
    </div>
  );
}

function SearchResultRow({ match, onFolder, onFile, testid }) {
  const Icon = iconFor(match);
  const isFolder = match.type === 'folder';
  return (
    <button
      type="button"
      onClick={isFolder ? onFolder : onFile}
      className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 text-left"
      data-testid={testid}
    >
      <Icon
        style={{ width: 20, height: 20, color: isFolder ? DBX_BLUE : '#64748b' }}
        className="shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-900 font-medium truncate"
             data-testid={`${testid}-name`}>
          <HighlightedText spans={match.highlights} fallback={match.name} />
        </div>
        <div className="text-[11px] text-slate-500 font-mono truncate">
          {match.path}
        </div>
      </div>
      <div className="text-[11px] text-slate-500 shrink-0 text-right w-32">
        <div>{isFolder ? 'Folder' : formatSize(match.size)}</div>
        <div className="text-slate-400">{formatModified(match.modified)}</div>
      </div>
    </button>
  );
}

// Render Dropbox's `highlight_spans` with matched spans bolded in
// the brand blue.  `spans` is `[{text, highlighted}]`; empty or
// missing spans fall back to the plain filename.
function HighlightedText({ spans, fallback }) {
  if (!Array.isArray(spans) || spans.length === 0) {
    return <>{fallback}</>;
  }
  return (
    <>
      {spans.map((s, i) => s.highlighted
        ? <span key={i} className="font-semibold" style={{ color: DBX_BLUE }}>{s.text}</span>
        : <span key={i}>{s.text}</span>
      )}
    </>
  );
}

