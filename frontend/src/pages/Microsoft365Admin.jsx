import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Play, Save, CheckCircle2, AlertCircle, LogIn, Mail, Send, XCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { BackButton } from '../components/capture/Ui';
import {
  AdminCard, StatusPill, Field, Input, InputWithToggle, SavedChip, isMasked, authErrorToast,
} from '../components/IntegrationFormUI';

const empty = {
  tenant_id: '',
  client_id: '',
  secretInput: '',
  secretOnFile: null,
  sender_email: '',
};

export default function Microsoft365Admin() {
  const [params, setParams] = useSearchParams();
  const [s, setS] = useState(empty);
  const [doc, setDoc] = useState(null);
  const [redirectUri, setRedirectUri] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState({ save: false, connect: false, test: false, flush: false, disconnect: false });
  const [testMsg, setTestMsg] = useState(null);
  const [queuedCount, setQueuedCount] = useState(0);

  const apply = (data) => {
    setDoc(data);
    const cfg = data?.config || {};
    setS((prev) => ({
      ...prev,
      tenant_id: cfg.tenant_id || '',
      client_id: cfg.client_id || '',
      secretOnFile: isMasked(cfg.client_secret) ? cfg.client_secret : (cfg.client_secret ? '••••' : null),
      sender_email: cfg.sender_email || '',
    }));
  };

  const load = async () => {
    try { const { data } = await api.get('/integrations/microsoft365'); apply(data); } catch { /* silent */ }
    try {
      const { data: ob } = await api.get('/email/outbox', { params: { status: 'queued', limit: 200 } });
      setQueuedCount((ob?.items || []).length);
    } catch { setQueuedCount(0); }
    try {
      const { data: r } = await api.get('/integrations/microsoft365/redirect-uri');
      setRedirectUri(r?.redirect_uri || '');
    } catch { /* silent */ }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (params.get('connected') === '1') {
      toast.success('Microsoft 365 connected', { description: 'Click Test Connection to verify Graph access.' });
      const next = new URLSearchParams(params); next.delete('connected'); setParams(next, { replace: true });
      load();
    } else if (params.get('error')) {
      toast.error('OAuth failed', { description: params.get('error') });
      const next = new URLSearchParams(params); next.delete('error'); setParams(next, { replace: true });
    }
    // eslint-disable-next-line
  }, [params]);

  const buildBody = () => ({
    tenant_id: s.tenant_id || null,
    client_id: s.client_id || null,
    client_secret: s.secretInput ? s.secretInput : (s.secretOnFile || null),
    sender_email: s.sender_email || null,
  });

  const autoSave = async () => {
    try { const { data } = await api.put('/integrations/microsoft365', buildBody()); apply(data); return true; }
    catch (e) { authErrorToast(toast, e, 'Microsoft 365'); return false; }
  };

  const save = async () => {
    setBusy((b) => ({ ...b, save: true }));
    const ok = await autoSave();
    if (ok) { toast.success('Setup saved'); setS((p) => ({ ...p, secretInput: '' })); }
    setBusy((b) => ({ ...b, save: false }));
  };

  const connect = async () => {
    if (!setupReady) {
      toast.error('Save Tenant ID, Client ID, Client Secret, and Sender Email first.');
      return;
    }
    setBusy((b) => ({ ...b, connect: true }));
    try {
      const { data } = await api.get('/integrations/microsoft365/oauth/start');
      // Full-page redirect (NOT an iframe — Microsoft refuses X-Frame embedding).
      // Use window.top to break out of any preview-iframe shell.
      const target = window.top || window;
      target.location.href = data.authorize_url;
    } catch (e) {
      authErrorToast(toast, e, 'Microsoft 365');
      setBusy((b) => ({ ...b, connect: false }));
    }
  };

  const copyRedirectUri = async () => {
    if (!redirectUri) return;
    try {
      await navigator.clipboard.writeText(redirectUri);
      toast.success('Redirect URI copied');
    } catch {
      toast.error('Copy failed — select the text and copy manually');
    }
  };

  const test = async () => {
    setBusy((b) => ({ ...b, test: true })); setTestMsg(null);
    try {
      const { data } = await api.post('/integrations/microsoft365/test-connection');
      setTestMsg({ ok: true, text: `Connected as ${data.displayName} (${data.email})` });
      toast.success(`Connected as ${data.displayName}`);
      await load();
    } catch (e) {
      setTestMsg({ ok: false, text: e?.response?.data?.detail || e.message });
      authErrorToast(toast, e, 'Microsoft 365');
    } finally { setBusy((b) => ({ ...b, test: false })); }
  };

  const flush = async () => {
    setBusy((b) => ({ ...b, flush: true }));
    try {
      const { data } = await api.post('/integrations/microsoft365/flush-queue');
      toast.success(`Flushed · ${data.sent} sent · ${data.failed} failed`);
      await load();
    } catch (e) { authErrorToast(toast, e, 'Microsoft 365'); }
    finally { setBusy((b) => ({ ...b, flush: false })); }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Microsoft 365? Existing tokens will be cleared.')) return;
    setBusy((b) => ({ ...b, disconnect: true }));
    try {
      await api.post('/integrations/microsoft365/disconnect');
      toast.success('Disconnected');
      await load();
    } catch (e) { authErrorToast(toast, e, 'Microsoft 365'); }
    finally { setBusy((b) => ({ ...b, disconnect: false })); }
  };

  const connected = doc?.status === 'connected';
  const errored = doc?.status === 'error';
  // All 4 setup fields must be present in the saved doc (not just typed inputs).
  // The masked echo of client_secret means it's stored; sender_email and IDs are plain.
  const setupReady = !!(s.tenant_id && s.client_id && (s.secretOnFile || s.secretInput) && s.sender_email);
  const missingFields = [
    !s.tenant_id && 'Tenant ID',
    !s.client_id && 'Client ID',
    !(s.secretOnFile || s.secretInput) && 'Client Secret',
    !s.sender_email && 'Sender Email',
  ].filter(Boolean);
  const graphUser = doc?.graph_user;

  return (
    <div className="max-w-5xl mx-auto space-y-6" data-testid="m365-admin">
      <BackButton to="/app/settings/integrations" />
      <AdminCard
        title={<>Microsoft 365 <span className="text-slate-400 mx-2">·</span> Email Delivery</>}
        statusPill={<StatusPill connected={connected} errored={errored} testid="m365-status-pill" />}
      >
        <p className="text-sm leading-relaxed mb-7">
          Paste your Azure app registration values, click <strong>Save</strong>, then <strong>Connect to Microsoft</strong>.
          We use the auth-code flow with offline_access + Mail.Send so we can refresh tokens and send queued emails.
        </p>

        {/* Setup */}
        <h3 className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-700 mb-3">1 · Setup</h3>
        <div className="grid sm:grid-cols-2 gap-x-7 gap-y-5">
          <Field label="Tenant ID">
            <Input value={s.tenant_id} onChange={(v) => setS({ ...s, tenant_id: v })} placeholder="00000000-0000-0000-0000-000000000000" testid="m365-tenant" />
          </Field>
          <Field label="Client ID">
            <Input value={s.client_id} onChange={(v) => setS({ ...s, client_id: v })} placeholder="00000000-0000-0000-0000-000000000000" testid="m365-client-id" />
          </Field>
          <Field label="Client Secret" rightSlot={<SavedChip savedValue={s.secretOnFile} hasInput={!!s.secretInput} testid="m365-secret-saved" />}>
            <InputWithToggle value={s.secretInput} onChange={(v) => setS({ ...s, secretInput: v })}
              placeholder={s.secretOnFile || '••••••••'} show={showSecret} onToggle={() => setShowSecret((x) => !x)}
              testid="m365-secret" />
          </Field>
          <Field label="Sender email">
            <Input type="email" value={s.sender_email} onChange={(v) => setS({ ...s, sender_email: v })} placeholder="hseq@yourcompany.com" testid="m365-sender" />
          </Field>
        </div>
        <div className="mt-5">
          <button onClick={save} disabled={busy.save} data-testid="m365-save"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-transparent text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60 hover:bg-black/5"
            style={{ color: '#0F1B2D', border: '1px solid #0F1B2D' }}>
            {busy.save ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>

        {/* Redirect URI block — admin must register this in Azure AD */}
        {redirectUri && (
          <div className="mt-6 rounded-xl border border-[#D8CFB8] bg-[#FAF6EC] p-4" data-testid="m365-redirect-uri-card">
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-700 mb-2">
              Add this redirect URI to your Azure AD app registration:
            </div>
            <div className="flex items-center gap-2">
              <code data-testid="m365-redirect-uri" className="flex-1 text-xs font-mono break-all px-3 py-2 bg-white rounded border border-slate-200 text-slate-800">
                {redirectUri}
              </code>
              <button onClick={copyRedirectUri} data-testid="m365-copy-redirect-uri"
                title="Copy redirect URI"
                className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-white hover:border-slate-400">
                <Copy size={12} /> Copy
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-600">
              Azure portal → your app → <strong>Authentication</strong> → <strong>Web platform</strong> → add this exact URI under <em>Redirect URIs</em>.
            </p>
          </div>
        )}

        {/* Connect */}
        <div className="my-7 border-t border-[#D8CFB8]" />
        <h3 className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-700 mb-3">2 · Connect</h3>
        {connected ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900 flex items-center justify-between gap-3" data-testid="m365-connected-card">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} />
              <span>Connected as <strong>{graphUser?.displayName || 'Microsoft user'}</strong> ({graphUser?.mail || graphUser?.userPrincipalName})</span>
            </div>
            <button onClick={disconnect} disabled={busy.disconnect} data-testid="m365-disconnect"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50">
              <XCircle size={13} /> Disconnect
            </button>
          </div>
        ) : (
          <>
            <button onClick={connect} disabled={busy.connect || !setupReady}
              data-testid="m365-connect"
              title={!setupReady ? `Save ${missingFields.join(', ')} first` : 'Sign in with Microsoft (full-page redirect)'}
              className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60 ${setupReady ? '' : 'cursor-not-allowed'}`}
              style={{ backgroundColor: setupReady ? '#2C6BFF' : '#94A3B8' }}>
              {busy.connect ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />} Connect to Microsoft →
            </button>
            {!setupReady && (
              <p className="mt-2 text-xs text-amber-800" data-testid="m365-setup-missing">
                Save {missingFields.join(', ')} first to enable Microsoft sign-in.
              </p>
            )}
          </>
        )}

        {testMsg && (
          <div className={`mt-5 inline-flex items-center gap-1.5 text-sm ${testMsg.ok ? 'text-emerald-700' : 'text-red-700'}`} data-testid="m365-test-msg">
            {testMsg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} <span>{testMsg.text}</span>
          </div>
        )}

        <div className="mt-5">
          <button onClick={test} disabled={busy.test || !connected} data-testid="m365-test-connection"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ backgroundColor: '#0F1B2D' }}>
            {busy.test ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test Connection
          </button>
        </div>

        {/* Outbox flush */}
        <div className="my-7 border-t border-[#D8CFB8]" />
        <h3 className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-700 mb-3">3 · Outbox</h3>
        {queuedCount > 0 ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-amber-900 flex items-center justify-between gap-3" data-testid="m365-queued-card">
            <div className="flex items-center gap-2"><Mail size={14} /> <span><strong>{queuedCount}</strong> queued email{queuedCount === 1 ? '' : 's'} ready to flush</span></div>
            <button onClick={flush} disabled={busy.flush || !connected} data-testid="m365-flush"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-60"
              style={{ backgroundColor: '#16A34A' }}>
              {busy.flush ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send queued now →
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-600" data-testid="m365-queue-empty">No queued emails. When M365 is connected, new emails send instantly.</p>
        )}
      </AdminCard>
    </div>
  );
}
