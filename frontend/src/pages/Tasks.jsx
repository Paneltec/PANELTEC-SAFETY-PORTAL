import React, { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Trash2, X, Loader2, ListChecks, Edit3, ArrowRight, CheckCircle2, Clock, AlertOctagon, Calendar } from "lucide-react";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem("pt_token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

const STATUS_META = {
  open: { label: "Open", color: "bg-slate-100 text-slate-700", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700", icon: Clock },
  done: { label: "Done", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  blocked: { label: "Blocked", color: "bg-red-100 text-red-700", icon: AlertOctagon },
};
const PRIORITY_META = {
  low: { color: "text-slate-500" },
  medium: { color: "text-amber-600" },
  high: { color: "text-orange-600" },
  critical: { color: "text-red-600" },
};

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [clients, setClients] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [filter, setFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (clientFilter) q.set("client_id", clientFilter);
    if (filter !== "all") q.set("status", filter);
    const { data } = await api.get(`/tasks?${q.toString()}`);
    setTasks(data); setLoading(false);
  };
  useEffect(() => {
    api.get("/clients").then(r => setClients(r.data));
    api.get("/workers").then(r => setWorkers(r.data));
  }, []);
  useEffect(() => { load(); }, [filter, clientFilter]);

  const cycleStatus = async (t) => {
    const next = { open: "in_progress", in_progress: "done", done: "open", blocked: "open" }[t.status] || "open";
    await api.post(`/tasks/${t.id}/status`, { status: next });
    load();
  };

  const counts = {
    all: tasks.length,
    open: tasks.filter(t=>t.status==="open").length,
    in_progress: tasks.filter(t=>t.status==="in_progress").length,
    done: tasks.filter(t=>t.status==="done").length,
    blocked: tasks.filter(t=>t.status==="blocked").length,
  };

  return (
    <div className="fadein">
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">Task Management</h1>
        <button onClick={()=>{setEditing(null); setShowAdd(true);}}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-sm flex items-center gap-2"
          data-testid="new-task-btn">
          <Plus className="w-4 h-4"/>ADD NEW
        </button>
      </div>

      <div className="px-6 py-4 flex items-center justify-end gap-2 flex-wrap">
        <div className="flex gap-1">
          {["all","open","in_progress","done","blocked"].map(s => (
            <button key={s} onClick={()=>setFilter(s)} className={`px-3 py-1.5 rounded text-xs font-bold ${filter===s?"bg-slate-900 text-white":"bg-white border"}`} data-testid={`task-filter-${s}`}>
              {s.replace("_"," ")} ({counts[s]||0})
            </button>
          ))}
        </div>
        <select value={clientFilter} onChange={e=>setClientFilter(e.target.value)} className="px-3 py-2 border rounded text-sm bg-white">
          <option value="">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="px-6 pb-6">
        {loading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline"/></div>
        ) : tasks.length === 0 ? (
          <div className="bg-white border-2 border-dashed rounded-lg py-12 text-center text-slate-400">No tasks found.</div>
        ) : (
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-700 text-white">
                <tr>
                  <th className="py-3 px-4 text-left">Title</th>
                  <th className="py-3 px-4 text-left">Client</th>
                  <th className="py-3 px-4 text-left">Assignee</th>
                  <th className="py-3 px-4 text-left">Priority</th>
                  <th className="py-3 px-4 text-left">Due</th>
                  <th className="py-3 px-4 text-left">Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, idx) => {
                  const meta = STATUS_META[t.status] || STATUS_META.open;
                  const prio = PRIORITY_META[t.priority] || PRIORITY_META.medium;
                  return (
                    <tr key={t.id} className={`border-b hover:bg-slate-50 ${idx%2===1?"bg-slate-50/30":""}`} data-testid={`task-row-${t.id}`}>
                      <td className="py-3 px-4">
                        <div className="font-bold">{t.title}</div>
                        {t.description && <div className="text-xs text-slate-500 line-clamp-1">{t.description}</div>}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{t.client_name || "—"}</td>
                      <td className="py-3 px-4 text-slate-600">{t.assignee_name || "—"}</td>
                      <td className={`py-3 px-4 font-bold uppercase text-xs ${prio.color}`}>{t.priority}</td>
                      <td className="py-3 px-4 text-slate-500 text-xs">{t.due_date ? new Date(t.due_date).toLocaleDateString() : "—"}</td>
                      <td className="py-3 px-4">
                        <button onClick={()=>cycleStatus(t)} className={`px-2 py-1 rounded text-xs font-bold capitalize flex items-center gap-1 ${meta.color}`} data-testid={`task-status-${t.id}`}>
                          <meta.icon className="w-3 h-3"/>{meta.label}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex justify-center gap-1">
                          <button onClick={()=>{setEditing(t); setShowAdd(true);}} className="w-8 h-8 bg-sky-400 hover:bg-sky-500 text-white rounded flex items-center justify-center"><Edit3 className="w-4 h-4"/></button>
                          <button onClick={async()=>{ if(window.confirm("Delete?")){ await api.delete(`/tasks/${t.id}`); load();}}} className="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded flex items-center justify-center"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <TaskEditorModal editing={editing} clients={clients} workers={workers} onClose={()=>{setShowAdd(false); load();}}/>}
    </div>
  );
}

function TaskEditorModal({ editing, clients, workers, onClose }) {
  const [t, setT] = useState(editing || { title: "", description: "", client_id: "", assignee_id: "", priority: "medium", status: "open", due_date: "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...t,
        id: editing?.id || crypto.randomUUID(),
        client_id: t.client_id || null,
        assignee_id: t.assignee_id || null,
        due_date: t.due_date || null,
        created_at: editing?.created_at || new Date().toISOString(),
      };
      if (editing) await api.put(`/tasks/${editing.id}`, payload);
      else await api.post("/tasks", payload);
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{editing ? "Edit Task" : "Add Task"}</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-1">Title <span className="text-red-500">*</span></label>
            <input value={t.title} onChange={e=>setT({...t,title:e.target.value})} className="w-full px-3 py-2 border rounded" data-testid="task-title-input"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Description</label>
            <textarea value={t.description||""} onChange={e=>setT({...t,description:e.target.value})} rows="3" className="w-full px-3 py-2 border rounded"/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-semibold mb-1">Client</label>
              <select value={t.client_id||""} onChange={e=>setT({...t,client_id:e.target.value})} className="w-full px-3 py-2 border rounded">
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Assignee</label>
              <select value={t.assignee_id||""} onChange={e=>setT({...t,assignee_id:e.target.value})} className="w-full px-3 py-2 border rounded">
                <option value="">— None —</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Priority</label>
              <select value={t.priority} onChange={e=>setT({...t,priority:e.target.value})} className="w-full px-3 py-2 border rounded">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Status</label>
              <select value={t.status} onChange={e=>setT({...t,status:e.target.value})} className="w-full px-3 py-2 border rounded">
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Due Date</label>
            <input type="date" value={t.due_date||""} onChange={e=>setT({...t,due_date:e.target.value})} className="w-full px-3 py-2 border rounded"/>
          </div>
        </div>
        <div className="border-t p-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={save} disabled={!t.title || saving} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded flex items-center gap-2 disabled:opacity-50" data-testid="save-task-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}Save
          </button>
        </div>
      </div>
    </div>
  );
}
