import React, { useEffect, useState } from 'react';
import { Loader2, Play, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { BackButton } from '../components/capture/Ui';
import {
  AdminCard, StatusPill, Field, Input, InputWithToggle, SavedChip, isMasked, authErrorToast,
} from '../components/IntegrationFormUI';

const empty = {
  username: '',
  keyInput: '',
  keyOnFile: null,
  default_sender_id: '',
  daily_budget_aud: 10,
};

export default function TextMagicAdmin() {
  const [s, setS] = useState(empty);
  const [doc, setDoc] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState({ save: false, test: false });
  const [testMsg, setTestMsg] = useState(null);

  const apply = (data) => {
    setDoc(data);
    const cfg = data?.config || {};
    setS((prev) => ({
      ...prev,
      username: cfg.username || '',
      keyOnFile: isMasked(cfg.api_key) ? cfg.api_key : (cfg.api_key ? '••••' : null),
      default_sender_id: cfg.default_sender_id || '',
      daily_budget_aud: cfg.daily_budget_aud ?? 10,
    }));
  };

  const load = async () => {
    try { const { data } = await api.get('/integrations/textmagic'); apply(data); } catch { /* silent */ }
  };
  useEffect(() => { load(); }, []);

  const buildBody = () => ({
    username: s.username || null,
    api_key: s.keyInput ? s.keyInput : (s.keyOnFile || null),
    default_sender_id: s.default_sender_id || null,
    daily_budget_aud: Number(s.daily_budget_aud) || 10,
  });

  const autoSave = async () => {
    try { const { data } = await api.put('/integrations/textmagic', buildBody()); apply(data); return true; }
    catch (e) { authErrorToast(toast, e, 'TextMagic'); return false; }
  };

  const save = async () => {
    setBusy((b) => ({ ...b, save: true }));
    const ok = await autoSave();
    if (ok) { toast.success('Credentials saved'); setS((p) => ({ ...p, keyInput: '' })); }
    setBusy((b) => ({ ...b, save: false }));
  };

  const test = async () => {
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, test: true })); setTestMsg(null);
    try {
      const { data } = await api.post('/integrations/textmagic/test-connection');
      const txt = `Connected · ${data.account_name || 'Account'} · Balance ${data.currency || 'USD'} ${data.balance}`;
      setTestMsg({ ok: true, text: txt });
      toast.success(txt);
      await load();
    } catch (e) {
      setTestMsg({ ok: false, text: e?.response?.data?.detail || e.message });
      authErrorToast(toast, e, 'TextMagic');
    } finally { setBusy((b) => ({ ...b, test: false })); }
  };

  const connected = doc?.status === 'connected';
  const errored = doc?.status === 'error';

  return (
    <div className="max-w-5xl mx-auto" data-testid="textmagic-admin">
      <BackButton to="/app/settings/integrations" />
      <AdminCard
        title={<>TextMagic <span className="text-slate-400 mx-2">·</span> SMS Notifications</>}
        statusPill={<StatusPill connected={connected} errored={errored} testid="textmagic-status-pill" />}
      >
        <p className="text-sm leading-relaxed mb-7">
          Paste your TextMagic username + API key from your TextMagic dashboard. We check your account balance on
          <strong> Test Connection</strong> and apply a $5 estimate-cap on every outbound send.
        </p>

        <div className="grid sm:grid-cols-2 gap-x-7 gap-y-5">
          <Field label="Username">
            <Input value={s.username} onChange={(v) => setS({ ...s, username: v })} placeholder="yourtextmagic" testid="tm-username" />
          </Field>
          <Field label="API key" rightSlot={<SavedChip savedValue={s.keyOnFile} hasInput={!!s.keyInput} testid="tm-key-saved" />}>
            <InputWithToggle value={s.keyInput} onChange={(v) => setS({ ...s, keyInput: v })}
              placeholder={s.keyOnFile || '••••••••'} show={showKey} onToggle={() => setShowKey((x) => !x)}
              testid="tm-key" mono />
          </Field>
          <Field label="Default sender ID">
            <Input value={s.default_sender_id} onChange={(v) => setS({ ...s, default_sender_id: v })} placeholder="PaneltecCivil or +61…" testid="tm-sender" />
          </Field>
          <Field label="Daily budget · $AUD">
            <Input type="number" value={String(s.daily_budget_aud)} onChange={(v) => setS({ ...s, daily_budget_aud: Number(v) || 0 })} testid="tm-budget" />
          </Field>
        </div>

        {testMsg && (
          <div className={`mt-5 inline-flex items-center gap-1.5 text-sm ${testMsg.ok ? 'text-emerald-700' : 'text-red-700'}`} data-testid="textmagic-test-msg">
            {testMsg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} <span>{testMsg.text}</span>
          </div>
        )}

        <div className="mt-7 flex flex-wrap gap-3">
          <button onClick={save} disabled={busy.save} data-testid="tm-save"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-transparent text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60 hover:bg-black/5"
            style={{ color: '#0F1B2D', border: '1px solid #0F1B2D' }}>
            {busy.save ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <button onClick={test} disabled={busy.test} data-testid="tm-test-connection"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ backgroundColor: '#0F1B2D' }}>
            {busy.test ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test Connection
          </button>
        </div>
      </AdminCard>
    </div>
  );
}
