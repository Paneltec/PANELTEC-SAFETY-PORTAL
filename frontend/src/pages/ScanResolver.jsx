// Public QR scan landing page — resolves /scan/:token and either redirects to
// login (if anonymous) or shows asset detail with quick actions. Phase 2 will
// extend this to push assets into an active form-fill session via sessionStorage.
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, MapPin, Copy, ArrowRight, AlertTriangle, Truck, Wrench, Archive } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { getToken } from '../lib/auth';
import Logo from '../components/brand/Logo';

const PUBLIC_BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ScanResolver() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', asset: null, err: null });

  useEffect(() => {
    let alive = true;
    // Public endpoint — no Bearer needed.
    axios.get(`${PUBLIC_BASE}/assets/scan/${token}`)
      .then((r) => {
        // Deep-link to a form fill: stash in sessionStorage and redirect.
        try {
          const sp = new URLSearchParams(window.location.search);
          const formId = sp.get('form');
          if (formId && getToken()) {
            sessionStorage.setItem('paneltec.activeScan', JSON.stringify({
              scan_token: token, at: Date.now(), form_id: formId,
            }));
            navigate(`/app/forms?template=${encodeURIComponent(formId)}&scan=${encodeURIComponent(token)}`, { replace: true });
            return;
          }
        } catch { /* fall through to default view */ }
        if (alive) setState({ status: 'ok', asset: r.data, err: null });
      })
      .catch((e) => {
        if (!alive) return;
        const code = e?.response?.status;
        if (code === 404) setState({ status: 'not_found', asset: null, err: 'Unknown scan token' });
        else if (code === 410) setState({ status: 'retired', asset: null, err: 'Asset retired' });
        else setState({ status: 'error', asset: null, err: e?.response?.data?.detail || e.message });
      });
    return () => { alive = false; };
  }, [token]);

  const isAuthed = !!getToken();

  // If not authed and we have a hit, ask user to sign in. We DON'T auto-redirect
  // for unknown/retired tokens — show a clear error first.
  const goLogin = () => navigate(`/login?next=${encodeURIComponent(`/scan/${token}`)}`);

  const copyLink = () => {
    const url = `${window.location.origin}/scan/${token}`;
    navigator.clipboard?.writeText(url).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy link'),
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden" data-testid="scan-resolver">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-2">
          <Logo />
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-400 ml-auto">QR Scan</span>
        </div>
        <div className="px-6 py-6">
          {state.status === 'loading' && (
            <div className="text-center py-10 text-sm text-slate-500" data-testid="scan-loading">
              <Loader2 size={22} className="animate-spin inline mr-2 text-blue-600" />
              Resolving asset…
            </div>
          )}
          {state.status === 'not_found' && (
            <div className="text-center py-6" data-testid="scan-not-found">
              <div className="inline-flex w-14 h-14 rounded-2xl bg-rose-50 items-center justify-center mb-3"><AlertTriangle size={22} className="text-rose-600" /></div>
              <h2 className="font-display text-xl font-bold">Unknown scan token</h2>
              <p className="mt-2 text-sm text-slate-600">This QR isn&apos;t linked to any asset in Paneltec Civil. It may have been retired or mistyped.</p>
              <p className="mt-3 text-[11px] text-slate-400 font-mono">{token}</p>
            </div>
          )}
          {state.status === 'retired' && (
            <div className="text-center py-6" data-testid="scan-retired">
              <div className="inline-flex w-14 h-14 rounded-2xl bg-slate-100 items-center justify-center mb-3"><Archive size={22} className="text-slate-500" /></div>
              <h2 className="font-display text-xl font-bold">Asset retired</h2>
              <p className="mt-2 text-sm text-slate-600">The asset that owns this tag has been retired. Contact your supervisor for replacement.</p>
            </div>
          )}
          {state.status === 'error' && (
            <div className="text-center py-6" data-testid="scan-error">
              <div className="inline-flex w-14 h-14 rounded-2xl bg-amber-50 items-center justify-center mb-3"><AlertTriangle size={22} className="text-amber-600" /></div>
              <h2 className="font-display text-xl font-bold">Something went wrong</h2>
              <p className="mt-2 text-sm text-slate-600">{state.err || 'Try again in a moment.'}</p>
            </div>
          )}
          {state.status === 'ok' && state.asset && (
            <div data-testid="scan-card">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                  {state.asset.kind === 'vehicle' ? <Truck size={22} className="text-blue-700" /> : <Wrench size={22} className="text-blue-700" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{(state.asset.kind || '').toUpperCase()}{state.asset.asset_type ? ` · ${state.asset.asset_type.replace(/_/g, ' ').toUpperCase()}` : ''}</div>
                  <h2 className="font-display text-xl font-bold text-slate-900 truncate" data-testid="scan-name">{state.asset.name}</h2>
                  {state.asset.rego_serial && (
                    <div className="mt-1 inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-sm font-mono font-bold text-slate-900" data-testid="scan-rego">{state.asset.rego_serial}</div>
                  )}
                </div>
              </div>

              {!isAuthed && (
                <div className="mt-5 px-3 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-center gap-2" data-testid="scan-signin-hint">
                  Sign in to view location, history & link this asset into a form.
                </div>
              )}

              <div className="mt-5 space-y-2">
                {isAuthed ? (
                  <Link to={`/app/vehicles?focus=${state.asset.id}`}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50"
                    data-testid="scan-view-asset">
                    <span className="text-sm font-semibold text-slate-900">View asset in register</span>
                    <ArrowRight size={15} className="text-slate-400" />
                  </Link>
                ) : (
                  <button onClick={goLogin}
                    className="w-full inline-flex items-center justify-between px-3 py-2.5 rounded-xl bg-blue-600 text-white"
                    data-testid="scan-signin">
                    <span className="text-sm font-bold">Sign in to continue</span>
                    <ArrowRight size={15} />
                  </button>
                )}
                {state.asset.has_position && state.asset.last_known_lat && (
                  <a target="_blank" rel="noreferrer"
                    href={`https://www.google.com/maps?q=${state.asset.last_known_lat},${state.asset.last_known_lng}`}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50"
                    data-testid="scan-locate">
                    <span className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5"><MapPin size={14} className="text-emerald-600" /> Locate on map</span>
                    <ArrowRight size={15} className="text-slate-400" />
                  </a>
                )}
                <button onClick={copyLink}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50"
                  data-testid="scan-copy">
                  <span className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5"><Copy size={14} /> Copy scan link</span>
                  <ArrowRight size={15} className="text-slate-400" />
                </button>
              </div>

              <div className="mt-5 text-[10px] uppercase tracking-wider text-slate-400">Token <span className="font-mono">{token}</span></div>
            </div>
          )}
        </div>
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-500">
          Paneltec Civil · Plant & Vehicles Register
        </div>
      </div>
    </div>
  );
}
