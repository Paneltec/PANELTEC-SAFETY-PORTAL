import PayrollTimesheetDays from './PayrollTimesheetDays';
import DateField from './DateField';
import {useSearchParams,Link} from 'react-router-dom';
import React, { useEffect, useState } from 'react';
import api, { apiError } from '../../lib/api';
import { PayCard, payBtn, payBtnStyle } from './PayShell';
import PayrollBankPanel from './PayrollBankPanel';
import PayrollLeavePanel from './PayrollLeavePanel';
import PayrollConnections from './PayrollConnections';
import PayrollReports from './PayrollReports';
import PayrollHistory from './PayrollHistory';
import PayrollArchive from './PayrollArchive';
import PayrollLifecycle from './PayrollLifecycle';
import PayrollIssuing from './PayrollIssuing';
import PayrollEmployeeRecord from './PayrollEmployeeRecord';

const money = n => n == null ? 'Needs review' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
const hours = n => n == null ? 'Not entered' : `${Number(n).toFixed(2)} h`;
function currentFriday() { const d = new Date(); d.setDate(d.getDate() - (d.getDay() + 2) % 7); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
const profile = { employment_type:'unconfirmed', hourly_rate:0, ordinary_weekly_hours:38, classification:'', conditions_reviewed:false, tax_mode:'unconfirmed', tax_declaration_reviewed:false, annual_weeks:4, personal_weeks:2, leave_loading_percent:0 };
const entry = { ordinary:0, ot1:0, ot2:0, annual:0, personal:0, public_holiday:0, taxable_allowances:0, post_tax_deductions:0, reimbursements:0, extra_withholding:0, manual_payg:null, payg_reference:'', qualifying_earnings:null, super_reviewed:false, hours_reviewed:false, opening_annual:null, opening_personal:null };
const inputClass = 'w-full border rounded-lg px-3 py-2 bg-white text-slate-900';
function NumberField({ label, value, onChange, nullable=false, min=0 }) { return <label className="text-sm block">{label}<input className={inputClass} type="number" min={min} step="any" value={value ?? ''} onChange={e => onChange(e.target.value === '' && nullable ? null : Number(e.target.value))} /></label>; }
function Check({children, checked, onChange}) { return <label className="flex gap-2 text-sm items-start py-2"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} className="mt-1"/>{children}</label>; }

