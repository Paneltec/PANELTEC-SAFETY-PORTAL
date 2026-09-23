// v58.13.132mb — Shared with me page.
//
// Non-admin visible entry point at /app/shared-with-me. Lists files
// the current user has an active share on via
// GET /document-library/shared-with-me. Download button hits the
// share-scoped GET /document-library/shared-with-me/files/{id}/download
// which is enforced by the backend to require `permission=download`.
//
// Admins can browse here too (backend returns [] for admins with no
// explicit shares — admins already see everything in the main library).
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, Eye, FileText, Loader2 } from 'lucide-react';
import api, { apiError, API_BASE } from '../lib/api';
import { getToken } from '../lib/auth';
// v58.13.132mf — display-only strip of legacy hex-id filename prefix.
import { displayFilename } from '../lib/displayFilename';
import {
  PageHeader, EmptyState,
} from '../components/capture/Ui';

function humanSize(n) {
  if (!n && n !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function SharedWithMe() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/document-library/shared-with-me');
      setRows(Array.isArray(data) ? data : []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const download = async (row) => {
    const t = toast.loading(`Downloading "${displayFilename(row.filename)}"…`);
    try {
      const res = await fetch(
        `${API_BASE}/document-library/shared-with-me/files/${row.id}/download`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = displayFilename(row.filename) || row.filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Downloaded', { id: t });
    } catch (e) { toast.error(e.message || 'Download failed', { id: t }); }
  };

  return (
    <div className="max-w-5xl mx-auto" data-testid="shared-with-me-page">
      <PageHeader
        title="Shared with me"
        subtitle="Files an administrator has shared with you or with all workers."
      />

      {loading ? (
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No files have been shared with you yet"
          body="When an administrator shares a document with you (or with all workers), it will show up here."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm" data-testid="shared-with-me-table">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Filename</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Folder</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Shared by</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Shared</th>
                <th className="text-left px-4 py-3">Access</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-slate-100 hover:bg-slate-50"
                  data-testid={`shared-row-${r.id}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={16} className="text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <div
                          className="font-medium text-slate-800 truncate"
                          title={displayFilename(r.filename)}
                          data-testid={`shared-filename-${r.id}`}
                        >
                          {displayFilename(r.filename)}
                        </div>
                        <div className="text-[11px] text-slate-500">{humanSize(r.size_bytes || r.size)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-slate-600 truncate max-w-[220px]" title={r.folder_name || ''}>
                    {r.folder_name || '—'}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-slate-600 truncate max-w-[200px]">
                    {r.shared_by || 'Administrator'}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-slate-500">
                    {relTime(r.shared_at)}
                  </td>
                  <td className="px-4 py-3">
                    {r.shared_permission === 'download' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <Download size={11} /> Download
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200">
                        <Eye size={11} /> View only
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.shared_permission === 'download' ? (
                      <button
                        onClick={() => download(r)}
                        data-testid={`shared-download-${r.id}`}
                        className="p-1.5 rounded text-slate-500 hover:text-brand-blue hover:bg-slate-100"
                        title="Download"
                      >
                        <Download size={16} />
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic pr-2">View only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
