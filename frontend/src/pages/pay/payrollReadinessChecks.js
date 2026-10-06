export function validAbn(value) {
  const digits=String(value||'').replace(/\s/g,'');
  if(!/^[0-9]{11}$/.test(digits))return false;
  const weights=[10,1,3,5,7,9,11,13,15,17,19];
  return digits.split('').reduce((sum,n,i)=>sum+(Number(n)-(i===0?1:0))*weights[i],0)%89===0;
}
export function payrollReadiness({sheet,report,branding,dirty}) {
  const checks=[];
  const add=(id,label,ok,action)=>checks.push({id,label,ok:!!ok,action});
  add('saved','Current worksheet saved',sheet?.revision>0&&!dirty,'Save the current worksheet.');
  add('reviewed','Worksheet reviewed',sheet?.reviewed&&report?.ready&&!dirty,'Resolve payroll warnings, then mark the worksheet reviewed.');
  add('employer','Legal employer name recorded',branding?.employer_name?.trim(),'Enter the registered employer name in Payslip settings.');
  add('abn','Employer ABN format verified',validAbn(branding?.employer_abn),'Enter an 11-digit ABN with a valid checksum. This does not verify its registration or ownership.');
  add('workers','Employees included',report?.rows?.length>0,'Add employees and calculate the worksheet.');
  const workers=(report?.rows||[]).map(row=>{
    const issues=[...(row.result?.issues||[])];
    if(!row.profile?.super_fund_name?.trim())issues.push('Record the employee’s selected super fund name.');
    if(!row.profile?.super_fund_usi?.trim())issues.push('Record the selected fund USI, or arrange separate handling for an SMSF.');
    if(Number(row.result?.deductions)>0&&!row.entry?.deduction_details?.trim())issues.push('Record deduction amounts, recipients and authorisation references.');
    return {id:row.worker_id,name:row.name,issues:[...new Set(issues)]};
  });
  return {checks,workers,remaining:checks.filter(c=>!c.ok).length+workers.reduce((sum,w)=>sum+w.issues.length,0)};
}
