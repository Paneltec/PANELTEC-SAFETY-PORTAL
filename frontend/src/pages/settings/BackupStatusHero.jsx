import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { TOKEN_KEY } from '@/lib/api';
import { openAccordionSection } from './AdvancedAccordion';

const SUMMARY_URL = (process.env.REACT_APP_BACKEND_URL || '') + '/api/backup/summary';
const bytes = n => n ? `${(n / 1048576).toFixed(1)} MB` : 'Size not reported';
const when = value => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? date.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : 'Not recorded yet';
};

export default function BackupStatusHero({ onBackup, busy = false, onRefresh }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState('');
  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem(TOKEN_KEY) || '';
      const response = await fetch(SUMMARY_URL, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to refresh backup status. Please try again.');
      setData(await response.json());
      setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => {
    load();
    const tick = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000);
    return () => clearInterval(tick);
  }, [load]);
  useEffect(() => { if (!busy) load(); }, [busy, load]);
  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([load(), onRefresh?.()]); }
    finally { setRefreshing(false); }
  };
  const retryDropbox = async () => {
    setRetrying(true); setRetryMessage('Retrying the Dropbox backup. This can take a few minutes.');
    try {
      const token = localStorage.getItem(TOKEN_KEY) || '';
      const response = await fetch((process.env.REACT_APP_BACKEND_URL || '') + '/api/backup/offsite/retry', {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || result.reason || 'Dropbox backup failed.');
      setRetryMessage(result.nothing_to_do ? 'No backup is waiting to upload.' : 'Backup saved to Dropbox.');
      await load();
    } catch (e) { setRetryMessage(e.message); }
    finally { setRetrying(false); }
  };
  if (!data) return <div className="mb-5 rounded-xl border bg-white p-6" role="status">
    {error || 'Checking your backups...'}
    {error && <button className="ml-3 underline" onClick={load}>Try again</button>}
  </div>;

  const snap = data.last_snapshot;
  const delivered = data.last_delivery;
  const enabled = data.backups_enabled !== false;
  const healthy = data.health === 'healthy' && !error;
  const title = error ? 'Backup status could not be refreshed' : !enabled ? 'Automatic backups are switched off' : healthy ? 'Your backups are working' : 'Your backups need attention';
  const explanation = !enabled ? 'Enable backups on the server before making a new backup.'
    : healthy ? 'A recent backup has reached a backup destination. The details below show where it was saved.'
    : 'Check the last saved copy below. A backup made on Umbrel still needs to reach your NAS or an off-site destination.';
  const buttonClass = 'rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50';
  return <section data-testid="backup-status-hero" data-health={error ? 'unknown' : data.health} className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className={`border-b p-5 sm:p-6 ${healthy ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-start gap-3">
        {healthy ? <CheckCircle2 className="mt-1 h-6 w-6 shrink-0 text-emerald-700"/> : <AlertCircle className="mt-1 h-6 w-6 shrink-0 text-amber-700"/>}
        <div>
          <h2 className="text-xl font-semibold text-slate-900" data-testid="backup-status-pill">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-700">{explanation}</p>
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error} The details below may be out of date.</p>}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button data-testid="backup-status-snapshot-now" onClick={onBackup} disabled={busy || !enabled}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-500">
          {busy ? 'Creating backup...' : 'Back up now'}
        </button>
        <button data-testid="backup-status-show-history" className={buttonClass} onClick={() => openAccordionSection('snapshot-history')}>View backup history</button>
        <button className={buttonClass} onClick={() => openAccordionSection('restore')}>Restore a backup</button>
        <button className={buttonClass} onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`mr-2 inline h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}/>{refreshing ? 'Refreshing...' : 'Refresh status'}
        </button>
      </div>
      <p role="status" className="mt-3 text-sm text-slate-600">{busy ? 'Step 1 of 2: creating a backup on Umbrel. The NAS will collect it automatically when ready.' : !enabled ? 'Automatic backups need to be enabled on the server.' : 'Backups run automatically. Use Back up now whenever you need an extra copy.'}</p>
    </div>
    <div className="grid gap-5 p-5 sm:grid-cols-3 sm:p-6">
      <div data-testid="backup-status-last-delivery">
        <h3 className="text-sm font-semibold text-slate-500">Last successful NAS copy</h3>
        <p className="mt-2 text-lg font-semibold text-slate-900">{delivered ? when(delivered.received_at) : 'Waiting for first copy'}</p>
        <p className="mt-1 text-sm text-slate-600">{delivered ? `${delivered.dest_name || 'Office NAS'} | ${bytes(delivered.bytes_written)}` : 'A successful delivery will appear here.'}</p>
      </div>
      <div data-testid="backup-status-last-snapshot">
        <h3 className="text-sm font-semibold text-slate-500">Latest backup on Umbrel</h3>
        <p className="mt-2 text-lg font-semibold text-slate-900">{snap ? when(snap.created_at) : 'No backup created yet'}</p>
        <p className="mt-1 text-sm text-slate-600">{snap ? bytes(snap.size) : 'Use Back up now to create your first copy.'}</p>
        <p className="mt-1 text-xs text-slate-500">Creating this file does not confirm delivery to the NAS.</p>
      </div>
      <div data-testid="backup-status-next-snapshot">
        <h3 className="text-sm font-semibold text-slate-500">Next automatic backup</h3>
        <p className="mt-2 text-lg font-semibold text-slate-900">{!enabled ? 'Switched off' : data.next_snapshot_at ? when(data.next_snapshot_at) : 'Not scheduled'}</p>
        <button className="mt-2 text-sm font-semibold text-blue-700 underline" onClick={() => openAccordionSection('schedule')}>View schedule</button>
      </div>
    </div>
    <div data-testid="backup-status-offsite" className="border-t border-slate-100 px-5 py-4 text-sm text-slate-600 sm:px-6">
      <strong>Optional Dropbox backup: </strong>{!data.offsite?.enabled ? 'Not enabled for backups. This is separate from browsing files in Dropbox.' : data.offsite.last_ok_at ? `Last saved ${when(data.offsite.last_ok_at)}.` : 'Waiting for the first successful copy.'}
      {data.offsite?.enabled && data.offsite.last_error && (!data.offsite.last_ok_at || data.offsite.last_error_at > data.offsite.last_ok_at) && <p className="mt-1 text-red-700">The latest Dropbox backup attempt failed. Open technical details below.</p>}
    </div>
    <details className="border-t border-slate-100 px-5 py-3 text-sm sm:px-6">
      <summary className="cursor-pointer font-semibold text-slate-600">Technical status details</summary>
      <p className="mt-3 break-words text-slate-600">{data.health_reason || 'No additional status details.'}</p>
      {data.offsite?.enabled && data.offsite.last_error && <div className="mt-2">
        <p className="break-words text-red-700">Dropbox: {data.offsite.last_error}</p>
        <button onClick={retryDropbox} disabled={retrying || busy} className="mt-2 font-semibold text-blue-700 underline disabled:opacity-50">{retrying ? 'Retrying...' : 'Retry Dropbox backup'}</button>
        {retryMessage && <p role="status" className="mt-2">{retryMessage}</p>}
      </div>}
    </details>
  </section>;
}
