import React,{useEffect,useState} from 'react';
import api from '../../lib/api';
import PayrollPayslip from './PayrollPayslip';

export default function PayrollHistory({week,revision}) {
  const [items,setItems]=useState([]),[selected,setSelected]=useState(''),[worker,setWorker]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let active=true;setItems([]);setSelected('');setError('');
    api.get(`/payroll/workbench/${week}/history`).then(({data})=>{if(active)setItems(data.revisions);}).catch(()=>{if(active)setError('Could not load saved revisions.');});
    return()=>{active=false;};
  },[week,revision]);
  const item=items.find(i=>String(i.revision)===selected),rows=item?.report?.rows||[],row=rows.find(r=>r.worker_id===worker)||rows[0];
  return <details className="border rounded-xl p-4 my-4"><summary className="font-semibold cursor-pointer">Saved worksheet history</summary>
    <p className="text-sm my-3">View the last 10 saved revisions for this week. Historical previews use the names, figures and division branding captured when saved. These are review records, not issued payslips or proof of payment.</p>
    {error&&<p role="alert">{error}</p>}
    {!error&&!items.length&&<p className="text-sm">No saved revisions for this week.</p>}
    {!!items.length&&<label className="block text-sm">Saved revision<select className="border rounded p-2 m-2" value={selected} onChange={e=>{setSelected(e.target.value);setWorker('');}}><option value="">Choose a revision…</option>{items.map(i=><option key={i.revision} value={i.revision}>Revision {i.revision} · {i.worksheet.reviewed?'Reviewed':'Draft'} · {i.at}</option>)}</select></label>}
    {item&&<><p className="text-xs mb-3">Saved by {item.by} · Rules {item.rule_version||'Not recorded'}</p>
      {!item.branding&&<p className="text-sm mb-3">This older revision has no saved branding. Current branding is not substituted.</p>}
      {row?<><label className="block text-sm">Historical employee<select className="border rounded p-2 m-2" value={row.worker_id} onChange={e=>setWorker(e.target.value)}>{rows.map(r=><option key={r.worker_id} value={r.worker_id}>{r.name}</option>)}</select></label><PayrollPayslip row={row} sheet={item.worksheet} week={week} branding={item.branding} printable={false}/></>:<p>No workers saved in this revision.</p>}
    </>}
  </details>;
}
