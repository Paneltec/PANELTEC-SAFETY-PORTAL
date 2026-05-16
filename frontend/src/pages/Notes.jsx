import React, { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Trash2, X, Loader2, StickyNote, Search, Edit3, ArrowRight } from "lucide-react";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem("pt_token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

export default function NotesPage() {
  const [notes, setNotes] = useState([]);
  const [clients, setClients] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [searchMode, setSearchMode] = useState("client"); // client | file
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (clientId) q.set("client_id", clientId);
    if (folderId) q.set("folder_id", folderId);
    if (keyword) q.set("search", keyword);
    const { data } = await api.get(`/notes?${q.toString()}`);
    setNotes(data); setLoading(false);
  };
  const loadFolders = async () => {
    if (!clientId) { setFolders([]); return; }
    const { data } = await api.get(`/client-folders?client_id=${clientId}`);
    setFolders(data);
  };
  useEffect(() => {
    api.get("/clients").then(r => setClients(r.data));
    load();
  }, []);
  useEffect(() => { loadFolders(); setFolderId(""); }, [clientId]);

  return (
    <div className="fadein">
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">Note Management</h1>
        <button onClick={()=>{setEditing(null); setShowAdd(true);}}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-sm flex items-center gap-2"
          data-testid="new-note-btn">
          <Plus className="w-4 h-4"/>ADD NEW
        </button>
      </div>

      <div className="px-6 py-4 bg-slate-50 border-b">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="searchMode" checked={searchMode==="client"} onChange={()=>setSearchMode("client")} className="accent-blue-500"/>
            Client
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="searchMode" checked={searchMode==="file"} onChange={()=>setSearchMode("file")} className="accent-blue-500"/>
            File
          </label>
          <select value={clientId} onChange={e=>setClientId(e.target.value)} className="px-3 py-2 border rounded text-sm bg-white" data-testid="note-client-select">
            <option value="">All Clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={folderId} onChange={e=>setFolderId(e.target.value)} disabled={!clientId} className="px-3 py-2 border rounded text-sm bg-white disabled:bg-slate-100">
            <option value="">{clientId ? "All Folders" : "Select Folder"}</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="Keywords e.g. Note Title" className="px-3 py-2 border rounded text-sm w-56" data-testid="note-search-input"/>
          <button onClick={load} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-sm" data-testid="note-search-btn">SEARCH</button>
          <button onClick={()=>{setClientId(""); setFolderId(""); setKeyword(""); setTimeout(load,50);}} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm" title="Refresh">
            <ArrowRight className="w-4 h-4 rotate-90"/>
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-sm mt-2">
          <input type="checkbox" className="accent-blue-500"/>Sub Location
        </label>
      </div>

      <div className="px-6 py-4">
        {loading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline"/></div>
        ) : notes.length === 0 ? (
          <div className="bg-white border-2 border-dashed rounded-lg py-12 text-center text-slate-400">No records found</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {notes.map(n => (
              <div key={n.id} className="bg-white border rounded-lg p-4 hover:shadow-md transition" data-testid={`note-card-${n.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-900 truncate">{n.title}</div>
                    {n.client_name && <div className="text-xs text-amber-700 mt-0.5">📌 {n.client_name}</div>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={()=>{setEditing(n); setShowAdd(true);}} className="p-1 text-slate-500 hover:text-amber-600"><Edit3 className="w-3.5 h-3.5"/></button>
                    <button onClick={async()=>{ if(window.confirm("Delete?")){ await api.delete(`/notes/${n.id}`); load();}}} className="p-1 text-red-500"><Trash2 className="w-3.5 h-3.5"/></button>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mt-2 line-clamp-4 whitespace-pre-wrap">{n.body}</p>
                <div className="text-[10px] text-slate-400 mt-3">By {n.created_by} · {new Date(n.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && <NoteEditorModal editing={editing} clients={clients} onClose={()=>{setShowAdd(false); load();}}/>}
    </div>
  );
}

function NoteEditorModal({ editing, clients, onClose }) {
  const [n, setN] = useState(editing || { title: "", body: "", client_id: "", folder_id: "" });
  const [folders, setFolders] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (n.client_id) api.get(`/client-folders?client_id=${n.client_id}`).then(r => setFolders(r.data));
    else setFolders([]);
  }, [n.client_id]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...n,
        id: editing?.id || crypto.randomUUID(),
        client_id: n.client_id || null,
        folder_id: n.folder_id || null,
        created_at: editing?.created_at || new Date().toISOString(),
      };
      if (editing) await api.put(`/notes/${editing.id}`, payload);
      else await api.post("/notes", payload);
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{editing ? "Edit Note" : "Add Note"}</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-1">Title <span className="text-red-500">*</span></label>
            <input value={n.title} onChange={e=>setN({...n,title:e.target.value})} className="w-full px-3 py-2 border rounded" data-testid="note-title-input"/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-semibold mb-1">Client</label>
              <select value={n.client_id||""} onChange={e=>setN({...n,client_id:e.target.value,folder_id:""})} className="w-full px-3 py-2 border rounded">
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Folder</label>
              <select value={n.folder_id||""} onChange={e=>setN({...n,folder_id:e.target.value})} disabled={!n.client_id} className="w-full px-3 py-2 border rounded disabled:bg-slate-100">
                <option value="">— None —</option>
                {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Body</label>
            <textarea value={n.body} onChange={e=>setN({...n,body:e.target.value})} rows="8" className="w-full px-3 py-2 border rounded" data-testid="note-body-input"/>
          </div>
        </div>
        <div className="border-t p-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={save} disabled={!n.title || saving} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded flex items-center gap-2 disabled:opacity-50" data-testid="save-note-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}Save
          </button>
        </div>
      </div>
    </div>
  );
}
