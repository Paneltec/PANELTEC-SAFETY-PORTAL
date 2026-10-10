import React,{useEffect,useState} from 'react';
import api from '../../lib/api';
import {Link} from 'react-router-dom';
const money=v=>v==null?'Pending':new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(v);
export default function PayrollCalculationPanel({row,result,sheet,week,sealedBranding,onRefreshTax,busy=false}){
 const [context,setContext]=useState(null);
 useEffect(()=>{let active=true;setContext(null);api.get(`/payroll/employee-records/${encodeURIComponent(row.worker_id)}/pay-context/${week}`,{params:{payday:sheet.payday}}).then(r=>{if(active)setContext(r.data);}).catch(()=>{});return()=>{active=false;};},[row.worker_id,week,sheet.payday]);
 const employer=sealedBranding||context?.employer;
 const total=keys=>!result||keys.some(k=>result[k]==null)?null:keys.reduce((n,k)=>n+Number(result[k]),0);
 const line=(label,value,strong=false)=><div className={strong?'pay-slip-row pay-slip-total':'pay-slip-row'} key={label}><dt>{label}</dt><dd>{value==null?<span className="pay-status-chip">Pending</span>:money(value)}</dd></div>;
 return <aside className="pay-panel pay-calculation-panel" aria-label="Employee pay breakdown">
 <p className="pay-slip-employer">{employer?.employer_name||'Pending'} · ABN {employer?.employer_abn||'Pending'}</p>
 <h3>Pay slip preview</h3><p>Draft</p>
 <h4 className="pay-slip-heading">Earnings</h4><dl>
 {line('Ordinary pay',result?.ordinary_pay)}{line('Other earnings',result?.other_earnings??0)}
 {line('Overtime & penalties',total(['ot1_pay','ot2_pay','night_pay','holiday_work_pay']))}
 {line('Leave + loading',total(['annual_pay','personal_pay','public_holiday_pay','leave_loading']))}
 {line('Allowances',total(['taxable_allowances','meal_allowance_pay','configured_allowances']))}
 {line('Gross',result?.gross,true)}
 </dl><h4 className="pay-slip-heading">Tax & deductions</h4><dl>
 {line('PAYG withholding',result?.payg)}
 {line('Salary sacrifice',null)}
 {line('Other deductions',result?.deductions)}
 {line('Reimbursements',result?.reimbursements)}
 {line('Net pay',result?.net,true)}
 </dl><dl className="pay-slip-super-line">{line('Super',result?.super)}</dl>
 {result?.payg==null&&<div className="pay-slip-links"><Link to={`/app/pay/employees?worker=${encodeURIComponent(row.worker_id)}`} target="_blank" rel="noopener noreferrer">Tax settings</Link>{onRefreshTax&&<button type="button" disabled={busy} onClick={onRefreshTax}>Refresh tax</button>}</div>}
 </aside>;
}
