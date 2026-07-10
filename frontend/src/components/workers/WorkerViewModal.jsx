// v160.2.2 — Read-only Worker view drawer for the Workers admin table.
// Opens from the eye icon on each row. Never mutates state — Fetches
// `GET /api/workers/{id}` and displays identity, contact, personal,
// availability, clients and certifications with expiring/expired highlights.
import React, { useEffect, useState } from 'react';
import { Award, Calendar, HardHat, Loader2, MapPin, Users, X } from 'lucide-react';
import api, { apiError } from '../../lib/api';

const DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' }, { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

function fullName(w) {
  return `${w?.first_name || ''} ${w?.last_name || ''}`.trim() || '(unnamed)';
}

function shortDate(iso) {
  if (!iso || iso.length < 10) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

function CompanyChip({ label }) {
  const tints = {
    Paneltec: 'bg-[#e6eff9] text-[#1e4a8c]',
    Viatec:   'bg-[#ece6f4] text-[#4f3a8c]',
    Manual:   'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${tints[label] || tints.Manual}`}>
      {label || 'Simpro'}
    </span>
  );
}

function CertRow({ cert }) {
  const status = cert.status || {};
  const key = status.key || 'no_expiry';
  const map = {
    valid:         { bg: 'bg-[#d8ecdd]', ink: 'text-[#1f7a3f]', border: 'border-[#b6dcbf]' },
    expiring_soon: { bg: 'bg-[#fef3c7]', ink: 'text-[#92400e]', border: 'border-[#fcd34d]' },
    expired:       { bg: 'bg-[#fbe4e7]', ink: 'text-[#7a1f33]', border: 'border-[#e69aa3]' },
    no_expiry:     { bg: 'bg-[#d8e6f4]', ink: 'text-[#1e4a8c]', border: 'border-[#b9d2ec]' },
    missing_file:  { bg: 'bg-slate-100', ink: 'text-slate-600', border: 'border-slate-200' },
  };
  const style = map[key] || map.no_expiry;
  return (
    <tr className="border-t border-slate-100" data-testid={`view-cert-row-${cert.id}`}>
      <td className="px-3 py-2 font-medium text-slate-900 break-words max-w-[220px]">{cert.name}</td>
      <td className="px-3 py-2 text-slate-500 hidden md:table-cell">{cert.issuer || '—'}</td>
      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{shortDate(cert.expiry_date)}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${style.bg} ${style.ink} ${style.border}`}
          data-testid={`view-cert-status-${cert.id}`}>
          {status.label || '—'}
        </span>
      </td>
    </tr>
  );
}

export default function WorkerViewModal({ workerId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [worker, setWorker] = useState(null);
  const [certs, setCerts] = useState([]);
  const [clientMeta, setClientMeta] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const w = await api.get(`/workers/${workerId}`);
        if (!alive) return;
        setWorker(w.data);
        try {
          const c = await api.get(`/workers/${workerId}/certifications`);
          if (alive) setCerts(c.data || []);
        } catch (e) { /* silent — non-blocking */ }
        // Best-effort hydrate client names from Simpro cache.
        if ((w.data?.client_ids || []).length > 0) {
          try {
            const r = await api.get('/integrations/simpro/customers?company=both');
            const map = {};
            (r.data?.customers || []).forEach((c) => {
              map[c.simpro_customer_id] = { name: c.name, company_label: c.company_label };
            });
            if (alive) setClientMeta(map);
          } catch (e) { /* silent */ }
        }
      } catch (e) {
        if (alive) setError(apiError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [workerId]);

  const enabledDays = worker?.availability
    ? DAYS.filter((d) => worker.availability[d.key]?.enabled)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="worker-view-modal">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 bg-[#e6eff9] flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#1e4a8c]">Worker profile · Read only</div>
            <h2 className="font-display text-xl font-semibold text-slate-900 mt-0.5" data-testid="worker-view-name">
              {worker ? fullName(worker) : 'Loading…'}
            </h2>
            {worker && (
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <CompanyChip label={worker.company_label} />
                {worker.position && <span className="text-xs text-slate-600">{worker.position}</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/60" data-testid="worker-view-close">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-4 flex-1">
          {loading && (
            <div className="text-sm text-slate-500 inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading worker profile…
            </div>
          )}
          {error && (
            <div className="text-sm text-[#7a1f33] bg-[#fbe4e7] border border-[#e69aa3] rounded-lg px-3 py-2" data-testid="worker-view-error">
              {error}
            </div>
          )}
          {!loading && worker && (
            <>
              {/* Identity + contact */}
              <section className="border border-slate-200 rounded-xl px-4 py-3 bg-white" data-testid="view-section-identity">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm">
                  <HardHat size={14} className="text-slate-500" /> Identity &amp; contact
                </div>
                <dl className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-sm">
                  <dt className="text-slate-500 text-xs">Email</dt><dd className="text-slate-800">{worker.email || '—'}</dd>
                  <dt className="text-slate-500 text-xs">Phone</dt><dd className="text-slate-800">{worker.phone || '—'}</dd>
                  <dt className="text-slate-500 text-xs">Mobile</dt><dd className="text-slate-800">{worker.mobile || '—'}</dd>
                  <dt className="text-slate-500 text-xs">Status</dt>
                  <dd>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${worker.active ? 'bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                      {worker.active ? 'Active' : 'Inactive'}
                    </span>
                  </dd>
                </dl>
              </section>

              {/* Personal */}
              <section className="border border-slate-200 rounded-xl px-4 py-3 bg-white" data-testid="view-section-personal">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm">
                  <MapPin size={14} className="text-slate-500" /> Personal
                </div>
                <dl className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-sm">
                  <dt className="text-slate-500 text-xs">Birth date</dt><dd className="text-slate-800">{shortDate(worker.birth_date)}</dd>
                  <dt className="text-slate-500 text-xs">Country</dt><dd className="text-slate-800">{worker.country || '—'}</dd>
                  <dt className="text-slate-500 text-xs">State</dt><dd className="text-slate-800">{worker.state || '—'}</dd>
                  <dt className="text-slate-500 text-xs">Postal code</dt><dd className="text-slate-800">{worker.postal_code || '—'}</dd>
                  <dt className="text-slate-500 text-xs col-span-2">Street address</dt>
                  <dd className="col-span-2 text-slate-800">{[worker.street_address, worker.suburb, worker.state, worker.postal_code].filter(Boolean).join(', ') || '—'}</dd>
                </dl>
              </section>

              {/* Availability */}
              <section className="border border-slate-200 rounded-xl px-4 py-3 bg-white" data-testid="view-section-availability">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm">
                  <Calendar size={14} className="text-slate-500" /> Availability
                  {enabledDays.length > 0 && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#e6eff9] text-[#1e4a8c]">
                      {enabledDays.length} day{enabledDays.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                {enabledDays.length === 0 ? (
                  <div className="text-xs text-slate-400 italic">No days configured.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {enabledDays.map((d) => {
                      const row = worker.availability[d.key];
                      return (
                        <span key={d.key} data-testid={`view-availability-${d.key}`}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-[#e6eff9] text-[#1e4a8c] border border-[#b9d2ec]">
                          <span className="font-semibold">{d.label}</span>
                          <span className="font-mono text-[11px]">{row.start}–{row.end}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Clients */}
              <section className="border border-slate-200 rounded-xl px-4 py-3 bg-white" data-testid="view-section-clients">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm">
                  <Users size={14} className="text-slate-500" /> Clients
                  {(worker.client_ids || []).length > 0 && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#e6eff9] text-[#1e4a8c]">
                      {worker.client_ids.length}
                    </span>
                  )}
                </div>
                {(worker.client_ids || []).length === 0 ? (
                  <div className="text-xs text-slate-400 italic">No clients assigned.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {worker.client_ids.map((id) => {
                      const meta = clientMeta[id];
                      return (
                        <span key={id} data-testid={`view-client-chip-${id}`}
                          className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-full text-xs">
                          <span className="text-slate-700">{meta?.name || `Customer #${id}`}</span>
                          {meta?.company_label && <CompanyChip label={meta.company_label} />}
                        </span>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Certifications */}
              <section className="border border-slate-200 rounded-xl px-4 py-3 bg-white" data-testid="view-section-certifications">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm">
                  <Award size={14} className="text-slate-500" /> Certifications
                  {certs.length > 0 && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#e6eff9] text-[#1e4a8c]">
                      {certs.length}
                    </span>
                  )}
                </div>
                {certs.length === 0 ? (
                  <div className="text-xs text-slate-400 italic">No certifications recorded.</div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-xs" data-testid="view-cert-table">
                      <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="text-left px-3 py-2">Name</th>
                          <th className="text-left px-3 py-2 hidden md:table-cell">Issuer</th>
                          <th className="text-left px-3 py-2 whitespace-nowrap">Expiry</th>
                          <th className="text-left px-3 py-2 whitespace-nowrap">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {certs.map((c) => <CertRow key={c.id} cert={c} />)}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex justify-end bg-slate-50">
          <button onClick={onClose} data-testid="worker-view-close-footer"
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
