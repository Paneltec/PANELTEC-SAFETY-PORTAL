// Phase 3.10 / v146 — Settings → System page. Admin-only.
// Shows the install status of optional server toolchains (LibreOffice,
// Tesseract OCR, Poppler) and a single "Install all server tools" button.
//
// v146 fix: install is now a background job on the backend. POST returns
// 202 immediately with a `job_id`; we poll `/admin/server-tools/health`
// every 5 s and render `install_log_tail` live. Fixes the "goes part of
// the way then stops" symptom caused by Cloudflare/ingress killing the
// long-running synchronous HTTP request while apt-get kept installing.
// If the page is reloaded mid-install we detect `install_running=true`
// on mount and resume the polling loop automatically — no orphan
// spinners.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, FileText, Settings as Cog } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import SessionTimeoutCard from '../components/settings/SessionTimeoutCard';

// Phase 3.20 Wave 2 — lucide row-action/toolbar icons swapped
// to @fluentui/react-icons. Aliased back to the original lucide
// names so existing JSX call sites don't need to change.
import {
  ArrowDownload20Regular as Download,
  ArrowSync20Regular as RefreshCw,
  Eye20Regular as Eye,
} from '@fluentui/react-icons';

const POLL_INTERVAL_MS   = 5_000;
const POLL_CEILING_MS    = 25 * 60 * 1000;  // 25 min belt-and-braces

export default function SystemSettings() {
  const me = getUser();
  const canInstall = me?.role === 'admin';
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [logTail, setLogTail] = useState('');
  const [exitCode, setExitCode] = useState(null);
  const [jobId, setJobId] = useState(null);
  const pollTimer = useRef(null);
  const pollStartedAt = useRef(0);

  const normTools = (h) => ({
    libreoffice: { installed: !!h?.libreoffice?.ok, version: h?.libreoffice?.version || null, path: h?.libreoffice?.path || null },
    tesseract:   { installed: !!h?.tesseract?.ok,   version: h?.tesseract?.version   || null, path: h?.tesseract?.path   || null },
    poppler:     { installed: !!h?.poppler?.ok,     version: h?.poppler?.version     || null, path: h?.poppler?.path     || null },
  });

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const applyHealth = useCallback((h) => {
    setStatus(normTools(h));
    setLogTail(h?.install_log_tail || '');
    setExitCode(h?.install_exit_code ?? null);
    setJobId(h?.install_job_id || null);
    return !!h?.install_running;
  }, []);

  const pollTick = useCallback(async () => {
    try {
      const r = await api.get('/admin/server-tools/health');
      const stillRunning = applyHealth(r.data);
      const allOk = r.data?.libreoffice?.ok && r.data?.tesseract?.ok && r.data?.poppler?.ok;
      const elapsed = Date.now() - pollStartedAt.current;
      if (!stillRunning || allOk || elapsed > POLL_CEILING_MS) {
        stopPolling();
        setInstalling(false);
        if (!stillRunning && r.data?.install_exit_code === 0 && allOk) {
          toast.success('LibreOffice + OCR installed — XLSX / PPTX / OCR now available.');
        } else if (!stillRunning && r.data?.install_exit_code !== 0 && r.data?.install_exit_code !== null) {
          toast.error(`Install finished with exit code ${r.data.install_exit_code} — check log below.`);
        } else if (elapsed > POLL_CEILING_MS) {
          toast.error('Install still running after 25 min — check server logs.');
        }
      }
    } catch (e) {
      // Transient network hiccup — keep polling; the ceiling will stop us.
      // Only surface a toast on the very first tick.
    }
  }, [applyHealth, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollStartedAt.current = Date.now();
    pollTimer.current = setInterval(pollTick, POLL_INTERVAL_MS);
  }, [pollTick, stopPolling]);

  // Initial mount — fetch health once, and resume polling if a job is
  // already running server-side (page reload mid-install).
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/server-tools/health');
      const running = applyHealth(r.data);
      if (running) {
        setInstalling(true);
        startPolling();
      }
    } catch (e) {
      toast.error(apiError(e));
    } finally { setLoading(false); }
  }, [applyHealth, startPolling]);
  useEffect(() => {
    refresh();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = async () => {
    if (!canInstall || installing) return;
    setInstalling(true);
    setLogTail('');
    setExitCode(null);
    try {
      const r = await api.post('/admin/install-libreoffice', null, {
        params: { include_ocr: true }, timeout: 15_000,
      });
      setJobId(r.data?.job_id || null);
      startPolling();
    } catch (e) {
      // 409 = already running → just attach to the running job.
      if (e?.response?.status === 409) {
        const running = e.response.data?.detail || {};
        setJobId(running.job_id || null);
        toast.info('An install is already running — attached to the existing job.');
        startPolling();
        return;
      }
      toast.error(apiError(e));
      setInstalling(false);
    }
  };

  const showLog = installing || (exitCode !== null && exitCode !== 0) || (logTail && !status?.libreoffice?.installed);

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
              <b className="text-slate-700"> ~5–10 min · ~650 MB total.</b>
              {' '}Runs as a background job — safe to reload this page mid-install.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refresh} disabled={loading || installing}
              data-testid="refresh-status"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw />} Run health check
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
          <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg"
             data-testid="install-progress-note">
            Installing in the background — polling every 5 s. Safe to leave the tab open
            or reload the page; the install continues server-side and this panel
            re-attaches on next visit.
            {jobId && <span className="ml-2 font-mono text-[10px] opacity-60">job {jobId.slice(0, 8)}…</span>}
          </p>
        )}
        {showLog && logTail && (
          <details className="mt-4" open>
            <summary className="cursor-pointer text-[11px] font-bold text-slate-600 select-none">
              Install log (last 50 lines) {installing && <span className="text-amber-600">· live</span>}
            </summary>
            <pre data-testid="install-log"
                 className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-900 text-emerald-300 text-[11px] p-3 font-mono whitespace-pre-wrap">
              {logTail}
            </pre>
          </details>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-[11px] text-slate-600">
        <b className="text-slate-800">Today (Phase A — pragmatic):</b> PDFs, images
        (JPG / PNG / WEBP / HEIC), CSV, TXT, MD, and DOCX (via text-fallback
        renderer) are already PDF-viewable. Installing the toolchain above
        promotes DOCX to full-fidelity rendering and unlocks XLSX / PPTX / ODT.
      </div>

      {canInstall && (
        <div className="mt-6">
          <SessionTimeoutCard />
        </div>
      )}
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
