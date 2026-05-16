import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Plus, Trash2, Edit3, X, CheckCircle2, ChevronRight, ListChecks,
  StickyNote, Folder, Users, MapPin, Eye, Loader2, Save, ArrowRight,
  Calendar, AlertOctagon, ListTodo, Search
} from "lucide-react";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem("pt_token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

const STATES = ["Tasmania","Victoria","New South Wales","Queensland","South Australia","Western Australia","Northern Territory","Australian Capital Territory"];

// ============== CLIENT MANAGEMENT PAGE ==============
export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchField, setSearchField] = useState("name");
  const [searchValue, setSearchValue] = useState("");
  const [selected, setSelected] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [showTasks, setShowTasks] = useState(null);
  const [showNotes, setShowNotes] = useState(null);
  const [showFolders, setShowFolders] = useState(null);
  const [showMembers, setShowMembers] = useState(null);

  const load = () => {
    setLoading(true);
    api.get("/clients").then(r => { setClients(r.data); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const toggleLocation = async (c) => {
    const newLoc = c.location_id ? null : "active";
    await api.put(`/clients/${c.id}`, { ...c, location_id: newLoc });
    load();
  };

  const filtered = clients.filter(c => {
    if (!searchValue) return true;
    const v = searchValue.toLowerCase();
    if (searchField === "name") return (c.name||"").toLowerCase().includes(v);
    if (searchField === "contact") return (c.contact_name||"").toLowerCase().includes(v);
    if (searchField === "address") return (c.address||"").toLowerCase().includes(v);
    return true;
  });

  const toggleSelect = (id) => setSelected(selected.includes(id) ? selected.filter(x=>x!==id) : [...selected, id]);
  const toggleSelectAll = () => setSelected(selected.length === filtered.length ? [] : filtered.map(c=>c.id));

  return (
    <div className="fadein">
      {/* Header */}
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">Client Management</h1>
        <button onClick={()=>{setEditing(null); setShowEdit(true);}}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-sm flex items-center gap-2"
          data-testid="new-client-btn">
          <Plus className="w-4 h-4"/>ADD NEW
        </button>
      </div>

      {/* Filter */}
      <div className="px-6 py-4 flex items-center justify-end gap-2 flex-wrap">
        <div className="flex items-center gap-2 bg-white rounded shadow-sm border">
          <select value={searchField} onChange={e=>setSearchField(e.target.value)} className="px-3 py-2 text-sm border-r rounded-l focus:outline-none">
            <option value="name">Client Name</option>
            <option value="contact">Contact</option>
            <option value="address">Address</option>
          </select>
          <input value={searchValue} onChange={e=>setSearchValue(e.target.value)} placeholder="Search…" className="px-3 py-2 text-sm w-56 focus:outline-none" data-testid="client-search-input"/>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-r" data-testid="client-search-btn">SEARCH</button>
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
                  <th className="py-3 px-3 text-left w-10">
                    <input type="checkbox" checked={filtered.length>0 && selected.length===filtered.length} onChange={toggleSelectAll}/>
                  </th>
                  <th className="py-3 px-3 text-left font-semibold">Client Name</th>
                  <th className="py-3 px-3 text-left font-semibold">Created By</th>
                  <th className="py-3 px-3 text-left font-semibold">Created Date</th>
                  <th className="py-3 px-3 text-center font-semibold">Tasks</th>
                  <th className="py-3 px-3 text-center font-semibold">Notes</th>
                  <th className="py-3 px-3 text-center font-semibold">Folders</th>
                  <th className="py-3 px-3 text-center font-semibold">Members</th>
                  <th className="py-3 px-3 text-center font-semibold">Location</th>
                  <th className="py-3 px-3 text-center font-semibold">Status</th>
                  <th className="py-3 px-3 text-center font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="11" className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline-block mr-2"/>Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan="11" className="py-12 text-center text-slate-400">No clients found. Click "ADD NEW" to create one.</td></tr>
                ) : filtered.map((c, idx) => {
                  const active = (c.status || "active") === "active";
                  const hasLoc = !!c.location_id;
                  return (
                    <tr key={c.id} className={`border-b hover:bg-slate-50 ${idx%2===1?"bg-slate-50/30":""}`} data-testid={`client-row-${c.id}`}>
                      <td className="py-3 px-3"><input type="checkbox" checked={selected.includes(c.id)} onChange={()=>toggleSelect(c.id)}/></td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900">{c.name}</div>
                        {c.contact_name && <div className="text-xs text-slate-500 mt-1"><span className="font-bold">Contact:</span> {c.contact_name}</div>}
                        {c.address && <div className="text-xs text-slate-500"><span className="font-bold">Address:</span> {c.address}</div>}
                        <div className="text-xs text-slate-500"><span className="font-bold">Phone:</span> {c.phone || "N.A."}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-600">{c.created_by || "—"}</td>
                      <td className="py-3 px-3 text-slate-500 text-xs">{c.created_at ? new Date(c.created_at).toLocaleString() : "—"}</td>
                      <td className="py-3 px-3">
                        <button onClick={()=>setShowTasks(c)} className="mx-auto block w-10 h-12 bg-orange-100 hover:bg-orange-200 border border-orange-300 rounded flex items-center justify-center text-orange-600" title="Tasks" data-testid={`client-tasks-${c.id}`}>
                          <ListChecks className="w-5 h-5"/>
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <button onClick={()=>setShowNotes(c)} className="mx-auto block w-10 h-12 bg-orange-100 hover:bg-orange-200 border border-orange-300 rounded flex items-center justify-center text-orange-600" title="Notes" data-testid={`client-notes-${c.id}`}>
                          <StickyNote className="w-5 h-5"/>
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <button onClick={()=>setShowFolders(c)} className="mx-auto block w-10 h-12 bg-orange-100 hover:bg-orange-200 border border-orange-300 rounded flex items-center justify-center text-orange-600" title="Folders" data-testid={`client-folders-${c.id}`}>
                          <Folder className="w-5 h-5"/>
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <button onClick={()=>setShowMembers(c)} className="mx-auto block w-10 h-12 bg-orange-500 hover:bg-orange-600 border border-orange-600 rounded flex items-center justify-center text-white" title="Members" data-testid={`client-members-${c.id}`}>
                          <Users className="w-5 h-5"/>
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex justify-center">
                          <button onClick={()=>toggleLocation(c)} className={`relative w-12 h-6 rounded-full transition ${hasLoc?"bg-blue-500":"bg-slate-300"}`} title="Location" data-testid={`client-location-${c.id}`}>
                            <span className={`absolute top-0.5 ${hasLoc?"left-6":"left-0.5"} w-5 h-5 bg-white rounded-full shadow transition-all`}/>
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center capitalize font-semibold">{active?"Active":"Inactive"}</td>
                      <td className="py-3 px-3">
                        <div className="flex justify-center gap-1">
                          <button onClick={()=>{setEditing(c); setShowEdit(true);}} className="w-8 h-8 bg-sky-400 hover:bg-sky-500 text-white rounded flex items-center justify-center" title="Edit" data-testid={`edit-client-${c.id}`}>
                            <Edit3 className="w-4 h-4"/>
                          </button>
                          <button onClick={async()=>{ if(window.confirm("Delete this client?")){ await api.delete(`/clients/${c.id}`); load();}}} className="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded flex items-center justify-center" title="Delete" data-testid={`delete-client-${c.id}`}>
                            <Trash2 className="w-4 h-4"/>
                          </button>
                          <button onClick={()=>setViewing(c)} className="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded flex items-center justify-center" title="View" data-testid={`view-client-${c.id}`}>
                            <Eye className="w-4 h-4"/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-slate-50 border-t text-sm text-slate-500 flex items-center justify-between">
            <div>Showing : {filtered.length} {selected.length > 0 && <span className="ml-2 text-slate-700 font-semibold">· {selected.length} selected</span>}</div>
          </div>
        </div>

        {/* PUSH TO WOJOPAY */}
        <button
          onClick={()=>alert("⚠ Wojopay integration: Coming Soon\n\nThis will sync selected clients to Wojopay accounting/payment system.")}
          className="mt-4 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded text-sm flex items-center gap-2"
          data-testid="push-wojopay-btn">
          PUSH TO WOJOPAY <ChevronRight className="w-4 h-4"/>
        </button>
      </div>

      {showEdit && <EditClientModal editing={editing} clients={clients} onClose={()=>{setShowEdit(false); load();}}/>}
      {showTasks && <ClientTasksModal client={showTasks} onClose={()=>setShowTasks(null)}/>}
      {showNotes && <ClientNotesModal client={showNotes} onClose={()=>setShowNotes(null)}/>}
      {showFolders && <ClientFoldersModal client={showFolders} onClose={()=>setShowFolders(null)}/>}
      {showMembers && <ClientMembersModal client={showMembers} onClose={()=>{setShowMembers(null); load();}}/>}
      {viewing && <ClientViewModal client={viewing} onClose={()=>setViewing(null)}/>}
    </div>
  );
}

// ============== EDIT CLIENT MODAL ==============
function EditClientModal({ editing, clients, onClose }) {
  const initial = editing || { name: "", address: "", state: "", contact_name: "", phone: "", parent_client_id: "", status: "active" };
  const [c, setC] = useState(initial);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setC({ ...c, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...c,
        id: editing?.id || crypto.randomUUID(),
        status: c.status === "active" || c.status === undefined ? "active" : "inactive",
        member_ids: c.member_ids || [],
        created_at: editing?.created_at || new Date().toISOString(),
      };
      if (editing) await api.put(`/clients/${editing.id}`, payload);
      else await api.post("/clients", payload);
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-6 py-4 flex items-start justify-between gap-2">
          <h2 className="text-xl font-bold">{editing ? `Edit Client - ${editing.name}` : "Add New Client"}</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1 flex-shrink-0"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Client Name <span className="text-red-500">*</span></label>
            <input value={c.name||""} onChange={e=>set("name",e.target.value)} className="w-full px-3 py-2 border rounded" data-testid="client-name-input"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Address</label>
            <textarea value={c.address||""} onChange={e=>set("address",e.target.value)} rows="3" className="w-full px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">State</label>
            <select value={c.state||""} onChange={e=>set("state",e.target.value)} className="w-full px-3 py-2 border rounded">
              <option value="">Select State</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Contact</label>
            <input value={c.contact_name||""} onChange={e=>set("contact_name",e.target.value)} className="w-full px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Phone</label>
            <input value={c.phone||""} onChange={e=>set("phone",e.target.value)} placeholder="Phone" className="w-full px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Parent Client</label>
            <select value={c.parent_client_id||""} onChange={e=>set("parent_client_id",e.target.value)} className="w-full px-3 py-2 border rounded">
              <option value="">Select Client</option>
              {clients.filter(x => x.id !== editing?.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer pt-2">
            <input type="checkbox" checked={(c.status||"active")==="active"} onChange={e=>set("status",e.target.checked?"active":"inactive")} className="w-4 h-4 accent-blue-500"/>
            <span className="font-semibold">Active</span>
          </label>
        </div>
        <div className="border-t p-4 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={save} disabled={!c.name || saving} className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded flex items-center gap-2 disabled:opacity-50" data-testid="save-client-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}{editing ? "UPDATE" : "ADD"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== CLIENT MEMBERS MODAL ==============
function ClientMembersModal({ client, onClose }) {
  const [workers, setWorkers] = useState([]);
  const [selected, setSelected] = useState(client.member_ids || []);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get("/workers").then(r => setWorkers(r.data));
  }, []);
  const toggle = (id) => setSelected(selected.includes(id) ? selected.filter(x=>x!==id) : [...selected, id]);
  const toggleAll = () => setSelected(selected.length === workers.length ? [] : workers.map(w=>w.id));
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/clients/${client.id}`, { ...client, member_ids: selected });
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-sm max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Members ({client.name})</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-4">
          <div className="text-sm font-semibold mb-2">Add Member <span className="text-red-500">*</span></div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <label className="flex items-center gap-2 py-1.5 cursor-pointer">
            <input type="checkbox" checked={workers.length>0 && selected.length===workers.length} onChange={toggleAll} className="w-4 h-4 accent-blue-500"/>
            <span className="text-sm">Select/Unselect All</span>
          </label>
          {workers.map(w => (
            <label key={w.id} className="flex items-center gap-2 py-1.5 cursor-pointer">
              <input type="checkbox" checked={selected.includes(w.id)} onChange={()=>toggle(w.id)} className="w-4 h-4 accent-blue-500" data-testid={`member-check-${w.id}`}/>
              <span className="text-sm">{w.name || `${w.first_name||""} ${w.last_name||""}`.trim()}</span>
            </label>
          ))}
          {workers.length === 0 && <div className="text-center text-slate-400 text-sm py-4">No workers available. Sync from Simpro or add manually in Members Management.</div>}
        </div>
        <div className="border-t p-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-3 py-2 border rounded text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded text-sm flex items-center gap-2 disabled:opacity-50" data-testid="save-client-members-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== CLIENT FOLDERS MODAL ==============
function ClientFoldersModal({ client, onClose }) {
  const [folders, setFolders] = useState([]);
  const [name, setName] = useState("");
  const load = () => api.get(`/client-folders?client_id=${client.id}`).then(r => setFolders(r.data));
  useEffect(() => { load(); }, []);
  const add = async () => {
    if (!name.trim()) return;
    await api.post("/client-folders", { id: crypto.randomUUID(), client_id: client.id, name: name.trim(), created_at: new Date().toISOString() });
    setName(""); load();
  };
  const del = async (id) => {
    if (!window.confirm("Delete folder?")) return;
    await api.delete(`/client-folders/${id}`); load();
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-sm max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Folders ({client.name})</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-5">
          <label className="block text-sm font-semibold mb-2">Add Folder <span className="text-red-500">*</span></label>
          <textarea value={name} onChange={e=>setName(e.target.value)} rows="3" className="w-full px-3 py-2 border rounded" data-testid="folder-name-input"/>
          <div className="flex justify-end mt-2">
            <button onClick={add} disabled={!name.trim()} className="px-5 py-1.5 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded text-sm disabled:opacity-50" data-testid="add-folder-btn">ADD</button>
          </div>
        </div>
        <div className="border-t flex-1 overflow-y-auto p-4">
          {folders.length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-3">No folder added yet</div>
          ) : (
            <div className="space-y-2">
              {folders.map(f => (
                <div key={f.id} className="flex items-center gap-2 p-2 border rounded">
                  <Folder className="w-5 h-5 text-orange-500"/>
                  <span className="flex-1 text-sm font-semibold">{f.name}</span>
                  <button onClick={()=>del(f.id)} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============== CLIENT NOTES MODAL ==============
function ClientNotesModal({ client, onClose }) {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const load = () => {
    api.get(`/notes?client_id=${client.id}`).then(r => setNotes(r.data));
    api.get(`/client-folders?client_id=${client.id}`).then(r => setFolders(r.data));
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Notes ({client.name})</h2>
          <div className="flex items-center gap-2">
            <button onClick={()=>setShowAdd(true)} className="bg-emerald-600 hover:bg-emerald-700 px-3 py-1 rounded text-sm font-bold flex items-center gap-1" data-testid="add-client-note-btn"><Plus className="w-3 h-3"/>ADD NEW</button>
            <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {notes.length === 0 ? (
            <div className="text-center text-slate-400 py-8 text-sm">No notes yet for this client.</div>
          ) : (
            <div className="space-y-2">
              {notes.map(n => {
                const folder = folders.find(f => f.id === n.folder_id);
                return (
                  <div key={n.id} className="bg-slate-50 border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-bold">{n.title}</div>
                      <button onClick={async()=>{ if(window.confirm("Delete note?")){ await api.delete(`/notes/${n.id}`); load();}}} className="text-red-500"><Trash2 className="w-3.5 h-3.5"/></button>
                    </div>
                    {folder && <div className="text-xs text-amber-700 mt-0.5">📁 {folder.name}</div>}
                    <div className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{n.body}</div>
                    <div className="text-[10px] text-slate-400 mt-2">By {n.created_by} · {new Date(n.created_at).toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {showAdd && <AddNoteModal client={client} folders={folders} onClose={()=>{setShowAdd(false); load();}}/>}
      </div>
    </div>
  );
}

function AddNoteModal({ client, folders, onClose }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [folderId, setFolderId] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.post("/notes", {
        id: crypto.randomUUID(),
        title, body,
        client_id: client.id,
        client_name: client.name,
        folder_id: folderId || null,
        created_at: new Date().toISOString(),
      });
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md p-5">
        <h3 className="font-bold text-lg mb-3">Add Note</h3>
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title *" className="w-full px-3 py-2 border rounded mb-2" data-testid="note-title-input"/>
        <select value={folderId} onChange={e=>setFolderId(e.target.value)} className="w-full px-3 py-2 border rounded mb-2">
          <option value="">— No folder —</option>
          {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <textarea value={body} onChange={e=>setBody(e.target.value)} rows="5" placeholder="Note body…" className="w-full px-3 py-2 border rounded mb-3" data-testid="note-body-input"/>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={save} disabled={!title || saving} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded disabled:opacity-50" data-testid="save-note-btn">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== CLIENT TASKS MODAL ==============
function ClientTasksModal({ client, onClose }) {
  const [tasks, setTasks] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const load = () => {
    api.get(`/tasks?client_id=${client.id}`).then(r => setTasks(r.data));
    api.get("/workers").then(r => setWorkers(r.data));
  };
  useEffect(() => { load(); }, []);

  const statusBadge = (s) => ({
    open: "bg-slate-100 text-slate-700",
    in_progress: "bg-blue-100 text-blue-700",
    done: "bg-emerald-100 text-emerald-700",
    blocked: "bg-red-100 text-red-700",
  }[s] || "bg-slate-100");

  const cycleStatus = async (t) => {
    const next = { open: "in_progress", in_progress: "done", done: "open", blocked: "open" }[t.status] || "open";
    await api.post(`/tasks/${t.id}/status`, { status: next });
    load();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Tasks ({client.name})</h2>
          <div className="flex items-center gap-2">
            <button onClick={()=>setShowAdd(true)} className="bg-emerald-600 hover:bg-emerald-700 px-3 py-1 rounded text-sm font-bold flex items-center gap-1" data-testid="add-client-task-btn"><Plus className="w-3 h-3"/>ADD NEW</button>
            <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tasks.length === 0 ? (
            <div className="text-center text-slate-400 py-8 text-sm">No tasks yet for this client.</div>
          ) : (
            <div className="space-y-2">
              {tasks.map(t => (
                <div key={t.id} className="bg-slate-50 border rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <button onClick={()=>cycleStatus(t)} className={`px-2 py-0.5 rounded text-[10px] font-bold capitalize ${statusBadge(t.status)}`} data-testid={`task-status-${t.id}`}>{t.status?.replace("_"," ")}</button>
                    <div className="flex-1">
                      <div className="font-bold">{t.title}</div>
                      {t.description && <div className="text-xs text-slate-600 mt-0.5">{t.description}</div>}
                      <div className="flex gap-3 mt-1 text-xs text-slate-500">
                        {t.assignee_name && <span>👤 {t.assignee_name}</span>}
                        {t.due_date && <span>📅 {new Date(t.due_date).toLocaleDateString()}</span>}
                        <span className={`uppercase font-bold ${t.priority==="critical"?"text-red-600":t.priority==="high"?"text-orange-600":t.priority==="low"?"text-slate-500":"text-amber-600"}`}>{t.priority}</span>
                      </div>
                    </div>
                    <button onClick={async()=>{ if(window.confirm("Delete?")){ await api.delete(`/tasks/${t.id}`); load();}}} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 className="w-4 h-4"/></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {showAdd && <AddTaskModal client={client} workers={workers} onClose={()=>{setShowAdd(false); load();}}/>}
      </div>
    </div>
  );
}

function AddTaskModal({ client, workers, onClose }) {
  const [t, setT] = useState({ title: "", description: "", assignee_id: "", priority: "medium", due_date: "", status: "open" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.post("/tasks", {
        ...t,
        id: crypto.randomUUID(),
        client_id: client?.id || null,
        client_name: client?.name || null,
        due_date: t.due_date || null,
        assignee_id: t.assignee_id || null,
        created_at: new Date().toISOString(),
      });
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md p-5">
        <h3 className="font-bold text-lg mb-3">Add Task</h3>
        <input value={t.title} onChange={e=>setT({...t,title:e.target.value})} placeholder="Title *" className="w-full px-3 py-2 border rounded mb-2" data-testid="task-title-input"/>
        <textarea value={t.description} onChange={e=>setT({...t,description:e.target.value})} rows="3" placeholder="Description" className="w-full px-3 py-2 border rounded mb-2"/>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select value={t.assignee_id} onChange={e=>setT({...t,assignee_id:e.target.value})} className="px-3 py-2 border rounded">
            <option value="">Assignee</option>
            {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={t.priority} onChange={e=>setT({...t,priority:e.target.value})} className="px-3 py-2 border rounded">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <input type="date" value={t.due_date} onChange={e=>setT({...t,due_date:e.target.value})} className="w-full px-3 py-2 border rounded mb-3"/>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={save} disabled={!t.title || saving} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded disabled:opacity-50" data-testid="save-task-btn">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== CLIENT VIEW MODAL (read-only) ==============
function ClientViewModal({ client, onClose }) {
  const [members, setMembers] = useState([]);
  const [folders, setFolders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [tasks, setTasks] = useState([]);
  useEffect(() => {
    api.get("/workers").then(r => setMembers(r.data.filter(w => (client.member_ids||[]).includes(w.id))));
    api.get(`/client-folders?client_id=${client.id}`).then(r => setFolders(r.data));
    api.get(`/notes?client_id=${client.id}`).then(r => setNotes(r.data));
    api.get(`/tasks?client_id=${client.id}`).then(r => setTasks(r.data));
  }, []);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{client.name}</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="font-bold text-slate-500 text-xs">CONTACT</div><div>{client.contact_name || "—"}</div></div>
            <div><div className="font-bold text-slate-500 text-xs">PHONE</div><div>{client.phone || "—"}</div></div>
            <div className="col-span-2"><div className="font-bold text-slate-500 text-xs">ADDRESS</div><div>{client.address || "—"}</div></div>
            <div><div className="font-bold text-slate-500 text-xs">STATE</div><div>{client.state || "—"}</div></div>
            <div><div className="font-bold text-slate-500 text-xs">STATUS</div><div className="capitalize">{client.status || "active"}</div></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat icon={Users} label="Members" value={members.length}/>
            <Stat icon={Folder} label="Folders" value={folders.length}/>
            <Stat icon={StickyNote} label="Notes" value={notes.length}/>
            <Stat icon={ListChecks} label="Tasks" value={tasks.length}/>
          </div>
          {members.length > 0 && (
            <div>
              <h4 className="font-bold text-sm mb-2">Members</h4>
              <div className="flex flex-wrap gap-1.5">
                {members.map(m => <span key={m.id} className="px-2 py-1 bg-slate-100 rounded text-xs font-semibold">{m.name}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="bg-slate-50 border rounded-lg p-3 flex items-center gap-2">
      <Icon className="w-5 h-5 text-amber-500"/>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="font-bold">{value}</div>
      </div>
    </div>
  );
}
