// Paneltec Civil · v155b — Backup admin traffic-light hero card.
// Reads GET /api/backup/summary. Polls 60 s while tab visible.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, ArrowDown, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { TOKEN_KEY } from '@/lib/api';

const SUMMARY_URL = (process.env.REACT_APP_BACKEND_URL || '') + '/api/backup/summary';
const SNAPSHOT_URL = (process.env.REACT_APP_BACKEND_URL || '') + '/api/backup/snapshots';

const authHdr = () => {
  const t = localStorage.getItem(TOKEN_KEY) || '';
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const fmtBytes = (n) => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
};

const fmtAge = (iso) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
};

const fmtFuture = (iso) => {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'imminent';
  if (ms < 3600_000) return `in ${Math.floor(ms / 60_000)} min`;
  if (ms < 86400_000) return `in ${(ms / 3600_000).toFixed(1)} h`;
  return `in ${(ms / 86400_000).toFixed(1)} d`;
};

const PALETTES = {
  healthy:   { bg: '#065f46', bgSoft: '#ecfdf5', border: '#10b981', fg: '#064e3b', chipBg: '#10b981', label: 'Healthy' },
  attention: { bg: '#92400e', bgSoft: '#fff7ed', border: '#f59e0b', fg: '#7c2d12', chipBg: '#f59e0b', label: 'Attention' },
  down:      { bg: '#7f1d1d', bgSoft: '#fef2f2', border: '#ef4444', fg: '#7f1d1d', chipBg: '#ef4444', label: 'Down' },
  setup:     { bg: '#334155', bgSoft: '#f1f5f9', border: '#64748b', fg: '#0f172a', chipBg: '#64748b', label: 'Setup incomplete' },
};

export default function BackupStatusHero() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(SUMMARY_URL, { headers: authHdr(), cache: 'no-store' });
      if (r.ok) setData(await r.json());
    } catch (_e) { /* ignore transient */ }
  }, []);

  useEffect(() => {
    load();
    let iv = null;
    const arm = () => { if (!iv) iv = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 60_000); };
    const onVis = () => {
      if (document.visibilityState === 'visible') { load(); arm(); }
      else if (iv) { clearInterval(iv); iv = null; }
    };
    document.addEventListener('visibilitychange', onVis);
    arm();
    return () => { document.removeEventListener('visibilitychange', onVis); if (iv) clearInterval(iv); };
  }, [load]);

  const snapshotNow = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const r = await fetch(SNAPSHOT_URL, { method: 'POST', headers: authHdr() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success('Snapshot created');
      await load();
    } catch (e) {
      toast.error(`Snapshot failed: ${e.message}`);
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  const scrollToHistory = () => {
    const el = document.querySelector('[data-testid="backup-snapshot-history-anchor"]')
      || Array.from(document.querySelectorAll('*')).find(n =>
        (n.textContent || '').trim() === 'Snapshot history');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!data) {
    return (
      <div data-testid="backup-status-hero-loading"
           style={{ padding: 16, background: '#f1f5f9', borderRadius: 10,
                    marginBottom: 16, color: '#64748b', fontSize: 13 }}>
        Loading backup status…
      </div>
    );
  }

  const p = PALETTES[data.health] || PALETTES.setup;
  const snap = data.last_snapshot;
  const del = data.last_delivery;

  return (
    <div data-testid="backup-status-hero"
         data-health={data.health}
         style={{
           background: p.bgSoft, border: `1px solid ${p.border}55`,
           borderLeft: `6px solid ${p.border}`, borderRadius: 10,
           padding: '18px 22px', marginBottom: 20,
           boxShadow: '0 10px 24px -12px rgba(15,23,42,0.15)',
         }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 260 }}>
          <span data-testid="backup-status-pill"
                style={{
                  background: p.chipBg, color: '#fff',
                  padding: '6px 14px', borderRadius: 999,
                  fontSize: 11, fontWeight: 900, letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
            {data.health === 'healthy'
              ? <CheckCircle2 className="w-3.5 h-3.5"/>
              : <AlertCircle className="w-3.5 h-3.5"/>}
            {p.label}
          </span>
          <div style={{ fontSize: 15, fontWeight: 800, color: p.fg }}>
            Backup status
          </div>
          <button type="button"
            data-testid="backup-status-why"
            aria-label="Why is the status this?"
            onClick={() => setTipOpen(v => !v)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer',
                     color: p.fg, padding: 2, opacity: 0.7 }}>
            <HelpCircle className="w-4 h-4"/>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button"
            data-testid="backup-status-snapshot-now"
            onClick={snapshotNow}
            disabled={busy}
            style={{
              background: p.bg, color: '#fff', border: 'none',
              padding: '9px 16px', borderRadius: 6,
              fontSize: 12, fontWeight: 800, letterSpacing: '0.06em',
              textTransform: 'uppercase', cursor: busy ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              opacity: busy ? 0.7 : 1,
            }}>
            <RefreshCw className="w-3.5 h-3.5" style={{
              animation: busy ? 'ptSpin 1s linear infinite' : 'none' }}/>
            {busy ? 'Snapshotting…' : 'Backup now'}
          </button>
          <button type="button"
            data-testid="backup-status-show-history"
            onClick={scrollToHistory}
            style={{
              background: '#fff', color: p.fg, border: `1px solid ${p.border}`,
              padding: '9px 16px', borderRadius: 6,
              fontSize: 12, fontWeight: 800, letterSpacing: '0.06em',
              textTransform: 'uppercase', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            <ArrowDown className="w-3.5 h-3.5"/> Show history
          </button>
        </div>
      </div>

      {tipOpen && (
        <div data-testid="backup-status-tooltip"
             style={{ marginTop: 10, padding: '8px 12px',
                      background: 'rgba(15,23,42,0.06)', borderRadius: 6,
                      fontSize: 12, color: p.fg }}>
          {data.health_reason}
        </div>
      )}

      <div style={{
        marginTop: 14, display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '6px 20px', fontSize: 13, color: p.fg, lineHeight: 1.5,
      }}>
        <div data-testid="backup-status-last-snapshot">
          <strong>Last snapshot:</strong>{' '}
          {snap ? (
            <>
              {fmtAge(snap.created_at)}
              {snap.size ? <> · {fmtBytes(snap.size)}</> : null}
              {snap.total_documents ? <> · {snap.total_documents.toLocaleString()} docs</> : null}
            </>
          ) : 'never'}
        </div>
        <div data-testid="backup-status-last-delivery">
          <strong>Last delivery:</strong>{' '}
          {del ? (
            <>
              {fmtAge(del.received_at)}
              {del.dest_name ? <> → {del.dest_name}</> : null}
              {del.agent_name ? <> via {del.agent_name}</> : null}
            </>
          ) : 'no deliveries yet'}
        </div>
        <div data-testid="backup-status-next-snapshot">
          <strong>Next snapshot:</strong>{' '}
          {data.next_snapshot_at
            ? <>{fmtFuture(data.next_snapshot_at)} ({new Date(data.next_snapshot_at).toLocaleString()})</>
            : 'scheduler idle'}
        </div>
      </div>
      <style>{`@keyframes ptSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
