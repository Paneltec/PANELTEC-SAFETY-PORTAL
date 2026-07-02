// Document Library — folder list + folder detail view.
//
// Phase 1 ships: list folders (seeded default 46), create/rename/delete folder,
// folder detail page with file picker upload (multi-file), paste-to-upload from
// clipboard, file list, download, delete, and a basic Smart Search stub.
//
// MOCKED: "AI Smart Search" is a Mongo regex hit on filename + ai_tags. True
// semantic RAG is deferred to a future phase.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, ClipboardPaste, FileSpreadsheet, FileText, FolderOpen, Image as ImageIcon, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError, API_BASE } from '../lib/api';
import { getToken, getUser } from '../lib/auth';
import { stashInlinePdf } from '../lib/pdfStash';
import {
  PageHeader, GhostButton, PrimaryButton, EmptyState, BackButton,
} from '../components/capture/Ui';
import PdfPreviewModal, { isPdfPreviewable } from '../components/PdfPreviewModal';

// Phase 3.20 Wave 2 — lucide row-action/toolbar icons swapped
// to @fluentui/react-icons. Aliased back to the original lucide
// names so existing JSX call sites don't need to change.
import {
  Add20Regular as Plus,
  ArrowDownload20Regular as Download,
  ArrowUpload20Regular as Upload,
  Delete20Regular as Trash2,
  Edit20Regular as Pencil,
  Eye20Regular as Eye,
  Search20Regular as Search,
} from '@fluentui/react-icons';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);
const DELETE_FOLDER_ROLES = new Set(['admin']);

const PASTEL_BG = {
  mint: 'bg-[#e8f3eb]', sky: 'bg-[#e6eff9]', peach: 'bg-[#fbeadf]',
  blush: 'bg-[#fbe4e7]', lavender: 'bg-[#ece6f4]', butter: 'bg-[#fbf3df]',
  sage: 'bg-[#e8efe2]', coral: 'bg-[#fbe4dc]', lilac: 'bg-[#efe7f7]',
  slate: 'bg-slate-100',
};
const PASTEL_ICON = {
  mint: 'text-[#1f7a3f]', sky: 'text-[#1e4a8c]', peach: 'text-[#a8480f]',
  blush: 'text-[#a8324c]', lavender: 'text-[#4f3a8c]', butter: 'text-[#8c6a1a]',
  sage: 'text-[#2e5e2e]', coral: 'text-[#a83a2e]', lilac: 'text-[#6e3aa6]',
  slate: 'text-slate-600',
};

function fileIcon(mime, size = 18) {
  if (!mime) return <FileText size={size} />;
  if (mime.startsWith('image/')) return <ImageIcon size={size} />;
  if (mime.includes('pdf')) return <FileText size={size} />;
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return <FileSpreadsheet size={size} />;
  return <FileText size={size} />;
}

