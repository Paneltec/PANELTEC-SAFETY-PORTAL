// Phase 3.10 — Settings → System page. Admin-only.
// Shows the install status of optional server toolchains (LibreOffice,
// Tesseract OCR, Poppler) and a single "Install all server tools" button.
// Does NOT auto-trigger — admin must click. Streaming log isn't supported
// here (it's a synchronous POST that returns the tail of apt-get output);
// the spinner with "Installing… 5–10 min" is shown until completion.
import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Loader2, Download, FileText, Settings as Cog, Eye } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';

export default function SystemSettings() {
  const me = getUser();
  const canInstall = me?.role === 'admin';
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [lastLog, setLastLog] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      // Phase 3.13 — point at the dedicated health endpoint. Normalise the
      // `{ok, version, path}` shape back into the legacy `{installed, ...}`
      // keys the ToolCard component already consumes, so we don't have to
      // touch downstream rendering.
      const r = await api.get('/admin/server-tools/health');
      const h = r.data || {};
      const norm = (t) => ({
        installed: !!t?.ok, version: t?.version || null, path: t?.path || null,
      });
      setStatus({
        libreoffice: norm(h.libreoffice),
        tesseract:   norm(h.tesseract),
        poppler:     norm(h.poppler),
      });
    } catch (e) {
      toast.error(apiError(e));
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const install = async () => {
    if (!canInstall) return;
    setInstalling(true);
    try {
      const r = await api.post('/admin/install-libreoffice', null, {
        params: { include_ocr: true }, timeout: 900_000,
      });
      setStatus(r.data?.tools || null);
      setLastLog(r.data?.log_tail || '');
      const ok = r.data?.tools?.libreoffice?.installed;
      toast[ok ? 'success' : 'error'](
        ok ? 'LibreOffice + OCR installed — XLSX / PPTX / OCR now available.'
           : 'Install completed with errors — check the log below.',
      );
    } catch (e) { toast.error(apiError(e)); }
    finally { setInstalling(false); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="system-settings">
      <header className="mb-6">
        <div className="text-[10px] uppercase tracking-wider font-bold text-blue-600">
          Paneltec Civil · Settings
        </div>
        <h1 className="text-3xl font-display font-bold text-slate-900 mt-1 inline-flex items-center gap-2">
          <Cog size={28} className="text-blue-600" /> Server Tools
        </h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-3xl">
          Optional toolchains for richer Document Library PDF conversion and OCR.
          The platform works without them — these unlock additional file format
          coverage (XLSX, PPTX, ODT, scanned-PDF text extraction).
        </p>
      </header>

      <div className="grid md:grid-cols-3 gap-4 mb-6" data-testid="tools-grid">
        <ToolCard
          icon={FileText} title="LibreOffice"
          purpose="DOCX / XLSX / PPTX / ODT / RTF → PDF"
          tool={status?.libreoffice}
          loading={loading}
          testid="tool-libreoffice"
        />
        <ToolCard
          icon={Eye} title="Tesseract OCR"
          purpose="Extract text from scanned PDFs and photos"
          tool={status?.tesseract}
          loading={loading}
          testid="tool-tesseract"
        />
        <ToolCard
          icon={Download} title="Poppler (pdftotext)"
          purpose="PDF text extraction for Smart Search indexing"
          tool={status?.poppler}
          loading={loading}
          testid="tool-poppler"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[16rem]">
            <h3 className="font-display font-bold text-slate-900">Install all server tools</h3>
            <p className="text-xs text-slate-500 mt-1">
              Installs LibreOffice + Tesseract + Poppler in one apt-get run.
              <b className="text-slate-700"> Not installed · ~5–10 min · ~650 MB total.</b>
              {' '}Admin-only. Run during a maintenance window.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refresh} disabled={loading || installing}
              data-testid="refresh-status"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Run health check
            </button>
            <button onClick={install} disabled={!canInstall || installing}
              data-testid="install-now"
              title={canInstall ? '' : 'Admin only'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-60">
              {installing ? <><Loader2 size={12} className="animate-spin" /> Installing…</>
                          : <>Install now</>}
            </button>
          </div>
        </div>
        {installing && (
          <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
            Installing in the background — keep this tab open. Typical time 5–10 min.
            File conversions for XLSX / PPTX will start working immediately on completion.
          </p>
        )}
        {lastLog && (
          <pre data-testid="install-log"
               className="mt-4 max-h-72 overflow-auto rounded-lg bg-slate-900 text-emerald-300 text-[11px] p-3 font-mono whitespace-pre-wrap">
            {lastLog}
          </pre>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-[11px] text-slate-600">
        <b className="text-slate-800">Today (Phase A — pragmatic):</b> PDFs, images
        (JPG / PNG / WEBP / HEIC), CSV, TXT, MD, and DOCX (via text-fallback
        renderer) are already PDF-viewable. Installing the toolchain above
        promotes DOCX to full-fidelity rendering and unlocks XLSX / PPTX / ODT.
      </div>
    </div>
  );
}

function ToolCard({ icon: Icon, title, purpose, tool, loading, testid }) {
  const ok = tool?.installed;
  return (
    <div data-testid={testid}
      className={`rounded-2xl border p-4 shadow-sm bg-white ${ok ? 'border-emerald-200' : 'border-slate-200'}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          <Icon size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-900 truncate">{title}</div>
          <div className="text-[10px] text-slate-500 truncate">{purpose}</div>
        </div>
        {loading ? <Loader2 size={14} className="text-slate-300 animate-spin" />
          : ok ? <CheckCircle2 size={16} className="text-emerald-600" data-testid={`${testid}-installed`} />
               : <XCircle size={16} className="text-slate-400" data-testid={`${testid}-missing`} />}
      </div>
      <div className="mt-2.5 text-[11px] text-slate-600 font-mono break-all min-h-[2.5em]">
        {loading ? '…'
          : ok ? (tool.version || tool.path || 'Installed')
               : <span className="text-slate-400 italic">Not installed</span>}
      </div>
    </div>
  );
}
