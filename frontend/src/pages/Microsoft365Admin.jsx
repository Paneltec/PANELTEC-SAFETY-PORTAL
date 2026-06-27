import React, { useEffect, useState } from 'react';
import { Loader2, Play, Save, CheckCircle2, AlertCircle, Mail } from 'lucide-react';
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
  reply_to: '',
};

export default function Microsoft365Admin() {
  const [s, setS] = useState(empty);
  const [doc, setDoc] = useState(null);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState({ save: false, test: false });
  const [testMsg, setTestMsg] = useState(null);

  const apply = (data) => {
    setDoc(data);
    const cfg = data?.config || {};
    setS((prev) => ({
      ...prev,
      tenant_id: cfg.tenant_id || '',
      client_id: cfg.client_id || '',
      secretOnFile: isMasked(cfg.client_secret) ? cfg.client_secret : (cfg.client_secret ? '••••' : null),
      sender_email: cfg.sender_email || '',
      reply_to: cfg.reply_to || '',
    }));
  };

  const load = async () => {
    try { const { data } = await api.get('/integrations/microsoft365'); apply(data); } catch { /* silent */ }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const buildBody = () => ({
    tenant_id: s.tenant_id || null,
    client_id: s.client_id || null,
    client_secret: s.secretInput ? s.secretInput : (s.secretOnFile || null),
    sender_email: s.sender_email || null,
    reply_to: s.reply_to || null,
  });

  const autoSave = async () => {
    try { const { data } = await api.put('/integrations/microsoft365', buildBody()); apply(data); return true; }
    catch (e) { authErrorToast(toast, e, 'Microsoft 365'); return false; }
  };

  const save = async () => {
    setBusy((b) => ({ ...b, save: true }));
    const ok = await autoSave();
    if (ok) { toast.success('Credentials saved'); setS((p) => ({ ...p, secretInput: '' })); }
    setBusy((b) => ({ ...b, save: false }));
  };

  const test = async () => {
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, test: true })); setTestMsg(null);
    try {
      const { data } = await api.post('/integrations/microsoft365/test-connection');
      const flushed = data.flushed_from_queue || 0;
      const flushText = flushed > 0 ? ` (${flushed} queued email${flushed === 1 ? '' : 's'} also flushed)` : '';
      const txt = `Sent a self-test email to ${data.sent_to} — check the inbox.${flushText}`;
      setTestMsg({ ok: true, text: txt });
      toast.success('Test email sent');
      await load();
    } catch (e) {
      setTestMsg({ ok: false, text: e?.response?.data?.detail || e.message });
      authErrorToast(toast, e, 'Microsoft 365');
    } finally { setBusy((b) => ({ ...b, test: false })); }
  };

  const connected = doc?.status === 'connected';
  const errored = doc?.status === 'error';

  return (
    <div className="max-w-5xl mx-auto space-y-6" data-testid="m365-admin">
      <BackButton to="/app/settings/integrations" />
      <AdminCard
        title={<>Microsoft 365 <span className="text-slate-400 mx-2">—</span> Email · Graph SendMail (Application Permission)</>}
        statusPill={<StatusPill connected={connected} errored={errored} testid="m365-status-pill" labels={{ live: '● Live' }} />}
      >
        {/* Recommendation banner */}
        <div className="rounded-xl border border-[#D8CFB8] bg-[#FAF6EC] px-5 py-4 mb-7 text-sm leading-relaxed text-slate-800" data-testid="m365-recommendation">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-emerald-700 mb-1">Recommended for Paneltec</div>
          <p>
            Sends invoices and statements straight from a real M365 mailbox you own (no DNS changes).
            Open <strong>portal.azure.com → Microsoft Entra ID → App registrations</strong>, create an app
            named e.g. "Paneltec Email", grant the <strong>Mail.Send</strong> Application permission
            (admin consent), then paste the three values below + the mailbox you want to send from. Once
            configured, M365 becomes the primary transport (Resend is kept as automatic fallback).
          </p>
        </div>

        {/* Form */}
        <div className="grid sm:grid-cols-2 gap-x-7 gap-y-5">
          <div>
            <Field label="Directory (tenant) ID">
              <Input value={s.tenant_id} onChange={(v) => setS({ ...s, tenant_id: v })}
                placeholder="00000000-0000-0000-0000-000000000000" testid="m365-tenant" />
            </Field>
            <p className="mt-1.5 text-[11px] text-slate-500">From your App Registration's Overview page.</p>
          </div>
          <div>
            <Field label="Application (client) ID">
              <Input value={s.client_id} onChange={(v) => setS({ ...s, client_id: v })}
                placeholder="00000000-0000-0000-0000-000000000000" testid="m365-client-id" />
            </Field>
            <p className="mt-1.5 text-[11px] text-slate-500">From the same Overview page.</p>
          </div>
          <div className="sm:col-span-2">
            <Field label="Client Secret (Value)" rightSlot={<SavedChip savedValue={s.secretOnFile} hasInput={!!s.secretInput} testid="m365-secret-saved" />}>
              <InputWithToggle value={s.secretInput} onChange={(v) => setS({ ...s, secretInput: v })}
                placeholder={s.secretOnFile || 'paste the Value column from Certificates & secrets'}
                show={showSecret} onToggle={() => setShowSecret((x) => !x)} testid="m365-secret" mono />
            </Field>
            <p className="mt-1.5 text-[11px] text-slate-500">
              <strong>Important:</strong> Azure shows the secret <strong>only once</strong>. Copy the
              <em> Value</em> field, not the Secret ID. Secrets expire — rotate before they do.
            </p>
          </div>
          <div>
            <Field label="Send-from Mailbox">
              <Input type="email" value={s.sender_email} onChange={(v) => setS({ ...s, sender_email: v })}
                placeholder="no-reply@paneltec.com.au" testid="m365-sender" />
            </Field>
            <p className="mt-1.5 text-[11px] text-slate-500">Must be a real licensed M365 mailbox or shared mailbox in your tenant.</p>
          </div>
          <div>
            <Field label="Reply-to (optional)">
              <Input type="email" value={s.reply_to} onChange={(v) => setS({ ...s, reply_to: v })}
                placeholder="admin@paneltec.com.au" testid="m365-reply-to" />
            </Field>
            <p className="mt-1.5 text-[11px] text-slate-500">Recipients hit Reply → goes here instead of the send-from mailbox.</p>
          </div>
        </div>

        {testMsg && (
          <div className={`mt-6 inline-flex items-center gap-1.5 text-sm ${testMsg.ok ? 'text-emerald-700' : 'text-red-700'}`} data-testid="m365-test-msg">
            {testMsg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} <span>{testMsg.text}</span>
          </div>
        )}

        {/* Two-button action row */}
        <div className="mt-7 flex flex-wrap gap-3">
          <button onClick={save} disabled={busy.save} data-testid="m365-save"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ backgroundColor: '#2C6BFF' }}>
            {busy.save ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Credentials
          </button>
          <button onClick={test} disabled={busy.test} data-testid="m365-test-connection"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-transparent text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60 hover:bg-black/5"
            style={{ color: '#0F1B2D', border: '1px solid #0F1B2D' }}>
            {busy.test ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test Connection
          </button>
        </div>
      </AdminCard>

      {/* Setup instructions */}
      <div className="rounded-2xl border border-[#D8CFB8] p-6" style={{ backgroundColor: '#F5EFE0' }} data-testid="m365-setup-guide">
        <div className="flex items-center gap-2 mb-3">
          <Mail size={16} className="text-brand-blue" />
          <h3 className="font-display text-lg font-semibold">5-minute Azure setup</h3>
        </div>
        <ol className="space-y-2.5 text-sm leading-relaxed text-slate-800 list-decimal pl-5">
          <li>Sign in at <strong>portal.azure.com</strong> as a Global Administrator or Application Administrator.</li>
          <li>Open <strong>Microsoft Entra ID → App registrations → New registration</strong>. Name it "Paneltec Email", single tenant, <em>no redirect URI needed</em>. Click <strong>Register</strong>.</li>
          <li>On the Overview page, copy <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong> into the fields above.</li>
          <li>Open <strong>Certificates &amp; secrets → New client secret</strong>, choose 24-month expiry, click <strong>Add</strong>. <strong>Copy the "Value" column right away</strong> — it's only shown once. Paste it into the Client Secret field above.</li>
          <li>Open <strong>API permissions → Add a permission → Microsoft Graph → Application permissions → Mail.Send</strong>. Click <strong>Add</strong>, then <strong>Grant admin consent</strong> at the top.</li>
          <li>Set Send-from Mailbox above to a real M365 mailbox like <code className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-xs font-mono">no-reply@paneltec.com.au</code>, save, then test.</li>
          <li><strong>(Recommended)</strong> Lock the app to ONLY this mailbox via an Application Access Policy — see <a href="https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access" target="_blank" rel="noreferrer" className="text-brand-blue hover:underline">Microsoft's Graph SendMail docs</a>.</li>
        </ol>
      </div>
    </div>
  );
}
