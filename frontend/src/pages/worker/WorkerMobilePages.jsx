import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Clock, Play, Square, Coffee, Loader2, X, CheckCircle2, ChevronRight, Calendar,
  AlertOctagon, FileText, Send, Plus, ChevronLeft, BookOpen, Folder, Download, Search
} from "lucide-react";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem("pt_token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

const fmtTime = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const fmtMins = (m) => {
  if (!m) return "0h 0m";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${min}m`;
};

// ============== WORKER TIME SHEET (Mobile) ==============
export function WorkerTimeSheet({ user }) {
  const [active, setActive] = useState(null);
  const [workTypes, setWorkTypes] = useState([]);
  const [clients, setClients] = useState([]);
  const [recent, setRecent] = useState([]);
  const [showStartModal, setShowStartModal] = useState(false);
  const [tick, setTick] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const [a, w, c, r] = await Promise.all([
      api.get("/timesheets/me/open"),
      api.get("/work-types"),
      api.get("/clients"),
      api.get("/timesheets").then(rr => rr.data.slice(0, 20)).catch(() => []),
    ]);
    setActive(a.data && a.data.id ? a.data : null);
    setWorkTypes(w.data.filter(x => x.enabled !== false));
    setClients(c.data);
    setRecent(r);
  };
  useEffect(() => { load(); }, []);

  // Live ticker for elapsed time
  useEffect(() => {
    if (active && active.clock_in && !active.clock_out) {
      const t = setInterval(() => setTick(x => x + 1), 1000);
      return () => clearInterval(t);
    }
  }, [active]);

  const elapsedMinutes = active && active.clock_in ? Math.floor((Date.now() - new Date(active.clock_in).getTime()) / 60000) : 0;
  const onBreak = active?.breaks?.length > 0 && !active.breaks[active.breaks.length-1].end;

  const clockIn = async (body) => {
    const { data } = await api.post("/timesheets/clock-in", body);
    if (!data.ok) { alert(data.error || "Failed"); return; }
    setShowStartModal(false);
    load();
  };

  const clockOut = async () => {
    if (!window.confirm("Clock out now?")) return;
    if (onBreak) { alert("End your break first."); return; }
    await api.post(`/timesheets/${active.id}/clock-out`);
    load();
  };

  const startBreak = async (type) => {
    await api.post(`/timesheets/${active.id}/break/start`, { break_type: type });
    load();
  };
  const endBreak = async () => {
    await api.post(`/timesheets/${active.id}/break/end`);
    load();
  };

  const submitForApproval = async () => {
    setSubmitting(true);
    await api.post(`/timesheets/${active.id}/submit`);
    setSubmitting(false);
    load();
  };

  return (
    <div className="p-4 fadein space-y-4">
      <h2 className="text-xl font-black mb-1">Time Sheet</h2>

      {/* Active clock-in card */}
      {active ? (
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl p-5 shadow-xl">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 animate-pulse"/>
            <span className="text-xs font-bold tracking-widest opacity-80">CLOCKED IN</span>
          </div>
          <div className="text-4xl font-black tabular-nums">{fmtMins(elapsedMinutes)}</div>
          <div className="text-sm opacity-90 mt-1">
            Since {fmtTime(active.clock_in)}
          </div>
          {active.work_type_name && <div className="text-sm mt-2"><b>Type:</b> {active.work_type_name}</div>}
          {active.client_name && <div className="text-sm"><b>Client:</b> {active.client_name}</div>}
          {active.notes && <div className="text-xs italic mt-1 opacity-90">"{active.notes}"</div>}

          {onBreak && (
            <div className="mt-3 bg-amber-500/30 border border-amber-300/50 rounded-lg p-2 text-sm font-semibold">
              ☕ On break — started {fmtTime(active.breaks[active.breaks.length-1].start)}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mt-4">
            {onBreak ? (
              <button onClick={endBreak} className="col-span-2 py-3 bg-amber-500 hover:bg-amber-600 rounded-xl font-bold flex items-center justify-center gap-2" data-testid="end-break-btn">
                <Coffee className="w-5 h-5"/>End Break
              </button>
            ) : (
              <>
                <button onClick={()=>startBreak('unpaid')} className="py-2.5 bg-white/15 hover:bg-white/25 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5" data-testid="break-unpaid-btn">
                  <Coffee className="w-4 h-4"/>Unpaid Break
                </button>
                <button onClick={()=>startBreak('paid')} className="py-2.5 bg-white/15 hover:bg-white/25 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5" data-testid="break-paid-btn">
                  <Coffee className="w-4 h-4"/>Paid Break
                </button>
              </>
            )}
            <button onClick={clockOut} disabled={onBreak} className="col-span-2 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50" data-testid="clock-out-btn">
              <Square className="w-5 h-5"/>Clock Out
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white border-2 border-dashed rounded-2xl p-6 text-center">
          <Clock className="w-12 h-12 text-slate-300 mx-auto mb-2"/>
          <div className="text-slate-600 mb-3">Not clocked in</div>
          <button onClick={()=>setShowStartModal(true)} className="px-6 py-3 brand-grad text-black font-black rounded-xl flex items-center gap-2 mx-auto" data-testid="clock-in-btn">
            <Play className="w-5 h-5"/>CLOCK IN
          </button>
        </div>
      )}

      {/* Recent entries */}
      <div>
        <h3 className="font-bold text-slate-900 mb-2">Recent Entries</h3>
        {recent.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-6 bg-white rounded-xl border-2 border-dashed">No entries yet</div>
        ) : (
          <div className="space-y-2">
            {recent.map(e => {
              const statusColor = {
                open: 'bg-slate-100 text-slate-700',
                submitted: 'bg-blue-100 text-blue-700',
                approved: 'bg-emerald-100 text-emerald-700',
                rejected: 'bg-red-100 text-red-700',
              }[e.status] || 'bg-slate-100';
              return (
                <div key={e.id} className="bg-white border rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-sm">{e.entry_date}</div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold capitalize ${statusColor}`}>{e.status}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {fmtTime(e.clock_in)} - {fmtTime(e.clock_out)} · {fmtMins(e.paid_minutes)} paid
                  </div>
                  {e.work_type_name && <div className="text-xs text-slate-600 mt-1">{e.work_type_name}{e.client_name ? ` · ${e.client_name}` : ''}</div>}
                  {e.status === 'open' && e.clock_out && (
                    <button onClick={async()=>{setSubmitting(true); await api.post(`/timesheets/${e.id}/submit`); setSubmitting(false); load();}} className="mt-2 w-full py-1.5 bg-blue-500 text-white text-xs font-bold rounded">Submit for Approval</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showStartModal && <StartShiftModal workTypes={workTypes} clients={clients} onClose={()=>setShowStartModal(false)} onStart={clockIn}/>}
    </div>
  );
}

