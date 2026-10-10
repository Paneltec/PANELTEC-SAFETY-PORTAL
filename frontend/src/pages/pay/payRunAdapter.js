// The server remains the authority for payroll totals and review readiness.
export const money=v=>v==null?'—':new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(v);
export const hours=v=>v==null?'—':`${Number(v).toFixed(2)} h`;
export function payRunSummary(row,result){
 const sum=keys=>!result||keys.some(k=>result[k]==null)?null:keys.reduce((n,k)=>n+Number(result[k]),0);
 return {ordinaryPay:result?.ordinary_pay,overtime:sum(['ot1_pay','ot2_pay','night_pay','holiday_work_pay']),leaveAndLoading:sum(['annual_pay','personal_pay','public_holiday_pay','leave_loading']),allowances:sum(['taxable_allowances','meal_allowance_pay','configured_allowances']),super:result?.super,gross:result?.gross,payg:result?.payg,net:result?.net,reimbursements:result?.reimbursements,annualLeaveTakenHours:row.entry.annual,annualLeaveTakenPay:sum(['annual_pay','leave_loading']),annualLeaveBalance:result?.annual_base_value};
}

export const sortPayRunEmployees=list=>[...list].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'en-AU',{sensitivity:'base'}));

// Preserve source shifts; only pay-run totals are overridden by a direct edit.
export function editPayRunEntry(row,key,value,calculatedEntry){
 const worked=['ordinary','ot1','ot2','night','holiday_work','meal_count'];
 const override=worked.includes(key)&&(row.shifts!=null||row.daily_hours!=null);
 const source=override&&!row.worked_hours_override?(calculatedEntry||row.entry):row.entry;
 const entry={...row.entry,...(override?Object.fromEntries([...worked,'penalty_ordinary'].map(k=>[k,source[k]??0])):{}),[key]:value};
 if(key==='hours_reviewed')entry.super_reviewed=value;
 else if(!['super_reviewed','payg_reference','deduction_details','allowance_details'].includes(key)){entry.hours_reviewed=false;entry.super_reviewed=false;}
 if(override)entry.penalty_ordinary=Math.min(entry.penalty_ordinary||0,(entry.night||0)+(entry.holiday_work||0));
 return {...row,worked_hours_override:row.worked_hours_override||override,entry};
}
