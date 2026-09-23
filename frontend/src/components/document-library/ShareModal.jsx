// v58.13.132mb — Document Library file-share modal.
//
// Wraps Phase 1's /document-library/files/{id}/shares CRUD.
// Two share targets exposed: individual users (from GET /api/users)
// and the "All Workers" preset. Group targets are deferred (Phase 1
// backend accepts user|all_workers only). Permissions: view | download.
//
// Kept intentionally small (< 250 LOC) — matches the visual language
// of the existing DocumentLibrary confirm modals (rose delete, brand
// blue primary, slate cancel).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, X, Users, User as UserIcon, Check } from 'lucide-react';
import api, { apiError } from '../../lib/api';

const PERMISSIONS = [
  { key: 'download', label: 'Download', hint: 'View + download file' },
  { key: 'view', label: 'View only', hint: 'Preview only, no download' },
];

export default function ShareModal({ file, onClose }) {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState([]);
  const [userQ, setUserQ] = useState('');
  const [permission, setPermission] = useState('download');
  const [selectedUserId, setSelectedUserId] = useState('');

  const loadShares = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/document-library/files/${file.id}/shares`);
      setShares(data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  }, [file.id]);

  useEffect(() => { loadShares(); }, [loadShares]);

  useEffect(() => {
    // hide_test=true so seeded demo accounts don't pollute the picker.
    api.get('/users', { params: { hide_test: true } })
      .then((r) => setUsers(Array.isArray(r.data) ? r.data : (r.data?.users || [])))
      .catch(() => setUsers([]));
  }, []);

  const filteredUsers = useMemo(() => {
    const q = userQ.trim().toLowerCase();
    if (!q) return users.slice(0, 20);
    return users.filter((u) => {
      const hay = `${u.name || ''} ${u.email || ''}`.toLowerCase();
      return hay.includes(q);
    }).slice(0, 20);
  }, [users, userQ]);

  const createShare = async (target_type, target_id) => {
    setBusy(true);
    try {
      await api.post(`/document-library/files/${file.id}/shares`, {
        target_type, target_id: target_id || null, permission,
      });
      toast.success('Share created');
      setSelectedUserId('');
      setUserQ('');
      await loadShares();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const revoke = async (shareId) => {
    setBusy(true);
    try {
      await api.delete(`/document-library/shares/${shareId}`);
      toast.success('Share revoked');
      await loadShares();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const hasAllWorkers = shares.some(
    (s) => s.target_type === 'all_workers' && !s.revoked_at,
  );

  return (
    <div
      className="fixed inset-0 z-[95] bg-slate-950/60 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="share-modal"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">
              Share this file
            </div>
            <h3
              className="font-display font-bold text-slate-900 text-lg mt-0.5 truncate"
              title={file.filename}
              data-testid="share-modal-filename"
            >
              {file.filename}
            </h3>
          </div>
          <button
            onClick={onClose}
            data-testid="share-modal-close"
            className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Permission */}
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">Permission</div>
            <div className="flex gap-2" data-testid="share-permission-picker">
              {PERMISSIONS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPermission(p.key)}
                  data-testid={`share-permission-${p.key}`}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium flex-1 text-left ${
                    permission === p.key
                      ? 'border-brand-blue bg-brand-blue-soft/40 text-brand-blue'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {permission === p.key && <Check size={14} />}
                    {p.label}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{p.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* All-workers preset */}
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">Presets</div>
            <button
              onClick={() => createShare('all_workers')}
              disabled={busy || hasAllWorkers}
              data-testid="share-all-workers-btn"
              className={`w-full px-3 py-2.5 rounded-lg border text-sm font-medium flex items-center gap-2 ${
                hasAllWorkers
                  ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                  : 'border-brand-blue text-brand-blue bg-white hover:bg-brand-blue-soft/40'
              }`}
            >
              <Users size={16} />
              {hasAllWorkers ? 'All Workers already have access' : 'Share with All Workers'}
            </button>
          </div>

          {/* Individual users */}
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">Or share with an individual</div>
            <input
              value={userQ}
              onChange={(e) => setUserQ(e.target.value)}
              placeholder="Search by name or email…"
              data-testid="share-user-search"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
            />
            {filteredUsers.length > 0 && (
              <div
                className="mt-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100"
                data-testid="share-user-results"
              >
                {filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { setSelectedUserId(u.id); createShare('user', u.id); }}
                    disabled={busy}
                    data-testid={`share-user-option-${u.id}`}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-sm"
                  >
                    <UserIcon size={14} className="text-slate-400" />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 truncate">{u.name || u.email}</div>
                      {u.email && u.name && (
                        <div className="text-xs text-slate-500 truncate">{u.email}</div>
                      )}
                    </div>
                    {selectedUserId === u.id && busy && (
                      <Loader2 size={14} className="ml-auto animate-spin text-brand-blue" />
                    )}
                  </button>
                ))}
              </div>
            )}
            {userQ && filteredUsers.length === 0 && (
              <div className="text-xs text-slate-500 mt-2">No users match "{userQ}".</div>
            )}
          </div>

          {/* Current shares */}
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">
              Current shares · {loading ? '…' : shares.length}
            </div>
            {loading ? (
              <div className="text-xs text-slate-500 py-2 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : shares.length === 0 ? (
              <div
                className="text-xs text-slate-500 py-3 px-3 bg-slate-50 rounded-lg border border-slate-200"
                data-testid="share-empty-state"
              >
                No one has access to this file yet — pick a target above.
              </div>
            ) : (
              <ul
                className="border border-slate-200 rounded-lg divide-y divide-slate-100"
                data-testid="share-current-list"
              >
                {shares.map((s) => (
                  <li
                    key={s.id}
                    data-testid={`share-row-${s.id}`}
                    className="px-3 py-2 flex items-center gap-2 text-sm"
                  >
                    {s.target_type === 'all_workers' ? (
                      <Users size={14} className="text-slate-400" />
                    ) : (
                      <UserIcon size={14} className="text-slate-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 truncate">
                        {s.target_type === 'all_workers'
                          ? 'All Workers'
                          : (s.target_name || s.target_id || 'Unknown user')}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {s.permission === 'download' ? 'Download' : 'View only'}
                        {' · granted by '}{s.granted_by_name || 'admin'}
                      </div>
                    </div>
                    <button
                      onClick={() => revoke(s.id)}
                      disabled={busy}
                      data-testid={`share-revoke-${s.id}`}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      title="Revoke this share"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            data-testid="share-modal-done"
            className="px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold hover:bg-brand-blue-dark"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
