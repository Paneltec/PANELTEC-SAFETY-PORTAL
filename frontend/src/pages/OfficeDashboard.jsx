// Office Dashboard — the first screen for office staff. Shows the outside
// programs (Simpro, Xero, ...) this person has been given, grouped by
// category. Admins (users.edit) see every program and a link to manage them.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Open20Regular, Apps20Regular } from '@fluentui/react-icons';
import api, { apiError } from '../lib/api';
import { PageHeader, EmptyState } from '../components/capture/Ui';

export function groupByCategory(items) {
  const map = new Map();
  for (const it of items) {
    const key = (it.category || '').trim() || 'Other';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return [...map.entries()];
}

export default function OfficeDashboard() {
  const [items, setItems] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/office-apps/mine')
      .then((r) => {
        if (!live) return;
        setItems(r.data?.items || []);
        setCanManage(Boolean(r.data?.can_manage));
      })
      .catch((e) => { if (live) { setError(apiError(e)); setItems([]); } });
    return () => { live = false; };
  }, []);

  const groups = useMemo(() => groupByCategory(items || []), [items]);

  return (
    <div className="p-6 lg:p-8" data-testid="office-dashboard-page">
      <PageHeader
        crumb="Office"
        title="Office Dashboard"
        subtitle="Choose the program you want to open."
        action={canManage ? (
          <Link to="/app/office/programs" data-testid="office-manage-link"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
            Manage programs and access
          </Link>
        ) : null}
      />

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          Couldn't load your programs. {error}
        </div>
      )}

      {items === null && <div className="text-sm text-slate-500">Loading your programs…</div>}

      {items !== null && !error && items.length === 0 && (
        <EmptyState
          title={canManage ? 'No programs added yet' : 'No programs have been set up for you yet'}
          body={canManage
            ? 'Add the programs the office uses, then choose who can see each one.'
            : 'Ask your administrator to give you access to the programs you need.'}
        />
      )}

      {groups.map(([category, apps]) => (
        <section key={category} className="mb-6" data-testid={`office-group-${category}`}>
          <h2 className="text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-500 mb-2">{category}</h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {apps.map((a) => {
              const inner = (
                <>
                  <span className="grid place-items-center w-10 h-10 rounded-xl bg-orange-50 text-orange-600 shrink-0">
                    <Apps20Regular />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-900 break-words">{a.label}</span>
                    <span className="block text-xs text-slate-500 break-words">
                      {a.url ? (a.description || 'Opens in a new tab') : 'No web address set yet'}
                    </span>
                  </span>
                  {a.url ? <Open20Regular className="text-slate-400 shrink-0" /> : null}
                </>
              );
              const cls = 'rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-3 min-h-[72px]';
              return (
                <li key={a.id}>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noopener noreferrer"
                      data-testid={`office-app-${a.id}`}
                      className={`${cls} hover:border-orange-300 hover:shadow-sm transition`}>
                      {inner}
                    </a>
                  ) : (
                    <div className={`${cls} opacity-70`} data-testid={`office-app-${a.id}`}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
