// v58.13.132n4a — Row-level three-dot action menu.
//
// Renders as a `⋯` button that opens a compact popover with
// per-entry actions. On desktop the button is hidden until row
// hover; on mobile it's always visible (parent CSS handles that
// via group-hover / md: breakpoints).
//
// Item roster (see `DropboxBrowser.jsx` for handlers):
//   · Open (folder) / Preview (file)
//   · Download          — file only
//   · Rename            — anything
//   · Copy path         — anything (client-side clipboard)
//   · Move to…          — anything
//   · Share             — DISABLED in `.132n4a`. Requires
//                          `sharing.write` scope on the Dropbox
//                          App Console + admin re-authorisation
//                          via Settings → Integrations. The
//                          `.132n4b` ship enables it.
//   · Version history   — file only
//   · Delete            — anything (opens the existing confirm)
//
// The menu closes on: item click, backdrop click, or Escape.
import { useEffect, useRef, useState } from 'react';
import {
  MoreHorizontal20Regular,
  ArrowDownload16Regular,
  Edit16Regular,
  ClipboardPaste16Regular,
  ArrowMove20Regular,
  Share16Regular,
  History16Regular,
  Delete16Regular,
  Eye16Regular,
  FolderOpen16Regular,
} from '@fluentui/react-icons';

const DBX_BLUE = '#0061FF';

export default function RowActionMenu({
  entry,
  onOpen,
  onDownload,
  onRename,
  onCopyPath,
  onMove,
  onShare,      // eslint-disable-line no-unused-vars — kept for `.132n4b`
  onVersions,
  onDelete,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (ev) => { if (ev.key === 'Escape') setOpen(false); };
    const onClick = (ev) => {
      if (menuRef.current && !menuRef.current.contains(ev.target)
          && btnRef.current && !btnRef.current.contains(ev.target)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const toggle = (ev) => {
    ev.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // Position below-right of the button. Clamp to viewport
      // right edge with a 12 px safety margin so the menu doesn't
      // overflow on narrow screens.
      const menuWidth = 200;
      const left = Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12);
      setPos({ top: rect.bottom + 4, left: Math.max(12, left) });
    }
    setOpen((v) => !v);
  };

  const run = (fn) => (ev) => {
    ev.stopPropagation();
    setOpen(false);
    if (fn) fn(entry);
  };

  const isFile = entry.type === 'file';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title="More actions"
        aria-label="More actions"
        data-testid={`dropbox-row-menu-btn-${entry.name}`}
        className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100"
      >
        <MoreHorizontal20Regular style={{ width: 16, height: 16 }} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          data-testid={`dropbox-row-menu-${entry.name}`}
          className="fixed z-50 w-52 rounded-xl border border-slate-200 bg-white shadow-xl py-1 text-sm"
          style={{ top: pos.top, left: pos.left }}
        >
          <MenuItem
            testid="menu-open"
            icon={isFile ? <Eye16Regular /> : <FolderOpen16Regular />}
            label={isFile ? 'Preview' : 'Open'}
            onClick={run(onOpen)}
          />
          {isFile && (
            <MenuItem
              testid="menu-download"
              icon={<ArrowDownload16Regular />}
              label="Download"
              onClick={run(onDownload)}
            />
          )}
          <MenuItem
            testid="menu-rename"
            icon={<Edit16Regular />}
            label="Rename"
            onClick={run(onRename)}
          />
          <MenuItem
            testid="menu-copy-path"
            icon={<ClipboardPaste16Regular />}
            label="Copy path"
            onClick={run(onCopyPath)}
          />
          <MenuItem
            testid="menu-move"
            icon={<ArrowMove20Regular />}
            label="Move to…"
            onClick={run(onMove)}
          />
          {/* .132n4a — Share is disabled until the App Console
              gets `sharing.write` ticked and the admin re-auths.
              Rendered so the slot exists; `.132n4b` will remove
              the disabled attribute + wire up onShare. */}
          <MenuItem
            testid="menu-share"
            icon={<Share16Regular />}
            label="Share"
            disabled
            title="Sharing requires additional Dropbox permissions. Ask an admin to enable in Settings → Integrations."
          />
          {isFile && (
            <MenuItem
              testid="menu-versions"
              icon={<History16Regular />}
              label="Version history"
              onClick={run(onVersions)}
            />
          )}
          <div className="my-1 border-t border-slate-100" />
          <MenuItem
            testid="menu-delete"
            icon={<Delete16Regular />}
            label="Delete"
            danger
            onClick={run(onDelete)}
          />
        </div>
      )}
    </>
  );
}

function MenuItem({ testid, icon, label, onClick, disabled, danger, title }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      data-testid={`dropbox-${testid}`}
      className={[
        'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
        disabled
          ? 'text-slate-400 cursor-not-allowed'
          : danger
            ? 'text-rose-600 hover:bg-rose-50'
            : 'text-slate-700 hover:bg-slate-50',
      ].join(' ')}
      style={
        !disabled && !danger
          ? { transition: 'background-color 120ms' }
          : undefined
      }
    >
      <span className={danger ? 'text-rose-500' : 'text-slate-500'}
            style={{ width: 16, height: 16 }}>
        {icon}
      </span>
      <span>{label}</span>
      {disabled && (
        <span className="ml-auto text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
          .n4b
        </span>
      )}
    </button>
  );
}

// Export for `DropboxBrowser.jsx` — colour const stays module-local
// there too; not re-exported.
export { DBX_BLUE as _DBX_BLUE_UNUSED };
