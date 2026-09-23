// v58.13.132ld — Dropbox OAuth callback landing.
//
// Public route (outside `/app/*`, listed in `PUBLIC_ROUTE_PREFIXES`).
// Dropbox redirects the browser here after the user approves the
// authorize request. We pull `?code=&state=` from the URL, POST them
// to `/api/dropbox/oauth/callback` for server-side exchange, and
// render a simple confirmation so the admin can close the tab.
//
// The window.opener/postMessage handshake is best-effort so the
// Integrations page (which opened this popup) can flip its
// "Connect Dropbox" button state to Connected without waiting on
// the /health poll — but the poll is still the source of truth if
// the tab was opened without an opener (e.g. same-tab navigation).

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import api from '../lib/api';

export default function DropboxCallback() {
  const [state, setState] = useState('exchanging'); // exchanging | ok | error
  const [detail, setDetail] = useState(null);
  const ranRef = useRef(false); // guard against React 18 StrictMode double-mount

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const stateTok = params.get('state');
    const dbxErr = params.get('error');

    if (dbxErr) {
      setState('error');
      setDetail(params.get('error_description') || dbxErr);
      return;
    }
    if (!code || !stateTok) {
      setState('error');
      setDetail('Missing `code` or `state` in callback URL.');
      return;
    }

    api.post('/dropbox/oauth/callback', { code, state: stateTok })
      .then(({ data }) => {
        setState('ok');
        setDetail(data);
        try {
          // Best-effort — notify the Integrations tab that opened this popup.
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(
              { type: 'dropbox-oauth-connected', account_email: data?.account_email },
              window.location.origin,
            );
          }
        } catch (_) { /* ignore */ }
      })
      .catch((err) => {
        setState('error');
        setDetail(err?.response?.data?.detail || err?.message || 'Unknown error');
      });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"
         data-testid="dropbox-callback-page">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
        {state === 'exchanging' && (
          <div className="flex flex-col items-center text-center gap-3" data-testid="dropbox-cb-exchanging">
            <Loader2 className="w-10 h-10 text-brand-blue animate-spin" />
            <h1 className="font-display text-xl font-semibold">Connecting to Dropbox…</h1>
            <p className="text-sm text-slate-600">
              Exchanging authorization code for a persistent refresh token.
            </p>
          </div>
        )}
        {state === 'ok' && (
          <div className="flex flex-col items-center text-center gap-3" data-testid="dropbox-cb-ok">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <h1 className="font-display text-xl font-semibold">Dropbox connected</h1>
            {detail?.account_email && (
              <p className="text-sm text-slate-700">
                Signed in as <b>{detail.account_email}</b>
              </p>
            )}
            <p className="text-xs text-slate-500 max-w-xs">
              You can close this tab. The Integrations page will refresh
              automatically.
            </p>
            <button
              type="button"
              onClick={() => { try { window.close(); } catch (_) {} }}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
              data-testid="dropbox-cb-close-btn"
            >
              Close tab
            </button>
          </div>
        )}
        {state === 'error' && (
          <div className="flex flex-col items-center text-center gap-3" data-testid="dropbox-cb-error">
            <XCircle className="w-10 h-10 text-rose-500" />
            <h1 className="font-display text-xl font-semibold">Dropbox connect failed</h1>
            <p className="text-sm text-slate-600 break-words max-w-xs">{String(detail || '')}</p>
            <p className="text-xs text-slate-500">
              Please return to the Integrations page and try again.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
