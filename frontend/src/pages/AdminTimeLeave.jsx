import React, { useEffect, useState } from "react";
import axios from "axios";
import { Clock, CheckCircle2, X, AlertOctagon, Loader2, ArrowRight, FileText, Calendar, Search } from "lucide-react";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem("pt_token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtMins = (m) => {
  if (!m) return "0h 0m";
  return `${Math.floor(m/60)}h ${m%60}m`;
};

// ============== ADMIN TIME SHEET ==============
export function AdminTimeSheetPage() {
  const [entries, setEntries] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [workerFilter, setWorkerFilter] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (workerFilter) q.set("worker_id", workerFilter);
    if (filter !== "all") q.set("status", filter);
    const { data } = await api.get(`/timesheets?${q.toString()}`);
    setEntries(data); setLoading(false);
  };
  useEffect(() => { api.get("/workers").then(r => setWorkers(r.data)); }, []);
  useEffect(() => { load(); }, [filter, workerFilter]);

  const approve = async (id, approved) => {
    await api.post(`/timesheets/${id}/approve`, { approved });
    load();
  };

  const filtered = search ? entries.filter(e => `${e.worker_name||''} ${e.client_name||''} ${e.work_type_name||''}`.toLowerCase().includes(search.toLowerCase())) : entries;
  const counts = {
    all: entries.length,
    open: entries.filter(e=>e.status==='open').length,
    submitted: entries.filter(e=>e.status==='submitted').length,
    approved: entries.filter(e=>e.status==='approved').length,
    rejected: entries.filter(e=>e.status==='rejected').length,
  };

  return (
    <div className="fadein">
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">Time Sheets</h1>
      </div>

      <div className="px-6 py-4 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {["all","open","submitted","approved","rejected"].map(s => (
            <button key={s} onClick={()=>setFilter(s)} className={`px-3 py-1.5 rounded text-xs font-bold capitalize ${filter===s?"bg-slate-900 text-white":"bg-white border"}`}>
              {s} ({counts[s]||0})
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select value={workerFilter} onChange={e=>setWorkerFilter(e.target.value)} className="px-3 py-2 border rounded text-sm bg-white">
            <option value="">All Workers</option>
            {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" className="px-3 py-2 border rounded text-sm w-56"/>
        </div>
      </div>

      <div className="px-6 pb-8">
        {loading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline"/></div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border-2 border-dashed rounded-lg py-12 text-center text-slate-400">No time entries found.</div>
        ) : (
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-700 text-white">
                <tr>
                  <th className="py-3 px-4 text-left">Date</th>
                  <th className="py-3 px-4 text-left">Worker</th>
                  <th className="py-3 px-4 text-left">Times</th>
                  <th className="py-3 px-4 text-left">Total / Paid</th>
                  <th className="py-3 px-4 text-left">Work Type</th>
                  <th className="py-3 px-4 text-left">Client</th>
                  <th className="py-3 px-4 text-left">Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, idx) => {
                  const statusColor = {
                    open: 'bg-slate-100 text-slate-700',
                    submitted: 'bg-blue-100 text-blue-700',
                    approved: 'bg-emerald-100 text-emerald-700',
                    rejected: 'bg-red-100 text-red-700',
                  }[e.status] || 'bg-slate-100';
                  return (
                    <tr key={e.id} className={`border-b hover:bg-slate-50 ${idx%2===1?"bg-slate-50/30":""}`}>
                      <td className="py-3 px-4 font-medium">{e.entry_date}</td>
                      <td className="py-3 px-4">{e.worker_name}</td>
                      <td className="py-3 px-4 text-xs text-slate-600">{fmtTime(e.clock_in)} - {fmtTime(e.clock_out)}{e.breaks?.length > 0 && <span className="ml-1 text-amber-600">+{e.breaks.length} break</span>}</td>
                      <td className="py-3 px-4 text-xs"><b>{fmtMins(e.total_minutes)}</b> / {fmtMins(e.paid_minutes)}</td>
                      <td className="py-3 px-4 text-slate-600">{e.work_type_name || "—"}</td>
                      <td className="py-3 px-4 text-slate-600">{e.client_name || "—"}</td>
                      <td className="py-3 px-4"><span className={`px-2 py-0.5 rounded text-[10px] font-bold capitalize ${statusColor}`}>{e.status}</span></td>
                      <td className="py-3 px-4">
                        {e.status === 'submitted' ? (
                          <div className="flex justify-center gap-1">
                            <button onClick={()=>approve(e.id, true)} className="w-8 h-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded flex items-center justify-center" title="Approve"><CheckCircle2 className="w-4 h-4"/></button>
                            <button onClick={()=>approve(e.id, false)} className="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded flex items-center justify-center" title="Reject"><X className="w-4 h-4"/></button>
                          </div>
                        ) : <span className="text-xs text-slate-400">{e.approved_by ? `by ${e.approved_by}` : '—'}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============== ADMIN LEAVE REQUESTS ==============
export function AdminLeaveRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");

  const load = async () => {
    setLoading(true);
    const q = filter === "all" ? "" : `?status=${filter}`;
    const { data } = await api.get(`/leave-requests${q}`);
    setRequests(data); setLoading(false);
  };
  useEffect(() => { api.get("/workers").then(r => setWorkers(r.data)); }, []);
  useEffect(() => { load(); }, [filter]);

  const decide = async (id, approved) => {
    const notes = approved ? "" : (window.prompt("Reason for rejection (optional):") || "");
    await api.post(`/leave-requests/${id}/approve`, { approved, notes });
    load();
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this leave request?")) return;
    await api.delete(`/leave-requests/${id}`);
    load();
  };

  return (
    <div className="fadein">
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">Leave Requests</h1>
      </div>

      <div className="px-6 py-4 flex gap-1 flex-wrap">
        {["pending","approved","rejected","cancelled","all"].map(s => (
          <button key={s} onClick={()=>setFilter(s)} className={`px-3 py-1.5 rounded text-xs font-bold capitalize ${filter===s?"bg-slate-900 text-white":"bg-white border"}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="px-6 pb-8">
        {loading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline"/></div>
        ) : requests.length === 0 ? (
          <div className="bg-white border-2 border-dashed rounded-lg py-12 text-center text-slate-400">No leave requests found.</div>
        ) : (
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-700 text-white">
                <tr>
                  <th className="py-3 px-4 text-left">Worker</th>
                  <th className="py-3 px-4 text-left">Category</th>
                  <th className="py-3 px-4 text-left">Dates</th>
                  <th className="py-3 px-4 text-left">Reason</th>
                  <th className="py-3 px-4 text-left">Status</th>
                  <th className="py-3 px-4 text-left">Decided By</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r, idx) => {
                  const statusMap = {
                    pending: { color: 'bg-amber-100 text-amber-800', icon: Clock },
                    approved: { color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
                    rejected: { color: 'bg-red-100 text-red-800', icon: AlertOctagon },
                    cancelled: { color: 'bg-slate-100 text-slate-600', icon: X },
                  };
                  const m = statusMap[r.status] || statusMap.pending;
                  const start = new Date(r.start_date);
                  const end = new Date(r.end_date);
                  const days = Math.ceil((end - start) / 86400000) + 1;
                  return (
                    <tr key={r.id} className={`border-b hover:bg-slate-50 ${idx%2===1?"bg-slate-50/30":""}`}>
                      <td className="py-3 px-4 font-medium">{r.worker_name}</td>
                      <td className="py-3 px-4"><span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">{r.category_name}</span></td>
                      <td className="py-3 px-4 text-xs text-slate-600">{r.start_date} → {r.end_date}<br/><span className="text-slate-400">{r.half_day ? '½ day' : `${days} day${days===1?'':'s'}`}</span></td>
                      <td className="py-3 px-4 text-xs text-slate-600">{r.reason || "—"}</td>
                      <td className="py-3 px-4"><span className={`px-2 py-0.5 rounded text-[10px] font-bold capitalize flex items-center gap-1 w-fit ${m.color}`}><m.icon className="w-3 h-3"/>{r.status}</span></td>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {r.approver_name || "—"}
                        {r.approver_notes && <div className="text-[10px] italic">"{r.approver_notes}"</div>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex justify-center gap-1">
                          {r.status === 'pending' && (
                            <>
                              <button onClick={()=>decide(r.id, true)} className="w-8 h-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded flex items-center justify-center" title="Approve" data-testid={`approve-leave-${r.id}`}><CheckCircle2 className="w-4 h-4"/></button>
                              <button onClick={()=>decide(r.id, false)} className="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded flex items-center justify-center" title="Reject" data-testid={`reject-leave-${r.id}`}><X className="w-4 h-4"/></button>
                            </>
                          )}
                          <button onClick={()=>remove(r.id)} className="w-8 h-8 bg-slate-500 hover:bg-slate-600 text-white rounded flex items-center justify-center"><X className="w-3.5 h-3.5"/></button>
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
    </div>
  );
}
