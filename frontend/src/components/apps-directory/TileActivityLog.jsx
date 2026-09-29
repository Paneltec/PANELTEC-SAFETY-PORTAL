// Apps Directory — PIN-gated activity log + "Lock now".
// Backend: GET /api/org/url-tiles/activity, POST /api/org/url-tiles/lock-now
// (tile_unlock.py). Admin only.
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { X, Lock } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { TilePinModal } from './TileCard';

const ACTION_LABEL = {
  pin_ok: 'Unlocked with PIN',
  pin_wrong: 'Wrong PIN entered',
  locked: 'Locked again',
  login_revealed: 'Saved password used',
  login_copied: 'Saved login field copied',
  login_saved: 'Saved login changed',
  login_cleared: 'Saved login removed',
};

export function TileActivityLog({ pinTileId, onClose }) {
  const [rows, setRows] = useState(null);
  const [pinOpen, setPinOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/org/url-tiles/activity');
      setRows(data.items || []);
    } catch (e) {
      if (e?.response?.status === 423) setPinOpen(true);
      else toast.error(apiError(e) || 'Could not load the activity log');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const lockNow = async () => {
    try { await api.post('/org/url-tiles/lock-now'); toast.success('Locked. Saved logins need your PIN again.'); onClose(); }
    catch (e) { toast.error(apiError(e)); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="tile-activity-log">
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-white rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div>
            <div className="font-bold text-slate-900">Apps Directory activity</div>
            <div className="text-xs text-slate-500">PIN attempts and every use of a saved login, newest first.</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={lockNow} data-testid="tile-activity-lock-now"
              className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded bg-slate-900 text-white">
              <Lock size={12} /> Lock now
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-slate-100"><X size={18} /></button>
          </div>
        </div>
        <div className="overflow-auto p-2">
          {rows === null && !pinOpen && <div className="p-6 text-sm text-slate-500">Loading…</div>}
          {rows && rows.length === 0 && <div className="p-6 text-sm text-slate-500">Nothing recorded yet.</div>}
          {rows && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-slate-500 text-left">
                <tr><th className="p-2">When</th><th className="p-2">Who</th><th className="p-2">App</th><th className="p-2">What</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-2 whitespace-nowrap text-slate-600">{new Date(r.at).toLocaleString('en-AU')}</td>
                    <td className="p-2">{r.user_name || '—'}</td>
                    <td className="p-2">{r.tile_label || '—'}</td>
                    <td className={`p-2 ${r.action === 'pin_wrong' ? 'text-rose-700 font-semibold' : ''}`}>
                      {ACTION_LABEL[r.action] || r.action}{r.detail && r.action === 'login_copied' ? ` (${r.detail})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {pinOpen && (
        <TilePinModal tile={{ id: pinTileId || '', label: 'activity log' }}
          onClose={() => { setPinOpen(false); onClose(); }}
          onUnlocked={() => { setPinOpen(false); load(); }} />
      )}
    </div>,
    document.body,
  );
}
