// v160.3.9.7 — Standalone popup route for the Worker ID Card print preview.
//
// Mounted OUTSIDE <AppShell> at `/print/worker-id-card/:workerId` so the
// popup window renders with no sidebar / no top-bar / no in-app chrome —
// just the card PDF (in an iframe), a small header with Print + Close, and
// an "Auto-open print dialog" preference toggle.
//
// The backend already produces the printable artefact as a PDF at
// `/api/workers/{id}/id-card.pdf`. We fetch it, stash it as a same-origin
// blob URL via `stashInlinePdf` (dodges Chrome ad-blocker `blob:` filters),
// and render it in an iframe. On mount we auto-invoke `iframe.contentWindow
// .print()` after ~500 ms when the localStorage flag is enabled — the admin
// gets straight to the browser print dialog. The toggle persists.
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast, Toaster } from 'sonner';
import { Printer, X, Loader2 } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { stashInlinePdf } from '../../lib/pdfStash';

const LS_AUTOPRINT = 'paneltec_idcard_auto_print';

export default function WorkerIdCardPrint() {
  const { workerId } = useParams();
  const [searchParams] = useSearchParams();
  const layout = searchParams.get('layout') || 'wallet';
  const [pdfSrc, setPdfSrc] = useState(null);
  const [worker, setWorker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoPrint, setAutoPrint] = useState(() => {
    try { return localStorage.getItem(LS_AUTOPRINT) !== '0'; }
    catch (_) { return true; }
  });
  const iframeRef = useRef(null);

  // Fetch the PDF once on mount / when workerId or layout changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [wRes, pdfRes] = await Promise.all([
          api.get(`/workers/${workerId}`).catch(() => ({ data: null })),
          api.get(`/workers/${workerId}/id-card.pdf`, {
            params: { layout },
            responseType: 'blob',
          }),
        ]);
        if (!alive) return;
        const filename = `worker-${workerId.slice(0, 8)}-${layout}.pdf`;
        const { src } = await stashInlinePdf(pdfRes.data, filename);
        if (!alive) return;
        setWorker(wRes.data);
        setPdfSrc(src);
      } catch (e) {
        if (alive) { setError(apiError(e, 'Could not load ID card PDF.')); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [workerId, layout]);

  // Auto-print once the iframe has painted the PDF.
  useEffect(() => {
    if (!pdfSrc || !autoPrint) return;
    const t = setTimeout(() => {
      try { iframeRef.current?.contentWindow?.print(); }
      catch (_) { /* PDF viewer sometimes disallows programmatic print */ }
    }, 700);
    return () => clearTimeout(t);
  }, [pdfSrc, autoPrint]);

  // Set a helpful document title so the popup taskbar entry is meaningful.
  useEffect(() => {
    const name = worker
      ? [worker.first_name, worker.last_name].filter(Boolean).join(' ')
      : '';
    document.title = name ? `${name} · ID card · Paneltec Civil` : 'ID card · Paneltec Civil';
  }, [worker]);

  const printNow = () => {
    try { iframeRef.current?.contentWindow?.print(); }
    catch (_) { toast.error('Browser blocked the print dialog. Use the iframe toolbar instead.'); }
  };

  const closeWin = () => {
    // window.close() only works on windows opened via window.open — which is
    // the whole point of this route. If a user landed here directly, fall
    // back to history.back() so they aren't stranded.
    try { window.close(); } catch (_) { /* noop */ }
    setTimeout(() => {
      if (!window.closed) window.history.back();
    }, 100);
  };

  const toggleAuto = (e) => {
    const v = e.target.checked;
    setAutoPrint(v);
    try { localStorage.setItem(LS_AUTOPRINT, v ? '1' : '0'); } catch (_) { /* noop */ }
  };

  const displayName = worker
    ? [worker.first_name, worker.last_name].filter(Boolean).join(' ') || worker.email
    : '';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" data-testid="idcard-print-page">
      <Toaster position="top-right" richColors />

      {/* Header — hidden on paper via @media print rule below */}
      <div className="no-print px-4 py-2 border-b border-slate-200 bg-white flex items-center gap-3">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
          Paneltec Civil · ID Card
        </div>
        {displayName && (
          <div className="text-xs text-slate-700 font-medium truncate max-w-[180px]" title={displayName}>
            · {displayName}
          </div>
        )}
        <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none"
          title="Automatically open the browser print dialog on load.">
          <input type="checkbox" checked={autoPrint} onChange={toggleAuto}
            data-testid="idcard-print-autoprint"
            className="w-3.5 h-3.5" />
          Auto-open print dialog
        </label>
        <button onClick={printNow} disabled={!pdfSrc}
          data-testid="idcard-print-btn"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1e4a8c] text-white text-xs font-semibold hover:bg-[#143263] disabled:opacity-50">
          <Printer size={12} /> Print
        </button>
        <button onClick={closeWin}
          data-testid="idcard-close-btn"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          <X size={12} /> Close
        </button>
      </div>

      {/* PDF iframe fills the remainder of the popup */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 grid place-items-center text-slate-500 text-sm">
            <div className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading ID card…
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="text-center max-w-md">
              <div className="text-sm font-semibold text-red-700">Failed to load ID card</div>
              <div className="text-xs text-slate-600 mt-1">{error}</div>
            </div>
          </div>
        )}
        {pdfSrc && !error && (
          <iframe ref={iframeRef}
            src={pdfSrc}
            title="Worker ID card preview"
            data-testid="idcard-iframe"
            className="absolute inset-0 w-full h-full border-0 bg-white" />
        )}
      </div>

      {/* Print stylesheet — hide the header controls so the paper only
          shows the PDF payload. 20 mm margins for a clean A6 print. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 20mm; }
          body, html { background: white !important; }
        }
      `}</style>
    </div>
  );
}
