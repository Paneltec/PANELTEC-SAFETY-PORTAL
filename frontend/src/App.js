import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./App.css";
import {
  LayoutDashboard, FileText, ClipboardList, Users, MapPin, Award,
  Sparkles, LogOut, Plus, Trash2, Edit3, Save, X, AlertTriangle,
  CheckCircle2, Camera, MapPinned, PenLine, Eye, ShieldCheck, HardHat,
  TrendingUp, Bell, Search, Filter, ChevronRight, Building2, Wrench,
  Calendar, FileSearch, Loader2, Zap, BarChart3
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend, PieChart, Pie, Cell
} from "recharts";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem("pt_token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

const CATEGORY_META = {
  incident:   { label: "Incident",     color: "bg-red-100 text-red-700 border-red-200",       chart: "#EF4444" },
  near_miss:  { label: "Near Miss",    color: "bg-orange-100 text-orange-700 border-orange-200", chart: "#F59E0B" },
  inspection: { label: "Inspection",   color: "bg-blue-100 text-blue-700 border-blue-200",     chart: "#3B82F6" },
  toolbox:    { label: "Toolbox Talk", color: "bg-emerald-100 text-emerald-700 border-emerald-200", chart: "#10B981" },
  general:    { label: "General",      color: "bg-slate-100 text-slate-700 border-slate-200",  chart: "#64748B" },
};

// ===================== LOGIN =====================
function Login({ onLogin }) {
  const [email, setEmail] = useState("admin@paneltec.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("pt_token", data.token);
      localStorage.setItem("pt_user", JSON.stringify(data.user));
      onLogin(data.user);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Login failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-stretch bg-slate-900">
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden brand-grad-dark text-white">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, #FBBF24 0%, transparent 40%), radial-gradient(circle at 80% 70%, #F59E0B 0%, transparent 35%)" }} />
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 brand-grad rounded-xl flex items-center justify-center shadow-lg">
              <HardHat className="w-7 h-7 text-black" />
            </div>
            <div>
              <div className="text-2xl font-black tracking-tight">PANELTEC</div>
              <div className="text-xs text-yellow-300 tracking-widest font-semibold">SAFETY PORTAL</div>
            </div>
          </div>
        </div>
        <div className="relative z-10 space-y-6">
          <h1 className="text-5xl font-black leading-tight">Build Safer.<br/>Build Smarter.<br/><span className="text-yellow-400">Build Together.</span></h1>
          <p className="text-slate-300 text-lg max-w-md">All your civil construction safety forms, inspections, certifications and analytics — in one powerful portal.</p>
          <div className="grid grid-cols-2 gap-4 max-w-md pt-4">
            {[
              { icon: ShieldCheck, label: "Real-time Compliance" },
              { icon: Sparkles, label: "AI-Powered Insights" },
              { icon: Award, label: "Cert Tracking" },
              { icon: BarChart3, label: "Live Analytics" },
            ].map((it, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                  <it.icon className="w-4 h-4 text-yellow-400" />
                </div>
                <span className="text-slate-200">{it.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-xs text-slate-400">© Paneltec Civil Contractors · Safety Portal v1.0</div>
      </div>

      <div className="flex-1 flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md fadein">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <div className="w-11 h-11 brand-grad rounded-xl flex items-center justify-center">
              <HardHat className="w-6 h-6 text-black" />
            </div>
            <div>
              <div className="text-xl font-black">PANELTEC</div>
              <div className="text-[10px] text-amber-600 tracking-widest font-bold">SAFETY PORTAL</div>
            </div>
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-2">Welcome back</h2>
          <p className="text-slate-500 mb-8">Sign in to access your safety portal</p>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input data-testid="login-email" type="email" value={email} onChange={e=>setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition" required/>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
              <input data-testid="login-password" type="password" value={password} onChange={e=>setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition" required/>
            </div>
            {err && <div className="text-sm bg-red-50 text-red-700 p-3 rounded-lg border border-red-200">{err}</div>}
            <button data-testid="login-submit" disabled={loading} type="submit" className="w-full brand-grad text-black font-bold py-3.5 rounded-xl hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-5 h-5 animate-spin"/> : <>Sign In <ChevronRight className="w-5 h-5"/></>}
            </button>
          </form>
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm">
            <div className="font-semibold text-amber-900 mb-1.5">Demo Accounts</div>
            <div className="text-amber-800 space-y-0.5 font-mono text-xs">
              <div>Admin: admin@paneltec.com / admin123</div>
              <div>Worker: worker@paneltec.com / worker123</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===================== SIGNATURE PAD =====================
function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  const getPos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: x * (c.width / r.width), y: y * (c.height / r.height) };
  };
  const start = (e) => { e.preventDefault(); drawing.current = true; const p = getPos(e); const ctx = canvasRef.current.getContext("2d"); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const p = getPos(e); const ctx = canvasRef.current.getContext("2d"); ctx.lineWidth=2.2; ctx.lineCap="round"; ctx.strokeStyle="#0B0B0F"; ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const end = () => { if (!drawing.current) return; drawing.current = false; const data = canvasRef.current.toDataURL("image/png"); onChange && onChange(data); };
  const clear = () => { const c = canvasRef.current; c.getContext("2d").clearRect(0,0,c.width,c.height); onChange && onChange(""); };

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    c.width = c.clientWidth * 2; c.height = c.clientHeight * 2;
    const ctx = c.getContext("2d"); ctx.scale(1,1);
  }, []);

  return (
    <div>
      <canvas ref={canvasRef} className="sig-canvas"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      <div className="flex justify-between items-center mt-2">
        <span className="text-xs text-slate-500">Sign above using mouse or finger</span>
        <button type="button" onClick={clear} className="text-xs text-red-600 hover:text-red-800 font-semibold">Clear</button>
      </div>
      {value && <div className="mt-2 text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5"/>Signature captured</div>}
    </div>
  );
}

// ===================== PHOTO UPLOAD =====================
function PhotoUploader({ values=[], onChange }) {
  const fileToB64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const handle = async (e) => {
    const files = Array.from(e.target.files || []);
    const b64s = await Promise.all(files.map(fileToB64));
    onChange([...(values||[]), ...b64s]);
  };
  return (
    <div>
      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:bg-slate-50 hover:border-amber-400 transition">
        <Camera className="w-8 h-8 text-slate-400 mb-1"/>
        <span className="text-sm text-slate-600 font-medium">Tap to add photos</span>
        <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handle}/>
      </label>
      {values && values.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-4 gap-2 mt-3">
          {values.map((p, i) => (
            <div key={i} className="relative group">
              <img src={p} alt="" className="w-full h-24 object-cover rounded-lg border"/>
              <button type="button" onClick={()=>onChange(values.filter((_,j)=>j!==i))}
                className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                <X className="w-3 h-3"/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== DASHBOARD =====================
function Dashboard({ goTo }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/analytics/overview").then(r => setData(r.data)); }, []);
  if (!data) return <div className="p-8 text-slate-500 flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin"/>Loading analytics…</div>;
  const k = data.kpis;
  const pieData = [
    { name: "Incidents", value: k.incidents, color: "#EF4444" },
    { name: "Near Misses", value: k.near_misses, color: "#F59E0B" },
    { name: "Inspections", value: k.inspections, color: "#3B82F6" },
    { name: "Toolbox", value: k.toolbox_talks, color: "#10B981" },
  ];

  const kpiCards = [
    { label: "Total Submissions", value: k.total_submissions, icon: FileText, color: "from-slate-700 to-slate-900", text: "text-white" },
    { label: "Incidents", value: k.incidents, icon: AlertTriangle, color: "from-red-500 to-red-700", text: "text-white" },
    { label: "Near Misses", value: k.near_misses, icon: Zap, color: "from-orange-500 to-amber-600", text: "text-white" },
    { label: "Inspections", value: k.inspections, icon: ShieldCheck, color: "from-blue-500 to-blue-700", text: "text-white" },
    { label: "Toolbox Talks", value: k.toolbox_talks, icon: Users, color: "from-emerald-500 to-emerald-700", text: "text-white" },
    { label: "Active Workers", value: k.workers, icon: HardHat, color: "from-amber-400 to-amber-600", text: "text-black" },
    { label: "Job Sites", value: k.locations, icon: Building2, color: "from-purple-500 to-purple-700", text: "text-white" },
    { label: "Certs Expiring", value: k.expiring_certs, icon: Award, color: "from-rose-500 to-rose-700", text: "text-white" },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6 fadein">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Safety Dashboard</h1>
          <p className="text-slate-500 mt-1">Real-time overview of compliance across all job sites</p>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>goTo("submissions")} className="px-4 py-2 bg-white border rounded-lg text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"><Eye className="w-4 h-4"/>View Inbox</button>
          <button onClick={()=>goTo("templates")} className="px-4 py-2 brand-grad text-black rounded-lg text-sm font-bold flex items-center gap-2"><Plus className="w-4 h-4"/>Fill Form</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpiCards.map((c, i) => (
          <div key={i} className={`bg-gradient-to-br ${c.color} ${c.text} rounded-2xl p-5 card-hover shadow-sm`}>
            <div className="flex items-start justify-between">
              <c.icon className="w-7 h-7 opacity-80"/>
              <span className="text-xs opacity-75 font-semibold">{c.label}</span>
            </div>
            <div className="text-4xl font-black mt-3">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900">Monthly Trend</h3>
            <TrendingUp className="w-5 h-5 text-slate-400"/>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.monthly_trend}>
              <CartesianGrid stroke="#F1F5F9" strokeDasharray="3 3"/>
              <XAxis dataKey="month" stroke="#94A3B8" fontSize={12}/>
              <YAxis stroke="#94A3B8" fontSize={12}/>
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0" }}/>
              <Legend/>
              <Line type="monotone" dataKey="incidents" stroke="#EF4444" strokeWidth={2.5} dot={{ r: 3 }}/>
              <Line type="monotone" dataKey="near_misses" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 3 }}/>
              <Line type="monotone" dataKey="inspections" stroke="#3B82F6" strokeWidth={2.5} dot={{ r: 3 }}/>
              <Line type="monotone" dataKey="toolbox" stroke="#10B981" strokeWidth={2.5} dot={{ r: 3 }}/>
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border">
          <h3 className="font-bold text-slate-900 mb-4">Case Classification</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={95} paddingAngle={3}>
                {pieData.map((e, i) => <Cell key={i} fill={e.color}/>)}
              </Pie>
              <Tooltip/>
              <Legend/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border">
          <h3 className="font-bold text-slate-900 mb-4">Submissions by Job Site</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.by_location} layout="vertical">
              <CartesianGrid stroke="#F1F5F9" strokeDasharray="3 3"/>
              <XAxis type="number" stroke="#94A3B8" fontSize={12}/>
              <YAxis dataKey="location" type="category" stroke="#94A3B8" fontSize={11} width={140}/>
              <Tooltip/>
              <Bar dataKey="count" fill="#FBBF24" radius={[0,6,6,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border">
          <h3 className="font-bold text-slate-900 mb-4">Accident-Prone Workers <span className="text-xs font-normal text-slate-400">(incidents + near misses)</span></h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.accident_prone} layout="vertical">
              <CartesianGrid stroke="#F1F5F9" strokeDasharray="3 3"/>
              <XAxis type="number" stroke="#94A3B8" fontSize={12}/>
              <YAxis dataKey="worker" type="category" stroke="#94A3B8" fontSize={11} width={120}/>
              <Tooltip/>
              <Bar dataKey="count" fill="#EF4444" radius={[0,6,6,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-900 flex items-center gap-2"><Bell className="w-5 h-5 text-amber-500"/>Certification Expiry Alerts</h3>
          <span className="text-sm text-slate-500">{data.expiring_certifications.length} items need attention</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-2 px-3 font-semibold">Worker</th>
                <th className="py-2 px-3 font-semibold">Certification</th>
                <th className="py-2 px-3 font-semibold">Expiry Date</th>
                <th className="py-2 px-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.expiring_certifications.map((c) => {
                const badge = c.status === "expired" ? "bg-red-100 text-red-700"
                  : c.status === "critical" ? "bg-orange-100 text-orange-700"
                  : "bg-amber-100 text-amber-700";
                return (
                  <tr key={c.cert_id} className="border-b hover:bg-slate-50">
                    <td className="py-3 px-3 font-medium text-slate-900">{c.worker_name}</td>
                    <td className="py-3 px-3 text-slate-700">{c.name}</td>
                    <td className="py-3 px-3 text-slate-600">{c.expiry_date}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${badge}`}>
                        {c.status === "expired" ? `Expired ${-c.days_remaining}d ago` : `${c.days_remaining}d left`}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {data.expiring_certifications.length === 0 && (
                <tr><td colSpan="4" className="py-6 text-center text-slate-400">All certifications are up to date 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===================== TEMPLATES LIST + BUILDER =====================
function Templates({ user, onFill }) {
  const [tpls, setTpls] = useState([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/forms/templates").then(r => setTpls(r.data));
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 lg:p-8 fadein">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Form Templates</h1>
          <p className="text-slate-500 mt-1">Choose a form to fill, or build your own</p>
        </div>
        {user.role === "admin" && (
          <button onClick={()=>{setEditing(null); setShowBuilder(true);}}
            className="px-4 py-2.5 brand-grad text-black font-bold rounded-lg flex items-center gap-2"
            data-testid="new-template-btn">
            <Plus className="w-4 h-4"/>New Template
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tpls.map((t) => {
          const meta = CATEGORY_META[t.category] || CATEGORY_META.general;
          return (
            <div key={t.id} className="bg-white rounded-2xl p-5 border card-hover">
              <div className="flex items-start justify-between">
                <div className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.color}`}>{meta.label}</div>
                {user.role === "admin" && (
                  <div className="flex gap-1">
                    <button onClick={()=>{setEditing(t); setShowBuilder(true);}} className="p-1.5 hover:bg-slate-100 rounded"><Edit3 className="w-4 h-4 text-slate-500"/></button>
                    <button onClick={async()=>{ if (window.confirm("Delete template?")) { await api.delete(`/forms/templates/${t.id}`); load(); }}}
                      className="p-1.5 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4 text-red-500"/></button>
                  </div>
                )}
              </div>
              <h3 className="text-lg font-bold text-slate-900 mt-3">{t.name}</h3>
              <p className="text-sm text-slate-500 mt-1 line-clamp-2">{t.description}</p>
              <div className="text-xs text-slate-400 mt-3">{t.fields?.length || 0} fields</div>
              <button onClick={()=>onFill(t)} className="mt-4 w-full py-2.5 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 flex items-center justify-center gap-2" data-testid={`fill-${t.id}`}>
                <PenLine className="w-4 h-4"/>Fill This Form
              </button>
            </div>
          );
        })}
      </div>

      {showBuilder && <TemplateBuilder editing={editing} onClose={()=>{setShowBuilder(false); load();}}/>}
    </div>
  );
}

function TemplateBuilder({ editing, onClose }) {
  const [name, setName] = useState(editing?.name || "");
  const [description, setDescription] = useState(editing?.description || "");
  const [category, setCategory] = useState(editing?.category || "general");
  const [fields, setFields] = useState(editing?.fields || []);
  const [saving, setSaving] = useState(false);

  const fieldTypes = ["text", "textarea", "number", "date", "select", "radio", "checkbox", "signature", "photo", "gps"];

  const addField = () => {
    setFields([...fields, { id: `f${Date.now()}`, label: "New Field", type: "text", required: false, options: [] }]);
  };
  const updateField = (i, key, val) => {
    const copy = [...fields]; copy[i] = { ...copy[i], [key]: val }; setFields(copy);
  };
  const removeField = (i) => setFields(fields.filter((_,j)=>j!==i));

  const save = async () => {
    setSaving(true);
    const payload = { id: editing?.id || crypto.randomUUID(), name, description, category, fields, is_private: false, created_at: editing?.created_at || new Date().toISOString() };
    try {
      if (editing) await api.put(`/forms/templates/${editing.id}`, payload);
      else await api.post("/forms/templates", payload);
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 fadein">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b p-5 flex items-center justify-between">
          <h2 className="text-2xl font-bold">{editing ? "Edit" : "New"} Form Template</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Form Name</label>
              <input value={name} onChange={e=>setName(e.target.value)} className="w-full px-4 py-2.5 border rounded-lg" placeholder="e.g. Hot Work Permit" data-testid="tpl-name"/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Category</label>
              <select value={category} onChange={e=>setCategory(e.target.value)} className="w-full px-4 py-2.5 border rounded-lg">
                <option value="general">General</option>
                <option value="incident">Incident</option>
                <option value="near_miss">Near Miss</option>
                <option value="inspection">Inspection</option>
                <option value="toolbox">Toolbox Talk</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">Description</label>
            <textarea value={description} onChange={e=>setDescription(e.target.value)} className="w-full px-4 py-2.5 border rounded-lg" rows="2"/>
          </div>

          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold">Fields ({fields.length})</h3>
              <button onClick={addField} className="px-3 py-1.5 bg-slate-900 text-white text-sm rounded-lg flex items-center gap-1.5" data-testid="add-field-btn"><Plus className="w-4 h-4"/>Add Field</button>
            </div>
            <div className="space-y-3">
              {fields.map((f, i) => (
                <div key={f.id} className="bg-slate-50 rounded-lg p-4 border">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <input value={f.label} onChange={e=>updateField(i,"label",e.target.value)} placeholder="Field label" className="col-span-5 px-3 py-2 border rounded bg-white"/>
                    <select value={f.type} onChange={e=>updateField(i,"type",e.target.value)} className="col-span-3 px-3 py-2 border rounded bg-white">
                      {fieldTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <label className="col-span-3 text-sm flex items-center gap-2">
                      <input type="checkbox" checked={!!f.required} onChange={e=>updateField(i,"required",e.target.checked)}/>Required
                    </label>
                    <button onClick={()=>removeField(i)} className="col-span-1 p-1.5 text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4"/></button>
                  </div>
                  {(f.type === "select" || f.type === "radio") && (
                    <input value={(f.options || []).join(", ")} onChange={e=>updateField(i,"options",e.target.value.split(",").map(s=>s.trim()).filter(Boolean))}
                      placeholder="Comma separated options" className="w-full mt-2 px-3 py-2 border rounded text-sm bg-white"/>
                  )}
                </div>
              ))}
              {fields.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">No fields yet. Add some.</div>}
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-white border-t p-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
          <button onClick={save} disabled={!name || saving} className="px-5 py-2 brand-grad text-black font-bold rounded-lg flex items-center gap-2 disabled:opacity-50" data-testid="save-template-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}Save Template
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== FILL FORM =====================
function FillForm({ template, user, onClose }) {
  const [answers, setAnswers] = useState({});
  const [signature, setSignature] = useState("");
  const [photos, setPhotos] = useState([]);
  const [locations, setLocations] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [locationId, setLocationId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [gps, setGps] = useState({ lat: null, lng: null });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/locations").then(r => setLocations(r.data));
    api.get("/workers").then(r => setWorkers(r.data));
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => setGps({ lat: 43.6532, lng: -79.3832 })
      );
    }
  }, []);

  const setAns = (label, val) => setAnswers({ ...answers, [label]: val });

  const submit = async () => {
    setSaving(true);
    const loc = locations.find(l => l.id === locationId);
    const w = workers.find(x => x.id === workerId);
    try {
      await api.post("/submissions", {
        id: crypto.randomUUID(),
        template_id: template.id,
        template_name: template.name,
        category: template.category || "general",
        location_id: locationId || null,
        location_name: loc?.name || null,
        worker_id: workerId || null,
        worker_name: w?.name || user.name,
        answers,
        signature_b64: signature || null,
        photos_b64: photos,
        gps_lat: gps.lat,
        gps_lng: gps.lng,
        flagged: ["incident", "near_miss"].includes(template.category),
        submitted_at: new Date().toISOString(),
      });
      onClose();
    } catch (e) { alert("Submit failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  const meta = CATEGORY_META[template.category] || CATEGORY_META.general;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 fadein">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b p-5 flex items-center justify-between z-10">
          <div>
            <div className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${meta.color}`}>{meta.label}</div>
            <h2 className="text-2xl font-bold mt-1">{template.name}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Job Site / Location</label>
              <select value={locationId} onChange={e=>setLocationId(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white" data-testid="fill-location">
                <option value="">— Select location —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Worker</label>
              <select value={workerId} onChange={e=>setWorkerId(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white" data-testid="fill-worker">
                <option value="">— Select worker —</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.name} {w.trade ? `(${w.trade})` : ""}</option>)}
              </select>
            </div>
            {gps.lat && (
              <div className="md:col-span-2 text-xs text-emerald-600 flex items-center gap-1.5">
                <MapPinned className="w-3.5 h-3.5"/>GPS captured: {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}
              </div>
            )}
          </div>

          {template.fields.map((f) => (
            <div key={f.id}>
              <label className="block text-sm font-semibold mb-1.5">
                {f.label} {f.required && <span className="text-red-500">*</span>}
              </label>
              {f.type === "text" && <input className="w-full px-3 py-2.5 border rounded-lg" value={answers[f.label]||""} onChange={e=>setAns(f.label, e.target.value)} placeholder={f.placeholder}/>}
              {f.type === "textarea" && <textarea className="w-full px-3 py-2.5 border rounded-lg" rows="3" value={answers[f.label]||""} onChange={e=>setAns(f.label, e.target.value)} placeholder={f.placeholder}/>}
              {f.type === "number" && <input type="number" className="w-full px-3 py-2.5 border rounded-lg" value={answers[f.label]||""} onChange={e=>setAns(f.label, e.target.value)}/>}
              {f.type === "date" && <input type="date" className="w-full px-3 py-2.5 border rounded-lg" value={answers[f.label]||""} onChange={e=>setAns(f.label, e.target.value)}/>}
              {f.type === "select" && (
                <select className="w-full px-3 py-2.5 border rounded-lg bg-white" value={answers[f.label]||""} onChange={e=>setAns(f.label, e.target.value)}>
                  <option value="">— Select —</option>
                  {(f.options||[]).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {f.type === "radio" && (
                <div className="flex flex-wrap gap-2">
                  {(f.options||[]).map(o => (
                    <button key={o} type="button" onClick={()=>setAns(f.label, o)}
                      className={`px-4 py-2 rounded-lg border font-medium text-sm transition ${answers[f.label]===o ? "brand-grad text-black border-amber-400" : "bg-white text-slate-700 hover:border-amber-300"}`}>
                      {o}
                    </button>
                  ))}
                </div>
              )}
              {f.type === "checkbox" && (
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!answers[f.label]} onChange={e=>setAns(f.label, e.target.checked)}/>{f.placeholder || "Confirm"}</label>
              )}
              {f.type === "photo" && <PhotoUploader values={photos} onChange={setPhotos}/>}
              {f.type === "signature" && <SignaturePad value={signature} onChange={setSignature}/>}
              {f.type === "gps" && <div className="text-sm text-slate-500">GPS auto-captured above</div>}
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 bg-white border-t p-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2.5 brand-grad text-black font-bold rounded-lg flex items-center gap-2 disabled:opacity-50" data-testid="submit-form-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4"/>}Submit Form
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== SUBMISSIONS =====================
function Submissions() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const load = () => api.get("/submissions").then(r => setItems(r.data));
  useEffect(() => { load(); }, []);

  const filtered = items.filter(s => {
    if (filter !== "all" && s.category !== filter) return false;
    if (search && !(`${s.template_name} ${s.location_name} ${s.worker_name}`.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  return (
    <div className="p-6 lg:p-8 fadein">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Safety Inbox</h1>
          <p className="text-slate-500 mt-1">{items.length} submissions · {items.filter(i=>i.flagged).length} flagged for review</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5"/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" className="pl-9 pr-3 py-2 border rounded-lg bg-white text-sm w-56"/>
          </div>
          <select value={filter} onChange={e=>setFilter(e.target.value)} className="px-3 py-2 border rounded-lg bg-white text-sm">
            <option value="all">All Categories</option>
            <option value="incident">Incidents</option>
            <option value="near_miss">Near Misses</option>
            <option value="inspection">Inspections</option>
            <option value="toolbox">Toolbox Talks</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr className="text-left text-slate-600">
                <th className="py-3 px-4 font-semibold">Form</th>
                <th className="py-3 px-4 font-semibold">Category</th>
                <th className="py-3 px-4 font-semibold">Worker</th>
                <th className="py-3 px-4 font-semibold">Job Site</th>
                <th className="py-3 px-4 font-semibold">Submitted</th>
                <th className="py-3 px-4 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const meta = CATEGORY_META[s.category] || CATEGORY_META.general;
                return (
                  <tr key={s.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={()=>setSelected(s)} data-testid={`sub-${s.id}`}>
                    <td className="py-3 px-4 font-medium text-slate-900 flex items-center gap-2">
                      {s.flagged && <span className="w-2 h-2 rounded-full bg-red-500"/>}
                      {s.template_name}
                    </td>
                    <td className="py-3 px-4"><span className={`px-2 py-0.5 rounded text-xs font-semibold border ${meta.color}`}>{meta.label}</span></td>
                    <td className="py-3 px-4 text-slate-700">{s.worker_name || "—"}</td>
                    <td className="py-3 px-4 text-slate-700">{s.location_name || "—"}</td>
                    <td className="py-3 px-4 text-slate-500">{new Date(s.submitted_at).toLocaleString()}</td>
                    <td className="py-3 px-4"><ChevronRight className="w-4 h-4 text-slate-400"/></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan="6" className="py-10 text-center text-slate-400">No submissions match your filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <SubmissionDetail submission={selected} onClose={()=>{setSelected(null); load();}}/>}
    </div>
  );
}

function SubmissionDetail({ submission, onClose }) {
  const [s, setS] = useState(submission);
  const [aiLoading, setAiLoading] = useState(false);
  const meta = CATEGORY_META[s.category] || CATEGORY_META.general;

  const summarize = async () => {
    setAiLoading(true);
    try {
      const { data } = await api.post("/ai/summarize", { submission_id: s.id });
      setS({ ...s, ai_summary: data.summary });
    } catch (e) { alert("AI error: " + (e?.response?.data?.detail || e.message)); }
    setAiLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 fadein">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b p-5 flex items-center justify-between z-10">
          <div>
            <div className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${meta.color}`}>{meta.label}</div>
            <h2 className="text-2xl font-bold mt-1">{s.template_name}</h2>
            <div className="text-sm text-slate-500 mt-0.5">
              {s.worker_name} · {s.location_name} · {new Date(s.submitted_at).toLocaleString()}
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
        </div>

        <div className="p-6 space-y-5">
          {/* AI Summary */}
          <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-amber-900 flex items-center gap-2"><Sparkles className="w-5 h-5"/>AI Safety Insights</h3>
              {!s.ai_summary && (
                <button onClick={summarize} disabled={aiLoading} className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg font-semibold flex items-center gap-2 disabled:opacity-50" data-testid="ai-summarize-btn">
                  {aiLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>}
                  Generate Summary
                </button>
              )}
            </div>
            {s.ai_summary ? (
              <div className="prose prose-sm max-w-none text-slate-800 whitespace-pre-wrap">{s.ai_summary}</div>
            ) : (
              <div className="text-sm text-amber-800">Click "Generate Summary" to have AI analyze key risks, root causes and corrective actions for this submission.</div>
            )}
          </div>

          {/* Answers */}
          <div>
            <h3 className="font-bold text-slate-900 mb-3">Form Responses</h3>
            <div className="space-y-3">
              {Object.entries(s.answers || {}).map(([k, v]) => (
                <div key={k} className="border-l-4 border-amber-400 bg-slate-50 p-3 rounded-r-lg">
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{k}</div>
                  <div className="text-sm text-slate-900 mt-0.5">{String(v)}</div>
                </div>
              ))}
            </div>
          </div>

          {s.photos_b64 && s.photos_b64.length > 0 && (
            <div>
              <h3 className="font-bold text-slate-900 mb-3">Photos</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {s.photos_b64.map((p,i)=>(<img key={i} src={p} alt="" className="rounded-lg border w-full h-32 object-cover"/>))}
              </div>
            </div>
          )}

          {s.signature_b64 && (
            <div>
              <h3 className="font-bold text-slate-900 mb-3">Worker Signature</h3>
              <img src={s.signature_b64} alt="signature" className="border rounded-lg bg-white p-2 max-w-xs"/>
            </div>
          )}

          {s.gps_lat && (
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <MapPinned className="w-4 h-4"/>GPS: {s.gps_lat?.toFixed(4)}, {s.gps_lng?.toFixed(4)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== WORKERS =====================
function Workers() {
  const [items, setItems] = useState([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/workers").then(r => setItems(r.data));
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 lg:p-8 fadein">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Workers</h1>
          <p className="text-slate-500 mt-1">{items.length} workers on the team</p>
        </div>
        <button onClick={()=>{setEditing(null); setShow(true);}} className="px-4 py-2.5 brand-grad text-black font-bold rounded-lg flex items-center gap-2" data-testid="new-worker-btn"><Plus className="w-4 h-4"/>Add Worker</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((w) => (
          <div key={w.id} className="bg-white rounded-2xl p-5 border card-hover">
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 brand-grad rounded-xl flex items-center justify-center text-black font-black text-xl">
                {w.name?.split(" ").map(n=>n[0]).slice(0,2).join("")}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-900 truncate">{w.name}</div>
                <div className="text-sm text-slate-500 truncate">{w.trade || "—"}</div>
                <span className={`mt-1 inline-block px-2 py-0.5 rounded text-xs font-semibold ${w.role === "supervisor" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-700"}`}>{w.role}</span>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">{w.email}</div>
            <div className="flex gap-2 mt-3">
              <button onClick={()=>{setEditing(w); setShow(true);}} className="text-sm text-slate-600 hover:text-amber-600 flex items-center gap-1"><Edit3 className="w-3.5 h-3.5"/>Edit</button>
              <button onClick={async()=>{ if (window.confirm("Delete?")) { await api.delete(`/workers/${w.id}`); load();}}} className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5"/>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {show && <WorkerModal editing={editing} onClose={()=>{setShow(false); load();}}/>}
    </div>
  );
}

function WorkerModal({ editing, onClose }) {
  const [w, setW] = useState(editing || { name: "", email: "", phone: "", role: "worker", trade: "" });
  const save = async () => {
    const payload = { ...w, id: editing?.id || crypto.randomUUID(), location_ids: w.location_ids || [], created_at: editing?.created_at || new Date().toISOString() };
    if (editing) await api.put(`/workers/${editing.id}`, payload);
    else await api.post("/workers", payload);
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <h2 className="text-2xl font-bold mb-4">{editing ? "Edit" : "New"} Worker</h2>
        <div className="space-y-3">
          <input value={w.name} onChange={e=>setW({...w, name: e.target.value})} placeholder="Full Name" className="w-full px-3 py-2.5 border rounded-lg" data-testid="worker-name"/>
          <input value={w.email||""} onChange={e=>setW({...w, email: e.target.value})} placeholder="Email" className="w-full px-3 py-2.5 border rounded-lg"/>
          <input value={w.phone||""} onChange={e=>setW({...w, phone: e.target.value})} placeholder="Phone" className="w-full px-3 py-2.5 border rounded-lg"/>
          <input value={w.trade||""} onChange={e=>setW({...w, trade: e.target.value})} placeholder="Trade (e.g. Heavy Equipment Operator)" className="w-full px-3 py-2.5 border rounded-lg"/>
          <select value={w.role} onChange={e=>setW({...w, role: e.target.value})} className="w-full px-3 py-2.5 border rounded-lg">
            <option value="worker">Worker</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
          <button onClick={save} className="px-5 py-2 brand-grad text-black font-bold rounded-lg" data-testid="save-worker-btn">Save</button>
        </div>
      </div>
    </div>
  );
}

// ===================== LOCATIONS =====================
function Locations() {
  const [items, setItems] = useState([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/locations").then(r => setItems(r.data));
  useEffect(() => { load(); }, []);
  return (
    <div className="p-6 lg:p-8 fadein">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div><h1 className="text-3xl font-black text-slate-900">Job Sites</h1><p className="text-slate-500 mt-1">{items.length} active locations</p></div>
        <button onClick={()=>{setEditing(null); setShow(true);}} className="px-4 py-2.5 brand-grad text-black font-bold rounded-lg flex items-center gap-2"><Plus className="w-4 h-4"/>Add Location</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((l) => (
          <div key={l.id} className="bg-white rounded-2xl p-5 border card-hover">
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center"><Building2 className="w-6 h-6 text-amber-400"/></div>
              <span className="text-xs font-mono px-2 py-1 bg-slate-100 rounded">{l.project_code}</span>
            </div>
            <h3 className="font-bold text-slate-900 mt-3">{l.name}</h3>
            <div className="text-sm text-slate-500 flex items-center gap-1 mt-1"><MapPin className="w-3.5 h-3.5"/>{l.address}</div>
            <div className="flex gap-2 mt-3">
              <button onClick={()=>{setEditing(l); setShow(true);}} className="text-sm text-slate-600 hover:text-amber-600 flex items-center gap-1"><Edit3 className="w-3.5 h-3.5"/>Edit</button>
              <button onClick={async()=>{ if (window.confirm("Delete?")) { await api.delete(`/locations/${l.id}`); load();}}} className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5"/>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {show && <LocationModal editing={editing} onClose={()=>{setShow(false); load();}}/>}
    </div>
  );
}

function LocationModal({ editing, onClose }) {
  const [l, setL] = useState(editing || { name: "", address: "", project_code: "" });
  const save = async () => {
    const payload = { ...l, id: editing?.id || crypto.randomUUID(), worker_ids: l.worker_ids || [], created_at: editing?.created_at || new Date().toISOString() };
    if (editing) await api.put(`/locations/${editing.id}`, payload);
    else await api.post("/locations", payload);
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <h2 className="text-2xl font-bold mb-4">{editing ? "Edit" : "New"} Job Site</h2>
        <div className="space-y-3">
          <input value={l.name} onChange={e=>setL({...l, name: e.target.value})} placeholder="Site Name" className="w-full px-3 py-2.5 border rounded-lg"/>
          <input value={l.address||""} onChange={e=>setL({...l, address: e.target.value})} placeholder="Address" className="w-full px-3 py-2.5 border rounded-lg"/>
          <input value={l.project_code||""} onChange={e=>setL({...l, project_code: e.target.value})} placeholder="Project Code (e.g. PT-HW-001)" className="w-full px-3 py-2.5 border rounded-lg"/>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
          <button onClick={save} className="px-5 py-2 brand-grad text-black font-bold rounded-lg">Save</button>
        </div>
      </div>
    </div>
  );
}

// ===================== CERTIFICATIONS =====================
function Certifications() {
  const [certs, setCerts] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [show, setShow] = useState(false);
  const load = () => {
    api.get("/certifications").then(r => setCerts(r.data));
    api.get("/workers").then(r => setWorkers(r.data));
  };
  useEffect(() => { load(); }, []);

  const today = new Date();
  const enriched = certs.map(c => {
    const w = workers.find(x => x.id === c.worker_id);
    let days = null, status = "ok";
    if (c.expiry_date) {
      const exp = new Date(c.expiry_date);
      days = Math.floor((exp - today) / (1000*60*60*24));
      if (days < 0) status = "expired";
      else if (days <= 14) status = "critical";
      else if (days <= 60) status = "warning";
    }
    return { ...c, worker_name: w?.name || "—", days, status };
  }).sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

  const badge = (st) => ({
    expired: "bg-red-100 text-red-700",
    critical: "bg-orange-100 text-orange-700",
    warning: "bg-amber-100 text-amber-700",
    ok: "bg-emerald-100 text-emerald-700",
  }[st]);

  return (
    <div className="p-6 lg:p-8 fadein">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div><h1 className="text-3xl font-black text-slate-900">Certifications</h1><p className="text-slate-500 mt-1">Track training & expiry dates across the crew</p></div>
        <button onClick={()=>setShow(true)} className="px-4 py-2.5 brand-grad text-black font-bold rounded-lg flex items-center gap-2"><Plus className="w-4 h-4"/>Add Certification</button>
      </div>
      <div className="bg-white rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr className="text-left text-slate-600">
              <th className="py-3 px-4 font-semibold">Worker</th>
              <th className="py-3 px-4 font-semibold">Certification</th>
              <th className="py-3 px-4 font-semibold">Issuer</th>
              <th className="py-3 px-4 font-semibold">Expiry</th>
              <th className="py-3 px-4 font-semibold">Status</th>
              <th className="py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            {enriched.map(c => (
              <tr key={c.id} className="border-b hover:bg-slate-50">
                <td className="py-3 px-4 font-medium">{c.worker_name}</td>
                <td className="py-3 px-4">{c.name}</td>
                <td className="py-3 px-4 text-slate-500">{c.issuer}</td>
                <td className="py-3 px-4 text-slate-500">{c.expiry_date}</td>
                <td className="py-3 px-4">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${badge(c.status)}`}>
                    {c.status === "expired" ? `Expired ${-c.days}d ago` : c.days != null ? `${c.days}d left` : "OK"}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <button onClick={async()=>{ if (window.confirm("Delete?")) { await api.delete(`/certifications/${c.id}`); load();}}} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4"/></button>
                </td>
              </tr>
            ))}
            {enriched.length === 0 && <tr><td colSpan="6" className="py-10 text-center text-slate-400">No certifications yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {show && <CertModal workers={workers} onClose={()=>{setShow(false); load();}}/>}
    </div>
  );
}

function CertModal({ workers, onClose }) {
  const [c, setC] = useState({ worker_id: "", name: "", issuer: "", expiry_date: "", issued_date: "" });
  const save = async () => {
    await api.post("/certifications", { ...c, id: crypto.randomUUID(), created_at: new Date().toISOString() });
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <h2 className="text-2xl font-bold mb-4">New Certification</h2>
        <div className="space-y-3">
          <select value={c.worker_id} onChange={e=>setC({...c, worker_id: e.target.value})} className="w-full px-3 py-2.5 border rounded-lg">
            <option value="">— Select worker —</option>
            {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input value={c.name} onChange={e=>setC({...c, name: e.target.value})} placeholder="Certification Name" className="w-full px-3 py-2.5 border rounded-lg"/>
          <input value={c.issuer} onChange={e=>setC({...c, issuer: e.target.value})} placeholder="Issuer" className="w-full px-3 py-2.5 border rounded-lg"/>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500">Issued</label>
              <input type="date" value={c.issued_date} onChange={e=>setC({...c, issued_date: e.target.value})} className="w-full px-3 py-2 border rounded-lg"/>
            </div>
            <div>
              <label className="text-xs text-slate-500">Expires</label>
              <input type="date" value={c.expiry_date} onChange={e=>setC({...c, expiry_date: e.target.value})} className="w-full px-3 py-2 border rounded-lg"/>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
          <button onClick={save} className="px-5 py-2 brand-grad text-black font-bold rounded-lg">Save</button>
        </div>
      </div>
    </div>
  );
}

// ===================== MAIN APP =====================
function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pt_user")); } catch { return null; }
  });
  const [view, setView] = useState("dashboard");
  const [fillTemplate, setFillTemplate] = useState(null);

  const logout = () => {
    localStorage.removeItem("pt_token");
    localStorage.removeItem("pt_user");
    setUser(null);
  };

  if (!user) return <Login onLogin={setUser}/>;

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "templates", label: "Forms", icon: FileText },
    { id: "submissions", label: "Inbox", icon: ClipboardList },
    { id: "workers", label: "Workers", icon: Users },
    { id: "locations", label: "Job Sites", icon: MapPin },
    { id: "certifications", label: "Certifications", icon: Award },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col">
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 brand-grad rounded-lg flex items-center justify-center">
              <HardHat className="w-6 h-6 text-black"/>
            </div>
            <div>
              <div className="font-black tracking-tight">PANELTEC</div>
              <div className="text-[10px] text-amber-400 tracking-widest font-semibold">SAFETY PORTAL</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(n => {
            const active = view === n.id;
            return (
              <button key={n.id} onClick={()=>setView(n.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${active ? "brand-grad text-black" : "text-slate-300 hover:bg-slate-800"}`}
                data-testid={`nav-${n.id}`}>
                <n.icon className="w-5 h-5"/>{n.label}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-slate-800">
          <div className="flex items-center gap-3 p-2">
            <div className="w-9 h-9 rounded-full brand-grad flex items-center justify-center text-black font-bold text-sm">
              {user.name?.split(" ").map(n=>n[0]).slice(0,2).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{user.name}</div>
              <div className="text-xs text-slate-400 capitalize">{user.role}</div>
            </div>
            <button onClick={logout} className="p-2 hover:bg-slate-800 rounded-lg" data-testid="logout-btn"><LogOut className="w-4 h-4"/></button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {view === "dashboard" && <Dashboard goTo={setView}/>}
        {view === "templates" && <Templates user={user} onFill={setFillTemplate}/>}
        {view === "submissions" && <Submissions/>}
        {view === "workers" && <Workers/>}
        {view === "locations" && <Locations/>}
        {view === "certifications" && <Certifications/>}
      </main>

      {fillTemplate && <FillForm template={fillTemplate} user={user} onClose={()=>setFillTemplate(null)}/>}
    </div>
  );
}

export default App;
