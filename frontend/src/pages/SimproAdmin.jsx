import React, { useEffect, useState } from 'react';
import { Key, Loader2, Play, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { BackButton } from '../components/capture/Ui';
import {
  AdminCard, StatusPill, Field, Input, InputWithToggle, SavedChip, isMasked, authErrorToast,
} from '../components/IntegrationFormUI';

const DEFAULT_BASE = 'https://demo.simprosuite.com';

const empty = {
  api_base_url: DEFAULT_BASE,
  company_id: '',
  company_id_2: '',
  client_id: '',
  secretInput: '',
  secretOnFile: null,
  accessTokenOnFile: null,
  poll_seconds: 900,
  staff_custom_field: '',
  staff_field_value: '',
};

function Helper({ children }) {
  return <p className="text-xs text-slate-500 mt-1 leading-snug">{children}</p>;
}

export default function SimproAdmin() {
  const [s, setS] = useState(empty);
  const [doc, setDoc] = useState(null);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState({ save: false, token: false, test: false });
  const [testMsg, setTestMsg] = useState(null);

  const apply = (data) => {
    setDoc(data);
    const cfg = data?.config || {};
    setS((prev) => ({
      ...prev,
      api_base_url: cfg.api_base_url || DEFAULT_BASE,
      company_id: cfg.company_id || '',
      company_id_2: cfg.company_id_2 || '',
      client_id: cfg.client_id || '',
      secretOnFile: isMasked(cfg.client_secret) ? cfg.client_secret : (cfg.client_secret ? '••••' : null),
      accessTokenOnFile: isMasked(cfg.access_token) ? cfg.access_token : (cfg.access_token ? '••••' : null),
      poll_seconds: cfg.poll_seconds ?? 900,
      staff_custom_field: cfg.staff_custom_field || '',
      staff_field_value: cfg.staff_field_value || '',
    }));
  };

  const load = async () => {
    try { const { data } = await api.get('/integrations/simpro'); apply(data); } catch { /* silent */ }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const buildBody = () => ({
    api_base_url: s.api_base_url || DEFAULT_BASE,
    company_id: s.company_id || null,
    company_id_2: s.company_id_2 || null,
    client_id: s.client_id || null,
    client_secret: s.secretInput ? s.secretInput : (s.secretOnFile || null),
    poll_seconds: Number(s.poll_seconds) || 900,
    staff_custom_field: s.staff_custom_field || null,
    staff_field_value: s.staff_field_value || null,
  });

  const autoSave = async () => {
    try { const { data } = await api.put('/integrations/simpro', buildBody()); apply(data); return true; }
    catch (e) { authErrorToast(toast, e, 'Simpro'); return false; }
  };

  const save = async () => {
    setBusy((b) => ({ ...b, save: true }));
    const ok = await autoSave();
    if (ok) { toast.success('Credentials saved'); setS((p) => ({ ...p, secretInput: '' })); }
    setBusy((b) => ({ ...b, save: false }));
  };

  const getToken = async () => {
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, token: true }));
    try {
      const { data } = await api.post('/integrations/simpro/get-token');
      toast.success('Access token refreshed', { description: `Stored ${data.access_token_last4 || ''} · expires in ${data.expires_in}s` });
      await load();
    } catch (e) { authErrorToast(toast, e, 'Simpro'); }
    finally { setBusy((b) => ({ ...b, token: false })); }
  };

  const test = async () => {
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, test: true }));
    setTestMsg(null);
    try {
      const { data } = await api.post('/integrations/simpro/test-connection');
      setTestMsg({ ok: true, text: `Connected · ${data.staff_count} staff cached` });
      toast.success(`Connected · ${data.staff_count} staff`);
      await load();
    } catch (e) {
      setTestMsg({ ok: false, text: e?.response?.data?.detail || e.message });
      authErrorToast(toast, e, 'Simpro');
    } finally { setBusy((b) => ({ ...b, test: false })); }
  };

  const connected = doc?.status === 'connected';
  const errored = doc?.status === 'error';

  return (
    <div className="max-w-5xl mx-auto" data-testid="simpro-admin">
      <BackButton to="/app/settings/integrations" />
      <AdminCard
        title={<>Simpro <span className="text-slate-400 mx-2">·</span> Staff Sync</>}
        statusPill={<StatusPill connected={connected} errored={errored} testid="simpro-status-pill" />}
      >
        <p className="text-sm leading-relaxed mb-7">
          Paste your Simpro OAuth2 client credentials, click <strong>Get Token</strong>, then
          <strong> Test Connection</strong>. We cache staff for 5 minutes and auto-refresh on stale reads.
        </p>

        <div className="grid sm:grid-cols-2 gap-x-7 gap-y-5">
          <div>
            <Field label="API base URL">
              <Input value={s.api_base_url} onChange={(v) => setS({ ...s, api_base_url: v })} placeholder={DEFAULT_BASE} testid="simpro-base" />
            </Field>
            <Helper>Your Simpro API endpoint (e.g. <code className="text-[11px]">https://yourcompany.simprosuite.com</code>).</Helper>
          </div>
          <div>
            <Field label="Company ID (Primary)">
              <Input value={s.company_id} onChange={(v) => setS({ ...s, company_id: v })} placeholder="0" testid="simpro-company" />
            </Field>
            <Helper>Your primary Simpro builder/account ID. <strong>Required</strong>. Found in <strong>Setup → System → Info &amp; Licence</strong>.</Helper>
          </div>
          <div>
            <Field label="Company ID 2 (Optional)">
              <Input value={s.company_id_2} onChange={(v) => setS({ ...s, company_id_2: v })} placeholder="—" testid="simpro-company-2" />
            </Field>
            <Helper>Second Simpro builder/account ID, if you have one.</Helper>
          </div>
          <div>
            <Field label="Client ID">
              <Input value={s.client_id} onChange={(v) => setS({ ...s, client_id: v })} placeholder="abc123…" testid="simpro-client-id" />
            </Field>
            <Helper>The Client ID from your Simpro OAuth API key. Create one in <strong>Setup → System → Integrations → OAuth2 Clients</strong>.</Helper>
          </div>
          <div>
            <Field label="Client Secret" rightSlot={<SavedChip savedValue={s.secretOnFile} hasInput={!!s.secretInput} testid="simpro-secret-saved" />}>
              <InputWithToggle
                value={s.secretInput} onChange={(v) => setS({ ...s, secretInput: v })}
                placeholder={s.secretOnFile || '••••••••'} show={showSecret} onToggle={() => setShowSecret((x) => !x)}
                testid="simpro-secret"
              />
            </Field>
            <Helper>The Client Secret paired with the Client ID above. Shown only once when the OAuth client is created.</Helper>
          </div>
          <div>
            <Field label="Access token (read-only)" rightSlot={<SavedChip savedValue={s.accessTokenOnFile} hasInput={false} testid="simpro-token-saved" />}>
              <Input value={s.accessTokenOnFile || ''} onChange={() => {}} placeholder="click Get Token" disabled testid="simpro-access-token" />
            </Field>
            <Helper>Auto-fetched by Simpro using your Client ID + Secret when you click <strong>Get Token</strong>. We use it on every Simpro API call. If you see "Token expired", click Get Token again to refresh.</Helper>
          </div>
          <div>
            <Field label="Poll · seconds">
              <Input type="number" value={String(s.poll_seconds)} onChange={(v) => setS({ ...s, poll_seconds: Number(v) || 900 })} testid="simpro-poll" />
            </Field>
            <Helper>How often to refresh the cached staff list from Simpro (default: <code className="text-[11px]">600</code> = 10 minutes).</Helper>
          </div>

          {/* Whiteboard staff filter */}
          <div>
            <Field label="Staff custom field">
              <Input value={s.staff_custom_field} onChange={(v) => setS({ ...s, staff_custom_field: v })}
                placeholder="Show on Whiteboard" testid="simpro-staff-custom-field" />
            </Field>
            <Helper>Simpro custom field name used to mark which staff appear on the whiteboard (optional). Example: <code className="text-[11px]">Show on Whiteboard</code>.</Helper>
          </div>
          <div>
            <Field label="Staff field value">
              <Input value={s.staff_field_value} onChange={(v) => setS({ ...s, staff_field_value: v })}
                placeholder="Yes" testid="simpro-staff-field-value" />
            </Field>
            <Helper>The value that marks a staff member as visible on the whiteboard. Example: <code className="text-[11px]">Yes</code> or <code className="text-[11px]">True</code>.</Helper>
          </div>
        </div>

        {testMsg && (
          <div className={`mt-5 inline-flex items-center gap-1.5 text-sm ${testMsg.ok ? 'text-emerald-700' : 'text-red-700'}`} data-testid="simpro-test-msg">
            {testMsg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} <span>{testMsg.text}</span>
          </div>
        )}

        <div className="mt-7 flex flex-wrap gap-3">
          <button onClick={getToken} disabled={busy.token} data-testid="simpro-get-token"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ backgroundColor: '#16A34A' }}>
            {busy.token ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />} Get Token
          </button>
          <button onClick={save} disabled={busy.save} data-testid="simpro-save"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-transparent text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60 hover:bg-black/5"
            style={{ color: '#0F1B2D', border: '1px solid #0F1B2D' }}>
            {busy.save ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <button onClick={test} disabled={busy.test} data-testid="simpro-test-connection"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ backgroundColor: '#0F1B2D' }}>
            {busy.test ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test Connection
          </button>
        </div>
      </AdminCard>
    </div>
  );
}
