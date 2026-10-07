import React,{useEffect,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import api from '../../lib/api';
import PayWorkbench from './PayWorkbench';
export default function PayrollReportPage({mode}){
 const [params,setParams]=useSearchParams(),[runs,setRuns]=useState([]),[error,setError]=useState('');
 useEffect(()=>{api.get('/payroll/workbench/runs/list').then(r=>setRuns(r.data.runs)).catch(()=>setError('Could not load saved pay runs.'));},[]);
 const week=params.get('week')||'';
 return <><label className="block text-sm mb-5">Pay run<select className="border rounded p-2 ml-3" value={week} onChange={e=>setParams(e.target.value?{week:e.target.value}:{})}><option value="">Choose a saved pay run</option>{week&&!runs.some(r=>r.week===week)&&<option value={week}>{week} · current run</option>}{runs.map(r=><option key={r.week} value={r.week}>{r.week} · payment {r.payday}</option>)}</select></label>{error&&<p role="alert">{error}</p>}{week?<PayWorkbench key={mode+week} mode={mode}/>:<div className="pay-panel"><h3>{mode==='super'?'Pay super':'Pay reports'}</h3><p>Select a saved pay run to see its reports and completion status.</p></div>}</>;
}
