import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import api,{apiError} from '../../lib/api';
const cash=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n);
export default function PayrollRunCategories({profile,rules,result,hoursFromShifts=false}){
 const [rows,setRows]=useState(null),[query,setQuery]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let active=true;api.get('/payroll/employee-records/configuration/catalog/pay-categories').then(({data})=>{if(active)setRows(data.tables?.Export||[]);}).catch(e=>{if(active)setError(apiError(e)||'Could not load global pay categories');});return()=>{active=false;};},[]);
 const casual=profile.employment_type==='casual',salary=profile.pay_basis==='annual_salary';
 const base=salary?profile.annual_salary/52/profile.ordinary_weekly_hours:casual&&profile.casual_rates?profile.casual_rates.base_rate*(1+profile.casual_rates.loading_percent/100):profile.hourly_rate;
 function connection(category){
  const name=String(category.PayCategoryName||'').trim();
  let key=null,label='';
  if(name==='Salary'&&salary){key='ordinary';label='Ordinary hours (salary)';}
  if(name==='Permanent Ordinary Hours'&&!casual&&!salary&&['full_time','part_time'].includes(profile.employment_type)){key='ordinary';label='Ordinary hours';}
  if(casual&&profile.casual_rates){
   const pair={'Casual Ordinary Hours':['ordinary','Ordinary hours'],'Casual - Overtime 1.5':['ot1','Overtime tier 1 hours'],'Casual - Overtime 2.0':['ot2','Overtime tier 2 hours'],'Casual - Public Holiday Worked':['holiday_work','Public holiday worked hours']}[name];
   if(pair)[key,label]=pair;
  }
  if(!key||category.RateUnit!==(name==='Salary'?'Annually':'Hourly'))return null;
  const fallback={ordinary:base,ot1:profile.casual_rates?.ot1??base*rules.ot1_multiplier,ot2:profile.casual_rates?.ot2??base*rules.ot2_multiplier,holiday_work:profile.casual_rates?.holiday_work??base*rules.holiday_work_multiplier};
  return {key,label,rate:result?.applied_rates?.[key]??fallback[key]};
 }
 const filtered=(rows||[]).filter(c=>[c.PayCategoryName,c.RateUnit,c.Id].some(v=>String(v??'').toLowerCase().includes(query.toLowerCase())));
 return <details className="border rounded-xl p-3" aria-label="Imported pay categories"><summary className="font-semibold cursor-pointer">Pay categories from global settings{rows?` (${rows.length})`:''}</summary><p className="text-sm my-2">Search all imported categories. Where a category is already supported for this employee, use its hours field below. Categories marked “Needs calculation setup” are visible for reference and do not add pay.</p><label className="block text-sm">Search pay categories<input type="search" className="border rounded-lg p-2 w-full my-2" value={query} onChange={e=>setQuery(e.target.value)}/></label>{error&&<p role="alert">{String(error)}</p>}{!rows&&!error&&<p>Loading categories…</p>}{rows&&<><p className="text-xs mb-2">Showing {filtered.length} of {rows.length} categories. Source multipliers are shown for reference; supported entries use this pay run’s calculation rules and employee rate overrides.</p><div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead><tr><th className="text-left p-2">Category</th><th className="text-left p-2">Pay entry</th></tr></thead><tbody>{filtered.map((c,i)=>{const linked=connection(c);return <tr key={String(c.Id??i)} className="border-t"><td className="p-2"><strong>{c.PayCategoryName}</strong><p className="text-xs">{c.RateUnit||'Unit not specified'}{c.PenaltyLoadingMultiplier!=null&&c.PenaltyLoadingMultiplier!==''?` · Source penalty multiplier ${c.PenaltyLoadingMultiplier}`:''}{c.RateLoadingMultiplier!=null&&c.RateLoadingMultiplier!==''?` · Source rate multiplier ${c.RateLoadingMultiplier}`:''}</p></td><td className="p-2">{linked?<><p>{linked.rate>0?`${cash(linked.rate)} / hour`:'Employee rate needs setup'}</p><button type="button" disabled={hoursFromShifts} className="underline text-left disabled:no-underline" onClick={()=>document.getElementById(`pay-entry-${linked.key}`)?.focus()}>{hoursFromShifts?'Calculated from shift times':`Go to ${linked.label.toLowerCase()}`}</button></>:<span className="text-amber-900">Needs calculation setup for this employee</span>}</td></tr>;})}</tbody></table>{!filtered.length&&<p className="p-2">{rows.length?'No matching categories.':'No global pay categories have been imported yet.'}</p>}</div></>}<Link className="inline-block underline mt-3 text-sm" to="/app/pay/settings#pay-category-definitions">Manage global pay categories</Link></details>;
}
