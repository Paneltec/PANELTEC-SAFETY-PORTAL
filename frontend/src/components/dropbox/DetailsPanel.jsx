// v58.13.132n4a — Right-side details panel.
//
// Slide-in panel that opens on single-click of a FILE row (folder
// single-click still navigates into the folder — matching the
// existing convention). Shows file metadata + quick actions.
//
// Layout mirrors Dropbox's own file-info sidebar: thumbnail-icon,
// filename, size, modified, path, plus quick action buttons.
//
// `.132n4b` — Sharing is now live. The Share row is enabled and
// the Sharing meta row shows the direct-link status pulled from
// `/dropbox/browse/share`.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import {
  Dismiss20Regular, Eye16Regular, ArrowDownload16Regular,
  Edit16Regular, ClipboardPaste16Regular, ArrowMove20Regular,
  Share16Regular, History16Regular, Delete16Regular,
  Document24Regular, DocumentPdf24Regular, Image24Regular,
  Video24Regular, DocumentTable24Regular, Folder24Regular,
} from '@fluentui/react-icons';

const DBX_BLUE = '#0061FF';

const EXT = (n) => (n || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';

function iconFor(entry) {
  if (entry.type === 'folder') return Folder24Regular;
  const ext = EXT(entry.name);
  if (ext === '.pdf') return DocumentPdf24Regular;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return Image24Regular;
  if (['.mp4', '.webm', '.mov'].includes(ext)) return Video24Regular;
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return DocumentTable24Regular;
  return Document24Regular;
}

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

export default function DetailsPanel({
  entry, onClose, onPreview, onDownload, onRename, onCopyPath,
  onMove, onShare, onVersions, onDelete,
}) {
  // `versionCount` is loaded lazily on mount for FILE entries only.
  const [versionCount, setVersionCount] = useState({ loading: true, value: null });
  // `.132n4b` — sharing summary (link count + member count) fetched
  // lazily. Null while loading, `{link_count, member_count}` when
  // ready, undefined on error (renders as "—").
  const [shareSummary, setShareSummary] = useState(null);

  useEffect(() => {
    if (!entry || entry.type !== 'file') {
      setVersionCount({ loading: false, value: null });
      return undefined;
    }
    let cancelled = false;
    setVersionCount({ loading: true, value: null });
    (async () => {
      try {
        const { data } = await api.get('/dropbox/browse/revisions', {
          params: { path: entry.path, limit: 10 },
        });
        if (!cancelled) {
          const n = (data.entries || []).length;
          setVersionCount({ loading: false, value: n });
        }
      } catch {
        if (!cancelled) setVersionCount({ loading: false, value: null });
      }
    })();
    return () => { cancelled = true; };
  }, [entry]);

  // `.132n4b` — fetch sharing summary in parallel with versions.
  // Failure is silent (renders "—"). Doesn't block the panel from
  // showing quick-action buttons.
  useEffect(() => {
    if (!entry) return undefined;
    let cancelled = false;
    setShareSummary(null);
    (async () => {
      try {
        const { data } = await api.get('/dropbox/browse/share', {
          params: { path: entry.path },
        });
        if (!cancelled) {
          const directCount = (data.members || []).filter((m) => !m.is_inherited).length;
          setShareSummary({
            link_count:    (data.links || []).length,
            member_count:  directCount + (data.invitees || []).length,
          });
        }
      } catch {
        if (!cancelled) setShareSummary(undefined);
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

  const doCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(entry.path);
      toast.success('Path copied.');
    } catch (err) {
      toast.error(`Copy failed: ${apiError(err)}`);
    }
  };

  if (!entry) return null;
  const isFile = entry.type === 'file';
  const Icon = iconFor(entry);

  return (
    <div
      className="fixed inset-0 z-30 flex items-stretch justify-end bg-slate-900/30 backdrop-blur-[1px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="dropbox-details-panel"
    >
      <div className="w-full max-w-sm bg-white shadow-2xl flex flex-col" style={{ height: '100vh' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="text-sm font-semibold text-slate-800">Details</div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            data-testid="dropbox-details-close" aria-label="Close">
            <Dismiss20Regular style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* Icon + name */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            <Icon style={{ width: 32, height: 32, color: entry.type === 'folder' ? DBX_BLUE : '#64748b' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 break-words"
                 data-testid="dropbox-details-name">
              {entry.name}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 font-mono truncate" title={entry.path}>
              {entry.path}
            </div>
          </div>
        </div>

        {/* Metadata table */}
        <div className="px-5 py-3 border-b border-slate-100 text-xs text-slate-700">
          <MetaRow label="Kind">{isFile ? EXT(entry.name).replace('.', '').toUpperCase() || 'File' : 'Folder'}</MetaRow>
          <MetaRow label="Size">{isFile ? fmtBytes(entry.size) : '—'}</MetaRow>
          <MetaRow label="Modified">{fmtDate(entry.modified)}</MetaRow>
          {isFile && (
            <MetaRow label="Versions">
              {versionCount.loading
                ? <span className="text-slate-400">Loading…</span>
                : versionCount.value == null
                  ? '—'
                  : (versionCount.value === 1
                      ? '1 version'
                      : `${versionCount.value} versions${versionCount.value === 10 ? '+' : ''}`)}
            </MetaRow>
          )}
          {/* `.132n4b` — Share status pulled from
              /api/dropbox/browse/share. Shows link count + direct
              member count once loaded. */}
          <MetaRow label="Sharing">
            {shareSummary === null
              ? <span className="text-slate-400">Loading…</span>
              : shareSummary === undefined
                ? '—'
                : (shareSummary.link_count === 0 && shareSummary.member_count === 0)
                  ? <span className="text-slate-500">Not shared</span>
                  : (
                    <span>
                      {shareSummary.link_count > 0 && (
                        <>{shareSummary.link_count} link{shareSummary.link_count === 1 ? '' : 's'}</>
                      )}
                      {shareSummary.link_count > 0 && shareSummary.member_count > 0 && ' · '}
                      {shareSummary.member_count > 0 && (
                        <>{shareSummary.member_count} {shareSummary.member_count === 1 ? 'person' : 'people'}</>
                      )}
                    </span>
                  )}
          </MetaRow>
        </div>

        {/* Quick actions */}
        <div className="px-3 py-2 flex flex-col gap-1 text-sm">
          {isFile && (
            <ActionRow
              testid="details-preview"
              icon={<Eye16Regular />}
              label="Preview"
              onClick={() => onPreview(entry)}
            />
          )}
          {isFile && (
            <ActionRow
              testid="details-download"
              icon={<ArrowDownload16Regular />}
              label="Download"
              onClick={() => onDownload(entry)}
            />
          )}
          <ActionRow
            testid="details-rename"
            icon={<Edit16Regular />}
            label="Rename"
            onClick={() => onRename(entry)}
          />
          <ActionRow
            testid="details-copy-path"
            icon={<ClipboardPaste16Regular />}
            label="Copy path"
            onClick={doCopyPath}
          />
          <ActionRow
            testid="details-move"
            icon={<ArrowMove20Regular />}
            label="Move to…"
            onClick={() => onMove(entry)}
          />
          <ActionRow
            testid="details-share"
            icon={<Share16Regular />}
            label="Share"
            onClick={() => onShare(entry)}
          />
          {isFile && (
            <ActionRow
              testid="details-versions"
              icon={<History16Regular />}
              label="Version history"
              onClick={() => onVersions(entry)}
            />
          )}
          <div className="border-t border-slate-100 my-1" />
          <ActionRow
            testid="details-delete"
            icon={<Delete16Regular />}
            label="Delete"
            danger
            onClick={() => onDelete(entry)}
          />
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, children }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{label}</div>
      <div className="text-xs text-slate-700 text-right truncate max-w-[65%]">{children}</div>
    </div>
  );
}

function ActionRow({ testid, icon, label, onClick, disabled, danger, title }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      data-testid={`dropbox-${testid}`}
      className={[
        'flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors',
        disabled
          ? 'text-slate-400 cursor-not-allowed'
          : danger
            ? 'text-rose-600 hover:bg-rose-50'
            : 'text-slate-700 hover:bg-slate-50',
      ].join(' ')}
    >
      <span className={danger ? 'text-rose-500' : 'text-slate-500'}
            style={{ width: 16, height: 16 }}>{icon}</span>
      <span>{label}</span>
      {disabled && (
        <span className="ml-auto text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
          .n4b
        </span>
      )}
    </button>
  );
}