function humanSize(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ────────────────────── Subfolder card with edit/delete ──────────────────────
function SubfolderCard({ sf, canEdit, onOpen, onChanged }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(sf.name);
  const [busy, setBusy] = useState(false);

  const saveRename = async () => {
    const next = name.trim();
    if (!next || next === sf.name) { setRenaming(false); setName(sf.name); return; }
    setBusy(true);
    try {
      await api.patch(`/document-library/folders/${sf.id}`, { name: next });
      sf.name = next;
      toast.success('Folder renamed');
      setRenaming(false);
      onChanged?.();
    } catch (e) { toast.error(apiError(e)); setName(sf.name); }
    finally { setBusy(false); }
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    const fileLine = sf.file_count
      ? `\n\nThis will also delete the ${sf.file_count} file${sf.file_count === 1 ? '' : 's'} inside it.`
      : '';
    if (!window.confirm(`Delete folder "${sf.name}"?${fileLine}`)) return;
    setBusy(true);
    try {
      await api.delete(`/document-library/folders/${sf.id}`);
      toast.success(`Deleted "${sf.name}"`);
      onChanged?.();
    } catch (err) { toast.error(apiError(err)); }
    finally { setBusy(false); }
  };

  if (renaming) {
    return (
      <div className="p-3 bg-white border border-[#b9d2ec] rounded-xl" data-testid={`subfolder-rename-${sf.id}`}>
        <input autoFocus value={name} maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
            else if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); setName(sf.name); }
          }}
          data-testid={`subfolder-rename-input-${sf.id}`}
          className="w-full px-2 py-1.5 text-sm font-semibold border border-slate-300 rounded bg-white" />
        <div className="text-[10px] text-slate-500 mt-1">Press Enter to save · Esc to cancel</div>
      </div>
    );
  }

  return (
    <div className="group relative flex items-center gap-3 p-3 bg-white border border-slate-200 hover:border-brand-blue/40 hover:bg-brand-blue-soft/20 rounded-xl transition"
      data-testid={`subfolder-${sf.id}`}>
      <button onClick={onOpen} disabled={busy}
        className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:opacity-60">
        <div className="rounded-lg bg-[#e6eff9] p-2.5 shrink-0"><FolderOpen size={16} className="text-[#1e4a8c]" /></div>
        <div className="min-w-0 flex-1 pr-12">
          <div className="text-sm font-semibold text-slate-900 truncate">{sf.name}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{sf.file_count} {sf.file_count === 1 ? 'file' : 'files'}</div>
        </div>
      </button>
      {canEdit && !sf.is_system && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); setRenaming(true); }} disabled={busy}
            data-testid={`subfolder-rename-${sf.id}`}
            title="Rename folder" aria-label="Rename folder"
            className="w-7 h-7 rounded-md bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200 flex items-center justify-center">
            <Pencil />
          </button>
          <button onClick={handleDelete} disabled={busy}
            data-testid={`subfolder-delete-${sf.id}`}
            title="Delete folder" aria-label="Delete folder"
            className="w-7 h-7 rounded-md bg-white text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 flex items-center justify-center">
            <Trash2 />
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────── Folder list page ──────────────────────

