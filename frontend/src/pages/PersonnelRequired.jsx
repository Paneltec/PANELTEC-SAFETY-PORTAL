import React, { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Trash2, X, Loader2, Edit3, ArrowRight } from "lucide-react";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem("pt_token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

export default function PersonnelRequiredPage() {
  const [items, setItems] = useState([]);
  const [skills, setSkills] = useState([]);
  const [locations, setLocations] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skillFilter, setSkillFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (skillFilter) q.set("skill", skillFilter);
    const { data } = await api.get(`/personnel-required?${q.toString()}`);
    let filtered = data;
    if (search) {
      const v = search.toLowerCase();
      filtered = filtered.filter(p => `${p.skill} ${p.location_name||''} ${p.client_name||''} ${p.notes||''}`.toLowerCase().includes(v));
    }
    setItems(filtered); setLoading(false);
  };

  useEffect(() => {
    api.get("/skills").then(r => setSkills(r.data));
    api.get("/locations").then(r => setLocations(r.data));
    api.get("/clients").then(r => setClients(r.data));
  }, []);
  useEffect(() => { load(); }, [skillFilter]);

  return (
    <div className="fadein">
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">Personnel Required Management</h1>
        <button onClick={()=>{setEditing(null); setShowEdit(true);}}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-sm flex items-center gap-2"
          data-testid="new-personnel-btn">
          <Plus className="w-4 h-4"/>ADD NEW
        </button>
      </div>

      <div className="px-6 py-4 flex items-center justify-end gap-2 flex-wrap">
        <select value={skillFilter} onChange={e=>setSkillFilter(e.target.value)} className="px-3 py-2 border rounded bg-white text-sm">
          <option value="">Skill — All</option>
          {skills.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search" className="px-3 py-2 border rounded text-sm w-56"/>
        <button onClick={load} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-sm">SEARCH</button>
        <button onClick={()=>{setSkillFilter(""); setSearch(""); setTimeout(load,50);}} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm">
          <ArrowRight className="w-4 h-4 rotate-90"/>
        </button>
      </div>

      <div className="px-6 pb-8">
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline"/></div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-slate-400">No records found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-700 text-white">
                <tr>
                  <th className="py-3 px-4 text-left">Date</th>
                  <th className="py-3 px-4 text-left">Skill</th>
                  <th className="py-3 px-4 text-left">Job Site</th>
                  <th className="py-3 px-4 text-left">Client</th>
                  <th className="py-3 px-4 text-center">Required</th>
                  <th className="py-3 px-4 text-center">Filled</th>
                  <th className="py-3 px-4 text-left">Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p, idx) => {
                  const pct = p.number_required ? Math.round(100 * (p.number_filled||0) / p.number_required) : 0;
                  return (
                    <tr key={p.id} className={`border-b hover:bg-slate-50 ${idx%2===1?"bg-slate-50/30":""}`}>
                      <td className="py-3 px-4 font-medium">{p.required_date}</td>
                      <td className="py-3 px-4"><span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">{p.skill}</span></td>
                      <td className="py-3 px-4 text-slate-600">{p.location_name || "—"}</td>
                      <td className="py-3 px-4 text-slate-600">{p.client_name || "—"}</td>
                      <td className="py-3 px-4 text-center font-bold">{p.number_required}</td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="flex-1 max-w-[80px] h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div className={`h-full ${pct>=100?"bg-emerald-500":pct>=50?"bg-amber-500":"bg-red-500"}`} style={{ width: `${Math.min(100,pct)}%` }}/>
                          </div>
                          <span className="text-xs">{p.number_filled||0}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4"><span className={`px-2 py-0.5 rounded text-xs font-bold capitalize ${p.status==='filled'?'bg-emerald-100 text-emerald-700':p.status==='cancelled'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}`}>{p.status}</span></td>
                      <td className="py-3 px-4">
                        <div className="flex justify-center gap-1">
                          <button onClick={()=>{setEditing(p); setShowEdit(true);}} className="w-8 h-8 bg-sky-400 hover:bg-sky-500 text-white rounded flex items-center justify-center"><Edit3 className="w-4 h-4"/></button>
                          <button onClick={async()=>{ if(window.confirm("Delete?")){ await api.delete(`/personnel-required/${p.id}`); load();}}} className="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded flex items-center justify-center"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showEdit && <EditPersonnelModal editing={editing} skills={skills} locations={locations} clients={clients} onClose={()=>{setShowEdit(false); load();}}/>}
    </div>
  );
}

function EditPersonnelModal({ editing, skills, locations, clients, onClose }) {
  const [p, setP] = useState(editing || { required_date: "", skill: "", number_required: 1, number_filled: 0, location_id: "", client_id: "", notes: "", status: "open" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!p.required_date || !p.skill) { alert("Date and skill required"); return; }
    setSaving(true);
    try {
      const loc = locations.find(l=>l.id===p.location_id);
      const cli = clients.find(c=>c.id===p.client_id);
      const payload = { ...p,
        id: editing?.id || crypto.randomUUID(),
        number_required: parseInt(p.number_required)||1,
        number_filled: parseInt(p.number_filled)||0,
        location_name: loc?.name || null,
        client_name: cli?.name || null,
        created_at: editing?.created_at || new Date().toISOString(),
      };
      if (editing) await api.put(`/personnel-required/${editing.id}`, payload);
      else await api.post("/personnel-required", payload);
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{editing ? "Edit" : "Add"} Personnel Required</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-1">Date <span className="text-red-500">*</span></label>
            <input type="date" value={p.required_date} onChange={e=>setP({...p,required_date:e.target.value})} className="w-full px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Skill <span className="text-red-500">*</span></label>
            <input list="skill-list" value={p.skill} onChange={e=>setP({...p,skill:e.target.value})} className="w-full px-3 py-2 border rounded"/>
            <datalist id="skill-list">
              {skills.map(s => <option key={s.id} value={s.name}/>)}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-semibold mb-1">Number Required</label>
              <input type="number" min="1" value={p.number_required} onChange={e=>setP({...p,number_required:e.target.value})} className="w-full px-3 py-2 border rounded"/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Number Filled</label>
              <input type="number" min="0" value={p.number_filled} onChange={e=>setP({...p,number_filled:e.target.value})} className="w-full px-3 py-2 border rounded"/>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Job Site</label>
            <select value={p.location_id||""} onChange={e=>setP({...p,location_id:e.target.value})} className="w-full px-3 py-2 border rounded">
              <option value="">— None —</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Client</label>
            <select value={p.client_id||""} onChange={e=>setP({...p,client_id:e.target.value})} className="w-full px-3 py-2 border rounded">
              <option value="">— None —</option>
              {clients.slice(0,500).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Status</label>
            <select value={p.status} onChange={e=>setP({...p,status:e.target.value})} className="w-full px-3 py-2 border rounded">
              <option value="open">Open</option>
              <option value="filled">Filled</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Notes</label>
            <textarea value={p.notes||""} onChange={e=>setP({...p,notes:e.target.value})} rows="3" className="w-full px-3 py-2 border rounded"/>
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
