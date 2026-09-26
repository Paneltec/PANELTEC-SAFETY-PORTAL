// v58.13.132n4a — Version history drawer.
//
// Right slide-in drawer that lists up to 10 prior revisions of a
// file from `/api/dropbox/browse/revisions`. Each row shows the
// server-modified date + size + a "Restore" button. Restore fires
// `/api/dropbox/browse/restore` and closes the drawer on success.
//
// Only files have revisions. Folder rows never open this drawer
// (the RowActionMenu hides "Version history" for folders).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import { Dismiss20Regular, History16Regular, ArrowClockwise16Regular } from '@fluentui/react-icons';

const DBX_BLUE = '#0061FF';

function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

export default function VersionHistoryDrawer({ entry, onClose, onRestored }) {
  const [state, setState] = useState({ loading: true, error: null, revisions: [] });
  const [restoring, setRestoring] = useState(null); // rev being restored

  useEffect(() => {
    if (!entry) return undefined;
    let cancelled = false;
    setState({ loading: true, error: null, revisions: [] });
    (async () => {
      try {
        const { data } = await api.get('/dropbox/browse/revisions', {
          params: { path: entry.path, limit: 10 },
        });
        if (!cancelled) setState({
          loading: false, error: null,
          revisions: data.entries || [],
        });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: apiError(err), revisions: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [entry]);

  // Escape to close.
  useEffect(() => {
    if (!entry) return undefined;
    const onKey = (ev) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entry, onClose]);

  const doRestore = async (rev) => {
    if (restoring) return;
    setRestoring(rev);
    try {
      await api.post('/dropbox/browse/restore', { path: entry.path, rev });
      toast.success(`Restored ${entry.name} to earlier version.`);
      if (onRestored) onRestored();
      onClose();
    } catch (err) {
      toast.error(`Restore failed: ${apiError(err)}`);
    } finally {
      setRestoring(null);
    }
  };

  if (!entry) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-stretch justify-end bg-slate-900/40 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="dropbox-versions-drawer"
    >
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col animate-in slide-in-from-right"
           style={{ height: '100vh' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            <History16Regular style={{ width: 16, height: 16, color: DBX_BLUE }} />
            <div className="text-sm font-semibold text-slate-800 truncate">Version history</div>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            data-testid="dropbox-versions-close" aria-label="Close">
            <Dismiss20Regular style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <div className="px-5 py-2 text-xs text-slate-500 truncate font-mono border-b border-slate-100">
          {entry.path}
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3" data-testid="dropbox-versions-list">
          {state.loading && (
            <div className="text-xs text-slate-500 px-2 py-2">Loading…</div>
          )}
          {state.error && (
            <div className="text-xs text-rose-600 px-2 py-2">{state.error}</div>
          )}
          {!state.loading && !state.error && state.revisions.length === 0 && (
            <div className="text-xs text-slate-500 px-2 py-2">No prior revisions.</div>
          )}
          {state.revisions.map((r, i) => (
            <div key={r.rev}
              data-testid={`dropbox-versions-row-${i}`}
              className="rounded-lg border border-slate-200 mb-2 p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-800">
                  {i === 0 ? 'Current version' : `Version ${state.revisions.length - i}`}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {fmtDate(r.server_modified)} · {fmtBytes(r.size)}
                </div>
                <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5"
                     title={r.rev}>rev: {r.rev}</div>
              </div>
              {i !== 0 && (
                <button
                  type="button"
                  onClick={() => doRestore(r.rev)}
                  disabled={restoring !== null}
                  data-testid={`dropbox-versions-restore-${i}`}
                  className="inline-flex items-center gap-1 rounded-lg text-white text-[11px] font-semibold px-2.5 py-1.5 disabled:opacity-40 hover:brightness-110"
                  style={{ backgroundColor: DBX_BLUE }}
                >
                  <ArrowClockwise16Regular style={{ width: 12, height: 12 }} />
                  {restoring === r.rev ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
