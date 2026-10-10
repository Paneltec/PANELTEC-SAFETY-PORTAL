import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import api,{apiError} from '../../lib/api';
const cash=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n);
export default function PayrollRunCategories({profile,rules,result,hoursFromShifts=false}){
 const [rows,setRows]=useState(null),[error,setError]=useState('');
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
 const applicable=(rows||[]).map(category=>({category,linked:connection(category)})).filter(({linked})=>linked);
 return <section className="border rounded-xl p-3" aria-label="Employee pay categories">
  <h4 className="font-semibold">Pay categories for this employee</h4>
  {error&&<p role="alert" className="text-sm my-2">{String(error)}</p>}
  {!rows&&!error&&<p className="text-sm my-2">Loading categories…</p>}
  {rows&&<>
   {applicable.length>0?<ul className="space-y-2 my-2">{applicable.map(({category,linked},i)=><li key={String(category.Id??i)} className="text-sm flex justify-between flex-wrap gap-2">
    <span><strong>{category.PayCategoryName}</strong> · {linked.rate>0?`${cash(linked.rate)} / hour`:'Employee rate needs setup'}</span>
    <button type="button" disabled={hoursFromShifts} className="underline text-left disabled:no-underline" onClick={()=>document.getElementById(`pay-entry-${linked.key}`)?.focus()}>{hoursFromShifts?'Calculated from shift times':`Go to ${linked.label.toLowerCase()}`}</button>
   </li>)}</ul>:<p className="text-sm my-2">No imported categories are linked to this employee’s current setup. Review Employee settings and Pay settings.</p>}
  </>}
  <Link className="inline-block underline mt-2 text-sm" to="/app/pay/settings#pay-category-definitions">Manage pay categories in Pay settings</Link>
 </section>;
}
