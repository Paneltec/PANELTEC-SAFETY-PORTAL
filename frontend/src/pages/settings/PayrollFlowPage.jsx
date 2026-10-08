import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiError } from '../../lib/api';
import { getUser } from '../../lib/auth';

const areas = ['Phone app', 'Office portal', 'Global settings', 'External providers'];
const states = ['Not checked', 'Working', 'Needs attention', 'Not connected', 'Not required'];
const colours = {'Not checked':'#64748b', Working:'#15803d', 'Needs attention':'#c2410c', 'Not connected':'#be123c', 'Not required':'#71717a'};
const seeds = [
  ['Company and divisions','Global settings','Confirm employer details, ABN, Paneltec Civil / Viatec Traffic, Friday week start and payment dates.','/app/pay/settings'],
  ['Current employees and pay rates','Global settings','Match current approved employees, salary or hourly basis, casual loading and saved imported rates.','/app/pay/employees'],
  ['Tax declarations and opening balances','Global settings','Confirm each declaration, tax-free threshold and HELP adjustments. Import leave and financial-year opening balances at the agreed start date.','/app/pay/employees'],
  ['Pay categories, work types and shift rules','Global settings','Connect work types to pay categories. Check ordinary hours, overtime, night shifts, public holidays, meal allowances and deductions.','/app/pay/settings'],
  ['Super, banking and provider setup','Global settings','Global super rate and effective dates; employee fund, USI and membership; bank details; clearing-house, STP and Xero connections. Verify each connection.','/app/pay/settings'],
  ['Access and accountant invitation','Office portal','Verify who can view, edit and approve payroll; accountant invitation and accepted access.','/app/pay/access'],
  ['Employee enters time','Phone app','Search Simpro client/job, choose work type, enter start/finish, breaks and notes. Test keypad entry and overnight shifts.','/app/phone-preview'],
  ['Employee submits timesheet and leave','Phone app','Test submission, pending status and leave requests. Confirm employees can see returned entries and correct them.','/app/phone-preview'],
  ['Office reviews submissions','Office portal','Review and edit times, breaks, client, job and work type. Approve or return with a reason; verify the employee receives feedback.','/app/pay/timesheets'],
  ['Office approves leave','Office portal','Check available annual/personal leave and approve requests; confirm approved leave reaches the correct pay period.','/app/leave'],
  ['Create pay run','Office portal','Choose division first, period and payment date. Normal weekly run or separate out-of-cycle run for selected employees.','/app/pay'],
  ['Load approved hours and employee rates','Office portal','Verify imported employee rates and approved time reach the pay run once, with correct work-type mapping and no duplicate hours.','/app/pay'],
  ['Check each employee pay','Office portal','Verify ordinary, overtime and allowances; live gross, PAYG, deductions, net and employer super. Check this-pay and YTD totals and leave accrual.','/app/pay'],
  ['Approve payroll totals','Office portal','Review each employee, then reconcile division totals, missing setup and exception warnings before finalising.','/app/pay'],
  ['Bank payment and confirmation','External providers','Create bank payment file, upload through the bank, reconcile the outcome and record payment confirmation. File creation alone is not payment.','/app/pay'],
  ['Payslips and employee history','Phone app','After confirmed completion, verify payslip PDF, email delivery, phone history, tax, super, leave and YTD figures.','/app/phone-preview'],
  ['STP reporting and acknowledgement','External providers','Verify approved provider submission, accepted/rejected feedback and correction process. A created report is not an acknowledgement.','/app/pay'],
  ['Super clearing-house payment','External providers','Check contributions by employee, submit through the clearing house and reconcile receipt or rejected contributions.','/app/pay'],
  ['Xero and job costing','External providers','Verify accounting journal, accounts mapping and wages/hours by division, client and job. Confirm provider acknowledgement.','/app/pay'],
  ['Reports, reconciliation and records','Office portal','Reconcile bank, tax and super totals; check pay-run report feedback icons, saved history, access and record retention.','/app/pay'],
];
const defaults = () => seeds.map(([title,area,notes,link],i)=>({id:`step-${i+1}`,title,area,notes,link,status:'Not checked'}));
const input = 'w-full border rounded-lg px-3 py-2 bg-white text-sm';
export default function PayrollFlowPage() {
  const [steps,setSteps]=useState([]), [revision,setRevision]=useState(0), [loaded,setLoaded]=useState(false);
  const [dirty,setDirty]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState(''), [message,setMessage]=useState('');
  const [editing,setEditing]=useState(null), [drag,setDrag]=useState(null), [history,setHistory]=useState([]);
  const admin=getUser()?.role==='admin';
  useEffect(()=>{if(!admin)return;api.get('/program-schematic/payroll-flow').then(({data})=>{setSteps(data.steps??defaults());setRevision(data.revision);setLoaded(true);}).catch(e=>setError(apiError(e)));},[admin]);
  useEffect(()=>{const warn=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  function change(next){setHistory(h=>[...h.slice(-29),steps]);setSteps(next);setDirty(true);setMessage('');}
  function update(id,key,value){change(steps.map(s=>s.id===id?{...s,[key]:value}:s));}
  function move(id,index){const from=steps.findIndex(s=>s.id===id);if(from<0||index<0||index>=steps.length||from===index)return;const next=[...steps];const [item]=next.splice(from,1);next.splice(index,0,item);change(next);}
  async function save(){setBusy(true);setError('');try{const {data}=await api.put('/program-schematic/payroll-flow',{revision,steps});setRevision(data.revision);setDirty(false);setMessage('Flow chart saved for your organisation.');}catch(e){setError(apiError(e));}finally{setBusy(false);}}
  function download(){const url=URL.createObjectURL(new Blob([JSON.stringify({revision,steps},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='paneltec-payroll-flow.json';a.click();URL.revokeObjectURL(url);}
  if(!admin)return <p className="p-6">Admin access required.</p>;
  return <main className="p-4 md:p-7 max-w-6xl mx-auto text-slate-800">
    <div className="rounded-2xl p-6 text-white mb-5" style={{background:'#1d3f64'}}><p className="text-orange-300 text-xs tracking-widest font-bold">ADMIN · PANELTEC PAY</p><h1 className="text-2xl font-bold mt-2">Payroll process flow</h1><p className="mt-2 text-sm">From the phone app to the office, payment and reporting. Edit, add and rearrange the steps to match your process.</p></div>
    <p className="text-sm mb-4">This is your planning and testing checklist. Statuses are recorded by you, not automatic proof that a feature works. Editing this chart does not change payroll calculations or send payments.</p>
    {error&&<p role="alert" className="p-3 bg-red-50 text-red-800 rounded mb-3">{error}</p>}
    {message&&<p role="status" className="p-3 bg-green-50 text-green-800 rounded mb-3">{message}</p>}
    {!loaded?<p>Loading flow chart…</p>:<>
    <div className="flex flex-wrap items-center gap-3 sticky top-0 z-10 bg-white border rounded-xl p-3 mb-4">
      <button className="bg-orange-500 text-white font-semibold rounded-lg px-4 py-2" disabled={busy} onClick={save}>{busy?'Saving…':'Save flow chart'}</button>
      <button className="border rounded-lg px-3 py-2" disabled={busy||steps.length>=150} onClick={()=>{const s={id:crypto.randomUUID(),title:'New step',area:'Office portal',status:'Not checked',notes:'',link:''};change([...steps,s]);setEditing(s.id);}}>Add step</button>
      <button className="border rounded-lg px-3 py-2" disabled={busy||!history.length} onClick={()=>{setSteps(history[history.length-1]);setHistory(history.slice(0,-1));setDirty(true);}}>Undo</button>
      <button className="border rounded-lg px-3 py-2" onClick={download}>Export chart</button>
      <span className="text-sm text-slate-500">{dirty?'Unsaved changes':revision?'Saved':'Starter chart — save to keep it'} · {steps.filter(s=>s.status==='Working').length}/{steps.length} working</span>
    </div>
    <div className="flex flex-wrap gap-3 text-xs mb-5">{states.map(s=><span key={s} style={{color:colours[s]}}>● {s}: {steps.filter(x=>x.status===s).length}</span>)}</div>
    <ol aria-label="Payroll sequence" className="space-y-0">{steps.map((s,i)=><li key={s.id}>
      {i>0&&<div aria-hidden="true" className="text-center text-2xl text-slate-400 py-1">↓</div>}
      <article aria-label={`Step ${i+1}: ${s.title}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();move(drag,i);setDrag(null);}} className="bg-white border rounded-xl p-4 shadow-sm" style={{borderLeft:`5px solid ${colours[s.status]}`}}>
        <div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-slate-100 px-3 py-1 font-bold">{i+1}</span><span className="uppercase text-xs font-bold text-slate-500">{s.area}</span><span className="text-xs font-bold" style={{color:colours[s.status]}}>{s.status}</span>
        <div className="ml-auto flex gap-2 text-sm"><button draggable={!busy} onDragStart={()=>setDrag(s.id)} aria-label={`Drag ${s.title}`} title="Drag this step to another position">⠿</button><button disabled={busy||i===0} onClick={()=>move(s.id,i-1)} aria-label={`Move ${s.title} up`}>↑</button><button disabled={busy||i===steps.length-1} onClick={()=>move(s.id,i+1)} aria-label={`Move ${s.title} down`}>↓</button><button disabled={busy} className="text-blue-700" onClick={()=>setEditing(editing===s.id?null:s.id)}>{editing===s.id?'Done':'Edit'}</button></div></div>
        <h2 className="font-semibold text-lg mt-2">{s.title}</h2>
        {editing===s.id?<fieldset disabled={busy} className="grid md:grid-cols-2 gap-3 mt-3">
          <label className="text-sm">Step name<input className={input} maxLength={160} value={s.title} onChange={e=>update(s.id,'title',e.target.value)}/></label>
          <label className="text-sm">Area<select className={input} value={s.area} onChange={e=>update(s.id,'area',e.target.value)}>{areas.map(a=><option key={a}>{a}</option>)}</select></label>
          <label className="text-sm">Working status<select className={input} value={s.status} onChange={e=>update(s.id,'status',e.target.value)}>{states.map(a=><option key={a}>{a}</option>)}</select></label>
          <label className="text-sm">App link (optional)<input className={input} placeholder="/app/pay" maxLength={200} value={s.link} onChange={e=>update(s.id,'link',e.target.value)}/></label>
          <label className="text-sm md:col-span-2">Features, test evidence and outstanding work<textarea className={input} rows={3} maxLength={4000} value={s.notes} onChange={e=>update(s.id,'notes',e.target.value)}/></label>
          <button className="text-red-700 text-sm text-left" onClick={()=>{change(steps.filter(x=>x.id!==s.id));setEditing(null);}}>Remove step (Undo available)</button>
        </fieldset>:<p className="text-sm text-slate-600 whitespace-pre-wrap mt-2">{s.notes}</p>}
        {/^\/app\/[a-zA-Z0-9/_-]*$/.test(s.link)&&<Link className="inline-block text-sm text-blue-700 mt-3 underline" to={s.link} target="_blank" rel="noopener noreferrer">Open section ↗</Link>}
      </article>
    </li>)}</ol>
    {!steps.length&&<p className="p-6">Your chart is empty. Add a step to begin.</p>}
    </>}
  </main>;
}
