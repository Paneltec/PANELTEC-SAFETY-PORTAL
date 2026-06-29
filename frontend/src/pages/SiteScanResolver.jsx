// Phase 4.2 — Public Site Induction QR landing page.
//
// Anyone holding a valid /scan/site/{token} URL can see site info + active
// SWMS list. Signing on requires auth — unauth users get bounced through
// /login with a `?next=` so they auto-return after authenticating.
//
// Backend contract:
//   GET  /api/scan/site/{token}          (public) → {site, active_swms, signon_url}
//   POST /api/scan/site/{token}/sign-on  (auth)   → confirmation
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Building2, CheckCircle2, MapPin, ShieldCheck, Loader2, AlertCircle, FileText, UserCog, Search, X } from 'lucide-react';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import Logo from '../components/brand/Logo';

const ELEVATED_ROLES = new Set(['admin', 'manager', 'hseq_lead', 'supervisor']);

export default function SiteScanResolver() {
  const { token } = useParams();
  const navigate = useNavigate();
  const user = getUser();
  const isElevated = ELEVATED_ROLES.has(user?.role);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(null);
  const [ackSwms, setAckSwms] = useState(new Set());

  // Kiosk mode (admins/managers/hseq_lead/supervisor only)
  const [kioskMode, setKioskMode] = useState(false);
  const [kioskQuery, setKioskQuery] = useState('');
  const [workers, setWorkers] = useState([]);
  const [picked, setPicked] = useState(null); // selected worker object
  const [recent, setRecent] = useState([]); // last 5 sign-ons this session

  useEffect(() => {
    let alive = true;
    api.get(`/scan/site/${token}`)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setError(e?.response?.status === 404 ? 'not_found' : apiError(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  // Lazy-load workers only once when admin first toggles kiosk on.
  useEffect(() => {
    if (!kioskMode || workers.length > 0) return;
    api.get('/workers').then((r) => setWorkers(r.data || [])).catch(() => {});
  }, [kioskMode, workers.length]);

  const toggleAck = (id) => setAckSwms((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const filteredWorkers = (() => {
    const q = kioskQuery.trim().toLowerCase();
    if (!q) return workers.slice(0, 6);
    return workers.filter((w) => {
      const name = `${w.first_name || ''} ${w.last_name || ''}`.trim().toLowerCase();
      return name.includes(q) || (w.email || '').toLowerCase().includes(q);
    }).slice(0, 8);
  })();

  const onSignOn = async () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/scan/site/${token}`)}`);
      return;
    }
    setSigning(true);
    try {
      const payload = { swms_acknowledged: Array.from(ackSwms) };
      if (kioskMode && picked) payload.worker_id = picked.id;
      const r = await api.post(`/scan/site/${token}/sign-on`, payload);
      if (kioskMode) {
        // Kiosk: stay on the page, prepend to recent strip, reset picker.
        setRecent((prev) => [{
          name: picked ? `${picked.first_name || ''} ${picked.last_name || ''}`.trim() : (user.name || user.email),
          at: r.data.signed_at || new Date().toISOString(),
        }, ...prev].slice(0, 5));
        setPicked(null); setKioskQuery(''); setAckSwms(new Set());
        // 5s idle: re-blur input/clear pending state already done; nothing more to do.
      } else {
        setSigned(r.data);
      }
    } catch (e) { setError(apiError(e)); }
    finally { setSigning(false); }
  };

  if (loading) {
    return <PageShell><div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Resolving site…</div></PageShell>;
  }
  if (error === 'not_found') {
    return <PageShell><ErrorState title="Invalid or expired QR code" body="This sign-on link doesn't match any active site. Ask your supervisor for a fresh QR." /></PageShell>;
  }
  if (error) {
    return <PageShell><ErrorState title="Something went wrong" body={String(error)} /></PageShell>;
  }
  if (!data) return null;

  const s = data.site;

  if (signed && !kioskMode) {
    return (
      <PageShell>
        <div className="rounded-2xl bg-white shadow-xl p-8 text-center" data-testid="site-signon-confirmation">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 mb-4">
            <CheckCircle2 size={32} />
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-900">You're signed on.</h1>
          <p className="text-sm text-slate-600 mt-2">{s.name}</p>
          <p className="text-xs text-slate-500 mt-4">Quick-access pass expires {new Date(signed.pass_expires_at).toLocaleString()}</p>
          <p className="text-[11px] text-slate-400 mt-1">Stay safe out there. — Paneltec Civil WHS</p>
        </div>
      </PageShell>
    );
  }

  const ctaLabel = (() => {
    if (!user) return 'Sign in to sign on';
    if (kioskMode && picked) return `Sign ${picked.first_name || picked.last_name || 'worker'} on to ${s.name}`;
    if (kioskMode && !picked) return 'Pick a worker first';
    return 'Sign me on';
  })();

  return (
    <PageShell>
      {recent.length > 0 && (
        <div className="mb-3 rounded-xl bg-white/95 shadow-sm border border-slate-200 px-3 py-2" data-testid="kiosk-recent-signons">
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Recent sign-ons</div>
          <ul className="flex flex-wrap gap-1.5">
            {recent.map((r, i) => (
              <li key={`${r.name}-${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800">
                <CheckCircle2 size={10} /> {r.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rounded-2xl bg-white shadow-xl overflow-hidden" data-testid="site-scan-resolver">
        <div className="bg-blue-600 text-white px-6 py-5">
          <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">Site Sign-On</div>
          <h1 className="text-2xl font-display font-bold mt-1">{s.name}</h1>
          {(s.address || s.suburb) && (
            <div className="text-sm opacity-90 mt-1 inline-flex items-center gap-1.5"><MapPin size={13} /> {s.address || `${s.suburb}, ${s.state || ''}`.trim()}</div>
          )}
        </div>

        <div className="p-6 space-y-5">
          {data.active_swms?.length > 0 && (
            <section>
              <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 inline-flex items-center gap-1.5"><ShieldCheck size={13} /> Acknowledge SWMS for this site</div>
              <ul className="space-y-1.5">
                {data.active_swms.map((sw) => (
                  <li key={sw.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50">
                    <input type="checkbox" checked={ackSwms.has(sw.id)} onChange={() => toggleAck(sw.id)} className="mt-0.5" data-testid={`ack-swms-${sw.id}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate inline-flex items-center gap-1.5"><FileText size={12} className="text-slate-400" />{sw.title}</div>
                      <div className="text-[11px] text-slate-500">{sw.code || '—'} · {sw.version || 'v?'}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!user && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 inline-flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5" />
              <div>You'll be asked to sign in before sign-on completes. Your acknowledgements are remembered.</div>
            </div>
          )}

          <button
            type="button" onClick={onSignOn} disabled={signing || (kioskMode && !picked)}
            data-testid="site-signon-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-60">
            {signing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {ctaLabel}
          </button>

          {isElevated && (
            <div className="border-t border-slate-200 pt-3" data-testid="kiosk-mode-section">
              <button type="button" onClick={() => { setKioskMode((v) => !v); setPicked(null); setKioskQuery(''); }}
                data-testid="kiosk-mode-toggle"
                className={`w-full inline-flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-semibold border ${kioskMode ? 'bg-violet-50 border-violet-300 text-violet-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                <span className="inline-flex items-center gap-1.5"><UserCog size={12} /> Sign on as someone else (kiosk mode)</span>
                <span className="text-[10px] opacity-70">{kioskMode ? 'ON' : 'OFF'}</span>
              </button>
              {kioskMode && (
                <div className="mt-3 space-y-2">
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text" autoFocus value={kioskQuery}
                      onChange={(e) => { setKioskQuery(e.target.value); setPicked(null); }}
                      placeholder="Type a worker name or email…"
                      data-testid="kiosk-worker-search"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-violet-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                    />
                  </div>
                  {picked ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200 text-sm" data-testid="kiosk-worker-picked">
                      <UserCog size={13} className="text-violet-700" />
                      <span className="flex-1 font-semibold text-violet-900 truncate">{`${picked.first_name || ''} ${picked.last_name || ''}`.trim() || picked.email}</span>
                      <button onClick={() => setPicked(null)} className="text-violet-600 hover:text-violet-900"><X size={13} /></button>
                    </div>
                  ) : (
                    <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                      {filteredWorkers.length === 0 && (
                        <li className="px-3 py-3 text-[11px] text-slate-500">No workers match that search.</li>
                      )}
                      {filteredWorkers.map((w) => {
                        const name = `${w.first_name || ''} ${w.last_name || ''}`.trim() || w.email || w.id;
                        return (
                          <li key={w.id}>
                            <button type="button" onClick={() => setPicked(w)}
                              data-testid={`kiosk-worker-option-${w.id}`}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-violet-50">
                              <span className="font-semibold text-slate-900">{name}</span>
                              {w.trade && <span className="text-[11px] text-slate-500 ml-1.5">· {w.trade}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-slate-400 text-center">
            By signing on you confirm you're fit-for-work and have read the SWMS above.
            <br />Powered by Paneltec Civil WHS.
          </p>
        </div>
      </div>
    </PageShell>
  );
}

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col">
      <header className="px-5 py-4 border-b border-slate-200 bg-white/80 backdrop-blur">
        <Logo />
      </header>
      <main className="flex-1 flex items-start sm:items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

function ErrorState({ title, body }) {
  return (
    <div className="rounded-2xl bg-white shadow-xl p-8 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-rose-100 text-rose-700 mb-3"><Building2 size={26} /></div>
      <h1 className="text-lg font-display font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-600 mt-2">{body}</p>
    </div>
  );
}
