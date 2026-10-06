import React from 'react';
import {payrollReadiness} from './payrollReadinessChecks';
export default function PayrollReadiness(props) {
 const {checks,workers,remaining}=payrollReadiness(props);
 return <details className="border rounded-xl p-4 mb-4"><summary className="font-semibold cursor-pointer">Pay-run preparation checks · {remaining} items to resolve</summary>
 <p className="text-sm my-3">These checks cover the current worksheet and employer settings. Passing them does not confirm award compliance, bank acceptance, STP readiness or that payslips can be issued.</p>
 <ul className="space-y-2 text-sm">{checks.map(check=><li key={check.id} className={check.ok?'text-green-800':'text-amber-900'}><strong>{check.ok?'Complete':'Needs attention'} — {check.label}</strong>{!check.ok&&<p>{check.action}</p>}</li>)}</ul>
 {workers.filter(w=>w.issues.length).map(worker=><div key={worker.id} className="border-t mt-3 pt-3 text-sm"><strong>{worker.name}</strong><p className="text-xs">Worker ID: {worker.id}</p><ul className="list-disc pl-5">{worker.issues.map(issue=><li key={issue}>{issue}</li>)}</ul></div>)}
 <p className="bg-amber-50 rounded p-3 text-sm mt-3">Still required before live payroll: payslip issuing and correction workflow, verified opening balances, full access checks, Westpac acceptance, STP and super provider setup, and reconciliation against Wojo.</p>
 </details>;
}
