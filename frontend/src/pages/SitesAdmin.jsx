// Phase 4.2 — Sites admin page.
//
// List view (`/app/sites`): every Simpro-synced site in the org with a
// row-level "🖨 Print site QR" action that opens a layout-toggle modal +
// PdfPreviewModal of the printable QR sheet.
//
// Detail view (`/app/sites/:id`): site basics + a "Currently signed on"
// panel auto-refreshing every 60s with an admin "Sign off" action.
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Loader2, Printer, MapPin, Users, ChevronRight, RefreshCcw, LogOut, ArrowLeft, AlertCircle,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader } from '../components/capture/Ui';
import PdfPreviewModal from '../components/PdfPreviewModal';
import { stashInlinePdf } from '../lib/pdfStash';

const EDIT_ROLES = new Set(['admin', 'manager', 'hseq_lead']);

function fmtAgo(iso) {
  if (!iso) return '—';
  try {
    const d = typeof iso === 'string' ? parseISO(iso.replace(' ', 'T')) : iso;
    if (Number.isNaN(d.getTime())) return '—';
    return formatDistanceToNow(d, { addSuffix: true });
  } catch { return '—'; }
}

export default function SitesAdmin() {
  const user = getUser();
  const canEdit = EDIT_ROLES.has(user?.role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [printFor, setPrintFor] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/sites')
      .then((r) => { if (alive) setRows(r.data || []); })
      .catch((e) => { if (alive) toast.error(apiError(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.name || '').toLowerCase().includes(s)
      || (r.address_full || r.address || '').toLowerCase().includes(s)
      || (r.suburb || '').toLowerCase().includes(s),
    );
  }, [rows, search]);

  if (!canEdit) {
    return (
      <div className="p-8" data-testid="sites-admin-page">
        <PageHeader crumb="Compliance / Sites" title="Sites" />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 inline-flex items-start gap-3">
          <AlertCircle size={16} className="mt-0.5" />
          <div>This page is restricted to Admin, Manager and HSEQ Lead roles.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8" data-testid="sites-admin-page">
      <PageHeader
        crumb="Compliance / Sites"
        title="Sites"
        subtitle="Every Simpro-synced site with a printable QR gate-sign and a live count of who's signed on right now."
      />

      <div className="mb-4 flex items-center gap-3">
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by site name, address or suburb"
          data-testid="sites-search"
          className="flex-1 max-w-md px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <span className="text-xs text-slate-500">{filtered.length} site{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading sites…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No sites found. Sites sync from Simpro on a 12h schedule —{' '}
          <Link to="/app/settings/integrations/simpro" className="text-blue-700 font-semibold hover:underline">run the Simpro sync</Link>
          {' '}or seed one for testing.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="sites-list">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5">Site</th>
                <th className="text-left px-4 py-2.5">Address</th>
                <th className="text-left px-4 py-2.5">Scan token</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((s) => (
                <tr key={s.simpro_site_id} data-testid={`site-row-${s.simpro_site_id}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/app/sites/${encodeURIComponent(s.simpro_site_id)}`}
                      className="font-semibold text-slate-900 hover:text-blue-700 inline-flex items-center gap-1.5"
                      data-testid={`site-open-${s.simpro_site_id}`}>
                      {s.name || '(unnamed)'} <ChevronRight size={12} className="text-slate-400" />
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1"><MapPin size={11} className="text-slate-400" />
                      {s.address_full || s.address || `${s.suburb || ''} ${s.state || ''}`.trim() || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[11px] font-mono text-slate-500">{s.scan_token || <span className="italic text-slate-400">(generated on first print)</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setPrintFor(s)}
                      data-testid={`site-print-qr-btn-${s.simpro_site_id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Printer size={12} /> Print site QR
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {printFor && (
        <SitePrintModal site={printFor} onClose={() => setPrintFor(null)} />
      )}
    </div>
  );
}

function SitePrintModal({ site, onClose }) {
  const [layout, setLayout] = useState('gate_sign');
  const [directUrl, setDirectUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  const generate = useCallback(async (l) => {
    setBusy(true);
    try {
      const r = await api.get(`/sites/${encodeURIComponent(site.simpro_site_id)}/scan-pdf`,
        { params: { layout: l }, responseType: 'blob' });
      // Phase 3.13.1 — same-origin stash URL (ad-blocker friendly) instead
      // of `blob:` object URL.
      const { src } = await stashInlinePdf(r.data, `${site.name || 'site'}-qr.pdf`);
      setDirectUrl(src);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  }, [site.simpro_site_id, site.name]);

  useEffect(() => { generate(layout); }, [generate, layout]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 grid place-items-center p-0 md:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="site-print-modal">
      <div className="w-full h-full md:max-w-5xl md:h-[88vh] bg-white md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-blue-700">Site QR</div>
            <div className="font-display font-bold text-slate-900 truncate">{site.name}</div>
          </div>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-semibold">
            <button onClick={() => setLayout('gate_sign')}
              data-testid="site-print-layout-gate-sign"
              className={`px-3 py-1.5 ${layout === 'gate_sign' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              Gate Sign A4
            </button>
            <button onClick={() => setLayout('avery')}
              data-testid="site-print-layout-avery"
              className={`px-3 py-1.5 border-l border-slate-300 ${layout === 'avery' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              Avery 30-up
            </button>
          </div>
          <button onClick={onClose} data-testid="site-print-close"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-200">✕</button>
        </div>
        <div className="flex-1 bg-slate-100 relative">
          {busy ? (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 size={22} className="animate-spin text-blue-600" />
            </div>
          ) : directUrl ? (
            <iframe data-testid="site-print-iframe" title="Site QR PDF" src={directUrl}
              className="w-full h-full border-0" />
          ) : null}
        </div>
        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500">
          Token: <span className="font-mono">{site.scan_token || 'generated'}</span> · Open in a new tab to print, or download via the browser PDF toolbar.
        </div>
      </div>
    </div>
  );
}

export function SiteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = getUser();
  const canEdit = EDIT_ROLES.has(user?.role);
  const [site, setSite] = useState(null);
  const [siteErr, setSiteErr] = useState(null);
  const [signons, setSignons] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);
  const intervalRef = useRef(null);

  // Initial site fetch via the list (no detail endpoint needed for v1)
  useEffect(() => {
    let alive = true;
    api.get('/sites')
      .then((r) => {
        if (!alive) return;
        const match = (r.data || []).find((s) => String(s.simpro_site_id) === String(id));
        if (match) setSite(match);
        else setSiteErr('not_found');
      })
      .catch((e) => { if (alive) setSiteErr(apiError(e)); });
    return () => { alive = false; };
  }, [id]);

  const loadSignons = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.get(`/sites/${encodeURIComponent(id)}/active-signons`);
      setSignons(r.data?.signons || []);
      setLastRefresh(new Date());
    } catch (e) {
      // Don't toast on background polls — show inline instead
      console.warn('active-signons fetch failed', e);
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  // Initial + 60s interval
  useEffect(() => {
    if (!canEdit) return;
    loadSignons();
    intervalRef.current = setInterval(loadSignons, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [canEdit, loadSignons]);

  const signOff = async (signonId) => {
    try {
      await api.delete(`/sites/${encodeURIComponent(id)}/active-signons/${signonId}`);
      toast.success('Worker signed off');
      setSignons((prev) => prev.filter((s) => s.id !== signonId));
    } catch (e) { toast.error(apiError(e)); }
  };

  if (!canEdit) {
    return (
      <div className="p-8">
        <PageHeader crumb="Compliance / Sites" title="Site" />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Restricted to Admin / Manager / HSEQ Lead.</div>
      </div>
    );
  }

  if (siteErr === 'not_found') {
    return (
      <div className="p-8">
        <button onClick={() => navigate('/app/sites')}
          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 mb-3">
          <ArrowLeft size={12} /> All sites
        </button>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">Site not found.</div>
      </div>
    );
  }
  if (!site) {
    return <div className="p-8 text-sm text-slate-500"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading…</div>;
  }

  return (
    <div className="p-6 lg:p-8" data-testid="site-detail-page">
      <button onClick={() => navigate('/app/sites')} data-testid="site-detail-back"
        className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 mb-3">
        <ArrowLeft size={12} /> All sites
      </button>
      <PageHeader
        crumb={`Compliance / Sites / ${site.name || site.simpro_site_id}`}
        title={site.name || `Site ${site.simpro_site_id}`}
        subtitle={site.address_full || site.address || `${site.suburb || ''} ${site.state || ''}`.trim()}
        action={
          <button type="button" onClick={() => setPrintOpen(true)}
            data-testid={`site-detail-print-qr-${site.simpro_site_id}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">
            <Printer size={14} /> Print site QR
          </button>
        }
      />

      {/* Active sign-ons panel */}
      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden mt-2" data-testid="site-active-signons">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <Users size={14} className="text-emerald-700" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Currently signed on</div>
            <div className="text-sm font-bold text-slate-900">{signons.length} active {signons.length === 1 ? 'worker' : 'workers'} on site (last 24h)</div>
          </div>
          <button onClick={loadSignons} disabled={refreshing}
            data-testid="site-signons-refresh"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-50">
            {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCcw size={11} />}
            Refresh
          </button>
          {lastRefresh && <span className="text-[10px] text-slate-400" data-testid="site-signons-last-refresh">Updated {fmtAgo(lastRefresh.toISOString())}</span>}
        </div>
        {signons.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Nobody is signed on right now.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2">Worker</th>
                <th className="text-left px-4 py-2">Signed on</th>
                <th className="text-left px-4 py-2">Source</th>
                <th className="text-right px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {signons.map((s) => (
                <tr key={s.id} data-testid={`signon-row-${s.worker_id}`} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-semibold text-slate-900">{s.worker_name || s.worker_id}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{fmtAgo(s.signed_at)}</td>
                  <td className="px-4 py-2.5 text-[11px] uppercase font-semibold text-slate-500">{s.source || 'qr'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => signOff(s.id)}
                      data-testid={`signoff-btn-${s.worker_id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-[11px] font-semibold hover:bg-rose-100">
                      <LogOut size={11} /> Sign off
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {printOpen && (
        <SitePrintModal site={site} onClose={() => setPrintOpen(false)} />
      )}
    </div>
  );
}
