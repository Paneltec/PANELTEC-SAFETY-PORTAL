import React, { useEffect, useRef, useState } from 'react';
import api, { apiError } from '@/lib/api';
import { getUser } from '@/lib/auth';

export default function AppUpdateCard() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const startedAt = useRef(0);
  const observedUpdate = useRef(false);
  const mounted = useRef(true);
  const isAdmin = getUser()?.role === 'admin';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      try {
        const { data } = await api.get('/admin/app-updates/status', { timeout: 10000 });
        if (stopped) return;
        if (data.busy) observedUpdate.current = true;
        setStatus(old => ({ ...old, ...data }));
        setError('');
        if (!data.busy) setPending(false);
        if (data.busy && !startedAt.current) startedAt.current = Date.now();
      } catch (e) {
        if (!stopped) setError(pending ? 'App is restarting. Waiting to reconnect...' : apiError(e));
      }
      if (!stopped && (!startedAt.current || Date.now() - startedAt.current < 20 * 60 * 1000)) {
        timer = setTimeout(poll, pending ? 4000 : 15000);
      } else if (!stopped) {
        setError('The update is taking longer than expected. Check Portainer before retrying.');
      }
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [isAdmin, pending]);

  if (!isAdmin) return null;
  const busy = loading || pending || status?.busy;
  const check = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/admin/app-updates/check', { timeout: 30000 });
      if (mounted.current) setStatus(data);
    } catch (e) { if (mounted.current) setError(apiError(e)); }
    finally { if (mounted.current) setLoading(false); }
  };
  const execute = async () => {
    const action = confirm;
    setConfirm(null); setLoading(true); setError('');
    try {
      await api.post(`/admin/app-updates/${action}`, action === 'install' ? { sha: status.release.sha } : {}, { timeout: 15000 });
      observedUpdate.current = true;
      startedAt.current = Date.now();
      setPending(true);
      setStatus(old => ({ ...old, available: false, busy: true, message: 'Update accepted. Keep this page open.' }));
    } catch (e) { setError(apiError(e)); }
    finally { setLoading(false); }
  };
  const version = status?.current;
  const upToDate = status?.release && version?.backend === status.release.sha && version?.web === status.release.sha;
  const showCompletion = status?.phase === 'complete' && observedUpdate.current;
  const showMessage = status?.message && (status?.phase !== 'complete' || showCompletion);
  const installLabel = busy ? 'Working...' : status?.phase === 'recovery_required' ? 'Recovery required' : status?.available ? 'Install update' : upToDate ? 'Up to date' : 'Check for updates first';
  return <section aria-label="Paneltec app updates" className="mb-6 rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
    <h2 className="text-xl font-semibold text-slate-900">Paneltec app updates</h2>
    <p className="mt-1 text-sm text-slate-600">Click Check for updates. When a newer release is ready, Install update turns blue. Updates briefly restart the app; reload when finished.</p>
    {version && <p className="mt-2 text-sm">Installed: backend {version.backend?.slice(0, 7)} | website {version.web?.slice(0, 7)}</p>}
    {status?.release && <p className="mt-2 text-sm">Latest release: {status.release.sha.slice(0, 7)} - {status.release.title}</p>}
    {upToDate && !busy && <p className="mt-2 text-sm text-green-700">You are up to date with the latest successful build.</p>}
    {showMessage && <p role="status" className="mt-2 text-sm text-slate-700">{status.message}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-amber-800">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <button onClick={check} disabled={busy} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">Check for updates</button>
      <button onClick={() => setConfirm('install')} disabled={busy || !status?.available || status?.phase === 'recovery_required'}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed">{installLabel}</button>
      {status?.can_rollback && <button onClick={() => setConfirm('rollback')} disabled={busy}
        className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">Restore previous version</button>}
      {showCompletion && !busy && <button onClick={() => window.location.reload()} className="rounded-lg border px-4 py-2 text-sm">Reload app</button>}
    </div>
    {confirm && <div role="dialog" aria-label="Confirm app update" className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <p className="text-sm">{confirm === 'install' ? 'Install this release now? Save any work first. The app will be briefly unavailable.' : 'Restore the previous app images? Save any work first. This does not undo database changes.'}</p>
      <div className="mt-3 flex gap-2">
        <button onClick={execute} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">{confirm === 'install' ? 'Install now' : 'Restore now'}</button>
        <button onClick={() => setConfirm(null)} className="rounded-lg border bg-white px-3 py-2 text-sm">Cancel</button>
      </div>
    </div>}
  </section>;
}
