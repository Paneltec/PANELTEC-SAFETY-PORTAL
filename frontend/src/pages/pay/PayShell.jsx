import { useCan } from '../../lib/permissions';
// Paneltec Pay — the pay area's own frame (Overview → Paneltec Pay).
//
// Deliberately a different look from the rest of the portal so staff
// know at a glance they're in the pay area: deep indigo band, gold
// accent, its own wordmark and tabs. Same page layout underneath.
import React from 'react';
import './payrollTheme.css';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Coins } from 'lucide-react';

export const PAY = {
  ink: '#1e1b4b',        // deep indigo
  ink2: '#312e81',
  gold: '#f59e0b',
  goldSoft: '#fef3c7',
  paper: '#f7f6fb',
  line: '#e0dff0',
  muted: '#6b6a8a',
};

const TABS = [
  {to:'/app/pay',label:'Pay runs'},
  {to:'/app/pay/run-report',label:'Pay-run report'},
  {to:'/app/pay/reports',label:'Pay reports'},
  {to:'/app/pay/super',label:'Pay super'},
  {to:'/app/pay/employees',label:'Employee settings'},
  {to:'/app/pay/award-rates',label:'Award rates'},
  {to:'/app/pay/providers',label:'Provider connection settings'},
  {to:'/app/pay/settings',label:'Settings'},
  {to:'/app/pay/access',label:'Manage access'},
];

export function PayCard({ title, aside, children, className = '', testid }) {
  return (
    <section data-testid={testid}
      className={`rounded-2xl bg-white shadow-sm ${className}`}
      style={{ border: `1px solid ${PAY.line}` }}>
      {(title || aside) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${PAY.line}` }}>
          <div className="font-display font-bold text-sm tracking-wide" style={{ color: PAY.ink }}>{title}</div>
          {aside}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export const payBtn = (kind = 'primary') => ({
  primary: 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white disabled:opacity-50',
  gold: 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50',
  ghost: 'inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50',
}[kind]);

export const payBtnStyle = (kind = 'primary') => ({
  primary: { background: PAY.ink2 },
  gold: { background: PAY.gold, color: PAY.ink },
  ghost: { borderColor: PAY.line, color: PAY.ink2 },
}[kind]);

export function StatusPill({ status }) {
  const map = {
    draft: ['Draft', '#e5e7eb', '#374151'],
    submitted: ['Submitted', '#dbeafe', '#1e40af'],
    approved: ['Approved', '#d1fae5', '#065f46'],
    rejected: ['Rejected', '#fee2e2', '#991b1b'],
    locked: ['Locked', '#ede9fe', '#4c1d95'],
    open: ['Open', '#dbeafe', '#1e40af'],
    closed: ['Closed', '#ede9fe', '#4c1d95'],
  };
  const [label, bg, fg] = map[status] || [status, '#e5e7eb', '#374151'];
  return <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: bg, color: fg }}>{label}</span>;
}

export function fmtDay(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtRange(start, end) {
  const a = new Date(start + 'T00:00:00'); const b = new Date(end + 'T00:00:00');
  const sameMonth = a.getMonth() === b.getMonth();
  return `${a.toLocaleDateString('en-AU', { day: 'numeric', month: sameMonth ? undefined : 'short' })} – ${b.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export default function PayShell() {
  const can = useCan();
  const location=useLocation();
  const week=new URLSearchParams(location.search).get("week");
  if (!can('payroll', 'view')) return <div role="alert" className="p-6 rounded-xl border bg-white">Payroll access is restricted. Contact the payroll owner to request access.</div>;
  return (
    <div className="pay-theme -mx-4 -mt-6 sm:-mx-6 sm:-mt-8 lg:-mx-8 lg:-mt-10 min-h-full rounded-b-2xl" style={{ background: PAY.paper }} data-testid="pay-shell">
      <div className="px-4 sm:px-6 lg:px-8 pt-5 pb-0 text-white" style={{ background: `linear-gradient(135deg, ${PAY.ink} 0%, ${PAY.ink2} 100%)` }}>
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: PAY.gold, color: PAY.ink }}>
              <Coins size={22} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: PAY.gold }}>Paneltec Group</div>
              <h1 className="font-display font-extrabold text-2xl leading-tight">Paneltec Pay</h1>
            </div>
            <div className="ml-auto hidden sm:block text-xs text-indigo-200">Weekly pay · payslips · reports</div>
          </div>
          <nav className="mt-4 flex flex-wrap gap-1" data-testid="pay-tabs">
            {TABS.map((t) => {const active=t.to==='/app/pay'?['/app/pay','/app/pay/payroll'].includes(location.pathname):location.pathname===t.to;return (
              <Link onClick={e=>{if(!window.dispatchEvent(new Event("payroll:navigate",{cancelable:true})))e.preventDefault();}} key={t.to} to={t.to+(['/app/pay/reports','/app/pay/super'].includes(t.to)&&week?`?week=${week}`:'')}
                className={`whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-semibold transition ${active ? 'bg-white' : 'text-indigo-100 hover:bg-white/10'}`}
                style={active ? { color: PAY.ink } : undefined}>
                {t.label}
              </Link>
            );})}
          </nav>
        </div>
      </div>
      <div className="px-4 sm:px-6 lg:px-8 py-5">
        <div className="max-w-7xl mx-auto"><Outlet /></div>
      </div>
    </div>
  );
}
