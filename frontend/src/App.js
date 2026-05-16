import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./App.css";
import {
  LayoutDashboard, FileText, ClipboardList, Users, MapPin, Award,
  Sparkles, LogOut, Plus, Trash2, Edit3, Save, X, AlertTriangle,
  CheckCircle2, Camera, MapPinned, PenLine, Eye, ShieldCheck, HardHat,
  TrendingUp, Bell, Search, Filter, ChevronRight, Building2, Wrench,
  Calendar, FileSearch, Loader2, Zap, BarChart3,
  MessageSquare, Settings, Send, Download, Share2, Key, Copy, WifiOff,
  Smartphone, Mail, Pencil, Circle as CircleIcon, ArrowUpRight, Home, User,
  AlertOctagon, FlaskConical, Truck, Briefcase, ListChecks, ChevronLeft,
  Menu, ArrowRight, Clock, Flame, Droplets
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
function PhotoUploader({ values=[], onChange, onAnnotate }) {
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
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition rounded-lg flex items-center justify-center gap-1">
                {onAnnotate && (
                  <button type="button" onClick={()=>onAnnotate(i, p)} className="bg-amber-400 text-black rounded-full w-8 h-8 flex items-center justify-center hover:bg-amber-300" title="Annotate" data-testid={`annotate-${i}`}>
                    <Pencil className="w-4 h-4"/>
                  </button>
                )}
                <button type="button" onClick={()=>onChange(values.filter((_,j)=>j!==i))}
                  className="bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-red-700" title="Remove">
                  <X className="w-4 h-4"/>
                </button>
              </div>
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
    { label: "Total Submissions", value: k.total_submissions, icon: FileText, color: "from-slate-700 to-slate-900", text: "text-white", target: "submissions", filter: "all" },
    { label: "Incidents", value: k.incidents, icon: AlertTriangle, color: "from-red-500 to-red-700", text: "text-white", target: "submissions", filter: "incident" },
    { label: "Near Misses", value: k.near_misses, icon: Zap, color: "from-orange-500 to-amber-600", text: "text-white", target: "submissions", filter: "near_miss" },
    { label: "Inspections", value: k.inspections, icon: ShieldCheck, color: "from-blue-500 to-blue-700", text: "text-white", target: "submissions", filter: "inspection" },
    { label: "Toolbox Talks", value: k.toolbox_talks, icon: Users, color: "from-emerald-500 to-emerald-700", text: "text-white", target: "submissions", filter: "toolbox" },
    { label: "Active Workers", value: k.workers, icon: HardHat, color: "from-amber-400 to-amber-600", text: "text-black", target: "workers" },
    { label: "Job Sites", value: k.locations, icon: Building2, color: "from-purple-500 to-purple-700", text: "text-white", target: "locations" },
    { label: "Certs Expiring", value: k.expiring_certs, icon: Award, color: "from-rose-500 to-rose-700", text: "text-white", target: "certifications" },
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
          <button key={i} onClick={()=>goTo(c.target, c.filter)} type="button"
            className={`bg-gradient-to-br ${c.color} ${c.text} rounded-2xl p-5 card-hover shadow-sm text-left active:scale-95 transition`}
            data-testid={`kpi-${c.label.toLowerCase().replace(/\s+/g,'-')}`}>
            <div className="flex items-start justify-between">
              <c.icon className="w-7 h-7 opacity-80"/>
              <span className="text-xs opacity-75 font-semibold">{c.label}</span>
            </div>
            <div className="text-4xl font-black mt-3">{c.value}</div>
            <div className="text-[10px] opacity-60 mt-1 font-semibold tracking-wider">VIEW →</div>
          </button>
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
  const draftKey = `pt_draft_${template.id}`;
  const [answers, setAnswers] = useState(() => {
    try { return JSON.parse(localStorage.getItem(draftKey))?.answers || {}; } catch { return {}; }
  });
  const [signature, setSignature] = useState("");
  const [photos, setPhotos] = useState(() => {
    try { return JSON.parse(localStorage.getItem(draftKey))?.photos || []; } catch { return []; }
  });
  const [locations, setLocations] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [locationId, setLocationId] = useState(() => {
    try { return JSON.parse(localStorage.getItem(draftKey))?.locationId || ""; } catch { return ""; }
  });
  const [workerId, setWorkerId] = useState("");
  const [gps, setGps] = useState({ lat: null, lng: null });
  const [saving, setSaving] = useState(false);
  const [annotating, setAnnotating] = useState(null); // {index, src}
  const [draftSaved, setDraftSaved] = useState(false);

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

  // Auto-save draft to localStorage every change
  useEffect(() => {
    const has = Object.keys(answers).length > 0 || photos.length > 0 || locationId;
    if (has) {
      localStorage.setItem(draftKey, JSON.stringify({ answers, photos, locationId, savedAt: Date.now() }));
      setDraftSaved(true);
      const t = setTimeout(() => setDraftSaved(false), 1200);
      return () => clearTimeout(t);
    }
  }, [answers, photos, locationId]);

  const setAns = (label, val) => setAnswers({ ...answers, [label]: val });

  const submit = async () => {
    setSaving(true);
    const loc = locations.find(l => l.id === locationId);
    const w = workers.find(x => x.id === workerId);
    const payload = {
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
    };
    try {
      await api.post("/submissions", payload);
      localStorage.removeItem(draftKey);
      onClose();
    } catch (e) {
      // If offline, queue it
      if (!navigator.onLine) {
        const queue = JSON.parse(localStorage.getItem("pt_queue") || "[]");
        queue.push(payload);
        localStorage.setItem("pt_queue", JSON.stringify(queue));
        alert("You're offline. Form queued — will sync when reconnected.");
        localStorage.removeItem(draftKey);
        onClose();
      } else {
        alert("Submit failed: " + (e?.response?.data?.detail || e.message));
      }
    }
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
              {f.type === "photo" && (
                <PhotoUploader values={photos} onChange={setPhotos} onAnnotate={(idx, src) => setAnnotating({ index: idx, src })}/>
              )}
              {f.type === "signature" && <SignaturePad value={signature} onChange={setSignature}/>}
              {f.type === "gps" && <div className="text-sm text-slate-500">GPS auto-captured above</div>}
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 bg-white border-t p-4 flex justify-end gap-2 items-center">
          {draftSaved && <span className="text-xs text-emerald-600 flex items-center gap-1 mr-auto"><CheckCircle2 className="w-3.5 h-3.5"/>Draft auto-saved</span>}
          <button onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2.5 brand-grad text-black font-bold rounded-lg flex items-center gap-2 disabled:opacity-50" data-testid="submit-form-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4"/>}Submit Form
          </button>
        </div>
      </div>
      {annotating && (
        <PhotoAnnotator src={annotating.src}
          onSave={(b64) => { const copy = [...photos]; copy[annotating.index] = b64; setPhotos(copy); setAnnotating(null); }}
          onCancel={() => setAnnotating(null)}/>
      )}
    </div>
  );
}

// ===================== SUBMISSIONS =====================
function Submissions({ initialFilter = "all" }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState(initialFilter);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const load = () => api.get("/submissions").then(r => setItems(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => { setFilter(initialFilter); }, [initialFilter]);

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
          <div className="flex items-center gap-2">
            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/submissions/${s.id}/pdf?token=${localStorage.getItem("pt_token")}`}
              target="_blank" rel="noopener noreferrer"
              className="px-3 py-2 bg-slate-900 text-white text-sm rounded-lg font-semibold flex items-center gap-2 hover:bg-slate-800"
              data-testid="pdf-download-btn">
              <Download className="w-4 h-4"/>PDF
            </a>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
          </div>
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
// ===================== PHOTO ANNOTATOR =====================
function PhotoAnnotator({ src, onSave, onCancel }) {
  const canvasRef = useRef(null);
  const [tool, setTool] = useState("arrow");
  const [color, setColor] = useState("#EF4444");
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState(null);
  const [baseImage, setBaseImage] = useState(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = canvasRef.current;
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      setBaseImage(c.toDataURL("image/png"));
    };
    img.src = src;
  }, [src]);

  const getPos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) * (c.width / r.width);
    const y = ((e.touches ? e.touches[0].clientY : e.clientY) - r.top) * (c.height / r.height);
    return { x, y };
  };

  const drawArrow = (ctx, x1, y1, x2, y2) => {
    const headLen = 20;
    const ang = Math.atan2(y2-y1, x2-x1);
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2,y2);
    ctx.lineTo(x2 - headLen * Math.cos(ang - Math.PI/6), y2 - headLen * Math.sin(ang - Math.PI/6));
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2 - headLen * Math.cos(ang + Math.PI/6), y2 - headLen * Math.sin(ang + Math.PI/6));
    ctx.stroke();
  };

  const onDown = (e) => {
    e.preventDefault();
    const p = getPos(e);
    setStart(p);
    setDrawing(true);
    if (tool === "pen") {
      const ctx = canvasRef.current.getContext("2d");
      ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
    }
  };
  const onMove = (e) => {
    if (!drawing) return; e.preventDefault();
    const p = getPos(e);
    const ctx = canvasRef.current.getContext("2d");
    if (tool === "pen") {
      ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.lineTo(p.x, p.y); ctx.stroke();
    } else {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0,0,canvasRef.current.width,canvasRef.current.height);
        ctx.drawImage(img, 0, 0);
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = "round";
        if (tool === "arrow") drawArrow(ctx, start.x, start.y, p.x, p.y);
        else if (tool === "circle") {
          const r = Math.hypot(p.x - start.x, p.y - start.y);
          ctx.beginPath(); ctx.arc(start.x, start.y, r, 0, Math.PI*2); ctx.stroke();
        }
      };
      img.src = baseImage;
    }
  };
  const onUp = () => {
    if (!drawing) return;
    setDrawing(false);
    setBaseImage(canvasRef.current.toDataURL("image/png"));
  };

  const reset = () => {
    const img = new Image();
    img.onload = () => {
      const c = canvasRef.current;
      const ctx = c.getContext("2d");
      ctx.clearRect(0,0,c.width,c.height);
      ctx.drawImage(img, 0, 0);
      setBaseImage(c.toDataURL("image/png"));
    };
    img.src = src;
  };

  const save = () => onSave(canvasRef.current.toDataURL("image/png"));

  const tools = [
    { id: "arrow", icon: ArrowUpRight, label: "Arrow" },
    { id: "circle", icon: CircleIcon, label: "Circle" },
    { id: "pen", icon: Pencil, label: "Draw" },
  ];
  const palette = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#0B0B0F"];

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 fadein">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">Annotate Photo</h3>
          <button onClick={onCancel} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-3 border-b bg-slate-50 flex items-center gap-2 flex-wrap">
          {tools.map(t => (
            <button key={t.id} onClick={()=>setTool(t.id)}
              className={`px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-semibold ${tool===t.id ? "brand-grad text-black" : "bg-white border"}`}
              data-testid={`annot-tool-${t.id}`}>
              <t.icon className="w-4 h-4"/>{t.label}
            </button>
          ))}
          <div className="w-px h-6 bg-slate-300 mx-1"/>
          {palette.map(c => (
            <button key={c} onClick={()=>setColor(c)}
              className={`w-7 h-7 rounded-full border-2 ${color===c ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
              style={{ background: c, borderColor: "white" }}/>
          ))}
          <button onClick={reset} className="ml-auto text-sm text-slate-600 hover:text-red-600 font-semibold">Reset</button>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-slate-100 flex items-center justify-center">
          <canvas ref={canvasRef}
            className="max-w-full max-h-full border shadow-lg bg-white"
            style={{ touchAction: "none", cursor: "crosshair" }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}/>
        </div>
        <div className="p-3 border-t flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 border rounded-lg">Cancel</button>
          <button onClick={save} className="px-5 py-2 brand-grad text-black font-bold rounded-lg flex items-center gap-2" data-testid="save-annotation-btn">
            <CheckCircle2 className="w-4 h-4"/>Save Annotation
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== CHAT =====================
function Chat({ user }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState("general");
  const bottomRef = useRef(null);

  const load = async () => {
    try {
      const { data } = await api.get(`/chat/messages?channel=${channel}`);
      setMessages(data);
    } catch (e) {}
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 3500);
    return () => clearInterval(t);
  }, [channel]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    await api.post("/chat/messages", { channel, body: text });
    setText("");
    load();
  };

  const channels = [
    { id: "general", label: "General Crew", icon: MessageSquare },
    { id: "broadcast", label: "Broadcast", icon: Bell },
  ];

  return (
    <div className="p-4 lg:p-8 fadein h-full flex flex-col" style={{ minHeight: "calc(100vh - 80px)" }}>
      <div className="mb-4">
        <h1 className="text-2xl lg:text-3xl font-black text-slate-900">Site Chat</h1>
        <p className="text-slate-500 mt-1 text-sm">Talk to your crew in real time</p>
      </div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {channels.map(c => (
          <button key={c.id} onClick={()=>setChannel(c.id)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 ${channel===c.id ? "brand-grad text-black" : "bg-white border"}`}
            data-testid={`chat-channel-${c.id}`}>
            <c.icon className="w-4 h-4"/>{c.label}
          </button>
        ))}
      </div>
      <div className="flex-1 bg-white rounded-2xl border flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-slate-400 py-12">
              <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-40"/>
              No messages yet. Be the first to say hi.
            </div>
          )}
          {messages.map(m => {
            const mine = m.sender_id === user.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] ${mine ? "brand-grad text-black" : "bg-slate-100 text-slate-900"} px-4 py-2.5 rounded-2xl ${mine ? "rounded-br-md" : "rounded-bl-md"}`}>
                  {!mine && <div className="text-xs font-bold text-amber-700 mb-0.5">{m.sender_name} <span className="text-slate-400 font-normal capitalize">· {m.sender_role}</span></div>}
                  <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                  <div className={`text-[10px] mt-1 ${mine ? "text-black/60" : "text-slate-400"}`}>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef}/>
        </div>
        <form onSubmit={send} className="border-t p-3 flex gap-2">
          <input value={text} onChange={e=>setText(e.target.value)}
            placeholder={channel === "broadcast" ? "Send announcement to all workers…" : "Type a message…"}
            className="flex-1 px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-amber-400 outline-none"
            data-testid="chat-input"/>
          <button type="submit" className="px-5 py-2.5 brand-grad text-black font-bold rounded-xl flex items-center gap-2" data-testid="chat-send">
            <Send className="w-4 h-4"/>Send
          </button>
        </form>
      </div>
    </div>
  );
}

// ===================== SETTINGS =====================
function SettingsPage({ user }) {
  const [tab, setTab] = useState("share");
  return (
    <div className="p-6 lg:p-8 fadein">
      <div className="mb-6">
        <h1 className="text-3xl font-black text-slate-900">Settings</h1>
        <p className="text-slate-500 mt-1">Auto-share rules, API tokens & integrations</p>
      </div>
      <div className="flex gap-2 border-b mb-6">
        {[
          { id: "share", label: "Auto-Share Rules", icon: Share2 },
          { id: "tokens", label: "API Tokens", icon: Key },
          { id: "log", label: "Share Log", icon: Mail },
        ].map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold flex items-center gap-2 transition ${tab===t.id ? "border-amber-400 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            data-testid={`settings-tab-${t.id}`}>
            <t.icon className="w-4 h-4"/>{t.label}
          </button>
        ))}
      </div>
      {tab === "share" && <ShareRules/>}
      {tab === "tokens" && <ApiTokens/>}
      {tab === "log" && <ShareLog/>}
    </div>
  );
}

