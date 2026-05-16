import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./App.css";
import ClientsPage from "./pages/Clients";
import NotesPage from "./pages/Notes";
import TasksPage from "./pages/Tasks";
import IntegrationsPage from "./pages/Integrations";
import {
  LayoutDashboard, FileText, ClipboardList, Users, MapPin, Award,
  Sparkles, LogOut, Plus, Trash2, Edit3, Save, X, AlertTriangle,
  CheckCircle2, Camera, MapPinned, PenLine, Eye, ShieldCheck, HardHat,
  TrendingUp, Bell, Search, Filter, ChevronRight, Building2, Wrench,
  Calendar, FileSearch, Loader2, Zap, BarChart3,
  MessageSquare, Settings, Send, Download, Share2, Key, Copy, WifiOff,
  Smartphone, Mail, Pencil, Circle as CircleIcon, ArrowUpRight, Home, User,
  AlertOctagon, FlaskConical, Truck, Briefcase, ListChecks, ChevronLeft,
  Menu, ArrowRight, Clock, Flame, Droplets,
  Folder, FolderOpen, FileSpreadsheet, FileType2, Upload, Tag, BookOpen, FilePlus,
  FileCheck, FileBadge, Image as ImageIcon,
  ClipboardCheck, StickyNote, UserCircle2, ListTodo
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
  const [selected, setSelected] = useState([]);
  const [searchField, setSearchField] = useState("name");
  const [searchValue, setSearchValue] = useState("");
  const [editing, setEditing] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showAvail, setShowAvail] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [showSyncModal, setShowSyncModal] = useState(false);

  const load = () => api.get("/workers").then(r => setItems(r.data));
  useEffect(() => { load(); }, []);

  const toggleStatus = async (w) => {
    const newStatus = w.status === "active" ? "inactive" : "active";
    await api.put(`/workers/${w.id}`, { ...w, status: newStatus });
    load();
  };

  const syncFromSimpro = async (companyIds) => {
    setSyncing(true); setSyncResult(null);
    try {
      const url = companyIds && companyIds.length
        ? `/integrations/simpro/sync/employees?company_ids=${companyIds.join(",")}`
        : "/integrations/simpro/sync/employees";
      const { data } = await api.post(url, null, { timeout: 120000 });
      setSyncResult(data);
      load();
    } catch (e) {
      const detail = e?.response?.data?.detail || e.message;
      setSyncResult({ ok: false, error: detail });
    }
    setSyncing(false);
    setShowSyncModal(false);
  };

  const clearTestWorkers = async () => {
    if (!window.confirm("Delete all NON-Simpro (test/manual) workers? This keeps any workers already synced from Simpro.")) return;
    try {
      const { data } = await api.delete("/workers/seed-data");
      alert(`✓ Removed ${data.deleted} test/manual workers.`);
      load();
    } catch (e) {
      alert("Failed: " + (e?.response?.data?.detail || e.message));
    }
  };

  const filtered = items.filter(w => {
    if (!searchValue) return true;
    const v = searchValue.toLowerCase();
    if (searchField === "name") return (w.name || `${w.first_name||""} ${w.last_name||""}`).toLowerCase().includes(v);
    if (searchField === "email") return (w.email||"").toLowerCase().includes(v);
    if (searchField === "role") return (w.role||"").toLowerCase().includes(v);
    if (searchField === "trade") return (w.trade||"").toLowerCase().includes(v);
    return true;
  });

  const toggleSelect = (id) => setSelected(selected.includes(id) ? selected.filter(x=>x!==id) : [...selected, id]);
  const toggleSelectAll = () => setSelected(selected.length === filtered.length ? [] : filtered.map(w=>w.id));

  return (
    <div className="fadein">
      {/* Page header */}
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">Members Management</h1>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>setShowSyncModal(true)} disabled={syncing}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-sm flex items-center gap-2 disabled:opacity-50"
            data-testid="sync-employees-btn">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <ArrowRight className="w-4 h-4 rotate-90"/>}
            SYNC EMPLOYEES
          </button>
          <button onClick={clearTestWorkers}
            className="px-3 py-2 bg-white border-2 border-red-200 hover:bg-red-50 text-red-600 font-bold rounded text-sm flex items-center gap-2"
            title="Remove all non-Simpro test workers"
            data-testid="clear-test-workers-btn">
            <Trash2 className="w-4 h-4"/>Clean Test Workers
          </button>
          <button onClick={()=>{setEditing(null); setShowEdit(true);}}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-sm flex items-center gap-2"
            data-testid="new-worker-btn">
            <Plus className="w-4 h-4"/>ADD NEW
          </button>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className={`mx-6 mt-4 p-3 rounded-lg text-sm border ${syncResult.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          {syncResult.ok ? (
            <>✓ Synced <b>{syncResult.synced_count}</b> employee{syncResult.synced_count===1?"":"s"} from Simpro.</>
          ) : (
            <>⚠ Simpro sync: {syncResult.error || "Connection not configured. Set up in Settings → Simpro."}</>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="px-6 py-4 flex items-center justify-end gap-2 flex-wrap">
        <div className="flex items-center gap-2 bg-white rounded shadow-sm border">
          <select value={searchField} onChange={e=>setSearchField(e.target.value)} className="px-3 py-2 text-sm border-r rounded-l focus:outline-none">
            <option value="name">Members Name</option>
            <option value="email">Email</option>
            <option value="role">Role</option>
            <option value="trade">Trade</option>
          </select>
          <input value={searchValue} onChange={e=>setSearchValue(e.target.value)} placeholder="Search…" className="px-3 py-2 text-sm w-48 focus:outline-none"/>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-r" data-testid="member-search-btn">
            SEARCH
          </button>
        </div>
        <button onClick={load} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm" title="Refresh">
          <ArrowRight className="w-4 h-4 rotate-90"/>
        </button>
      </div>

      {/* Table */}
      <div className="px-6 pb-8">
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-700 text-white">
                <tr>
                  <th className="py-3 px-4 text-left w-10">
                    <input type="checkbox" checked={filtered.length > 0 && selected.length === filtered.length} onChange={toggleSelectAll}/>
                  </th>
                  <th className="py-3 px-4 text-left font-semibold">Member Name</th>
                  <th className="py-3 px-4 text-left font-semibold">Email</th>
                  <th className="py-3 px-4 text-left font-semibold">Role</th>
                  <th className="py-3 px-4 text-left font-semibold">License Allocated By</th>
                  <th className="py-3 px-4 text-center font-semibold">Status</th>
                  <th className="py-3 px-4 text-center font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w, idx) => {
                  const isManager = w.role === "manager" || w.is_manager;
                  const isActive = (w.status || "active") === "active";
                  return (
                    <tr key={w.id} className={`border-b hover:bg-slate-50 ${idx%2===1?"bg-slate-50/30":""}`} data-testid={`member-row-${w.id}`}>
                      <td className="py-3 px-4">
                        <input type="checkbox" checked={selected.includes(w.id)} onChange={()=>toggleSelect(w.id)}/>
                      </td>
                      <td className={`py-3 px-4 ${isManager?"font-bold":""}`}>{w.name || `${w.first_name||""} ${w.last_name||""}`.trim()}</td>
                      <td className="py-3 px-4 text-slate-600 lowercase">{w.email || "—"}</td>
                      <td className={`py-3 px-4 capitalize ${isManager?"font-bold":""}`}>{isManager ? "Manager" : (w.role === "supervisor" ? "Supervisor" : "Member")}</td>
                      <td className="py-3 px-4 text-slate-500">
                        {w.simpro_company_name ? (
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${w.simpro_company_id==='2'?'bg-blue-100 text-blue-700':w.simpro_company_id==='3'?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-700'}`}>{w.simpro_company_name}</span>
                        ) : w.license_allocated ? (w.license_allocated_by || "Us") : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex justify-center">
                          <button onClick={()=>toggleStatus(w)} className={`relative w-12 h-6 rounded-full transition ${isActive ? "bg-blue-500" : "bg-slate-300"}`} data-testid={`status-toggle-${w.id}`}>
                            <span className={`absolute top-0.5 ${isActive ? "left-6" : "left-0.5"} w-5 h-5 bg-white rounded-full shadow transition-all`}/>
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex justify-center gap-1">
                          <button onClick={()=>{setEditing(w); setShowEdit(true);}} className="w-8 h-8 bg-sky-400 hover:bg-sky-500 text-white rounded flex items-center justify-center" title="Edit Member" data-testid={`edit-member-${w.id}`}>
                            <Edit3 className="w-4 h-4"/>
                          </button>
                          <button onClick={()=>setShowAvail(w)} className="w-8 h-8 bg-sky-400 hover:bg-sky-500 text-white rounded flex items-center justify-center" title="Edit Availability" data-testid={`avail-member-${w.id}`}>
                            <Calendar className="w-4 h-4"/>
                          </button>
                          <button onClick={async()=>{ if(window.confirm("Delete this member?")) { await api.delete(`/workers/${w.id}`); load();}}} className="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded flex items-center justify-center" title="Delete" data-testid={`delete-member-${w.id}`}>
                            <Trash2 className="w-4 h-4"/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan="7" className="py-12 text-center text-slate-400">No members found. Click "Add New" or "Sync Employees" to start.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-slate-50 border-t text-sm text-slate-500 flex items-center justify-between">
            <div>{filtered.length} member{filtered.length===1?"":"s"} {selected.length > 0 && <span className="ml-2 text-slate-700 font-semibold">· {selected.length} selected</span>}</div>
          </div>
        </div>
      </div>

      {showEdit && <EditMemberModal editing={editing} onClose={()=>{setShowEdit(false); load();}}/>}
      {showAvail && <EditAvailabilityModal worker={showAvail} onClose={()=>{setShowAvail(null); load();}}/>}
      {showSyncModal && <SimproSyncCompanyModal syncing={syncing} onClose={()=>setShowSyncModal(false)} onSync={syncFromSimpro}/>}
    </div>
  );
}

