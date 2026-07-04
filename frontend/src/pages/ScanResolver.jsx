// Public QR scan landing page — resolves /scan/:token and either redirects to
// login (if anonymous) or shows asset detail + a curated forms launcher (Phase
// 3.8) with quick maintenance actions demoted underneath.
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Loader2, MapPin, Copy, ArrowRight, AlertTriangle, Truck, Wrench, Archive,
  Wrench as ServiceIcon, Gauge, AlertOctagon, X, Check, ChevronRight,
  ClipboardCheck, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { getToken } from '../lib/auth';
import api, { apiError } from '../lib/api';
import { copyToClipboard } from '../lib/clipboard';
import Logo from '../components/brand/Logo';

const PUBLIC_BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Server returns icon hints by name — map them to lucide components.
const FORM_ICONS = {
  ClipboardCheck,
  Truck,
  AlertOctagon,
  AlertTriangle,
  Wrench,
};

// Category → soft pastel + accent for icon backgrounds.
const CAT_TILE = {
  pre_use:         'bg-blue-50 text-blue-700 ring-blue-100',
  daily_check:     'bg-indigo-50 text-indigo-700 ring-indigo-100',
  plant_pre_start: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  incident:        'bg-rose-50 text-rose-700 ring-rose-100',
  near_miss:       'bg-amber-50 text-amber-700 ring-amber-100',
};

