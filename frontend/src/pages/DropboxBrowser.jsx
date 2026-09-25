// v58.13.132n2 — Dropbox in-app file browser page.
//
// Replaces the external-tab launcher from `.132n0`. Renders at
// `/app/dropbox` (gated on `integrations.view` via the sidebar
// entry + a route-level guard here for deep-links). Talks to
// `/api/dropbox/browse` — see `backend/dropbox_browse.py`.
//
// Phase A + B scope (this ship):
//   · list folder (breadcrumb, sortable columns)
//   · download file (opens temporary link in new tab)
//   · upload file (button + drag-drop, chunked >150MB server-side)
//   · new folder
//   · delete (with confirm)
//   · client-side filter box
//
// Phase C deferred: rename, move, previews, server-side search,
// tags/comments.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useCan } from '@/lib/permissions';
import { PageHeader } from '@/components/capture/Ui';
import {
  Folder24Regular, Document24Regular, DocumentPdf24Regular,
  Image24Regular, Video24Regular, DocumentTable24Regular,
  ArrowUpload20Regular, FolderAdd20Regular, ArrowClockwise20Regular,
  ArrowDownload20Regular, Delete20Regular, Search20Regular,
  ChevronRight16Regular, Dismiss20Regular, ArrowUp20Regular, ArrowDown20Regular,
} from '@fluentui/react-icons';

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
    try {
      const { data } = await api.get('/dropbox/browse/download', { params: { path: e.path } });
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(`Download failed: ${apiError(err)}`);
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
            {crumbs.map((c, i) => (
              <React.Fragment key={c.path}>
                {i > 0 && <ChevronRight16Regular className="text-slate-400" style={{ width: 14, height: 14 }} />}
                <button
                  type="button"
                  onClick={() => setPath(c.path)}
                  className={`px-2 py-1 rounded-md hover:bg-slate-100 ${i === crumbs.length - 1 ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
                  data-testid={`dropbox-crumb-${i}`}
                >
                  {c.label}
                </button>
              </React.Fragment>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropbox-upload-btn"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-2"
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2"
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

      {/* Upload progress panel */}
      {uploads.length > 0 && (
        <UploadPanel uploads={uploads} onClear={() => setUploads([])} />
      )}

      {/* File list */}
      <div
        className={`rounded-2xl border ${dragOver ? 'border-blue-400 bg-blue-50/40' : 'border-slate-200 bg-white'} overflow-hidden`}
        data-testid="dropbox-file-list"
      >
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <SortHeader label="Name" col="name" sortBy={sortBy} onClick={toggleSort} className="pl-4 text-left" />
              <SortHeader label="Modified" col="modified" sortBy={sortBy} onClick={toggleSort} className="text-left w-52" />
              <SortHeader label="Size" col="size" sortBy={sortBy} onClick={toggleSort} className="text-right w-28" />
              <th className="w-16 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {state.loading && (
              <>
                {[0, 1, 2, 3].map((i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td colSpan={4} className="px-4 py-3">
                      <div className="h-4 bg-slate-100 rounded animate-pulse" />
                    </td>
                  </tr>
                ))}
              </>
            )}
            {!state.loading && state.error && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center">
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
                <td colSpan={4} className="px-4 py-12 text-center text-slate-500 text-sm" data-testid="dropbox-empty">
                  {filter
                    ? <>No items match <strong>{filter}</strong>.</>
                    : <>This folder is empty. Upload a file or create a folder to get started.</>}
                </td>
              </tr>
            )}
            {!state.loading && !state.error && rows.map((e) => (
              <Row key={e.path} entry={e} onOpen={() => openEntry(e)} onDelete={() => setConfirmDelete(e)} />
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
          <div className="rounded-2xl bg-blue-600 text-white px-8 py-6 text-sm font-semibold shadow-2xl">
            Drop files to upload to <span className="font-mono">{path || TEAM_ROOT_LABEL}</span>
          </div>
        </div>
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

function Row({ entry, onOpen, onDelete }) {
  const Icon = iconFor(entry);
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 group" data-testid={`dropbox-row-${entry.name}`}>
      <td className="pl-4 py-2.5">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-2.5 text-left hover:text-blue-700"
          data-testid={`dropbox-open-${entry.name}`}
        >
          <Icon style={{ width: 20, height: 20 }} className={entry.type === 'folder' ? 'text-blue-500' : 'text-slate-500'} />
          <span className="text-sm text-slate-800 group-hover:text-blue-700">{entry.name}</span>
        </button>
      </td>
      <td className="text-slate-500 text-xs">{formatModified(entry.modified)}</td>
      <td className="text-right text-slate-500 text-xs pr-2">
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
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
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
                className={`h-full transition-all ${u.status === 'error' ? 'bg-rose-500' : u.status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                style={{ width: `${u.progress}%` }}
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