function StartShiftModal({ workTypes, clients, onClose, onStart }) {
  const [workTypeId, setWorkTypeId] = useState("");
  const [clientId, setClientId] = useState("");
  const [notes, setNotes] = useState("");
  const [starting, setStarting] = useState(false);
  const start = async () => {
    setStarting(true);
    await onStart({ work_type_id: workTypeId || null, client_id: clientId || null, notes: notes || null });
    setStarting(false);
  };
  // Only PrimaryPayCategory work types (not leave)
  const primary = workTypes.filter(w => w.mapping_type !== 'LeaveCategory');
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white rounded-t-3xl md:rounded-2xl w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="brand-grad px-5 py-4 flex items-center justify-between text-black">
          <h3 className="text-lg font-bold">Start Shift</h3>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-1">Work Type</label>
            <select value={workTypeId} onChange={e=>setWorkTypeId(e.target.value)} className="w-full px-3 py-3 border rounded-xl text-base" data-testid="ts-work-type">
              <option value="">— Standard Hours —</option>
              {primary.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Client / Project</label>
            <select value={clientId} onChange={e=>setClientId(e.target.value)} className="w-full px-3 py-3 border rounded-xl text-base">
              <option value="">— None —</option>
              {clients.slice(0, 500).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Notes (optional)</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows="2" placeholder="What are you doing today?" className="w-full px-3 py-3 border rounded-xl text-base"/>
          </div>
        </div>
        <div className="border-t p-4 bg-slate-50">
          <button onClick={start} disabled={starting} className="w-full py-3.5 brand-grad text-black font-black rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50" data-testid="ts-start-btn">
            {starting ? <Loader2 className="w-5 h-5 animate-spin"/> : <Play className="w-5 h-5"/>}START SHIFT
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== WORKER LEAVE REQUESTS (Mobile) ==============
export function WorkerLeave({ user }) {
  const [requests, setRequests] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    setLoading(true);
    const [r, c] = await Promise.all([
      api.get("/leave-requests/me"),
      api.get("/leave-categories"),
    ]);
    setRequests(r.data);
    setCategories(c.data.filter(x => x.enabled !== false));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const cancel = async (id) => {
    if (!window.confirm("Cancel this leave request?")) return;
    await api.delete(`/leave-requests/${id}`);
    load();
  };

  return (
    <div className="p-4 fadein space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black">Leave Requests</h2>
        <button onClick={()=>setShowNew(true)} className="px-3 py-2 brand-grad text-black text-sm font-bold rounded-lg flex items-center gap-1" data-testid="new-leave-btn">
          <Plus className="w-4 h-4"/>Request Leave
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin inline"/></div>
      ) : requests.length === 0 ? (
        <div className="bg-white border-2 border-dashed rounded-2xl p-8 text-center">
          <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-2"/>
          <div className="text-slate-600 text-sm mb-3">No leave requests yet</div>
          <button onClick={()=>setShowNew(true)} className="px-5 py-2.5 brand-grad text-black font-bold rounded-xl">+ Request Leave</button>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map(r => {
            const statusMap = {
              pending: { color: 'bg-amber-100 text-amber-800 border-amber-200', icon: Clock },
              approved: { color: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: CheckCircle2 },
              rejected: { color: 'bg-red-100 text-red-800 border-red-200', icon: AlertOctagon },
              cancelled: { color: 'bg-slate-100 text-slate-600 border-slate-200', icon: X },
            };
            const m = statusMap[r.status] || statusMap.pending;
            return (
              <div key={r.id} className={`bg-white border rounded-xl p-3`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-bold text-sm">{r.category_name}</div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize border ${m.color} flex items-center gap-1`}>
                    <m.icon className="w-3 h-3"/>{r.status}
                  </span>
                </div>
                <div className="text-xs text-slate-600">{r.start_date} → {r.end_date}{r.half_day ? ' (½ day)' : ''}</div>
                {r.reason && <div className="text-xs text-slate-500 italic mt-1">"{r.reason}"</div>}
                {r.approver_notes && <div className="text-xs bg-slate-50 border-l-2 border-slate-300 px-2 py-1 mt-1.5 italic"><b>{r.approver_name}:</b> {r.approver_notes}</div>}
                <div className="text-[10px] text-slate-400 mt-2">Submitted {new Date(r.submitted_at).toLocaleString()}</div>
                {r.status === 'pending' && (
                  <button onClick={()=>cancel(r.id)} className="mt-2 w-full py-1.5 text-red-600 border border-red-200 text-xs font-bold rounded">Cancel Request</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showNew && <RequestLeaveModal categories={categories} onClose={()=>{setShowNew(false); load();}}/>}
    </div>
  );
}

function RequestLeaveModal({ categories, onClose }) {
  const [categoryId, setCategoryId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!categoryId || !startDate || !endDate) { alert("Category, start and end dates required"); return; }
    setSaving(true);
    try {
      await api.post("/leave-requests", {
        id: crypto.randomUUID(),
        worker_id: "self",
        category_id: categoryId,
        start_date: startDate, end_date: endDate,
        half_day: halfDay, reason,
        submitted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      onClose();
    } catch (e) { alert("Failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white rounded-t-3xl md:rounded-2xl w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="brand-grad px-5 py-4 flex items-center justify-between text-black">
          <h3 className="text-lg font-bold">Request Leave</h3>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-1">Leave Category <span className="text-red-500">*</span></label>
            <select value={categoryId} onChange={e=>setCategoryId(e.target.value)} className="w-full px-3 py-3 border rounded-xl text-base" data-testid="leave-cat-select">
              <option value="">— Select —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-semibold mb-1">From <span className="text-red-500">*</span></label>
              <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="w-full px-3 py-3 border rounded-xl text-base" data-testid="leave-start"/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">To <span className="text-red-500">*</span></label>
              <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="w-full px-3 py-3 border rounded-xl text-base" data-testid="leave-end"/>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={halfDay} onChange={e=>setHalfDay(e.target.checked)} className="w-5 h-5 accent-blue-500"/>
            Half day
          </label>
          <div>
            <label className="block text-sm font-semibold mb-1">Reason (optional)</label>
            <textarea value={reason} onChange={e=>setReason(e.target.value)} rows="3" placeholder="e.g. Family event, medical appointment" className="w-full px-3 py-3 border rounded-xl text-base"/>
          </div>
        </div>
        <div className="border-t p-4 bg-slate-50">
          <button onClick={submit} disabled={saving} className="w-full py-3.5 brand-grad text-black font-black rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50" data-testid="leave-submit-btn">
            {saving ? <Loader2 className="w-5 h-5 animate-spin"/> : <Send className="w-5 h-5"/>}SUBMIT REQUEST
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== WORKER DOCUMENTS (Mobile read-only library) ==============
export function WorkerDocs() {
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [search, setSearch] = useState("");
  useEffect(() => {
    api.get("/doc-categories").then(r => setCategories(r.data));
  }, []);
  if (activeCategory) return <WorkerDocCategoryView category={activeCategory} onBack={()=>setActiveCategory(null)}/>;
  const filtered = search ? categories.filter(c => c.name.toLowerCase().includes(search.toLowerCase())) : categories;
  return (
    <div className="p-4 fadein">
      <h2 className="text-xl font-black mb-3">Documents</h2>
      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400"/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search folders…" className="w-full pl-9 pr-3 py-2.5 border rounded-xl"/>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {filtered.filter(c => c.doc_count > 0 || true).map(c => (
          <button key={c.id} onClick={()=>setActiveCategory(c)}
            className="bg-white rounded-xl p-4 border text-left active:scale-95 transition shadow-sm"
            data-testid={`worker-doc-cat-${c.slug}`}>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-2"
              style={{ backgroundColor: (c.color || '#64748B') + '20' }}>
              <Folder className="w-5 h-5" style={{ color: c.color || '#64748B' }}/>
            </div>
            <div className="font-bold text-sm leading-tight line-clamp-2">{c.name}</div>
            <div className="text-[10px] text-slate-400 mt-1">{c.doc_count || 0} file{c.doc_count===1?"":"s"}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkerDocCategoryView({ category, onBack }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    setLoading(true);
    api.get(`/documents?category=${category.slug}`).then(r => { setDocs(r.data); setLoading(false); });
  }, [category.slug]);
  return (
    <div className="p-4 fadein">
      <button onClick={onBack} className="text-sm text-slate-500 flex items-center gap-1 mb-3" data-testid="worker-doc-back">
        <ChevronLeft className="w-4 h-4"/>Back
      </button>
      <h2 className="text-xl font-black mb-3">{category.name}</h2>
      {loading ? (
        <div className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin inline"/></div>
      ) : docs.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-8 bg-white rounded-xl border-2 border-dashed">No documents yet</div>
      ) : (
        <div className="space-y-2">
          {docs.map(d => (
            <button key={d.id} onClick={()=>setSelected(d)} className="w-full bg-white border rounded-xl p-3 text-left active:scale-[0.98] transition" data-testid={`worker-doc-${d.id}`}>
              <div className="flex items-start gap-2">
                <FileText className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5"/>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{d.name}</div>
                  {d.ai_summary && <div className="text-xs text-slate-500 line-clamp-2">{d.ai_summary}</div>}
                  {d.ai_doc_type && <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">{d.ai_doc_type}</span>}
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400"/>
              </div>
            </button>
          ))}
        </div>
      )}
      {selected && <WorkerDocViewer doc={selected} onClose={()=>setSelected(null)}/>}
    </div>
  );
}

function WorkerDocViewer({ doc, onClose }) {
  const [full, setFull] = useState(null);
  useEffect(() => { api.get(`/documents/${doc.id}`).then(r => setFull(r.data)); }, [doc.id]);
  const dataUrl = full?.content_b64;
  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white rounded-t-3xl md:rounded-2xl w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="border-b px-4 py-3 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate">{doc.name}</div>
            <div className="text-xs text-slate-500">{doc.ai_doc_type}</div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {doc.ai_summary && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 text-sm">
              <div className="font-bold text-amber-900 mb-1">Summary</div>
              {doc.ai_summary}
            </div>
          )}
          {!full ? (
            <div className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin inline"/></div>
          ) : doc.file_type === "pdf" && dataUrl ? (
            <iframe src={dataUrl} className="w-full h-[55vh] border rounded" title={doc.name}/>
          ) : doc.file_type === "image" && dataUrl ? (
            <img src={dataUrl} alt={doc.name} className="max-w-full mx-auto rounded"/>
          ) : doc.file_type === "txt" && dataUrl ? (
            <pre className="text-xs bg-slate-50 p-3 rounded whitespace-pre-wrap">{atob(dataUrl.split(',')[1] || '')}</pre>
          ) : (
            <div className="text-center py-8">
              <FileText className="w-16 h-16 text-slate-300 mx-auto mb-3"/>
              <div className="text-sm text-slate-600">Tap Download to view</div>
            </div>
          )}
          {dataUrl && (
            <a href={dataUrl} download={doc.name} className="mt-3 w-full py-2.5 brand-grad text-black font-bold rounded-xl flex items-center justify-center gap-2">
              <Download className="w-4 h-4"/>Download
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