function SimproSyncCompanyModal({ syncing, onClose, onSync }) {
  const [c2, setC2] = useState(true);   // Paneltec Civil
  const [c3, setC3] = useState(true);   // Viatec Traffic
  const start = () => {
    const ids = [];
    if (c2) ids.push("2");
    if (c3) ids.push("3");
    if (ids.length === 0) { alert("Pick at least one company"); return; }
    onSync(ids);
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md overflow-hidden">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Sync Employees from SimPRO</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1" disabled={syncing}><X className="w-5 h-5"/></button>
        </div>
        <div className="p-5">
          <p className="text-sm text-slate-600 mb-4">Choose which SimPRO companies to sync employees from. Workers are tagged with their source company.</p>
          <div className="space-y-2">
            <label className={`flex items-center gap-3 px-4 py-3 border-2 rounded-lg cursor-pointer transition ${c2?"border-blue-500 bg-blue-50":"border-slate-200"}`}>
              <input type="checkbox" checked={c2} onChange={e=>setC2(e.target.checked)} className="w-5 h-5 accent-blue-500" data-testid="sync-c2"/>
              <div className="flex-1">
                <div className="font-bold">Paneltec Civil</div>
                <div className="text-xs text-slate-500">SimPRO Company ID: 2</div>
              </div>
            </label>
            <label className={`flex items-center gap-3 px-4 py-3 border-2 rounded-lg cursor-pointer transition ${c3?"border-emerald-500 bg-emerald-50":"border-slate-200"}`}>
              <input type="checkbox" checked={c3} onChange={e=>setC3(e.target.checked)} className="w-5 h-5 accent-emerald-500" data-testid="sync-c3"/>
              <div className="flex-1">
                <div className="font-bold">Viatec Traffic</div>
                <div className="text-xs text-slate-500">SimPRO Company ID: 3</div>
              </div>
            </label>
          </div>
          <div className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            <b>Tip:</b> Run "Clean Test Workers" first to remove the seed/demo workers before your first real sync.
          </div>
        </div>
        <div className="border-t p-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} disabled={syncing} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={start} disabled={syncing || (!c2 && !c3)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded flex items-center gap-2 disabled:opacity-50" data-testid="confirm-sync-btn">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <ArrowRight className="w-4 h-4 rotate-90"/>}
            {syncing ? "Syncing..." : "Start Sync"}
          </button>
        </div>
      </div>
    </div>
  );
}



