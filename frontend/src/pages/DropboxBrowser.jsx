// v58.13.132n2 — Dropbox in-app file browser page.
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
//
// Phase A + B scope (this ship):
//   · list folder (breadcrumb, sortable columns)
//   · download file (opens temporary link in new tab)
//   · inline preview (`.132n2b`, per-type dispatch)
//   · upload file (button + drag-drop, chunked >150MB server-side)
//   · new folder
//   · delete (with confirm)
//   · bulk select + bulk download / bulk delete (`.132n2c`)
//   · client-side filter box
//
// Phase C deferred: rename, move, server-side search,
// tags/comments, folder-zip bulk download.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useCan } from '@/lib/permissions';
import { PageHeader } from '@/components/capture/Ui';
import FilePreviewModal from '@/components/dropbox/FilePreviewModal';
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
  const [filter, setFilter] = useState('');
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
  const fileInputRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!allowed) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await api.get('/dropbox/browse', { params: { path } });
      setState({ loading: false, error: null, entries: data.entries || [] });
    } catch (e) {
      setState({ loading: false, error: apiError(e), entries: [] });
    }
  }, [path, allowed]);

  useEffect(() => { refresh(); }, [refresh]);

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
    const f = filter.trim().toLowerCase();
    let out = state.entries.filter((e) =>
      !f || e.name.toLowerCase().includes(f)
    );
    // Folders first, then by chosen column.
    out = [...out].sort((a, b) => {
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
  }, [state.entries, filter, sortBy]);

  const toggleSort = (col) => setSortBy((s) => ({
    col,
    dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc',
  }));

  const openEntry = async (e) => {
    if (e.type === 'folder') {
      setPath(e.path);
      return;
    }
    // `.132n2b` — file click opens the inline preview modal.
    // The modal itself handles per-type rendering + a Download
    // button (which routes back to the same /download temp-link
    // endpoint the pre-`.132n2b` flow used).
    setPreviewEntry(e);
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
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={(e) => {
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
              className="mr-1 p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ArrowLeft20Regular style={{ width: 16, height: 16 }} />
            </button>
            {crumbs.map((c, i) => {
              const isActive = i === crumbs.length - 1;
              return (
                <React.Fragment key={c.path}>
                  {i > 0 && <ChevronRight16Regular className="text-slate-400" style={{ width: 14, height: 14 }} />}
                  <button
                    type="button"
                    onClick={() => setPath(c.path)}
                    className={`px-2 py-1 rounded-md hover:bg-slate-100 ${isActive ? 'font-semibold text-slate-900 border-b-2' : 'text-slate-600 border-b-2 border-transparent'}`}
                    style={isActive ? { borderColor: DBX_BLUE } : undefined}
                    data-testid={`dropbox-crumb-${i}`}
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
          <Search20Regular className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" style={{ width: 14, height: 14 }} />
          <input
            type="text"
            placeholder="Filter this folder…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            data-testid="dropbox-filter-input"
            className="w-full max-w-md pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-slate-400 focus:outline-none text-sm"
          />
        </div>
      </div>

      {/* `.132n2c` — selection toolbar (only when >=1 row selected) */}
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
                  {filter
                    ? <>No items match <strong>{filter}</strong>.</>
                    : <>This folder is empty. Upload a file or create a folder to get started.</>}
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
                onDelete={() => setConfirmDelete(e)}
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

function Row({ entry, selected, onToggleSelect, onOpen, onDelete }) {
  const Icon = iconFor(entry);
  return (
    <tr
      className={`border-b border-slate-100 last:border-0 group transition-colors ${selected ? '' : 'hover:bg-[color:rgba(0,97,255,0.05)]'}`}
      style={selected ? { backgroundColor: 'rgba(0, 97, 255, 0.08)' } : undefined}
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
          className="inline-flex items-center gap-2.5 text-left"
          data-testid={`dropbox-open-${entry.name}`}
        >
          <Icon
            style={{ width: 20, height: 20, color: entry.type === 'folder' ? DBX_BLUE : undefined }}
            className={entry.type === 'folder' ? '' : 'text-slate-500'}
          />
          <span className="text-sm text-slate-800 font-medium hover:underline">{entry.name}</span>
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
        <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {entry.type === 'file' && (
            <button
              type="button"
              onClick={onOpen}
              title="Download"
              data-testid={`dropbox-download-${entry.name}`}
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100"
            >
              <ArrowDownload20Regular style={{ width: 16, height: 16 }} />
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            title="Delete"
            data-testid={`dropbox-delete-${entry.name}`}
            className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
          >
            <Delete20Regular style={{ width: 16, height: 16 }} />
          </button>
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
