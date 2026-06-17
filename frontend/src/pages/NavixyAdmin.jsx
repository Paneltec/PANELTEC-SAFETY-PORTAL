import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Key, Loader2, Play, Radio } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { PageHeader, BackButton } from '../components/capture/Ui';

const DEFAULT_BASE = 'https://api.us.navixy.com';

export default function NavixyAdmin() {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState({
    api_base_url: DEFAULT_BASE, account_id: '', email: '', password: '',
    session_hash: '', poll_seconds: 30, auto_poll: true,
  });
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [showHash, setShowHash] = useState(false);
  const [busy, setBusy] = useState({ save: false, hash: false, test: false });
  const [testResult, setTestResult] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get('/integrations/navixy');
      setDoc(data);
      setCfg((c) => ({ ...c, ...(data.config || {}) }));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async (silent) => {
    setBusy((b) => ({ ...b, save: true }));
    try {
      await api.put('/integrations/navixy', cfg);
      if (!silent) toast.success('Saved');
      await load();
      return true;
    } catch (e) { toast.error(apiError(e)); return false; }
    finally { setBusy((b) => ({ ...b, save: false })); }
  };

  const getHash = async () => {
    if (!await save(true)) return;
    setBusy((b) => ({ ...b, hash: true }));
    try {
      const { data } = await api.post('/integrations/navixy/get-hash');
      toast.success('Hash refreshed', { description: `Saved ${data.hash_last4}` });
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy((b) => ({ ...b, hash: false })); }
  };

  const test = async () => {
    if (!await save(true)) return;
    setBusy((b) => ({ ...b, test: true }));
    setTestResult(null);
    try {
      const { data } = await api.post('/integrations/navixy/test-connection');
      setTestResult(data);
      toast.success(`Connected · ${data.vehicle_count} vehicles`);
      await load();
    } catch (e) { setTestResult({ error: apiError(e) }); toast.error(apiError(e)); }
    finally { setBusy((b) => ({ ...b, test: false })); }
  };

  const connected = doc?.status === 'connected';

  return (
    <div className="max-w-4xl mx-auto" data-testid="navixy-admin">
      <BackButton to="/app/settings/integrations" />
      <div className="rounded-3xl overflow-hidden border border-slate-200 shadow-card-lg">
        {/* Dark navy header */}
        <div className="bg-brand-ink text-white px-6 py-5 flex items-start justify-between">
          <div>
            <div className="text-[11px] tracking-[0.2em] uppercase font-semibold text-slate-400">Navixy GPS</div>
            <h1 className="font-display text-xl mt-1 uppercase tracking-wider">Live Vehicle Tracking &amp; Fleet Management</h1>
          </div>
          <span data-testid="navixy-status-pill"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider border ${connected ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40' : 'bg-slate-500/10 text-slate-300 border-slate-500/30'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-400'}`} /> {connected ? 'Live' : 'Not connected'}
          </span>
        </div>

        {/* Body */}
        <div className="bg-[#FBF8F0] p-6 lg:p-8">
          <p className="text-sm text-slate-700">
            Sign-in via email + password to fetch a session hash, then we use that hash on every <code className="text-xs bg-white border border-slate-200 px-1 py-0.5 rounded">/tracker/list</code> call. If you see "Wrong hash" or "Verification failed", click <strong>Get Hash</strong> to refresh.
          </p>

          {loading ? <div className="mt-6 text-sm text-slate-500">Loading…</div> : (
            <div className="mt-6 grid sm:grid-cols-2 gap-x-6 gap-y-5">
              <Lbl label="API base URL"><Input value={cfg.api_base_url} onChange={(v) => setCfg({ ...cfg, api_base_url: v })} placeholder={DEFAULT_BASE} testid="nav-api-base" /></Lbl>
              <Lbl label="Account / Fleet ID"><Input value={cfg.account_id || ''} onChange={(v) => setCfg({ ...cfg, account_id: v })} placeholder="10041108" testid="nav-account" /></Lbl>
              <Lbl label="Email"><Input type="email" value={cfg.email || ''} onChange={(v) => setCfg({ ...cfg, email: v })} placeholder="info@yourcompany.com" testid="nav-email" /></Lbl>
              <Lbl label="Password">
                <div className="relative">
                  <Input type={showPwd ? 'text' : 'password'} value={cfg.password || ''} onChange={(v) => setCfg({ ...cfg, password: v })} placeholder="••••••••" testid="nav-password" />
                  <button type="button" onClick={() => setShowPwd((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="toggle password">{showPwd ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                </div>
              </Lbl>
              <Lbl label="API key / session hash">
                <div className="relative">
                  <Input type={showHash ? 'text' : 'password'} value={cfg.session_hash || ''} onChange={(v) => setCfg({ ...cfg, session_hash: v })} placeholder="auto-fetched" mono testid="nav-hash" />
                  <button type="button" onClick={() => setShowHash((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="toggle hash">{showHash ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">If you see "Wrong hash", tap Get Hash to fetch a fresh session hash.</div>
              </Lbl>
              <Lbl label="Poll · seconds"><Input type="number" value={String(cfg.poll_seconds || 30)} onChange={(v) => setCfg({ ...cfg, poll_seconds: Number(v) || 30 })} testid="nav-poll" /></Lbl>

              <div className="sm:col-span-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!cfg.auto_poll} onChange={(e) => setCfg({ ...cfg, auto_poll: e.target.checked })} data-testid="nav-auto-poll" />
                  <span>Auto-poll (continuously update vehicle positions)</span>
                </label>
              </div>
            </div>
          )}

          {testResult && !testResult.error && (
            <div className="mt-6 rounded-xl border-2 border-emerald-200 bg-brand-green-mint/40 p-4" data-testid="navixy-test-result">
              <div className="flex items-center gap-2 text-emerald-800 font-medium"><CheckCircle2 size={16} /> Connected · {testResult.vehicle_count} vehicles · tested {new Date(testResult.tested_at).toLocaleTimeString()}</div>
              {testResult.sample?.length > 0 && (
                <ul className="mt-2 text-xs text-slate-700 space-y-1">
                  {testResult.sample.map((s) => <li key={s.id}>· {s.label} {s.plate ? `(${s.plate})` : ''}</li>)}
                </ul>
              )}
            </div>
          )}
          {testResult?.error && (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{testResult.error}</div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={getHash} disabled={busy.hash} data-testid="nav-get-hash"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-60">
              {busy.hash ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />} Get Hash
            </button>
            <button onClick={test} disabled={busy.test} data-testid="nav-test"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-ink text-white text-sm font-semibold uppercase tracking-wider hover:bg-slate-800 disabled:opacity-60">
              {busy.test ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test connection
            </button>
            <button onClick={() => save()} disabled={busy.save} data-testid="nav-save"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-slate-300 text-sm font-semibold uppercase tracking-wider hover:bg-slate-100 disabled:opacity-60">
              {busy.save ? <Loader2 size={14} className="animate-spin" /> : null} Save
            </button>
            {connected && (
              <Link to="/app/vehicles" className="inline-flex items-center gap-1 ml-auto text-sm text-brand-blue hover:underline" data-testid="nav-go-vehicles">
                View vehicles <ArrowRight size={14} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Lbl({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-500 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function Input({ type = 'text', value, onChange, placeholder, mono, testid }) {
  return <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    data-testid={testid}
    className={`w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue ${mono ? 'font-mono' : ''}`} />;
}
