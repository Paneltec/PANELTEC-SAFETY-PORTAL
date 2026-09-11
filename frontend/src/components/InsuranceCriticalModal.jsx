/**
 * v58.13.132dp — Insurance critical modal.
 *
 * Displayed once per session when an admin has a public liability OR
 * workers compensation policy within 7 days of expiry (or already
 * expired). Non-blocking (a single "Acknowledge" button dismisses
 * for the session); the session-storage key is scoped to the org
 * so re-login on another org still fires.
 *
 * Non-admin users never see this — insurance policy management is
 * an admin-only surface.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { getUser } from '../lib/auth';

const SESSION_KEY_PREFIX = 'paneltec_insurance_ack_';

export default function InsuranceCriticalModal() {
  const [criticals, setCriticals] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const [orgId, setOrgId] = useState(null);

  useEffect(() => {
    const u = getUser();
    if (!u || (u.role !== 'admin' && u.role_id !== 'admin')) return;
    let cancelled = false;
    api.get('/org').then(({ data }) => {
      if (cancelled) return;
      const list = data?.insurance_status?.criticals || [];
      setOrgId(data?.id || null);
      if (list.length > 0) {
        const ackKey = SESSION_KEY_PREFIX + (data?.id || 'anon');
        if (sessionStorage.getItem(ackKey) === '1') {
          setDismissed(true);
        } else {
          setCriticals(list);
        }
      }
    }).catch(() => { /* silent — the OrgSettings page still surfaces alerts */ });
    return () => { cancelled = true; };
  }, []);

  if (dismissed || criticals.length === 0) return null;

  const ack = () => {
    if (orgId) sessionStorage.setItem(SESSION_KEY_PREFIX + orgId, '1');
    setDismissed(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center px-4"
      data-testid="insurance-critical-modal"
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border-t-4 border-red-500">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-600" />
            <h3 className="font-display font-semibold text-lg">Insurance action required</h3>
          </div>
          <button
            type="button"
            onClick={ack}
            data-testid="insurance-critical-close"
            className="text-slate-400 hover:text-slate-600"
          ><X size={16} /></button>
        </div>
        <p className="text-sm text-slate-700 mb-3">
          The following policies expire within 7 days. Renewal is required to avoid site-access issues.
        </p>
        <ul className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-lg p-3 space-y-1 mb-4">
          {criticals.map((c) => (
            <li key={c.policy} data-testid={`insurance-critical-item-${c.policy}`}>
              <span className="font-semibold">{c.label}</span>{' '}
              {c.days < 0
                ? `expired ${Math.abs(c.days)} days ago`
                : `expires in ${c.days} day${c.days === 1 ? '' : 's'}`}
              {' '}({c.expiry})
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={ack}
            data-testid="insurance-critical-ack"
            className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700"
          >Remind me later this session</button>
          <Link
            to="/app/settings/org"
            onClick={ack}
            data-testid="insurance-critical-review"
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
          >Review policies</Link>
        </div>
      </div>
    </div>
  );
}
