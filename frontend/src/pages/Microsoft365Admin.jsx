import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Play, Save, CheckCircle2, AlertCircle, LogIn, Mail, Send, XCircle } from 'lucide-react';
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
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, connect: true }));
    try {
      const { data } = await api.get('/integrations/microsoft365/oauth/start');
      window.location.href = data.authorize_url;
    } catch (e) { authErrorToast(toast, e, 'Microsoft 365'); setBusy((b) => ({ ...b, connect: false })); }
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
  const setupReady = s.tenant_id && s.client_id && (s.secretInput || s.secretOnFile);
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
          <button onClick={connect} disabled={busy.connect || !setupReady} data-testid="m365-connect"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ backgroundColor: '#2C6BFF' }}>
            {busy.connect ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />} Connect to Microsoft →
          </button>
        )}
        {!setupReady && !connected && (
          <p className="mt-2 text-xs text-amber-800">Save tenant_id, client_id, client_secret first.</p>
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
