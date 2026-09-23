// v58.13.132mb — Admin toolbar for a folder in the Document Library.
//
// Sits above the file table on the folder-detail page. Exposes the
// Phase 1 endpoints that don't fit cleanly on a per-row menu:
//
//   · Upload folder  → POST /document-library/folders/{id}/upload-tree
//                       (multipart; native `<input webkitdirectory>` walks
//                        the tree client-side, POST includes files[] +
//                        paths[] side-by-side so backend re-nests).
//   · Bulk actions   → dropdown, enabled only when files are selected:
//                       — Download selected as ZIP
//                       — Hard-delete selected (goes through
//                         HardDeleteModal, one at a time)
//   · Folder ZIP     → GET /document-library/folders/{id}/download-zip
//                       (server streams a recursive zip)
//
// Selection state is owned by the parent — the table renders the
// checkbox column, this toolbar just consumes `selectedIds`.
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArchiveIcon,
  FolderUp,
  Loader2,
  Trash2,
  Download,
  ChevronDown,
} from 'lucide-react';
import api, { apiError, API_BASE } from '../../lib/api';
import { getToken } from '../../lib/auth';

// Walk a DataTransferItemList (browser-native folder drop) into an
// array of File objects with `.webkitRelativePath` populated so we
// can reuse the same upload code path for drop + directory picker.
async function walkDataTransferItems(items) {
  const files = [];

  async function walkEntry(entry, prefix) {
    if (!entry) return;
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      // The browser's File doesn't let us mutate webkitRelativePath,
      // so we tag the path onto a side property + rely on the caller
      // to read it via `getRelativePath` below.
      files.push({ file: f, relativePath: `${prefix}${f.name}` });
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries is chunked (100 per call in Chrome) — loop until empty.
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const batch = await new Promise((res) => reader.readEntries(res));
        if (!batch.length) break;
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(batch.map((e) => walkEntry(e, `${prefix}${entry.name}/`)));
      }
    }
  }

  const promises = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) promises.push(walkEntry(entry, ''));
  }
  await Promise.all(promises);
  return files;
}

export default function FolderAdminToolbar({
  folder,
  selectedIds = [],
  onClearSelection,
  onUploaded,
  onHardDeleteFile,   // (fileId, filename) => void — parent opens confirm modal
  droppedItems,       // DataTransferItemList captured by parent's drop handler
  onDroppedItemsConsumed,
}) {
  const dirInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const selectionCount = selectedIds.length;

  const uploadTree = async (entries) => {
    // entries: [{file, relativePath}]
    if (!entries.length) return;
    setUploading(true);
    const form = new FormData();
    for (const e of entries) {
      form.append('files', e.file, e.file.name);
      form.append('paths', e.relativePath);
    }
    try {
      const { data } = await api.post(
        `/document-library/folders/${folder.id}/upload-tree`,
        form,
      );
      const okCount = data?.saved?.length ?? entries.length;
      const rejected = data?.rejected || [];
      if (okCount) toast.success(`${okCount} file${okCount === 1 ? '' : 's'} uploaded (tree preserved)`);
      rejected.forEach((r) => toast.error(`${r.filename || r.path}: ${r.reason}`));
      onUploaded?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setUploading(false); }
  };

  const onDirInputChange = (e) => {
    const list = Array.from(e.target.files || []);
    // Native directory picker sets webkitRelativePath already.
    const entries = list.map((f) => ({
      file: f,
      relativePath: f.webkitRelativePath || f.name,
    }));
    e.target.value = '';
    uploadTree(entries);
  };

  // v58.13.132mb — Consume the parent's captured DataTransferItemList
  // (folder-aware drop) when it changes. The parent's onDrop should
  // set `droppedItems` and null it out via onDroppedItemsConsumed.
  React.useEffect(() => {
    if (!droppedItems) return;
    (async () => {
      try {
        const entries = await walkDataTransferItems(droppedItems);
        if (entries.length) await uploadTree(entries);
      } finally {
        onDroppedItemsConsumed?.();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedItems]);

  const downloadFolderZip = async () => {
    const t = toast.loading(`Preparing "${folder.name}" as ZIP…`);
    try {
      const res = await fetch(
        `${API_BASE}/document-library/folders/${folder.id}/download-zip`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folder.name || 'folder'}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Folder ZIP downloaded', { id: t });
    } catch (e) { toast.error(e.message || 'ZIP download failed', { id: t }); }
  };

  const downloadSelectedZip = async () => {
    setBulkOpen(false);
    if (!selectionCount) return;
    const t = toast.loading(`Preparing ${selectionCount} file${selectionCount === 1 ? '' : 's'} as ZIP…`);
    try {
      const res = await fetch(
        `${API_BASE}/document-library/download/bulk`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ file_ids: selectedIds }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folder.name || 'files'}-selection.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${selectionCount} file${selectionCount === 1 ? '' : 's'} downloaded`, { id: t });
      onClearSelection?.();
    } catch (e) { toast.error(e.message || 'ZIP download failed', { id: t }); }
  };

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      data-testid="folder-admin-toolbar"
    >
      <input
        type="file"
        ref={dirInputRef}
        multiple
        // Non-standard but supported in all modern browsers.
        // eslint-disable-next-line react/no-unknown-property
        webkitdirectory=""
        // eslint-disable-next-line react/no-unknown-property
        directory=""
        onChange={onDirInputChange}
        style={{ display: 'none' }}
        data-testid="folder-upload-tree-input"
      />
      <button
        type="button"
        onClick={() => dirInputRef.current?.click()}
        disabled={uploading}
        data-testid="folder-upload-tree-btn"
        className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <FolderUp size={14} />}
        Upload folder
      </button>

      <button
        type="button"
        onClick={downloadFolderZip}
        data-testid="folder-download-zip-btn"
        className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
      >
        <ArchiveIcon size={14} /> Download folder as ZIP
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setBulkOpen((v) => !v)}
          disabled={selectionCount === 0}
          data-testid="folder-bulk-actions-btn"
          className={`px-3 py-2 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 ${
            selectionCount === 0
              ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
              : 'border-brand-blue bg-brand-blue text-white hover:bg-brand-blue-dark'
          }`}
        >
          Bulk actions {selectionCount > 0 && `· ${selectionCount}`}
          <ChevronDown size={14} />
        </button>
        {bulkOpen && selectionCount > 0 && (
          <div
            className="absolute z-20 mt-1 w-56 bg-white rounded-lg border border-slate-200 shadow-xl overflow-hidden"
            data-testid="folder-bulk-actions-menu"
          >
            <button
              type="button"
              onClick={downloadSelectedZip}
              data-testid="folder-bulk-download-zip"
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
            >
              <Download size={14} /> Download selected as ZIP
            </button>
            <button
              type="button"
              onClick={() => {
                setBulkOpen(false);
                selectedIds.forEach((id) => {
                  const nm = document
                    .querySelector(`[data-testid="file-row-${id}"] [data-file-name]`)
                    ?.getAttribute('data-file-name') || id;
                  onHardDeleteFile?.(id, nm);
                });
              }}
              data-testid="folder-bulk-hard-delete"
              className="w-full text-left px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1.5 border-t border-slate-100"
            >
              <Trash2 size={14} /> Permanently delete selected
            </button>
          </div>
        )}
      </div>

      {selectionCount > 0 && (
        <button
          type="button"
          onClick={onClearSelection}
          data-testid="folder-selection-clear"
          className="text-xs text-slate-500 hover:text-slate-800 underline"
        >
          Clear selection
        </button>
      )}
    </div>
  );
}
