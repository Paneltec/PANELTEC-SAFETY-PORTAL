import React, { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Trash2, X, Loader2, Edit3, ArrowRight, Calendar } from "lucide-react";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem("pt_token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

export default function ProjectBookingPage() {
  const [bookings, setBookings] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState(null);
  const [searchField, setSearchField] = useState("created_by");
  const [searchValue, setSearchValue] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get("/project-bookings"),
      api.get("/workers"),
      api.get("/clients"),
    ]).then(([b, w, c]) => {
      setBookings(b.data); setWorkers(w.data); setClients(c.data);
      setLoading(false);
    });
  };
  useEffect(() => { load(); }, []);

  const filtered = bookings.filter(b => {
    if (!searchValue) return true;
    const v = searchValue.toLowerCase();
    if (searchField === "created_by") return (b.created_by||"").toLowerCase().includes(v);
    if (searchField === "member") return (b.member_name||"").toLowerCase().includes(v);
    if (searchField === "client") return (b.client_name||"").toLowerCase().includes(v);
    return true;
  });

  return (
    <div className="fadein">
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">Project Booking</h1>
        <button onClick={()=>{setEditing(null); setShowEdit(true);}}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-sm flex items-center gap-2"
          data-testid="new-booking-btn">
          <Plus className="w-4 h-4"/>ADD NEW
        </button>
      </div>

      <div className="px-6 py-4 flex items-center justify-end gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="accent-blue-500"/>Sub Location
        </label>
        <div className="flex items-center gap-2 bg-white rounded shadow-sm border">
          <select value={searchField} onChange={e=>setSearchField(e.target.value)} className="px-3 py-2 text-sm border-r rounded-l focus:outline-none">
            <option value="created_by">Created By</option>
            <option value="member">Member</option>
            <option value="client">Client</option>
          </select>
          <select value={searchValue} onChange={e=>setSearchValue(e.target.value)} className="px-3 py-2 text-sm w-56 focus:outline-none" data-testid="booking-search">
            <option value="">Select</option>
            {searchField === "member" && workers.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
            {searchField === "client" && clients.slice(0,200).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            {searchField === "created_by" && [...new Set(bookings.map(b=>b.created_by).filter(Boolean))].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-r">SEARCH</button>
        </div>
        <button onClick={load} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm" title="Refresh">
          <ArrowRight className="w-4 h-4 rotate-90"/>
        </button>
      </div>

      <div className="px-6 pb-8">
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline"/></div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-400">No records found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-700 text-white">
                <tr>
                  <th className="py-3 px-4 text-left">Member</th>
                  <th className="py-3 px-4 text-left">Client</th>
                  <th className="py-3 px-4 text-left">Start</th>
                  <th className="py-3 px-4 text-left">End</th>
                  <th className="py-3 px-4 text-left">Sub Location</th>
                  <th className="py-3 px-4 text-left">Status</th>
                  <th className="py-3 px-4 text-left">Created By</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b, idx) => (
                  <tr key={b.id} className={`border-b hover:bg-slate-50 ${idx%2===1?"bg-slate-50/30":""}`}>
                    <td className="py-3 px-4 font-medium">{b.member_name}</td>
                    <td className="py-3 px-4 text-slate-600">{b.client_name || "—"}</td>
                    <td className="py-3 px-4 text-slate-500 text-xs">{b.start_date}</td>
                    <td className="py-3 px-4 text-slate-500 text-xs">{b.end_date}</td>
                    <td className="py-3 px-4 text-slate-500">{b.sub_location || "—"}</td>
                    <td className="py-3 px-4 capitalize"><span className={`px-2 py-0.5 rounded text-xs font-bold ${b.status==='active'?'bg-emerald-100 text-emerald-700':b.status==='completed'?'bg-slate-100 text-slate-700':'bg-red-100 text-red-700'}`}>{b.status}</span></td>
                    <td className="py-3 px-4 text-slate-500 text-xs">{b.created_by||"—"}</td>
                    <td className="py-3 px-4">
                      <div className="flex justify-center gap-1">
                        <button onClick={()=>{setEditing(b); setShowEdit(true);}} className="w-8 h-8 bg-sky-400 hover:bg-sky-500 text-white rounded flex items-center justify-center"><Edit3 className="w-4 h-4"/></button>
                        <button onClick={async()=>{ if(window.confirm("Delete?")){ await api.delete(`/project-bookings/${b.id}`); load();}}} className="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded flex items-center justify-center"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showEdit && <EditBookingModal editing={editing} workers={workers} clients={clients} onClose={()=>{setShowEdit(false); load();}}/>}
    </div>
  );
}

function EditBookingModal({ editing, workers, clients, onClose }) {
  const [b, setB] = useState(editing || { member_id: "", client_id: "", start_date: "", end_date: "", sub_location: "", notes: "", status: "active" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!b.member_id || !b.start_date || !b.end_date) { alert("Member, start and end dates are required"); return; }
    setSaving(true);
    try {
      const payload = { ...b, id: editing?.id || crypto.randomUUID(), created_at: editing?.created_at || new Date().toISOString() };
      if (editing) await api.put(`/project-bookings/${editing.id}`, payload);
      else await api.post("/project-bookings", payload);
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{editing ? "Edit" : "Add"} Project Booking</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-1">Member <span className="text-red-500">*</span></label>
            <select value={b.member_id} onChange={e=>setB({...b,member_id:e.target.value, member_name: workers.find(w=>w.id===e.target.value)?.name})} className="w-full px-3 py-2 border rounded">
              <option value="">— Select —</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Client</label>
            <select value={b.client_id||""} onChange={e=>setB({...b,client_id:e.target.value, client_name: clients.find(c=>c.id===e.target.value)?.name})} className="w-full px-3 py-2 border rounded">
              <option value="">— None —</option>
              {clients.slice(0,500).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-semibold mb-1">Start Date <span className="text-red-500">*</span></label>
              <input type="date" value={b.start_date} onChange={e=>setB({...b,start_date:e.target.value})} className="w-full px-3 py-2 border rounded"/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">End Date <span className="text-red-500">*</span></label>
              <input type="date" value={b.end_date} onChange={e=>setB({...b,end_date:e.target.value})} className="w-full px-3 py-2 border rounded"/>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Sub Location</label>
            <input value={b.sub_location||""} onChange={e=>setB({...b,sub_location:e.target.value})} className="w-full px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Notes</label>
            <textarea value={b.notes||""} onChange={e=>setB({...b,notes:e.target.value})} rows="3" className="w-full px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Status</label>
            <select value={b.status} onChange={e=>setB({...b,status:e.target.value})} className="w-full px-3 py-2 border rounded">
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        <div className="border-t p-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}Save
          </button>
        </div>
      </div>
    </div>
  );
}
