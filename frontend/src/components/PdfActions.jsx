import React, { useState } from 'react';
import { FileText, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Can } from '../lib/permissions';
import { TOKEN_KEY } from '../lib/api';
import PdfViewerModal from './PdfViewerModal';

const PATH = {
  swms: 'swms', pre_starts: 'pre-starts', site_diary: 'site-diary',
  hazards: 'hazards', incidents: 'incidents', inspections: 'inspections',
};

async function fetchPdf(resourceKind, recordId, download) {
  const base = process.env.REACT_APP_BACKEND_URL;
  const token = localStorage.getItem(TOKEN_KEY);
  const url = `${base}/api/${PATH[resourceKind]}/${recordId}/pdf${download ? '?download=1' : ''}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(t || `HTTP ${r.status}`);
  }
  const blob = await r.blob();
  // Try to read filename from Content-Disposition
  const cd = r.headers.get('content-disposition') || '';
  const m = /filename="?([^"]+)"?/.exec(cd);
  return { blob, filename: m?.[1] || `${(resourceKind)}-${recordId.slice(0, 8)}.pdf` };
}

export default function PdfActions({ resourceKind, recordId, title = '', size = 'sm' }) {
  const [busy, setBusy] = useState(null); // 'view' | 'download' | null
  const [modal, setModal] = useState({ open: false, blobUrl: null, filename: '', loading: false });

  const closeModal = () => {
    setModal((m) => {
      if (m.blobUrl) { try { URL.revokeObjectURL(m.blobUrl); } catch { /* ignore */ } }
      return { open: false, blobUrl: null, filename: '', loading: false };
    });
  };

  const view = async (e) => {
    e?.stopPropagation();
    setBusy('view');
    // Open modal immediately with spinner so there's no popup-blocker timing issue.
    setModal({ open: true, blobUrl: null, filename: title || 'PDF', loading: true });
    try {
      const { blob, filename } = await fetchPdf(resourceKind, recordId, false);
      const u = URL.createObjectURL(blob);
      setModal({ open: true, blobUrl: u, filename, loading: false });
    } catch (err) {
      closeModal();
      toast.error(err.message || 'Could not open PDF');
    } finally { setBusy(null); }
  };

  const downloadFromModal = async () => {
    if (!modal.blobUrl) return;
    const a = document.createElement('a');
    a.href = modal.blobUrl;
    a.download = modal.filename || 'document.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    toast.success('PDF downloaded');
  };

  const dl = async (e) => {
    e?.stopPropagation();
    setBusy('download');
    try {
      const { blob, filename } = await fetchPdf(resourceKind, recordId, true);
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 5000);
      toast.success('PDF downloaded');
    } catch (err) { toast.error(err.message || 'Could not download PDF'); }
    finally { setBusy(null); }
  };

  const ico = size === 'sm' ? 12 : 14;
  const cls = size === 'sm'
    ? 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-slate-100 text-slate-700'
    : 'inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50';

  return (
    <Can resource={resourceKind} action="view">
      <div className="inline-flex gap-1" data-testid={`pdf-actions-${resourceKind}-${recordId}`}>
        <button onClick={view} disabled={busy === 'view'} className={cls} title="View PDF" data-testid={`pdf-view-${recordId}`}>
          {busy === 'view' ? <Loader2 size={ico} className="animate-spin" /> : <FileText size={ico} />} View PDF
        </button>
        <button onClick={dl} disabled={busy === 'download'} className={cls} title="Download PDF" data-testid={`pdf-dl-${recordId}`}>
          {busy === 'download' ? <Loader2 size={ico} className="animate-spin" /> : <Download size={ico} />} Download
        </button>
      </div>
      <PdfViewerModal
        isOpen={modal.open}
        onClose={closeModal}
        blobUrl={modal.blobUrl}
        filename={modal.filename}
        isLoading={modal.loading}
        onDownload={downloadFromModal}
      />
    </Can>
  );
}
