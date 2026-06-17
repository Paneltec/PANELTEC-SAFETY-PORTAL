import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Key, Loader2, Play, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { BackButton } from '../components/capture/Ui';

const DEFAULT_BASE = 'https://api.us.navixy.com';

const emptyState = {
  api_base_url: DEFAULT_BASE,
  account_id: '',
  email: '',
  passwordInput: '',
  passwordOnFile: null,
  hashInput: '',
  hashOnFile: null,
  poll_seconds: 30,
  auto_poll: true,
};

const isMasked = (v) => typeof v === 'string' && (v.startsWith('••••') || v.startsWith('****'));

export default function NavixyAdmin() {
  const [s, setS] = useState(emptyState);
  const [doc, setDoc] = useState(null);
  const [showPwd, setShowPwd] = useState(false);
  const [showHash, setShowHash] = useState(false);
  const [busy, setBusy] = useState({ hash: false, test: false });
  const [testMsg, setTestMsg] = useState(null);

  const apply = (data) => {
    setDoc(data);
    const cfg = data?.config || {};
    setS((prev) => ({
      ...prev,
      api_base_url: cfg.api_base_url || DEFAULT_BASE,
      account_id: cfg.account_id || '',
      email: cfg.email || '',
      passwordOnFile: isMasked(cfg.password) ? cfg.password : (cfg.password ? '••••' : null),
      hashOnFile: isMasked(cfg.session_hash) ? cfg.session_hash : (cfg.session_hash ? '••••' : null),
      poll_seconds: cfg.poll_seconds ?? 30,
      auto_poll: cfg.auto_poll ?? true,
      // Never overwrite the user's in-progress typing for either secret.
    }));
  };

  const load = async () => {
    try { const { data } = await api.get('/integrations/navixy'); apply(data); }
    catch (e) { /* silent on initial load */ }
  };
  useEffect(() => { load(); }, []);

  const buildBody = () => ({
    api_base_url: s.api_base_url || DEFAULT_BASE,
    account_id: s.account_id || null,
    email: s.email || null,
    password: s.passwordInput ? s.passwordInput : (s.passwordOnFile || null),
    session_hash: s.hashInput ? s.hashInput : (s.hashOnFile || null),
    poll_seconds: Number(s.poll_seconds) || 30,
    auto_poll: !!s.auto_poll,
  });

  const toastError = (e) => {
    const status = e?.response?.status;
    if (status === 401) return; // global interceptor handles real session loss
    if (status === 403) {
      toast.error("You don't have permission to edit integrations.", {
        description: 'Ask an admin to enable integrations.edit for your user, or run this as an admin.',
      });
      return;
    }
    toast.error(apiError(e) || 'Request failed');
  };

  const autoSave = async () => {
    try { const { data } = await api.put('/integrations/navixy', buildBody()); apply(data); return true; }
    catch (e) { toastError(e); return false; }
  };

  const save = async () => {
    setBusy((b) => ({ ...b, save: true }));
    const ok = await autoSave();
    if (ok) {
      toast.success('Credentials saved');
      // Clear the input fields so the next render shows the new masked placeholders + Saved chips
      setS((prev) => ({ ...prev, passwordInput: '', hashInput: '' }));
    }
    setBusy((b) => ({ ...b, save: false }));
  };

  const getHash = async () => {
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, hash: true }));
    try {
      const { data } = await api.post('/integrations/navixy/get-hash');
      toast.success('Session hash refreshed', { description: `Stored ${data.hash_last4 || ''}` });
      await load();
    } catch (e) { toastError(e); }
    finally { setBusy((b) => ({ ...b, hash: false })); }
  };

  const test = async () => {
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, test: true }));
    setTestMsg(null);
    try {
      const { data } = await api.post('/integrations/navixy/test-connection');
      setTestMsg({ ok: true, text: `Connected · ${data.vehicle_count} vehicles cached` });
      toast.success(`Connected · ${data.vehicle_count} vehicles`);
      await load();
    } catch (e) {
      setTestMsg({ ok: false, text: apiError(e) });
      toastError(e);
    } finally { setBusy((b) => ({ ...b, test: false })); }
  };

  const connected = doc?.status === 'connected';

  return (
    <div className="max-w-5xl mx-auto" data-testid="navixy-admin">
      <BackButton to="/app/settings/integrations" />

      <div className="rounded-2xl overflow-hidden shadow-card-lg"
           style={{ backgroundColor: '#F5EFE0' }}>

        {/* Dark navy header band */}
        <div className="px-8 py-5 flex items-center justify-between" style={{ backgroundColor: '#0F1B2D' }}>
          <div className="text-white text-[13px] font-semibold uppercase tracking-[0.18em]">
            Navixy GPS <span className="text-slate-400 mx-2">·</span> Live Vehicle Tracking &amp; Fleet Management
          </div>
          <span data-testid="navixy-status-pill"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.16em] border ${connected ? 'border-emerald-400 text-emerald-300' : 'border-slate-500 text-slate-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            {connected ? 'Live' : 'Not connected'}
          </span>
        </div>

        {/* Beige body */}
        <div className="px-8 py-7 lg:px-10 lg:py-9 text-slate-800">
          <p className="text-sm leading-relaxed mb-7">
            Sign-in via email + password to fetch a session hash, then we use that hash on every
            <code className="mx-1 px-1.5 py-0.5 bg-white/60 border border-[#D8CFB8] rounded text-[12px] font-mono">/tracker/list</code>
            call. If you see <em>"Wrong hash"</em> or <em>"Verification failed"</em>, click <strong>Get Hash</strong> to refresh.
          </p>

          <div className="grid sm:grid-cols-2 gap-x-7 gap-y-5">
            <Field label="API base URL">
              <Input value={s.api_base_url} onChange={(v) => setS({ ...s, api_base_url: v })} placeholder={DEFAULT_BASE} testid="nav-api-base" />
            </Field>
            <Field label="Account / Fleet ID">
              <Input value={s.account_id} onChange={(v) => setS({ ...s, account_id: v })} placeholder="10041108" testid="nav-account" />
            </Field>
            <Field label="Email">
              <Input type="email" value={s.email} onChange={(v) => setS({ ...s, email: v })} placeholder="info@yourcompany.com" testid="nav-email" />
            </Field>
            <Field label="Password" rightSlot={(s.passwordOnFile && !s.passwordInput) ? (
              <span className="text-[10px] text-emerald-700 inline-flex items-center gap-1 normal-case tracking-normal font-normal" data-testid="nav-password-saved">
                <CheckCircle2 size={11} /> Saved · {s.passwordOnFile}
              </span>
            ) : s.passwordInput ? (
              <span className="text-[10px] text-amber-700 inline-flex items-center gap-1 normal-case tracking-normal font-normal">
                Editing — click Save to confirm
              </span>
            ) : null}>
              <InputWithToggle
                value={s.passwordInput}
                onChange={(v) => setS({ ...s, passwordInput: v })}
                placeholder={s.passwordOnFile || '••••••••'}
                show={showPwd} onToggle={() => setShowPwd((x) => !x)}
                testid="nav-password"
              />
            </Field>
            <Field label="API key / session hash" rightSlot={(s.hashOnFile && !s.hashInput) ? (
              <span className="text-[10px] text-emerald-700 inline-flex items-center gap-1 normal-case tracking-normal font-normal" data-testid="nav-hash-saved">
                <CheckCircle2 size={11} /> Saved · {s.hashOnFile}
              </span>
            ) : s.hashInput ? (
              <span className="text-[10px] text-amber-700 inline-flex items-center gap-1 normal-case tracking-normal font-normal">
                Editing — click Save to confirm
              </span>
            ) : null}>
              <InputWithToggle
                value={s.hashInput}
                onChange={(v) => setS({ ...s, hashInput: v })}
                placeholder={s.hashOnFile || 'paste a key, or click Get Hash'}
                show={showHash} onToggle={() => setShowHash((x) => !x)}
                mono testid="nav-hash"
              />
            </Field>
            <Field label="Poll · seconds">
              <Input type="number" value={String(s.poll_seconds)} onChange={(v) => setS({ ...s, poll_seconds: Number(v) || 30 })} testid="nav-poll" />
            </Field>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600 max-w-md">
              Paste your Navixy session hash, or click <strong>Get Hash</strong> to fetch a fresh one with your email + password.
            </p>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={!!s.auto_poll} onChange={(e) => setS({ ...s, auto_poll: e.target.checked })} data-testid="nav-auto-poll" />
              <span>Auto-poll (continuously update vehicle positions)</span>
            </label>
          </div>

          {testMsg && (
            <div className={`mt-5 inline-flex items-center gap-1.5 text-sm ${testMsg.ok ? 'text-emerald-700' : 'text-red-700'}`} data-testid="navixy-test-msg">
              {testMsg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              <span>{testMsg.text}</span>
            </div>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            <button onClick={getHash} disabled={busy.hash} data-testid="nav-get-hash"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
              style={{ backgroundColor: '#16A34A' }}>
              {busy.hash ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />} Get Hash
            </button>
            <button onClick={save} disabled={busy.save} data-testid="nav-save"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-transparent text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60 hover:bg-black/5"
              style={{ color: '#0F1B2D', border: '1px solid #0F1B2D' }}>
              {busy.save ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
            <button onClick={test} disabled={busy.test} data-testid="nav-test-connection"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
              style={{ backgroundColor: '#0F1B2D' }}>
              {busy.test ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test Connection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, rightSlot }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-700 mb-1.5 flex items-center justify-between gap-2">
        <span>{label}</span>
        {rightSlot}
      </div>
      {children}
    </label>
  );
}

function Input({ type = 'text', value, onChange, placeholder, testid }) {
  return (
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      data-testid={testid}
      className="w-full px-3 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
      style={{ backgroundColor: '#FAF6EC', border: '1px solid #D8CFB8' }} />
  );
}

function InputWithToggle({ value, onChange, placeholder, show, onToggle, readOnly, mono, testid }) {
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        data-testid={testid}
        className={`w-full pl-3 pr-9 py-2.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/30 ${mono ? 'font-mono' : ''}`}
        style={{ backgroundColor: '#FAF6EC', border: '1px solid #D8CFB8' }} />
      <button type="button" onClick={onToggle}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 p-1"
        aria-label="toggle visibility">
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