function ShareRules() {
  const [rules, setRules] = useState([]);
  const [locations, setLocations] = useState([]);
  const [show, setShow] = useState(false);
  const load = () => {
    api.get("/share-rules").then(r => setRules(r.data));
    api.get("/locations").then(r => setLocations(r.data));
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <div className="text-sm text-slate-600">When a matching form is submitted, an email is auto-sent. <span className="text-amber-600 font-semibold">(MOCKED — logged to Share Log)</span></div>
        <button onClick={()=>setShow(true)} className="px-4 py-2 brand-grad text-black font-bold rounded-lg flex items-center gap-2" data-testid="new-rule-btn"><Plus className="w-4 h-4"/>New Rule</button>
      </div>
      <div className="bg-white rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b text-slate-600 text-left">
            <tr>
              <th className="py-3 px-4 font-semibold">Trigger</th>
              <th className="py-3 px-4 font-semibold">Job Site</th>
              <th className="py-3 px-4 font-semibold">Recipients</th>
              <th className="py-3 px-4 font-semibold">Status</th>
              <th className="py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => {
              const loc = locations.find(l => l.id === r.location_id);
              const meta = CATEGORY_META[r.category] || CATEGORY_META.general;
              return (
                <tr key={r.id} className="border-b">
                  <td className="py-3 px-4"><span className={`px-2 py-0.5 rounded text-xs font-semibold border ${meta.color}`}>{r.category ? meta.label : "Any"}</span></td>
                  <td className="py-3 px-4 text-slate-700">{loc?.name || "Any location"}</td>
                  <td className="py-3 px-4 text-slate-700 text-xs font-mono">{(r.emails||[]).join(", ")}</td>
                  <td className="py-3 px-4">{r.enabled ? <span className="text-emerald-600 font-semibold">Active</span> : <span className="text-slate-400">Off</span>}</td>
                  <td className="py-3 px-4"><button onClick={async()=>{ if(window.confirm("Delete?")){ await api.delete(`/share-rules/${r.id}`); load();}}} className="text-red-500"><Trash2 className="w-4 h-4"/></button></td>
                </tr>
              );
            })}
            {rules.length === 0 && <tr><td colSpan="5" className="py-10 text-center text-slate-400">No rules yet. Create one to start auto-sharing.</td></tr>}
          </tbody>
        </table>
      </div>
      {show && <ShareRuleModal locations={locations} onClose={()=>{setShow(false); load();}}/>}
    </div>
  );
}

