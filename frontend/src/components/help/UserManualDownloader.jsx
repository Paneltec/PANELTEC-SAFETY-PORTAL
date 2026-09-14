// v58.13.132ge — Reusable, PIN-gated download of the platform manual.
//
// Shares the same UX as `MyProfile.jsx::ManualDownloadCard` (.132gd)
// but exposes only the button + modal so pages like the Live
// Compliance Dashboard can drop a "User Manual" affordance without
// duplicating the axios blob + error-body plumbing.

import React, { useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';

function PinDigits({ value, onChange, testId, autoFocus }) {
  return (
    <input
      type="password"
      inputMode="numeric"
      pattern="\d{4}"
      maxLength={4}
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      data-testid={testId}
      placeholder="••••"
      className="w-full tracking-[0.6em] text-center text-lg font-mono border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
    />
  );
}

/**
 * Renders a small "User Manual" pill button that opens a PIN prompt
 * and streams the docx via the `/api/docs/manual.docx` endpoint.
 *
 * @param {{
 *   testId?: string,
 *   className?: string,
 *   children?: React.ReactNode,
 * }} props
 */
export default function UserManualDownloader({
  testId = 'user-manual-download-btn',
  className = '',
  children,
}) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const start = () => { setPin(''); setOpen(true); };
  const close = () => { if (!busy) setOpen(false); };

  const submit = async () => {
    if (!/^\d{4}$/.test(pin)) {
      toast.error('PIN must be exactly 4 digits'); return;
    }
    setBusy(true);
    try {
      const resp = await api.get('/docs/manual.docx', {
        responseType: 'blob',
        headers: { 'X-Admin-Console-Pin': pin },
      });
      const blob = new Blob([resp.data], {
        type: 'application/vnd.openxmlformats-officedocument.'
              + 'wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'paneltec_group_platform_manual.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('User manual downloaded');
      setOpen(false);
    } catch (e) {
      let detail = '';
      try {
        const txt = await (e?.response?.data?.text?.() || Promise.resolve(''));
        if (txt) {
          try { detail = JSON.parse(txt).detail; } catch { detail = txt; }
        }
      } catch { /* fallthrough */ }
      toast.error(detail || apiError(e) || 'Manual download failed');
    } finally { setBusy(false); }
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        data-testid={testId}
        className={className}
      >
        {children || 'User Manual'}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={close}
          data-testid={`${testId}-modal`}
        >
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 text-sm font-semibold text-slate-900">
              Download platform manual
            </div>
            <div className="p-5 space-y-3">
              <div className="text-[13px] text-slate-600">
                Enter your 4-digit admin-console PIN. The manual
                streams as a Word document from the current pod
                (v58.13.132gc onwards).
              </div>
              <PinDigits
                value={pin}
                onChange={setPin}
                testId={`${testId}-pin-input`}
                autoFocus
              />
              <div className="text-[11px] text-slate-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                Shared rate limiter with the admin console
                (3/30 s → 6/15 min lockout tiers).
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                data-testid={`${testId}-cancel`}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || !/^\d{4}$/.test(pin)}
                data-testid={`${testId}-submit`}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Downloading…' : 'Download'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
