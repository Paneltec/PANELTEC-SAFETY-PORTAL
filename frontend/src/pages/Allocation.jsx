import React, { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Trash2, X, Loader2, ArrowRight, ChevronLeft, ChevronRight, Bell, Send, Mail, FileText } from "lucide-react";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use((c) => {
  const t = localStorage.getItem("pt_token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

const fmtDate = (d) => d.toISOString().slice(0,10);
const dayLabel = (d) => d.toLocaleDateString('en-AU', { weekday: 'long' });
const ddmmyyyy = (d) => d.toLocaleDateString('en-GB').replace(/\//g, '/');

function getWeekRange(anchor) {
  const day = anchor.getDay(); // 0 sun .. 6 sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(anchor); start.setDate(start.getDate() + mondayOffset);
  start.setHours(0,0,0,0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

export default function AllocationPage() {
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [allocs, setAllocs] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [clients, setClients] = useState([]);
  const [filterClient, setFilterClient] = useState("");
  const [filterMember, setFilterMember] = useState("");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [defaultDate, setDefaultDate] = useState("");
  const [notifying, setNotifying] = useState(false);
  const [notifyResult, setNotifyResult] = useState(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [emailingPdf, setEmailingPdf] = useState(false);
  const [sendOnAllocate, setSendOnAllocate] = useState(false);

  const days = getWeekRange(weekAnchor);
  const start = fmtDate(days[0]);
  const end = fmtDate(days[6]);
  const today = fmtDate(new Date());

  const load = async () => {
    const q = new URLSearchParams({ start, end });
    if (filterClient) q.set("client_id", filterClient);
    if (filterMember) q.set("member_id", filterMember);
    const { data } = await api.get(`/allocations?${q.toString()}`);
    let filtered = data;
    if (search) {
      const v = search.toLowerCase();
      filtered = filtered.filter(a =>
        (a.member_name||'').toLowerCase().includes(v) ||
        (a.client_name||'').toLowerCase().includes(v) ||
        (a.skill||'').toLowerCase().includes(v)
      );
    }
    setAllocs(filtered);
  };
  useEffect(() => {
    api.get("/workers").then(r => setWorkers(r.data));
    api.get("/clients").then(r => setClients(r.data));
  }, []);
  useEffect(() => { load(); }, [start, end, filterClient, filterMember]);

  const goPrev = () => { const d = new Date(weekAnchor); d.setDate(d.getDate()-7); setWeekAnchor(d); };
  const goNext = () => { const d = new Date(weekAnchor); d.setDate(d.getDate()+7); setWeekAnchor(d); };
  const goToday = () => setWeekAnchor(new Date());

  const allocsByDay = days.map(d => {
    const ds = fmtDate(d);
    return allocs.filter(a => a.booking_date === ds);
  });

  const openAddForDate = (date) => {
    setEditing(null); setDefaultDate(date); setShowAdd(true);
  };

  const sendNotifications = async () => {
    setNotifying(true); setNotifyResult(null);
    try {
      const { data } = await api.post("/allocations/notify", { start, end }, { timeout: 120000 });
      setNotifyResult(data);
      load();
    } catch (e) {
      setNotifyResult({ ok: false, error: e?.response?.data?.detail || e.message });
    }
    setNotifying(false);
  };

  const emailPdf = async () => {
    const recipients = window.prompt("Email schedule PDF to (comma-separated):");
    if (!recipients) return;
    setEmailingPdf(true);
    try {
      const { data } = await api.post("/allocations/email-pdf", {
        start, end, recipients: recipients.split(",").map(s=>s.trim()).filter(Boolean)
      }, { timeout: 60000 });
      alert(data.ok ? "✓ PDF emailed successfully" : `Failed: ${data.error || data.response || 'unknown'}`);
    } catch (e) { alert("Failed: " + (e?.response?.data?.detail || e.message)); }
    setEmailingPdf(false);
  };

  return (
    <div className="fadein">
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-slate-900">Manage Allocation</h1>
        <button onClick={()=>{setEditing(null); setDefaultDate(today); setShowAdd(true);}}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-sm flex items-center gap-2"
          data-testid="new-allocation-btn">
          <Plus className="w-4 h-4"/>ADD NEW
        </button>
      </div>

      <div className="px-6 py-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-sm font-bold mb-1">Client</label>
            <select value={filterClient} onChange={e=>setFilterClient(e.target.value)} className="w-full px-3 py-2 border rounded bg-white">
              <option value="">Select</option>
              {clients.slice(0,500).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Member</label>
            <select value={filterMember} onChange={e=>setFilterMember(e.target.value)} className="w-full px-3 py-2 border rounded bg-white">
              <option value="">Select</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Client Name, Member Name, Skill" className="w-full px-3 py-2 border rounded"/>
            </div>
            <button onClick={load} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-sm">SEARCH</button>
            <button onClick={()=>{setFilterClient(''); setFilterMember(''); setSearch(''); setTimeout(load,50);}} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded">
              <ArrowRight className="w-4 h-4 rotate-90"/>
            </button>
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="accent-blue-500"/>Sub Location
        </label>
      </div>

      {/* Week navigation + action buttons */}
      <div className="px-6 py-3 border-y bg-slate-50 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={goToday} className="px-3 py-1.5 border rounded bg-white text-sm font-semibold">TODAY</button>
          <button className="px-2 py-1.5 border rounded bg-white"><Bell className="w-4 h-4"/></button>
          <button onClick={goPrev} className="px-2 py-1.5 border rounded bg-white"><ChevronLeft className="w-4 h-4"/></button>
          <button onClick={goNext} className="px-2 py-1.5 border rounded bg-white"><ChevronRight className="w-4 h-4"/></button>
          <span className="ml-2 text-sm font-semibold text-slate-700">{ddmmyyyy(days[0])} - {ddmmyyyy(days[6])}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={sendOnAllocate} onChange={e=>setSendOnAllocate(e.target.checked)} className="accent-blue-500"/>
            Send Notifications When Allocated
          </label>
          <button onClick={()=>setShowSchedule(true)} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded" data-testid="schedule-notif-btn">SCHEDULE NOTIFICATIONS</button>
          <button onClick={sendNotifications} disabled={notifying} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded flex items-center gap-1 disabled:opacity-50" data-testid="send-all-notif-btn">
            {notifying ? <Loader2 className="w-3 h-3 animate-spin"/> : <Send className="w-3 h-3"/>}SEND ALL NOTIFICATIONS NOW
          </button>
          <button onClick={emailPdf} disabled={emailingPdf} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded flex items-center gap-1 disabled:opacity-50" data-testid="email-pdf-btn">
            {emailingPdf ? <Loader2 className="w-3 h-3 animate-spin"/> : <Mail className="w-3 h-3"/>}EMAIL PDF
          </button>
        </div>
      </div>

      {notifyResult && (
        <div className={`mx-6 mt-3 p-3 rounded border text-sm ${notifyResult.ok?"bg-emerald-50 border-emerald-200":"bg-red-50 border-red-200"}`}>
          {notifyResult.ok ? (
            <>✓ Notified <b>{notifyResult.members_notified}</b> members · <b>{notifyResult.sms_sent}</b> SMS sent · <b>{notifyResult.email_sent}</b> emails sent
            {notifyResult.errors?.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer">{notifyResult.errors.length} errors</summary><ul className="ml-4">{notifyResult.errors.map((e,i)=><li key={i}>{e}</li>)}</ul></details>}</>
          ) : <>⚠ {notifyResult.error}</>}
        </div>
      )}

      {/* Week grid */}
      <div className="px-6 py-4">
        <div className="grid grid-cols-7 border rounded-lg overflow-hidden bg-white shadow-sm">
          {days.map((d, i) => {
            const ds = fmtDate(d);
            const isToday = ds === today;
            return (
              <div key={ds} onClick={()=>openAddForDate(ds)} className={`${isToday?"bg-emerald-600":"bg-cyan-400"} text-white text-center p-3 cursor-pointer hover:opacity-90 border-r last:border-r-0`}>
                <div className="text-lg font-bold">{ddmmyyyy(d)}</div>
                <div className="text-xs">{dayLabel(d)}{isToday ? " (Today)" : ""}</div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-7 border-x border-b rounded-b-lg overflow-hidden bg-white">
          {allocsByDay.map((list, i) => (
            <div key={i} className="border-r last:border-r-0 min-h-[140px] p-2 space-y-1 text-xs">
              {list.length === 0 ? (
                <div className="text-slate-400 text-center pt-12 italic">No booking</div>
              ) : list.map(a => (
                <button key={a.id} onClick={()=>{setEditing(a); setShowAdd(true);}}
                  className="w-full text-left bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded p-1.5">
                  <div className="font-bold text-blue-900 truncate">{a.member_name}</div>
                  <div className="text-blue-700 truncate">{a.client_name || "—"}</div>
                  <div className="text-blue-600 text-[10px]">{a.start_time}-{a.end_time}</div>
                  {a.skill && <div className="text-blue-500 text-[10px] truncate">{a.skill}</div>}
                  {a.notified_at && <div className="text-emerald-600 text-[9px]">✓ Notified</div>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {showAdd && <AllocationModal editing={editing} defaultDate={defaultDate} workers={workers} clients={clients} sendOnAllocate={sendOnAllocate} onClose={()=>{setShowAdd(false); load();}}/>}
      {showSchedule && <ScheduleNotifModal start={start} end={end} onClose={()=>setShowSchedule(false)}/>}
    </div>
  );
}

function AllocationModal({ editing, defaultDate, workers, clients, sendOnAllocate, onClose }) {
  const [a, setA] = useState(editing || { member_id: "", client_id: "", booking_date: defaultDate, start_time: "07:00", end_time: "15:00", skill: "", sub_location: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!a.member_id || !a.booking_date) { alert("Member and booking date required"); return; }
    setSaving(true);
    try {
      const payload = { ...a,
        id: editing?.id || crypto.randomUUID(),
        member_name: workers.find(w=>w.id===a.member_id)?.name,
        client_name: clients.find(c=>c.id===a.client_id)?.name,
        created_at: editing?.created_at || new Date().toISOString(),
      };
      if (editing) await api.put(`/allocations/${editing.id}`, payload);
      else await api.post("/allocations", payload);
      // If auto-notify on allocate, send right away for this single date
      if (sendOnAllocate && !editing) {
        try {
          await api.post("/allocations/notify", { start: a.booking_date, end: a.booking_date });
        } catch {}
      }
      onClose();
    } catch (e) { alert("Save failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };
  const remove = async () => {
    if (!editing) return;
    if (!window.confirm("Delete this allocation?")) return;
    await api.delete(`/allocations/${editing.id}`);
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{editing ? "Edit Allocation" : "Add Allocation"}</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-1">Date <span className="text-red-500">*</span></label>
            <input type="date" value={a.booking_date} onChange={e=>setA({...a,booking_date:e.target.value})} className="w-full px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Member <span className="text-red-500">*</span></label>
            <select value={a.member_id} onChange={e=>setA({...a,member_id:e.target.value})} className="w-full px-3 py-2 border rounded">
              <option value="">— Select —</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Client</label>
            <select value={a.client_id||""} onChange={e=>setA({...a,client_id:e.target.value})} className="w-full px-3 py-2 border rounded">
              <option value="">— None —</option>
              {clients.slice(0,500).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-semibold mb-1">Start Time</label>
              <input type="time" value={a.start_time} onChange={e=>setA({...a,start_time:e.target.value})} className="w-full px-3 py-2 border rounded"/>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">End Time</label>
              <input type="time" value={a.end_time} onChange={e=>setA({...a,end_time:e.target.value})} className="w-full px-3 py-2 border rounded"/>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Skill</label>
            <input value={a.skill||""} onChange={e=>setA({...a,skill:e.target.value})} placeholder="e.g. Traffic Controller, Plumber" className="w-full px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Sub Location</label>
            <input value={a.sub_location||""} onChange={e=>setA({...a,sub_location:e.target.value})} className="w-full px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Notes</label>
            <textarea value={a.notes||""} onChange={e=>setA({...a,notes:e.target.value})} rows="2" className="w-full px-3 py-2 border rounded"/>
          </div>
        </div>
        <div className="border-t p-3 flex justify-end gap-2 bg-slate-50">
          {editing && <button onClick={remove} className="px-4 py-2 text-red-600 border border-red-200 rounded mr-auto">Delete</button>}
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduleNotifModal({ start, end, onClose }) {
  const [cadence, setCadence] = useState("specific_day");
  const [scope, setScope] = useState("this_week");
  const [time, setTime] = useState("06:00");
  const [days, setDays] = useState({ monday: true, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: false, sunday: false });
  const [schedules, setSchedules] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = () => api.get("/allocations/notif-schedules").then(r => setSchedules(r.data));
  useEffect(() => { load(); }, []);

  const toggleDay = (d) => setDays({ ...days, [d]: !days[d] });
  const selectAll = (val) => {
    const all = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    setDays(all.reduce((a, d) => ({ ...a, [d]: val }), {}));
  };

  const add = async () => {
    const selectedDays = Object.entries(days).filter(([_,v])=>v).map(([k])=>k);
    if (selectedDays.length === 0) { alert("Pick at least one day"); return; }
    setSaving(true);
    try {
      await api.post("/allocations/notif-schedules", {
        id: crypto.randomUUID(),
        range_start: start, range_end: end,
        cadence, scope,
        notification_time: time,
        days_of_week: selectedDays,
        created_at: new Date().toISOString(),
      });
      load();
    } catch (e) { alert("Failed: " + (e?.response?.data?.detail || e.message)); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="bg-sky-500 text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Schedule Notifications: {start} - {end}</h2>
          <button onClick={onClose} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="flex flex-wrap gap-3 text-sm">
            {[
              {v:"previous_day", l:"Previous Day"},
              {v:"specific_day", l:"Specific Day"},
              {v:"weekly", l:"Weekly"},
              {v:"monthly", l:"Monthly"},
            ].map(o => (
              <label key={o.v} className="flex items-center gap-1.5">
                <input type="radio" name="cadence" checked={cadence===o.v} onChange={()=>setCadence(o.v)} className="accent-blue-500"/>{o.l}
              </label>
            ))}
          </div>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="scope" checked={scope==="this_week"} onChange={()=>setScope("this_week")} className="accent-blue-500"/>This Week
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="scope" checked={scope==="all_weeks"} onChange={()=>setScope("all_weeks")} className="accent-blue-500"/>All Weeks
            </label>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Notification Time</label>
            <input type="time" value={time} onChange={e=>setTime(e.target.value)} className="px-3 py-2 border rounded"/>
          </div>
          <div>
            <label className="block text-sm font-bold mb-2">Booking Of</label>
            <div className="flex flex-wrap gap-3 bg-blue-50 border rounded p-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={Object.values(days).every(v=>v)} onChange={e=>selectAll(e.target.checked)} className="accent-blue-500"/>Select All
              </label>
              {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => (
                <label key={d} className="flex items-center gap-1.5 capitalize">
                  <input type="checkbox" checked={days[d]} onChange={()=>toggleDay(d)} className="accent-blue-500"/>{d}
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={add} disabled={saving} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded">
              {saving ? "..." : "ADD"}
            </button>
          </div>
          <div className="border-t pt-3">
            <div className="bg-slate-700 text-white px-3 py-2 rounded-t font-bold flex items-center justify-between">
              <span>Scheduled Notifications</span><span>Action</span>
            </div>
            <div className="border border-t-0 rounded-b max-h-48 overflow-y-auto">
              {schedules.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">No scheduled notifications yet.</div>
              ) : schedules.map(s => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 border-b last:border-0 text-sm">
                  <div>
                    <span className="font-semibold">{s.cadence}</span> · {s.scope} · {s.notification_time} · {(s.days_of_week||[]).join(', ')}
                  </div>
                  <button onClick={async()=>{ await api.delete(`/allocations/notif-schedules/${s.id}`); load(); }} className="text-red-500"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
