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
import { Check, ClipboardPaste, FileSpreadsheet, FileText, FolderOpen, Image as ImageIcon, Loader2, ShieldOff, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError, API_BASE } from '../lib/api';
import { getToken, getUser } from '../lib/auth';
import { useCan } from '../lib/permissions';
import { stashInlinePdf } from '../lib/pdfStash';
import BulkRestrictModal from '../components/BulkRestrictModal';
import {
  PageHeader, GhostButton, PrimaryButton, EmptyState, BackButton,
} from '../components/capture/Ui';
import PdfPreviewModal, { isPdfPreviewable } from '../components/PdfPreviewModal';
// v160.3.7p — Single source of truth for the Doc Library colour taxonomy.
// Ships the semantic labels ("Health & Hazards", "SWMS & Competencies", …)
// that replace the old cosmetic pastel names.
import { FOLDER_COLORS, FOLDER_COLOR_LABELS, folderColor } from '../lib/folderColors';
// v58.13.52 — Same deterministic 8-colour rotation the Capture pages
// already use for grouped-tile stripes/banners. Consumed below to
// colour-divide the file rows inside a folder-detail view.
import { resolveGroupPalette } from '../lib/groupPalette';

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

// v160.3.9.29-2c — Legacy sets retained until sweep-report §3 propagation
// consumers are updated. Authoritative gates now come from useCan below.
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

// ────────────────────── v58.13.52 · group-by-key helpers ─────────────────────
//
// Rows inside a folder-detail view now render inside a colour-coded
// group. Group key resolution is a strict fallback chain per the
// v58.13.52 spec:
//   1. IMS-NN prefix parsed from the filename        (e.g. `IMS-04`)
//   2. First `ai_tags[0]` (already populated at upload time)
//   3. Coarse mime bucket (`pdf` / `docx` / `xlsx` / `img` / `text`)
//   4. Literal string `"Other"` — always sorts last
//
// The chosen key is fed to `resolveGroupPalette({ groupKey, page:
// 'document-library' })` for the 8-colour rotation (djb2 hash → stable
// across reloads). Adding new IMS numbers (`IMS-11`, …) or brand-new
// tag families requires zero code changes — they slot into the
// rotation automatically.

const IMS_PREFIX_RE = /IMS-(\d{1,3})(?:\.\d+[a-z]?)?/i;

function _mimeBucket(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('word') || m.includes('officedocument.wordprocessing')) return 'docx';
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return 'xlsx';
  if (m.startsWith('image/')) return 'img';
  if (m.startsWith('text/')) return 'text';
  return '';
}

/**
 * v58.13.52 fallback chain: IMS regex → first ai_tag → mime bucket → "Other".
 * Exported (via named import from the same file) is unnecessary — the
 * helper is only used inside `DocumentLibraryFolder`. It IS covered by
 * the smoke test in `tests/frontend_smoke/test_document_library_grouping_v58_13_52.py`
 * which greps for these exact tokens.
 */
function docLibraryGroupKey(f) {
  const m = IMS_PREFIX_RE.exec(f.filename || '');
  if (m && m[1]) return `IMS-${m[1].padStart(2, '0')}`;
  const tag = ((f.ai_tags || [])[0] || '').trim();
  if (tag) return tag.toLowerCase();
  const bucket = _mimeBucket(f.mime);
  if (bucket) return bucket;
  return 'Other';
}

/**
 * Groups files by `docLibraryGroupKey`, sorts within each group by
 * `uploaded_at` DESC, and returns an array of `[groupKey, files[]]`
 * tuples ordered by group key ascending — with "Other" always last.
 */
function groupFilesForDisplay(files) {
  const buckets = new Map();
  for (const f of files || []) {
    const k = docLibraryGroupKey(f);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(f);
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => String(b.uploaded_at || '').localeCompare(String(a.uploaded_at || '')));
  }
  const entries = Array.from(buckets.entries());
  entries.sort(([a], [b]) => {
    if (a === 'Other' && b !== 'Other') return 1;
    if (b === 'Other' && a !== 'Other') return -1;
    return String(a).localeCompare(String(b), 'en', { numeric: true });
  });
  return entries;
}


// ────────────────────── Folder list page ──────────────────────

