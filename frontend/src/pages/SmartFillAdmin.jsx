// Settings → Integrations → SmartFill. The fuel-management API behind
// Fleet → Fuel Reports. Credentials used to live only in the server's
// environment file (how the Emergent copy was set up); saving them here
// stores them encrypted in the database so Fuel Reports works wherever
// the portal is hosted, without anyone editing server files.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Play, Save, CheckCircle2, AlertCircle, Fuel } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { BackButton } from '../components/capture/Ui';
import {
  AdminCard, StatusPill, Field, Input, InputWithToggle, SavedChip, isMasked, authErrorToast,
} from '../components/IntegrationFormUI';

const DEFAULT_URL = 'https://fmtdata.com/API/api.php';

const empty = {
  api_url: DEFAULT_URL,
  api_key: '',
  secretInput: '',
  secretOnFile: null,
};

export default function SmartFillAdmin() {
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
      api_url: cfg.api_url || DEFAULT_URL,
      api_key: cfg.api_key || '',
      secretOnFile: isMasked(cfg.api_secret) ? cfg.api_secret : (cfg.api_secret ? '••••' : null),
    }));
  };

  const load = async () => {
    try { const { data } = await api.get('/integrations/smartfill'); apply(data); } catch { /* silent */ }
  };
  useEffect(() => { load(); }, []);

  const buildBody = () => ({
    api_url: (s.api_url || DEFAULT_URL).trim(),
    api_key: (s.api_key || '').trim() || null,
    api_secret: s.secretInput ? s.secretInput : (s.secretOnFile || null),
  });

  const autoSave = async () => {
    try { const { data } = await api.put('/integrations/smartfill', buildBody()); apply(data); return true; }
    catch (e) { authErrorToast(toast, e, 'SmartFill'); return false; }
  };

  const save = async () => {
    setBusy((b) => ({ ...b, save: true }));
    const ok = await autoSave();
    if (ok) { toast.success('SmartFill credentials saved'); setS((p) => ({ ...p, secretInput: '' })); }
    setBusy((b) => ({ ...b, save: false }));
  };

  const test = async () => {
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, test: true })); setTestMsg(null);
    try {
      const { data } = await api.post('/integrations/smartfill/test-connection');
      const txt = `Connected · SmartFill answered with ${data.tanks} tank${data.tanks === 1 ? '' : 's'}`;
      setTestMsg({ ok: true, text: txt });
      toast.success(txt);
      await load();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setTestMsg({ ok: false, text: (typeof d === 'string' ? d : d?.message) || e.message });
      authErrorToast(toast, e, 'SmartFill');
    } finally { setBusy((b) => ({ ...b, test: false })); }
  };

  const connected = doc?.status === 'connected';
  const errored = doc?.status === 'error';

  return (
    <div className="max-w-5xl mx-auto" data-testid="smartfill-admin">
      <BackButton to="/app/settings/integrations" />
      <AdminCard
        title={<>SmartFill <span className="text-slate-400 mx-2">·</span> Fuel Reports</>}
        statusPill={<StatusPill connected={connected} errored={errored} testid="smartfill-status-pill" />}
      >
        <p className="text-sm leading-relaxed mb-7">
          The client reference and secret come from SmartFill (FMT Data) — the same details that
          used to sit in the server's environment file. Once saved, <strong>Fleet → Fuel Reports</strong> can
          sync fills from SmartFill on this server. <strong>Test Connection</strong> makes one small
          call (tank levels) to confirm they work.
        </p>

        <div className="grid sm:grid-cols-2 gap-x-7 gap-y-5">
          <Field label="Client reference">
            <Input value={s.api_key} onChange={(v) => setS({ ...s, api_key: v })} placeholder="e.g. PANELTEC" testid="sf-key" />
          </Field>
          <Field label="Client secret" rightSlot={<SavedChip savedValue={s.secretOnFile} hasInput={!!s.secretInput} testid="sf-secret-saved" />}>
            <InputWithToggle value={s.secretInput} onChange={(v) => setS({ ...s, secretInput: v })}
              placeholder={s.secretOnFile || '••••••••'} show={showSecret} onToggle={() => setShowSecret((x) => !x)}
              testid="sf-secret" mono />
          </Field>
          <Field label="API address">
            <Input value={s.api_url} onChange={(v) => setS({ ...s, api_url: v })} placeholder={DEFAULT_URL} testid="sf-url" />
          </Field>
        </div>

        {testMsg && (
          <div className={`mt-5 inline-flex items-center gap-1.5 text-sm ${testMsg.ok ? 'text-emerald-700' : 'text-red-700'}`} data-testid="smartfill-test-msg">
            {testMsg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} <span>{testMsg.text}</span>
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={busy.save} data-testid="sf-save"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-transparent text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60 hover:bg-black/5"
            style={{ color: '#0F1B2D', border: '1px solid #0F1B2D' }}>
            {busy.save ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <button onClick={test} disabled={busy.test} data-testid="sf-test-connection"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ backgroundColor: '#0F1B2D' }}>
            {busy.test ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test Connection
          </button>
          <Link to="/app/fleet/fuel" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline ml-auto" data-testid="sf-go-fuel">
            <Fuel size={14} /> Open Fuel Reports
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          SmartFill allows 6 calls a minute and 600 a day, so Test Connection and Sync now share that allowance.
        </p>
      </AdminCard>
    </div>
  );
}
