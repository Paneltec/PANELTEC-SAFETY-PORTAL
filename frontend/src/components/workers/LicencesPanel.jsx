/**
 * v58.13.132fi — Licences panel: filtered view over worker_certifications.
 *
 * Reads `/api/workers/{id}/certifications`, filters by `cert_kind_slug`
 * in the licence family, and shows a compact table with row-tinting by
 * expiry (red = expired, amber = ≤30 days, normal = valid). Edits +
 * deletes stay under the main Certifications section — this is
 * intentionally a READ-ONLY view surface for discoverability.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Edit3, IdCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import { filesUrl } from '../../lib/downloadUrl';
import OpenAsPdfButton from '../OpenAsPdfButton';
import CertEditModal from '../certifications/CertEditModal';

// v58.13.132hp — localStorage-per-user persistence for the panel
// open/closed state. Keyed on workerId so each profile remembers
// its own choice. Falls back to `true` (open) on first mount.
function useCollapseState(storageKey) {
  const [open, setOpen] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return true;
      return raw === '1';
    } catch (_e) { return true; }
  });
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(storageKey, next ? '1' : '0'); } catch (_e) { /* quota */ }
      return next;
    });
  };
  return [open, toggle];
}

// Kept in sync with backend/cert_kinds.py — licence-family slugs.
const LICENCE_SLUGS = new Set([
  'hr_licence', 'mr_licence', 'ewp_licence', 'forklift_licence',
  'working_at_heights', 'first_aid', 'white_card', 'trade_certificate',
  'drivers_licence',
]);

function dayDiff(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}

function expiryTone(iso) {
  const d = dayDiff(iso);
  if (d === null) return null;
  if (d < 0) return 'expired';
  if (d <= 30) return 'expiring';
  return 'valid';
}

const TONE_ROW = {
  expired: 'bg-rose-50',
  expiring: 'bg-amber-50',
  valid: '',
};

const TONE_CHIP = {
  expired: 'bg-rose-100 text-rose-800 border-rose-200',
  expiring: 'bg-amber-100 text-amber-800 border-amber-200',
  valid: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

export default function LicencesPanel({ workerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  // v58.13.132hp — Collapsible + inline edit modal.
  const [open, toggle] = useCollapseState(`paneltec:licences:open:${workerId}`);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/workers/${workerId}/certifications`);
      const all = Array.isArray(data) ? data : (data?.rows || data?.items || []);
      const licencesOnly = all.filter((r) => {
        const slug = (r.cert_kind_slug || r.cert_kind || '').toLowerCase();
        const name = (r.name || '').toLowerCase();
        return LICENCE_SLUGS.has(slug) || /licen[cs]e|ticket|white card/.test(name);
      });
      // Sort: expired first (most urgent), then expiring, then valid.
      licencesOnly.sort((a, b) => {
        const rank = { expired: 0, expiring: 1, valid: 2, [null]: 3 };
        return (rank[expiryTone(a.expiry_date)] ?? 3) - (rank[expiryTone(b.expiry_date)] ?? 3);
      });
      setRows(licencesOnly);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workerId]);

  const summary = useMemo(() => {
    const s = { total: rows.length, expired: 0, expiring: 0, valid: 0 };
    for (const r of rows) {
      const t = expiryTone(r.expiry_date);
      if (t) s[t] += 1;
    }
    return s;
  }, [rows]);

  const openOriginal = async (r) => {
    // v58.13.132hk fallback — the modal invokes this if the PDF
    // pipeline can't render the source file (e.g. .dwg).
    if (!r.doc_file_id) return;
    try {
      const u = await filesUrl(`/workers/${workerId}/certifications/${r.id}/file`);
      window.open(u, '_blank', 'noopener,noreferrer');
    } catch (_e) { toast.error('Unable to open file'); }
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white"
      data-testid="section-licences">
      <button type="button"
        onClick={toggle}
        aria-expanded={open}
        data-testid="section-licences-toggle"
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex-wrap text-left hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40">
        <IdCard size={14} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-800 mr-1">Licences</span>
        <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"
          data-testid="section-licences-total">
          {summary.total} total
        </span>
        {summary.expired > 0 && (
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${TONE_CHIP.expired}`}
            data-testid="section-licences-expired">
            {summary.expired} expired
          </span>
        )}
        {summary.expiring > 0 && (
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${TONE_CHIP.expiring}`}
            data-testid="section-licences-expiring">
            {summary.expiring} expiring 30d
          </span>
        )}
        <ChevronDown size={14}
          className={`text-slate-400 transition-transform ml-auto ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
      <div className="px-4 py-4" data-testid="section-licences-body">
        {loading ? (
          <div className="text-sm text-slate-500 inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-500 italic" data-testid="licences-empty">
            No licences recorded yet. Add one via the Certifications section above.
          </p>
        ) : (
          <table className="min-w-full text-sm border border-slate-100 rounded-lg overflow-hidden"
            data-testid="licences-table">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Type / Name</th>
                <th className="text-left px-3 py-2">Number</th>
                <th className="text-left px-3 py-2">Expires</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tone = expiryTone(r.expiry_date);
                const chipCls = tone ? TONE_CHIP[tone] : 'bg-slate-100 text-slate-500 border-slate-200';
                const d = dayDiff(r.expiry_date);
                const statusLabel = tone === 'expired' ? `Expired ${-d}d ago`
                  : tone === 'expiring' ? `Expires in ${d}d`
                  : tone === 'valid' ? 'Valid'
                  : 'No expiry';
                return (
                  <tr key={r.id}
                    className={`border-t border-slate-100 ${TONE_ROW[tone] || ''}`}
                    data-testid={`licence-row-${r.id}`}
                    data-expiry-tone={tone || 'none'}>
                    <td className="px-3 py-2 text-slate-800 font-medium">{r.name || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 font-mono text-[11px]">
                      {r.licence_number || r.reference || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600 font-mono text-[11px]">
                      {r.expiry_date || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${chipCls}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* v58.13.132hp — Inline view (PDF preview modal
                          from .132hk) + edit (existing CertEditModal).
                          Prior version told the user to scroll up to
                          the Certifications section to edit; now
                          both actions live where the row is. */}
                      <div className="inline-flex items-center gap-1">
                        {r.doc_file_id ? (
                          <OpenAsPdfButton
                            source="cert_file"
                            refObj={{ worker_id: workerId, cert_id: r.id }}
                            filename={r.name || 'certificate'}
                            onDownloadOriginal={() => openOriginal(r)}
                            data-testid={`licence-file-${r.id}`}
                          />
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                        <button type="button"
                          onClick={() => setEditing(r)}
                          data-testid={`licence-edit-${r.id}`}
                          title="Edit licence"
                          className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-600 hover:text-[#1e4a8c]">
                          <Edit3 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}
      {editing && (
        <CertEditModal
          cert={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
