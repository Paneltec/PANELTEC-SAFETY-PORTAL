import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Briefcase, Truck, MessageSquare, Mail, CheckCircle2, Loader2, X, Copy,
  Eye, EyeOff, RefreshCw, Trash2, AlertCircle, Plus, Send
} from "lucide-react";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem("pt_token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

const INTEGRATIONS = [
  { id: "simpro", label: "SimPRO", icon: Briefcase, color: "from-orange-500 to-amber-600", desc: "Job scheduling & roster sync" },
  { id: "navixy", label: "Navixy GPS", icon: Truck, color: "from-emerald-500 to-teal-600", desc: "Live vehicle tracking & fleet management" },
  { id: "textmagic", label: "Textmagic (SMS)", icon: MessageSquare, color: "from-purple-500 to-pink-600", desc: "Send SMS to staff" },
  { id: "m365", label: "Microsoft 365 Email", icon: Mail, color: "from-blue-500 to-cyan-600", desc: "Graph SendMail (real emails)" },
];

export default function IntegrationsPage() {
  const [active, setActive] = useState("simpro");
  return (
    <div className="p-6 lg:p-8 fadein">
      <div className="mb-6">
        <h1 className="text-3xl font-black text-slate-900">Integrations</h1>
        <p className="text-slate-500 mt-1">Connect Paneltec to SimPRO, Navixy GPS, Textmagic SMS, and Microsoft 365 Email.</p>
      </div>
      <div className="flex gap-2 mb-6 overflow-x-auto border-b">
        {INTEGRATIONS.map(i => (
          <button key={i.id} onClick={()=>setActive(i.id)}
            className={`px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold flex items-center gap-2 whitespace-nowrap transition ${active===i.id?"border-amber-400 text-slate-900":"border-transparent text-slate-500 hover:text-slate-700"}`}
            data-testid={`integration-tab-${i.id}`}>
            <i.icon className="w-4 h-4"/>{i.label}
          </button>
        ))}
      </div>
      {active === "simpro" && <SimproPanel/>}
      {active === "navixy" && <NavixyPanel/>}
      {active === "textmagic" && <TextmagicPanel/>}
      {active === "m365" && <M365Panel/>}
    </div>
  );
}

function StatusBadge({ verified, connected }) {
  if (verified) return <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/>Verified</span>;
  if (connected) return <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">• Not yet verified</span>;
  return <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border">Not connected</span>;
}

function PasswordInput({ value, onChange, placeholder, "data-testid": testId }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show?"text":"password"} value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2.5 border rounded-lg pr-10 font-mono text-sm" data-testid={testId}/>
      <button type="button" onClick={()=>setShow(!show)} className="absolute right-2 top-3 text-slate-400 hover:text-slate-700">
        {show ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
      </button>
    </div>
  );
}

