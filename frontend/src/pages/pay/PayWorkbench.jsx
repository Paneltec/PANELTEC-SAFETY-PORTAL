import {sortPayRunEmployees,editPayRunEntry} from './payRunAdapter';
import PayRunEmployee from './PayRunEmployee';
import PayrollCalculationPanel from './PayrollCalculationPanel';
import PayrollShiftInputs from './PayrollShiftInputs';
import {division} from './PayrollEmployeeSettings';
import {FlowSteps,FlowHeading,PayMetrics,cash} from './PayrollFlow';
import PayrollCompletion from './PayrollCompletion';
import PayrollTimesheetDays from './PayrollTimesheetDays';
import DateField from './DateField';
import {useSearchParams,Link} from 'react-router-dom';
import React, { useEffect, useState } from 'react';
import api, { apiError } from '../../lib/api';
import { PayCard } from './PayShell';
import PayrollLeavePanel from './PayrollLeavePanel';
import PayrollReports from './PayrollReports';
import PayrollLifecycle from './PayrollLifecycle';

const money = n => n == null ? 'Pending' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
const hours = n => n == null ? 'Pending' : `${Number(n).toFixed(2)} h`;
function currentFriday() { const d = new Date(); d.setDate(d.getDate() - (d.getDay() + 2) % 7); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
const profile = { employment_type:'unconfirmed', hourly_rate:0, ordinary_weekly_hours:38, classification:'', conditions_reviewed:false, tax_mode:'unconfirmed', tax_declaration_reviewed:false, annual_weeks:4, personal_weeks:2, leave_loading_percent:0 };
const entry = { ordinary:0, ot1:0, ot2:0, annual:0, personal:0, public_holiday:0, taxable_allowances:0, post_tax_deductions:0, reimbursements:0, extra_withholding:0, manual_payg:null, payg_reference:'', qualifying_earnings:null, super_reviewed:false, hours_reviewed:false, opening_annual:null, opening_personal:null };
const inputClass = 'w-full border rounded-lg px-3 py-2 bg-white text-slate-900';
function NumberField({ id, label, value, onChange, nullable=false, min=0, disabled=false }) {
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState('');
  const displayed=value === 0 && !nullable ? '' : (value ?? '');
  return <label className="text-sm block">{label}<input id={id} className={inputClass} type="number" disabled={disabled} min={min} step="any"
    value={editing ? draft : displayed}
    onFocus={() => {setDraft(value === 0 ? '' : String(value ?? ''));setEditing(true);}}
    onBlur={() => setEditing(false)}
    onChange={e => {const text=e.target.value;setDraft(text);onChange(text === '' && nullable ? null : Number(text));}} /></label>;
}
function Check({children, checked, onChange}) { return <label className="flex gap-2 text-sm items-start py-2"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} className="mt-1"/>{children}</label>; }

