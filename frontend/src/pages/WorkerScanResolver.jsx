// Phase 4.1 — Public worker QR resolver. Shows a sanitised profile + lets an
// authed user sign the worker in to a site.
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Loader2, AlertTriangle, ShieldCheck, ShieldAlert, FileText, MapPin, ArrowRight, LogIn, CheckCircle2, X } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getToken } from '../lib/auth';
import Logo from '../components/brand/Logo';

const PUBLIC = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Slugify free-text IDs (Simpro returns site IDs with spaces / punctuation,
// which become invalid as data-testid attribute selectors verbatim).
const slug = (v) =>
  String(v || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unknown';

// Tiny debounce — we don't want to hammer /pickers/sites on every keystroke.
function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const certTone = (status) => {
  const s = (status || '').toLowerCase();
  if (s === 'expired') return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (s === 'expiring' || s === 'expiring_soon') return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
};

export default function WorkerScanResolver() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', profile: null, err: null });
  const [signInOpen, setSignInOpen] = useState(false);
  const [sites, setSites] = useState([]);
  const [siteQ, setSiteQ] = useState('');
  const debouncedQ = useDebounced(siteQ, 300);
  const [signing, setSigning] = useState(false);
  const isAuthed = !!getToken();

  useEffect(() => {
    let alive = true;
    axios.get(`${PUBLIC}/scan/worker/${token}`)
      .then((r) => { if (alive) setState({ status: 'ok', profile: r.data, err: null }); })
      .catch((e) => {
        if (!alive) return;
        const code = e?.response?.status;
        setState({ status: code === 404 ? 'not_found' : 'error', profile: null, err: e?.response?.data?.detail || e.message });
      });
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    if (!signInOpen || !isAuthed) return;
    api.get('/forms/pickers/sites', { params: { q: debouncedQ || undefined, limit: 12 } })
      .then((r) => setSites(r.data?.sites || []))
      .catch(() => setSites([]));
  }, [signInOpen, isAuthed, debouncedQ]);

  const doSignIn = async (site) => {
    setSigning(true);
    try {
      let gps = null;
      try {
        gps = await new Promise((resolve) => {
          navigator.geolocation?.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => resolve(null), { timeout: 2500 });
        });
      } catch { /* noop */ }
      await api.post(`/scan/worker/${token}/site-signin`, {
        site_id: site.id, site_name: site.name, gps,
      });
      toast.success(`Signed in to ${site.name}`);
      setSignInOpen(false);
      // Refetch profile to pick up active_site_today.
      const r = await axios.get(`${PUBLIC}/scan/worker/${token}`);
      setState((s) => ({ ...s, profile: r.data }));
    } catch (e) { toast.error(apiError(e)); }
    finally { setSigning(false); }
  };

  if (state.status === 'loading') {
    return <Centered><Loader2 size={22} className="animate-spin inline mr-2 text-blue-600" /> Loading worker profile…</Centered>;
  }
  if (state.status === 'not_found') {
    return <Centered><AlertTriangle className="text-rose-500 inline mr-2" /> Unknown worker QR. The card may have been retired.</Centered>;
  }
  if (state.status === 'error') {
    return <Centered><AlertTriangle className="text-amber-500 inline mr-2" /> {state.err}</Centered>;
  }

  const p = state.profile;

  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center p-4 sm:p-6">
      <div className="w-full max-w-2xl space-y-4">
        <header className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex items-center gap-2 shadow-sm">
          <Logo />
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-400 ml-auto">Worker QR</span>
        </header>

        {/* Profile */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm" data-testid="worker-profile">
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0 ring-4 ring-blue-100">
              {p.photo_url
                ? <img src={p.photo_url} alt="" className="w-20 h-20 rounded-2xl object-cover" />
                : <span className="font-display text-2xl font-bold text-blue-700">{(p.name || '?').slice(0, 2).toUpperCase()}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">WORKER · {p.company}</div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900" data-testid="worker-name">{p.name}</h1>
              {(p.trade || p.role) && <div className="text-sm text-slate-600 mt-0.5">{p.trade || p.role}</div>}
              {p.active_site_today && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-bold">
                  <CheckCircle2 size={12} /> Signed in to {p.active_site_today.name}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Certifications */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm" data-testid="worker-certs">
          <h2 className="font-display font-bold text-slate-900 mb-3 inline-flex items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-600" /> Certifications
            <span className="text-[10px] uppercase tracking-wider text-slate-400">{p.certifications.length}</span>
          </h2>
          {p.certifications.length === 0 ? (
            <p className="text-xs text-slate-500">No certifications on file.</p>
          ) : (
            <ul className="space-y-1.5">
              {p.certifications.map((c, i) => (
                <li key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg ring-1 ${certTone(c.status)}`}>
                  <div className="font-semibold text-xs">{c.name}</div>
                  <div className="text-[10px] uppercase font-bold">{c.status || 'current'}{c.expires_at ? ` · ${c.expires_at.slice(0, 10)}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Assigned SWMS */}
        {p.assigned_swms.length > 0 && (
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm" data-testid="worker-swms">
            <h2 className="font-display font-bold text-slate-900 mb-3 inline-flex items-center gap-2">
              <FileText size={16} className="text-blue-600" /> Assigned SWMS
            </h2>
            <ul className="space-y-1.5">
              {p.assigned_swms.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200">
                  <div className="text-xs font-semibold text-slate-900">{s.title} <span className="text-slate-400">v{s.version}</span></div>
                  {s.ack_required && <span className="text-[10px] uppercase font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Ack req.</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Sign-in CTA */}
        {isAuthed ? (
          <button onClick={() => setSignInOpen(true)}
            data-testid="worker-signin-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 shadow-md">
            <LogIn size={15} /> Sign in to site
          </button>
        ) : (
          <button onClick={() => navigate(`/login?next=${encodeURIComponent(`/scan/worker/${token}`)}`)}
            data-testid="worker-signin-anon"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 shadow-md">
            Log in to sign in <ArrowRight size={15} />
          </button>
        )}

        <p className="text-center text-[10px] uppercase tracking-wider text-slate-400 pb-4">
          Token <span className="font-mono">{token}</span> · Paneltec Civil
        </p>
      </div>

      {/* Sign-in modal */}
      {signInOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-3"
             onClick={(e) => e.target === e.currentTarget && setSignInOpen(false)}
             data-testid="signin-modal">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[80vh] flex flex-col">
            <div className="px-5 py-3 border-b flex items-center">
              <h3 className="font-display font-bold text-slate-900 flex-1">Pick a site to sign in to</h3>
              <button onClick={() => setSignInOpen(false)} data-testid="signin-close"><X size={16} /></button>
            </div>
            <div className="px-5 py-3 border-b">
              <input type="search" value={siteQ} onChange={(e) => setSiteQ(e.target.value)}
                placeholder="Search sites…" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                data-testid="signin-search" />
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-1">
              {sites.length === 0 && <li className="px-3 py-3 text-xs text-slate-500">No sites found.</li>}
              {sites.map((s) => (
                <li key={s.id}>
                  <button onClick={() => doSignIn(s)} disabled={signing}
                    className="w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-slate-50 border border-slate-200 disabled:opacity-50"
                    data-testid={`signin-site-${slug(s.id)}`}>
                    <MapPin size={13} className="text-emerald-600" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">{s.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">{s.address || s.suburb || ''}</div>
                    </div>
                    <ArrowRight size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function Centered({ children }) {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="bg-white border border-slate-200 rounded-2xl px-6 py-10 max-w-md text-center text-sm text-slate-600 shadow-sm">{children}</div>
    </div>
  );
}
