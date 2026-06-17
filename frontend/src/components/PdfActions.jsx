import React, { useState } from 'react';
import { FileText, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Can } from '../lib/permissions';
import { TOKEN_KEY } from '../lib/api';

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
  return r.blob();
}

export default function PdfActions({ resourceKind, recordId, title = '', size = 'sm' }) {
  const [busy, setBusy] = useState(null); // 'view' | 'download' | null
  const view = async (e) => {
    e?.stopPropagation();
    setBusy('view');
    try {
      const blob = await fetchPdf(resourceKind, recordId, false);
      const u = URL.createObjectURL(blob);
      window.open(u, '_blank');
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (err) { toast.error(err.message || 'Could not open PDF'); }
    finally { setBusy(null); }
  };
  const dl = async (e) => {
    e?.stopPropagation();
    setBusy('download');
    try {
      const blob = await fetchPdf(resourceKind, recordId, true);
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u; a.download = `${(title || recordId).slice(0, 40)}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 5000);
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
    </Can>
  );
}