export default function PayWorkbench({mode="run"}) {
  const [searchParams,setSearchParams]=useSearchParams();
  const preparation=searchParams.get('setup')==='1';
  const [step,setStep]=useState(2);
  const [submitted,setSubmitted]=useState({});
  const [locked,setLocked]=useState(false),[sealedBranding,setSealedBranding]=useState(null);
  const [week,setWeek] = useState(currentFriday), [loadedWeek,setLoadedWeek] = useState('');
  const [sheet,setSheet] = useState(null), [workers,setWorkers] = useState([]), [report,setReport] = useState(null);
  const [selected,setSelected] = useState(''), [busy,setBusy] = useState(false);
  const [employeeSearch,setEmployeeSearch] = useState('');
  const [companyFilter,setCompanyFilter]=useState('all');
  const [dirty,setDirty] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('');
  async function load(target) {
    setBusy(true); setError('');
    try { const [loaded,feed]=await Promise.all([api.get(`/payroll/workbench/${target}`),api.get(`/payroll/workbench/${target}/submissions`)]);const data=loaded.data; const incoming={...data.worksheet};if(!data.saved_at&&searchParams.get('payday'))incoming.payday=searchParams.get('payday');setSheet(incoming);setLocked(data.state==='finalized');setStep(data.state==='finalized'?3:2); setSealedBranding(data.finalized_branding||null); setWorkers(data.workers);setCompanyFilter('all'); setReport(data.report); setSubmitted(feed.data.workers); setLoadedWeek(target); setSelected(sortPayRunEmployees(data.workers).find(w=>incoming.rows.some(r=>r.worker_id===w.id))?.id || incoming.rows[0]?.worker_id || ''); setDirty(Boolean(data.rates_loaded?.length)); setMessage(data.rates_loaded?.length ? `Loaded saved rates for ${data.rates_loaded.length} employees with missing draft rates. Check the figures and save the draft.` : data.saved_at ? `Saved ${new Date(data.saved_at).toLocaleString('en-AU')}` : 'Employees loaded'); }
    catch(e) { setError(apiError(e) || 'Could not load payroll worksheet'); } finally { setBusy(false); }
  }
  useEffect(()=>{const target=searchParams.get('week');if(target){setWeek(target);load(target);}},[searchParams]);
  useEffect(()=>{ const f=e=>{if(dirty){e.preventDefault();e.returnValue='';}}; window.addEventListener('beforeunload',f); return()=>window.removeEventListener('beforeunload',f); },[dirty]);
  function change(next) { setSheet({...next, rows:next.rows.map(r=>JSON.stringify(r)!==JSON.stringify(sheet?.rows.find(old=>old.worker_id===r.worker_id))?{...r,adjustment_reason:r.adjustment_reason||'Weekly payroll review'}:r), reviewed:false}); setDirty(true); setReport(null); setMessage('Updating calculation… Save draft to keep your changes.'); }
  function patchRow(section,key,value) { change({...sheet,rows:sheet.rows.map(r=>r.worker_id!==selected?r:section==='entry'?editPayRunEntry(r,key,value,report?.rows.find(v=>v.worker_id===selected)?.entry):{...r,[section]:{...r[section],[key]:value}})}); }
  function patchDay(day,key,value){
    if((row.worked_hours_override||(row.shifts==null&&row.daily_hours==null&&['ordinary','ot1','ot2','saturday','sunday','night','holiday_work'].some(k=>row.entry[k])))&&!window.confirm('Replace this employee’s weekly worked-hour override with dated daily totals? Undated hours will not be assigned to a day.'))return;
    const base=row.daily_hours||report?.rows.find(r=>r.worker_id===selected)?.daily_totals||{};
    const dayEntry={ordinary:0,ot1:0,ot2:0,saturday:0,sunday:0,night:0,holiday_work:0,penalty_ordinary:0,meal_count:0,...base[day],[key]:value};
    dayEntry.penalty_ordinary=Math.min(dayEntry.penalty_ordinary,dayEntry.night+dayEntry.holiday_work);
    change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?{...r,worked_hours_override:false,daily_hours:{...base,[day]:dayEntry},entry:{...r.entry,hours_reviewed:false,super_reviewed:false}}:r)});
  }
  function patchEarnings(values,rules){
    const saved=sheet.rules.earning_rules||[];
    change({...sheet,rules:{...sheet.rules,earning_rules:[...saved,...rules.filter(rule=>!saved.some(r=>r.code===rule.code))]},rows:sheet.rows.map(r=>r.worker_id===selected?{...r,entry:{...r.entry,...values,hours_reviewed:false,super_reviewed:false}}:r)});
  }
  async function calculate(save=false, reviewed=false) {
    setBusy(true); setError('');
    try { const body={...sheet, reviewed}; const {data}=save ? await api.put(`/payroll/workbench/${loadedWeek}`,body) : await api.post(`/payroll/workbench/${loadedWeek}/preview`,body);
      const calculated=save?data.report:data;setReport(calculated);setSheet({...body,revision:save?data.revision:body.revision,rows:body.rows.map(r=>({...r,entry:calculated.rows.find(v=>v.worker_id===r.worker_id)?.entry||r.entry}))});if(save){setDirty(false);} setMessage(save ? `${reviewed ? 'Reviewed' : 'Draft'} worksheet saved. No payments, STP or leave-ledger changes made.` : 'Calculated preview. Save before downloading reports.');return save?data.report:data;
    } catch(e){setError(apiError(e)||'Calculation failed');return false;}finally{setBusy(false);}
  }
  // Preview only: edits never save, approve or issue payroll automatically.
  useEffect(()=>{
    if(!sheet||!loadedWeek||locked||busy||!dirty)return;
    let cancelled=false;
    const timer=setTimeout(async()=>{
      try{
        const {data}=await api.post(`/payroll/workbench/${loadedWeek}/preview`,{...sheet,reviewed:false});
        if(!cancelled){setReport(data);setMessage('Calculation updated. Save draft to keep your changes.');}
      }catch(e){if(!cancelled)setError(apiError(e)||'Automatic calculation failed. Check the entries and recalculate.');}
    },400);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[sheet,loadedWeek,locked,busy,dirty]);
  async function download(kind) {
    setBusy(true);setError('');
    try {const {data}=await api.get(`/payroll/workbench/${loadedWeek}/report/${kind}`,{responseType:'blob'});const url=URL.createObjectURL(data);const a=document.createElement('a');a.href=url;a.download=`paneltec-${kind}-${loadedWeek}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError('Could not download the saved report.');}finally{setBusy(false);}
  }
  async function refreshHours(){
    if(!window.confirm('Replace this employee worked/public-holiday hours with the latest submissions? Other adjustments and leave stay unchanged.'))return;
    setBusy(true);try{const {data}=await api.get(`/payroll/workbench/${loadedWeek}/submissions`);setSubmitted(data.workers);const source=data.workers[selected];change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?{...r,worked_hours_override:false,daily_hours:null,shifts:(source?.days||[]).filter(d=>d.kind==='work').flatMap(d=>(d.segments?.length?d.segments:[d]).map(s=>({date:d.date,start:s.start||'',finish:s.finish||'',break_minutes:s.break_minutes||0,break_start:s.break_start||null,next_day:false,public_holiday:false,replacement_day_shift:false}))),timesheet_fingerprint:source?.fingerprint||'',entry:{...r.entry,night:0,holiday_work:0,penalty_ordinary:0,meal_count:0,ordinary:0,ot1:0,ot2:0,saturday:0,sunday:0,public_holiday:0,...source?.totals,hours_reviewed:false,super_reviewed:false}}:r)});}catch(e){setError(apiError(e)||'Could not refresh submitted hours');}finally{setBusy(false);}
  }
  const row=sheet?.rows.find(r=>r.worker_id===selected), result=report?.rows.find(r=>r.worker_id===selected)?.result;
  useEffect(()=>{const guard=e=>{if(dirty&&!window.confirm('Leave this page and discard unsaved payroll changes?'))e.preventDefault();};window.addEventListener('payroll:navigate',guard);return()=>window.removeEventListener('payroll:navigate',guard);},[dirty]);
  if(!searchParams.get('week')&&!loadedWeek)return <PayCard title="Choose a pay run"><Link className="text-indigo-700 underline" to="/app/pay">Start a new pay run or open a saved run</Link></PayCard>;
  const worker=id=>workers.find(w=>w.id===id)||{name:report?.rows.find(r=>r.worker_id===id)?.name||id};

  const allOrdered=sortPayRunEmployees(sheet?.rows.map(r=>({...worker(r.worker_id),id:r.worker_id}))||[]);
  const ordered=allOrdered.filter(w=>companyFilter==='all'||w.division===companyFilter);
  function selectCompany(value){
    setCompanyFilter(value);setEmployeeSearch('');
    const available=allOrdered.filter(w=>value==='all'||w.division===value);
    if(!available.some(w=>w.id===selected))setSelected(available[0]?.id||'');
  }
  const companySelector=<label className="flex items-center gap-2 text-sm font-semibold">Company<select aria-label="Pay run company" className="border rounded-lg px-3 py-2 bg-white text-slate-900" value={companyFilter} disabled={busy} onChange={e=>selectCompany(e.target.value)}><option value="all">Both companies</option><option value="paneltec">Paneltec Civil</option><option value="viatec">Viatec Traffic</option></select></label>;
  const employeeQuery=employeeSearch.trim().toLocaleLowerCase();
  const matchingEmployees=ordered.filter(w=>String(w.name||'').toLocaleLowerCase().includes(employeeQuery));
  const index=ordered.findIndex(w=>w.id===selected);
  const weekEnd=new Date(loadedWeek+'T12:00:00');weekEnd.setDate(weekEnd.getDate()+6);
  const totalChecked=report?.rows.filter(r=>r.result.review_ready).length||0;
  const checked=report?.rows.filter(r=>r.result.review_ready&&ordered.some(w=>w.id===r.worker_id)).length||0;
  async function refreshTax(){
    setBusy(true);setError('');
    try{
      const {data}=await api.get(`/payroll/employee-records/${encodeURIComponent(selected)}`);
      if(!data.configured||!data.profile?.tax_declaration_reviewed||data.profile.tax_mode==='unconfirmed')throw new Error('Complete and save this employee’s tax declaration settings first.');
      change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?{...r,profile:{...r.profile,tax_mode:sheet.out_of_cycle?'manual':data.profile.tax_mode,tax_declaration_reviewed:data.profile.tax_declaration_reviewed},adjustment_reason:r.adjustment_reason||'Refreshed saved tax setup'}:r)});
    }catch(e){setError(apiError(e)||e.message);}finally{setBusy(false);}
  }
  async function defaults(){setBusy(true);setError('');try{const {data}=await api.get(`/payroll/employee-records/${encodeURIComponent(selected)}`);if(!data.configured)throw new Error('Save this employee’s settings first.');const {data:opening}=await api.get(`/payroll/employee-records/${encodeURIComponent(selected)}/opening-balances/${week}`);change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?{...r,profile:{...data.profile,...(sheet.out_of_cycle?{tax_mode:'manual'}:{})},entry:{...r.entry,...(opening.available?{opening_annual:opening.opening_annual,opening_personal:opening.opening_personal}:{}),hours_reviewed:false},adjustment_reason:r.adjustment_reason||'Refreshed saved employee settings'}:r)});if(!opening.available)setError(opening.reason);}catch(e){setError(apiError(e)||e.message);}finally{setBusy(false);}}
  async function next(){const calculated=await calculate(true);if(!calculated)return;if(!calculated.rows.find(r=>r.worker_id===selected)?.result.review_ready){setError('Saved. Complete the outstanding checks in Settings → Pay-run preparation before continuing.');return;}if(index<ordered.length-1){setSelected(ordered[index+1].id);window.scrollTo(0,0);}else if(companyFilter==='all')setStep(3);else setMessage('Company review saved. Select Both companies to continue with the full pay run.');}
  if(mode==='run'&&step===2&&sheet&&!ordered.length)return <PayCard title="Check employee pay">{companySelector}<p className="mt-4">No employees from this company in this pay run.</p></PayCard>;
  if(mode==='run'&&!preparation&&step===2&&sheet&&row){
    const preparationParams=new URLSearchParams(searchParams);preparationParams.set('setup','1');
    return <>{error&&<p role="alert" className="pay-notice">{typeof error==='string'?error:JSON.stringify(error)}</p>}{message&&<p role="status" className="text-sm mb-2">{message}</p>}<PayRunEmployee key={selected} companySelector={companySelector} companyLabel={division(worker(selected))} periodEnding={weekEnd.toLocaleDateString('en-AU')} employees={ordered} row={{...row,entry:report?.rows.find(v=>v.worker_id===selected)?.entry||row.entry}} calculation={result} sheet={sheet} week={loadedWeek} employer={sealedBranding} checkedCount={checked} busy={busy} locked={locked} onSelect={setSelected} onPatch={(key,value)=>patchRow('entry',key,value)} onDayPatch={patchDay} onEarnings={patchEarnings} dailyTotals={row.daily_hours||report?.rows.find(v=>v.worker_id===selected)?.daily_totals||{}} onSaveDraft={()=>calculate(true)} onMarkChecked={next} preparationUrl={`/app/pay/payroll?${preparationParams}`}/></>;
  }
  return <div className={`pay-theme ${mode==='run'&&!preparation&&step===2?'pay-check-screen':''}`}>
    {!(mode==='run'&&!preparation&&step===2)&&<FlowHeading step={mode==='run'&&!preparation?step:undefined} title={preparation?'Pay-run preparation':mode==='reports'?'Pay reports':mode==='super'?'Pay super':step===2?'Check employee pay':'Complete pay run'} week={loadedWeek} payday={sheet?.payday}>{mode==='run'&&!preparation&&<FlowSteps step={step} locked={locked} onChange={n=>n===1?(dirty&&!window.confirm('Discard unsaved changes?')?null:window.location.assign('/app/pay')):setStep(n)}/>}</FlowHeading>}
    {sheet?.out_of_cycle&&<p className="pay-notice"><strong>Out-of-cycle pay</strong> · {sheet.run_reason}. Enter additional amounts only. This run does not import the normal weekly timesheets. Use reviewed manual PAYG for the extra payment.</p>}{error&&<p role="alert" className="pay-notice">{typeof error==='string'?error:JSON.stringify(error)}</p>}{message&&<p role="status" className="text-sm mb-4">{message}</p>}
    {!sheet?<p>Loading pay run…</p>:mode!=='run'?<>
      {mode==='reports'&&<PayrollReports report={report} sheet={sheet} week={loadedWeek} dirty={dirty} busy={busy} onCalculate={()=>calculate()} onDownload={download} sealedBranding={sealedBranding}/>}
      <PayrollCompletion mode={mode} week={loadedWeek} sheet={sheet} report={report} workers={workers} dirty={dirty} locked={locked} onDownload={download}/>
    </>:<>
      {step===2&&<>
        <section className="pay-panel pay-employee-header mb-4"><div className="pay-reference-header"><div>{companySelector}<p className="pay-eyebrow">{division(worker(selected))} · Week ending {Number.isNaN(weekEnd.getTime())?'Pending':weekEnd.toLocaleDateString('en-AU')}</p><h3>{worker(selected).name}</h3></div><div className="pay-header-navigation"><div className="pay-header-progress-label"><span>Pay run progress</span><span>{checked} of {ordered.length} checked</span></div><progress aria-label="Employees checked" value={checked} max={ordered.length||1}/><p className="pay-header-employee-count">Employee {index<0?0:index+1} of {ordered.length}</p><div className="pay-header-buttons"><button type="button" disabled={busy||index<=0} onClick={()=>setSelected(ordered[index-1].id)}>‹ Previous</button><button type="button" disabled={busy||index<0||index>=ordered.length-1} onClick={()=>setSelected(ordered[index+1].id)}>Next ›</button></div></div></div><div className="pay-employee-finder"><input aria-label="Search employee" type="search" list="pay-employee-options" className={inputClass} placeholder="Search employee" value={employeeSearch} disabled={busy||!ordered.length} onChange={e=>{const value=e.target.value;setEmployeeSearch(value);const match=ordered.find(w=>`${w.name} · ${division(w)} (${ordered.indexOf(w)+1})`===value);if(match){setSelected(match.id);setEmployeeSearch('');}}}/><datalist id="pay-employee-options">{matchingEmployees.map(w=><option key={w.id} value={`${w.name} · ${division(w)} (${ordered.indexOf(w)+1})`}>{w.name} · {division(w)}</option>)}</datalist></div>{preparation&&<div className="flex gap-3 flex-wrap mt-4 text-sm"><span>{row?.profile.employment_type.replaceAll('_',' ')} · {cash(row?.profile.hourly_rate)} / hour</span><Link className="underline" onClick={e=>{if(dirty&&!window.confirm('Save draft first to keep your changes. Leave without saving?'))e.preventDefault();}} to={`/app/pay/employees?worker=${encodeURIComponent(selected)}`}>Employee settings and bank details</Link>{!locked&&<button disabled={busy} className="underline" onClick={defaults}>Refresh employee settings</button>}</div>}</section>
        {preparation&&<button className="pay-outline mb-4" disabled={busy} onClick={async()=>{if(dirty&&!await calculate(true))return;const params=new URLSearchParams(searchParams);params.delete("setup");setSearchParams(params);}}>Return to pay check</button>}{row&&<div className={preparation?'':'pay-check-layout'}><section className="pay-panel pay-entry-column"><fieldset disabled={busy||locked} className="space-y-4">
          {preparation&&!sheet.out_of_cycle&&<><PayrollShiftInputs row={row} source={submitted[selected]} week={loadedWeek} onChange={updated=>change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?updated:r)})}/><button type="button" className="pay-outline" onClick={async()=>{try{const {data}=await api.get("/payroll/workbench/calculation/settings");change({...sheet,rules:data.rules,rows:sheet.rows.map(r=>({...r,entry:{...r.entry,hours_reviewed:false,super_reviewed:false}}))});}catch(e){setError(apiError(e));}}}>Use current calculation settings for this draft</button><PayrollTimesheetDays key={selected+loadedWeek} source={submitted[selected]} onRefresh={refreshHours} onChanged={async()=>{const {data}=await api.get(`/payroll/workbench/${loadedWeek}/submissions`);setSubmitted(data.workers);change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?{...r,entry:{...r.entry,hours_reviewed:false,super_reviewed:false}}:r)});}}/>
          <PayrollLeavePanel key={row.worker_id} week={loadedWeek} row={row} onChange={updated=>change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?updated:r)})}/>
          <NumberField label="Ordinary penalty hours accruing leave" value={row.entry.penalty_ordinary||0} disabled={row.shifts!=null} onChange={v=>patchRow("entry","penalty_ordinary",v)}/><NumberField label="Meal allowance count" value={row.entry.meal_count||0} disabled={row.shifts!=null} onChange={v=>patchRow("entry","meal_count",v)}/>
          </>}
          {!preparation&&<section className="pay-entry-card"><h4>Leave balances at week start</h4><div className="pay-leave-grid" aria-label="Leave balances">{[['annual','Annual leave'],['personal',"Personal / carer’s"]].map(([kind,label])=><div key={kind}><h5>{label}</h5><p className={row.entry[`opening_${kind}`]==null?'pay-status-chip':''}>{hours(row.entry[`opening_${kind}`])}</p><p>Accrued {hours(result?.[`${kind}_accrued`])} · Taken {hours(row.entry[kind])}</p></div>)}{['RDO bank','Long service'].map(label=><div key={label}><h5>{label}</h5><span className="pay-status-chip">Pending</span></div>)}</div></section>}
          {[
            ['1 · Hours worked', [['ordinary','Ordinary hours'],['ot1',`Overtime ${sheet.rules.ot1_multiplier}×`],['ot2',`Overtime ${sheet.rules.ot2_multiplier}×`],['saturday','Saturday O/T'],['sunday','Sunday O/T'],['night',`Weekday night (${sheet.rules.night_multiplier}×)`],['holiday_work',`Public holiday worked (${sheet.rules.holiday_work_multiplier}×)`],[null,'RDO accrued']]],
            ['2 · Leave taken', [['annual','Annual leave'],['personal',"Personal / carer’s"],['public_holiday','Paid public holiday'],[null,'RDO taken'],[null,'Long service leave'],[null,'Compassionate / FDV'],[null,'Unpaid leave']]],
          ].map(([title,fields])=><section className="pay-entry-card" key={title}><h4>{title}</h4>
            {title.startsWith('2')&&<p className="mb-3">Leave loading {row.profile.leave_loading_percent||0}%</p>}
            <div className="pay-input-grid">{fields.filter(([k])=>!sheet.out_of_cycle||!['annual','personal'].includes(k)).map(([k,l])=>k?<NumberField key={k} id={`pay-entry-${k}`} disabled={row.shifts!=null&&['ordinary','ot1','ot2','saturday','sunday','night','holiday_work'].includes(k)} label={l} value={row.entry[k]} onChange={v=>patchRow('entry',k,v)}/>:<div className="pay-pending-field" key={l}><span>{l}</span><div>Pending</div></div>)}</div>
          </section>)}
          <section className="pay-entry-card"><h4>3 · Allowances & deductions ($)</h4><h5 className="pay-field-heading">Allowances</h5><div className="pay-input-grid">
          {['Industry / site','Travel / fares','Tools'].map(label=><div className="pay-pending-field" key={label}><span>{label}</span><div>Pending</div></div>)}
          <NumberField label={sheet.rules.meal_allowance==null?'Meals · Pending':`Meals (${money(sheet.rules.meal_allowance)} each)`} value={row.entry.meal_count||0} disabled={row.shifts!=null||sheet.rules.meal_allowance==null} onChange={v=>patchRow('entry','meal_count',v)}/>
          <NumberField id="pay-entry-taxable_allowances" label="Other taxable allowances $" value={row.entry.taxable_allowances} onChange={v=>patchRow('entry','taxable_allowances',v)}/>
          {(row.profile.allowance_rates||[]).map(a=><NumberField key={a.code} label={`${a.name} · units (${money(a.rate)} each)`} value={row.entry.allowance_units?.[a.code]||0} onChange={v=>patchRow('entry','allowance_units',{...row.entry.allowance_units,[a.code]:v})}/>)}
          </div><h5 className="pay-field-heading">Deductions & reimbursements</h5><div className="pay-input-grid"><div className="pay-pending-field"><span>Salary sacrifice (pre-tax)</span><div>Pending</div></div><NumberField id="pay-entry-post_tax_deductions" label="Post-tax deductions $" value={row.entry.post_tax_deductions} onChange={v=>patchRow('entry','post_tax_deductions',v)}/><NumberField id="pay-entry-reimbursements" label="Expense reimbursements $" value={row.entry.reimbursements} onChange={v=>patchRow('entry','reimbursements',v)}/></div></section>

          <div className="pay-review-actions"><Check checked={row.entry.hours_reviewed} onChange={v=>patchRow('entry','hours_reviewed',v)}>Pay checked</Check>{!preparation&&<button type="button" className="pay-outline" disabled={busy||locked} onClick={()=>calculate()}>Recalculate</button>}</div>
{(preparation||sheet.out_of_cycle)&&<><details open className="border rounded p-3"><summary>Tax adjustments for this pay</summary>
          <div className="grid sm:grid-cols-2 gap-3"><NumberField nullable label="Manual PAYG $ (manual mode only)" value={row.entry.manual_payg} onChange={v=>patchRow('entry','manual_payg',v)}/><NumberField label="Additional withholding $" value={row.entry.extra_withholding} onChange={v=>patchRow('entry','extra_withholding',v)}/></div><label className="text-sm block">Manual calculation reference<input className={inputClass} value={row.entry.payg_reference} onChange={e=>patchRow('entry','payg_reference',e.target.value)}/></label>
</details>
<details open className="border rounded p-3"><summary>Allowance and deduction particulars</summary>
          <label className="block text-sm">Deduction particulars (each amount, recipient and authorisation reference)<textarea className={inputClass} maxLength={1000} value={row.entry.deduction_details||''} onChange={e=>patchRow('entry','deduction_details',e.target.value)}/></label>
          <label className="block text-sm">Allowance particulars (each description and amount)<textarea className={inputClass} maxLength={1000} value={row.entry.allowance_details||''} onChange={e=>patchRow('entry','allowance_details',e.target.value)}/></label>
          <p className="text-xs">Use the employee’s selected fund. These details do not enrol the employee or send contributions. Do not enter TFNs or bank account numbers in the notes.</p>
</details>
          <h4 className="font-semibold">Super and opening leave balances</h4><div className="grid sm:grid-cols-3 gap-3">{[['qualifying_earnings','Super qualifying earnings $'],['opening_annual','Annual leave opening hours'],['opening_personal','Personal leave opening hours']].map(([k,l])=><NumberField nullable key={k} label={l} value={row.entry[k]} onChange={v=>patchRow('entry',k,v)}/>)}</div>
          <Check checked={row.entry.super_reviewed} onChange={v=>patchRow('entry','super_reviewed',v)}>Super eligibility, qualifying earnings and applicable contribution cap checked.</Check>
          <p className="text-xs text-slate-600">Use verified opening balances as at this week’s start. Closing balances below are projections, not posted entitlements. Annual leave value is base pay only; loading and termination rules can change the amount payable. Personal leave is shown in hours, not as a termination payout.</p>
          {result&&<div className="rounded-xl bg-slate-50 p-3 text-sm"><div className="grid sm:grid-cols-3 gap-3"><span>Gross <strong>{money(result.gross)}</strong></span><span>Net <strong>{money(result.net)}</strong></span><span>Super <strong>{money(result.super)}</strong></span><span>Annual accrued {hours(result.annual_accrued)}</span><span>Annual closing {hours(result.annual_closing)}</span><span>Personal closing {hours(result.personal_closing)}</span></div>{result.issues.length>0&&<p className="text-amber-900">Pending</p>}</div>}
      <label className="block text-sm font-semibold">Reason for changes (saved in revision history)<textarea className={inputClass} maxLength={1000} value={row.adjustment_reason||''} onChange={e=>change({...sheet,rows:sheet.rows.map(r=>r.worker_id===selected?{...r,adjustment_reason:e.target.value}:r)})}/></label>
          </>}

        </fieldset>{preparation&&<div className="pay-actions"><button className="pay-outline" disabled={busy||index<=0} onClick={()=>setSelected(ordered[index-1].id)}>Previous employee</button>{!locked&&<button className="pay-outline" disabled={busy} onClick={()=>calculate(true)}>Save draft</button>}<button className="pay-gold" disabled={busy} onClick={locked?()=>index<ordered.length-1?setSelected(ordered[index+1].id):setStep(3):next}>{index===ordered.length-1?'Save and finish checking':'Save and next employee'}</button></div>}</section>{!preparation&&<PayrollCalculationPanel row={row} result={result} sheet={sheet} week={loadedWeek} name={worker(selected).name} sealedBranding={sealedBranding} onRefreshTax={locked?null:refreshTax} busy={busy}/>}</div>}
        {!preparation&&row&&<footer className="pay-check-footer"><div className="pay-actions"><button className="pay-outline" disabled={busy||index<=0} onClick={()=>setSelected(ordered[index-1].id)}>Previous employee</button>{!locked&&<button className="pay-outline" disabled={busy} onClick={()=>calculate(true)}>Save draft</button>}<button className="pay-gold" disabled={busy} onClick={locked?()=>index<ordered.length-1?setSelected(ordered[index+1].id):setStep(3):next}>{index===ordered.length-1?'Save and finish checking':'Save and next employee'}</button></div></footer>}
      </>}
      {step===3&&<>
        <PayMetrics items={[["Employees checked",`${totalChecked} / ${sheet.rows.length}`],["Gross pay",cash(report?.totals.gross)],["PAYG",cash(report?.totals.payg)],["Net wages",cash(report?.totals.net)],["Employer super",money(report?.totals.super)]]}/>
        {!locked&&<section className="pay-panel"><h3>Approve the completed checks</h3><label className="text-sm">Actual wage payment date<DateField className={inputClass} value={sheet.payday} onChange={e=>change({...sheet,payday:e.target.value})}/></label><p className="text-sm mt-3">Overtime multipliers: {sheet.rules.ot1_multiplier}× / {sheet.rules.ot2_multiplier}× · Super: {sheet.rules.super_percent}%. New-run defaults are in Settings.</p><div className="pay-actions"><button className="pay-outline" onClick={()=>setStep(2)}>Back to employees</button><button className="pay-outline" disabled={busy} onClick={()=>calculate()}>Recalculate</button><button className="pay-gold" disabled={busy||!report?.ready} onClick={()=>calculate(true,true)}>Save all checks as reviewed</button></div>{!report?.ready&&<p className="pay-notice">Resolve the remaining employee checks before approving.</p>}</section>}
        <PayrollLifecycle week={loadedWeek} revision={sheet.revision} dirty={dirty||!sheet.reviewed} onReload={load} onLocked={setLocked}/>
        {locked&&<PayrollCompletion mode="payment" week={loadedWeek} sheet={sheet} report={report} workers={workers} dirty={dirty} locked={locked} onDownload={download}/>}
        <div className="pay-actions"><Link className="pay-outline" to={`/app/pay/reports?week=${loadedWeek}`}>Pay reports and reporting status</Link><Link className="pay-outline" to={`/app/pay/super?week=${loadedWeek}`}>Pay super</Link></div>
      </>}
    </>}
  </div>;
}
