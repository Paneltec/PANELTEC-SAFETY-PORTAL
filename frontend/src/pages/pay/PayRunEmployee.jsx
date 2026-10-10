import React,{useState,useEffect} from 'react';
import {Link} from 'react-router-dom';
import api from '../../lib/api';
import './payrun.css';
import {payRunSummary,money} from './payRunAdapter';
export default function PayRunEmployee({companySelector,companyLabel,periodEnding,employees,row,calculation,sheet,week,employer:sealedEmployer,checkedCount,busy,locked,onSelect,onPatch,onDayPatch,onEarnings,dailyTotals,onSaveDraft,onMarkChecked,preparationUrl}) {
 const [search,setSearch]=useState('');
 const [day,setDay]=useState('');
 const days=Array.from({length:7},(_,i)=>{const d=new Date(week+'T12:00:00');d.setDate(d.getDate()+i);return {date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,label:d.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'})};});
 const workedKeys=['ordinary','ot1','ot2','saturday','sunday','night','holiday_work','meal_count'];
 const [earningRules,setEarningRules]=useState([]);
 const [catalog,setCatalog]=useState([]),[catalogError,setCatalogError]=useState('');
 const [context,setContext]=useState(null);
 const [extraCodes,setExtraCodes]=useState([...Object.keys(row.entry.allowance_units||{}),...Object.keys(row.entry.earning_units||{}).map(k=>'rule:'+k)]);
 useEffect(()=>{let active=true;api.get(`/payroll/employee-records/${encodeURIComponent(row.worker_id)}/pay-context/${week}`,{params:{payday:sheet.payday}}).then(({data})=>{if(active)setContext(data);}).catch(()=>{});return()=>{active=false;};},[row.worker_id,week,sheet.payday]);
 useEffect(()=>{if(!extraCodes.length)return;let active=true;api.get('/payroll/employee-records/configuration/catalog/pay-categories').then(({data})=>{if(active){setCatalog(data.tables?.Export||[]);setCatalogError('');}}).catch(()=>{if(active)setCatalogError('Categories could not be loaded. Open Pay settings.');});return()=>{active=false;};},[extraCodes.length]);
 useEffect(()=>{if(!extraCodes.length)return;api.get('/payroll/workbench/calculation/settings').then(({data})=>setEarningRules(data.rules?.earning_rules||[])).catch(()=>{});},[extraCodes.length]);
 const list=employees,idx=list.findIndex(e=>e.id===row.worker_id),emp={...list[idx],baseRate:calculation?.applied_rates?.ordinary??row.profile.hourly_rate,award:row.profile.classification||'—'};
 const employer={name:sealedEmployer?.employer_name||context?.employer?.employer_name||'—',abn:sealedEmployer?.employer_abn||context?.employer?.employer_abn||'—'};
 const result=payRunSummary(row,calculation),confirmed=row.entry.hours_reviewed&&row.entry.super_reviewed;
 const pct=list.length?Math.round(checkedCount/list.length*100):0;
 const goTo=i=>{if(!busy&&list[i])onSelect(list[i].id);};
 const onSearch=e=>setSearch(e.target.value);
 const matches=search.trim()?list.filter(p=>p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())):[];
 const fields={ordinaryHours:'ordinary',ot1Hours:'ot1',ot2Hours:'ot2',saturdayHours:'saturday',sundayHours:'sunday',lafha:'lafha',nightHours:'night',phWorkedHours:'holiday_work',annualLeaveHours:'annual',personalLeaveHours:'personal',paidPublicHolidayHours:'public_holiday',reimbursements:'reimbursements',meals:'meal_count'};
 const field=(id,label,key)=>{const k=fields[key],pending=!k,daily=day&&workedKeys.includes(k),value=daily?dailyTotals?.[day]?.[k]:row.entry[k];return <div className="pr-f"><label htmlFor={id}>{label}</label><input id={id} type={pending?'text':'number'} min="0" step={key==='meals'?'1':'any'} value={pending?'':value??''} disabled={busy||locked||pending} onChange={e=>daily?onDayPatch(day,k,e.target.value===''?0:Number(e.target.value)):onPatch(k,e.target.value===''?0:Number(e.target.value))}/></div>;};
 const rules=[...(sheet.rules.earning_rules||[]),...earningRules.filter(r=>!sheet.rules.earning_rules?.some(saved=>saved.code===r.code))];
 const categories=[...(row.profile.allowance_rates||[]).map(a=>({id:a.code,label:`${a.name} (${money(a.rate)} / unit)`})),...rules.map(r=>({id:'rule:'+r.code,label:r.name}))];
 const inputs={otherEarnings:extraCodes.map((code,i)=>({key:i,categoryId:code,value:code.startsWith('rule:')?row.entry.earning_units?.[code.slice(5)]??0:row.entry.allowance_units?.[code]??0}))};
 const setExtras=fn=>{const updated=fn(inputs.otherEarnings);setExtraCodes(updated.map(x=>x.categoryId));const allowance_units=Object.fromEntries(updated.filter(x=>x.categoryId&&!x.categoryId.startsWith('rule:')&&!x.categoryId.startsWith('catalog:')).map(x=>[x.categoryId,Number(x.value)||0]));const earning_units=Object.fromEntries(updated.filter(x=>x.categoryId.startsWith('rule:')).map(x=>[x.categoryId.slice(5),Number(x.value)||0]));if(onEarnings)onEarnings({allowance_units,earning_units},rules.filter(r=>Object.hasOwn(earning_units,r.code)));else onPatch('allowance_units',allowance_units);};
 const canFinalise=!busy&&!locked&&confirmed&&calculation?.review_ready===true;
  return (
    <div className="pr-root">
      <div className="pr-bg">
        <div className="pr-wrap">

          <header className="pr-header">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {companySelector}
              <div className="pr-overline">{companyLabel} · Week ending {periodEnding}</div>
              <h1 className="pr-name">{emp.name}</h1>
              <div className="pr-meta">Employee {idx + 1} of {list.length} · Base rate {money(emp.baseRate)}/h · Award: {emp.award}</div>
            </div>
            <div className="pr-nav">
              <div className="pr-progress-label"><span>Pay run progress</span><span>{checkedCount} of {list.length} checked</span></div>
              <div className="pr-progress" role="img" aria-label={`${checkedCount} of ${list.length} employees checked`}><div style={{ width: `${pct}%` }} /></div>
              <div className="pr-nav-row">
                <div className="pr-search">
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4B4B4B" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
                  <input type="search" aria-label="Search employee" placeholder="Search employee…" value={search} onChange={onSearch} autoComplete="off" aria-expanded={Boolean(search.trim())} aria-controls="pr-search-results" onKeyDown={e=>{if(e.key==='Escape')setSearch('');}} />
                  {search.trim()&&<div className="pr-search-results" id="pr-search-results"><ul aria-label="Matching employees">{matches.map(p=><li key={p.id}><button type="button" disabled={busy} onClick={()=>{onSelect(p.id);setSearch('');}}>{p.name}{p.division&&<small> · {p.division}</small>}</button></li>)}</ul>{!matches.length&&<p>No matching employees</p>}</div>}
                </div>
                <button type="button" className="pr-navbtn" onClick={() => goTo(idx - 1)} disabled={busy||idx <= 0}>‹ Previous</button>
                <button type="button" className="pr-navbtn" onClick={() => goTo(idx + 1)} disabled={busy||idx === list.length - 1}>Next ›</button>
              </div>
            </div>
          </header>

          <div className="pr-cols">
            <main className="pr-main">

              <section className="pr-card" aria-labelledby="hr">
                <h2 id="hr" className="pr-sec">1 · Hours worked</h2>
                <div className="pr-day-picker"><label>Review<select aria-label="Review pay day" value={day} onChange={e=>setDay(e.target.value)}><option value="">Whole week</option>{days.map(d=><option key={d.date} value={d.date}>{d.label}</option>)}</select></label><span>{day?'Day hours · payslip shows weekly total':'Weekly totals'}{day&&!dailyTotals?.[day]?' · No dated hours':''}</span></div>{day&&row.worked_hours_override&&<p className="pr-sub">Weekly override active. Editing a day will ask to replace it with dated totals.</p>}
                <div className="pr-grid">
                  {field('h1', 'Ordinary hours', 'ordinaryHours')}
                  {field('h2', `Overtime ${sheet.rules.ot1_multiplier}×`, 'ot1Hours')}
                  {field('h3', `Overtime ${sheet.rules.ot2_multiplier}×`, 'ot2Hours')}
                  {field('h4', 'Saturday O/T', 'saturdayHours')}
                  {field('h5', 'Sunday O/T', 'sundayHours')}
                  {field('h6', `Weekday night (${sheet.rules.night_multiplier}×)`, 'nightHours')}
                  {field('h7', `Public holiday worked (${sheet.rules.holiday_work_multiplier}×)`, 'phWorkedHours')}
                </div>
                <div className="pr-grp" style={{ marginTop: 16 }}>Other earnings</div>
                {(inputs.otherEarnings || []).map((x) => (
                  <div className="pr-extra" key={x.key}>
                    <div className="pr-f" style={{ flex: '3 1 260px' }}>
                      <label htmlFor={`ec${x.key}`}>Earning category</label>
                      <select disabled={busy||locked} id={`ec${x.key}`} value={x.categoryId}
                        onChange={(e) => setExtras((l) => l.map((y) => (y.key === x.key ? { ...y, categoryId: e.target.value } : y)))}>
                        <option value="">Choose from payroll settings…</option>
                        {categories.map((c) => <option disabled={extraCodes.includes(c.id)&&c.id!==x.categoryId} key={c.id} value={c.id}>{c.label}</option>)}
                        <optgroup label="Categories to configure">{catalog.filter(c=>!row.profile.allowance_rates?.some(a=>a.name===c.PayCategoryName)&&!rules.some(r=>r.name===c.PayCategoryName)).map((c,i)=><option value={`catalog:${c.Id??i}:${c.PayCategoryName}`} key={String(c.Id??i)}>{c.PayCategoryName}</option>)}</optgroup>
                      </select>
                      {(x.categoryId.startsWith('catalog:')||rules.some(r=>'rule:'+r.code===x.categoryId&&(r.taxable==null||r.superable==null)))&&<Link target="_blank" rel="noopener noreferrer" to="/app/pay/settings#earning-rules">Configure rate and treatment</Link>}
                    </div>
                    <div className="pr-f" style={{ flex: '1 1 140px' }}>
                      <label htmlFor={`eh${x.key}`}>Units</label>
                      <input disabled={busy||locked||!categories.some(c=>c.id===x.categoryId)||Boolean(x.categoryId.startsWith('rule:')&&rules.some(r=>'rule:'+r.code===x.categoryId&&(r.taxable==null||r.superable==null)))} type="number" min="0" step="any" id={`eh${x.key}`} inputMode="decimal" value={x.value}
                        onChange={(e) => setExtras((l) => l.map((y) => (y.key === x.key ? { ...y, value: e.target.value } : y)))} />
                    </div>
                    <button type="button" disabled={busy||locked} className="pr-remove" aria-label="Remove this earning"
                      onClick={() => setExtras((l) => l.filter((y) => y.key !== x.key))}>
                      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4B4B4B" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  </div>
                ))}
                <button type="button" disabled={busy||locked||extraCodes.length>=20} className="pr-add"
                  onClick={() => setExtraCodes(codes=>[...codes,''])}>
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9A3412" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  Add another earning
                </button>
                {extraCodes.length>0&&<div className="pr-category-links"><button type="button" disabled={busy} onClick={()=>api.get('/payroll/workbench/calculation/settings').then(({data})=>{setEarningRules(data.rules?.earning_rules||[]);setExtraCodes(codes=>codes.map(code=>{if(!code.startsWith('catalog:'))return code;const rule=data.rules?.earning_rules?.find(r=>r.name===code.split(':').slice(2).join(':'));return rule?'rule:'+rule.code:code;}));setCatalogError('');}).catch(()=>setCatalogError('Rules could not be refreshed.'))}>Refresh category rules</button><Link to="/app/pay/settings#pay-category-definitions">Browse pay categories</Link><Link target="_blank" rel="noopener noreferrer" to="/app/pay/settings#earning-rules">Configure category rates and rules</Link><Link to={`/app/pay/employees?worker=${encodeURIComponent(row.worker_id)}`}>Set employee earning rates</Link>{(!categories.length||extraCodes.some(c=>c.startsWith('catalog:')))&&<span>Select a category and configure its rate and rule in Pay settings.</span>}{catalogError&&<span role="alert">{catalogError}</span>}</div>}
              </section>

              <section className="pr-card" aria-labelledby="lt">
                <h2 id="lt" className="pr-sec">2 · Leave taken (week)</h2>
                <p className="pr-sub">Annual leave loading: {row.profile.leave_loading_percent||0}%.</p>
                <div className="pr-grid">
                  {field('l1', 'Annual leave', 'annualLeaveHours')}
                  {field('l2', "Personal / carer's", 'personalLeaveHours')}
                  {field('l3', 'Paid public holiday', 'paidPublicHolidayHours')}
                </div>
              </section>

              <section className="pr-card" aria-labelledby="mn">
                <h2 id="mn" className="pr-sec">3 · Allowances &amp; reimbursements ($)</h2>
                <p className="pr-sub">Configured allowance rates are available under Other earnings.</p>
                <div className="pr-grid">
                  {field('a2', 'Living away from home allowance (LAFHA) $', 'lafha')}
                  {field('a4', sheet.rules.meal_allowance==null?'Meals':`Meals · count (${money(sheet.rules.meal_allowance)} each)`, 'meals')}
                  {field('d3', 'Expense reimbursements', 'reimbursements')}
                  {Number(row.entry.lafha)>0&&<><div className="pr-f"><label htmlFor="lafha-tax">LAFHA · PAYG</label><select id="lafha-tax" disabled={busy||locked} value={row.entry.lafha_taxable==null?'':String(row.entry.lafha_taxable)} onChange={e=>onPatch('lafha_taxable',e.target.value===''?null:e.target.value==='true')}><option value="">Select treatment</option><option value="true">Include</option><option value="false">Exclude</option></select></div><div className="pr-f"><label htmlFor="lafha-super">LAFHA · Super</label><select id="lafha-super" disabled={busy||locked} value={row.entry.lafha_superable==null?'':String(row.entry.lafha_superable)} onChange={e=>onPatch('lafha_superable',e.target.value===''?null:e.target.value==='true')}><option value="">Select treatment</option><option value="true">Include</option><option value="false">Exclude</option></select></div></>}
                </div>
              </section>
            </main>

            <aside className="pr-card pr-aside" aria-labelledby="ps">
              <div className="pr-employer">{employer.name} · ABN {employer.abn}</div>
              <h2 id="ps" className="pr-slip-title">Pay slip preview</h2>
              <div className="pr-row bold boxed"><span>Annual leave balance</span><span>{money(result.annualLeaveBalance)}</span></div>
              <div className="pr-grp">Earnings</div>
              <div className="pr-row"><span>Ordinary pay</span><span>{money(result.ordinaryPay)}</span></div>
              <div className="pr-row"><span>Overtime</span><span>{money(result.overtime)}</span></div>
              <div className="pr-row"><span>Leave + loading</span><span>{money(result.leaveAndLoading)}</span></div>
              <div className="pr-row"><span>Allowances</span><span>{money(result.allowances)}</span></div>
              <div className="pr-row"><span>Other earnings</span><span>{money(calculation?.other_earnings??(calculation?0:null))}</span></div>
              <div className="pr-row"><span>Super ({sheet.rules.super_percent}%)</span><span>{money(result.super)}</span></div>
              <details className="pr-super-adjust"><summary>Adjust super</summary><label>Qualifying earnings $<input aria-label="Super qualifying earnings override" type="number" min="0" step="0.01" disabled={busy||locked} placeholder={calculation?.qualifying_earnings==null?'Automatic':String(calculation.qualifying_earnings)} value={row.entry.qualifying_earnings??''} onChange={e=>onPatch('qualifying_earnings',e.target.value===''?null:Number(e.target.value))}/></label><button type="button" disabled={busy||locked||row.entry.qualifying_earnings==null} onClick={()=>onPatch('qualifying_earnings',null)}>Use automatic</button><small>Override for eligibility, allowance treatment, leave loading or contribution cap.</small></details>
              {calculation?.super_issues?.length>0&&<small>Super adjustment required</small>}
              <div className="pr-grp">Tax &amp; reimbursements</div>
              <div className="pr-row"><span>PAYG withholding</span><span>{money(result.payg)}</span></div>
              <div className="pr-row"><span>Reimbursements</span><span>{money(result.reimbursements)}</span></div>
              {Number(calculation?.deductions)>0&&<div className="pr-row"><span>Other deductions</span><span>{money(calculation.deductions)}</span></div>}
              <div className="pr-grp">Annual leave</div>
              <div className="pr-row"><span>Taken this pay</span><span>{money(result.annualLeaveTakenPay)}</span></div>
              <div className="pr-row bold big"><span>Net pay (take home)</span><span>{money(result.net)}</span></div>
              <div className="pr-row bold last"><span>Gross</span><span>{money(result.gross)}</span></div>
            </aside>
          </div>
          <Link className="pr-preparation" to={preparationUrl}>Pay-run preparation</Link>
        </div>

        <div className="pr-bar">
          <div className="pr-bar-inner">
            <div className="pr-totals">
              <div>Gross <strong>{money(result.gross)}</strong></div>
              <div>PAYG <strong>{money(result.payg)}</strong></div>
              <div>Net <strong>{money(result.net)}</strong></div>
            </div>
            <label className="pr-confirm">
              <input type="checkbox" disabled={busy||locked} checked={confirmed} onChange={(e) => onPatch('hours_reviewed',e.target.checked)} />
              Pay and super checked
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="pr-btn-ghost" disabled={busy||locked} onClick={onSaveDraft}>Save draft</button>
              <button type="button" className="pr-btn-go" disabled={!canFinalise}
                title={!canFinalise?'Complete the outstanding checks in pay-run preparation':undefined}
                onClick={onMarkChecked}>
                Mark checked &amp; next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