function ShareRuleModal({ locations, onClose }) {
  const [r, setR] = useState({ location_id: "", category: "", emails: "", enabled: true });
  const save = async () => {
    const payload = {
      id: crypto.randomUUID(),
      location_id: r.location_id || null,
      category: r.category || null,
      emails: r.emails.split(",").map(s=>s.trim()).filter(Boolean),
      enabled: r.enabled,
      created_at: new Date().toISOString(),
    };
    await api.post("/share-rules", payload);
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <h2 className="text-2xl font-bold mb-4">New Auto-Share Rule</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-1.5">When category…</label>
            <select value={r.category} onChange={e=>setR({...r, category: e.target.value})} className="w-full px-3 py-2.5 border rounded-lg">
              <option value="">Any category</option>
              <option value="incident">Incident</option>
              <option value="near_miss">Near Miss</option>
              <option value="inspection">Inspection</option>
              <option value="toolbox">Toolbox Talk</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">At job site…</label>
            <select value={r.location_id} onChange={e=>setR({...r, location_id: e.target.value})} className="w-full px-3 py-2.5 border rounded-lg">
              <option value="">Any location</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">Send to (comma-separated emails)</label>
            <input value={r.emails} onChange={e=>setR({...r, emails: e.target.value})} placeholder="safety@paneltec.com, supervisor@paneltec.com" className="w-full px-3 py-2.5 border rounded-lg" data-testid="rule-emails"/>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
          <button onClick={save} className="px-5 py-2 brand-grad text-black font-bold rounded-lg" data-testid="save-rule-btn">Create Rule</button>
        </div>
      </div>
    </div>
  );
}

