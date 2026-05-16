import React, { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Trash2, X, Loader2, Edit3, ArrowRight, User as UserIcon, Paperclip, FileText, List } from "lucide-react";

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
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [searchMode, setSearchMode] = useState("client");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showMembers, setShowMembers] = useState(null);
  const [showFiles, setShowFiles] = useState(null);
  const [showAdditional, setShowAdditional] = useState(null);
  const [showListView, setShowListView] = useState(null);

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
    api.get("/workers").then(r => setWorkers(r.data));
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
            <input type="radio" name="searchMode" checked={searchMode==="client"} onChange={()=>setSearchMode("client")} className="accent-blue-500"/>Client
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="searchMode" checked={searchMode==="file"} onChange={()=>setSearchMode("file")} className="accent-blue-500"/>File
          </label>
          <select value={clientId} onChange={e=>setClientId(e.target.value)} className="px-3 py-2 border rounded text-sm bg-white">
            <option value="">Select Client</option>
            {clients.slice(0,500).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={folderId} onChange={e=>setFolderId(e.target.value)} disabled={!clientId} className="px-3 py-2 border rounded text-sm bg-white disabled:bg-slate-100">
            <option value="">Select Folder</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="Keywords e.g. Note Title" className="px-3 py-2 border rounded text-sm w-56"/>
          <button onClick={load} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-sm">SEARCH</button>
          <button onClick={()=>{setClientId(""); setFolderId(""); setKeyword(""); setTimeout(load,50);}} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm">
            <ArrowRight className="w-4 h-4 rotate-90"/>
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-sm mt-2">
          <input type="checkbox" className="accent-blue-500"/>Sub Location
        </label>
      </div>

      <div className="px-6 py-4">
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline"/></div>
          ) : notes.length === 0 ? (
            <div className="py-12 text-center text-slate-400">No records found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-700 text-white">
                <tr>
                  <th className="py-3 px-4 text-left">Note Title</th>
                  <th className="py-3 px-4 text-left">Client</th>
                  <th className="py-3 px-4 text-left">Folder</th>
                  <th className="py-3 px-4 text-left">Last Updated By</th>
                  <th className="py-3 px-4 text-left">Created By</th>
                  <th className="py-3 px-4 text-center">Member</th>
                  <th className="py-3 px-4 text-center">Files</th>
                  <th className="py-3 px-4 text-center">Additional Notes</th>
                  <th className="py-3 px-4 text-center">List</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n, idx) => (
                  <React.Fragment key={n.id}>
                    <tr className={`border-b hover:bg-slate-50 ${idx%2===1?"bg-slate-50/30":""}`} data-testid={`note-row-${n.id}`}>
                      <td className="py-3 px-4 font-bold">{n.title}</td>
                      <td className="py-3 px-4 text-slate-600">{n.client_name || "—"}</td>
                      <td className="py-3 px-4 text-slate-500">{folders.find(f=>f.id===n.folder_id)?.name || "—"}</td>
                      <td className="py-3 px-4 text-slate-500 text-xs">
                        <div>{n.created_by||"—"}</div>
                        <div>{new Date(n.created_at).toLocaleString()}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-500 text-xs">
                        <div>{n.created_by||"—"}</div>
                        <div>{new Date(n.created_at).toLocaleString()}</div>
                      </td>
                      <td className="py-3 px-4">
                        <button onClick={()=>setShowMembers(n)} className="mx-auto block w-10 h-12 bg-orange-100 hover:bg-orange-200 border border-orange-300 rounded flex items-center justify-center text-orange-600">
                          <UserIcon className="w-5 h-5"/>
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <button onClick={()=>setShowFiles(n)} className="mx-auto block w-10 h-12 bg-orange-100 hover:bg-orange-200 border border-orange-300 rounded flex items-center justify-center text-orange-600">
                          <Paperclip className="w-5 h-5"/>
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <button onClick={()=>setShowAdditional(n)} className="mx-auto block w-10 h-12 bg-orange-100 hover:bg-orange-200 border border-orange-300 rounded flex items-center justify-center text-orange-600">
                          <FileText className="w-5 h-5"/>
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <button onClick={()=>setShowListView(n)} className="mx-auto block w-8 h-8 bg-sky-400 hover:bg-sky-500 text-white rounded flex items-center justify-center">
                          <List className="w-4 h-4"/>
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex justify-center gap-1">
                          <button onClick={()=>{setEditing(n); setShowAdd(true);}} className="w-8 h-8 bg-sky-400 hover:bg-sky-500 text-white rounded flex items-center justify-center"><Edit3 className="w-4 h-4"/></button>
                          <button onClick={async()=>{ if(window.confirm("Delete?")){ await api.delete(`/notes/${n.id}`); load();}}} className="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded flex items-center justify-center"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </td>
                    </tr>
                    {n.body && (
                      <tr className={`border-b ${idx%2===1?"bg-slate-50/30":""}`}>
                        <td colSpan="10" className="py-2 px-4 text-xs text-slate-600">
                          <span className="font-bold">Description:</span> {n.body}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {notes.length > 0 && <div className="mt-2 text-xs text-slate-500 text-right">Showing : {notes.length}</div>}
      </div>

      {showAdd && <NoteEditorModal editing={editing} clients={clients} onClose={()=>{setShowAdd(false); load();}}/>}
      {showMembers && <NoteMembersModal note={showMembers} workers={workers} onClose={()=>{setShowMembers(null); load();}}/>}
      {showFiles && <NoteFilesModal note={showFiles} onClose={()=>{setShowFiles(null); load();}}/>}
      {showAdditional && <NoteAdditionalModal note={showAdditional} onClose={()=>{setShowAdditional(null); load();}}/>}
      {showListView && <NoteListModal note={showListView} onClose={()=>setShowListView(null)}/>}
    </div>
  );
}

function NoteEditorModal({ editing, clients, onClose }) {
  const [n, setN] = useState(editing || { title: "", body: "", client_id: "", folder_id: "", sub_location: "" });
  const [folders, setFolders] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (n.client_id) api.get(`/client-folders?client_id=${n.client_id}`).then(r => setFolders(r.data));
    else setFolders([]);
  }, [n.client_id]);

  const save = async () => {
    if (!n.title) { alert("Title required"); return; }
    setSaving(true);
    try {
      const payload = { ...n,
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
            <input value={n.title} onChange={e=>setN({...n,title:e.target.value})} className="w-full px-3 py-2 border rounded"/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-semibold mb-1">Client</label>
              <select value={n.client_id||""} onChange={e=>setN({...n,client_id:e.target.value,folder_id:""})} className="w-full px-3 py-2 border rounded">
                <option value="">— None —</option>
                {clients.slice(0,500).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
            <label className="block text-sm font-semibold mb-1">Sub Location</label>
            <input value={n.sub_location||""} onChange={e=>setN({...n,sub_location:e.target.value})} className="w-full px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Description / Body</label>
            <textarea value={n.body||""} onChange={e=>setN({...n,body:e.target.value})} rows="6" className="w-full px-3 py-2 border rounded"/>
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

function NoteMembersModal({ note, workers, onClose }) {
  const [selected, setSelected] = useState(note.member_ids || []);
  const [saving, setSaving] = useState(false);
  const toggle = (id) => setSelected(selected.includes(id) ? selected.filter(x=>x!==id) : [...selected, id]);
  const save = async () => {
    setSaving(true);
    await api.put(`/notes/${note.id}/members`, { member_ids: selected });
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-sm max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Members ({note.title})</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <label className="flex items-center gap-2 py-1.5 cursor-pointer">
            <input type="checkbox" checked={selected.length===workers.length && workers.length>0} onChange={e=>setSelected(e.target.checked?workers.map(w=>w.id):[])} className="accent-blue-500"/>
            Select/Unselect All
          </label>
          {workers.map(w => (
            <label key={w.id} className="flex items-center gap-2 py-1.5 cursor-pointer text-sm">
              <input type="checkbox" checked={selected.includes(w.id)} onChange={()=>toggle(w.id)} className="accent-blue-500"/>
              {w.name}
            </label>
          ))}
        </div>
        <div className="border-t p-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-3 py-2 border rounded text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-500 text-white font-bold rounded text-sm">{saving?"Saving...":"Save"}</button>
        </div>
      </div>
    </div>
  );
}

function NoteFilesModal({ note, onClose }) {
  const [files, setFiles] = useState(note.file_refs || []);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const add = () => {
    if (!name) return;
    setFiles([...files, { id: crypto.randomUUID(), name, url }]);
    setName(""); setUrl("");
  };
  const remove = (id) => setFiles(files.filter(f=>f.id!==id));
  const save = async () => {
    setSaving(true);
    await api.put(`/notes/${note.id}/files`, { file_refs: files });
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Files ({note.title})</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="File name" className="w-full px-3 py-2 border rounded text-sm"/>
          <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="URL (optional)" className="w-full px-3 py-2 border rounded text-sm"/>
          <button onClick={add} className="px-4 py-1.5 bg-blue-500 text-white font-bold rounded text-sm">ADD</button>
          <div className="border-t pt-3 space-y-1">
            {files.length===0 ? <div className="text-center text-slate-400 text-sm py-2">No files yet</div> :
              files.map(f => (
                <div key={f.id} className="flex items-center gap-2 p-2 border rounded">
                  <Paperclip className="w-4 h-4 text-orange-500"/>
                  <span className="flex-1 text-sm">{f.name}</span>
                  <button onClick={()=>remove(f.id)} className="text-red-500"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))
            }
          </div>
        </div>
        <div className="border-t p-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-3 py-2 border rounded text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-500 text-white font-bold rounded text-sm">{saving?"Saving...":"Save"}</button>
        </div>
      </div>
    </div>
  );
}

function NoteAdditionalModal({ note, onClose }) {
  const [items, setItems] = useState(note.additional_notes_list || []);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const add = () => {
    if (!text.trim()) return;
    setItems([...items, { id: crypto.randomUUID(), text: text.trim(), created_at: new Date().toISOString() }]);
    setText("");
  };
  const remove = (id) => setItems(items.filter(i=>i.id!==id));
  const save = async () => {
    setSaving(true);
    await api.put(`/notes/${note.id}/additional`, { additional_notes_list: items });
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Additional Notes ({note.title})</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <textarea value={text} onChange={e=>setText(e.target.value)} rows="2" placeholder="Additional note..." className="w-full px-3 py-2 border rounded text-sm"/>
          <button onClick={add} disabled={!text.trim()} className="px-4 py-1.5 bg-blue-500 text-white font-bold rounded text-sm disabled:opacity-50">ADD</button>
          <div className="border-t pt-3 space-y-1">
            {items.length===0 ? <div className="text-center text-slate-400 text-sm py-2">No additional notes yet</div> :
              items.map(i => (
                <div key={i.id} className="flex items-start gap-2 p-2 border rounded text-sm bg-slate-50">
                  <FileText className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0"/>
                  <span className="flex-1 whitespace-pre-wrap">{i.text}</span>
                  <button onClick={()=>remove(i.id)} className="text-red-500"><Trash2 className="w-3.5 h-3.5"/></button>
                </div>
              ))
            }
          </div>
        </div>
        <div className="border-t p-3 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-3 py-2 border rounded text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-500 text-white font-bold rounded text-sm">{saving?"Saving...":"Save"}</button>
        </div>
      </div>
    </div>
  );
}

function NoteListModal({ note, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{note.title}</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="font-bold text-slate-500 text-xs">CLIENT</div><div>{note.client_name || "—"}</div></div>
            <div><div className="font-bold text-slate-500 text-xs">SUB LOCATION</div><div>{note.sub_location || "—"}</div></div>
            <div><div className="font-bold text-slate-500 text-xs">CREATED BY</div><div>{note.created_by || "—"}</div></div>
            <div><div className="font-bold text-slate-500 text-xs">CREATED AT</div><div>{new Date(note.created_at).toLocaleString()}</div></div>
          </div>
          {note.body && (
            <div>
              <div className="font-bold text-slate-500 text-xs uppercase tracking-wider mb-1">Description</div>
              <div className="bg-slate-50 border rounded p-3 text-sm whitespace-pre-wrap">{note.body}</div>
            </div>
          )}
          {note.additional_notes_list && note.additional_notes_list.length > 0 && (
            <div>
              <div className="font-bold text-slate-500 text-xs uppercase tracking-wider mb-1">Additional Notes ({note.additional_notes_list.length})</div>
              <div className="space-y-2">
                {note.additional_notes_list.map(a => (
                  <div key={a.id} className="bg-amber-50 border border-amber-200 rounded p-2 text-sm">
                    <div className="whitespace-pre-wrap">{a.text}</div>
                    <div className="text-[10px] text-slate-400 mt-1">{new Date(a.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {note.file_refs && note.file_refs.length > 0 && (
            <div>
              <div className="font-bold text-slate-500 text-xs uppercase tracking-wider mb-1">Files ({note.file_refs.length})</div>
              <div className="space-y-1">
                {note.file_refs.map(f => (
                  <div key={f.id} className="flex items-center gap-2 p-2 border rounded text-sm">
                    <Paperclip className="w-4 h-4 text-orange-500"/>
                    {f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex-1">{f.name}</a> : <span className="flex-1">{f.name}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