// ============== SIMPRO PANEL ==============
function SimproPanel() {
  const [status, setStatus] = useState(null);
  const [cfg, setCfg] = useState({
    base_url: "", company_id: "0", api_token: "",
    staff_custom_field: "", staff_field_value: "", position_filter: [],
    sync_interval_minutes: 1440, auto_sync: false, completed_jobs_history_days: 365, incremental_sync: false,
  });
  const [companies, setCompanies] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [positionInput, setPositionInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = async () => {
    const { data } = await api.get("/integrations/simpro/status");
    setStatus(data);
    if (data.connected) {
      setCfg(prev => ({ ...prev,
        base_url: data.base_url || "",
        company_id: data.company_id || "0",
      }));
    }
  };
  useEffect(() => { load(); }, []);

  const set = (k,v) => setCfg({ ...cfg, [k]: v });

  const connect = async () => {
    setSaving(true);
    try {
      await api.post("/integrations/simpro/connect", { base_url: cfg.base_url, api_token: cfg.api_token, company_id: cfg.company_id });
      await api.put("/integrations/simpro/config", cfg);
      load();
    } catch (e) { alert("Connect failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data } = await api.get("/integrations/simpro/companies");
      setTestResult({ ok: true, msg: `Connected. Found ${data.length} compan${data.length===1?"y":"ies"}.` });
      setCompanies(data);
    } catch (e) {
      setTestResult({ ok: false, msg: e?.response?.data?.detail || e.message });
    }
    setTesting(false);
  };

  const listCompanies = async () => {
    try {
      const { data } = await api.get("/integrations/simpro/companies");
      setCompanies(data);
    } catch (e) { alert("Failed: " + (e?.response?.data?.detail || e.message)); }
  };

  const loadCustomFields = async () => {
    try {
      const { data } = await api.get("/integrations/simpro/custom-fields");
      setCustomFields(data.items || []);
    } catch (e) {}
  };
  useEffect(() => { if (status?.connected) loadCustomFields(); }, [status]);

  const addPosition = (p) => {
    const v = p.trim();
    if (!v || cfg.position_filter.includes(v)) return;
    setCfg({ ...cfg, position_filter: [...cfg.position_filter, v] });
    setPositionInput("");
  };
  const removePosition = (p) => setCfg({ ...cfg, position_filter: cfg.position_filter.filter(x=>x!==p) });

  const selectedField = customFields.find(f => f.name === cfg.staff_custom_field);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center"><Briefcase className="w-6 h-6 text-orange-500"/></div>
          <div>
            <h2 className="text-2xl font-bold">SimPRO Integration</h2>
            <p className="text-sm text-slate-500">Job scheduling & roster sync</p>
          </div>
        </div>
        <StatusBadge verified={status?.has_token} connected={status?.connected}/>
      </div>

      <div className="bg-white border rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold mb-1">URL</label>
            <input value={cfg.base_url} onChange={e=>set("base_url", e.target.value)} placeholder="https://paneltec.simprosuite.com" className="w-full px-3 py-2.5 border rounded-lg font-mono text-sm" data-testid="simpro-base-url"/>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Company ID</label>
            <div className="text-xs text-slate-500 mb-1">If "Company does not exist", click "List Companies" to pick the right one.</div>
            <div className="flex gap-2">
              <input value={cfg.company_id} onChange={e=>set("company_id", e.target.value)} className="flex-1 px-3 py-2.5 border rounded-lg font-mono text-sm" data-testid="simpro-company-id"/>
              <button onClick={listCompanies} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-sm flex items-center gap-1.5" data-testid="simpro-list-btn">
                <RefreshCw className="w-3.5 h-3.5"/>LIST
              </button>
            </div>
            {companies.length > 0 && (
              <select value={cfg.company_id} onChange={e=>set("company_id", e.target.value)} className="mt-2 w-full px-3 py-2 border rounded text-sm">
                {companies.map(c => <option key={c.id} value={c.id}>{c.name} (#{c.id})</option>)}
              </select>
            )}
          </div>
        </div>
        <div>
          <label className="block text-sm font-bold mb-1">API Token</label>
          <div className="text-xs text-slate-500 mb-1">Found in SimPRO → Settings → API → Generate Key</div>
          <PasswordInput value={cfg.api_token} onChange={v=>set("api_token", v)} placeholder="Paste your SimPRO API token" data-testid="simpro-api-token"/>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold mb-1">Staff Custom Field</label>
            <div className="text-xs text-slate-500 mb-1">SimPRO custom field name for whiteboard filtering (optional).</div>
            <select value={cfg.staff_custom_field} onChange={e=>set("staff_custom_field", e.target.value)} className="w-full px-3 py-2.5 border rounded-lg" data-testid="simpro-custom-field">
              <option value="">— None —</option>
              {customFields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
              <option value="Interactive Scheduler Status">Interactive Scheduler Status</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Staff Field Value</label>
            <div className="text-xs text-slate-500 mb-1">Value that marks a staff member for the whiteboard.</div>
            <select value={cfg.staff_field_value} onChange={e=>set("staff_field_value", e.target.value)} className="w-full px-3 py-2.5 border rounded-lg" data-testid="simpro-field-value">
              <option value="">— None —</option>
              {(selectedField?.options || ["Assign this user to the White Board","Hide from White Board"]).map(o => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold mb-1">Position Filter (fallback)</label>
          <div className="text-xs text-slate-500 mb-2">Case-insensitive substring match on the employee Position in SimPRO. Press Enter or "," to add.</div>
          <div className="flex flex-wrap gap-1.5 bg-slate-50 border rounded-lg p-2 min-h-[60px]">
            {cfg.position_filter.map(p => (
              <span key={p} className="px-3 py-1 bg-blue-600 text-white rounded-full text-xs font-bold flex items-center gap-1">
                {p}
                <button onClick={()=>removePosition(p)} type="button" className="hover:bg-blue-700 rounded-full"><X className="w-3 h-3"/></button>
              </span>
            ))}
            <input value={positionInput} onChange={e=>setPositionInput(e.target.value)}
              onKeyDown={e=>{ if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addPosition(positionInput); }}}
              onBlur={()=>positionInput && addPosition(positionInput)}
              placeholder="Add another..." className="flex-1 min-w-[120px] px-2 py-1 text-sm bg-transparent focus:outline-none" data-testid="simpro-position-input"/>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold mb-1">Sync Interval (minutes)</label>
            <div className="text-xs text-slate-500 mb-1">How often to pull from SimPRO. With Incremental sync ON, 1 min is safe.</div>
            <input type="number" value={cfg.sync_interval_minutes} onChange={e=>set("sync_interval_minutes", parseInt(e.target.value)||60)} className="w-full px-3 py-2.5 border rounded-lg font-mono text-sm"/>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Auto Sync</label>
            <div className="text-xs text-slate-500 mb-2">Automatically pull jobs on schedule</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={cfg.auto_sync} onChange={e=>set("auto_sync", e.target.checked)} className="w-5 h-5 accent-blue-500"/>
              <span className="font-semibold">{cfg.auto_sync ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Completed Jobs History (days)</label>
            <div className="text-xs text-slate-500 mb-1">How far back to fetch Complete / Archived / Invoiced jobs.</div>
            <input type="number" value={cfg.completed_jobs_history_days} onChange={e=>set("completed_jobs_history_days", parseInt(e.target.value)||90)} className="w-full px-3 py-2.5 border rounded-lg font-mono text-sm"/>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Incremental sync ⚡</label>
            <div className="text-xs text-slate-500 mb-2">Only pull jobs modified since the last sync. Lets you safely run auto-sync every 60 seconds.</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={cfg.incremental_sync} onChange={e=>set("incremental_sync", e.target.checked)} className="w-5 h-5 accent-blue-500"/>
              <span className="font-semibold">Enable incremental (delta) sync</span>
            </label>
          </div>
        </div>

        {testResult && (
          <div className={`p-3 rounded-lg border text-sm ${testResult.ok?"bg-emerald-50 border-emerald-200 text-emerald-800":"bg-red-50 border-red-200 text-red-800"}`}>
            {testResult.ok ? "✓ " : "⚠ "}{testResult.msg}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <button onClick={testConnection} disabled={testing||!cfg.base_url||!cfg.api_token} className="px-4 py-2.5 bg-white border-2 hover:bg-slate-50 rounded font-bold text-sm flex items-center gap-2 disabled:opacity-50" data-testid="simpro-test-btn">
            {testing ? <Loader2 className="w-4 h-4 animate-spin"/> : null}TEST CONNECTION
          </button>
          <button onClick={connect} disabled={saving||!cfg.base_url||!cfg.api_token} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-sm flex items-center gap-2 disabled:opacity-50" data-testid="simpro-connect-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}CONNECT
          </button>
          <button onClick={connect} disabled={saving||!cfg.base_url} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-sm flex items-center gap-2 disabled:opacity-50" data-testid="simpro-save-btn">
            SAVE SIMPRO
          </button>
          <StatusBadge verified={false} connected={status?.connected}/>
        </div>
      </div>
    </div>
  );
}

// ============== NAVIXY PANEL ==============
function NavixyPanel() {
  const [status, setStatus] = useState(null);
  const [cfg, setCfg] = useState({ email: "", password: "", api_key: "", api_base_url: "api.us.navixy.com", account_id: "", tag_filter: [], poll_interval_seconds: 30, auto_poll: false });
  const [tags, setTags] = useState([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = async () => {
    const { data } = await api.get("/integrations/navixy/status");
    setStatus(data);
    if (data.connected) {
      setCfg(prev => ({ ...prev,
        email: data.email||"", api_base_url: data.api_base_url||"api.us.navixy.com",
        tag_filter: data.tag_filter||[], poll_interval_seconds: data.poll_interval_seconds||30, auto_poll: !!data.auto_poll,
      }));
      loadTags();
    }
  };
  useEffect(() => { load(); }, []);

  const loadTags = async () => {
    try { const { data } = await api.get("/integrations/navixy/tags"); setTags(data.tags || []); } catch {}
  };

  const set = (k,v) => setCfg({ ...cfg, [k]: v });

  const connect = async (re=false) => {
    setSaving(true);
    try {
      const payload = { ...cfg };
      if (re) { payload.api_key = null; } // force re-auth via password
      const { data } = await api.post("/integrations/navixy/connect", payload);
      if (data.api_key) setCfg({ ...cfg, api_key: data.api_key });
      load();
    } catch (e) { alert("Connect failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data } = await api.post("/integrations/navixy/test");
      setTestResult({ ok: data.ok, msg: data.ok ? "✓ Connection OK" : (data.error || JSON.stringify(data.detail)) });
    } catch (e) { setTestResult({ ok: false, msg: e?.response?.data?.detail || e.message }); }
    setTesting(false);
  };

  const toggleTag = (tagId) => set("tag_filter", cfg.tag_filter.includes(tagId) ? cfg.tag_filter.filter(x=>x!==tagId) : [...cfg.tag_filter, tagId]);
  const selectAll = () => set("tag_filter", tags.map(t=>t.id));
  const clearTags = () => set("tag_filter", []);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center"><Truck className="w-6 h-6 text-emerald-600"/></div>
          <div>
            <h2 className="text-2xl font-bold">Navixy GPS Integration</h2>
            <p className="text-sm text-slate-500">Live vehicle tracking & fleet management</p>
          </div>
        </div>
        <StatusBadge verified={status?.verified} connected={status?.connected}/>
      </div>

      <div className="bg-white border rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold mb-1">Email</label>
            <input value={cfg.email} onChange={e=>set("email", e.target.value)} placeholder="info@paneltec.com.au" className="w-full px-3 py-2.5 border rounded-lg" data-testid="navixy-email"/>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Password</label>
            <PasswordInput value={cfg.password} onChange={v=>set("password", v)} placeholder="Navixy password (for initial auth)" data-testid="navixy-password"/>
          </div>
        </div>
        <div>
          <label className="block text-sm font-bold mb-1">API Key / Session Hash</label>
          <div className="text-xs text-slate-500 mb-1">Found in Navixy → My Account → API Key</div>
          <PasswordInput value={cfg.api_key} onChange={v=>set("api_key", v)} placeholder="session hash" data-testid="navixy-api-key"/>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold mb-1">API Base URL</label>
            <input value={cfg.api_base_url} onChange={e=>set("api_base_url", e.target.value)} className="w-full px-3 py-2.5 border rounded-lg font-mono text-sm" data-testid="navixy-base-url"/>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Account / Fleet ID</label>
            <div className="text-xs text-slate-500 mb-1">Your Navixy account or fleet identifier</div>
            <input value={cfg.account_id} onChange={e=>set("account_id", e.target.value)} className="w-full px-3 py-2.5 border rounded-lg" data-testid="navixy-account-id"/>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-bold">Tag Filter</label>
            <div className="flex gap-1">
              <button onClick={loadTags} className="px-3 py-1 text-xs font-bold border rounded flex items-center gap-1" data-testid="navixy-refresh-tags"><RefreshCw className="w-3 h-3"/>Refresh</button>
              <button onClick={selectAll} className="px-3 py-1 text-xs font-bold border rounded">All</button>
              <button onClick={clearTags} className="px-3 py-1 text-xs font-bold border rounded">Clear</button>
            </div>
          </div>
          <div className="text-xs text-slate-500 mb-2">Filter vehicles by one or more Navixy tags (OR)</div>
          <div className="border rounded-lg p-3 bg-slate-50">
            <div className="text-xs font-bold text-slate-600 mb-2">{cfg.tag_filter.length} tag{cfg.tag_filter.length===1?"":"s"} selected</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {tags.length === 0 ? (
                <div className="col-span-3 text-center text-sm text-slate-400 py-3">Connect to load available tags.</div>
              ) : tags.map(t => (
                <label key={t.id} className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer text-sm ${cfg.tag_filter.includes(t.id)?"bg-blue-100 border-blue-400":"bg-white"}`}>
                  <input type="checkbox" checked={cfg.tag_filter.includes(t.id)} onChange={()=>toggleTag(t.id)} className="accent-blue-500"/>
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold mb-1">GPS Poll Interval (seconds)</label>
            <div className="text-xs text-slate-500 mb-1">How often to refresh vehicle locations</div>
            <input type="number" value={cfg.poll_interval_seconds} onChange={e=>set("poll_interval_seconds", parseInt(e.target.value)||30)} className="w-full px-3 py-2.5 border rounded-lg font-mono text-sm"/>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Auto Poll</label>
            <div className="text-xs text-slate-500 mb-2">Continuously update vehicle positions</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={cfg.auto_poll} onChange={e=>set("auto_poll", e.target.checked)} className="w-5 h-5 accent-blue-500"/>
              <span className="font-semibold">{cfg.auto_poll ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
        </div>

        {testResult && (
          <div className={`p-3 rounded-lg border text-sm ${testResult.ok?"bg-emerald-50 border-emerald-200 text-emerald-800":"bg-red-50 border-red-200 text-red-800"}`}>
            {testResult.msg}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <button onClick={testConnection} disabled={testing||!status?.connected} className="px-4 py-2.5 bg-white border-2 hover:bg-slate-50 rounded font-bold text-sm flex items-center gap-2 disabled:opacity-50" data-testid="navixy-test-btn">
            {testing ? <Loader2 className="w-4 h-4 animate-spin"/> : null}TEST CONNECTION
          </button>
          <button onClick={()=>connect(true)} disabled={saving} className="px-4 py-2.5 bg-white border-2 hover:bg-slate-50 rounded font-bold text-sm flex items-center gap-2 disabled:opacity-50" data-testid="navixy-reauth-btn">
            <RefreshCw className="w-4 h-4"/>RE-AUTHENTICATE
          </button>
          <button onClick={()=>connect(false)} disabled={saving||!cfg.email} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-sm flex items-center gap-2 disabled:opacity-50" data-testid="navixy-save-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}SAVE NAVIXY
          </button>
          <StatusBadge verified={status?.verified} connected={status?.connected}/>
        </div>
      </div>
    </div>
  );
}

// ============== TEXTMAGIC PANEL ==============
function TextmagicPanel() {
  const [status, setStatus] = useState(null);
  const [cfg, setCfg] = useState({ api_username: "", api_key: "", default_sender: "PANELTEC" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [copiedField, setCopiedField] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);

  const load = async () => {
    const { data } = await api.get("/integrations/textmagic/status");
    setStatus(data);
    if (data.connected) setCfg(prev => ({ ...prev, api_username: data.api_username||"", default_sender: data.default_sender||"PANELTEC" }));
  };
  useEffect(() => { load(); }, []);

  const set = (k,v) => setCfg({ ...cfg, [k]: v });

  const connect = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/integrations/textmagic/connect", cfg);
      setTestResult({ ok: data.verified, msg: data.verified ? "✓ Verified with Textmagic API" : (data.error || "Saved but not verified") });
      load();
    } catch (e) { setTestResult({ ok: false, msg: e?.response?.data?.detail || e.message }); }
    setSaving(false);
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    await connect();
    setTesting(false);
  };

  const copy = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(()=>setCopiedField(null), 2000);
  };

  const baseUrl = process.env.REACT_APP_BACKEND_URL || "";
  const deliveryWebhook = `${baseUrl}/api/integrations/textmagic/webhook/delivery`;
  const inboundWebhook = `${baseUrl}/api/integrations/textmagic/webhook/inbound`;

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center"><MessageSquare className="w-6 h-6 text-purple-600"/></div>
          <div>
            <h2 className="text-2xl font-bold">Textmagic (SMS)</h2>
            <p className="text-sm text-slate-500">Send SMS to staff. Creds from <i>Settings → API & Integrations → API v2</i> in your Textmagic account.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status?.connected && (
            <button onClick={()=>setShowSendModal(true)} className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded flex items-center gap-1.5"><Send className="w-3.5 h-3.5"/>Send Test SMS</button>
          )}
          <StatusBadge verified={status?.verified} connected={status?.connected}/>
        </div>
      </div>

      <div className="bg-white border rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold mb-1">API Username</label>
            <input value={cfg.api_username} onChange={e=>set("api_username", e.target.value)} placeholder="stephenguy1" className="w-full px-3 py-2.5 border rounded-lg" data-testid="textmagic-username"/>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">API Password / Key</label>
            <PasswordInput value={cfg.api_key} onChange={v=>set("api_key", v)} placeholder="Paste API key" data-testid="textmagic-key"/>
          </div>
        </div>
        <div>
          <label className="block text-sm font-bold mb-1">Default Sender (optional)</label>
          <div className="text-xs text-slate-500 mb-1">Alphanumeric sender ID shown on outgoing SMS. Max 11 chars.</div>
          <input value={cfg.default_sender} onChange={e=>set("default_sender", e.target.value.slice(0,11))} maxLength={11} className="w-full px-3 py-2.5 border rounded-lg uppercase font-mono" data-testid="textmagic-sender"/>
        </div>

        <div className="bg-slate-50 border rounded-xl p-4">
          <div className="text-xs font-bold text-slate-600 tracking-wider mb-1">WEBHOOK URLS (PASTE INTO TEXTMAGIC)</div>
          <div className="text-xs text-slate-500 mb-3">In the Textmagic dashboard go to <b>Settings → API & Integrations → API v1 (legacy)</b>. Paste these into the matching Callback URL fields.</div>
          <div className="space-y-3">
            <div>
              <div className="text-[10px] font-bold tracking-wider text-slate-500 mb-1">DELIVERY NOTIFICATIONS</div>
              <div className="flex gap-2">
                <input value={deliveryWebhook} readOnly className="flex-1 px-3 py-2 border rounded font-mono text-xs bg-white"/>
                <button onClick={()=>copy(deliveryWebhook,"delivery")} className="px-3 py-2 bg-slate-900 text-white text-xs font-bold rounded flex items-center gap-1"><Copy className="w-3 h-3"/>{copiedField==="delivery"?"COPIED":"COPY"}</button>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold tracking-wider text-slate-500 mb-1">INBOUND MESSAGES</div>
              <div className="flex gap-2">
                <input value={inboundWebhook} readOnly className="flex-1 px-3 py-2 border rounded font-mono text-xs bg-white"/>
                <button onClick={()=>copy(inboundWebhook,"inbound")} className="px-3 py-2 bg-slate-900 text-white text-xs font-bold rounded flex items-center gap-1"><Copy className="w-3 h-3"/>{copiedField==="inbound"?"COPIED":"COPY"}</button>
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-3">IP whitelist in Textmagic: <b className="text-blue-600">leave blank</b>. We call their API, not the other way around.</div>
        </div>

        {testResult && (
          <div className={`p-3 rounded-lg border text-sm ${testResult.ok?"bg-emerald-50 border-emerald-200 text-emerald-800":"bg-red-50 border-red-200 text-red-800"}`}>{testResult.msg}</div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <button onClick={testConnection} disabled={testing||!cfg.api_username||!cfg.api_key} className="px-4 py-2.5 bg-white border-2 hover:bg-slate-50 rounded font-bold text-sm flex items-center gap-2 disabled:opacity-50" data-testid="textmagic-test-btn">
            {testing ? <Loader2 className="w-4 h-4 animate-spin"/> : null}TEST CONNECTION
          </button>
          <button onClick={connect} disabled={saving||!cfg.api_username||!cfg.api_key} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-sm flex items-center gap-2 disabled:opacity-50" data-testid="textmagic-save-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}SAVE TEXTMAGIC
          </button>
          <StatusBadge verified={status?.verified} connected={status?.connected}/>
        </div>
      </div>

      {showSendModal && <SendSMSModal onClose={()=>setShowSendModal(false)}/>}
    </div>
  );
}

function SendSMSModal({ onClose }) {
  const [phones, setPhones] = useState("");
  const [text, setText] = useState("Hello from Paneltec Safety Portal! 🦺");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const send = async () => {
    setSending(true);
    try {
      const phoneList = phones.split(/[,\n]/).map(p=>p.trim()).filter(Boolean);
      const { data } = await api.post("/integrations/textmagic/send", { phones: phoneList, text });
      setResult({ ok: data.status_code < 400, msg: JSON.stringify(data.response).slice(0,300) });
    } catch (e) { setResult({ ok: false, msg: e?.response?.data?.detail || e.message }); }
    setSending(false);
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl font-bold">Send Test SMS</h3>
          <button onClick={onClose} className="hover:bg-slate-100 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <label className="block text-sm font-bold mb-1">Phone Numbers (comma-separated, E.164 format)</label>
        <textarea value={phones} onChange={e=>setPhones(e.target.value)} placeholder="+61400000000, +61400000001" rows="2" className="w-full px-3 py-2 border rounded mb-3" data-testid="sms-phones"/>
        <label className="block text-sm font-bold mb-1">Message ({text.length}/160)</label>
        <textarea value={text} onChange={e=>setText(e.target.value)} rows="4" maxLength={1000} className="w-full px-3 py-2 border rounded mb-3" data-testid="sms-text"/>
        {result && <div className={`p-3 rounded mb-3 text-xs ${result.ok?"bg-emerald-50 text-emerald-800":"bg-red-50 text-red-800"}`}>{result.ok?"✓ Sent":""}{result.msg}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={send} disabled={sending||!phones} className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded flex items-center gap-2 disabled:opacity-50" data-testid="sms-send-btn">
            {sending ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4"/>}Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== M365 PANEL ==============
function M365Panel() {
  const [status, setStatus] = useState(null);
  const [cfg, setCfg] = useState({ tenant_id: "", client_id: "", client_secret: "", send_from_mailbox: "", reply_to: "" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);

  const load = async () => {
    const { data } = await api.get("/integrations/m365/status");
    setStatus(data);
    if (data.connected) setCfg(prev => ({ ...prev,
      tenant_id: data.tenant_id||"", client_id: data.client_id||"",
      send_from_mailbox: data.send_from_mailbox||"", reply_to: data.reply_to||"",
    }));
  };
  useEffect(() => { load(); }, []);

  const set = (k,v) => setCfg({ ...cfg, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/integrations/m365/connect", cfg);
      setTestResult({ ok: data.verified, msg: data.verified ? "✓ Connected & verified" : (data.error || "Saved but not verified") });
      setCfg(prev => ({ ...prev, client_secret: "" })); // clear secret from UI
      load();
    } catch (e) { setTestResult({ ok: false, msg: e?.response?.data?.detail || e.message }); }
    setSaving(false);
  };

  const testConn = async () => {
    setTesting(true); setTestResult(null);
    try {
      // re-save = test
      const { data } = await api.post("/integrations/m365/connect", { ...cfg, client_secret: cfg.client_secret || "REUSE" });
      setTestResult({ ok: data.verified, msg: data.verified ? "✓ Connection OK" : (data.error || "Failed") });
    } catch (e) { setTestResult({ ok: false, msg: e?.response?.data?.detail || e.message }); }
    setTesting(false);
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center"><Mail className="w-6 h-6 text-blue-600"/></div>
          <div>
            <h2 className="text-2xl font-bold">Microsoft 365 — Email · Graph SendMail</h2>
            <p className="text-sm text-slate-500">Application permission</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status?.verified && <button onClick={()=>setShowSendModal(true)} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded flex items-center gap-1.5"><Send className="w-3.5 h-3.5"/>Send Test Email</button>}
          <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${status?.verified?"bg-emerald-100 text-emerald-700":"bg-slate-100 text-slate-500"}`}>
            ● {status?.verified?"LIVE":"Not configured"}
          </span>
        </div>
      </div>

      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 mb-5 text-sm">
        <p><b>Recommended for Paneltec</b> — sends invoices and statements straight from a real M365 mailbox you own (no DNS changes). Open <b>portal.azure.com → Microsoft Entra ID → App registrations</b>, create an app named e.g. "Paneltec Email", grant the <b>Mail.Send</b> Application permission (admin consent), then paste the three values below + the mailbox you want to send from.</p>
      </div>

      <div className="bg-white border rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold tracking-wider mb-1">DIRECTORY (TENANT) ID</label>
            <input value={cfg.tenant_id} onChange={e=>set("tenant_id", e.target.value)} placeholder="737160d3-b5cd-..." className="w-full px-3 py-2.5 border rounded-lg font-mono text-sm" data-testid="m365-tenant-id"/>
          </div>
          <div>
            <label className="block text-xs font-bold tracking-wider mb-1">APPLICATION (CLIENT) ID</label>
            <input value={cfg.client_id} onChange={e=>set("client_id", e.target.value)} placeholder="a4d34c92-8d47-..." className="w-full px-3 py-2.5 border rounded-lg font-mono text-sm" data-testid="m365-client-id"/>
          </div>
        </div>
        <div className="text-xs text-slate-500 -mt-3">From your App Registration's Overview page.</div>

        <div>
          <label className="block text-xs font-bold tracking-wider mb-1">CLIENT SECRET (VALUE)</label>
          <PasswordInput value={cfg.client_secret} onChange={v=>set("client_secret", v)} placeholder={status?.connected ? "(saved — leave blank to keep, or paste new)" : "Paste the secret VALUE"} data-testid="m365-client-secret"/>
          <div className="text-xs text-slate-500 mt-1"><b>Important:</b> Azure shows the secret <b>only once</b>. Copy the <b>Value</b> field, not the Secret ID. Secrets expire — rotate before they do.</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold tracking-wider mb-1">SEND-FROM MAILBOX</label>
            <input value={cfg.send_from_mailbox} onChange={e=>set("send_from_mailbox", e.target.value)} placeholder="no-reply@paneltec.com.au" className="w-full px-3 py-2.5 border rounded-lg" data-testid="m365-mailbox"/>
            <div className="text-xs text-slate-500 mt-1">Must be a real licensed M365 mailbox or shared mailbox in your tenant.</div>
          </div>
          <div>
            <label className="block text-xs font-bold tracking-wider mb-1">REPLY-TO (OPTIONAL)</label>
            <input value={cfg.reply_to} onChange={e=>set("reply_to", e.target.value)} placeholder="admin@paneltec.com.au" className="w-full px-3 py-2.5 border rounded-lg" data-testid="m365-replyto"/>
          </div>
        </div>

        {testResult && (
          <div className={`p-3 rounded-lg border text-sm ${testResult.ok?"bg-emerald-50 border-emerald-200 text-emerald-800":"bg-red-50 border-red-200 text-red-800"}`}>{testResult.msg}</div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <button onClick={save} disabled={saving||!cfg.tenant_id||!cfg.client_id} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-sm flex items-center gap-2 disabled:opacity-50" data-testid="m365-save-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}SAVE CREDENTIALS
          </button>
          <button onClick={testConn} disabled={testing||!status?.connected} className="px-4 py-2.5 bg-white border-2 hover:bg-slate-50 rounded font-bold text-sm flex items-center gap-2 disabled:opacity-50" data-testid="m365-test-btn">
            {testing ? <Loader2 className="w-4 h-4 animate-spin"/> : null}▶ TEST CONNECTION
          </button>
        </div>
      </div>

      <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm">
        <h3 className="font-bold mb-2">5-minute Azure setup</h3>
        <ol className="list-decimal ml-5 space-y-1 text-slate-700">
          <li>Sign in at <b>portal.azure.com</b> as a Global Administrator or Application Administrator.</li>
          <li>Open <b>Microsoft Entra ID → App registrations → New registration</b>. Name it "Paneltec Email", single tenant, no redirect URI needed. Click <b>Register</b>.</li>
          <li>On the Overview page, copy <b>Application (client) ID</b> and <b>Directory (tenant) ID</b> into the fields above.</li>
          <li>Open <b>Certificates & secrets → New client secret</b>, choose 24-month expiry, click Add. Copy the "Value" column right away — it's only shown once. Paste it into the Client Secret field above.</li>
          <li>Open <b>API permissions → Add a permission → Microsoft Graph → Application permissions → Mail.Send</b>. Click Add, then <b>Grant admin consent</b> at the top.</li>
          <li>Set <b>Send-from Mailbox</b> above to a real M365 mailbox like noreply@paneltec.com.au, save, then test.</li>
        </ol>
      </div>

      {showSendModal && <SendEmailModal onClose={()=>setShowSendModal(false)}/>}
    </div>
  );
}

function SendEmailModal({ onClose }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("Paneltec Safety Portal — Test Email");
  const [body, setBody] = useState("<p>Hello,</p><p>This is a test email from <b>Paneltec Safety Portal</b> sent via Microsoft 365 Graph SendMail.</p><p>If you received this, the integration is working! 🎉</p>");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const send = async () => {
    setSending(true);
    try {
      const { data } = await api.post("/integrations/m365/send", { to: to.split(/[,\n]/).map(s=>s.trim()).filter(Boolean), subject, body });
      setResult({ ok: data.ok, msg: data.ok ? "✓ Sent successfully" : `Failed: ${data.response||""}` });
    } catch (e) { setResult({ ok: false, msg: e?.response?.data?.detail || e.message }); }
    setSending(false);
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl font-bold">Send Test Email</h3>
          <button onClick={onClose} className="hover:bg-slate-100 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <label className="block text-sm font-bold mb-1">To (comma-separated)</label>
        <input value={to} onChange={e=>setTo(e.target.value)} placeholder="recipient@example.com" className="w-full px-3 py-2 border rounded mb-3" data-testid="email-to"/>
        <label className="block text-sm font-bold mb-1">Subject</label>
        <input value={subject} onChange={e=>setSubject(e.target.value)} className="w-full px-3 py-2 border rounded mb-3" data-testid="email-subject"/>
        <label className="block text-sm font-bold mb-1">Body (HTML)</label>
        <textarea value={body} onChange={e=>setBody(e.target.value)} rows="6" className="w-full px-3 py-2 border rounded mb-3 font-mono text-xs" data-testid="email-body"/>
        {result && <div className={`p-3 rounded mb-3 text-xs ${result.ok?"bg-emerald-50 text-emerald-800":"bg-red-50 text-red-800"}`}>{result.msg}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={send} disabled={sending||!to} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded flex items-center gap-2 disabled:opacity-50" data-testid="email-send-btn">
            {sending ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4"/>}Send
          </button>
        </div>
      </div>
    </div>
  );
}