function ShareLog() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get("/share-log").then(r => setItems(r.data)); }, []);
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b text-slate-600 text-left">
          <tr>
            <th className="py-3 px-4 font-semibold">Sent</th>
            <th className="py-3 px-4 font-semibold">Form</th>
            <th className="py-3 px-4 font-semibold">Job Site</th>
            <th className="py-3 px-4 font-semibold">Recipient</th>
            <th className="py-3 px-4 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map(i => (
            <tr key={i.id} className="border-b">
              <td className="py-3 px-4 text-slate-500">{new Date(i.sent_at).toLocaleString()}</td>
              <td className="py-3 px-4 font-medium">{i.template_name}</td>
              <td className="py-3 px-4 text-slate-600">{i.location_name}</td>
              <td className="py-3 px-4 font-mono text-xs">{i.recipient}</td>
              <td className="py-3 px-4"><span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-semibold">MOCKED</span></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan="5" className="py-10 text-center text-slate-400">No shares yet. Fill out a form to trigger rules.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ApiTokens() {
  const [tokens, setTokens] = useState([]);
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(null);
  const load = () => api.get("/api-tokens").then(r => setTokens(r.data));
  useEffect(() => { load(); }, []);

  const copyToken = (t) => {
    navigator.clipboard.writeText(t);
    setCopied(t);
    setTimeout(()=>setCopied(null), 2000);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <div className="text-sm text-slate-600">Use in <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">X-API-Key</code> header for <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">/api/public/*</code> endpoints (Zapier, custom integrations).</div>
        <button onClick={()=>setShow(true)} className="px-4 py-2 brand-grad text-black font-bold rounded-lg flex items-center gap-2" data-testid="new-token-btn"><Plus className="w-4 h-4"/>New Token</button>
      </div>
      <div className="space-y-3">
        {tokens.map(t => (
          <div key={t.id} className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-bold text-slate-900">{t.name}</div>
                <div className="text-xs text-slate-400 mt-0.5">Created {new Date(t.created_at).toLocaleDateString()} · Last used: {t.last_used ? new Date(t.last_used).toLocaleString() : "never"}</div>
              </div>
              <div className="flex items-center gap-2">
                <code className="px-3 py-1.5 bg-slate-900 text-amber-400 rounded font-mono text-xs">{t.token.slice(0, 18)}…</code>
                <button onClick={()=>copyToken(t.token)} className="px-3 py-1.5 border rounded text-sm font-semibold flex items-center gap-1.5 hover:bg-slate-50">
                  <Copy className="w-3.5 h-3.5"/>{copied === t.token ? "Copied!" : "Copy"}
                </button>
                <button onClick={async()=>{ if(window.confirm("Revoke this token?")){ await api.delete(`/api-tokens/${t.id}`); load();}}} className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4"/></button>
              </div>
            </div>
          </div>
        ))}
        {tokens.length === 0 && <div className="text-center py-10 text-slate-400 bg-white rounded-2xl border">No API tokens yet.</div>}
      </div>
      <div className="mt-6 p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto">
        <div className="text-amber-400 mb-2 font-bold tracking-wider text-[10px]">EXAMPLE USAGE</div>
        <div className="opacity-80 whitespace-nowrap">curl -H "X-API-Key: ptk_…" {(process.env.REACT_APP_BACKEND_URL || "")}/api/public/submissions</div>
      </div>
      {show && <TokenModal onClose={()=>{setShow(false); load();}}/>}
    </div>
  );
}

function TokenModal({ onClose }) {
  const [name, setName] = useState("");
  const [created, setCreated] = useState(null);
  const save = async () => {
    const { data } = await api.post("/api-tokens", { id: crypto.randomUUID(), name, token: "ptk_" + crypto.randomUUID().replace(/-/g,''), scopes: ["read"], created_at: new Date().toISOString() });
    setCreated(data);
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        {!created ? (
          <>
            <h2 className="text-2xl font-bold mb-4">New API Token</h2>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Token name (e.g. Zapier Integration)" className="w-full px-3 py-2.5 border rounded-lg" data-testid="token-name"/>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button onClick={save} disabled={!name} className="px-5 py-2 brand-grad text-black font-bold rounded-lg disabled:opacity-50" data-testid="save-token-btn">Create</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold mb-2 flex items-center gap-2"><CheckCircle2 className="w-6 h-6 text-emerald-500"/>Token Created</h2>
            <p className="text-sm text-slate-500 mb-4">Copy now — treat it like a password.</p>
            <div className="bg-slate-900 text-amber-400 rounded-lg p-3 font-mono text-xs break-all">{created.token}</div>
            <button onClick={()=>{navigator.clipboard.writeText(created.token);}} className="mt-3 w-full py-2 bg-slate-900 text-white rounded-lg font-semibold flex items-center justify-center gap-2">
              <Copy className="w-4 h-4"/>Copy Token
            </button>
            <button onClick={onClose} className="mt-2 w-full py-2 brand-grad text-black font-bold rounded-lg">Done</button>
          </>
        )}
      </div>
    </div>
  );
}

// ===================== WORKER MOBILE VIEW =====================
function WorkerMobileApp({ user, onLogout }) {
  const [tab, setTab] = useState("home");
  const [fillTemplate, setFillTemplate] = useState(null);

  const tabs = [
    { id: "home", label: "Home", icon: Home },
    { id: "forms", label: "Forms", icon: FileText },
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "me", label: "Me", icon: User },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-md mx-auto shadow-2xl">
      <header className="brand-grad-dark text-white px-4 py-4 flex items-center justify-between sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 brand-grad rounded-lg flex items-center justify-center">
            <HardHat className="w-5 h-5 text-black"/>
          </div>
          <div>
            <div className="text-[10px] text-amber-300 tracking-widest font-bold">PANELTEC</div>
            <div className="text-sm font-bold leading-tight">Hi, {user.name?.split(" ")[0]}</div>
          </div>
        </div>
        <button onClick={onLogout} className="p-2 hover:bg-white/10 rounded-lg" data-testid="mobile-logout"><LogOut className="w-5 h-5"/></button>
      </header>

      <main className="flex-1 overflow-y-auto pb-20">
        {tab === "home" && <WorkerHome user={user} onFill={setFillTemplate} goTo={setTab}/>}
        {tab === "forms" && <WorkerForms onFill={setFillTemplate}/>}
        {tab === "chat" && <Chat user={user}/>}
        {tab === "me" && <WorkerMe user={user}/>}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t shadow-lg flex justify-around z-30">
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 ${active ? "text-amber-600" : "text-slate-500"}`}
              data-testid={`mobile-nav-${t.id}`}>
              <t.icon className={`w-5 h-5 ${active ? "scale-110" : ""} transition`}/>
              <span className="text-[10px] font-bold mt-0.5">{t.label}</span>
            </button>
          );
        })}
      </nav>

      {fillTemplate && <FillForm template={fillTemplate} user={user} onClose={()=>setFillTemplate(null)}/>}
    </div>
  );
}

function WorkerHome({ user, onFill, goTo }) {
  const [templates, setTemplates] = useState([]);
  const [recentSubs, setRecentSubs] = useState([]);
  useEffect(() => {
    api.get("/forms/templates").then(r => setTemplates(r.data));
    api.get("/submissions").then(r => setRecentSubs(r.data.slice(0, 5)));
  }, []);

  return (
    <div className="p-4 space-y-5 fadein">
      <div className="brand-grad rounded-2xl p-5 text-black shadow-lg">
        <div className="text-xs font-bold tracking-widest opacity-70">TODAY</div>
        <div className="text-2xl font-black mt-1">Stay Safe Out There</div>
        <p className="text-sm opacity-80 mt-1">Complete your toolbox talk and run your pre-use checks.</p>
        <button onClick={()=>goTo("forms")} className="mt-3 bg-black text-amber-400 font-bold rounded-lg px-4 py-2 text-sm flex items-center gap-1.5">
          <PenLine className="w-4 h-4"/>Fill a Form
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-slate-900">Quick Start</h3>
          <button onClick={()=>goTo("forms")} className="text-xs text-amber-600 font-semibold">All Forms →</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {templates.slice(0, 4).map(t => {
            const meta = CATEGORY_META[t.category] || CATEGORY_META.general;
            return (
              <button key={t.id} onClick={()=>onFill(t)}
                className="bg-white rounded-xl p-4 border text-left active:scale-95 transition shadow-sm"
                data-testid={`mobile-form-${t.id}`}>
                <div className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${meta.color}`}>{meta.label}</div>
                <div className="font-bold text-sm mt-2 text-slate-900 line-clamp-2">{t.name}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="font-bold text-slate-900 mb-2">Recent Activity</h3>
        <div className="space-y-2">
          {recentSubs.map(s => {
            const meta = CATEGORY_META[s.category] || CATEGORY_META.general;
            return (
              <div key={s.id} className="bg-white rounded-xl p-3 border flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${meta.color}`}>
                  <FileText className="w-5 h-5"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{s.template_name}</div>
                  <div className="text-xs text-slate-500 truncate">{s.worker_name} · {new Date(s.submitted_at).toLocaleDateString()}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WorkerForms({ onFill }) {
  const [templates, setTemplates] = useState([]);
  useEffect(() => { api.get("/forms/templates").then(r => setTemplates(r.data)); }, []);
  return (
    <div className="p-4 fadein">
      <h2 className="text-xl font-black mb-3">All Forms</h2>
      <div className="space-y-3">
        {templates.map(t => {
          const meta = CATEGORY_META[t.category] || CATEGORY_META.general;
          return (
            <button key={t.id} onClick={()=>onFill(t)} className="w-full bg-white rounded-2xl p-4 border text-left active:scale-[0.98] transition shadow-sm" data-testid={`mobile-form-list-${t.id}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${meta.color}`}>{meta.label}</div>
                  <div className="font-bold text-base mt-1.5 text-slate-900">{t.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t.description}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 ml-2"/>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkerMe({ user }) {
  const [certs, setCerts] = useState([]);
  const [workers, setWorkers] = useState([]);
  useEffect(() => {
    api.get("/certifications").then(r => setCerts(r.data));
    api.get("/workers").then(r => setWorkers(r.data));
  }, []);
  const myWorker = workers.find(w => w.email === user.email) || workers[0];
  const myCerts = certs.filter(c => c.worker_id === myWorker?.id);
  const today = new Date();
  return (
    <div className="p-4 fadein">
      <div className="bg-white rounded-2xl border p-5 text-center">
        <div className="w-20 h-20 brand-grad rounded-full mx-auto flex items-center justify-center text-black font-black text-2xl">
          {user.name?.split(" ").map(n=>n[0]).slice(0,2).join("")}
        </div>
        <div className="font-black text-xl mt-3">{user.name}</div>
        <div className="text-sm text-slate-500 capitalize">{user.role}</div>
        <div className="text-xs text-slate-400 mt-0.5">{user.email}</div>
      </div>
      <h3 className="font-bold text-slate-900 mt-5 mb-2">My Certifications</h3>
      <div className="space-y-2">
        {myCerts.map(c => {
          const exp = c.expiry_date ? new Date(c.expiry_date) : null;
          const days = exp ? Math.floor((exp - today) / 86400000) : null;
          const st = days == null ? "ok" : days < 0 ? "expired" : days <= 14 ? "critical" : days <= 60 ? "warning" : "ok";
          const badge = { expired: "bg-red-100 text-red-700", critical: "bg-orange-100 text-orange-700", warning: "bg-amber-100 text-amber-700", ok: "bg-emerald-100 text-emerald-700" }[st];
          return (
            <div key={c.id} className="bg-white rounded-xl border p-3 flex items-center gap-3">
              <Award className="w-6 h-6 text-amber-500"/>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{c.name}</div>
                <div className="text-xs text-slate-500">{c.issuer}</div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge}`}>
                {days != null ? (days < 0 ? `Expired` : `${days}d`) : "OK"}
              </span>
            </div>
          );
        })}
        {myCerts.length === 0 && <div className="text-center text-slate-400 text-sm py-4">No certifications on file</div>}
      </div>
    </div>
  );
}


function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pt_user")); } catch { return null; }
  });
  const [view, setView] = useState("dashboard");
  const [fillTemplate, setFillTemplate] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const a = () => { setOnline(true); syncQueue(); };
    const b = () => setOnline(false);
    window.addEventListener("online", a);
    window.addEventListener("offline", b);
    // Initial sync attempt on mount
    syncQueue();
    return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); };
  }, []);

  const syncQueue = async () => {
    try {
      const queue = JSON.parse(localStorage.getItem("pt_queue") || "[]");
      if (queue.length === 0) return;
      const remaining = [];
      for (const item of queue) {
        try { await api.post("/submissions", item); }
        catch { remaining.push(item); }
      }
      localStorage.setItem("pt_queue", JSON.stringify(remaining));
    } catch {}
  };

  const logout = () => {
    localStorage.removeItem("pt_token");
    localStorage.removeItem("pt_user");
    setUser(null);
  };

  if (!user) return <Login onLogin={setUser}/>;

  // Workers get the mobile-first app experience
  if (user.role === "worker") {
    return (
      <>
        {!online && <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-center py-1.5 text-xs font-semibold flex items-center justify-center gap-2"><WifiOff className="w-3.5 h-3.5"/>Offline — your forms will sync when reconnected</div>}
        <WorkerMobileApp user={user} onLogout={logout}/>
      </>
    );
  }

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "templates", label: "Forms", icon: FileText },
    { id: "submissions", label: "Inbox", icon: ClipboardList },
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "workers", label: "Workers", icon: Users },
    { id: "locations", label: "Job Sites", icon: MapPin },
    { id: "certifications", label: "Certifications", icon: Award },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50">
      {!online && <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-center py-1.5 text-xs font-semibold flex items-center justify-center gap-2"><WifiOff className="w-3.5 h-3.5"/>Offline — changes will sync when reconnected</div>}
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
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
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

      <main className="flex-1 overflow-y-auto">
        {view === "dashboard" && <Dashboard goTo={setView}/>}
        {view === "templates" && <Templates user={user} onFill={setFillTemplate}/>}
        {view === "submissions" && <Submissions/>}
        {view === "chat" && <Chat user={user}/>}
        {view === "workers" && <Workers/>}
        {view === "locations" && <Locations/>}
        {view === "certifications" && <Certifications/>}
        {view === "settings" && <SettingsPage user={user}/>}
      </main>

      {fillTemplate && <FillForm template={fillTemplate} user={user} onClose={()=>setFillTemplate(null)}/>}
    </div>
  );
}

export default App;
