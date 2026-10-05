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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, FileText, Settings as Cog } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { useCan } from '../lib/permissions';
import SessionTimeoutCard from '../components/settings/SessionTimeoutCard';
import AppUpdateCard from '../components/settings/AppUpdateCard';

// Phase 3.20 Wave 2 — lucide row-action/toolbar icons swapped
// to @fluentui/react-icons. Aliased back to the original lucide
// names so existing JSX call sites don't need to change.
import {
  ArrowDownload20Regular as Download,
  ArrowSync20Regular as RefreshCw,
  Eye20Regular as Eye,
} from '@fluentui/react-icons';

const POLL_INTERVAL_MS   = 5_000;
const POLL_CEILING_MS    = 25 * 60 * 1000;  // 25 min belt-and-braces (manual install)
const AUTO_POLL_CEILING_MS = 5 * 60 * 1000; // v152 — 5 min cap for auto-poll on
                                            // mount-when-not-ok (prevents forever
                                            // polling if apt is genuinely broken).

export default function SystemSettings() {
  const me = getUser();
  // v160.3.9.29-2a — Migrated from `me?.role === 'admin'` (identity)
  // to the granular users.edit token. `me` retained for other uses.
  const can = useCan();
  const canInstall = can('users', 'edit');
  void me;
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [logTail, setLogTail] = useState('');
  const [exitCode, setExitCode] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [autoHealing, setAutoHealing] = useState(false);
  const pollTimer = useRef(null);
  const pollStartedAt = useRef(0);
  const autoHealingRef = useRef(false);

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
      // v152 — auto-heal cycles get a tighter cap so we don't loop
      // forever on a genuinely broken pod.
      const ceiling = autoHealingRef.current ? AUTO_POLL_CEILING_MS : POLL_CEILING_MS;
      // v152 — stop when: all three green AND no install running, OR
      // wall-clock cap. Note we now poll even when install_running=false
      // (auto-heal case), so `!stillRunning` alone is NOT a stop signal
      // anymore — a green result is.
      const done = (allOk && !stillRunning) || elapsed > ceiling;
      if (done) {
        stopPolling();
        setInstalling(false);
        if (allOk && !stillRunning && autoHealingRef.current) {
          // Silent success on auto-heal — a toast here would be noisy.
          autoHealingRef.current = false;
          setAutoHealing(false);
        } else if (!stillRunning && r.data?.install_exit_code === 0 && allOk) {
          toast.success('LibreOffice + OCR installed — XLSX / PPTX / OCR now available.');
        } else if (!stillRunning && r.data?.install_exit_code !== 0 && r.data?.install_exit_code !== null) {
          toast.error(`Install finished with exit code ${r.data.install_exit_code} — check log below.`);
        } else if (elapsed > ceiling) {
          if (autoHealingRef.current) {
            // Fell off the auto-heal cap — apt is likely broken, show a
            // subtle nudge but don't panic.
            toast.error('Server tools still missing after 5 min — click Install now or check server logs.');
            autoHealingRef.current = false;
            setAutoHealing(false);
          } else {
            toast.error('Install still running after 25 min — check server logs.');
          }
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
      const allOk = r.data?.libreoffice?.ok && r.data?.tesseract?.ok && r.data?.poppler?.ok;
      if (running) {
        setInstalling(true);
        autoHealingRef.current = false;
        setAutoHealing(false);
        startPolling();
      } else if (!allOk) {
        autoHealingRef.current = true;
        setAutoHealing(true);
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
        <Link to="/app/settings" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 mb-1" data-testid="page-back-to-settings">
          ← Back to Settings
        </Link>
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

      <AppUpdateCard />

      <div className="grid md:grid-cols-3 gap-4 mb-6" data-testid="tools-grid">
        <ToolCard
          icon={FileText} title="LibreOffice"
          purpose="DOCX / XLSX / PPTX / ODT / RTF → PDF"
          tool={status?.libreoffice}
          loading={loading}
          autoHealing={autoHealing}
          testid="tool-libreoffice"
        />
        <ToolCard
          icon={Eye} title="Tesseract OCR"
          purpose="Extract text from scanned PDFs and photos"
          tool={status?.tesseract}
          loading={loading}
          autoHealing={autoHealing}
          testid="tool-tesseract"
        />
        <ToolCard
          icon={Download} title="Poppler (pdftotext)"
          purpose="PDF text extraction for Smart Search indexing"
          tool={status?.poppler}
          loading={loading}
          autoHealing={autoHealing}
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

      {canInstall && <PurgeTestDataCard />}
    </div>
  );
}

// v58.13.81 — Purge Test Data (admin-only "danger zone" card).
// v58.13.102 — Modal restructured for viewport safety: header + count
// summary stay pinned at the top, table scrolls in the middle, and
// the ack checkbox + Cancel/Delete row is now a sticky footer that
// can never fall below the fold on short viewports (the .101 friction
// root cause was the checkbox being centered off-screen on smaller
// windows). Ack checkbox itself is now h-5 w-5 (touch-friendly) and
// auto-focuses when the dry-run payload loads.
function PurgeTestDataCard() {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [dry, setDry] = React.useState(null);   // dry-run response payload
  const [ack, setAck] = React.useState(false);  // "I understand" checkbox
  const [busy, setBusy] = React.useState(false);
  const ackRef = React.useRef(null);
  // v58.13.102 — Auto-focus the ack checkbox as soon as the dry-run
  // payload lands. Keyboard users get Space-to-toggle immediately; mouse
  // users see the focus ring, which is a visual signal for "this is
  // the next thing to interact with".
  React.useEffect(() => {
    if (open && dry && dry.grand_total > 0 && !ack && ackRef.current) {
      try { ackRef.current.focus({ preventScroll: false }); } catch { /* ignore */ }
    }
  }, [open, dry, ack]);
  const startDryRun = async () => {
    setLoading(true); setDry(null); setAck(false); setOpen(true);
    try {
      const r = await api.post('/admin/purge-test-data?dry_run=1');
      setDry(r.data);
    } catch (e) { toast.error(apiError(e)); setOpen(false); }
    finally { setLoading(false); }
  };
  const confirmDelete = async () => {
    if (!ack || busy || !dry) return;
    setBusy(true);
    try {
      const r = await api.post('/admin/purge-test-data?dry_run=0');
      toast.success(`Purge complete — ${r.data.grand_total} rows deleted`);
      setOpen(false); setDry(null); setAck(false);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div id="purge-test-data" className="mt-6 rounded-2xl border-2 border-rose-300 bg-white p-4 shadow-sm scroll-mt-24" data-testid="purge-test-data-card">
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-50 text-rose-700"><XCircle size={16} /></span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-900">Purge Test Data</div>
          <div className="text-[10px] text-slate-500">Danger zone · admin only · irreversible</div>
        </div>
        <button onClick={startDryRun}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-rose-300 text-rose-700 hover:bg-rose-50"
          data-testid="purge-test-data-open">Preview matches…</button>
      </div>
      <div className="mt-2 text-[11px] text-slate-600">
        Hard-deletes rows in <b>assets, workers, sites, forms, doc_files, cs_incident_issues</b> etc. whose name/title matches a test-data pattern (<code className="text-slate-500">TEST-*, demo-*, sample-*, pytest-*, …</code>). Simpro-imported rows are always excluded. Every delete is written to an audit log.
      </div>

      {open && (
        <div className="fixed inset-0 z-[90] bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !busy && setOpen(false)}
          role="dialog" aria-modal="true" aria-labelledby="purge-modal-title"
          data-testid="purge-test-data-modal">
          {/* v58.13.102 — Inner container is a bounded flex column:
              header (h3 + count summary) sits at top, table scrolls in
              the middle (flex-1 min-h-0 overflow-y-auto), footer
              (ack + Cancel + Delete) sticks at the bottom via mt-auto
              inside the flex column. Modal max-height is capped so it
              never bleeds off short viewports. */}
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[calc(100vh-2rem)]"
            onClick={(e) => e.stopPropagation()}
            data-testid="purge-test-data-modal-inner">
            <div className="px-6 pt-6 pb-2 flex-shrink-0">
              <h3 id="purge-modal-title" className="font-display font-bold text-slate-900 text-lg">Purge Test Data — preview</h3>
              {loading && <div className="mt-4 text-slate-500 text-sm">Loading matches…</div>}
              {!loading && dry && (
                <p className="text-xs text-slate-500 mt-1">This cannot be undone. Grand total: <b className="text-slate-900" data-testid="purge-total">{dry.grand_total}</b> rows across {dry.matches.length} collection(s).</p>
              )}
            </div>
            {!loading && dry && (
              <div className="px-6 flex-1 min-h-0 overflow-y-auto" data-testid="purge-test-data-modal-scroll">
                <div className="mt-1 border border-slate-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                      <tr><th className="text-left px-3 py-2">Collection</th><th className="text-right px-3 py-2">Count</th><th className="text-left px-3 py-2">Sample names</th></tr>
                    </thead>
                    <tbody>
                      {dry.matches.map((m) => (
                        <tr key={m.collection} className="border-t border-slate-100" data-testid={`purge-row-${m.collection}`}>
                          <td className="px-3 py-2 font-mono">{m.collection}</td>
                          <td className="px-3 py-2 text-right font-semibold">{m.count}</td>
                          <td className="px-3 py-2 text-slate-500 truncate max-w-[280px]" title={m.samples.join(' · ')}>{m.samples.join(' · ')}</td>
                        </tr>
                      ))}
                      {dry.matches.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">No test-data rows found. Nothing to delete.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {!loading && dry && (
              <div className="px-6 pt-4 pb-6 border-t border-slate-200 bg-white rounded-b-2xl flex-shrink-0"
                data-testid="purge-test-data-modal-footer">
                {/* v58.13.102 — Ack row gets its own highlighted rose
                    strip when unticked so it visually screams "click
                    me to proceed". Checkbox itself is h-5 w-5
                    (touch-friendly, was default ~13px). */}
                <label
                  className={`flex items-start gap-3 text-sm cursor-pointer rounded-lg px-3 py-2.5 border ${!ack && dry.grand_total > 0 ? 'bg-rose-50 border-rose-300 text-rose-900' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                  <input
                    ref={ackRef}
                    type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)}
                    disabled={dry.grand_total === 0}
                    className="mt-0.5 h-5 w-5 accent-rose-600 shrink-0 cursor-pointer"
                    data-testid="purge-ack" />
                  <span className="font-medium leading-snug">I understand this cannot be undone. All matched rows will be permanently deleted.</span>
                </label>
                <div className="mt-3 flex items-center justify-end gap-3">
                  {/* v58.13.101 — Explicit "why is the button disabled?"
                      hint. Retained under .102's restructure — now
                      lives inside the sticky footer so it's always
                      visible when the ack is unticked. */}
                  {!ack && dry.grand_total > 0 && !busy && (
                    <span className="text-[11px] font-semibold text-rose-700 flex items-center gap-1.5"
                      data-testid="purge-ack-required-hint">
                      <span aria-hidden="true">←</span> Tick the checkbox above to enable delete
                    </span>
                  )}
                  <button onClick={() => setOpen(false)} disabled={busy}
                    className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
                    data-testid="purge-cancel">Cancel</button>
                  <button onClick={confirmDelete} disabled={!ack || busy || dry.grand_total === 0}
                    className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="purge-confirm">
                    {busy ? 'Deleting…' : `Delete ${dry.grand_total} records permanently`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCard({ icon: Icon, title, purpose, tool, loading, testid, autoHealing }) {
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
               : autoHealing ? <Loader2 size={14} className="text-blue-500 animate-spin" data-testid={`${testid}-autohealing`} />
                             : <XCircle size={16} className="text-slate-400" data-testid={`${testid}-missing`} />}
      </div>
      <div className="mt-2.5 text-[11px] text-slate-600 font-mono break-all min-h-[2.5em]">
        {loading ? '…'
          : ok ? (tool.version || tool.path || 'Installed')
               : autoHealing ? <span className="text-blue-600 italic not-italic font-sans">Auto-install pending…</span>
                             : <span className="text-slate-400 italic">Not installed</span>}
      </div>
    </div>
  );
}
