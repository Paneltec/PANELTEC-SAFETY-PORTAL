import React from 'react';
import {createPortal} from 'react-dom';
const money=n=>n==null?'Needs review':new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n);
export default function PayrollPayslip({row,sheet,week,branding,printable=true}) {
  const division=branding?.[branding?.assignments?.[row.worker_id]];
  const r=row.result,e=row.entry,p=row.profile;
  const end=new Date(`${week}T12:00:00`);end.setDate(end.getDate()+6);
  const endText=end.toLocaleDateString('en-AU');
  const lines=[['Ordinary hours',e.ordinary,p.hourly_rate,r.ordinary_pay],['Overtime tier 1',e.ot1,p.hourly_rate*sheet.rules.ot1_multiplier,r.ot1_pay],['Overtime tier 2',e.ot2,p.hourly_rate*sheet.rules.ot2_multiplier,r.ot2_pay],['Annual leave',e.annual,p.hourly_rate,r.annual_pay],['Personal / carer’s leave',e.personal,p.hourly_rate,r.personal_pay],['Public holiday',e.public_holiday,p.hourly_rate,r.public_holiday_pay],['Annual leave loading',null,null,r.leave_loading],['Taxable allowances',null,null,r.taxable_allowances]].filter((l,i)=>i===0||l[1]||l[3]);
  const statement = (
    <article id={printable?"payroll-draft-payslip":undefined} className="pay-statement bg-white max-w-4xl overflow-hidden rounded-xl border">
      <header className="flex justify-between gap-4 p-6 text-white" style={{background:"#1e1b4b",borderBottom:"6px solid #f5a000"}}><div>{division?.logo&&<img src={division.logo} alt={`${division.name} logo`} className="h-16 max-w-64 object-contain mb-2"/>}<h5 className="text-2xl font-bold">{division?.name||branding?.employer_name||'Draft pay statement'}</h5><p className="text-sm">Employer: {branding?.employer_name||'Not configured'} · ABN: {branding?.employer_abn||'Not configured'}</p></div><strong className="text-amber-300 text-xs">DRAFT · NOT ISSUED</strong></header>
      <div className="p-6"><div className="grid sm:grid-cols-2 gap-3 mb-4 text-sm"><div><strong>{row.name}</strong><p>Employee reference: {row.worker_id}</p><p>Employment: {p.employment_type?.replaceAll('_',' ')}</p></div><div><p>Pay period: {week} to {endText}</p><p>Scheduled pay date: {sheet.payday}</p><p>Worksheet revision: {sheet.revision||'Unsaved'}</p></div></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">{[["Gross",r.gross],["PAYG",r.payg],["Super",r.super],["Net payment",r.net]].map(([label,value])=><div key={label} className="rounded-xl p-3" style={{background:"#f4f2fb"}}><small>{label}</small><strong className="block text-lg">{money(value)}</strong></div>)}</div><table className="w-full text-sm"><thead className="bg-slate-100"><tr><th className="text-left p-2">Earnings</th><th className="text-right p-2">Hours</th><th className="text-right p-2">Rate</th><th className="text-right p-2">Amount</th></tr></thead><tbody>{lines.map(([label,qty,rate,amount])=><tr key={label} className="border-b"><td className="p-2">{label}</td><td className="text-right p-2">{qty==null?'—':Number(qty).toFixed(2)}</td><td className="text-right p-2">{rate==null?'—':money(rate)}</td><td className="text-right p-2">{money(amount)}</td></tr>)}</tbody></table>
      <dl className="grid grid-cols-2 gap-2 my-4 text-sm">{[['Gross earnings',r.gross],['PAYG withheld',r.payg],['Other deductions (details required)',r.deductions],['Expense reimbursements',r.reimbursements],['Net wages',r.net],['Intended employer super contribution',r.super]].map(([label,amount])=><React.Fragment key={label}><dt className={label==='Net wages'?'font-bold':''}>{label}</dt><dd className="text-right font-semibold">{money(amount)}</dd></React.Fragment>)}</dl>
      <p className="text-sm">Super fund: {p.super_fund_name||'Not configured'}{p.super_fund_usi?` · USI: ${p.super_fund_usi}`:''}</p>
      <p className="text-sm whitespace-pre-wrap">Deduction particulars: {e.deduction_details||(r.deductions?'Not configured':'No deductions entered')}</p><div className="border-t mt-4 pt-3 text-sm"><strong>Projected leave balances</strong><p>Annual: {r.annual_closing==null?'Needs review':Number(r.annual_closing).toFixed(2)+' hours'} · Personal/carer’s: {r.personal_closing==null?'Needs review':Number(r.personal_closing).toFixed(2)+' hours'}</p></div>
      {r.issues.length>0&&<div className="mt-3 text-sm"><strong>Review items</strong><ul className="list-disc pl-5">{r.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></div>}
      <footer className="border-t mt-4 pt-3 text-xs">Preview only. No wage payment or super contribution is confirmed by this document. Employer details, individual deduction particulars, super fund details and the payslip issuing workflow must be completed before issuing employee payslips. Do not distribute this draft as an issued payslip.</footer></div>
    </article>
  );
  return <>
    <style>{`#payroll-print-root {display:none} @media print {body > *:not(#payroll-print-root) {display:none!important} #payroll-print-root {display:block!important;color:black;background:white} #payroll-print-root article {max-width:none;border:0;padding:0} #payroll-print-root table {width:100%;border-collapse:collapse} #payroll-print-root tr {break-inside:avoid} @page {size:A4;margin:15mm}}`}</style>
    {printable&&<button type="button" onClick={()=>window.print()} className="border rounded-lg px-3 py-2 mb-3 text-sm">Print / save draft as PDF</button>}
    {statement}
    {printable&&createPortal(<div id="payroll-print-root">{React.cloneElement(statement,{id:undefined})}</div>,document.body)}
  </>;
}
