import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Play, Save, Plug, CheckCircle2, AlertCircle, X, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { BackButton } from '../components/capture/Ui';
import {
  AdminCard, StatusPill, Field, Input, InputWithToggle, SavedChip, isMasked, authErrorToast,
} from '../components/IntegrationFormUI';

const DEFAULT_BASE = 'https://demo.simprosuite.com';

const empty = {
  api_base_url: DEFAULT_BASE,
  company_ids: [],
  tokenInput: '',
  tokenOnFile: null,
  staff_custom_field: '',
  staff_field_value: '',
  position_filter: [],
  sync_interval_minutes: 60,
  auto_sync_enabled: false,
  completed_jobs_history_days: 30,
};

function Helper({ children }) {
  return <p className="text-xs text-slate-500 mt-1 leading-snug">{children}</p>;
}

function ChipPill({ label, onRemove, testid }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: '#0F1B2D', color: '#fff' }} data-testid={testid}>
      {label}
      <button type="button" onClick={onRemove} className="opacity-70 hover:opacity-100"
        aria-label={`Remove ${label}`} data-testid={testid ? `${testid}-remove` : undefined}>
        <X size={11} />
      </button>
    </span>
  );
}

function PositionFilterInput({ tags, onChange, testid }) {
  const [text, setText] = useState('');
  const add = (raw) => {
    const v = raw.trim();
    if (!v || tags.includes(v)) return;
    onChange([...tags, v]);
  };
  const remove = (t) => onChange(tags.filter((x) => x !== t));
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
      setText('');
    } else if (e.key === 'Backspace' && !text && tags.length) {
      remove(tags[tags.length - 1]);
    }
  };
  return (
    <div
      className="w-full px-2 py-2 text-sm rounded-lg flex flex-wrap items-center gap-1.5 min-h-[42px]"
      style={{ backgroundColor: '#FAF6EC', border: '1px solid #D8CFB8' }}
      data-testid={testid}
    >
      {tags.map((t) => (
        <ChipPill key={t} label={t} onRemove={() => remove(t)} testid={`${testid}-tag-${t}`} />
      ))}
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => { if (text.trim()) { add(text); setText(''); } }}
        placeholder={tags.length ? '' : 'e.g. Electrician, Site Supervisor'}
        className="flex-1 min-w-[140px] bg-transparent outline-none px-1.5 py-1 text-sm"
        data-testid={`${testid}-input`}
      />
    </div>
  );
}

function Toggle({ checked, onChange, testid }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      data-testid={testid}
      className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors"
      style={{ backgroundColor: checked ? '#2C6BFF' : '#CBC2A8' }}
    >
      <span
        className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(22px)' : 'translateX(4px)' }}
      />
      <span className="sr-only">{checked ? 'Enabled' : 'Disabled'}</span>
    </button>
  );
}