export default function DocumentLibrary() {
  const navigate = useNavigate();
  const user = getUser();
  // v160.3.9.29-2c — Migrated from WRITE_ROLES/DELETE_FOLDER_ROLES sets
  // to the granular documents tokens.
  const can = useCan();
  const canEdit = can('documents', 'edit');
  const canDeleteFolder = can('documents', 'delete');
  void user; void WRITE_ROLES; void DELETE_FOLDER_ROLES;

  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  // v159.4 — bulk-restrict modal state (Doc Library admin action).
  const [restrictOpen, setRestrictOpen] = useState(false);
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

  // v160.3.6m — Colour-filter state for the pastel legend. Multi-select
  // Set — clicking a swatch toggles that colour on/off; empty Set = "all
  // colours visible". Filters ALSO honour the free-text `filter` search
  // box so the two act as an AND.
  const [colorFilter, setColorFilter] = useState(() => new Set());
  const toggleColor = (key) => {
    setColorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // v160.3.7o — colour-group recolour picker state + handler. Only admins
  // reach this UI (`canEdit` gate at the button). Persists via the existing
  // PATCH /folders/{id} endpoint which already supports `color_key`.
  const [colorPickerFolderId, setColorPickerFolderId] = useState(null);
  const recolorFolder = useCallback(async (folder, nextKey) => {
    if (!folder || nextKey === folder.color_key) {
      setColorPickerFolderId(null);
      return;
    }
    // Optimistic update — flip the tile immediately, roll back on error.
    const prevKey = folder.color_key;
    setFolders((rs) => rs.map((r) => (r.id === folder.id ? { ...r, color_key: nextKey } : r)));
    setColorPickerFolderId(null);
    try {
      await api.patch(`/document-library/folders/${folder.id}`, { color_key: nextKey });
      toast.success(`Folder moved to “${folderColor(nextKey).label}”.`);
    } catch (e) {
      toast.error(apiError(e));
      setFolders((rs) => rs.map((r) => (r.id === folder.id ? { ...r, color_key: prevKey } : r)));
    }
  }, []);

  // v160.3.7p — Semantic colour taxonomy sourced from /lib/folderColors.
  // The old cosmetic labels (`Sky`, `Mint`, …) told an admin nothing;
  // now the legend and swatches surface "Health & Hazards", "SWMS &
  // Competencies", etc. — grounded in what the folders actually contain.
  const PASTEL_LABEL = FOLDER_COLOR_LABELS;
  const PASTEL_DOT = FOLDER_COLORS.reduce((acc, c) => {
    acc[c.slug] = c.dot;
    return acc;
  }, {});
  // Cosmetic-name lookup — kept for the recolour-swatch tooltip so an
  // admin who wants to know "which slug is this" can still see it on
  // hover without cluttering the primary UI.
  const PASTEL_COSMETIC = FOLDER_COLORS.reduce((acc, c) => {
    acc[c.slug] = c.cosmetic;
    return acc;
  }, {});
  // Per-colour folder counts on the current dataset — legend only lists
  // colours actually in use, so a fresh org doesn't see 10 empty swatches.
  const colorCounts = useMemo(() => {
    const c = {};
    for (const f of folders) {
      const k = f.color_key || 'sky';
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [folders]);
  const legendEntries = useMemo(() =>
    Object.keys(PASTEL_LABEL)
      .filter((k) => (colorCounts[k] || 0) > 0)
      .sort((a, b) => (colorCounts[b] - colorCounts[a])),
  [colorCounts]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let out = folders;
    if (q) out = out.filter((f) => f.name.toLowerCase().includes(q));
    if (colorFilter.size > 0) out = out.filter((f) => colorFilter.has(f.color_key || 'sky'));
    return out;
  }, [folders, filter, colorFilter]);

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
          <button onClick={() => setRestrictOpen(true)} data-testid="doclib-restrict-access-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-orange-300 bg-orange-50 text-orange-800 text-sm font-medium hover:bg-orange-100">
            <ShieldOff size={14} /> Restrict access
          </button>
        )}
        {canEdit && (
          <button onClick={startCreate} data-testid="folder-create-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600">
            <Plus /> New folder
          </button>
        )}
      </div>

      {/* v160.3.6m — Folder group legend. Doubles as (a) a key that
          documents what each semantic group contains, and (b) a
          click-to-filter navigation aid. Only shows groups actually in
          use. v160.3.7p — Renamed heading COLOURS→GROUPS to match the
          new semantic taxonomy (Health & Hazards, SWMS & Competencies, …). */}
      {legendEntries.length > 1 && (
        <div className="mb-5 flex items-center gap-3 flex-wrap text-xs" data-testid="folder-color-legend">
          <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold shrink-0">Groups</span>
          {legendEntries.map((k) => {
            const active = colorFilter.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleColor(k)}
                data-testid={`folder-color-${k}`}
                aria-pressed={active}
                title={active ? `Showing ${PASTEL_LABEL[k]} folders — click to clear` : `Filter to ${PASTEL_LABEL[k]} folders (${colorCounts[k]})`}
                className={`inline-flex items-center gap-1.5 py-1 pl-1.5 pr-2.5 rounded-full transition-all ${
                  active
                    ? 'bg-[#e6eff9] ring-1 ring-[#1e4a8c]/40 text-[#1e4a8c]'
                    : 'hover:bg-slate-100 text-slate-600'
                }`}
              >
                <span className={`w-3 h-3 rounded-full ${PASTEL_DOT[k]} border border-black/5 shrink-0`} />
                <span className="font-medium">{PASTEL_LABEL[k]}</span>
                <span className="text-slate-400 tabular-nums">{colorCounts[k]}</span>
              </button>
            );
          })}
          {colorFilter.size > 0 && (
            <button
              type="button"
              onClick={() => setColorFilter(new Set())}
              data-testid="folder-color-clear"
              className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-900 underline underline-offset-4"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* v159.4 — Doc Library bulk-restrict modal */}
      <BulkRestrictModal
        open={restrictOpen}
        onClose={() => setRestrictOpen(false)}
        resource="documents"
        action="view"
        resourceLabel="Document Library"
      />

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
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5" data-testid="folder-grid">
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
                  className="w-full text-left p-3"
                >
                  <FolderOpen size={22} className={`${PASTEL_ICON[f.color_key] || PASTEL_ICON.sky} mb-1.5`} />
                  <div className="font-display font-semibold text-[13px] text-slate-900 line-clamp-2 leading-snug min-h-[2.1rem]">{f.name}</div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {f.file_count} {f.file_count === 1 ? 'file' : 'files'}
                  </div>
                </button>
                {canEdit && !f.is_system && confirmDeleteId !== f.id && (
                  <div className="hidden group-hover:flex absolute top-1.5 right-1.5 gap-0.5" data-testid={`folder-actions-${f.id}`}>
                    {/* v160.3.7o — recolour swatch: click to open the palette picker,
                        pick a new group and the tile re-tints instantly.
                        v160.3.7p — Tooltip surfaces the semantic group name
                        ("Health & Hazards") first, with the pastel slug in
                        parens for admins who track the colour name. */}
                    <button onClick={() => setColorPickerFolderId(f.id)}
                      data-testid={`folder-recolor-btn-${f.id}`}
                      title={`Group · ${PASTEL_LABEL[f.color_key || 'sky']} (${PASTEL_COSMETIC[f.color_key || 'sky']}) — click to change`}
                      className="p-1.5 rounded bg-white/90 border border-slate-200 text-slate-500 hover:bg-white flex items-center">
                      <span className={`inline-block w-3 h-3 rounded-full border border-white/60 ${PASTEL_DOT[f.color_key || 'sky']}`} />
                    </button>
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
                {/* v160.3.7o — inline colour-group picker popover
                    v160.3.7p — Popover now shows each group's SEMANTIC
                    label alongside its dot (grid → single column) so
                    admins pick a meaningful bucket instead of a colour. */}
                {canEdit && colorPickerFolderId === f.id && (
                  <div
                    data-testid={`folder-recolor-popover-${f.id}`}
                    className="absolute top-8 right-1.5 z-20 bg-white border border-slate-200 rounded-xl shadow-xl p-2 w-56 space-y-0.5"
                    onMouseLeave={() => setColorPickerFolderId(null)}
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-400 px-2 pt-1 pb-1.5">
                      Assign to group
                    </div>
                    {FOLDER_COLORS.filter((c) => c.slug !== 'slate').map((c) => {
                      const active = (f.color_key || 'sky') === c.slug;
                      return (
                        <button
                          key={c.slug}
                          onClick={() => recolorFolder(f, c.slug)}
                          data-testid={`folder-recolor-swatch-${f.id}-${c.slug}`}
                          title={c.hint}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] text-left transition-colors ${active ? 'bg-slate-100 font-semibold text-slate-900' : 'hover:bg-slate-50 text-slate-700'}`}
                          aria-label={`Assign to ${c.label} (${c.cosmetic})`}
                        >
                          <span className={`inline-block w-3.5 h-3.5 rounded-full ${c.dot} ${active ? 'ring-2 ring-slate-900 ring-offset-1' : 'border border-white/60'}`} />
                          {c.label}
                          <span className="ml-auto text-[10px] text-slate-400">{c.cosmetic.toLowerCase()}</span>
                        </button>
                      );
                    })}
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
              {/* v58.13.52 — Rows now grouped by IMS-NN / ai_tag /
                  mime bucket → "Other". Each group gets a header
                  row + a 4-px left stripe on every data row. */}
              {groupFilesForDisplay(files).map(([groupKey, groupFiles]) => {
                const palette = resolveGroupPalette({ groupKey, page: 'document-library' });
                return (
                  <React.Fragment key={`grp-${groupKey}`}>
                    <tr
                      data-testid={`doc-library-group-${groupKey}`}
                      style={{ backgroundColor: palette.tint, borderLeft: `3px solid ${palette.hex}` }}
                    >
                      <td colSpan={6} className="px-4 py-2">
                        <span
                          className="text-[10px] uppercase tracking-[0.16em] font-semibold"
                          style={{ color: palette.text }}
                        >
                          {groupKey} · {groupFiles.length} {groupFiles.length === 1 ? 'file' : 'files'}
                        </span>
                      </td>
                    </tr>
                    {groupFiles.map((f) => (
                      <tr
                        key={f.id}
                        className="border-t border-slate-100 hover:bg-slate-50"
                        data-testid={`file-row-${f.id}`}
                        style={{ borderLeft: `4px solid ${palette.hex}` }}
                      >
                        <td className="px-4 py-3">
                          <div className="inline-flex items-center gap-2">
                            <span className="shrink-0" style={{ color: palette.hex }}>{fileIcon(f.mime)}</span>
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
                  </React.Fragment>
                );
              })}
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
