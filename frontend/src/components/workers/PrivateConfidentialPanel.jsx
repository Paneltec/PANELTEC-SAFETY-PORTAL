/**
 * v58.13.132fi — Private & Confidential worker documents.
 *
 * Admin-managed CRUD on `worker_hr_documents`. Backend routes:
 *   GET    /api/workers/{id}/hr-documents
 *   POST   /api/workers/{id}/hr-documents          (multipart)
 *   PATCH  /api/workers/{id}/hr-documents/{docId}  (notes-only)
 *   DELETE /api/workers/{id}/hr-documents/{docId}  (soft-delete)
 *   GET    /api/workers/{id}/hr-documents/{docId}/file
 *
 * Per Stephen's Section B: every web user is admin, so no per-user
 * gate here beyond the backend's admin+hr_lead check.
 */
import { useEffect, useRef, useState } from 'react';
import { Lock, UploadCloud, Loader2, Download, Trash2, Save, FileText, X, Clipboard } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import { filesUrl } from '../../lib/downloadUrl';
import useClipboardPaste from '../../lib/useClipboardPaste';

const MAX_MB = 50;

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PrivateConfidentialPanel({ workerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editingNotes, setEditingNotes] = useState(null); // {id, value}
  const fileInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/workers/${workerId}/hr-documents`);
      setRows(data?.documents || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workerId]);

  const upload = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const f of fileList) {
        if (f.size > MAX_MB * 1024 * 1024) {
          toast.error(`${f.name} exceeds ${MAX_MB} MB`); continue;
        }
        const fd = new FormData();
        fd.append('file', f);
        fd.append('notes', '');
        await api.post(`/workers/${workerId}/hr-documents`, fd,
          { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      toast.success(`${fileList.length} file${fileList.length === 1 ? '' : 's'} uploaded`);
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setUploading(false); }
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    upload(e.dataTransfer?.files || []);
  };

  // v58.13.132gm — Paste screenshots / files directly into the panel.
  useClipboardPaste(upload, !!workerId, [workerId]);

  const saveNotes = async () => {
    if (!editingNotes) return;
    try {
      await api.patch(`/workers/${workerId}/hr-documents/${editingNotes.id}`,
        { notes: editingNotes.value });
      toast.success('Notes saved');
      setEditingNotes(null);
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api.delete(`/workers/${workerId}/hr-documents/${confirmDelete.id}`);
      toast.success('File deleted (recoverable from Archive for 30 days)');
      setConfirmDelete(null);
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const download = async (row) => {
    try {
      const u = await filesUrl(`/workers/${workerId}/hr-documents/${row.id}/file`);
      window.open(u, '_blank', 'noopener,noreferrer');
    } catch (_e) { toast.error('Unable to open file'); }
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white"
      data-testid="section-private-confidential">
      <div className="w-full flex items-center gap-2 px-4 py-2.5 bg-rose-50 border-b border-rose-100">
        <Lock size={14} className="text-rose-700" />
        <span className="text-sm font-semibold text-slate-800 mr-1">Private &amp; Confidential</span>
        <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700"
          data-testid="section-private-confidential-count">
          {rows.length} file{rows.length === 1 ? '' : 's'}
        </span>
        <span className="ml-auto text-[10px] text-slate-500">Encrypted at rest. Visible to all admins.</span>
      </div>
      <div className="px-4 py-4 space-y-3">
        {/* Drop-zone uploader */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="pnc-dropzone"
          className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
            dragOver ? 'border-rose-500 bg-rose-100' : 'border-rose-200 bg-rose-50/40 hover:bg-rose-50'
          }`}>
          <UploadCloud size={22} className="mx-auto text-rose-700 mb-1.5" />
          <div className="text-sm font-medium text-rose-800">
            {uploading ? 'Uploading…' : 'Drop files, click to browse, or paste (Ctrl/Cmd+V)'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center justify-center gap-1">
            <Clipboard size={10} /> Screenshots welcome — pasted images auto-named with a timestamp.
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            PDF, image, DOCX, XLSX, TXT, CSV — up to {MAX_MB} MB per file.
          </div>
          <input ref={fileInputRef} type="file" multiple hidden
            data-testid="pnc-file-input"
            onChange={(e) => upload(e.target.files)}
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv" />
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-500 italic" data-testid="pnc-empty">
            No private files uploaded yet.
          </p>
        ) : (
          <table className="min-w-full text-sm border border-slate-100 rounded-lg overflow-hidden"
            data-testid="pnc-table">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Filename</th>
                <th className="text-left px-3 py-2">Size</th>
                <th className="text-left px-3 py-2">Uploaded</th>
                <th className="text-left px-3 py-2">Notes</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100"
                  data-testid={`pnc-row-${r.id}`}>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <FileText size={12} className="text-slate-400" />
                      <span className="text-slate-800 font-medium">{r.filename}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600 font-mono text-[11px]">{fmtBytes(r.size)}</td>
                  <td className="px-3 py-2 text-slate-500 text-[11px]">
                    {(r.uploaded_at || '').slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    {editingNotes && editingNotes.id === r.id ? (
                      <div className="flex items-center gap-1">
                        <input value={editingNotes.value}
                          onChange={(e) => setEditingNotes({ ...editingNotes, value: e.target.value })}
                          data-testid={`pnc-notes-input-${r.id}`}
                          className="w-full text-xs px-2 py-1 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-400" />
                        <button type="button" onClick={saveNotes}
                          data-testid={`pnc-notes-save-${r.id}`}
                          className="text-emerald-700 hover:bg-emerald-50 p-1 rounded"><Save size={12} /></button>
                        <button type="button" onClick={() => setEditingNotes(null)}
                          className="text-slate-500 hover:bg-slate-100 p-1 rounded"><X size={12} /></button>
                      </div>
                    ) : (
                      <button type="button"
                        onClick={() => setEditingNotes({ id: r.id, value: r.notes || '' })}
                        data-testid={`pnc-notes-edit-${r.id}`}
                        className="text-left text-xs text-slate-600 hover:text-slate-900 hover:underline">
                        {r.notes || <span className="text-slate-400 italic">Add notes…</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button type="button" onClick={() => download(r)}
                      data-testid={`pnc-download-${r.id}`}
                      title="Download"
                      className="inline-flex items-center justify-center w-7 h-7 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 mr-1">
                      <Download size={12} />
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(r)}
                      data-testid={`pnc-delete-${r.id}`}
                      title="Delete file"
                      className="inline-flex items-center justify-center w-7 h-7 rounded bg-rose-100 text-rose-700 hover:bg-rose-200">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 grid place-items-center p-4"
          onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}
          data-testid="pnc-delete-confirm">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5">
            <h3 className="text-lg font-bold text-slate-900">Delete this file?</h3>
            <p className="text-sm text-slate-600 mt-2">
              Delete <span className="font-semibold">"{confirmDelete.filename}"</span>?
              It will move to Archive and can be restored for 30 days.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100">
                Cancel
              </button>
              <button type="button" onClick={doDelete}
                data-testid="pnc-delete-confirm-yes"
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