function CompaniesModal({ open, items, loading, initialSelected, onDone, onClose }) {
  const [selected, setSelected] = useState(() => new Set(initialSelected.map(String)));

  useEffect(() => {
    if (open) setSelected(new Set(initialSelected.map(String)));
  }, [open, initialSelected]);

  if (!open) return null;
  const toggle = (id) => {
    const next = new Set(selected);
    const k = String(id);
    if (next.has(k)) next.delete(k); else next.add(k);
    setSelected(next);
  };
  const selectAll = () => setSelected(new Set(items.map((c) => String(c.id))));
  const clearAll = () => setSelected(new Set());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}
      data-testid="simpro-companies-modal">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-800">Available Companies</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800" data-testid="simpro-companies-close">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-2 border-b border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500">{selected.size} selected of {items.length}</span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={selectAll} className="text-blue-600 hover:underline"
              data-testid="simpro-companies-select-all">Select all</button>
            <button type="button" onClick={clearAll} className="text-slate-500 hover:underline"
              data-testid="simpro-companies-clear-all">Clear</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center text-slate-500 text-sm inline-flex items-center gap-2 justify-center w-full">
              <Loader2 size={14} className="animate-spin" /> Loading companies…
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-slate-500 text-sm">No companies returned.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((c) => {
                const k = String(c.id);
                const checked = selected.has(k);
                return (
                  <li key={k}>
                    <label className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer"
                      data-testid={`simpro-company-row-${c.id}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(c.id)}
                        className="h-4 w-4 accent-blue-600"
                        data-testid={`simpro-company-checkbox-${c.id}`}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-slate-800">{c.name || '—'}</div>
                        {c.country && <div className="text-xs text-slate-500">{c.country}</div>}
                      </div>
                      <span className="text-xs font-mono px-2 py-1 rounded bg-slate-100 text-slate-700">ID {c.id}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-3">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg"
            data-testid="simpro-companies-cancel">Cancel</button>
          <button
            onClick={() => onDone(Array.from(selected))}
            disabled={selected.size === 0}
            data-testid="simpro-companies-done"
            className="px-5 py-2 text-sm font-semibold uppercase tracking-[0.14em] text-white rounded-lg disabled:opacity-60"
            style={{ backgroundColor: '#2C6BFF' }}
          >
            Done ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SimproAdmin() {
  const [s, setS] = useState(empty);
  const [doc, setDoc] = useState(null);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState({ save: false, test: false, connect: false, list: false });
  const [testMsg, setTestMsg] = useState(null);
  const [companiesModal, setCompaniesModal] = useState({ open: false, items: [], loading: false });
  const [manualText, setManualText] = useState('');

  const apply = (data) => {
    setDoc(data);
    const cfg = data?.config || {};
    const ids = Array.isArray(cfg.company_ids) && cfg.company_ids.length
      ? cfg.company_ids.map(String)
      : (cfg.company_id ? [String(cfg.company_id)] : []);
    setS((prev) => ({
      ...prev,
      api_base_url: cfg.api_base_url || DEFAULT_BASE,
      company_ids: ids,
      tokenOnFile: isMasked(cfg.api_token) ? cfg.api_token : (cfg.api_token ? '••••' : null),
      staff_custom_field: cfg.staff_custom_field || '',
      staff_field_value: cfg.staff_field_value || '',
      position_filter: Array.isArray(cfg.position_filter) ? cfg.position_filter : [],
      sync_interval_minutes: cfg.sync_interval_minutes ?? 60,
      auto_sync_enabled: !!cfg.auto_sync_enabled,
      completed_jobs_history_days: cfg.completed_jobs_history_days ?? 30,
    }));
  };

  const load = async () => {
    try { const { data } = await api.get('/integrations/simpro'); apply(data); } catch { /* silent */ }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const buildBody = () => ({
    api_base_url: s.api_base_url || DEFAULT_BASE,
    company_ids: s.company_ids,
    api_token: s.tokenInput ? s.tokenInput : (s.tokenOnFile || null),
    staff_custom_field: s.staff_custom_field || null,
    staff_field_value: s.staff_field_value || null,
    position_filter: s.position_filter || [],
    sync_interval_minutes: Math.max(1, Number(s.sync_interval_minutes) || 60),
    auto_sync_enabled: !!s.auto_sync_enabled,
    completed_jobs_history_days: Math.max(7, Math.min(365, Number(s.completed_jobs_history_days) || 30)),
  });

  const autoSave = async () => {
    try { const { data } = await api.put('/integrations/simpro', buildBody()); apply(data); return true; }
    catch (e) { authErrorToast(toast, e, 'Simpro'); return false; }
  };

  const save = async () => {
    setBusy((b) => ({ ...b, save: true }));
    const ok = await autoSave();
    if (ok) { toast.success('SimPRO settings saved'); setS((p) => ({ ...p, tokenInput: '' })); }
    setBusy((b) => ({ ...b, save: false }));
  };

  const summariseCompanies = (data) => {
    const ok = (data.companies || []).filter((c) => c.status === 'ok');
    const bad = (data.companies || []).filter((c) => c.status !== 'ok');
    const parts = [];
    if (ok.length) parts.push(`${ok.length} verified (${ok.map((c) => c.id).join(', ')})`);
    if (bad.length) parts.push(`${bad.length} failed (${bad.map((c) => c.id).join(', ')})`);
    return parts.join(' · ');
  };

  const test = async () => {
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, test: true }));
    setTestMsg(null);
    try {
      const { data } = await api.post('/integrations/simpro/test-connection');
      const label = summariseCompanies(data) || 'Verified';
      setTestMsg({ ok: true, text: label });
      toast.success(label);
      await load();
    } catch (e) {
      setTestMsg({ ok: false, text: e?.response?.data?.detail || e.message });
      authErrorToast(toast, e, 'Simpro');
    } finally { setBusy((b) => ({ ...b, test: false })); }
  };

  const connect = async () => {
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, connect: true }));
    setTestMsg(null);
    try {
      const { data } = await api.post('/integrations/simpro/connect');
      const parts = ['Connected'];
      if (data.synced != null) parts.push(`${data.synced} jobs synced`);
      if (data.completed_recent != null) parts.push(`${data.completed_recent} completed in window`);
      toast.success(parts.join(' · '));
      setTestMsg({ ok: true, text: parts.join(' · ') });
      await load();
    } catch (e) {
      setTestMsg({ ok: false, text: e?.response?.data?.detail || e.message });
      authErrorToast(toast, e, 'Simpro');
    } finally { setBusy((b) => ({ ...b, connect: false })); }
  };

  const listCompanies = async () => {
    if (!await autoSave()) return;
    setBusy((b) => ({ ...b, list: true }));
    setCompaniesModal({ open: true, items: [], loading: true });
    try {
      const { data } = await api.get('/integrations/simpro/companies');
      setCompaniesModal({ open: true, items: data.companies || [], loading: false });
    } catch (e) {
      setCompaniesModal({ open: false, items: [], loading: false });
      authErrorToast(toast, e, 'Simpro');
    } finally { setBusy((b) => ({ ...b, list: false })); }
  };

  const removeCompanyId = (id) => {
    setS((p) => ({ ...p, company_ids: p.company_ids.filter((x) => x !== id) }));
  };

  const commitModalSelection = (ids) => {
    setS((p) => ({ ...p, company_ids: ids.map(String) }));
    setCompaniesModal({ open: false, items: [], loading: false });
    toast.success(`Selected ${ids.length} compan${ids.length === 1 ? 'y' : 'ies'}`);
  };

  const applyManual = () => {
    const tokens = manualText.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
    if (!tokens.length) return;
    const merged = Array.from(new Set([...s.company_ids, ...tokens]));
    setS((p) => ({ ...p, company_ids: merged }));
    setManualText('');
  };

  const connected = doc?.status === 'connected';
  const errored = doc?.status === 'error';
  const verified = connected && !!doc?.last_tested_at;

  const perCompanyStatus = useMemo(() => {
    const map = {};
    (doc?.companies_status || []).forEach((c) => { map[String(c.id)] = c; });
    return map;
  }, [doc]);

  return (
    <div className="max-w-5xl mx-auto" data-testid="simpro-admin">
      <BackButton to="/app/settings/integrations" />
      <AdminCard
        title={<>SimPRO <span className="text-slate-400 mx-2">·</span> Staff &amp; Jobs Sync</>}
        statusPill={<StatusPill connected={connected} errored={errored} testid="simpro-status-pill" />}
      >
        <p className="text-sm leading-relaxed mb-7">
          Paste your SimPRO instance URL, pick one or more Company IDs, and a static API token. Tap <strong>Test Connection</strong> to verify each company, then <strong>Connect</strong> to run the first jobs sync.
        </p>

        <div className="grid sm:grid-cols-2 gap-x-7 gap-y-5">
          <div>
            <Field label="URL">
              <Input value={s.api_base_url} onChange={(v) => setS({ ...s, api_base_url: v })}
                placeholder={DEFAULT_BASE} testid="simpro-base" />
            </Field>
            <Helper>Your SimPRO instance URL (e.g. <code className="text-[11px]">https://yourcompany.simprosuite.com</code>).</Helper>
          </div>
          <div>
            <Field label="Company IDs">
              <div
                className="w-full px-2 py-2 text-sm rounded-lg flex flex-wrap items-center gap-1.5 min-h-[42px]"
                style={{ backgroundColor: '#FAF6EC', border: '1px solid #D8CFB8' }}
                data-testid="simpro-company-ids"
              >
                {s.company_ids.length === 0 && (
                  <span className="text-xs text-slate-500 px-1.5">No companies selected — tap List or type below.</span>
                )}
                {s.company_ids.map((id) => {
                  const st = perCompanyStatus[id];
                  const bg = st?.status === 'ok' ? '#0F7B5A'
                    : st && st.status !== 'ok' ? '#B23A3A'
                      : '#0F1B2D';
                  const label = st?.status === 'ok' && st.name ? `${id} · ${st.name}` : id;
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ backgroundColor: bg, color: '#fff' }} data-testid={`simpro-company-chip-${id}`}>
                      {label}
                      <button type="button" onClick={() => removeCompanyId(id)} className="opacity-70 hover:opacity-100"
                        aria-label={`Remove ${id}`} data-testid={`simpro-company-remove-${id}`}>
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
                <button onClick={listCompanies} disabled={busy.list}
                  data-testid="simpro-list-companies"
                  className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[10px] font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
                  style={{ backgroundColor: '#2C6BFF' }}>
                  {busy.list ? <Loader2 size={11} className="animate-spin" /> : <ListChecks size={11} />} List
                </button>
              </div>
            </Field>
            <Helper>Tap <strong>List</strong> to pick from your Simpro companies. Chips turn green when verified.</Helper>
          </div>

          <div className="sm:col-span-2 -mt-1">
            <Field label="Or type Company IDs comma-separated">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input value={manualText} onChange={setManualText}
                    placeholder="e.g. 2, 3" testid="simpro-company-manual" />
                </div>
                <button onClick={applyManual}
                  data-testid="simpro-company-manual-add"
                  className="inline-flex items-center px-4 rounded-lg text-sm font-semibold uppercase tracking-[0.14em] hover:bg-black/5"
                  style={{ color: '#0F1B2D', border: '1px solid #0F1B2D' }}>
                  Add
                </button>
              </div>
            </Field>
            <Helper>Manual fallback. Comma- or space-separated IDs; merges into the list above.</Helper>
          </div>

          <div className="sm:col-span-2">
            <Field label="API Token"
              rightSlot={<SavedChip savedValue={s.tokenOnFile} hasInput={!!s.tokenInput} testid="simpro-token-saved" />}>
              <InputWithToggle
                value={s.tokenInput} onChange={(v) => setS({ ...s, tokenInput: v })}
                placeholder={s.tokenOnFile || '••••••••'} show={showToken} onToggle={() => setShowToken((x) => !x)}
                testid="simpro-token"
              />
            </Field>
            <Helper>Found in SimPRO → <strong>Settings → API → Generate Key</strong>.</Helper>
          </div>

          <div>
            <Field label="Staff custom field">
              <Input value={s.staff_custom_field} onChange={(v) => setS({ ...s, staff_custom_field: v })}
                placeholder="Show on Whiteboard" testid="simpro-staff-custom-field" />
            </Field>
            <Helper>SimPRO custom field name used to mark which staff appear on the whiteboard.</Helper>
          </div>
          <div>
            <Field label="Staff field value">
              <Input value={s.staff_field_value} onChange={(v) => setS({ ...s, staff_field_value: v })}
                placeholder="Yes" testid="simpro-staff-field-value" />
            </Field>
            <Helper>The value that marks a staff member as visible. Example: <code className="text-[11px]">Yes</code>.</Helper>
          </div>

          <div className="sm:col-span-2">
            <Field label="Position filter (fallback)">
              <PositionFilterInput
                tags={s.position_filter}
                onChange={(arr) => setS({ ...s, position_filter: arr })}
                testid="simpro-position-filter"
              />
            </Field>
            <Helper>Add one or more positions. Case-insensitive substring match on the employee Position in SimPRO. Press Enter or &quot;,&quot; to add; tap × to remove. Used only if the custom-field filter returns nothing.</Helper>
          </div>

          <div>
            <Field label="Sync interval (minutes)">
              <Input type="number" value={String(s.sync_interval_minutes)}
                onChange={(v) => setS({ ...s, sync_interval_minutes: Number(v) || 60 })}
                testid="simpro-sync-interval" />
            </Field>
            <Helper>How often to pull new jobs from SimPRO.</Helper>
          </div>
          <div>
            <Field label="Auto sync">
              <div className="flex items-center gap-3 px-1 py-2">
                <Toggle
                  checked={s.auto_sync_enabled}
                  onChange={(v) => setS({ ...s, auto_sync_enabled: v })}
                  testid="simpro-auto-sync"
                />
                <span className="text-sm text-slate-700">{s.auto_sync_enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            </Field>
            <Helper>Automatically pull jobs on the schedule above.</Helper>
          </div>

          <div className="sm:col-span-2">
            <Field label="Completed jobs history (days)">
              <Input type="number" value={String(s.completed_jobs_history_days)}
                onChange={(v) => setS({ ...s, completed_jobs_history_days: Number(v) || 30 })}
                testid="simpro-history-days" />
            </Field>
            <Helper>How many days of <strong>Complete / Archived / Invoiced</strong> jobs to keep on the board (7–365).</Helper>
          </div>
        </div>

        {testMsg && (
          <div className={`mt-5 inline-flex items-center gap-1.5 text-sm ${testMsg.ok ? 'text-emerald-700' : 'text-red-700'}`}
            data-testid="simpro-test-msg">
            {testMsg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} <span>{testMsg.text}</span>
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button onClick={test} disabled={busy.test} data-testid="simpro-test-connection"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-transparent text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60 hover:bg-black/5"
            style={{ color: '#0F1B2D', border: '1px solid #0F1B2D' }}>
            {busy.test ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test Connection
          </button>
          <button onClick={connect} disabled={busy.connect} data-testid="simpro-connect"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ backgroundColor: '#2C6BFF' }}>
            {busy.connect ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Connect
          </button>
          <button onClick={save} disabled={busy.save} data-testid="simpro-save"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ backgroundColor: '#2C6BFF' }}>
            {busy.save ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save SimPRO
          </button>
          {verified && (
            <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-[0.14em] border border-emerald-400 text-emerald-700"
              data-testid="simpro-verified-pill">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Verified
            </span>
          )}
        </div>
      </AdminCard>

      <SimproSyncCard connected={connected} />

      <StaffPreview
        configKey={JSON.stringify({
          companies: s.company_ids,
          field: s.whiteboard_custom_field,
          positions: s.position_filter,
        })}
        companyIds={s.company_ids}
      />

      <CompaniesModal
        open={companiesModal.open}
        items={companiesModal.items}
        loading={companiesModal.loading}
        initialSelected={s.company_ids}
        onDone={commitModalSelection}
        onClose={() => setCompaniesModal({ open: false, items: [], loading: false })}
      />
    </div>
  );
}

// ──────────────── Staff matching filter preview (debounced) ────────────────
function StaffPreview({ configKey, companyIds }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const PAGE_SIZE = 10;

  React.useEffect(() => {
    setPage(0);
    if (!companyIds || companyIds.length === 0) { setRows([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/integrations/simpro/employees', {
          params: { company_ids: companyIds.join(','), filter: 'whiteboard' },
        });
        setRows(data?.employees || data || []);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  return (
    <div data-testid="simpro-staff-preview">
    <AdminCard title="Staff matching your current filter"
      subtitle="Preview of SimPRO employees the whiteboard filter would return right now.">
      {loading ? (
        <div className="space-y-2" data-testid="simpro-preview-loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 rounded bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-500 py-8 text-center bg-slate-50 rounded-lg" data-testid="simpro-preview-empty">
          No staff match your current filter — try adjusting it.
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm" data-testid="simpro-preview-table">
              <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Email</th>
                  <th className="text-left px-3 py-2 hidden lg:table-cell">Position</th>
                  <th className="text-left px-3 py-2 hidden lg:table-cell">Company</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((e, i) => (
                  <tr key={e.simpro_employee_id || i} className="border-t border-slate-100" data-testid={`preview-row-${i}`}>
                    <td className="px-3 py-2 font-medium text-slate-900">{e.name || `${e.given_name || ''} ${e.family_name || ''}`.trim() || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 hidden md:table-cell">{e.email || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 hidden lg:table-cell">{e.position || '—'}</td>
                    <td className="px-3 py-2 text-slate-500 hidden lg:table-cell">{e.simpro_company_id || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>{rows.length} match{rows.length === 1 ? '' : 'es'}</span>
            {pages > 1 && (
              <div className="inline-flex items-center gap-1">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                  data-testid="preview-prev"
                  className="px-2 py-1 rounded border border-slate-300 disabled:opacity-40">Prev</button>
                <span>{page + 1} / {pages}</span>
                <button onClick={() => setPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1}
                  data-testid="preview-next"
                  className="px-2 py-1 rounded border border-slate-300 disabled:opacity-40">Next</button>
              </div>
            )}
          </div>
        </>
      )}
    </AdminCard>
    </div>
  );
}

function _SimproAdminEnd() {
  return null;
}

// ────────────── Sync now card (Customers / Vendors / Employees / Sites) ──────────────

function relTime(iso) {
  if (!iso) return 'never';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    return `${Math.round(hrs / 24)} d ago`;
  } catch { return iso; }
}

function SimproSyncCard({ connected }) {
  const [lastSynced, setLastSynced] = React.useState({});
  const [busy, setBusy] = React.useState({});
  const [counts, setCounts] = React.useState({});

  const refresh = React.useCallback(async () => {
    try {
      const { data } = await api.get('/integrations/simpro/last-synced');
      setLastSynced(data?.last_synced_at || {});
    } catch { /* keep silent — connection card already surfaces errors */ }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  const doSync = async (kind, label, url, post = true) => {
    setBusy((b) => ({ ...b, [kind]: true }));
    try {
      const { data } = post ? await api.post(url, kind === 'employees' ? { company: 'both' } : {}) : await api.get(url);
      const n = data?.total ?? data?.count ?? data?.updated ?? 0;
      const verb = kind === 'sites' ? 'sites'
        : kind === 'employees' ? 'employees'
        : kind === 'vendors' ? 'vendors'
        : 'customers';
      const withCoords = data?.with_coords;
      toast.success(`Synced ${n} ${verb} from Simpro${
        withCoords != null ? ` · ${withCoords} with coords` : ''}`);
      setCounts((c) => ({ ...c, [kind]: { n, withCoords } }));
      refresh();
    } catch (e) {
      toast.error(`${label} sync failed — ${e?.response?.data?.detail || e.message}`);
    } finally {
      setBusy((b) => ({ ...b, [kind]: false }));
    }
  };

  const Row = ({ kind, label, hint, url, post }) => (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-white"
      data-testid={`simpro-sync-row-${kind}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <div className="text-[11px] text-slate-500">
          Last synced: <span data-testid={`simpro-last-${kind}`}>{relTime(lastSynced[kind])}</span>
          {counts[kind] && (
            <span className="ml-1 text-emerald-700"> · {counts[kind].n} {counts[kind].withCoords != null ? `(${counts[kind].withCoords} with coords)` : ''}</span>
          )}
          <span className="ml-1 text-slate-400">· {hint}</span>
        </div>
      </div>
      <button type="button" disabled={!connected || busy[kind]}
        onClick={() => doSync(kind, label, url, post)}
        data-testid={`simpro-sync-${kind}`}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-xs font-semibold uppercase tracking-[0.1em] disabled:opacity-50"
        style={{ backgroundColor: '#2C6BFF' }}>
        {busy[kind] ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        Sync now
      </button>
    </div>
  );

  return (
    <AdminCard
      title={<>Resources <span className="text-slate-400 mx-2">·</span> Sync now</>}
      subtitle="One-tap pulls of the four Simpro resources surfaced inside form pickers. Last-synced times persist per organisation.">
      <div className="grid gap-2.5">
        <Row kind="customers" label="Customers" hint="Used by Customer pickers"
          url="/integrations/simpro/sync-customers" post />
        <Row kind="vendors" label="Vendors" hint="Used by Supplier pickers"
          url="/integrations/simpro/suppliers/sync" post />
        <Row kind="employees" label="Employees" hint="Used by Worker pickers"
          url="/workers/sync-from-simpro" post />
        <Row kind="sites" label="Sites" hint="Used by Site pickers (with coords)"
          url="/integrations/simpro/sync-sites" post />
      </div>
      {!connected && (
        <p className="text-xs text-amber-700 mt-3 flex items-center gap-1.5">
          <AlertCircle size={12} /> Connect Simpro above before running a sync.
        </p>
      )}
    </AdminCard>
  );
}
