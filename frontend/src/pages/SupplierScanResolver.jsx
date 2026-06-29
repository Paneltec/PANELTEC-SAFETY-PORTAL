// Phase 4.3 — Public Supplier Induction QR landing.
//
// Mirrors SiteScanResolver. Public GET, auth'd POST. Tampered tokens 404.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Building2, CheckCircle2, Loader2, AlertCircle, FileText, ShieldCheck, BadgeCheck,
} from 'lucide-react';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import Logo from '../components/brand/Logo';

export default function SupplierScanResolver() {
  const { token } = useParams();
  const navigate = useNavigate();
  const user = getUser();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(null);
  const [ackDocs, setAckDocs] = useState(new Set());
  const [ackSwms, setAckSwms] = useState(new Set());

  useEffect(() => {
    let alive = true;
    api.get(`/scan/supplier/${token}`)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setError(e?.response?.status === 404 ? 'not_found' : apiError(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  const toggleDoc = (k) => setAckDocs((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleSwms = (k) => setAckSwms((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const onComplete = async () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/scan/supplier/${token}`)}`);
      return;
    }
    setSigning(true);
    try {
      const r = await api.post(`/scan/supplier/${token}/complete-induction`, {
        acknowledged_docs: Array.from(ackDocs),
        acknowledged_swms: Array.from(ackSwms),
      });
      setSigned(r.data);
    } catch (e) { setError(apiError(e)); }
    finally { setSigning(false); }
  };

  if (loading) {
    return <PageShell><div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Resolving supplier…</div></PageShell>;
  }
  if (error === 'not_found') {
    return <PageShell><ErrorState title="Invalid supplier QR" body="This induction link doesn't match any active supplier. Contact your safety officer for a fresh QR." /></PageShell>;
  }
  if (error) {
    return <PageShell><ErrorState title="Something went wrong" body={String(error)} /></PageShell>;
  }
  if (!data) return null;

  const c = data.contractor;

  if (signed) {
    return (
      <PageShell>
        <div className="rounded-2xl bg-white shadow-xl p-8 text-center" data-testid="supplier-induction-confirmation">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 mb-4">
            <CheckCircle2 size={32} />
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-900">Induction complete.</h1>
          <p className="text-sm text-slate-600 mt-2">{c.name}</p>
          <p className="text-xs text-slate-500 mt-4">Valid through {new Date(signed.induction_expires_at).toLocaleDateString()}</p>
          <p className="text-[11px] text-slate-400 mt-1">Welcome aboard. — Paneltec Civil WHS</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="rounded-2xl bg-white shadow-xl overflow-hidden" data-testid="supplier-scan-resolver">
        <div className="bg-violet-600 text-white px-6 py-5">
          <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">Supplier Induction</div>
          <h1 className="text-2xl font-display font-bold mt-1">{c.name}</h1>
          <div className="text-xs opacity-90 mt-1 flex flex-wrap gap-2">
            {c.abn && <span className="inline-flex items-center gap-1">ABN <span className="font-mono">{c.abn}</span></span>}
            {c.trade && <span className="inline-flex items-center gap-1"><BadgeCheck size={11} /> {c.trade}</span>}
          </div>
        </div>

        <div className="p-6 space-y-5">
          {data.documents?.length > 0 && (
            <section>
              <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 inline-flex items-center gap-1.5">
                <ShieldCheck size={13} /> Required documents
              </div>
              <ul className="space-y-1.5">
                {data.documents.map((d, i) => {
                  const key = `${d.type || 'doc'}-${i}`;
                  return (
                    <li key={key} className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50">
                      <input type="checkbox" checked={ackDocs.has(key)} onChange={() => toggleDoc(key)}
                        data-testid={`ack-doc-${key}`} className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate inline-flex items-center gap-1.5">
                          <FileText size={12} className="text-slate-400" />
                          {(d.type || 'document').replace(/_/g, ' ')}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {d.status || 'unknown'} {d.expiry_date && `· expires ${d.expiry_date.slice(0, 10)}`}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {data.active_swms?.length > 0 && (
            <section>
              <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 inline-flex items-center gap-1.5">
                <FileText size={13} /> Acknowledge SWMS that apply to you
              </div>
              <ul className="space-y-1.5">
                {data.active_swms.map((sw) => (
                  <li key={sw.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50">
                    <input type="checkbox" checked={ackSwms.has(sw.id)} onChange={() => toggleSwms(sw.id)}
                      data-testid={`ack-swms-${sw.id}`} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{sw.title}</div>
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
              <div>You'll be asked to sign in before the induction is recorded. Your acknowledgements are remembered.</div>
            </div>
          )}

          <button
            type="button" onClick={onComplete} disabled={signing}
            data-testid="supplier-signon-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-60">
            {signing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {user ? 'Complete induction' : 'Sign in to complete induction'}
          </button>

          <p className="text-[11px] text-slate-400 text-center">
            By completing this induction you confirm you've read the documents above and agree to Paneltec Civil's site rules.
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
