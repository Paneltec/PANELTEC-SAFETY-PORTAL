import React,{useEffect,useState} from 'react';
import api,{apiError} from '../../lib/api';
import {payBtn,payBtnStyle} from './PayShell';
export default function PayrollLeavePanel({week,row,onChange}) {
  const [requests,setRequests]=useState([]),[amounts,setAmounts]=useState({}),[error,setError]=useState('');
  async function refresh(){try{const {data}=await api.get(`/payroll/workbench/${week}/approved-leave`);setRequests(data.requests);setError('');}catch(e){setError(apiError(e)||'Could not load approved leave');}}
  useEffect(()=>{refresh();},[week]);
  const linked=row.leave_sources||[];
  function apply(r){const amount=Number(amounts[r.id]??(r.entirely_in_week?r.hours:''));if(!amount||amount<0){setError('Enter the approved hours that belong in this pay week.');return;}
    onChange({...row,entry:{...row.entry,[r.pay_category]:Number(row.entry[r.pay_category])+amount,hours_reviewed:false},leave_sources:[...linked,{leave_id:r.id,fingerprint:r.fingerprint,category:r.pay_category,hours:amount}]});}
  function remove(a){onChange({...row,entry:{...row.entry,[a.category]:Math.max(0,Number(row.entry[a.category])-a.hours),hours_reviewed:false},leave_sources:linked.filter(v=>v.leave_id!==a.leave_id)});}
  return <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2 text-sm"><div className="flex justify-between gap-2"><strong>Approved leave from the phone and portal</strong><button type="button" onClick={refresh} className="text-blue-700 underline">Refresh requests</button></div><p>Only approved requests for this worker and week appear. Check rostered hours, public holidays and any hours already entered before adding them. Requests spanning weeks need a separate allocation for each week.</p>{error&&<p role="alert" className="text-red-800">{typeof error==='string'?error:JSON.stringify(error)}</p>}
    {requests.filter(r=>r.worker_id===row.worker_id).length===0&&<p>No approved requests for this worker in this week.</p>}
    {requests.filter(r=>r.worker_id===row.worker_id).map(r=><div key={r.id} className="bg-white rounded p-2 flex flex-wrap items-center gap-2"><span className="flex-1">{r.leave_type} · {r.start_date} to {r.end_date} · {r.hours} h requested</span>{!r.pay_category?<span>Requires separate payroll treatment ({r.category})</span>:linked.some(a=>a.leave_id===r.id)?<span className="text-green-800">Linked below</span>:<><label>This week’s hours<input type="number" min="0" step="0.1" className="border rounded p-1 w-24 ml-2" value={amounts[r.id]??(r.entirely_in_week?r.hours:'')} onChange={e=>setAmounts({...amounts,[r.id]:e.target.value})}/></label><button type="button" className={payBtn('ghost')} style={payBtnStyle('ghost')} onClick={()=>apply(r)}>Add leave hours</button></>}</div>)}
    {linked.map(a=><div key={a.leave_id} className="flex justify-between"><span>Linked {a.category} leave: {a.hours} hours</span><button type="button" className="underline" onClick={()=>remove(a)}>Remove linked hours</button></div>)}
    <a className="text-blue-700 underline" href="/app/leave" target="_blank" rel="noreferrer">Open existing Leave Requests approvals</a>
  </div>;
}