export default function ScanResolver() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', asset: null, err: null });
  const [forms, setForms] = useState(null);  // null = not loaded, [] = loaded but empty
  const [formsLoading, setFormsLoading] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  // Resolve the asset (public endpoint — no Bearer needed).
  useEffect(() => {
    let alive = true;
    axios.get(`${PUBLIC_BASE}/assets/scan/${token}`)
      .then((r) => {
        // Legacy deep-link `/scan/{token}?form={id}` still supported: stash
        // and redirect straight to the Fill-out modal.
        try {
          const sp = new URLSearchParams(window.location.search);
          const formId = sp.get('form');
          if (formId && getToken()) {
            sessionStorage.setItem('paneltec.activeScan', JSON.stringify({
              scan_token: token, at: Date.now(), form_id: formId,
            }));
            navigate(`/app/forms?template=${encodeURIComponent(formId)}&scan=${encodeURIComponent(token)}`, { replace: true });
            return;
          }
        } catch { /* fall through to default view */ }
        if (alive) setState({ status: 'ok', asset: r.data, err: null });
      })
      .catch((e) => {
        if (!alive) return;
        const code = e?.response?.status;
        if (code === 404) setState({ status: 'not_found', asset: null, err: 'Unknown scan token' });
        else if (code === 410) setState({ status: 'retired', asset: null, err: 'Asset retired' });
        else setState({ status: 'error', asset: null, err: e?.response?.data?.detail || e.message });
      });
    return () => { alive = false; };
  }, [token, navigate]);

  // Once we have the asset AND the user is authed, load the curated forms.
  const isAuthed = !!getToken();
  useEffect(() => {
    if (state.status !== 'ok' || !isAuthed) return;
    let alive = true;
    setFormsLoading(true);
    api.get(`/scan/${token}/forms`)
      .then((r) => { if (alive) setForms(r.data?.forms || []); })
      .catch(() => { if (alive) setForms([]); })
      .finally(() => { if (alive) setFormsLoading(false); });
    return () => { alive = false; };
  }, [state.status, isAuthed, token]);

  const goLogin = () => navigate(`/?next=${encodeURIComponent(`/scan/${token}`)}`);

  const copyLink = () => {
    const url = `${window.location.origin}/scan/${token}`;
    copyToClipboard(url, { successMsg: 'Link copied' });
  };

  const launchForm = async (templateId) => {
    try {
      // Verify access before navigating so we surface 404/410 inline rather
      // than mid-modal. The server returns OK quickly; this is mostly an
      // audit hook + a tiny safety check.
      await api.post('/scan/quick-action', {
        scan_token: token, action: 'open_form', payload: { template_id: templateId },
      });
    } catch (e) {
      toast.error(apiError(e));
      return;
    }
    sessionStorage.setItem('paneltec.activeScan', JSON.stringify({
      scan_token: token, at: Date.now(), form_id: templateId,
    }));
    navigate(`/app/forms?template=${encodeURIComponent(templateId)}&scan=${encodeURIComponent(token)}`);
  };

  // Layout: error states use the small centered card. The OK state uses a
  // wider stacked layout (asset → forms grid → quick actions).
  const isErrorState = state.status !== 'ok';

  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center p-4 sm:p-6">
      <div className={`w-full ${isErrorState ? 'max-w-md' : 'max-w-3xl'} space-y-4`}>
        <header className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex items-center gap-2 shadow-sm">
          <Logo />
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-400 ml-auto">QR Scan</span>
        </header>

        {state.status === 'loading' && (
          <div className="bg-white rounded-2xl border border-slate-200 px-6 py-10 text-center text-sm text-slate-500 shadow-sm" data-testid="scan-loading">
            <Loader2 size={22} className="animate-spin inline mr-2 text-blue-600" />
            Resolving asset…
          </div>
        )}
        {state.status === 'not_found' && (
          <ErrorCard testId="scan-not-found" tone="rose" Icon={AlertTriangle}
            title="Unknown scan token"
            body={`This QR isn't linked to any asset in Paneltec Civil. It may have been retired or mistyped.`}
            footer={<p className="mt-3 text-[11px] text-slate-400 font-mono">{token}</p>} />
        )}
        {state.status === 'retired' && (
          <ErrorCard testId="scan-retired" tone="slate" Icon={Archive}
            title="Asset retired"
            body="The asset that owns this tag has been retired. Contact your supervisor for replacement." />
        )}
        {state.status === 'error' && (
          <ErrorCard testId="scan-error" tone="amber" Icon={AlertTriangle}
            title="Something went wrong"
            body={state.err || 'Try again in a moment.'} />
        )}

        {state.status === 'ok' && state.asset && (
          <>
            {/* Asset card — name + chips + view-in-register link */}
            <section className="bg-white rounded-2xl border border-slate-200 px-5 py-5 sm:px-6 sm:py-6 shadow-sm" data-testid="scan-asset-card">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                  {state.asset.kind === 'vehicle'
                    ? <Truck size={22} className="text-blue-700" />
                    : <Wrench size={22} className="text-blue-700" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                    {(state.asset.kind || '').toUpperCase()}
                    {state.asset.asset_type ? ` · ${state.asset.asset_type.replace(/_/g, ' ').toUpperCase()}` : ''}
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 truncate" data-testid="scan-name">
                    {state.asset.name}
                  </h2>
                  {state.asset.rego_serial && (
                    <div className="mt-1.5 inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-sm font-mono font-bold text-slate-900" data-testid="scan-rego">
                      {state.asset.rego_serial}
                    </div>
                  )}
                </div>
                {isAuthed && (
                  <Link to={`/app/vehicles?focus=${state.asset.id}`}
                    className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800 shrink-0"
                    data-testid="scan-view-asset">
                    View asset <ArrowRight size={13} />
                  </Link>
                )}
              </div>

              {!isAuthed && (
                <div className="mt-5 px-3 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-center gap-2" data-testid="scan-signin-hint">
                  Sign in to launch forms, log service, or report a defect.
                </div>
              )}

              {/* Map row + secondary actions */}
              {(state.asset.has_position && state.asset.last_known_lat) || true ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  {state.asset.has_position && state.asset.last_known_lat && (
                    <a target="_blank" rel="noreferrer"
                      href={`https://www.google.com/maps?q=${state.asset.last_known_lat},${state.asset.last_known_lng}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold"
                      data-testid="scan-locate">
                      <MapPin size={13} className="text-emerald-600" /> Locate on map
                    </a>
                  )}
                  <button onClick={copyLink}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold"
                    data-testid="scan-copy">
                    <Copy size={13} /> Copy scan link
                  </button>
                  {isAuthed && (
                    <Link to={`/app/vehicles?focus=${state.asset.id}`}
                      className="sm:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold"
                      data-testid="scan-view-asset-mobile">
                      View asset <ChevronRight size={13} />
                    </Link>
                  )}
                </div>
              ) : null}
            </section>

            {/* Forms launcher — primary above-the-fold CTA */}
            {isAuthed ? (
              <FormsSection
                forms={forms}
                loading={formsLoading}
                onLaunch={launchForm}
                assetName={state.asset.name} />
            ) : (
              <section className="bg-white rounded-2xl border border-slate-200 px-5 py-6 shadow-sm flex items-center justify-center">
                <button onClick={goLogin}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700"
                  data-testid="scan-signin">
                  Sign in to continue <ArrowRight size={15} />
                </button>
              </section>
            )}

            {/* Quick actions — demoted, behind a disclosure */}
            {isAuthed && (
              <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" data-testid="quick-actions-section">
                <button onClick={() => setActionsOpen((p) => !p)}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50"
                  data-testid="quick-actions-toggle">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Maintenance</div>
                    <div className="text-sm font-bold text-slate-900">Quick service actions</div>
                  </div>
                  <ChevronDown size={16} className={`text-slate-400 transition ${actionsOpen ? 'rotate-180' : ''}`} />
                </button>
                {actionsOpen && (
                  <div className="px-5 pb-5">
                    <ScanQuickActions assetToken={token} assetName={state.asset.name} />
                  </div>
                )}
              </section>
            )}

            <p className="text-center text-[10px] uppercase tracking-wider text-slate-400 pb-4">
              Token <span className="font-mono">{token}</span> · Paneltec Civil
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ────────────────── Forms grid ──────────────────

function FormsSection({ forms, loading, onLaunch, assetName }) {
  const recommended = useMemo(() => (forms || []).filter((f) => f.recommended), [forms]);
  const standard = useMemo(() => (forms || []).filter((f) => !f.recommended), [forms]);

  if (loading) {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 px-5 py-6 shadow-sm text-center text-sm text-slate-500" data-testid="forms-loading">
        <Loader2 size={18} className="animate-spin inline mr-2 text-blue-600" /> Loading forms…
      </section>
    );
  }
  if (!forms || forms.length === 0) {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 px-5 py-6 shadow-sm text-center text-sm text-slate-500" data-testid="forms-empty">
        No forms wired to this asset yet.
      </section>
    );
  }
  return (
    <section className="bg-white rounded-2xl border border-slate-200 px-5 py-5 sm:px-6 sm:py-6 shadow-sm" data-testid="scan-forms-section">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-display text-lg sm:text-xl font-bold text-slate-900">
          Forms for {assetName}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">
          {forms.length} form{forms.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="scan-forms-grid">
        {recommended.map((f) => (
          <FormTile key={f.template_id} form={f} recommended onLaunch={onLaunch} />
        ))}
        {standard.map((f) => (
          <FormTile key={f.template_id} form={f} onLaunch={onLaunch} />
        ))}
      </div>
    </section>
  );
}

function FormTile({ form, recommended, onLaunch }) {
  const Icon = FORM_ICONS[form.icon] || ClipboardCheck;
  const tileTone = CAT_TILE[form.category] || 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <button onClick={() => onLaunch(form.template_id)}
      data-testid={`form-tile-${form.template_id}`}
      className={`group text-left p-4 rounded-2xl border-2 transition flex flex-col gap-3 min-h-[180px] focus:outline-none focus:ring-2 focus:ring-blue-300 ${
        recommended
          ? 'border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50 hover:border-emerald-400'
          : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
      }`}>
      <div className="flex items-start gap-2.5">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ring-2 ${tileTone}`}>
          <Icon size={18} />
        </div>
        {recommended && (
          <span className="ml-auto inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white">
            Recommended
          </span>
        )}
      </div>
      <div className="flex-1">
        <h4 className="font-display text-base font-bold text-slate-900 leading-tight">{form.name}</h4>
        <p className="mt-1 text-xs text-slate-500 leading-snug line-clamp-2">{form.description || '—'}</p>
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{form.field_count} fields</span>
        <span className="inline-flex items-center gap-1 font-bold text-blue-700 group-hover:translate-x-0.5 transition-transform">
          Open <ArrowRight size={12} />
        </span>
      </div>
    </button>
  );
}

// ────────────────── Error card helper ──────────────────

function ErrorCard({ testId, tone, Icon, title, body, footer }) {
  const toneCls = tone === 'rose'  ? 'bg-rose-50 text-rose-600'
                 : tone === 'amber' ? 'bg-amber-50 text-amber-600'
                 :                    'bg-slate-100 text-slate-500';
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-6 py-10 text-center shadow-sm" data-testid={testId}>
      <div className={`inline-flex w-14 h-14 rounded-2xl items-center justify-center mb-3 ${toneCls}`}>
        <Icon size={22} />
      </div>
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
      {footer}
    </div>
  );
}

// ────────────────── Quick actions (Phase 3, lightly refactored) ──────────────────

function ScanQuickActions({ assetToken, assetName }) {
  const [open, setOpen] = useState(null); // 'service' | 'defect' | 'meter' | null
  const [form, setForm] = useState({ description: '', hours: '', km: '', defect_severity: 'minor', title: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const payload = {};
      if (open === 'service') Object.assign(payload, { title: form.title || 'Service log', description: form.description, hours_at: form.hours || null, km_at: form.km || null });
      if (open === 'defect') Object.assign(payload, { title: form.title || 'Defect reported', description: form.description, defect_severity: form.defect_severity });
      if (open === 'meter') Object.assign(payload, { hours: form.hours || null, km: form.km || null });
      const r = await api.post('/scan/quick-action', { scan_token: assetToken, action: open === 'meter' ? 'update_meter' : open === 'service' ? 'log_service' : 'report_defect', payload });
      if (open === 'defect' && r.data.linked_hazard_id) toast.success(`Done · Hazard raised on ${assetName}`);
      else toast.success(`Done · added to ${assetName}`);
      setOpen(null);
      setForm({ description: '', hours: '', km: '', defect_severity: 'minor', title: '' });
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="grid grid-cols-3 gap-2" data-testid="scan-quick-actions">
        <button onClick={() => setOpen('service')}
          className="flex flex-col items-center gap-1 py-3 rounded-xl border border-slate-200 bg-white hover:bg-blue-50"
          data-testid="quick-log-service">
          <ServiceIcon size={18} className="text-blue-700" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Log service</span>
        </button>
        <button onClick={() => setOpen('defect')}
          className="flex flex-col items-center gap-1 py-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100"
          data-testid="quick-report-defect">
          <AlertOctagon size={18} className="text-rose-600" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Report defect</span>
        </button>
        <button onClick={() => setOpen('meter')}
          className="flex flex-col items-center gap-1 py-3 rounded-xl border border-slate-200 bg-white hover:bg-blue-50"
          data-testid="quick-update-meter">
          <Gauge size={18} className="text-slate-600" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Update hours/km</span>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-3" onClick={(e) => e.target === e.currentTarget && setOpen(null)} data-testid="quick-action-form">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200">
            <div className="px-5 py-3 border-b flex items-center">
              <h3 className="font-display font-bold text-slate-900 flex-1">{open === 'service' ? 'Log service' : open === 'defect' ? 'Report defect' : 'Update hours/km'}</h3>
              <button onClick={() => setOpen(null)} data-testid="quick-close"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              {open !== 'meter' && (
                <>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="qa-title" />
                  <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" className="w-full px-3 py-2 border border-slate-300 rounded-lg" data-testid="qa-desc" />
                </>
              )}
              {open === 'defect' && (
                <div className="flex gap-2">
                  {['minor', 'major', 'critical'].map((s) => (
                    <button key={s} onClick={() => setForm({ ...form, defect_severity: s })}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold uppercase border ${form.defect_severity === s ? (s === 'critical' ? 'bg-rose-600 text-white border-rose-600' : s === 'major' ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-600 text-white border-slate-600') : 'bg-white border-slate-200'}`}
                      data-testid={`qa-sev-${s}`}>{s}</button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <input type="number" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="Hours" className="px-3 py-2 border border-slate-300 rounded-lg" data-testid="qa-hours" />
                <input type="number" value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value })} placeholder="Km" className="px-3 py-2 border border-slate-300 rounded-lg" data-testid="qa-km" />
              </div>
            </div>
            <div className="px-5 py-3 border-t bg-slate-50 flex justify-end gap-2">
              <button onClick={() => setOpen(null)} className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold" data-testid="qa-cancel">Cancel</button>
              <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-50" data-testid="qa-submit">
                {busy ? <Loader2 size={14} className="inline animate-spin" /> : <Check size={14} className="inline" />} Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
