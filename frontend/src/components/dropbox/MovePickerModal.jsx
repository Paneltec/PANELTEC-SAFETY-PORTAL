// v58.13.132n4a — Modal for picking a destination folder for a
// Move operation. Renders a mini in-modal folder browser rooted
// at the team folder. Navigation is via the same
// `/api/dropbox/browse` list endpoint the main page uses, so
// path shapes stay namespace-relative and no duplicate serialiser
// logic is needed.
//
// UX rules:
//   · Only folders shown. Files aren't valid Move destinations.
//   · Header shows the current breadcrumb + an "Up" button.
//   · Bottom bar: Cancel + Move here (Move here uses the CURRENT
//     folder path — you don't click on a folder row to select it,
//     you navigate INTO the folder and click "Move here", matching
//     the desktop Dropbox web UI convention).
//   · Prevents dropping into the source itself (or a descendant),
//     which Dropbox would 409-reject anyway.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import {
  Folder24Regular, ArrowLeft20Regular, ChevronRight16Regular, Dismiss20Regular,
} from '@fluentui/react-icons';

const DBX_BLUE = '#0061FF';
const ROOT_PATH = '';
const TEAM_ROOT_LABEL = 'Paneltec-General Administration';

export default function MovePickerModal({ entry, onClose, onConfirm }) {
  // `entry` is the row being moved. `entry.path` is namespace-relative.
  const [path, setPath] = useState(() => {
    // Start the picker one level up from the source so admins land
    // on a useful default (the source's current parent).
    const segs = (entry.path || '').split('/').filter(Boolean);
    segs.pop();
    return segs.length === 0 ? ROOT_PATH : '/' + segs.join('/');
  });
  const [state, setState] = useState({ loading: true, error: null, folders: [] });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, folders: [] });
    (async () => {
      try {
        const { data } = await api.get('/dropbox/browse', { params: { path } });
        if (cancelled) return;
        const folders = (data.entries || []).filter((e) => e.type === 'folder');
        setState({ loading: false, error: null, folders });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: apiError(err), folders: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  const crumbs = useMemo(() => {
    const segs = (path || '').split('/').filter(Boolean);
    const parts = [{ label: TEAM_ROOT_LABEL, path: ROOT_PATH }];
    let cur = '';
    for (const s of segs) { cur = cur + '/' + s; parts.push({ label: s, path: cur }); }
    return parts;
  }, [path]);

  const parentPath = useMemo(() => {
    if (!path || path === ROOT_PATH) return null;
    const segs = path.split('/').filter(Boolean);
    segs.pop();
    return segs.length === 0 ? ROOT_PATH : '/' + segs.join('/');
  }, [path]);

  // Prevent moving a folder into itself or a descendant.
  const isSameOrDescendant = (p) => {
    if (!entry || entry.type !== 'folder') return false;
    if (p === entry.path) return true;
    return p.startsWith(entry.path + '/');
  };

  const currentIsSource = isSameOrDescendant(path);
  const currentIsCurrentParent = (() => {
    // Same-parent move is a no-op — the modal wouldn't be useful.
    const segs = (entry.path || '').split('/').filter(Boolean);
    segs.pop();
    const p = segs.length === 0 ? ROOT_PATH : '/' + segs.join('/');
    return p === path;
  })();

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data } = await api.post('/dropbox/browse/move', {
        from_path: entry.path,
        to_folder: path,
      });
      toast.success(`Moved: ${entry.name}`);
      onConfirm(data);
    } catch (err) {
      toast.error(`Move failed: ${apiError(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="dropbox-move-picker"
    >
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
           style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="text-sm font-semibold text-slate-800 truncate">
            Move &ldquo;{entry.name}&rdquo; to…
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            data-testid="dropbox-move-close" aria-label="Close">
            <Dismiss20Regular style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <div className="px-5 py-2 border-b border-slate-100 flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => parentPath !== null && setPath(parentPath)}
            disabled={parentPath === null}
            className="p-1 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            title="Up one folder"
            data-testid="dropbox-move-up"
          >
            <ArrowLeft20Regular style={{ width: 14, height: 14 }} />
          </button>
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-1">
              {i > 0 && <ChevronRight16Regular style={{ width: 12, height: 12 }} className="text-slate-400" />}
              <button
                type="button"
                onClick={() => setPath(c.path)}
                className={`px-1.5 py-0.5 rounded hover:bg-slate-100 ${i === crumbs.length - 1 ? 'text-slate-900 font-semibold' : 'text-slate-600'}`}
              >{c.label}</button>
            </span>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-2 bg-slate-50" data-testid="dropbox-move-folder-list">
          {state.loading && (
            <div className="text-xs text-slate-500 px-3 py-3">Loading…</div>
          )}
          {state.error && (
            <div className="text-xs text-rose-600 px-3 py-3">{state.error}</div>
          )}
          {!state.loading && !state.error && state.folders.length === 0 && (
            <div className="text-xs text-slate-500 px-3 py-3">No sub-folders here.</div>
          )}
          {state.folders.map((f) => {
            const blocked = isSameOrDescendant(f.path);
            return (
              <button
                type="button"
                key={f.path}
                onClick={() => !blocked && setPath(f.path)}
                disabled={blocked}
                data-testid={`dropbox-move-into-${f.name}`}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${blocked ? 'text-slate-400 cursor-not-allowed line-through' : 'text-slate-800 hover:bg-white'}`}
              >
                <Folder24Regular style={{ width: 18, height: 18, color: blocked ? '#94a3b8' : DBX_BLUE }} />
                <span className="truncate">{f.name}</span>
                {blocked && <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-400">source</span>}
              </button>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500 truncate flex-1 min-w-0">
            Destination: <span className="font-mono">{path || TEAM_ROOT_LABEL}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2"
              data-testid="dropbox-move-cancel">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={submitting || currentIsSource || currentIsCurrentParent}
              className="rounded-lg text-white text-xs font-semibold px-3 py-2 disabled:opacity-40 hover:brightness-110"
              style={{ backgroundColor: DBX_BLUE }}
              data-testid="dropbox-move-confirm"
              title={
                currentIsSource
                  ? "Can't move into the source folder or a descendant"
                  : currentIsCurrentParent
                    ? 'Already here'
                    : 'Move here'
              }
            >
              Move here
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