export default function PayWorkbench() {
  const [searchParams]=useSearchParams();
  const [submitted,setSubmitted]=useState({});
  const [locked,setLocked]=useState(false),[sealedBranding,setSealedBranding]=useState(null);
  const [week,setWeek] = useState(currentFriday), [loadedWeek,setLoadedWeek] = useState('');
  const [sheet,setSheet] = useState(null), [workers,setWorkers] = useState([]), [report,setReport] = useState(null);
  const [selected,setSelected] = useState(''), [query,setQuery] = useState(''), [busy,setBusy] = useState(false);
  const [dirty,setDirty] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState(''), [sources,setSources] = useState([]);
  async function load(target) {
    setBusy(true); setError('');
    try { const [loaded,feed]=await Promise.all([api.get(`/payroll/workbench/${target}`),api.get(`/payroll/workbench/${target}/submissions`)]);const data=loaded.data; setSheet(data.worksheet); setSealedBranding(data.finalized_branding||null); setWorkers(data.workers); setReport(data.report); setSources(data.sources); setSubmitted(feed.data.workers); setLoadedWeek(target); setSelected(data.worksheet.rows[0]?.worker_id || ''); setDirty(false); setMessage(data.saved_at ? `Saved ${new Date(data.saved_at).toLocaleString('en-AU')}` : 'Current Simpro employees loaded. Submitted hours are estimates for review; no missing days or balances are assumed.'); }
    catch(e) { setError(apiError(e) || 'Could not load payroll worksheet'); } finally { setBusy(false); }
  }
  useEffect(()=>{const target=searchParams.get('week');if(target){setWeek(target);load(target);}},[searchParams]);
  useEffect(()=>{ const f=e=>{if(dirty){e.preventDefault();e.returnValue='';}}; window.addEventListener('beforeunload',f); return()=>window.removeEventListener('beforeunload',f); },[dirty]);
  function change(next) { setSheet({...next, reviewed:false}); setDirty(true); setReport(null); setMessage('Unsaved changes — calculate and save to refresh reports.'); }
  function patchRow(section,key,value) { change({...sheet, rows:sheet.rows.map(r=>r.worker_id===selected ? {...r,[section]:{...r[section],[key]:value}} : r)}); }
  async function calculate(save=false, reviewed=false) {
    setBusy(true); setError('');
    try { const body={...sheet, reviewed}; const {data}=save ? await api.put(`/payroll/workbench/${loadedWeek}`,body) : await api.post(`/payroll/workbench/${loadedWeek}/preview`,body);
      setReport(save ? data.report : data); if(save){setSheet({...body,revision:data.revision});setDirty(false);} setMessage(save ? `${reviewed ? 'Reviewed' : 'Draft'} worksheet saved. No payments, STP or leave-ledger changes made.` : 'Calculated preview. Save before downloading reports.');
    } catch(e){setError(apiError(e)||'Calculation failed');}finally{setBusy(false);}
  }
  async function download(kind) {
    setBusy(true);setError('');
    try {const {data}=await api.get(`/payroll/workbench/${loadedWeek}/report/${kind}`,{responseType:'blob'});const url=URL.createObjectURL(data);const a=document.createElement('a');a.href=url;a.download=`paneltec-${kind}-${loadedWeek}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError('Could not download the saved report.');}finally{setBusy(false);}
  }
  async function refreshHours(){
    if(!window.confirm('Replace this employee worked/public-holiday hours with the latest submissions? Other adjustments and leave stay unchanged.'))return;
    setBusy(true);try{const {data}=await api.get(`/payroll/workbench/${loadedWeek}/submissions`);setSubmitted(data.workers);const source=data.workers[selected];change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?{...r,timesheet_fingerprint:source?.fingerprint||'',entry:{...r.entry,ordinary:0,ot1:0,ot2:0,public_holiday:0,...source?.totals,hours_reviewed:false,super_reviewed:false}}:r)});}catch(e){setError(apiError(e)||'Could not refresh submitted hours');}finally{setBusy(false);}
  }
  const row=sheet?.rows.find(r=>r.worker_id===selected), result=report?.rows.find(r=>r.worker_id===selected)?.result;
  const btn=(label,fn,disabled=false,gold=false)=><button type="button" disabled={busy||disabled} onClick={fn} className={payBtn(gold?'gold':'ghost')} style={payBtnStyle(gold?'gold':'ghost')}>{label}</button>;
  if(!searchParams.get('week')&&!loadedWeek)return <PayCard title="Choose a pay run"><Link className="text-indigo-700 underline" to="/app/pay">Start a new pay run or open a saved run</Link></PayCard>;
  return <PayCard title="Review pay run - employees and submitted hours">
    <p className="text-sm text-slate-600 mb-3">Monday–Friday · 38 ordinary hours · Thursday payday. Prepare pay, PAYG, super and leave reports for your workers.</p>
    <Link className="text-indigo-700 underline text-sm" to="/app/pay">Back to pay runs and history</Link>
    <PayrollLifecycle week={loadedWeek||week} revision={sheet?.revision||0} dirty={dirty} onReload={load} onLocked={setLocked}/>
    <PayrollIssuing key={loadedWeek} week={loadedWeek||week} revision={sheet?.revision||0} workers={workers} dirty={dirty} locked={locked}/>
    <PayrollReports sealedBranding={sealedBranding} report={report} sheet={sheet} week={loadedWeek} dirty={dirty} busy={busy} onCalculate={()=>calculate()} onDownload={download}/>
    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm mb-4"><strong>Payroll review stage.</strong> This workspace calculates and saves worksheets. It does not transfer wages, lodge Single Touch Payroll or send super. Complete pay run emails payslips after payment is confirmed and issuing is enabled. Compare initial runs with Wojo before switching. No enterprise agreement does not mean award-free; confirm each worker’s award and classification.</div>
    <div className="flex flex-wrap gap-3 items-end mb-4"><label className="text-sm">Week starting<DateField className={inputClass} value={week} onChange={e=>setWeek(e.target.value)}/></label>{btn('Open week',()=>{if(!dirty||window.confirm('Discard unsaved worksheet changes?'))load(week);},!week)}<span className="text-sm text-slate-600">Currently editing: {loadedWeek || 'Loading…'}</span></div>
    {error&&<p role="alert" className="bg-red-50 text-red-800 p-3 rounded-lg my-3">{typeof error==='string'?error:JSON.stringify(error)}</p>}
    {sheet&&<fieldset disabled={busy||locked} className="space-y-4 min-w-0">
      <div className="grid sm:grid-cols-4 gap-3"><label className="text-sm">Payday<DateField className={inputClass} value={sheet.payday} onChange={e=>change({...sheet,payday:e.target.value})}/></label>{[['ot1_multiplier','Overtime tier 1 multiplier'],['ot2_multiplier','Overtime tier 2 multiplier'],['super_percent','Super contribution %']].map(([key,label])=><NumberField key={key} label={label} min={key==='super_percent'?12:1} value={sheet.rules[key]} onChange={v=>change({...sheet,rules:{...sheet.rules,[key]:v}})}/>)}</div>
      <p className="text-xs text-slate-600">New runs default to Thursday on or after the period ends; change the date if your payroll timing differs. Overtime 1.5× / 2× are editable review defaults, not automatic award interpretation. Super defaults to 12% of reviewed qualifying earnings.</p>
      <div className="flex flex-wrap gap-2">{btn('Calculate preview',()=>calculate())}{btn('Save draft',()=>calculate(true),false,true)}{btn('Mark reviewed and save',()=>calculate(true,true),!report?.ready)}{['pay','payg','super','leave'].map(k=><React.Fragment key={k}>{btn(`${k==='payg'?'PAYG':k[0].toUpperCase()+k.slice(1)} CSV`,()=>download(k),dirty||!sheet.revision)}</React.Fragment>)}</div>
      <p className="text-sm text-slate-600" role="status">{message}</p>
      {report&&<div className="grid grid-cols-2 lg:grid-cols-5 gap-2">{[['gross','Gross wages'],['payg','PAYG withholding'],['net','Net wages'],['super','Super contributions'],['annual_base_value','Annual leave base value']].map(([k,label])=><div key={k} className="bg-indigo-50 p-3 rounded-xl"><div className="text-xs text-slate-600">{label}</div><strong>{money(report.totals[k])}</strong></div>)}</div>}
      <div className="grid lg:grid-cols-[240px_1fr] gap-4">
        <div className="space-y-2"><p className="text-xs text-slate-600">One Simpro employee list. Select an employee to check submitted days, rates and payroll details.</p>
          <label className="text-sm block">Include an existing Simpro employee<select className={inputClass} value="" onChange={e=>{const id=e.target.value;if(!id)return;const source=submitted[id];change({...sheet,rows:[...sheet.rows,{worker_id:id,profile:{...profile},entry:{...entry,...source?.totals},timesheet_fingerprint:source?.fingerprint||''}]});setSelected(id);}}><option value="">Select employee omitted from this run</option>{workers.filter(w=>!sheet.rows.some(r=>r.worker_id===w.id)).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <input aria-label="Find worker in worksheet" placeholder="Find worker…" className={inputClass} value={query} onChange={e=>setQuery(e.target.value)}/><p className="text-xs">{sheet.rows.length} workers in this worksheet</p>
          <div className="max-h-96 overflow-y-auto space-y-1">{sheet.rows.filter(r=>(workers.find(w=>w.id===r.worker_id)?.name||r.worker_id).toLowerCase().includes(query.toLowerCase())).map(r=><button type="button" key={r.worker_id} onClick={()=>setSelected(r.worker_id)} className={`block text-left w-full p-2 rounded-lg text-sm ${selected===r.worker_id?'bg-indigo-100 font-bold':'bg-slate-50'}`}>{workers.find(w=>w.id===r.worker_id)?.name||r.worker_id}<span className="block text-xs font-normal">{report?.rows.find(v=>v.worker_id===r.worker_id)?.result.review_ready?'Ready for review':'Needs checking'}</span></button>)}</div>
        </div>
        {!row?<div className="border border-dashed rounded-xl p-8 text-slate-600">Select an employee. New employees must first be imported from Simpro.</div>:<div className="border rounded-xl p-4 space-y-4">
          <div className="flex justify-between gap-3"><h3 className="font-bold">{workers.find(w=>w.id===selected)?.name||selected}</h3>{btn('Remove from week',()=>{change({...sheet,rows:sheet.rows.filter(r=>r.worker_id!==selected)});setSelected('');})}</div>
          <p className="text-sm text-slate-600">{workers.find(w=>w.id===selected)?.department||'Department not recorded'} · {workers.find(w=>w.id===selected)?.division==='viatec'?'Viatec':'Paneltec Civil'}</p>
          <PayrollTimesheetDays key={selected+loadedWeek} source={submitted[selected]} onRefresh={refreshHours} onChanged={async()=>{const {data}=await api.get(`/payroll/workbench/${loadedWeek}/submissions`);setSubmitted(data.workers);change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?{...r,entry:{...r.entry,hours_reviewed:false,super_reviewed:false}}:r)});}}/>
          <PayrollEmployeeRecord key={selected} workerId={selected} profile={row.profile} onApply={profile=>change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?{...r,profile}:r)})}/>
          <h4 className="font-semibold">Employment and rates</h4><div className="grid sm:grid-cols-3 gap-3">
            <label className="text-sm">Employment<select className={inputClass} value={row.profile.employment_type} onChange={e=>patchRow('profile','employment_type',e.target.value)}>{[['unconfirmed','Choose…'],['full_time','Full time'],['part_time','Part time'],['casual','Casual'],['contractor','Contractor — separate assessment']].map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
            {[['hourly_rate','Paid hourly rate $'],['ordinary_weekly_hours','Ordinary hours / week'],['annual_weeks','Annual leave weeks / year'],['personal_weeks','Personal leave weeks / year'],['leave_loading_percent','Annual leave loading %']].map(([k,l])=><NumberField key={k} label={l} value={row.profile[k]} onChange={v=>patchRow('profile',k,v)}/>)}</div>
          <p className="text-xs text-slate-600">38 hours gives 152 annual and 76 personal/carer’s leave hours per full year. Part-time accrual is proportional; casuals do not accrue these paid leave balances. Enter the actual hourly rate including any applicable casual loading, and check how overtime multipliers apply.</p>
          <label className="text-sm block">Award / classification / confirmed award-free basis<input className={inputClass} value={row.profile.classification} onChange={e=>patchRow('profile','classification',e.target.value)}/></label>
          <Check checked={row.profile.conditions_reviewed} onChange={v=>patchRow('profile','conditions_reviewed',v)}>I have checked the worker’s rate, overtime, leave loading and applicable employment conditions.</Check>
          <PayrollLeavePanel key={row.worker_id} week={loadedWeek} row={row} onChange={updated=>change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?updated:r)})}/>
          <h4 className="font-semibold">This week’s hours and adjustments</h4><div className="grid sm:grid-cols-3 gap-3">{[['ordinary','Ordinary hours'],['ot1','Overtime tier 1 hours'],['ot2','Overtime tier 2 hours'],['annual','Annual leave taken (hours)'],['personal','Personal/carer’s leave (hours)'],['public_holiday','Paid public holiday hours'],['taxable_allowances','Taxable allowances $'],['post_tax_deductions','Authorised post-tax deductions $'],['reimbursements','Expense reimbursements $']].map(([k,l])=><NumberField key={k} label={l} value={row.entry[k]} onChange={v=>patchRow('entry',k,v)}/>)}</div>
          <Check checked={row.entry.hours_reviewed} onChange={v=>patchRow('entry','hours_reviewed',v)}>Hours, leave, allowances and authorised deductions agree with approved records. Worked public holidays and other penalty rates have been separately checked.</Check>
          <h4 className="font-semibold">PAYG withholding</h4><label className="text-sm block">Tax calculation<select className={inputClass} value={row.profile.tax_mode} onChange={e=>patchRow('profile','tax_mode',e.target.value)}><option value="unconfirmed">Choose after reviewing the tax declaration</option><option value="resident_threshold">Australian resident — tax-free threshold claimed</option><option value="resident_no_threshold">Australian resident — no tax-free threshold</option><option value="manual">Reviewed manual withholding (HELP or other circumstances)</option></select></label>
          <p className="text-xs text-slate-600">Automatic tables apply to standard weekly payments with a TFN provided, without HELP/STSL, Medicare adjustments, offsets or withholding variations. Bonuses, termination payments and other tax situations need a separately calculated manual amount.</p>
          <Check checked={row.profile.tax_declaration_reviewed} onChange={v=>patchRow('profile','tax_declaration_reviewed',v)}>Tax declaration checked and the selected standard tax table applies.</Check>
          <div className="grid sm:grid-cols-2 gap-3"><NumberField nullable label="Manual PAYG $ (manual mode only)" value={row.entry.manual_payg} onChange={v=>patchRow('entry','manual_payg',v)}/><NumberField label="Additional withholding $" value={row.entry.extra_withholding} onChange={v=>patchRow('entry','extra_withholding',v)}/></div><label className="text-sm block">Manual calculation reference<input className={inputClass} value={row.entry.payg_reference} onChange={e=>patchRow('entry','payg_reference',e.target.value)}/></label>
          <h4 className="font-semibold">Super fund and deduction particulars</h4>
          <div className="grid sm:grid-cols-2 gap-3">{[['super_fund_name','Selected super fund name'],['super_fund_usi','Super fund USI']].map(([key,label])=><label key={key} className="text-sm">{label}<input className={inputClass} value={row.profile[key]||''} onChange={e=>patchRow('profile',key,e.target.value)}/></label>)}</div>
          <label className="block text-sm">Deduction particulars (each amount, recipient and authorisation reference)<textarea className={inputClass} maxLength={1000} value={row.entry.deduction_details||''} onChange={e=>patchRow('entry','deduction_details',e.target.value)}/></label>
          <label className="block text-sm">Allowance particulars (each description and amount)<textarea className={inputClass} maxLength={1000} value={row.entry.allowance_details||''} onChange={e=>patchRow('entry','allowance_details',e.target.value)}/></label>
          <p className="text-xs">Use the employee’s selected fund. These details do not enrol the employee or send contributions. Do not enter TFNs or bank account numbers in the notes.</p>
          <h4 className="font-semibold">Super and opening leave balances</h4><div className="grid sm:grid-cols-3 gap-3">{[['qualifying_earnings','Super qualifying earnings $'],['opening_annual','Annual leave opening hours'],['opening_personal','Personal leave opening hours']].map(([k,l])=><NumberField nullable key={k} label={l} value={row.entry[k]} onChange={v=>patchRow('entry',k,v)}/>)}</div>
          <Check checked={row.entry.super_reviewed} onChange={v=>patchRow('entry','super_reviewed',v)}>Super eligibility, qualifying earnings and applicable contribution cap checked.</Check>
          <p className="text-xs text-slate-600">Use verified Wojo balances as at this week’s start. Closing balances below are projections, not posted entitlements. Annual leave value is base pay only; loading and termination rules can change the amount payable. Personal leave is shown in hours, not as a termination payout.</p>
          {result&&<div className="rounded-xl bg-slate-50 p-3 text-sm"><div className="grid sm:grid-cols-3 gap-3"><span>Gross <strong>{money(result.gross)}</strong></span><span>Net <strong>{money(result.net)}</strong></span><span>Super <strong>{money(result.super)}</strong></span><span>Annual accrued {hours(result.annual_accrued)}</span><span>Annual closing {hours(result.annual_closing)}</span><span>Personal closing {hours(result.personal_closing)}</span></div>{result.issues.length>0&&<ul className="list-disc pl-5 mt-3 text-amber-900">{result.issues.map(i=><li key={i}>{i}</li>)}</ul>}</div>}
        </div>}
      </div>
      <PayrollBankPanel key={loadedWeek} week={loadedWeek} workers={workers} worksheetSaved={!dirty && sheet.reviewed && sheet.revision > 0}/>
      <PayrollArchive key={loadedWeek} week={loadedWeek} revision={sheet.revision} canArchive={!dirty&&sheet.reviewed&&sheet.revision>0}/>
      <PayrollHistory week={loadedWeek} revision={sheet.revision}/>
      <PayrollConnections />
      <details className="text-sm border-t pt-3"><summary className="cursor-pointer font-semibold">Rules and reporting notes</summary><p className="my-2">PAYG uses the weekly tables effective 1 July 2026 and refuses automatic calculations outside that financial year. PAYG CSV is a reconciliation report, not an ATO lodgement. Super CSV records calculated contributions, not amounts received by funds. Payday Super generally requires receipt within seven business days, subject to the applicable exceptions. Long-service leave, salary sacrifice, RDO ledgers, termination calculations and STP integration still require implementation.</p>{sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="block text-blue-700 underline">{s.label}</a>)}</details>
    </fieldset>}
  </PayCard>;
}
