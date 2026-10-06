import React, {useState,useEffect} from 'react';
import PayrollPayslip from './PayrollPayslip';
import PayrollBranding from './PayrollBranding';
import PayrollReadiness from './PayrollReadiness';
import api from '../../lib/api';
import {divisionRows,reportTotal} from './payrollReportHelpers';
const money = value => value == null ? 'Needs review' : new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(value);
const fields = {
  pay: [['gross','Gross'],['payg','PAYG'],['deductions','Deductions'],['reimbursements','Reimbursements'],['net','Net wages'],['super','Super']],
  payg: [['gross','Gross'],['payg','PAYG withheld']],
  super: [['super','Super contribution']],
  leave: [['annual_accrued','Annual accrued (h)'],['annual_closing','Annual closing (h)'],['annual_base_value','Annual base value'],['personal_accrued','Personal accrued (h)'],['personal_closing','Personal closing (h)']]
};
const items = [['pay','Pay report'],['payslip','Payslip preview'],['payg','PAYG report'],['super','Super report'],['leave','Leave balances'],['stp','STP reporting']];
export default function PayrollReports({report,sheet,week,dirty,busy,onCalculate,onDownload,sealedBranding}) {
  const [tab,setTab]=useState('pay'),[person,setPerson]=useState('');
  const [branding,setBranding]=useState(null),[division,setDivision]=useState('all');
  useEffect(()=>{api.get('/payroll/workbench/branding').then(({data})=>setBranding(data.settings)).catch(()=>setBranding(null));},[]);
  const effectiveBranding=sealedBranding||branding;
  const rows=divisionRows(report?.rows||[],effectiveBranding?.assignments,division),row=rows.find(r=>r.worker_id===person)||rows[0];
  return <section className="border rounded-xl bg-white p-4 mb-5" aria-label="Payroll report centre">
    <PayrollBranding onSaved={setBranding}/>
    <PayrollReadiness sheet={sheet} report={report} branding={effectiveBranding} dirty={dirty}/>
    <h3 className="text-lg font-bold">Reports and documents</h3>
    <p className="text-sm text-slate-600 mb-3">Choose an item to view this week’s figures. These documents use the current calculated worksheet.</p>
    <label className="block text-sm mb-3">Report division <select className="border rounded p-2 ml-2" value={division} onChange={e=>setDivision(e.target.value)}><option value="all">All divisions</option><option value="paneltec">{branding?.paneltec?.name||'Paneltec Civil'}</option><option value="viatec">{branding?.viatec?.name||'Viatec'}</option><option value="unassigned">Not assigned</option></select></label>
    <p className="text-xs mb-3">{rows.length} workers shown · Division assignments use the current payroll settings.</p>
    <div className="flex flex-wrap gap-2 mb-4">{items.map(([key,label])=><button type="button" key={key} aria-pressed={tab===key} onClick={()=>setTab(key)} className={`rounded-lg border px-3 py-2 text-sm ${tab===key?'bg-indigo-900 text-white':'bg-white text-slate-800'}`}>{label}</button>)}</div>
    <div role="region" aria-label={items.find(i=>i[0]===tab)[1]} className="border-t pt-4">
      <div className="flex flex-wrap justify-between gap-2 mb-3"><h4 className="font-bold">{items.find(i=>i[0]===tab)[1]}</h4><span className="text-xs bg-amber-50 px-2 py-1 rounded">{dirty?'UNSAVED PREVIEW':sheet?.reviewed&&report?.ready?'REVIEWED WORKSHEET — NOT PAID':'DRAFT — NOT PAID'}</span></div>
      <p className="text-sm mb-3">Week starting {week||'—'} · Pay date {sheet?.payday||'—'}</p>
      {tab==='stp'?<div className="bg-slate-50 rounded-lg p-4"><strong>ATO connection not configured</strong><p className="text-sm mt-2">No STP report has been lodged. Provider setup, employee tax information, STP categories, year-to-date balances and submission validation are still required.</p><p className="text-sm mt-2">The PAYG report is available for reconciliation. It is not an STP submission file or an ATO receipt.</p></div>:!report||!rows.length?<div className="p-5 bg-slate-50 rounded-lg"><p>{dirty?'The worksheet changed. Calculate it again to refresh this document.':division!=='all'?'No workers in this worksheet match the selected division.':'Add workers and enter hours to populate this document.'}</p><button type="button" disabled={busy||!sheet?.rows?.length} className="mt-3 border rounded-lg px-3 py-2 disabled:opacity-40" onClick={onCalculate}>Calculate reports</button></div>:tab==='payslip'?<>
        <p className="text-sm bg-amber-50 p-3 rounded-lg mb-3">Draft earnings statement only — not an issued or statutory payslip. Employer particulars, required payslip details and the issuing workflow are not yet complete.</p>
        <label className="text-sm">Employee <select className="border rounded p-2 mb-3" value={row.worker_id} onChange={e=>setPerson(e.target.value)}>{rows.map(r=><option key={r.worker_id} value={r.worker_id}>{r.name}</option>)}</select></label>
        <PayrollPayslip row={row} sheet={sheet} week={week} branding={effectiveBranding}/>
      </>:<>
        {tab==='super'&&<p className="text-sm bg-blue-50 p-3 rounded-lg mb-3">Contribution review report. This CSV is not yet a CareSuper / QuickSuper upload file; no contributions have been submitted or paid.</p>}
        {tab==='leave'&&<p className="text-sm mb-3">Projected balances only. Annual leave value uses base pay; balances have not been posted to a leave ledger.</p>}
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-100"><tr><th className="text-left p-2">Employee</th>{fields[tab].map(([k,l])=><th className="text-right p-2" key={k}>{l}</th>)}<th className="p-2">Review</th></tr></thead><tbody>{rows.map(r=><tr className="border-b" key={r.worker_id}><th className="text-left p-2 font-medium">{r.name}</th>{fields[tab].map(([k])=><td className="text-right p-2 whitespace-nowrap" key={k}>{tab==='leave'&&k!=='annual_base_value'?(r.result[k]==null?'Needs review':Number(r.result[k]).toFixed(2)):money(r.result[k])}</td>)}<td className="p-2">{r.result.issues.length?`${r.result.issues.length} items to check`:'Checked'}</td></tr>)}</tbody><tfoot className="bg-slate-100 font-semibold"><tr><th className="text-left p-2">Totals ({rows.length} workers)</th>{fields[tab].map(([key])=>{const total=reportTotal(rows,key);return <td key={key} className="text-right p-2">{tab==='leave'&&key!=='annual_base_value'?(total==null?'Needs review':total.toFixed(2)):money(total)}</td>;})}<td /></tr></tfoot></table></div>
        <button type="button" disabled={busy||dirty||!sheet?.revision} onClick={()=>onDownload(tab)} className="mt-4 border rounded-lg px-3 py-2 disabled:opacity-40">Download full-week {items.find(i=>i[0]===tab)[1]} CSV</button>
        {division!=='all'&&<p className="text-xs mt-2">The saved CSV includes all divisions; the filter above applies to this on-screen report and payslip selector.</p>}
        {(dirty||!sheet?.revision)&&<p className="text-xs mt-2">Save the worksheet before downloading its report.</p>}
      </>}
    </div>
  </section>;
}