function EditMemberModal({ editing, onClose }) {
  const initial = editing || {
    first_name: "", last_name: "", email: "", phone: "", birth_date: "",
    country: "AUSTRALIA", state: "", street_address: "", suburb: "", postal_code: "",
    additional_notes: "", role: "worker", trade: "",
    client_ids: [], skills: [], is_manager: false, license_allocated: false,
  };
  const [w, setW] = useState(initial);
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState("");
  const [skills, setSkills] = useState([]);
  const [skillInput, setSkillInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/clients").then(r => setClients(r.data));
    api.get("/skills").then(r => setSkills(r.data));
  }, []);

  const set = (k, v) => setW({ ...w, [k]: v });
  const toggleClient = (cid) => {
    const cur = w.client_ids || [];
    setW({ ...w, client_ids: cur.includes(cid) ? cur.filter(x=>x!==cid) : [...cur, cid] });
  };
  const toggleAllClients = () => {
    const cur = w.client_ids || [];
    const allIds = filteredClients.map(c=>c.id);
    const allSelected = allIds.every(id => cur.includes(id));
    setW({ ...w, client_ids: allSelected ? cur.filter(x=>!allIds.includes(x)) : Array.from(new Set([...cur, ...allIds])) });
  };
  const filteredClients = clients.filter(c => !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase()));

  const addSkill = (s) => {
    if (!s || (w.skills||[]).includes(s)) return;
    setW({ ...w, skills: [...(w.skills||[]), s] });
    setSkillInput("");
  };
  const removeSkill = (s) => setW({ ...w, skills: (w.skills||[]).filter(x=>x!==s) });

  const save = async () => {
    setSaving(true);
    const fullName = `${w.first_name||""} ${w.last_name||""}`.trim() || w.name || "Unnamed";
    const payload = {
      ...w,
      name: fullName,
      id: editing?.id || crypto.randomUUID(),
      role: w.is_manager ? "manager" : (w.role || "worker"),
      created_at: editing?.created_at || new Date().toISOString(),
      location_ids: w.location_ids || [],
    };
    try {
      if (editing) await api.put(`/workers/${editing.id}`, payload);
      else await api.post("/workers", payload);
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{editing ? "Edit Member" : "Add New Member"}</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">First Name</label>
              <input value={w.first_name||""} onChange={e=>set("first_name", e.target.value)} className="w-full px-3 py-2 border rounded" data-testid="member-first-name"/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Last Name</label>
              <input value={w.last_name||""} onChange={e=>set("last_name", e.target.value)} className="w-full px-3 py-2 border rounded" data-testid="member-last-name"/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Birth Date</label>
              <div className="relative">
                <input type="date" value={w.birth_date||""} onChange={e=>set("birth_date", e.target.value)} className="w-full px-3 py-2 border rounded pr-10"/>
                <Calendar className="w-4 h-4 absolute right-3 top-3 text-slate-400 pointer-events-none"/>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Member Email</label>
              <input value={w.email||""} onChange={e=>set("email", e.target.value)} className={`w-full px-3 py-2 border rounded ${editing?"bg-slate-100":""}`} readOnly={!!editing}/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Phone</label>
              <input value={w.phone||""} onChange={e=>set("phone", e.target.value)} className="w-full px-3 py-2 border rounded"/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Country</label>
              <select value={w.country||"AUSTRALIA"} onChange={e=>set("country", e.target.value)} className="w-full px-3 py-2 border rounded">
                <option value="AUSTRALIA">AUSTRALIA</option>
                <option value="NEW ZEALAND">NEW ZEALAND</option>
                <option value="CANADA">CANADA</option>
                <option value="UNITED STATES">UNITED STATES</option>
                <option value="UNITED KINGDOM">UNITED KINGDOM</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">State</label>
              <select value={w.state||""} onChange={e=>set("state", e.target.value)} className="w-full px-3 py-2 border rounded">
                <option value="">— Select —</option>
                {["Tasmania","Victoria","New South Wales","Queensland","South Australia","Western Australia","Northern Territory","Australian Capital Territory"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Street Address</label>
              <input value={w.street_address||""} onChange={e=>set("street_address", e.target.value)} className="w-full px-3 py-2 border rounded"/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Suburb</label>
              <input value={w.suburb||""} onChange={e=>set("suburb", e.target.value)} className="w-full px-3 py-2 border rounded"/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Postal Code</label>
              <input value={w.postal_code||""} onChange={e=>set("postal_code", e.target.value)} className="w-full px-3 py-2 border rounded"/>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Additional Notes</label>
            <textarea value={w.additional_notes||""} onChange={e=>set("additional_notes", e.target.value)} rows="2" placeholder="Additional Notes" className="w-full px-3 py-2 border rounded"/>
          </div>

          {/* Client / Project assignment */}
          <div>
            <label className="block text-sm font-semibold mb-2">Client</label>
            <div className="flex items-center gap-2 mb-2">
              <input value={clientSearch} onChange={e=>setClientSearch(e.target.value)} placeholder="Search Project" className="flex-1 px-3 py-2 border rounded"/>
              <button type="button" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-sm">SEARCH</button>
              <button type="button" onClick={()=>setClientSearch("")} className="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded" title="Refresh">
                <ArrowRight className="w-4 h-4 rotate-90"/>
              </button>
            </div>
            <div className="border rounded max-h-56 overflow-y-auto bg-slate-50">
              <label className="flex items-center gap-2 px-3 py-2 hover:bg-white border-b font-bold cursor-pointer">
                <input type="checkbox" checked={filteredClients.length>0 && filteredClients.every(c=>(w.client_ids||[]).includes(c.id))} onChange={toggleAllClients} className="w-4 h-4 accent-blue-500"/>
                Select/Unselect All
              </label>
              {filteredClients.map(c => (
                <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white cursor-pointer border-b last:border-0 font-semibold">
                  <input type="checkbox" checked={(w.client_ids||[]).includes(c.id)} onChange={()=>toggleClient(c.id)} className="w-4 h-4 accent-blue-500"/>
                  {c.name}
                </label>
              ))}
              {filteredClients.length === 0 && <div className="text-center py-4 text-sm text-slate-400">No clients match.</div>}
            </div>
          </div>

          {/* Skills */}
          <div>
            <label className="block text-sm font-semibold mb-2">Skills Set</label>
            <div className="border rounded p-2 min-h-[80px]">
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(w.skills||[]).map(s => (
                  <span key={s} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold flex items-center gap-1">
                    {s}
                    <button onClick={()=>removeSkill(s)} type="button" className="hover:bg-blue-200 rounded-full"><X className="w-3 h-3"/></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input value={skillInput} onChange={e=>setSkillInput(e.target.value)}
                  onKeyDown={e=>{ if (e.key==='Enter') { e.preventDefault(); addSkill(skillInput.trim()); }}}
                  list="skill-suggestions"
                  placeholder="Select or type a skill and press Enter"
                  className="flex-1 px-2 py-1 text-sm focus:outline-none"/>
                <datalist id="skill-suggestions">
                  {skills.map(s => <option key={s.id} value={s.name}/>)}
                </datalist>
                {skillInput && <button type="button" onClick={()=>addSkill(skillInput.trim())} className="px-3 py-1 bg-blue-600 text-white rounded text-xs">Add</button>}
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!w.is_manager} onChange={e=>set("is_manager", e.target.checked)} className="w-4 h-4 accent-blue-500" data-testid="member-is-manager"/>
              <span className="font-semibold">Manager</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!w.license_allocated} onChange={e=>set("license_allocated", e.target.checked)} className="w-4 h-4 accent-blue-500" data-testid="member-allocate-license"/>
              <span className="font-semibold">Allocate License</span>
            </label>
          </div>
        </div>

        <div className="border-t p-4 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded flex items-center gap-2 disabled:opacity-50" data-testid="save-member-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}Save
          </button>
        </div>
      </div>
    </div>
  );
}

function EditAvailabilityModal({ worker, onClose }) {
  const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  const labels = { monday:"Monday", tuesday:"Tuesday", wednesday:"Wednesday", thursday:"Thursday", friday:"Friday", saturday:"Saturday", sunday:"Sunday" };
  const init = worker.availability || days.reduce((a,d) => { a[d] = {enabled:false, start:"06:00", end:"15:00"}; return a; }, {});
  const [avail, setAvail] = useState(init);
  const [saving, setSaving] = useState(false);

  const set = (day, key, val) => setAvail({ ...avail, [day]: { ...avail[day], [key]: val }});

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/workers/${worker.id}/availability`, { availability: avail });
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Edit Availability ({worker.name || `${worker.first_name||""} ${worker.last_name||""}`.trim()})</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="font-bold mb-3">Regular Availability</h3>
          <div className="space-y-3">
            {days.map(d => (
              <div key={d} className="border rounded-lg p-3">
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input type="checkbox" checked={avail[d]?.enabled || false} onChange={e=>set(d, "enabled", e.target.checked)} className="w-4 h-4 accent-blue-500" data-testid={`avail-${d}-enabled`}/>
                  <span className="font-bold">{labels[d]}</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input type="time" value={avail[d]?.start || "06:00"} onChange={e=>set(d, "start", e.target.value)} disabled={!avail[d]?.enabled} className="px-3 py-2 border rounded text-center disabled:bg-slate-100 disabled:text-slate-400" data-testid={`avail-${d}-start`}/>
                  <input type="time" value={avail[d]?.end || "15:00"} onChange={e=>set(d, "end", e.target.value)} disabled={!avail[d]?.enabled} className="px-3 py-2 border rounded text-center disabled:bg-slate-100 disabled:text-slate-400" data-testid={`avail-${d}-end`}/>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t p-4 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={save} disabled={saving} className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded flex items-center gap-2 disabled:opacity-50" data-testid="save-availability-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// LEGACY WorkerModal stub (kept for any leftover refs)
function WorkerModal({ editing, onClose }) {
  return <EditMemberModal editing={editing} onClose={onClose}/>;
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
      <div className="flex gap-2 border-b mb-6 overflow-x-auto">
        {[
          { id: "share", label: "Auto-Share Rules", icon: Share2 },
          { id: "tokens", label: "API Tokens", icon: Key },
          { id: "log", label: "Share Log", icon: Mail },
          { id: "dropbox", label: "Dropbox Sync", icon: BookOpen },
          { id: "simpro", label: "Simpro Sync", icon: Briefcase },
          { id: "compliance", label: "Ack Compliance", icon: FileBadge },
        ].map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold flex items-center gap-2 transition whitespace-nowrap ${tab===t.id ? "border-amber-400 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            data-testid={`settings-tab-${t.id}`}>
            <t.icon className="w-4 h-4"/>{t.label}
          </button>
        ))}
      </div>
      {tab === "share" && <ShareRules/>}
      {tab === "tokens" && <ApiTokens/>}
      {tab === "log" && <ShareLog/>}
      {tab === "dropbox" && <DropboxSettings/>}
      {tab === "simpro" && <SimproSettings/>}
      {tab === "compliance" && <AckCompliance/>}
    </div>
  );
}

function SimproSettings() {
  const [status, setStatus] = useState(null);
  const [cfg, setCfg] = useState({ base_url: "", api_token: "", company_id: "0", client_id: "", client_secret: "" });
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(null); // 'employees' | 'clients' | null
  const [lastResult, setLastResult] = useState(null);

  const load = () => api.get("/integrations/simpro/status").then(r => setStatus(r.data));
  useEffect(() => { load(); }, []);

  const connect = async () => {
    setConnecting(true);
    try {
      const { data } = await api.post("/integrations/simpro/connect", cfg);
      if (data.verified) {
        alert("✓ Connected to Simpro successfully.");
      } else {
        alert("⚠ Saved configuration but couldn't verify the connection. You can still try to sync.\n\n" + (data.error || ""));
      }
      setCfg({ ...cfg, api_token: "", client_secret: "" });
      load();
    } catch (e) {
      alert("Connect failed: " + (e?.response?.data?.detail || e.message));
    }
    setConnecting(false);
  };

  const syncEmployees = async () => {
    setSyncing("employees");
    try {
      const { data } = await api.post("/integrations/simpro/sync/employees", null, { timeout: 120000 });
      setLastResult(data); load();
    } catch (e) { setLastResult({ ok: false, error: e?.response?.data?.detail || e.message }); }
    setSyncing(null);
  };

  const syncClients = async () => {
    setSyncing("clients");
    try {
      const { data } = await api.post("/integrations/simpro/sync/clients", null, { timeout: 120000 });
      setLastResult(data); load();
    } catch (e) { setLastResult({ ok: false, error: e?.response?.data?.detail || e.message }); }
    setSyncing(null);
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Simpro?")) return;
    await api.delete('/integrations/simpro');
    load();
  };

  return (
    <div className="max-w-3xl">
      <div className="bg-gradient-to-br from-orange-50 to-amber-50 border-2 border-orange-200 rounded-2xl p-5 mb-5">
        <h3 className="font-bold text-orange-900 flex items-center gap-2 mb-2"><Briefcase className="w-5 h-5"/>Simpro Integration</h3>
        <p className="text-sm text-orange-800">Sync employees, clients/companies, and projects from your Simpro Build account. The "Sync Employees" button on the Members Management page uses this connection.</p>
      </div>

      {status?.connected ? (
        <div className="bg-white border rounded-2xl p-5">
          <div className="flex items-center gap-2 text-emerald-600 font-bold mb-3">
            <CheckCircle2 className="w-5 h-5"/>Connected{status.has_token ? "" : " (no token)"}
          </div>
          <div className="text-sm text-slate-600 space-y-1 mb-4">
            <div><b>Base URL:</b> <code className="bg-slate-100 px-2 py-0.5 rounded font-mono text-xs">{status.base_url}</code></div>
            <div><b>Company ID:</b> <code className="bg-slate-100 px-2 py-0.5 rounded font-mono text-xs">{status.company_id}</code></div>
            <div><b>Auth method:</b> {status.auth_method}</div>
            {status.last_sync && <div className="text-xs text-slate-500">Last sync: {new Date(status.last_sync).toLocaleString()} · {status.last_sync_count} records</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={syncEmployees} disabled={syncing} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg flex items-center gap-2 disabled:opacity-50" data-testid="simpro-sync-employees-btn">
              {syncing==="employees" ? <Loader2 className="w-4 h-4 animate-spin"/> : <Users className="w-4 h-4"/>}Sync Employees
            </button>
            <button onClick={syncClients} disabled={syncing} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg flex items-center gap-2 disabled:opacity-50" data-testid="simpro-sync-clients-btn">
              {syncing==="clients" ? <Loader2 className="w-4 h-4 animate-spin"/> : <Building2 className="w-4 h-4"/>}Sync Clients
            </button>
            <button onClick={disconnect} className="px-4 py-2.5 border rounded-lg text-sm">Disconnect</button>
          </div>
          {lastResult && (
            <div className={`mt-4 p-4 rounded-lg border text-sm ${lastResult.ok ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
              {lastResult.ok ? (
                <div><b>✓ {lastResult.synced_count}</b> record{lastResult.synced_count===1?"":"s"} synced.</div>
              ) : (
                <div className="text-red-700">⚠ {lastResult.error}</div>
              )}
              {lastResult.synced?.length > 0 && (
                <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold">Show synced records</summary><ul className="text-xs mt-2 space-y-0.5">{lastResult.synced.slice(0,30).map((s,i)=>(<li key={i}>• {s.name}{s.email?` (${s.email})`:""}</li>))}</ul></details>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border rounded-2xl p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
            <div className="font-bold text-amber-900 mb-1">How to get Simpro credentials:</div>
            <ol className="list-decimal ml-5 text-amber-800 text-xs space-y-0.5">
              <li>Log into Simpro Build as an admin → System → Setup → Integrations → API</li>
              <li>Generate an API Token (Bearer token) OR set up OAuth2 Client</li>
              <li>Note your company URL (e.g. <code>https://paneltec.simprosuite.com</code>) and Company ID (usually 0)</li>
              <li>Paste below — your token is encrypted at rest.</li>
            </ol>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">Company URL</label>
            <input value={cfg.base_url} onChange={e=>setCfg({...cfg, base_url: e.target.value})} placeholder="https://paneltec.simprosuite.com" className="w-full px-3 py-2.5 border rounded-lg font-mono text-sm" data-testid="simpro-base-url"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">Company ID</label>
            <input value={cfg.company_id} onChange={e=>setCfg({...cfg, company_id: e.target.value})} placeholder="0" className="w-full px-3 py-2.5 border rounded-lg font-mono text-sm" data-testid="simpro-company-id"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">API Token (Bearer)</label>
            <input value={cfg.api_token} onChange={e=>setCfg({...cfg, api_token: e.target.value})} placeholder="Paste your Simpro API token" className="w-full px-3 py-2.5 border rounded-lg font-mono text-xs" data-testid="simpro-api-token"/>
          </div>
          <details className="text-sm">
            <summary className="font-semibold cursor-pointer">OAuth2 (Optional)</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <input value={cfg.client_id} onChange={e=>setCfg({...cfg, client_id: e.target.value})} placeholder="Client ID" className="w-full px-3 py-2 border rounded font-mono text-xs"/>
              <input value={cfg.client_secret} onChange={e=>setCfg({...cfg, client_secret: e.target.value})} placeholder="Client Secret" className="w-full px-3 py-2 border rounded font-mono text-xs"/>
            </div>
          </details>
          <button onClick={connect} disabled={!cfg.base_url || connecting} className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg flex items-center justify-center gap-2 disabled:opacity-50" data-testid="simpro-connect-btn">
            {connecting ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4"/>}Connect Simpro
          </button>
          <div className="text-xs text-slate-500 italic">You can save just the Company URL to test the integration UI. Real sync needs a valid token.</div>
        </div>
      )}
    </div>
  );
}

function DropboxSettings() {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState("");
  const [folder, setFolder] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const load = () => api.get('/integrations/dropbox/status').then(r => setStatus(r.data));
  useEffect(() => { load(); }, []);

  const connect = async () => {
    setConnecting(true);
    try {
      await api.post('/integrations/dropbox/connect', { access_token: token, folder_path: folder });
      setToken(""); load();
    } catch (e) { alert("Connect failed: " + (e?.response?.data?.detail || e.message)); }
    setConnecting(false);
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/integrations/dropbox/sync?classify=true&max_files=50', null, { timeout: 600000 });
      setLastResult(data);
      load();
    } catch (e) { alert("Sync failed: " + (e?.response?.data?.detail || e.message)); }
    setSyncing(false);
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Dropbox?")) return;
    await api.delete('/integrations/dropbox');
    load();
  };

  return (
    <div className="max-w-3xl">
      <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-2xl p-5 mb-5">
        <h3 className="font-bold text-blue-900 flex items-center gap-2 mb-2">↻ Dropbox Sync</h3>
        <p className="text-sm text-blue-800">Auto-import documents from a Dropbox folder. AI will classify and tag each file as it syncs.</p>
      </div>

      {status?.connected ? (
        <div className="bg-white border rounded-2xl p-5">
          <div className="flex items-center gap-2 text-emerald-600 font-bold mb-3"><CheckCircle2 className="w-5 h-5"/>Connected</div>
          <div className="text-sm text-slate-600 mb-1"><b>Folder path:</b> <code className="bg-slate-100 px-2 py-0.5 rounded font-mono text-xs">{status.folder_path || "(root)"}</code></div>
          {status.last_sync && <div className="text-sm text-slate-600">Last sync: {new Date(status.last_sync).toLocaleString()} · {status.last_sync_count} files imported</div>}
          <div className="flex gap-2 mt-4">
            <button onClick={sync} disabled={syncing} className="px-5 py-2.5 brand-grad text-black font-bold rounded-lg flex items-center gap-2 disabled:opacity-50" data-testid="dropbox-sync-btn">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}{syncing ? "Syncing (this may take a few minutes)..." : "Sync Now"}
            </button>
            <button onClick={disconnect} className="px-4 py-2.5 border rounded-lg text-sm">Disconnect</button>
          </div>
          {lastResult && (
            <div className="mt-4 p-4 bg-slate-50 rounded-lg border text-sm">
              <div className="font-bold mb-2">Sync result:</div>
              <div>✓ Synced <b>{lastResult.synced_count}</b> new file{lastResult.synced_count===1?"":"s"} (of {lastResult.total_found} total)</div>
              {lastResult.errors?.length > 0 && (
                <div className="mt-2 text-red-600">⚠ {lastResult.errors.length} error(s):<ul className="list-disc ml-5 mt-1 text-xs">{lastResult.errors.slice(0,5).map((e,i)=>(<li key={i}>{e}</li>))}</ul></div>
              )}
              {lastResult.synced?.length > 0 && (
                <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold">Show {lastResult.synced.length} synced files</summary><ul className="text-xs mt-2 space-y-1">{lastResult.synced.map((s,i)=>(<li key={i}>📄 <b>{s.name}</b> → {s.category} {s.doc_type ? `(${s.doc_type})` : ""}</li>))}</ul></details>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border rounded-2xl p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
            <div className="font-bold text-amber-900 mb-1">How to get a Dropbox access token:</div>
            <ol className="list-decimal ml-5 text-amber-800 text-xs space-y-0.5">
              <li>Go to <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer" className="underline font-semibold">dropbox.com/developers/apps</a></li>
              <li>Click "Create app" → "Scoped access" → "Full Dropbox" → name it "Paneltec Sync"</li>
              <li>On the app page, scroll to "OAuth 2" → click "Generate access token"</li>
              <li>Copy the token and paste it below</li>
              <li>Note: tokens are short-lived (4 hours). Re-generate when needed.</li>
            </ol>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">Dropbox Access Token</label>
            <input value={token} onChange={e=>setToken(e.target.value)} placeholder="sl.u..." className="w-full px-3 py-2.5 border rounded-lg font-mono text-xs" data-testid="dropbox-token-input"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">Folder Path (leave empty for root)</label>
            <input value={folder} onChange={e=>setFolder(e.target.value)} placeholder="/Risk & Compliance" className="w-full px-3 py-2.5 border rounded-lg" data-testid="dropbox-folder-input"/>
            <div className="text-xs text-slate-500 mt-1">Use the EXACT folder path in your Dropbox, including the leading slash.</div>
          </div>
          <button onClick={connect} disabled={!token || connecting} className="w-full py-3 brand-grad text-black font-bold rounded-lg flex items-center justify-center gap-2 disabled:opacity-50" data-testid="dropbox-connect-btn">
            {connecting ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4"/>}Connect Dropbox
          </button>
        </div>
      )}
    </div>
  );
}

function AckCompliance() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get('/acknowledgements/compliance').then(r => setRows(r.data)); }, []);
  const overall = rows.length ? Math.round(rows.reduce((s,r)=>s+r.pct, 0) / rows.length) : 0;
  return (
    <div className="max-w-4xl">
      <div className="bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 rounded-2xl p-5 mb-5">
        <h3 className="font-bold text-purple-900 flex items-center gap-2 mb-2"><FileBadge className="w-5 h-5"/>Worker Acknowledgement Compliance</h3>
        <div className="text-4xl font-black text-purple-900">{overall}%</div>
        <p className="text-sm text-purple-800">Overall compliance across all documents requiring worker acknowledgement</p>
      </div>
      <div className="bg-white border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b text-slate-600 text-left">
            <tr>
              <th className="py-3 px-4 font-semibold">Document</th>
              <th className="py-3 px-4 font-semibold">Category</th>
              <th className="py-3 px-4 font-semibold">Progress</th>
              <th className="py-3 px-4 font-semibold">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.document_id} className="border-b">
                <td className="py-3 px-4 font-medium">{r.document_name}</td>
                <td className="py-3 px-4 text-slate-500 capitalize">{r.category_slug?.replace(/-/g,' ')}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 max-w-xs h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className={`h-full ${r.pct>=80?"bg-emerald-500":r.pct>=50?"bg-amber-500":"bg-red-500"}`} style={{ width: `${r.pct}%` }}/>
                    </div>
                    <span className="text-xs text-slate-500">{r.completed} / {r.total}</span>
                  </div>
                </td>
                <td className="py-3 px-4 font-bold">{r.pct}%</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="4" className="py-10 text-center text-slate-400">No documents require acknowledgement yet. Open a document → Settings → "Requires Worker Acknowledgement".</td></tr>}
          </tbody>
        </table>
      </div>
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
  const [pendingAcks, setPendingAcks] = useState(0);

  useEffect(() => {
    const loadAcks = () => api.get('/acknowledgements/required').then(r => setPendingAcks(r.data?.length || 0)).catch(()=>{});
    loadAcks();
    const t = setInterval(loadAcks, 30000);
    return () => clearInterval(t);
  }, []);

  const tabs = [
    { id: "home", label: "Home", icon: Home },
    { id: "forms", label: "Forms", icon: FileText },
    { id: "action", label: "Action", icon: FileBadge, badge: pendingAcks },
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
        {tab === "home" && <WorkerHome user={user} onFill={setFillTemplate} goTo={setTab} pendingAcks={pendingAcks}/>}
        {tab === "forms" && <WorkerForms onFill={setFillTemplate}/>}
        {tab === "action" && <WorkerActions onCountChange={setPendingAcks}/>}
        {tab === "chat" && <Chat user={user}/>}
        {tab === "me" && <WorkerMe user={user}/>}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t shadow-lg flex justify-around z-30">
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 relative ${active ? "text-amber-600" : "text-slate-500"}`}
              data-testid={`mobile-nav-${t.id}`}>
              <div className="relative">
                <t.icon className={`w-5 h-5 ${active ? "scale-110" : ""} transition`}/>
                {t.badge > 0 && <span className="absolute -top-1.5 -right-2.5 bg-red-600 text-white text-[9px] font-black rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{t.badge}</span>}
              </div>
              <span className="text-[10px] font-bold mt-0.5">{t.label}</span>
            </button>
          );
        })}
      </nav>

      {fillTemplate && <FillForm template={fillTemplate} user={user} onClose={()=>setFillTemplate(null)}/>}
    </div>
  );
}

function WorkerActions({ onCountChange }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);
  const load = async () => {
    setLoading(true);
    const { data } = await api.get('/acknowledgements/required');
    setDocs(data); setLoading(false);
    onCountChange && onCountChange(data.length);
  };
  useEffect(() => { load(); }, []);

  const acknowledge = async (docId) => {
    await api.post('/acknowledgements', { document_id: docId });
    setViewing(null);
    load();
  };

  return (
    <div className="p-4 fadein">
      <h2 className="text-xl font-black mb-1">Action Required</h2>
      <p className="text-sm text-slate-500 mb-4">{docs.length} document{docs.length===1?"":"s"} need your acknowledgement</p>

      {loading ? (
        <div className="text-center py-10 text-slate-400 flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin"/>Loading…</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border-2 border-dashed">
          <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-400 mb-2"/>
          <div className="font-semibold text-slate-700">All caught up!</div>
          <div className="text-xs text-slate-500 mt-1">No documents need your acknowledgement.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map(d => {
            const info = FILE_ICONS[d.file_type] || FILE_ICONS.other;
            return (
              <button key={d.id} onClick={()=>setViewing(d)}
                className="w-full bg-white rounded-2xl p-4 border-2 border-purple-200 text-left active:scale-[0.98] transition shadow-sm" data-testid={`worker-ack-${d.id}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${info.color} flex-shrink-0`}>
                    <info.icon className="w-6 h-6"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-900">{d.name}</div>
                    {d.ai_summary && <div className="text-xs text-slate-500 line-clamp-2 mt-0.5">{d.ai_summary}</div>}
                    <div className="px-2 py-0.5 mt-2 inline-block rounded-full text-[10px] font-bold bg-purple-100 text-purple-700">Tap to read & acknowledge</div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-400"/>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {viewing && <WorkerAckModal doc={viewing} onAck={()=>acknowledge(viewing.id)} onClose={()=>setViewing(null)}/>}
    </div>
  );
}

function WorkerAckModal({ doc, onAck, onClose }) {
  const [full, setFull] = useState(null);
  const [acking, setAcking] = useState(false);
  useEffect(() => { api.get(`/documents/${doc.id}`).then(r => setFull(r.data)); }, [doc.id]);
  const info = FILE_ICONS[doc.file_type] || FILE_ICONS.other;
  const dataUrl = full?.content_b64;
  const handleAck = async () => { setAcking(true); await onAck(); };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end md:items-center justify-center fadein">
      <div className="bg-white w-full max-w-md rounded-t-3xl md:rounded-3xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${info.color}`}><info.icon className="w-5 h-5"/></div>
            <div className="min-w-0">
              <div className="font-bold truncate">{doc.name}</div>
              <div className="text-xs text-slate-500">{doc.ai_doc_type}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {doc.ai_summary && (
            <div className="p-4 bg-gradient-to-br from-amber-50 to-yellow-50 border-b">
              <h3 className="font-bold text-amber-900 text-sm mb-1 flex items-center gap-1"><Sparkles className="w-4 h-4"/>Summary</h3>
              <p className="text-sm text-slate-800">{doc.ai_summary}</p>
            </div>
          )}
          <div className="p-3">
            {!full ? <div className="text-center py-10 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mx-auto"/></div> :
              doc.file_type === "pdf" && dataUrl ? <iframe src={dataUrl} className="w-full h-[50vh] border rounded-lg" title={doc.name}/> :
              doc.file_type === "image" && dataUrl ? <img src={dataUrl} alt={doc.name} className="max-w-full mx-auto border rounded-lg"/> :
              doc.file_type === "txt" && dataUrl ? <pre className="text-xs bg-slate-50 p-3 rounded-lg border whitespace-pre-wrap">{atob(dataUrl.split(',')[1] || '')}</pre> :
              <div className="text-center py-8 bg-slate-50 rounded-lg border-2 border-dashed">
                <info.icon className="w-12 h-12 mx-auto text-slate-300 mb-2"/>
                <div className="text-sm text-slate-600">Open the document to read its contents</div>
                {dataUrl && <a href={dataUrl} download={doc.name} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-amber-600"><Download className="w-4 h-4"/>Download</a>}
              </div>
            }
          </div>
        </div>
        <div className="p-4 border-t bg-slate-50">
          <button onClick={handleAck} disabled={acking} className="w-full py-3.5 brand-grad text-black font-black rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition disabled:opacity-50" data-testid="worker-ack-btn">
            {acking ? <Loader2 className="w-5 h-5 animate-spin"/> : <CheckCircle2 className="w-5 h-5"/>}I HAVE READ AND UNDERSTOOD
          </button>
          <div className="text-[11px] text-center text-slate-400 mt-2">Your acknowledgement will be recorded with timestamp.</div>
        </div>
      </div>
    </div>
  );
}

function WorkerHome({ user, onFill, goTo, pendingAcks = 0 }) {
  const [templates, setTemplates] = useState([]);
  const [recentSubs, setRecentSubs] = useState([]);
  useEffect(() => {
    api.get("/forms/templates").then(r => setTemplates(r.data));
    api.get("/submissions").then(r => setRecentSubs(r.data.slice(0, 5)));
  }, []);

  return (
    <div className="p-4 space-y-5 fadein">
      {pendingAcks > 0 && (
        <button onClick={()=>goTo("action")} className="w-full brand-grad text-black rounded-2xl p-4 text-left shadow-lg active:scale-[0.98] transition" data-testid="worker-action-banner">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-black/10 rounded-xl flex items-center justify-center"><FileBadge className="w-7 h-7"/></div>
            <div className="flex-1">
              <div className="text-xs font-bold tracking-wider opacity-70">ACTION REQUIRED</div>
              <div className="font-black text-lg leading-tight">{pendingAcks} document{pendingAcks===1?"":"s"} to acknowledge</div>
            </div>
            <ChevronRight className="w-6 h-6"/>
          </div>
        </button>
      )}

      <div className="brand-grad-dark rounded-2xl p-5 text-white shadow-lg">
        <div className="text-xs font-bold tracking-widest text-amber-300">TODAY</div>
        <div className="text-2xl font-black mt-1">Stay Safe Out There</div>
        <p className="text-sm opacity-80 mt-1">Complete your toolbox talk and run your pre-use checks.</p>
        <button onClick={()=>goTo("forms")} className="mt-3 brand-grad text-black font-bold rounded-lg px-4 py-2 text-sm flex items-center gap-1.5">
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
// ===================== DOCUMENT LIBRARY =====================
const FILE_ICONS = {
  pdf: { icon: FileText, color: "text-red-600 bg-red-50" },
  docx: { icon: FileText, color: "text-blue-600 bg-blue-50" },
  xlsx: { icon: FileSpreadsheet, color: "text-emerald-600 bg-emerald-50" },
  pptx: { icon: FileType2, color: "text-orange-600 bg-orange-50" },
  image: { icon: ImageIcon, color: "text-purple-600 bg-purple-50" },
  txt: { icon: FileText, color: "text-slate-600 bg-slate-50" },
  other: { icon: FileText, color: "text-slate-500 bg-slate-50" },
};

function detectFileType(name, mime = "") {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx") || n.endsWith(".doc")) return "docx";
  if (n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".csv")) return "xlsx";
  if (n.endsWith(".pptx") || n.endsWith(".ppt")) return "pptx";
  if (/(png|jpe?g|webp|gif)$/.test(n)) return "image";
  if (n.endsWith(".txt") || n.endsWith(".md")) return "txt";
  if (mime?.startsWith("image/")) return "image";
  return "other";
}

function fmtSize(b) {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1024/1024).toFixed(1)} MB`;
}

function DocumentLibrary() {
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [search, setSearch] = useState("");
  const [aiSearch, setAiSearch] = useState("");
  const [aiResults, setAiResults] = useState(null);
  const [aiSearching, setAiSearching] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);

  const loadCats = () => api.get("/doc-categories").then(r => setCategories(r.data));
  useEffect(() => { loadCats(); }, []);

  const runAiSearch = async (e) => {
    e?.preventDefault();
    if (!aiSearch.trim()) { setAiResults(null); return; }
    setAiSearching(true);
    try {
      const { data } = await api.post("/documents/search/semantic", { query: aiSearch, top_k: 15 });
      setAiResults(data);
    } catch (e) { alert("Search failed: " + (e?.response?.data?.detail || e.message)); }
    setAiSearching(false);
  };

  if (activeCategory) {
    return <CategoryView category={activeCategory} onBack={()=>{setActiveCategory(null); loadCats();}}/>;
  }

  const filtered = search ? categories.filter(c => c.name.toLowerCase().includes(search.toLowerCase())) : categories;

  return (
    <div className="p-6 lg:p-8 fadein">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-amber-500"/>Document Library
          </h1>
          <p className="text-slate-500 mt-1">All your Risk & Compliance documents, organised and AI-tagged</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3"/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter folders…"
              className="pl-9 pr-3 py-2.5 border rounded-lg bg-white text-sm w-56"/>
          </div>
          <button onClick={()=>setShowUpload(true)}
            className="px-4 py-2.5 brand-grad text-black font-bold rounded-lg flex items-center gap-2"
            data-testid="bulk-upload-btn">
            <Upload className="w-4 h-4"/>Bulk Upload
          </button>
        </div>
      </div>

      {/* AI Smart Search */}
      <form onSubmit={runAiSearch} className="mb-6 bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-amber-600"/>
          <h3 className="font-bold text-amber-900">AI Smart Search</h3>
          <span className="text-xs text-amber-700">Ask in plain English — AI finds matching documents across all folders</span>
        </div>
        <div className="flex gap-2">
          <input value={aiSearch} onChange={e=>setAiSearch(e.target.value)}
            placeholder='e.g. "PPE requirements for working at heights" or "asbestos removal procedure"'
            className="flex-1 px-4 py-3 border-2 border-amber-200 rounded-xl bg-white focus:ring-2 focus:ring-amber-400 outline-none"
            data-testid="ai-search-input"/>
          <button type="submit" disabled={aiSearching} className="px-5 py-3 brand-grad text-black font-bold rounded-xl flex items-center gap-2 disabled:opacity-50" data-testid="ai-search-btn">
            {aiSearching ? <Loader2 className="w-4 h-4 animate-spin"/> : <Search className="w-4 h-4"/>}Search
          </button>
          {aiResults && <button type="button" onClick={()=>{setAiResults(null); setAiSearch("");}} className="px-3 py-3 bg-white border rounded-xl text-sm font-semibold">Clear</button>}
        </div>
      </form>

      {aiResults ? (
        <div className="space-y-2 mb-6">
          <div className="text-sm text-slate-600 mb-2">
            <b>{aiResults.results.length}</b> document{aiResults.results.length===1?"":"s"} found
            {aiResults.expanded_terms?.length > 0 && (
              <span className="ml-2">· AI expanded to: {aiResults.expanded_terms.slice(0,5).map((t,i)=>(<span key={i} className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-mono mx-0.5">{t}</span>))}</span>
            )}
          </div>
          {aiResults.results.map(d => <DocRow key={d.id} doc={d} onClick={()=>setSelectedDoc(d)}/>)}
          {aiResults.results.length === 0 && <div className="text-center text-slate-400 py-8">No matching documents.</div>}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {filtered.map(c => (
            <button key={c.id} onClick={()=>setActiveCategory(c)}
              className="bg-white rounded-2xl border p-5 text-left card-hover group active:scale-95 transition"
              data-testid={`doc-category-${c.slug}`}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-all group-hover:scale-110"
                   style={{ backgroundColor: c.color + "20", color: c.color }}>
                <Folder className="w-7 h-7" style={{ color: c.color }}/>
              </div>
              <div className="font-bold text-slate-900 text-sm leading-tight line-clamp-2">{c.name}</div>
              <div className="text-xs text-slate-400 mt-1">{c.doc_count || 0} file{c.doc_count===1?"":"s"}</div>
            </button>
          ))}
        </div>
      )}

      {selectedDoc && <DocViewer doc={selectedDoc} onClose={()=>{setSelectedDoc(null); loadCats();}} onDelete={async()=>{ if(window.confirm("Delete this document?")) { await api.delete(`/documents/${selectedDoc.id}`); setSelectedDoc(null); loadCats(); if(aiSearch) runAiSearch(); }}}/>}
      {showUpload && <BulkUploadModal categories={categories} onClose={()=>{setShowUpload(false); loadCats();}}/>}
    </div>
  );
}

function CategoryView({ category, onBack }) {
  const [docs, setDocs] = useState([]);
  const [subfolders, setSubfolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showNewSub, setShowNewSub] = useState(false);
  const [activeSub, setActiveSub] = useState(null); // {id, name} or null = root
  const [search, setSearch] = useState("");

  const loadSubfolders = () => api.get(`/subfolders?category=${category.slug}`).then(r => setSubfolders(r.data));
  const load = async () => {
    setLoading(true);
    const subParam = activeSub ? activeSub.id : 'root';
    const { data } = await api.get(`/documents?category=${category.slug}&subfolder=${subParam}`);
    setDocs(data); setLoading(false);
  };
  useEffect(() => { loadSubfolders(); }, [category.slug]);
  useEffect(() => { load(); }, [category.slug, activeSub?.id]);

  const createSubfolder = async (name) => {
    await api.post('/subfolders', { id: crypto.randomUUID(), category_slug: category.slug, name, color: category.color, created_at: new Date().toISOString() });
    setShowNewSub(false);
    loadSubfolders();
  };

  const filteredDocs = search ? docs.filter(d => `${d.name} ${d.ai_summary||''} ${(d.ai_tags||[]).join(' ')}`.toLowerCase().includes(search.toLowerCase())) : docs;

  return (
    <div className="p-6 lg:p-8 fadein">
      <div className="flex items-center gap-2 text-sm mb-3">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-900 flex items-center gap-1" data-testid="docs-back-btn">
          <ChevronLeft className="w-4 h-4"/>All folders
        </button>
        <ChevronRight className="w-3 h-3 text-slate-300"/>
        <button onClick={()=>setActiveSub(null)} className={`font-semibold ${activeSub ? 'text-slate-500 hover:text-slate-900' : 'text-slate-900'}`}>{category.name}</button>
        {activeSub && (<>
          <ChevronRight className="w-3 h-3 text-slate-300"/>
          <span className="font-semibold text-slate-900">{activeSub.name}</span>
        </>)}
      </div>

      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
               style={{ backgroundColor: category.color + "20" }}>
            <FolderOpen className="w-8 h-8" style={{ color: category.color }}/>
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900">{activeSub?.name || category.name}</h1>
            <p className="text-slate-500 mt-0.5">{docs.length} document{docs.length===1?"":"s"}{!activeSub && subfolders.length > 0 ? ` · ${subfolders.length} subfolder${subfolders.length===1?"":"s"}` : ""}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3"/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter…" className="pl-9 pr-3 py-2.5 border rounded-lg bg-white text-sm w-48"/>
          </div>
          {!activeSub && (
            <button onClick={()=>setShowNewSub(true)} className="px-4 py-2.5 bg-white border-2 border-slate-200 hover:border-amber-400 font-bold rounded-lg flex items-center gap-2 text-sm" data-testid="new-subfolder-btn">
              <FolderOpen className="w-4 h-4"/>New Subfolder
            </button>
          )}
          <button onClick={()=>setShowUpload(true)} className="px-4 py-2.5 brand-grad text-black font-bold rounded-lg flex items-center gap-2" data-testid="upload-to-category-btn">
            <Upload className="w-4 h-4"/>Upload Here
          </button>
        </div>
      </div>

      {/* Subfolders */}
      {!activeSub && subfolders.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-bold text-slate-500 tracking-widest mb-3">SUBFOLDERS</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {subfolders.map(s => (
              <button key={s.id} onClick={()=>setActiveSub(s)}
                className="bg-white rounded-xl border p-3 text-left card-hover group active:scale-95 transition" data-testid={`subfolder-${s.id}`}>
                <Folder className="w-6 h-6 mb-2" style={{ color: s.color || category.color }}/>
                <div className="font-bold text-slate-900 text-sm truncate">{s.name}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{s.doc_count || 0} files</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Documents */}
      <h3 className="text-xs font-bold text-slate-500 tracking-widest mb-3">DOCUMENTS</h3>
      {loading ? (
        <div className="text-center py-12 text-slate-400 flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin"/>Loading…</div>
      ) : filteredDocs.length === 0 ? (
        <div className="bg-white border-2 border-dashed rounded-2xl p-12 text-center">
          <FilePlus className="w-12 h-12 mx-auto text-slate-300 mb-3"/>
          <div className="text-slate-500 font-semibold">No documents here yet</div>
          <div className="text-xs text-slate-400 mt-1">Click "Upload Here" to add files</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredDocs.map(d => <DocRow key={d.id} doc={d} onClick={()=>setSelected(d)}/>)}
        </div>
      )}

      {selected && <DocViewer doc={selected} onClose={()=>{setSelected(null); load();}} onDelete={async()=>{ if(window.confirm("Delete this document?")) { await api.delete(`/documents/${selected.id}`); setSelected(null); load(); }}}/>}
      {showUpload && <BulkUploadModal categories={[category]} defaultCategory={category.slug} defaultSubfolder={activeSub?.id} onClose={()=>{setShowUpload(false); load();}}/>}
      {showNewSub && <NewSubfolderModal onClose={()=>setShowNewSub(false)} onCreate={createSubfolder}/>}
    </div>
  );
}

function DocRow({ doc, onClick }) {
  const info = FILE_ICONS[doc.file_type] || FILE_ICONS.other;
  // Status badges
  const today = new Date();
  let expiryBadge = null;
  if (doc.expiry_date) {
    const d = new Date(doc.expiry_date);
    const days = Math.floor((d - today)/86400000);
    if (days < 0) expiryBadge = <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 flex items-center gap-1"><AlertOctagon className="w-3 h-3"/>Expired {-days}d ago</span>;
    else if (days <= 30) expiryBadge = <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700 flex items-center gap-1"><Clock className="w-3 h-3"/>Expires in {days}d</span>;
  }
  let reviewBadge = null;
  if (doc.review_date && !expiryBadge) {
    const d = new Date(doc.review_date);
    const days = Math.floor((d - today)/86400000);
    if (days < 0) reviewBadge = <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">Review overdue</span>;
    else if (days <= 30) reviewBadge = <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">Review in {days}d</span>;
  }

  return (
    <button onClick={onClick}
      className="w-full bg-white rounded-xl border p-4 flex items-center gap-4 hover:shadow-md hover:border-amber-300 transition text-left"
      data-testid={`doc-row-${doc.id}`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${info.color} flex-shrink-0`}>
        <info.icon className="w-6 h-6"/>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-slate-900 truncate flex items-center gap-2">
          {doc.name}
          {doc.version > 1 && <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">v{doc.version}</span>}
        </div>
        {doc.ai_summary && <div className="text-xs text-slate-500 line-clamp-2 mt-0.5">{doc.ai_summary}</div>}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {doc.ai_doc_type && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">{doc.ai_doc_type}</span>}
          {expiryBadge}
          {reviewBadge}
          {doc.requires_ack && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 flex items-center gap-1"><FileBadge className="w-3 h-3"/>Requires Ack</span>}
          {(doc.ai_tags || []).slice(0, 3).map((t,i) => (
            <span key={i} className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">#{t}</span>
          ))}
          {doc.is_form && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 flex items-center gap-1"><FileCheck className="w-3 h-3"/>Form</span>}
          {doc.source === "dropbox" && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">↻ Dropbox</span>}
        </div>
      </div>
      <div className="text-xs text-slate-400 text-right flex-shrink-0">
        <div className="font-mono uppercase">{doc.file_type}</div>
        <div>{fmtSize(doc.size_bytes)}</div>
      </div>
    </button>
  );
}

function NewSubfolderModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6">
        <h2 className="text-2xl font-bold mb-4">New Subfolder</h2>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Subfolder name" className="w-full px-3 py-2.5 border rounded-lg" data-testid="subfolder-name-input"/>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
          <button onClick={()=>onCreate(name)} disabled={!name.trim()} className="px-5 py-2 brand-grad text-black font-bold rounded-lg disabled:opacity-50" data-testid="save-subfolder-btn">Create</button>
        </div>
      </div>
    </div>
  );
}

function DocViewer({ doc, onClose, onDelete }) {
  const [full, setFull] = useState(null);
  const [versions, setVersions] = useState({ current: null, history: [] });
  const [acks, setAcks] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [tab, setTab] = useState("preview"); // preview | versions | settings
  const [convertingForm, setConvertingForm] = useState(false);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const versionFileRef = useRef(null);

  const loadAll = () => {
    api.get(`/documents/${doc.id}`).then(r => setFull(r.data));
    api.get(`/documents/${doc.id}/versions`).then(r => setVersions(r.data)).catch(()=>{});
    api.get(`/acknowledgements/document/${doc.id}`).then(r => setAcks(r.data)).catch(()=>{});
    api.get('/workers').then(r => setWorkers(r.data)).catch(()=>{});
  };
  useEffect(() => { loadAll(); }, [doc.id]);

  const convertToTemplate = async () => {
    setConvertingForm(true);
    try {
      await api.post(`/documents/${doc.id}/to-template`);
      alert("✓ Created a fillable form template. Check the Forms section.");
    } catch (e) { alert("Failed: " + (e?.response?.data?.detail || e.message)); }
    setConvertingForm(false);
  };

  const uploadVersion = async (file, changeNote) => {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    await api.post(`/documents/${doc.id}/new-version`, {
      name: file.name,
      content_b64: b64,
      file_type: detectFileType(file.name, file.type),
      mime_type: file.type,
      size_bytes: file.size,
      change_note: changeNote,
    });
    setShowNewVersion(false);
    loadAll();
  };

  const info = FILE_ICONS[doc.file_type] || FILE_ICONS.other;
  const dataUrl = full?.content_b64;
  const tabs = [
    { id: "preview", label: "Preview", icon: Eye },
    { id: "versions", label: `Versions (${1 + (versions.history?.length || 0)})`, icon: Clock },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 fadein">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="border-b p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${info.color} flex-shrink-0`}>
              <info.icon className="w-6 h-6"/>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-slate-900 truncate flex items-center gap-2">
                {doc.name}
                {full?.version > 1 && <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">v{full.version}</span>}
              </div>
              <div className="text-xs text-slate-500">{doc.ai_doc_type || "Document"} · {fmtSize(doc.size_bytes)} · Uploaded {new Date(doc.created_at).toLocaleDateString()}{doc.uploaded_by ? ` by ${doc.uploaded_by}` : ""}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {full?.is_form && (
              <button onClick={convertToTemplate} disabled={convertingForm}
                className="px-3 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg flex items-center gap-2 disabled:opacity-50"
                data-testid="to-template-btn">
                {convertingForm ? <Loader2 className="w-4 h-4 animate-spin"/> : <FilePlus className="w-4 h-4"/>}
                To Form Template
              </button>
            )}
            {dataUrl && (
              <a href={dataUrl} download={doc.name} className="px-3 py-2 bg-slate-900 text-white text-sm font-bold rounded-lg flex items-center gap-2">
                <Download className="w-4 h-4"/>Download
              </a>
            )}
            <button onClick={onDelete} className="p-2 text-red-500 hover:bg-red-50 rounded-lg" title="Delete"><Trash2 className="w-4 h-4"/></button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b flex gap-1 px-3 bg-slate-50">
          {tabs.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-semibold flex items-center gap-2 border-b-2 -mb-px ${tab===t.id?"border-amber-400 text-slate-900":"border-transparent text-slate-500 hover:text-slate-700"}`}
              data-testid={`docviewer-tab-${t.id}`}>
              <t.icon className="w-4 h-4"/>{t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "preview" && (
            <>
              {(doc.ai_summary || (doc.ai_tags && doc.ai_tags.length > 0)) && (
                <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border-b-2 border-amber-200 p-5">
                  <h3 className="font-bold text-amber-900 flex items-center gap-2 mb-2"><Sparkles className="w-5 h-5"/>AI Insights</h3>
                  {doc.ai_summary && <p className="text-sm text-slate-800 whitespace-pre-wrap">{doc.ai_summary}</p>}
                  {doc.ai_tags && doc.ai_tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {doc.ai_tags.map((t,i)=>(<span key={i} className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white border border-amber-200 text-amber-800">#{t}</span>))}
                    </div>
                  )}
                  {full?.is_form && full.extracted_fields?.length > 0 && (
                    <div className="mt-4 bg-white/70 rounded-lg p-3 border border-amber-200">
                      <div className="text-xs font-bold text-amber-900 mb-2">EXTRACTED FORM FIELDS ({full.extracted_fields.length})</div>
                      <div className="grid grid-cols-2 gap-1.5 text-xs">
                        {full.extracted_fields.map((f, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-slate-700">
                            <span className="text-slate-400">•</span>
                            <span className="font-medium">{f.label}</span>
                            <span className="text-slate-400 font-mono text-[10px]">{f.type}</span>
                            {f.required && <span className="text-red-500">*</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Expiry / Review banner */}
              {(full?.expiry_date || full?.review_date || full?.requires_ack) && (
                <div className="p-4 border-b bg-slate-50 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  {full?.expiry_date && (
                    <div>
                      <div className="text-xs text-slate-500 font-semibold tracking-wider">EXPIRES</div>
                      <div className="font-bold text-slate-900">{new Date(full.expiry_date).toLocaleDateString()}</div>
                    </div>
                  )}
                  {full?.review_date && (
                    <div>
                      <div className="text-xs text-slate-500 font-semibold tracking-wider">REVIEW BY</div>
                      <div className="font-bold text-slate-900">{new Date(full.review_date).toLocaleDateString()}{full?.review_frequency_months ? ` (every ${full.review_frequency_months}mo)` : ""}</div>
                    </div>
                  )}
                  {full?.requires_ack && (
                    <div>
                      <div className="text-xs text-slate-500 font-semibold tracking-wider">ACKNOWLEDGEMENTS</div>
                      <div className="font-bold text-slate-900">{acks.length} signed</div>
                    </div>
                  )}
                </div>
              )}

              {/* File preview */}
              <div className="p-4">
                {!full ? (
                  <div className="flex items-center justify-center py-20 text-slate-400"><Loader2 className="w-6 h-6 animate-spin"/></div>
                ) : doc.file_type === "pdf" && dataUrl ? (
                  <iframe src={dataUrl} className="w-full h-[55vh] border rounded-lg" title={doc.name}/>
                ) : doc.file_type === "image" && dataUrl ? (
                  <img src={dataUrl} alt={doc.name} className="max-w-full max-h-[55vh] mx-auto border rounded-lg"/>
                ) : doc.file_type === "txt" && dataUrl ? (
                  <pre className="text-xs bg-slate-50 p-4 rounded-lg border whitespace-pre-wrap max-h-[55vh] overflow-y-auto">{atob(dataUrl.split(',')[1] || '')}</pre>
                ) : (
                  <div className="text-center py-12 bg-slate-50 rounded-lg border-2 border-dashed">
                    <info.icon className="w-16 h-16 mx-auto text-slate-300 mb-3"/>
                    <div className="font-semibold text-slate-700">{doc.file_type.toUpperCase()} preview not supported inline</div>
                    <div className="text-sm text-slate-500 mt-1">Click "Download" to open this file</div>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "versions" && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Version History</h3>
                <button onClick={()=>versionFileRef.current?.click()} className="px-3 py-2 brand-grad text-black text-sm font-bold rounded-lg flex items-center gap-2" data-testid="new-version-btn">
                  <Upload className="w-4 h-4"/>Upload New Version
                </button>
                <input ref={versionFileRef} type="file" className="hidden" onChange={async e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const note = window.prompt("What changed in this version? (optional)") || "";
                  await uploadVersion(f, note);
                }}/>
              </div>
              <div className="space-y-2">
                {/* Current */}
                {versions.current && (
                  <div className="border-2 border-emerald-300 bg-emerald-50/30 rounded-xl p-3 flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center"><CheckCircle2 className="w-5 h-5 text-emerald-600"/></div>
                    <div className="flex-1">
                      <div className="font-bold flex items-center gap-2">v{versions.current.version} <span className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-bold">CURRENT</span></div>
                      <div className="text-xs text-slate-500">{new Date(versions.current.created_at).toLocaleString()} · {fmtSize(versions.current.size_bytes)}{versions.current.uploaded_by ? ` · ${versions.current.uploaded_by}` : ""}</div>
                      {versions.current.description && <div className="text-xs text-slate-600 mt-1 italic">"{versions.current.description}"</div>}
                    </div>
                  </div>
                )}
                {/* History */}
                {(versions.history || []).map(v => (
                  <div key={v.id} className="border rounded-xl p-3 flex items-center gap-3 bg-white">
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center"><Clock className="w-5 h-5 text-slate-500"/></div>
                    <div className="flex-1">
                      <div className="font-bold text-slate-700">v{v.version}</div>
                      <div className="text-xs text-slate-500">{new Date(v.created_at).toLocaleString()} · {fmtSize(v.size_bytes)}{v.uploaded_by ? ` · ${v.uploaded_by}` : ""}</div>
                      {v.description && <div className="text-xs text-slate-600 mt-1 italic">"{v.description}"</div>}
                    </div>
                  </div>
                ))}
                {(versions.history?.length || 0) === 0 && <div className="text-center text-sm text-slate-400 py-4">No previous versions yet.</div>}
              </div>
            </div>
          )}

          {tab === "settings" && (
            <DocSettings doc={full || doc} workers={workers} onSaved={loadAll}/>
          )}
        </div>
      </div>
    </div>
  );
}

function DocSettings({ doc, workers, onSaved }) {
  const [name, setName] = useState(doc.name || "");
  const [expiryDate, setExpiryDate] = useState(doc.expiry_date || "");
  const [reviewDate, setReviewDate] = useState(doc.review_date || "");
  const [reviewMonths, setReviewMonths] = useState(doc.review_frequency_months || "");
  const [requiresAck, setRequiresAck] = useState(!!doc.requires_ack);
  const [assignees, setAssignees] = useState(doc.ack_assignee_ids || []);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/documents/${doc.id}`, {
        name,
        expiry_date: expiryDate || null,
        review_date: reviewDate || null,
        review_frequency_months: reviewMonths ? Number(reviewMonths) : null,
        requires_ack: requiresAck,
        ack_assignee_ids: assignees,
      });
      setSavedAt(Date.now());
      onSaved && onSaved();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  const toggleAssignee = (id) => setAssignees(assignees.includes(id) ? assignees.filter(x=>x!==id) : [...assignees, id]);

  return (
    <div className="p-5 space-y-5 max-w-2xl">
      <div>
        <label className="block text-sm font-semibold mb-1.5">Document Name</label>
        <input value={name} onChange={e=>setName(e.target.value)} className="w-full px-3 py-2.5 border rounded-lg"/>
      </div>

      <div className="border rounded-xl p-4 bg-slate-50">
        <h4 className="font-bold text-slate-900 mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500"/>Expiry & Review</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Expiry Date</label>
            <input type="date" value={expiryDate?.slice(0,10) || ""} onChange={e=>setExpiryDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white" data-testid="doc-expiry-date"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Review-by Date</label>
            <input type="date" value={reviewDate?.slice(0,10) || ""} onChange={e=>setReviewDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white" data-testid="doc-review-date"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Review every (months)</label>
            <input type="number" value={reviewMonths} onChange={e=>setReviewMonths(e.target.value)} placeholder="e.g. 12" className="w-full px-3 py-2 border rounded-lg bg-white"/>
          </div>
        </div>
      </div>

      <div className="border rounded-xl p-4 bg-slate-50">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={requiresAck} onChange={e=>setRequiresAck(e.target.checked)} className="w-5 h-5 mt-0.5" data-testid="doc-requires-ack"/>
          <div>
            <div className="font-bold text-slate-900 flex items-center gap-2"><FileBadge className="w-4 h-4 text-purple-500"/>Requires Worker Acknowledgement</div>
            <div className="text-xs text-slate-500">Workers will see this in their "Action Required" list and must tap "I have read and understood".</div>
          </div>
        </label>
        {requiresAck && (
          <div className="mt-4">
            <label className="block text-xs font-semibold text-slate-600 mb-2">Assign to specific workers (leave empty = all workers)</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto bg-white border rounded-lg p-2">
              {workers.map(w => (
                <label key={w.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer text-sm">
                  <input type="checkbox" checked={assignees.includes(w.id)} onChange={()=>toggleAssignee(w.id)}/>
                  <span className="truncate">{w.name}</span>
                </label>
              ))}
            </div>
            <div className="text-xs text-slate-500 mt-2">{assignees.length === 0 ? "All workers" : `${assignees.length} workers selected`}</div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-5 py-2.5 brand-grad text-black font-bold rounded-lg flex items-center gap-2 disabled:opacity-50" data-testid="save-doc-settings-btn">
          {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}Save
        </button>
        {savedAt && <span className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/>Saved</span>}
      </div>
    </div>
  );
}

function BulkUploadModal({ categories, defaultCategory, defaultSubfolder, onClose }) {
  const [queue, setQueue] = useState([]); // [{file, status, doc, error, category}]
  const [aiClassify, setAiClassify] = useState(true);
  const [forceCategory, setForceCategory] = useState(defaultCategory || "");
  const [overall, setOverall] = useState({ done: 0, total: 0 });
  const inputRef = useRef(null);

  const onFiles = (files) => {
    const arr = Array.from(files || []);
    setQueue(prev => [...prev, ...arr.map(f => ({ file: f, status: "pending", error: null, doc: null }))]);
  };

  const fileToB64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const upload = async () => {
    setOverall({ done: 0, total: queue.length });
    const newQueue = [...queue];
    for (let i = 0; i < newQueue.length; i++) {
      if (newQueue[i].status === "done") { setOverall(o => ({...o, done: o.done+1})); continue; }
      newQueue[i].status = "uploading";
      setQueue([...newQueue]);
      try {
        const f = newQueue[i].file;
        const b64 = await fileToB64(f);
        const fileType = detectFileType(f.name, f.type);

        let classification = {
          category_slug: forceCategory || "uncategorized",
          doc_type: "Other",
          summary: "",
          tags: [],
          is_form: false,
          extracted_fields: [],
        };

        if (aiClassify) {
          newQueue[i].status = "classifying";
          setQueue([...newQueue]);
          try {
            const { data } = await api.post("/ai/classify-document", {
              filename: f.name,
              content_b64: b64,
              file_type: fileType,
            }, { timeout: 60000 });
            classification = { ...classification, ...data };
            // Honor manual override if set
            if (forceCategory) classification.category_slug = forceCategory;
          } catch (e) {
            console.warn("Classify failed for", f.name, e);
          }
        }

        newQueue[i].status = "saving";
        setQueue([...newQueue]);

        const payload = {
          id: crypto.randomUUID(),
          name: f.name,
          category_slug: classification.category_slug,
          subfolder_id: defaultSubfolder || null,
          file_type: fileType,
          mime_type: f.type,
          size_bytes: f.size,
          content_b64: b64,
          ai_summary: classification.summary,
          ai_tags: classification.tags || [],
          ai_doc_type: classification.doc_type,
          is_form: !!classification.is_form,
          extracted_fields: classification.extracted_fields || [],
        };
        const { data: saved } = await api.post("/documents", payload);
        newQueue[i].status = "done";
        newQueue[i].doc = saved;
      } catch (e) {
        newQueue[i].status = "error";
        newQueue[i].error = e?.response?.data?.detail || e.message;
      }
      setQueue([...newQueue]);
      setOverall(o => ({...o, done: o.done+1}));
    }
  };

  const remove = (i) => setQueue(queue.filter((_,j)=>j!==i));
  const clearDone = () => setQueue(queue.filter(q => q.status !== "done"));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 fadein">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="border-b p-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><Upload className="w-6 h-6 text-amber-500"/>Bulk Upload Documents</h2>
            <p className="text-sm text-slate-500 mt-0.5">AI will auto-classify and tag each file</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
        </div>

        <div className="p-5 border-b bg-slate-50 flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
            <input type="checkbox" checked={aiClassify} onChange={e=>setAiClassify(e.target.checked)} className="w-4 h-4"/>
            <Sparkles className="w-4 h-4 text-amber-500"/>AI Auto-Classify (recommended)
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Force category:</span>
            <select value={forceCategory} onChange={e=>setForceCategory(e.target.value)} className="px-2 py-1 border rounded text-sm bg-white">
              <option value="">Auto (AI decides)</option>
              {categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Drop zone */}
        <div className="p-5 border-b">
          <label
            onDragOver={e=>{e.preventDefault();}}
            onDrop={e=>{e.preventDefault(); onFiles(e.dataTransfer.files);}}
            className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl py-10 cursor-pointer hover:border-amber-400 hover:bg-amber-50/30 transition">
            <Upload className="w-10 h-10 text-slate-400 mb-2"/>
            <div className="font-bold text-slate-700">Drag & drop files here</div>
            <div className="text-sm text-slate-500 mt-1">or click to browse · PDF, DOCX, XLSX, images, txt</div>
            <input ref={inputRef} type="file" multiple onChange={e=>onFiles(e.target.files)} className="hidden" data-testid="bulk-upload-input"/>
          </label>
        </div>

        {/* Queue */}
        <div className="flex-1 overflow-y-auto p-5">
          {queue.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-6">No files queued yet.</div>
          ) : (
            <div className="space-y-2">
              {queue.map((q, i) => {
                const info = FILE_ICONS[detectFileType(q.file.name)] || FILE_ICONS.other;
                return (
                  <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-lg p-3 border">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${info.color} flex-shrink-0`}>
                      <info.icon className="w-5 h-5"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{q.file.name}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-2">
                        {fmtSize(q.file.size)}
                        {q.doc?.ai_doc_type && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{q.doc.ai_doc_type}</span>}
                        {q.doc?.category_slug && <span className="text-slate-400">→ {q.doc.category_slug}</span>}
                      </div>
                    </div>
                    <div className="text-xs font-bold flex-shrink-0">
                      {q.status === "pending" && <span className="text-slate-400">Queued</span>}
                      {q.status === "uploading" && <span className="text-blue-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/>Reading</span>}
                      {q.status === "classifying" && <span className="text-amber-600 flex items-center gap-1"><Sparkles className="w-3 h-3 animate-pulse"/>AI Classify</span>}
                      {q.status === "saving" && <span className="text-blue-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/>Saving</span>}
                      {q.status === "done" && <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/>Done</span>}
                      {q.status === "error" && <span className="text-red-600" title={q.error}>Error</span>}
                    </div>
                    {q.status !== "done" && q.status !== "uploading" && q.status !== "classifying" && q.status !== "saving" && (
                      <button onClick={()=>remove(i)} className="p-1 text-slate-400 hover:text-red-500"><X className="w-4 h-4"/></button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t p-4 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            {queue.length > 0 && <span><b>{queue.filter(q=>q.status==='done').length}</b> / {queue.length} uploaded · {queue.filter(q=>q.status==='error').length} errors</span>}
          </div>
          <div className="flex gap-2">
            {queue.some(q=>q.status==='done') && <button onClick={clearDone} className="px-3 py-2 border rounded-lg text-sm">Clear done</button>}
            <button onClick={onClose} className="px-3 py-2 border rounded-lg text-sm">Close</button>
            <button onClick={upload} disabled={queue.length === 0 || queue.every(q=>q.status==='done')}
              className="px-5 py-2 brand-grad text-black font-bold rounded-lg flex items-center gap-2 disabled:opacity-50"
              data-testid="start-upload-btn">
              <Upload className="w-4 h-4"/>Upload {queue.filter(q=>q.status!=='done').length} files
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}




function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pt_user")); } catch { return null; }
  });
  const [view, setView] = useState("dashboard");
  const [submissionFilter, setSubmissionFilter] = useState("all");
  const goTo = (target, filter) => {
    if (filter !== undefined && filter !== null) setSubmissionFilter(filter);
    setView(target);
  };
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
    { id: "clients", label: "Clients", icon: Briefcase },
    { id: "tasks", label: "Tasks", icon: ListChecks },
    { id: "notes", label: "Notes", icon: StickyNote },
    { id: "locations", label: "Job Sites", icon: MapPin },
    { id: "certifications", label: "Certifications", icon: Award },
    { id: "documents", label: "Documents", icon: BookOpen },
    { id: "integrations", label: "Integrations", icon: Briefcase },
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
        {view === "dashboard" && <Dashboard goTo={goTo}/>}
        {view === "templates" && <Templates user={user} onFill={setFillTemplate}/>}
        {view === "submissions" && <Submissions initialFilter={submissionFilter}/>}
        {view === "chat" && <Chat user={user}/>}
        {view === "workers" && <Workers/>}
        {view === "clients" && <ClientsPage/>}
        {view === "tasks" && <TasksPage/>}
        {view === "notes" && <NotesPage/>}
        {view === "locations" && <Locations/>}
        {view === "certifications" && <Certifications/>}
        {view === "documents" && <DocumentLibrary/>}
        {view === "integrations" && <IntegrationsPage/>}
        {view === "settings" && <SettingsPage user={user}/>}
      </main>

      {fillTemplate && <FillForm template={fillTemplate} user={user} onClose={()=>setFillTemplate(null)}/>}
    </div>
  );
}

export default App;
