import React,{useEffect,useState} from 'react';
import api from '../../lib/api';
import PayrollPayslip from './PayrollPayslip';
export default function PayrollArchive({week,revision,canArchive}) {
 const [records,setRecords]=useState([]),[selected,setSelected]=useState(''),[worker,setWorker]=useState(''),[reason,setReason]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setRecords([]);setSelected('');setMessage('');api.get(`/payroll/workbench/${week}/archive`).then(({data})=>{if(active)setRecords(data.records);}).catch(()=>{if(active)setMessage('Could not load archived records.');});return()=>{active=false;};},[week,revision]);
 async function archive(){setBusy(true);setMessage('');try{await api.post(`/payroll/workbench/${week}/archive`,{revision,correction_reason:reason});const {data}=await api.get(`/payroll/workbench/${week}/archive`);setRecords(data.records);setSelected(String(revision));setMessage('Reviewed snapshot archived. No payment, payslip issue, leave posting or reporting submission occurred.');}catch(e){setMessage(typeof e.response?.data?.detail==='string'?e.response.data.detail:'Could not archive this revision.');}finally{setBusy(false);}}
 const record=records.find(r=>String(r.revision)===selected),snapshot=record?.snapshot,rows=snapshot?.report?.rows||[],row=rows.find(r=>r.worker_id===worker)||rows[0];
 return <details className="border rounded-xl p-4 my-4"><summary className="font-semibold cursor-pointer">Archived reviewed runs</summary>
 <p className="text-sm my-3">Save a separate, read-only snapshot of a reviewed worksheet. These records stay available after the recent 10-revision history rolls over. Changes to the working worksheet do not replace an archived snapshot.</p>
 <p className="text-sm mb-3">Archiving does not close statutory payroll or confirm payment. Make any correction in the worksheet, review it, then archive the new revision with a reason.</p>
 <label className="block text-sm">Correction reason<textarea className="border rounded p-2 block w-full" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <button type="button" disabled={busy||!canArchive} className="border rounded px-3 py-2 my-3 disabled:opacity-40" onClick={archive}>Archive reviewed revision</button>
 {!canArchive&&<p className="text-xs">Save a reviewed worksheet before archiving.</p>}
 {message&&<p role="status" className="text-sm my-2">{message}</p>}
 <label className="block text-sm">Archived revision<select className="border rounded p-2 m-2" value={selected} onChange={e=>{setSelected(e.target.value);setWorker('');}}><option value="">Choose an archived record…</option>{records.map(r=><option key={r.revision} value={r.revision}>Revision {r.revision} · {r.archived_at}</option>)}</select></label>
 {record&&<><p className="text-sm">Archived by {record.archived_by}. {record.correction_reason&&`Correction: ${record.correction_reason}`}</p><label className="block text-sm">Archived employee<select className="border rounded p-2 m-2" value={row?.worker_id||''} onChange={e=>setWorker(e.target.value)}>{rows.map(r=><option key={r.worker_id} value={r.worker_id}>{r.name}</option>)}</select></label>{row&&<PayrollPayslip row={row} sheet={snapshot.worksheet} week={week} branding={snapshot.branding} printable={false}/>}</>}
 </details>;
}
