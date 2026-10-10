import React, {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import api, {apiError} from '../../lib/api';
import {PayCard} from './PayShell';

// Fair Work MA000020 clause 19.1(a), verified 10 October 2026.
// Classification minima only. These figures never feed payroll calculations.
const rates = [
  ['CW/ECW 1a', 1013.50, 26.67], ['CW/ECW 1b', 1033.50, 27.20],
  ['CW/ECW 1c', 1047.30, 27.56], ['CW/ECW 1d', 1066.00, 28.05],
  ['CW/ECW 2', 1087.50, 28.62], ['CW/ECW 3', 1119.10, 29.45],
  ['CW/ECW 4', 1154.40, 30.38], ['CW/ECW 5', 1189.60, 31.31],
  ['CW/ECW 6', 1221.30, 32.14], ['CW/ECW 7', 1256.30, 33.06],
  ['CW/ECW 8', 1286.70, 33.86], ['ECW 9', 1309.50, 34.46],
];
const money = value => value.toLocaleString('en-AU', {style:'currency', currency:'AUD'});
const external = 'underline font-semibold';
export default function PayAwardRates() {
  const [workers,setWorkers] = useState(null), [error,setError] = useState('');
  const [search,setSearch] = useState(''), [division,setDivision] = useState('all');
  useEffect(() => {
    let active=true;
    api.get('/payroll/employee-records/configuration/awards/employee-summary')
      .then(({data}) => {if(active)setWorkers(data.workers);})
      .catch(e => {if(active)setError(apiError(e)||'Could not load employee awards');});
    return () => {active=false;};
  }, []);
  const filtered=(workers||[]).filter(w => (division==='all'||w.division===division) &&
    `${w.name} ${w.department} ${w.classification}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="space-y-5">
    <header><h2 className="text-2xl font-bold">Award rates</h2>
      <p className="text-sm mt-1">Official references. Agreed employee rates remain separately editable.</p></header>
    <PayCard title="MA000020 · Building and Construction General On-site Award">
      <p className="font-semibold">Minimum classification rates only</p>
      <p className="text-sm mt-1 mb-3">Excludes additional allowances, daily-hire and casual loadings. These are not the complete payable rates. Apprentices have separate rates.</p>
      <p className="text-sm mb-3">Effective from the first full pay period starting on or after 1 July 2026 · Reference checked 10 October 2026.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left">
        <caption className="sr-only">MA000020 clause 19.1(a) classification minima in Australian dollars</caption>
        <thead><tr className="border-b"><th scope="col" className="p-2">Classification</th><th scope="col" className="p-2 text-right">Hourly minimum</th><th scope="col" className="p-2 text-right">Weekly minimum</th></tr></thead>
        <tbody>{rates.map(([level,weekly,hourly])=><tr key={level} className="border-b"><th scope="row" className="p-2 font-medium">{level}</th><td className="p-2 text-right">{money(hourly)}</td><td className="p-2 text-right">{money(weekly)}</td></tr>)}</tbody>
      </table></div>
      <div className="flex flex-wrap gap-4 mt-4 text-sm">
        <a className={external} href="https://awards.fairwork.gov.au/MA000020.html" target="_blank" rel="noopener noreferrer">Official award and conditions</a>
        <a className={external} href="https://calculate.fairwork.gov.au/" target="_blank" rel="noopener noreferrer">Calculate full rate in Fair Work PACT</a>
        <Link className={external} to="/app/pay/settings#awards">Edit shared awards</Link>
      </div>
      <p className="text-xs mt-3">Reference snapshot; updates are not automatic. No rates or employee assignments are changed by this page.</p>
    </PayCard>
    <PayCard title="Employee awards" aside={<span className="text-sm">{workers ? `${workers.length} employees` : ''}</span>}>
      <p className="text-sm mb-3">Recorded award / classification shown below. Review against duties, employment type and contract before confirming.</p>
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="search" aria-label="Search employee awards" placeholder="Search employee or award..." value={search} onChange={e=>setSearch(e.target.value)} className="border rounded-lg p-2 flex-1 min-w-48"/>
        <select aria-label="Company" value={division} onChange={e=>setDivision(e.target.value)} className="border rounded-lg p-2"><option value="all">Both companies</option><option value="paneltec">Paneltec Civil</option><option value="viatec">Viatec Traffic</option></select>
      </div>
      {error ? <p role="alert">{error}</p> : !workers ? <p role="status">Loading employee awards...</p> : <>
        <p className="text-sm mb-2">{filtered.length} shown · {filtered.filter(w=>!w.classification.trim()).length} without an award recorded</p>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr className="border-b"><th scope="col" className="p-2">Employee / department</th><th scope="col" className="p-2">Recorded award / classification</th><th scope="col" className="p-2">Conditions</th><th scope="col" className="p-2">Edit</th></tr></thead>
          <tbody>{filtered.map(w=><tr key={w.id} className="border-b"><th scope="row" className="p-2 font-medium">{w.name}<span className="block text-xs font-normal">{w.division==='viatec'?'Viatec Traffic':'Paneltec Civil'}{w.department ? ` · ${w.department}` : ''}</span></th><td className="p-2">{w.classification||'Unassigned'}</td><td className="p-2">{w.conditions_reviewed?'Marked reviewed':'Review'}</td><td className="p-2"><Link className="underline" aria-label={`Edit award for ${w.name}`} to={`/app/pay/employees?worker=${encodeURIComponent(w.id)}`}>Edit</Link></td></tr>)}</tbody>
        </table></div>{filtered.length===0&&<p className="py-3">No matching employees.</p>}
      </>}
      <a className="inline-block text-sm underline mt-4" href="https://library.fairwork.gov.au/viewer/?krn=K700036" target="_blank" rel="noopener noreferrer">Fair Work: traffic controller award coverage</a>
    </PayCard>
  </div>;
}