export default function DocumentLibrary() {
  const navigate = useNavigate();
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);
  const canDeleteFolder = DELETE_FOLDER_ROLES.has(user?.role);

  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Smart Search state
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchBusy, setSearchBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/document-library/folders')
      .then((r) => setFolders(r.data || []))
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, filter]);

  const startCreate = () => { setCreating(true); setNewName(''); };
  const startRename = (f) => { setRenamingId(f.id); setNewName(f.name); };
  const cancelEdit = () => { setCreating(false); setRenamingId(null); setNewName(''); };

  const saveCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api.post('/document-library/folders', { name: newName.trim() });
      toast.success('Folder created');
      cancelEdit();
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const saveRename = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api.patch(`/document-library/folders/${renamingId}`, { name: newName.trim() });
      toast.success('Folder renamed');
      cancelEdit();
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const deleteFolder = async (f) => {
    try {
      await api.delete(`/document-library/folders/${f.id}`);
      toast.success(`"${f.name}" deleted`);
      setConfirmDeleteId(null);
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const runSearch = async (e) => {
    e?.preventDefault();
    const q = searchQ.trim();
    if (!q) { setSearchResults(null); return; }
    setSearchBusy(true);
    try {
      const { data } = await api.get('/document-library/search', { params: { q } });
      setSearchResults(data);
    } catch (err) {
      toast.error(apiError(err));
    } finally { setSearchBusy(false); }
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="document-library-page">
      <PageHeader
        crumb="Compliance / Document Library"
        title="Document Library"
        subtitle="All your Risk & Compliance documents, organised and AI-tagged."
      />

      {/* AI Smart Search panel */}
      <form onSubmit={runSearch}
        className="mb-6 rounded-2xl border border-[#e6d99c] bg-[#fbf3df] p-4"
        data-testid="smart-search-panel">
        <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-[0.16em] font-semibold text-[#8c6a1a]">
          <Sparkles size={12} /> AI Smart Search
        </div>
        <div className="flex gap-2 items-stretch">
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="e.g. 'PPE requirements for working at heights'"
            data-testid="smart-search-input"
            className="flex-1 px-3 py-2 text-sm bg-white border border-[#e6d99c] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e6d99c]/60"
          />
          <button type="submit" disabled={searchBusy} data-testid="smart-search-submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#8c6a1a] text-white text-sm font-medium hover:bg-[#6f5314] disabled:opacity-60">
            {searchBusy ? <Loader2 size={14} className="animate-spin" /> : <Search />} Search
          </button>
          {searchResults && (
            <button type="button" onClick={() => { setSearchQ(''); setSearchResults(null); }}
              data-testid="smart-search-clear"
              className="px-3 py-2 rounded-lg border border-[#e6d99c] text-[#8c6a1a] text-sm hover:bg-white">
              Clear
            </button>
          )}
        </div>
        {searchResults && (
          <div className="mt-3" data-testid="smart-search-results">
            <div className="text-xs text-[#8c6a1a] mb-2">
              {searchResults.count} match{searchResults.count === 1 ? '' : 'es'} for &ldquo;{searchResults.query}&rdquo;
            </div>
            {searchResults.results.length === 0 ? (
              <div className="text-sm text-slate-500 italic">No files found.</div>
            ) : (
              <ul className="space-y-1 max-h-60 overflow-auto">
                {searchResults.results.map((r) => (
                  <li key={r.id} className="bg-white rounded-lg border border-[#f0e6c6] px-3 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.filename}</div>
                      <div className="text-xs text-slate-500">
                        in <Link to={`/app/document-library/${r.folder?.id || ''}`} className="hover:underline">
                          {r.folder?.name || 'Unknown folder'}
                        </Link>
                        {' · '}{humanSize(r.size)}
                      </div>
                    </div>
                    <Link to={`/app/document-library/${r.folder?.id || ''}`}
                      className="text-xs text-[#8c6a1a] hover:underline shrink-0">Open →</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>

      {/* Toolbar */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter folders…"
            data-testid="folder-filter-input"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
          />
        </div>
        {canEdit && (
          <button onClick={startCreate} data-testid="folder-create-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600">
            <Plus /> New folder
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-4 rounded-xl border border-brand-blue/40 bg-white p-3 flex items-center gap-2" data-testid="folder-create-form">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveCreate(); if (e.key === 'Escape') cancelEdit(); }}
            placeholder="Folder name" maxLength={80}
            data-testid="folder-create-input"
            className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg" />
          <PrimaryButton onClick={saveCreate} busy={busy} testid="folder-create-save">Create</PrimaryButton>
          <GhostButton onClick={cancelEdit} testid="folder-create-cancel">Cancel</GhostButton>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading folders…</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No folders match that filter"
          body={filter ? `Try a different keyword — there are ${folders.length} folders in total.` : 'Create your first document folder to get started.'}
          action={canEdit && !filter ? (
            <button onClick={startCreate} data-testid="folder-empty-create"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium">
              <Plus /> New folder
            </button>
          ) : null} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="folder-grid">
          {filtered.map((f) => (
            renamingId === f.id ? (
              <div key={f.id} className={`rounded-xl border border-brand-blue/40 ${PASTEL_BG[f.color_key] || PASTEL_BG.sky} p-3 flex flex-col gap-2`}
                data-testid={`folder-rename-${f.id}`}>
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') cancelEdit(); }}
                  maxLength={80}
                  data-testid={`folder-rename-input-${f.id}`}
                  className="w-full px-2 py-1 text-sm border border-slate-300 rounded bg-white" />
                <div className="flex gap-1">
                  <button onClick={saveRename} disabled={busy} data-testid={`folder-rename-save-${f.id}`}
                    className="flex-1 px-2 py-1 rounded bg-brand-blue text-white text-xs font-medium hover:bg-blue-600 disabled:opacity-60 inline-flex items-center justify-center gap-1">
                    {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
                  </button>
                  <button onClick={cancelEdit} className="px-2 py-1 rounded border border-slate-300 bg-white text-xs">Cancel</button>
                </div>
              </div>
            ) : (
              <div key={f.id} className={`group relative rounded-xl border border-slate-200 ${PASTEL_BG[f.color_key] || PASTEL_BG.sky} hover:shadow-md transition-shadow`}
                data-testid={`folder-card-${f.id}`}>
                <button
                  onClick={() => navigate(`/app/document-library/${f.id}`)}
                  className="w-full text-left p-4"
                >
                  <FolderOpen size={28} className={`${PASTEL_ICON[f.color_key] || PASTEL_ICON.sky} mb-2`} />
                  <div className="font-display font-semibold text-sm text-slate-900 line-clamp-2 leading-snug min-h-[2.5rem]">{f.name}</div>
                  <div className="text-xs text-slate-500 mt-1.5">
                    {f.file_count} {f.file_count === 1 ? 'file' : 'files'}
                  </div>
                </button>
                {canEdit && !f.is_system && confirmDeleteId !== f.id && (
                  <div className="hidden group-hover:flex absolute top-1.5 right-1.5 gap-0.5">
                    <button onClick={() => startRename(f)} data-testid={`folder-rename-btn-${f.id}`}
                      title="Rename"
                      className="p-1.5 rounded bg-white/90 border border-slate-200 text-slate-500 hover:text-brand-blue hover:bg-white">
                      <Pencil />
                    </button>
                    {canDeleteFolder && (
                      <button onClick={() => setConfirmDeleteId(f.id)} data-testid={`folder-delete-btn-${f.id}`}
                        title="Delete"
                        className="p-1.5 rounded bg-white/90 border border-slate-200 text-slate-500 hover:text-brand-red hover:bg-white">
                        <X size={11} />
                      </button>
                    )}
                  </div>
                )}
                {canEdit && confirmDeleteId === f.id && (
                  <div className="absolute inset-x-1.5 top-1.5 flex items-center justify-between gap-1 bg-[#fbe4e7] border border-[#e69aa3] rounded px-2 py-1"
                    data-testid={`folder-delete-confirm-${f.id}`}>
                    <span className="text-[10px] font-semibold text-[#7a1f33] uppercase tracking-wider">Delete?</span>
                    <div className="flex gap-0.5">
                      <button onClick={() => deleteFolder(f)} data-testid={`folder-delete-confirm-yes-${f.id}`}
                        className="p-1 rounded text-[#7a1f33] hover:bg-white"><Check size={11} /></button>
                      <button onClick={() => setConfirmDeleteId(null)} data-testid={`folder-delete-confirm-no-${f.id}`}
                        className="p-1 rounded text-slate-500 hover:bg-white"><X size={11} /></button>
                    </div>
                  </div>
                )}
                {f.is_system && (
                  <span className="absolute top-1.5 right-1.5 text-[9px] uppercase tracking-wider font-semibold text-slate-500 bg-white/80 px-1.5 py-0.5 rounded">System</span>
                )}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────── Folder detail page ──────────────────────

export function DocumentLibraryFolder() {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);

  const [folder, setFolder] = useState(null);
  const [subfolders, setSubfolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const loadFolder = useCallback(async () => {
    try {
      // Fetch folder + its child folders via the subfolders endpoint so this
      // works for both root folders and per-worker certification subfolders.
      const { data } = await api.get(`/document-library/folders/${folderId}/subfolders`);
      setFolder(data?.parent || null);
      setSubfolders(data?.children || []);
    } catch (e) {
      toast.error(apiError(e));
      navigate('/app/document-library');
    }
  }, [folderId, navigate]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/document-library/folders/${folderId}/files`);
      setFiles(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  }, [folderId]);

  useEffect(() => { loadFolder(); loadFiles(); }, [loadFolder, loadFiles]);

  const uploadFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    const form = new FormData();
    for (const f of fileList) form.append('files', f);
    try {
      const { data } = await api.post(
        `/document-library/folders/${folderId}/files`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const okCount = (data.saved || []).length;
      const rejected = data.rejected || [];
      if (okCount) toast.success(`${okCount} file${okCount === 1 ? '' : 's'} uploaded`);
      rejected.forEach((r) => toast.error(`${r.filename}: ${r.reason}`));
      await loadFiles();
    } catch (e) {
      toast.error(apiError(e));
    } finally { setUploading(false); }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    if (e.dataTransfer.files?.length) uploadFiles(Array.from(e.dataTransfer.files));
  };

  // Clipboard paste handler — paste any file (image screenshots, files copied
  // from Finder/Explorer) and upload them straight to this folder.
  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const pasted = [];
      for (const it of items) {
        if (it.kind === 'file') {
          const file = it.getAsFile();
          if (!file) continue;
          // Re-name pasted clipboard images (which arrive as "image.png") to a
          // unique timestamped name so they don't all collide.
          if (file.name === 'image.png' || /^image\.\w+$/i.test(file.name)) {
            const ext = (file.type || 'image/png').split('/')[1] || 'png';
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            pasted.push(new File([file], `Pasted-image-${stamp}.${ext}`, { type: file.type }));
          } else {
            pasted.push(file);
          }
        }
      }
      if (pasted.length) {
        e.preventDefault();
        uploadFiles(pasted);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [folderId, canEdit]);

  const saveRename = async () => {
    if (!renameValue.trim()) return;
    try {
      await api.patch(`/document-library/folders/${folderId}`, { name: renameValue.trim() });
      toast.success('Folder renamed');
      setRenaming(false);
      await loadFolder();
    } catch (e) { toast.error(apiError(e)); }
  };

  const deleteFile = async (f) => {
    if (!window.confirm(`Delete "${f.filename}"?`)) return;
    try {
      await api.delete(`/document-library/files/${f.id}`);
      toast.success('File deleted');
      await loadFiles();
    } catch (e) { toast.error(apiError(e)); }
  };

  const downloadFile = async (f) => {
    // Use fetch + blob to attach the Bearer token (the file route is auth-gated).
    try {
      const res = await fetch(`${API_BASE}/document-library/files/${f.id}/download`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e.message || 'Could not download file');
    }
  };

  return (
    <div className="max-w-5xl mx-auto" data-testid="document-folder-page">
      <BackButton to="/app/document-library" />

      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-500 mb-2">Compliance / Document Library / {folder?.name || '…'}</div>
          {renaming ? (
            <div className="flex items-center gap-2">
              <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(false); }}
                className="px-3 py-1.5 text-2xl font-display font-semibold border border-slate-300 rounded-lg w-full max-w-md"
                data-testid="folder-detail-rename-input" />
              <PrimaryButton onClick={saveRename} testid="folder-detail-rename-save">Save</PrimaryButton>
              <GhostButton onClick={() => setRenaming(false)} testid="folder-detail-rename-cancel">Cancel</GhostButton>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">{folder?.name || 'Loading…'}</h1>
              {canEdit && folder && !folder.is_system && (
                <button onClick={() => { setRenameValue(folder.name); setRenaming(true); }}
                  data-testid="folder-detail-rename-btn"
                  className="p-1.5 rounded text-slate-400 hover:text-brand-blue hover:bg-slate-100" title="Rename">
                  <Pencil />
                </button>
              )}
            </div>
          )}
          <p className="mt-1.5 text-sm text-slate-600">
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <input ref={fileInputRef} type="file" multiple className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
              onChange={(e) => { uploadFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
              data-testid="folder-file-input" />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              data-testid="folder-upload-btn"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-60">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload />} Upload files
            </button>
          </div>
        )}
      </div>

      {canEdit && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mb-6 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${
            dragOver ? 'border-brand-blue bg-brand-blue-soft/30' : 'border-slate-300 bg-white hover:bg-slate-50'
          } p-8 text-center`}
          data-testid="folder-drop-zone"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-blue-soft text-brand-blue mb-3">
            <ClipboardPaste size={20} />
          </div>
          <div className="font-display font-semibold text-slate-900">
            Drop files here, paste from clipboard (Ctrl/Cmd+V), or click to browse
          </div>
          <div className="text-xs text-slate-500 mt-1.5">
            Up to 50MB · PDF, DOC/DOCX, XLS/XLSX, PNG, JPG, JPEG, TXT, CSV
          </div>
        </div>
      )}

      {/* Per-worker subfolders (e.g. cert uploads land in `Workers/{Name}`). */}
      {subfolders.length > 0 && (
        <div className="mb-5" data-testid="folder-subfolders">
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500 mb-2">
            Subfolders · {subfolders.length}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {subfolders.map((sf) => (
              <SubfolderCard key={sf.id} sf={sf} canEdit={canEdit}
                onOpen={() => navigate(`/app/document-library/${sf.id}`)}
                onChanged={loadFolder} />
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading files…</div>
      ) : files.length === 0 ? (
        <EmptyState title="This folder is empty"
          body={canEdit
            ? "Upload your first file with the picker above, or paste from your clipboard."
            : "Files will appear here once an admin uploads them."} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Filename</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Size</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Uploaded by</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Uploaded</th>
                <th className="text-left px-4 py-3 hidden xl:table-cell">AI tags</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`file-row-${f.id}`}>
                  <td className="px-4 py-3">
                    <div className="inline-flex items-center gap-2">
                      <span className="text-slate-400 shrink-0">{fileIcon(f.mime)}</span>
                      <button onClick={() => downloadFile(f)} className="text-left font-medium text-slate-900 hover:text-brand-blue truncate max-w-[320px]" title={f.filename}>
                        {f.filename}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{humanSize(f.size)}</td>
                  <td className="px-4 py-3 text-slate-500 hidden lg:table-cell">{f.uploaded_by_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 hidden lg:table-cell">{(f.uploaded_at || '').slice(0, 10)}</td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {(f.ai_tags || []).slice(0, 4).map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#ece6f4] text-[#4f3a8c] uppercase tracking-wider font-semibold">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      {(() => {
                        const ok = isPdfPreviewable(f.mime, f.filename);
                        const tip = ok ? 'View as PDF' : 'PDF preview not available for this format';
                        return (
                          <button onClick={() => ok && setPreviewFile(f)} disabled={!ok}
                            data-testid={`file-view-pdf-${f.id}`} title={tip}
                            className={`p-1.5 rounded ${ok
                              ? 'text-slate-500 hover:text-brand-blue hover:bg-slate-100'
                              : 'text-slate-300 cursor-not-allowed'}`}>
                            <Eye />
                          </button>
                        );
                      })()}
                      {(() => {
                        const ok = isPdfPreviewable(f.mime, f.filename);
                        const tip = ok ? 'Download as PDF' : 'PDF preview not available for this format';
                        const onClick = async () => {
                          if (!ok) return;
                          try {
                            const res = await fetch(`${API_BASE}/files/${f.id}/pdf?dl=1`, {
                              headers: { Authorization: `Bearer ${getToken()}` },
                            });
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            const blob = await res.blob();
                            // v148 — stashInlinePdf → same-origin URL (ad-blocker-safe)
                            const filename = (f.filename || 'document').replace(/\.[^.]+$/, '') + '.pdf';
                            const { src } = await stashInlinePdf(blob, filename);
                            const a = document.createElement('a');
                            a.href = src;
                            a.download = filename;
                            document.body.appendChild(a); a.click(); a.remove();
                          } catch (e) { toast.error(e.message || 'Could not download PDF'); }
                        };
                        return (
                          <button onClick={onClick} disabled={!ok}
                            data-testid={`file-download-pdf-${f.id}`} title={tip}
                            className={`p-1.5 rounded ${ok
                              ? 'text-slate-500 hover:text-purple-700 hover:bg-slate-100'
                              : 'text-slate-300 cursor-not-allowed'}`}>
                            <FileText size={14} />
                          </button>
                        );
                      })()}
                      <button onClick={() => downloadFile(f)} data-testid={`file-download-${f.id}`}
                        className="p-1.5 rounded text-slate-500 hover:text-brand-blue hover:bg-slate-100" title="Download original">
                        <Download />
                      </button>
                      {canEdit && (
                        <button onClick={() => deleteFile(f)} data-testid={`file-delete-${f.id}`}
                          className="p-1.5 rounded text-slate-500 hover:text-brand-red hover:bg-slate-100" title="Delete">
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {previewFile && (
        <PdfPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </div>
  );
}
