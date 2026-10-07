import React from 'react';
import './payrollTheme.css';
export const flowSteps=['Choose week','Check employees','Complete pay run'];
export const cash=n=>n==null?'Needs review':new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n);
export function FlowSteps({step,onChange,locked=false}){return <nav className="pay-steps" aria-label="Pay run steps">{flowSteps.map((name,i)=><button key={name} type="button" aria-current={step===i+1?'step':undefined} disabled={!onChange} onClick={()=>onChange?.(i+1)} className={step===i+1?'active':locked&&i<2?'done':''}>{i+1} {name}{locked&&i<2?' ✓':''}</button>)}</nav>}
export function FlowHeading({step,title,week,payday,children}){return <header className="pay-flow-heading"><div><p className="pay-eyebrow">{step?`Step ${step} of 3`:"Pay run"}{week?` · Week starting ${week}`:''}{payday?` · Pay date ${payday}`:''}</p><h2>{title}</h2></div>{children}</header>}
export function PayMetrics({items}){return <div className="pay-metrics">{items.map(([label,value,note,accent])=><div key={label} className={accent?'accent':''}><small>{label}</small><strong>{value}</strong>{note&&<span>{note}</span>}</div>)}</div>}
export function PayBadge({children,tone=''}){return <span className={`pay-badge ${tone}`}>{children}</span>}
