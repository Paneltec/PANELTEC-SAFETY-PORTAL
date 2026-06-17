import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Key, Loader2, Lock, Play, Save } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { BackButton } from '../components/capture/Ui';

const DEFAULT_BASE = 'https://api.us.navixy.com';

// Local state shape. `passwordInput` is what the user is typing (cleartext, never displayed
// once they navigate away). `passwordOnFile` is the masked indicator we get from the server.
const emptyState = {
  api_base_url: DEFAULT_BASE,
  account_id: '',
  email: '',
  passwordInput: '',
  passwordOnFile: null,
  hashOnFile: null,
  poll_seconds: 30,
  auto_poll: true,
};

function isMasked(v) {
  return typeof v === 'string' && (v.startsWith('••••') || v.startsWith('****'));
}

export default function NavixyAdmin() {
  const [s, setS] = useState(emptyState);
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState({ save: false, hash: false, test: false });
  const [testResult, setTestResult] = useState(null);

  const applyServer = (data) => {
    setDoc(data);
    const cfg = data?.config || {};
    setS((prev) => ({
      ...prev,
      api_base_url: cfg.api_base_url || DEFAULT_BASE,
      account_id: cfg.account_id || '',
      email: cfg.email || '',
      // Don't smash the user's in-progress typing.
      passwordInput: '',
      passwordOnFile: isMasked(cfg.password) ? cfg.password : (cfg.password ? '••••' : null),
      hashOnFile: isMasked(cfg.session_hash) ? cfg.session_hash : (cfg.session_hash ? '••••' : null),
      poll_seconds: cfg.poll_seconds ?? 30,
      auto_poll: cfg.auto_poll ?? true,
    }));
  };

  const load = async () => {
    try {
      const { data } = await api.get('/integrations/navixy');
      applyServer(data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Build PUT body. If user typed a new password, send it; otherwise send mask so backend keeps stored.
  const buildBody = () => ({
    api_base_url: s.api_base_url || DEFAULT_BASE,
    account_id: s.account_id || null,
    email: s.email || null,
    password: s.passwordInput ? s.passwordInput : (s.passwordOnFile || null),
    session_hash: s.hashOnFile || null,
    poll_seconds: Number(s.poll_seconds) || 30,
    auto_poll: !!s.auto_poll,
  });

  const save = async (silent) => {
    setBusy((b) => ({ ...b, save: true }));
    try {
      const { data } = await api.put('/integrations/navixy', buildBody());
      if (!silent) toast.success('Credentials saved', { description: 'Stored securely on your org.' });
      applyServer(data);
      return true;
    } catch (e) { toast.error(apiError(e)); return false; }
    finally { setBusy((b) => ({ ...b, save: false })); }
  };

  const getHash = async () => {
    if (!await save(true)) return;
    setBusy((b) => ({ ...b, hash: true }));
    try {
      const { data } = await api.post('/integrations/navixy/get-hash');
      toast.success('Session hash refreshed', { description: `Stored ${data.hash_last4}` });
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
  const hasStoredPwd = !!s.passwordOnFile;
  const hasStoredHash = !!s.hashOnFile;

  return (
    <div className="max-w-4xl mx-auto" data-testid="navixy-admin">
      <BackButton to="/app/settings/integrations" />
      <div className="rounded-3xl overflow-hidden border border-slate-200 shadow-card-lg">
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

        <div className="bg-[#FBF8F0] p-6 lg:p-8">
          <p className="text-sm text-slate-700">
            Enter your Navixy operator email + password, then click <strong>Save credentials</strong>. We&apos;ll exchange them for a session hash via <code className="text-xs bg-white border border-slate-200 px-1 py-0.5 rounded">/v2/user/auth</code> when you click <strong>Get Hash</strong>.
          </p>

          {loading ? <div className="mt-6 text-sm text-slate-500">Loading…</div> : (
            <div className="mt-6 grid sm:grid-cols-2 gap-x-6 gap-y-5">
              <Lbl label="API base URL">
                <Input value={s.api_base_url} onChange={(v) => setS({ ...s, api_base_url: v })} placeholder={DEFAULT_BASE} testid="nav-api-base" />
              </Lbl>
              <Lbl label="Account / Fleet ID">
                <Input value={s.account_id} onChange={(v) => setS({ ...s, account_id: v })} placeholder="10041108" testid="nav-account" />
              </Lbl>
              <Lbl label="Email">
                <Input type="email" value={s.email} onChange={(v) => setS({ ...s, email: v })} placeholder="info@yourcompany.com" testid="nav-email" />
              </Lbl>
              <Lbl
                label="Password"
                hint={hasStoredPwd
                  ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={11} /> Saved · type to replace</span>
                  : <span className="text-slate-500">Enter your Navixy password</span>}
              >
                <div className="relative">
                  <Input
                    type={showPwd ? 'text' : 'password'}
                    value={s.passwordInput}
                    onChange={(v) => setS({ ...s, passwordInput: v })}
                    placeholder={hasStoredPwd ? s.passwordOnFile : '••••••••'}
                    testid="nav-password"
                  />
                  <button type="button" onClick={() => setShowPwd((x) => !x)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="toggle password">
                    {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Lbl>
              <Lbl
                label="Session hash"
                hint={hasStoredHash
                  ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={11} /> {s.hashOnFile} · auto-fetched</span>
                  : <span className="text-slate-500">Click Get Hash to fetch from Navixy</span>}
              >
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600 font-mono">
                  <Lock size={12} className="text-slate-400" />
                  {hasStoredHash ? s.hashOnFile : <span className="italic text-slate-400">none</span>}
                </div>
              </Lbl>
              <Lbl label="Poll · seconds">
                <Input type="number" value={String(s.poll_seconds)} onChange={(v) => setS({ ...s, poll_seconds: Number(v) || 30 })} testid="nav-poll" />
              </Lbl>

              <div className="sm:col-span-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!s.auto_poll} onChange={(e) => setS({ ...s, auto_poll: e.target.checked })} data-testid="nav-auto-poll" />
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
                  {testResult.sample.map((x) => <li key={x.id}>· {x.label} {x.plate ? `(${x.plate})` : ''}</li>)}
                </ul>
              )}
            </div>
          )}
          {testResult?.error && (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{testResult.error}</div>
          )}
          {doc?.last_error && !testResult && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Last error · {doc.last_error}
            </div>
          )}

          <div className="mt-7 pt-5 border-t border-slate-200 flex flex-wrap gap-3">
            <button onClick={() => save()} disabled={busy.save} data-testid="nav-save"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-semibold uppercase tracking-wider hover:bg-blue-600 disabled:opacity-60">
              {busy.save ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save credentials
            </button>
            <button onClick={getHash} disabled={busy.hash} data-testid="nav-get-hash"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-60">
              {busy.hash ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />} Get Hash
            </button>
            <button onClick={test} disabled={busy.test} data-testid="nav-test"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-ink text-white text-sm font-semibold uppercase tracking-wider hover:bg-slate-800 disabled:opacity-60">
              {busy.test ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test connection
            </button>
            {connected && (
              <Link to="/app/vehicles" className="inline-flex items-center gap-1 ml-auto text-sm text-brand-blue hover:underline" data-testid="nav-go-vehicles">
                View vehicles <ArrowRight size={14} />
              </Link>
            )}
          </div>

          {doc?.updated_at && (
            <p className="mt-3 text-[11px] text-slate-500" data-testid="navixy-last-saved">
              Last saved {new Date(doc.updated_at).toLocaleString()}
              {doc.last_tested_at && <> · last tested {new Date(doc.last_tested_at).toLocaleString()}</>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Lbl({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-500 mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[11px] mt-1">{hint}</div>}
    </label>
  );
}

function Input({ type = 'text', value, onChange, placeholder, testid }) {
  return <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    data-testid={testid}
    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue" />;
}
