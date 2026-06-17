import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import api from '../../lib/api';

export default function OutboxBell() {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/email/outbox?status=queued&limit=200');
      setCount(data?.count ?? (data?.items || []).length);
    } catch { /* permission may be missing; silently hide */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [load]);

  return (
    <Link to="/app/outbox" title={`Email outbox — ${count} queued`} className="relative p-2 rounded-lg hover:bg-slate-100 inline-flex"
      data-testid="topbar-outbox-bell">
      <Mail size={18} className="text-slate-600" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-brand-amber text-white text-[10px] font-semibold inline-flex items-center justify-center" data-testid="outbox-bell-badge">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
