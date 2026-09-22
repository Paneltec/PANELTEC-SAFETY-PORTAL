// v58.13.132ki — View the original uploaded PDF for an imported
// form submission. Renders an inline "View original PDF" button
// that fetches from `GET /api/imports/original-pdf/{id}` and opens
// the returned bytes in a new tab as a blob URL.
//
// If the backend returns 404 `{reason: "original_not_persisted"}`
// (backfill — submission predates .132ki), we surface a small toast
// with the reason instead of dumping the JSON into a new tab.
//
// Auth is inherited from the parent axios client via `api`.
import React from 'react';
import { FileText, ExternalLink } from 'lucide-react';
import api from '../lib/api';
import { toast } from 'sonner';

export default function ViewOriginalPdfButton({ submissionId, className = '', testid, label = 'View original PDF' }) {
  const [busy, setBusy] = React.useState(false);
  const onClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const resp = await api.get(`/imports/original-pdf/${submissionId}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      // Best-effort: revoke shortly after opening so we don't leak
      // memory in the tab. 60s covers the browser's load window.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.response?.data;
      if (status === 404 && detail?.reason === 'original_not_persisted') {
        toast.warning('Original PDF not on file', {
          description: `This submission was imported before v.132ki, so the source bytes were not persisted. Re-upload the PDF to attach it.`,
        });
      } else if (status === 404) {
        toast.error('Submission not found');
      } else {
        toast.error('Could not open the original PDF', {
          description: err?.message || 'Please try again.',
        });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={onClick} disabled={busy}
      data-testid={testid || `view-original-pdf-btn-${submissionId}`}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 hover:text-blue-900 hover:underline disabled:opacity-50 ${className}`}
      title="Open the original uploaded PDF in a new tab">
      <FileText size={10} className="shrink-0" />
      <span>{busy ? 'Opening…' : label}</span>
      <ExternalLink size={9} className="shrink-0" />
    </button>
  );
}
