// Phase 4.2 + 4.12 (paneltec-v127) — Public Site Induction QR landing page.
//
// Anyone holding a valid /scan/site/{token} URL can see site info, dynamic
// sign-on questions and the active SWMS list.
//   · Logged-in worker → POST /api/scan/site/{token}/sign-on (auth)
//   · Anonymous visitor → POST /api/scan/site/{token}/sign-on-visitor (public)
//
// Both paths capture browser GPS (if granted) so the server can flag
// > 250m drift against the site's known coordinates.
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Building2, CheckCircle2, MapPin, ShieldCheck, Loader2, AlertCircle,
  FileText, UserCog, Search, X, Crosshair,
} from 'lucide-react';
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

  // v127 — dynamic questions
  const [answers, setAnswers] = useState({}); // { qid: value }
  // v127 — visitor flow
  const [visitorName, setVisitorName] = useState('');
  const [visitorCompany, setVisitorCompany] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [signAsVisitor, setSignAsVisitor] = useState(false);
  // v127 — GPS capture
  const [gps, setGps] = useState(null); // { lat, lng, accuracy }
  const [gpsState, setGpsState] = useState('idle'); // idle | loading | denied | ok

  // Kiosk mode (admins/managers/hseq_lead/supervisor only)
  const [kioskMode, setKioskMode] = useState(false);
  const [kioskQuery, setKioskQuery] = useState('');
  const [workers, setWorkers] = useState([]);
  const [picked, setPicked] = useState(null);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    let alive = true;
    api.get(`/scan/site/${token}`)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setError(e?.response?.status === 404 ? 'not_found' : apiError(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    if (!kioskMode || workers.length > 0) return;
    api.get('/workers').then((r) => setWorkers(r.data || [])).catch(() => {});
  }, [kioskMode, workers.length]);

  const captureGps = useCallback(() => {
    if (!navigator.geolocation) { setGpsState('denied'); return; }
    setGpsState('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGpsState('ok');
      },
      () => setGpsState('denied'),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  }, []);

  // Auto-request GPS once when data arrives
  useEffect(() => {
    if (data && gpsState === 'idle') captureGps();
  }, [data, gpsState, captureGps]);

  const toggleAck = (id) => setAckSwms((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const filteredWorkers = useMemo(() => {
    const q = kioskQuery.trim().toLowerCase();
    if (!q) return workers.slice(0, 6);
    return workers.filter((w) => {
      const name = `${w.first_name || ''} ${w.last_name || ''}`.trim().toLowerCase();
      return name.includes(q) || (w.email || '').toLowerCase().includes(q);
    }).slice(0, 8);
  }, [workers, kioskQuery]);

  const isVisitorFlow = !user || signAsVisitor;

  const requiredQuestionsMissing = () => {
    const qs = data?.signon_questions || [];
    return qs.some((q) => q.required && (answers[q.id] === undefined || answers[q.id] === null || answers[q.id] === ''));
  };

  const onSignOn = async () => {
    if (isVisitorFlow && !visitorName.trim()) {
      setError('Please enter your full name to sign on as a visitor.');
      return;
    }
    if (requiredQuestionsMissing()) {
      setError('Please answer all required questions before signing on.');
      return;
    }
    setError(null);
    setSigning(true);
    try {
      const answersList = Object.entries(answers).map(([qid, value]) => ({ question_id: qid, value }));
      const gpsPayload = gps ? {
        gps_lat: gps.lat, gps_long: gps.lng, gps_accuracy_m: gps.accuracy,
      } : { gps_lat: null, gps_long: null, gps_accuracy_m: null };

      let r;
      if (isVisitorFlow) {
        r = await api.post(`/scan/site/${token}/sign-on-visitor`, {
          name: visitorName.trim(),
          company: visitorCompany.trim() || null,
          phone: visitorPhone.trim() || null,
          swms_acknowledged: Array.from(ackSwms),
          answers: answersList,
          ...gpsPayload,
        });
      } else {
        const payload = {
          swms_acknowledged: Array.from(ackSwms),
          answers: answersList,
          ...gpsPayload,
        };
        if (kioskMode && picked) payload.worker_id = picked.id;
        r = await api.post(`/scan/site/${token}/sign-on`, payload);
      }

      if (kioskMode && !isVisitorFlow) {
        setRecent((prev) => [{
          name: picked ? `${picked.first_name || ''} ${picked.last_name || ''}`.trim() : (user.name || user.email),
          at: r.data.signed_at || new Date().toISOString(),
        }, ...prev].slice(0, 5));
        setPicked(null); setKioskQuery(''); setAckSwms(new Set()); setAnswers({});
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
  if (!data) {
    return <PageShell><ErrorState title="Something went wrong" body={String(error || 'Please retry')} /></PageShell>;
  }

  const s = data.site;

  if (signed && !kioskMode) {
    return (
      <PageShell>
        <div className="rounded-2xl bg-white shadow-xl p-8 text-center" data-testid="site-signon-confirmation">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 mb-4">
            <CheckCircle2 size={32} />
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-900">You&rsquo;re signed on.</h1>
          <p className="text-sm text-slate-600 mt-2">{s.name}</p>
          {signed.gps_warning && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
              <AlertCircle size={12} /> GPS was {signed.gps_distance_m}m from the registered site location — your supervisor has been notified.
            </div>
          )}
          {signed.pass_expires_at && (
            <p className="text-xs text-slate-500 mt-4">Quick-access pass expires {new Date(signed.pass_expires_at).toLocaleString()}</p>
          )}
          <p className="text-[11px] text-slate-400 mt-1">Stay safe out there. — Paneltec Civil WHS</p>
        </div>
      </PageShell>
    );
  }

  const ctaLabel = (() => {
    if (kioskMode && !picked) return 'Pick a worker first';
    if (kioskMode && picked) return `Sign ${picked.first_name || picked.last_name || 'worker'} on to ${s.name}`;
    if (isVisitorFlow) return `Sign on as a visitor`;
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
        <div className="bg-slate-900 text-white px-6 py-5">
          <div className="text-[10px] uppercase tracking-wider font-bold opacity-80 text-orange-400">Site Sign-On</div>
          <h1 className="text-2xl font-display font-bold mt-1">{s.name}</h1>
          {(s.address || s.suburb) && (
            <div className="text-sm opacity-90 mt-1 inline-flex items-center gap-1.5"><MapPin size={13} /> {s.address || `${s.suburb}, ${s.state || ''}`.trim()}</div>
          )}
        </div>

        <div className="p-6 space-y-5">
          {/* GPS chip */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={captureGps}
              data-testid="site-signon-gps-btn"
              disabled={gpsState === 'loading'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${gpsState === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : gpsState === 'denied' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
              {gpsState === 'loading' ? <Loader2 size={11} className="animate-spin" /> : <Crosshair size={11} />}
              {gpsState === 'ok' && `Location captured (±${Math.round(gps?.accuracy || 0)}m)`}
              {gpsState === 'denied' && 'Location unavailable — proceed without'}
              {gpsState === 'loading' && 'Getting location…'}
              {gpsState === 'idle' && 'Capture location'}
            </button>
          </div>

          {/* Visitor toggle (only show when authed users have the option) */}
          {user && !signAsVisitor && !kioskMode && (
            <button type="button" onClick={() => setSignAsVisitor(true)}
              data-testid="site-signon-as-visitor-btn"
              className="text-[11px] font-semibold text-orange-600 hover:text-orange-700">
              Sign on as a visitor instead →
            </button>
          )}

          {/* Visitor form */}
          {isVisitorFlow && (
            <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-4" data-testid="visitor-form">
              <div className="text-[10px] uppercase tracking-wider font-bold text-violet-700">Visitor sign-on</div>
              <VisitorField label="Full name *" value={visitorName} onChange={setVisitorName} testid="visitor-name" />
              <VisitorField label="Company" value={visitorCompany} onChange={setVisitorCompany} testid="visitor-company" />
              <VisitorField label="Phone" value={visitorPhone} onChange={setVisitorPhone} testid="visitor-phone" />
              {user && signAsVisitor && (
                <button type="button" onClick={() => setSignAsVisitor(false)}
                  className="text-[11px] font-semibold text-slate-600 hover:text-slate-900">
                  ← Back to signing on as {user.email}
                </button>
              )}
            </div>
          )}

          {/* Dynamic sign-on questions */}
          {(data.signon_questions || []).length > 0 && (
            <section data-testid="signon-questions">
              <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Sign-on questions</div>
              <ul className="space-y-2.5">
                {data.signon_questions.map((q) => (
                  <li key={q.id} className="p-3 rounded-lg border border-slate-200 bg-white">
                    <div className="text-sm font-semibold text-slate-900 mb-2">
                      {q.label}{q.required && <span className="text-rose-600 ml-1">*</span>}
                    </div>
                    {q.type === 'yesno' && (
                      <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
                        {['yes', 'no'].map((v) => (
                          <button key={v} type="button"
                            onClick={() => setAnswers((a) => ({ ...a, [q.id]: v }))}
                            data-testid={`q-${q.id}-${v}`}
                            className={`px-4 py-1.5 text-xs font-semibold ${answers[q.id] === v ? 'bg-orange-500 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'} ${v === 'no' ? 'border-l border-slate-300' : ''}`}>
                            {v === 'yes' ? 'Yes' : 'No'}
                          </button>
                        ))}
                      </div>
                    )}
                    {q.type === 'text' && (
                      <input type="text" value={answers[q.id] || ''}
                        onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                        data-testid={`q-${q.id}-input`}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
                    )}
                    {q.type === 'choice' && (
                      <select value={answers[q.id] || ''}
                        onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                        data-testid={`q-${q.id}-select`}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30">
                        <option value="">— Select —</option>
                        {(q.choices || []).map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* SWMS acknowledgements */}
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

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 inline-flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          <button
            type="button" onClick={onSignOn} disabled={signing || (kioskMode && !picked)}
            data-testid="site-signon-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 disabled:opacity-60">
            {signing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {ctaLabel}
          </button>

          {!user && (
            <div className="text-center">
              <button type="button"
                onClick={() => navigate(`/?next=${encodeURIComponent(`/scan/site/${token}`)}`)}
                className="text-[11px] font-semibold text-slate-600 hover:text-slate-900">
                Worker with a Paneltec account? Sign in to sign on →
              </button>
            </div>
          )}

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
            By signing on you confirm you&rsquo;re fit-for-work and have read the SWMS above.
            <br />Powered by Paneltec Civil WHS.
          </p>
        </div>
      </div>
    </PageShell>
  );
}

function VisitorField({ label, value, onChange, testid }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-600 mb-1">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
    </label>
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
