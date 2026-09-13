import React, { useEffect, useMemo, useState } from 'react';
import { Save, Building2, MapPin, Phone, Shield, ShieldCheck, AlertTriangle, UploadCloud, Download, Info, Globe, Mail, Copy, ChevronDown, ChevronRight, X, Send, Clock, Award, Trash2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { useCan } from '../lib/permissions';
import { PageHeader, PrimaryButton, Field, inputClass } from '../components/capture/Ui';
import ArchiveRulesSection from '../components/ArchiveRulesSection';  // v58.13.132ed
import QuickLinksSection from '../components/QuickLinksSection';  // v58.13.132eo

// v58.13.132dp — Organisation Settings expansion (5 items).
// v58.13.132dq — Adds: (a) 3rd insurance slot "General Cover",
//                (b) "Email Certificates" popup that attaches selected
//                    (current + archived) certificates from GridFS and
//                    dispatches via Microsoft 365 Graph SendMail,
//                (c) Simpro customer picker for the recipient list,
//                (d) Portal URL copy-to-clipboard button,
//                (e) Past-certificates archive per policy type (never
//                    delete from GridFS — audit compliance).
//
//   1. Editable slug + validation + confirm dialog + previous_slugs.
//   2. Portal URL in PDF branding (rendered on the PDF footer).
//   3. Additional org fields (trading_name, emergency contact,
//      after-hours contact, website_url, PL insurance, WC insurance,
//      logo upload).
//   4. Insurance expiry warnings (30-day banner surfaced here; 7-day
//      login modal handled in AppShell via `InsuranceCriticalModal`).
//   5. Elevated card visual polish (IMPORTANT chip + emphasis banner).
//
// Payment fields, notification prefs and role presets stay in their
// own sub-pages — this file remains the identity/compliance surface.

const IDENTITY = [
  { key: 'name', label: 'Organisation name', required: true },
  { key: 'display_name', label: 'Display / Branding name',
    placeholder: 'What appears in the sidebar wordmark',
    hint: 'Sidebar wordmark + PDF header. Falls back to Trading name, then Organisation name. Leave blank to use the fallback.' },
  { key: 'trading_name', label: 'Trading name', placeholder: 'If different from legal name' },
  { key: 'abn', label: 'ABN' },
];

const ADDRESS = [
  { key: 'address_line1', label: 'Address line 1' },
  { key: 'address_line2', label: 'Address line 2' },
  { key: 'suburb', label: 'Suburb' },
  { key: 'state', label: 'State' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'country', label: 'Country' },
];

const CONTACT = [
  { key: 'contact_name', label: 'Primary contact' },
  { key: 'contact_email', label: 'Contact email', type: 'email' },
  { key: 'contact_phone', label: 'Contact phone' },
  { key: 'emergency_contact_phone', label: 'Emergency contact number', hint: '24/7 safety line — printed on PDF reports.' },
  { key: 'after_hours_contact_name', label: 'After-hours contact name' },
  { key: 'after_hours_contact_phone', label: 'After-hours contact phone' },
  { key: 'website_url', label: 'Public website URL', placeholder: 'https://paneltec.com.au', type: 'url' },
];

const BRANDING = [
  { key: 'website', label: 'Website (legacy)', placeholder: 'https://paneltec.com.au',
    hint: 'Legacy PDF header link. Prefer the fields above for new deploys.' },
];

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export default function OrgSettings() {
  const can = useCan();
  const isAdmin = can('users', 'edit');
  const [doc, setDoc] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState(null);
  const [uploading, setUploading] = useState({});

  const load = async () => {
    try {
      const { data } = await api.get('/org');
      setDoc(data);
      setForm({
        name: data.name || '',
        slug: data.slug || '',
        display_name: data.display_name || '',
        trading_name: data.trading_name || '',
        abn: data.abn || '',
        address_line1: data.address_line1 || '',
        address_line2: data.address_line2 || '',
        suburb: data.suburb || '',
        state: data.state || '',
        postcode: data.postcode || '',
        country: data.country || 'Australia',
        contact_name: data.contact_name || '',
        contact_email: data.contact_email || '',
        contact_phone: data.contact_phone || '',
        emergency_contact_phone: data.emergency_contact_phone || '',
        after_hours_contact_name: data.after_hours_contact_name || '',
        after_hours_contact_phone: data.after_hours_contact_phone || '',
        website_url: data.website_url || '',
        timezone: data.timezone || 'Australia/Sydney',
        website: data.website || '',
        portal_url: data.portal_url || '',
        logo_url: data.logo_url || '',
        public_liability_insurance: {
          policy_number: data.public_liability_insurance?.policy_number || '',
          expiry_date: data.public_liability_insurance?.expiry_date || '',
        },
        workers_comp_insurance: {
          policy_number: data.workers_comp_insurance?.policy_number || '',
          expiry_date: data.workers_comp_insurance?.expiry_date || '',
        },
        general_cover_insurance: {
          policy_number: data.general_cover_insurance?.policy_number || '',
          expiry_date: data.general_cover_insurance?.expiry_date || '',
        },
        professional_indemnity_insurance: {
          policy_number: data.professional_indemnity_insurance?.policy_number || '',
          expiry_date: data.professional_indemnity_insurance?.expiry_date || '',
        },
        insurance_email_preamble: data.insurance_email_preamble || '',
      });
    } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setInsurance = (kind, key, v) => setForm((f) => ({
    ...f, [`${kind}_insurance`]: { ...(f[`${kind}_insurance`] || {}), [key]: v },
  }));

  // Affected-surfaces list surfaced in the confirm dialog. Populated
  // from the org grep at ship time — see .132dp memo.
  const slugAffectedSurfaces = useMemo(() => ([
    'PDF report filenames (org-scoped audit exports)',
    'Public mobile deep-link handles (paneltec://o/<slug>/…)',
    'Renewal email portal-link paths (/o/<slug>/renew/…)',
    'Historical audit exports (keep old filenames — no rename)',
    'Backward-compat lookup via `previous_slugs` (auto-preserved)',
  ]), []);

  const trySave = () => {
    if (!(form.name || '').trim()) {
      toast.error('Organisation name required');
      return;
    }
    const newSlug = (form.slug || '').trim().toLowerCase();
    const curSlug = doc?.slug || '';
    if (newSlug && !SLUG_RE.test(newSlug)) {
      toast.error('Slug must be lowercase alphanumeric with hyphens (3-40 chars).');
      return;
    }
    if (newSlug && newSlug !== curSlug) {
      // Confirm before applying — big blast radius.
      setConfirmSlug({ oldSlug: curSlug, newSlug });
      return;
    }
    doSave();
  };

  const doSave = async () => {
    setBusy(true);
    try {
      const payload = { ...form };
      // Drop empty email so backend EmailStr doesn't choke.
      if (!payload.contact_email) delete payload.contact_email;
      // Only pass slug when it changed to avoid tripping the
      // uniqueness check on identical value round-trips.
      if ((payload.slug || '').trim() === (doc?.slug || '').trim()) {
        delete payload.slug;
      } else {
        payload.slug = (payload.slug || '').trim().toLowerCase();
      }
      // Strip empty insurance blocks so we don't overwrite an
      // existing block with `{policy_number:'', expiry_date:''}`.
      for (const k of ['public_liability_insurance', 'workers_comp_insurance', 'general_cover_insurance', 'professional_indemnity_insurance']) {
        const b = payload[k] || {};
        if (!b.policy_number && !b.expiry_date) delete payload[k];
      }
      const { data } = await api.patch('/org', payload);
      setDoc(data);
      // v58.13.132dr — Nudge the AppShell to refresh the sidebar
      // wordmark so display_name / trading_name / name edits reflect
      // without a page reload.
      window.dispatchEvent(new CustomEvent('paneltec_org_updated'));
      toast.success('Organisation updated');
      setConfirmSlug(null);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const uploadFile = async (endpoint, file, key) => {
    if (!file) return;
    setUploading((u) => ({ ...u, [key]: true }));
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(endpoint, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Uploaded');
      await load();
      return data;
    } catch (e) { toast.error(apiError(e)); }
    finally { setUploading((u) => ({ ...u, [key]: false })); }
  };

  // v58.13.132dq — Portal URL copy-to-clipboard.
  const copyPortalUrl = async () => {
    const url = (form.portal_url || doc.portal_url || '').trim();
    if (!url) { toast.error('No Portal URL to copy'); return; }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Copied!', { duration: 2000 });
    } catch (_e) {
      // Legacy fallback for browsers that don't expose the async API.
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
      toast.success('Copied!', { duration: 2000 });
    }
  };

  // v58.13.132ds — Staff Login URL copy-to-clipboard. Same pattern as
  // Portal URL. The URL itself is READ-ONLY (server-computed from
  // PUBLIC_APP_URL); Emergent controls the value so admins can only
  // copy it, never edit.
  const copyStaffLoginUrl = async () => {
    const url = (doc.staff_login_url || '').trim();
    if (!url) { toast.error('No Staff Login URL to copy'); return; }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Copied!', { duration: 2000 });
    } catch (_e) {
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
      toast.success('Copied!', { duration: 2000 });
    }
  };

  // v58.13.132dq — Email Certificates popup state.
  const [emailOpen, setEmailOpen] = useState(false);

  if (!doc) return <div className="text-sm text-slate-500">Loading…</div>;

  const insStatus = doc.insurance_status || {};
  const warnings = insStatus.warnings || [];
  const criticals = insStatus.criticals || [];

  return (
    <div className="max-w-3xl mx-auto" data-testid="org-settings-page">
      <PageHeader
        crumb="Settings / Organisation"
        title="Organisation"
        subtitle="The legal entity behind your account. Appears on PDF reports, audit exports and renewal emails."
        action={isAdmin ? (
          <PrimaryButton onClick={trySave} busy={busy} testid="org-save-btn">
            <Save size={14} /> Save changes
          </PrimaryButton>
        ) : null}
      />

      {!isAdmin && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900" data-testid="org-readonly-banner">
          Read-only — contact your administrator to edit organisation details.
        </div>
      )}

      {/* v58.13.132ep — Quick Links repositioned to ABOVE the
          Organisation section per user request. Was previously at the
          bottom of the page (below Archive rules). Admin-gated. */}
      {isAdmin && <QuickLinksSection />}

      {/* v58.13.132dp — 30-day insurance expiry warnings + 7-day
          criticals surfaced above the form. AppShell mounts a
          separate one-time-per-session modal for critical status. */}
      {(warnings.length > 0 || criticals.length > 0) && (
        <div className="mb-4 space-y-2" data-testid="org-insurance-alerts">
          {criticals.map((c) => (
            <div key={c.policy}
                 data-testid={`org-insurance-critical-${c.policy}`}
                 className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">{c.label}</span> {c.days < 0
                  ? `expired ${Math.abs(c.days)} days ago`
                  : `expires in ${c.days} day${c.days === 1 ? '' : 's'}`}
                {' '}— renew now.
              </div>
            </div>
          ))}
          {warnings.map((w) => (
            <div key={w.policy}
                 data-testid={`org-insurance-warning-${w.policy}`}
                 className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">{w.label}</span> expires in {w.days} days — renew soon.
              </div>
            </div>
          ))}
        </div>
      )}

      {/* v58.13.132dp — Emphasis banner (Item 5). Replaces the
          plain-text `PageHeader` subtitle for a stronger visual
          statement now that this page carries insurance + emergency
          contact data. */}
      <div
        data-testid="org-importance-banner"
        className="mb-4 relative rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-white px-5 py-4 flex items-start gap-3 shadow-md ring-1 ring-emerald-100"
      >
        <span
          data-testid="org-importance-chip"
          className="absolute -top-2.5 right-4 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-emerald-600 text-white shadow-md ring-2 ring-white"
        >
          <Info size={11} /> Important
        </span>
        <div className="text-sm text-slate-700 leading-relaxed pt-1">
          This information appears on <span className="font-semibold text-emerald-800">PDF reports</span>,{' '}
          <span className="font-semibold text-emerald-800">audit exports</span>,{' '}
          <span className="font-semibold text-emerald-800">renewal emails</span> and the{' '}
          <span className="font-semibold text-emerald-800">public portal footer</span>.
          Keep insurance policy numbers and expiry dates up to date to avoid site access issues.
        </div>
      </div>

      <div className="space-y-4">
        {/* Identity */}
        <Section icon={<Building2 size={14} className="text-emerald-600" />} title="Identity" elevated>
          <div className="grid sm:grid-cols-2 gap-3">
            {IDENTITY.map((f) => (
              <Field key={f.key} label={f.label} required={f.required}>
                <input
                  className={inputClass}
                  value={form[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  disabled={!isAdmin}
                  data-testid={`org-field-${f.key}`}
                />
              </Field>
            ))}
            <Field label="Slug"
                   hint="Used in mobile deep links, renewal email URLs, and audit export handles. Editing shows a confirm dialog with affected surfaces.">
              <input
                className={inputClass + (isAdmin ? '' : ' bg-slate-50')}
                value={form.slug || ''}
                onChange={(e) => set('slug', e.target.value)}
                placeholder="paneltec-civil"
                disabled={!isAdmin}
                data-testid="org-field-slug"
              />
              {(doc.previous_slugs || []).length > 0 && (
                <div className="mt-1 text-[11px] text-slate-500" data-testid="org-previous-slugs">
                  Previous:{' '}
                  {(doc.previous_slugs || []).map((s) => (
                    <span key={s} className="inline-block px-1.5 py-0.5 mr-1 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">{s}</span>
                  ))}
                </div>
              )}
            </Field>
            <Field label="Timezone">
              <select
                className={inputClass}
                value={form.timezone || 'Australia/Sydney'}
                onChange={(e) => set('timezone', e.target.value)}
                disabled={!isAdmin}
                data-testid="org-field-timezone"
              >
                {['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Adelaide', 'Australia/Hobart', 'Australia/Darwin'].map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        {/* Address */}
        <Section icon={<MapPin size={14} className="text-emerald-600" />} title="Registered address" elevated>
          <div className="grid sm:grid-cols-2 gap-3">
            {ADDRESS.map((f) => (
              <Field key={f.key} label={f.label}>
                <input
                  className={inputClass}
                  value={form[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  disabled={!isAdmin}
                  data-testid={`org-field-${f.key}`}
                />
              </Field>
            ))}
          </div>
        </Section>

        {/* Contact */}
        <Section icon={<Phone size={14} className="text-emerald-600" />} title="Contact & emergency" elevated>
          <div className="grid sm:grid-cols-2 gap-3">
            {CONTACT.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <input
                  type={f.type || 'text'}
                  className={inputClass}
                  value={form[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  disabled={!isAdmin}
                  data-testid={`org-field-${f.key}`}
                />
              </Field>
            ))}
          </div>
        </Section>

        {/* PDF branding */}
        <Section icon={<Globe size={14} className="text-emerald-600" />} title="PDF report branding" elevated>
          <div className="grid sm:grid-cols-2 gap-3">
            {/* v58.13.132dq — Portal URL rendered inline with a
                copy-to-clipboard square button. Hover / press states
                give the click a tactile feel. */}
            <Field label="Portal URL"
                   hint="Rendered on the footer of every PDF report so recipients can find the login.">
              <div className="flex items-stretch gap-2">
                <input
                  className={inputClass + ' flex-1'}
                  value={form.portal_url || ''}
                  onChange={(e) => set('portal_url', e.target.value)}
                  placeholder="https://portal.paneltec.com.au"
                  disabled={!isAdmin}
                  data-testid="org-field-portal_url"
                />
                <button
                  type="button"
                  onClick={copyPortalUrl}
                  data-testid="org-portal-url-copy-btn"
                  aria-label="Copy Portal URL"
                  className="w-10 shrink-0 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 active:scale-95 active:bg-emerald-100 transition"
                >
                  <Copy size={14} />
                </button>
              </div>
            </Field>
            {/* v58.13.132ds — Staff Login URL. Read-only, server-
                computed from PUBLIC_APP_URL. Distinct from Portal URL
                (which lands on public PDF footers); Staff Login is
                the internal sign-in URL shared with office staff. */}
            <Field label="Staff Login URL"
                   hint="This is your active login portal — share this URL with office staff so they can access the app. Once your production domain is live, use Portal URL for public-facing PDF reports.">
              <div className="flex items-stretch gap-2">
                <input
                  className={inputClass + ' flex-1 bg-slate-50 text-slate-700 cursor-not-allowed'}
                  value={doc.staff_login_url || ''}
                  readOnly
                  disabled
                  data-testid="org-field-staff_login_url"
                  title="Emergent-managed — read-only"
                />
                <button
                  type="button"
                  onClick={copyStaffLoginUrl}
                  data-testid="org-staff-login-url-copy-btn"
                  aria-label="Copy Staff Login URL"
                  className="w-10 shrink-0 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 active:scale-95 active:bg-emerald-100 transition"
                >
                  <Copy size={14} />
                </button>
              </div>
            </Field>
            {BRANDING.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <input
                  className={inputClass}
                  value={form[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  disabled={!isAdmin}
                  data-testid={`org-field-${f.key}`}
                />
              </Field>
            ))}
            <Field label="Company logo"
                   hint="PNG or JPG. Renders top-left of every PDF report. Stored in GridFS.">
              <div className="flex items-center gap-3">
                {doc.logo_url && (
                  <img src={doc.logo_url} alt="Logo" className="h-10 w-auto rounded border border-slate-200 bg-white" />
                )}
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-slate-700"
                       data-testid="org-logo-upload-btn">
                  <UploadCloud size={12} />
                  {uploading.logo ? 'Uploading…' : (doc.logo_url ? 'Replace' : 'Upload')}
                  <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp"
                         disabled={!isAdmin || uploading.logo}
                         onChange={(e) => uploadFile('/org/logo/upload', e.target.files?.[0], 'logo')} />
                </label>
              </div>
            </Field>
          </div>
        </Section>

        {/* Insurance */}
        <Section
          icon={<Shield size={14} className="text-emerald-600" />}
          title="Insurance policies"
          elevated
          headerRight={isAdmin ? (
            <button
              type="button"
              onClick={() => setEmailOpen(true)}
              data-testid="org-email-certs-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
            >
              <Mail size={12} /> Email Certificates
            </button>
          ) : null}
        >
          <p className="text-xs text-slate-500 mb-3">
            Policy expiries drive the 30-day banner above and the 7-day critical alert. All three
            certificate types are stored in GridFS — new uploads archive the previous version into
            "Past certificates" (never deleted, for audit compliance).
          </p>
          <InsuranceBlock kind="public_liability" label="Public liability insurance"
            form={form} doc={doc} isAdmin={isAdmin} setInsurance={setInsurance}
            uploadFile={uploadFile} uploading={uploading} />
          <div className="mt-4">
            <InsuranceBlock kind="workers_comp" label="Workers compensation insurance"
              form={form} doc={doc} isAdmin={isAdmin} setInsurance={setInsurance}
              uploadFile={uploadFile} uploading={uploading} />
          </div>
          <div className="mt-4">
            <InsuranceBlock kind="general_cover" label="General cover insurance"
              form={form} doc={doc} isAdmin={isAdmin} setInsurance={setInsurance}
              uploadFile={uploadFile} uploading={uploading} />
          </div>
          <div className="mt-4">
            <InsuranceBlock kind="professional_indemnity" label="Professional indemnity insurance"
              form={form} doc={doc} isAdmin={isAdmin} setInsurance={setInsurance}
              uploadFile={uploadFile} uploading={uploading} />
          </div>
          {isAdmin && <EmailAuditLog />}
        </Section>

        {isAdmin && (
          <div className="flex justify-end">
            <PrimaryButton onClick={trySave} busy={busy} testid="org-save-btn-bottom">
              <Save size={14} /> Save changes
            </PrimaryButton>
          </div>
        )}
      </div>

      {/* v58.13.132dp — Slug confirm dialog. Blocks save until admin
          acknowledges the affected surfaces. */}
      {confirmSlug && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center px-4"
          data-testid="org-slug-confirm-modal"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Change organisation slug?
            </h3>
            <p className="text-sm text-slate-700 mb-3">
              Renaming <span className="font-mono px-1.5 py-0.5 rounded bg-slate-100">{confirmSlug.oldSlug || '—'}</span>{' '}
              → <span className="font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">{confirmSlug.newSlug}</span> will affect:
            </p>
            <ul className="text-xs text-slate-600 list-disc pl-5 space-y-1 mb-4" data-testid="org-slug-surfaces">
              {slugAffectedSurfaces.map((s) => <li key={s}>{s}</li>)}
            </ul>
            <p className="text-[11px] text-slate-500 mb-4">
              Existing audit exports keep their old filenames. Old slug preserved in <code>previous_slugs</code> for backward-compat lookups.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSlug(null)}
                data-testid="org-slug-confirm-cancel"
                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700"
              >Cancel</button>
              <button
                type="button"
                onClick={doSave}
                disabled={busy}
                data-testid="org-slug-confirm-continue"
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >{busy ? 'Saving…' : 'Continue'}</button>
            </div>
          </div>
        </div>
      )}
      {/* v58.13.132dq — Insurance Certificates dispatch popup. */}
      {emailOpen && (
        <InsuranceEmailModal
          doc={doc}
          orgName={doc.name || 'Paneltec Civil'}
          defaultPreamble={form.insurance_email_preamble || ''}
          onClose={() => setEmailOpen(false)}
          onSent={() => { setEmailOpen(false); load(); }}
        />
      )}
      {/* v58.13.132ed — Admin-only auto-archive rules surface. Renders
          the 7-row table (one per CAPTURE module) with enable/days
          controls that feed the nightly APScheduler job. */}
      {isAdmin && <ArchiveRulesSection />}
    </div>
  );
}

// v58.13.132dw — Typed-confirm dialog for the Purge action. Submit
// is disabled until the input reads exactly "PURGE". Handles both
// per-row and bulk-purge callers by inspecting `target.bulk`.
function PurgeConfirmDialog({ kind, target, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('');
  const armed = typed === 'PURGE';
  const bulk = !!target?.bulk;
  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4"
      data-testid={`org-insurance-history-purge-confirm-${kind}`}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 ring-4 ring-red-200 border-2 border-red-300">
        <h3 className="font-display font-semibold text-lg mb-2 flex items-center gap-2 text-red-800">
          <AlertTriangle size={18} className="text-red-600" />
          Permanently purge {bulk ? `${target.count} certificate${target.count === 1 ? '' : 's'}` : 'certificate'}?
        </h3>
        <p className="text-sm text-slate-700 mb-3">
          This will remove {bulk ? 'these rows' : 'the row'} from Mongo. The underlying file
          {bulk ? 's are' : ' is'} preserved in GridFS for audit compliance but will no longer
          be accessible via the UI. This action cannot be undone from the UI.
        </p>
        {!bulk && (
          <div className="text-[11px] text-slate-500 mb-3 font-mono truncate">
            {target.row.certificate_filename || target.row.certificate_id}
          </div>
        )}
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
          Type PURGE to confirm
        </label>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          data-testid={`org-insurance-history-purge-typed-${kind}`}
          autoFocus
          className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400"
          placeholder="PURGE"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
                  data-testid={`org-insurance-history-purge-cancel-${kind}`}
                  className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={!armed}
                  data-testid={`org-insurance-history-purge-submit-${kind}`}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
            Purge
          </button>
        </div>
      </div>
    </div>
  );
}



function InsuranceBlock({ kind, label, form, doc, isAdmin, setInsurance, uploadFile, uploading }) {
  const block = doc[`${kind}_insurance`] || {};
  const status = (doc.insurance_status || {})[kind] || {};
  const level = status.level;
  const days = status.days_until_expiry;
  // v58.13.132ds — Past-certs list now sourced from the API so the
  // Show-deleted toggle can flip include_deleted for soft-deleted
  // archive entries. Cached in local state; refetched when the
  // toggle flips or after a delete/undelete round-trip.
  const [showArchive, setShowArchive] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [archived, setArchived] = useState(block.previous_certificates || []);
  const [confirmDel, setConfirmDel] = useState(null); // certificate row pending confirm
  const loadHistory = React.useCallback(async () => {
    try {
      const params = showDeleted ? { include_deleted: true } : {};
      const { data } = await api.get(`/org/insurance/${kind}/history`, { params });
      setArchived(data?.items || []);
    } catch (_e) {
      setArchived(block.previous_certificates || []);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, showDeleted]);
  React.useEffect(() => { loadHistory(); }, [loadHistory]);
  const doDelete = async (row) => {
    try {
      await api.delete(`/org/insurance/${kind}/history/${row.certificate_id}`);
      toast.success('Certificate hidden from view');
      setConfirmDel(null);
      loadHistory();
    } catch (e) { toast.error(apiError(e)); }
  };
  const doUndelete = async (row) => {
    try {
      await api.post(`/org/insurance/${kind}/history/${row.certificate_id}/undelete`);
      toast.success('Certificate restored');
      loadHistory();
    } catch (e) { toast.error(apiError(e)); }
  };
  // v58.13.132dw — Purge (permanent Mongo-row removal). Requires the
  // row to be soft-deleted first (409 otherwise) and a typed
  // confirm of "PURGE" — enforced by <PurgeConfirmDialog>. GridFS
  // blob is preserved regardless.
  const [confirmPurge, setConfirmPurge] = useState(null); // { row } | { bulk: true, count }
  const doPurge = async (row) => {
    try {
      await api.post(`/org/insurance/${kind}/history/${row.certificate_id}/purge`);
      toast.success('Certificate row purged (GridFS blob preserved)');
      setConfirmPurge(null);
      loadHistory();
    } catch (e) { toast.error(apiError(e)); }
  };
  const doPurgeAll = async () => {
    try {
      const { data } = await api.post(`/org/insurance/${kind}/history/purge-all-deleted`);
      const n = data?.purged || 0;
      toast.success(`Purged ${n} soft-deleted row${n === 1 ? '' : 's'} (GridFS blobs preserved)`);
      setConfirmPurge(null);
      loadHistory();
    } catch (e) { toast.error(apiError(e)); }
  };
  // v58.13.132dq — Icon per policy kind. Distinct glyph + accent tone
  // per slot so the four blocks read differently at a glance while
  // staying on the emerald/violet family.
  const kindStyle = {
    public_liability:       { Icon: Shield,      cls: 'text-emerald-600' },
    workers_comp:           { Icon: ShieldCheck, cls: 'text-sky-600' },
    general_cover:          { Icon: Shield,      cls: 'text-violet-600' },
    professional_indemnity: { Icon: Award,       cls: 'text-amber-600' },
  }[kind] || { Icon: Shield, cls: 'text-emerald-600' };
  const KindIcon = kindStyle.Icon;
  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50" data-testid={`org-insurance-block-${kind}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm text-slate-800 flex items-center gap-2">
          <KindIcon size={14} className={kindStyle.cls} /> {label}
        </div>
        {level && level !== 'ok' && days != null && (
          <span
            data-testid={`org-insurance-status-${kind}`}
            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
              level === 'critical'
                ? 'bg-red-100 text-red-800 border border-red-200'
                : 'bg-amber-100 text-amber-800 border border-amber-200'
            }`}
          >
            {days < 0 ? `Expired ${Math.abs(days)}d ago` : `${days}d left`}
          </span>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Policy number">
          <input
            className={inputClass}
            value={(form[`${kind}_insurance`] || {}).policy_number || ''}
            onChange={(e) => setInsurance(kind, 'policy_number', e.target.value)}
            disabled={!isAdmin}
            data-testid={`org-field-${kind}-policy-number`}
          />
        </Field>
        <Field label="Expiry date">
          <input
            type="date"
            className={inputClass}
            value={(form[`${kind}_insurance`] || {}).expiry_date || ''}
            onChange={(e) => setInsurance(kind, 'expiry_date', e.target.value)}
            disabled={!isAdmin}
            data-testid={`org-field-${kind}-expiry-date`}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs">
        <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-slate-700"
               data-testid={`org-insurance-upload-${kind}`}>
          <UploadCloud size={12} />
          {uploading[kind] ? 'Uploading…' : (block.certificate_id ? 'Replace certificate' : 'Upload certificate')}
          <input type="file" className="hidden" accept="application/pdf"
                 disabled={!isAdmin || uploading[kind]}
                 onChange={(e) => uploadFile(`/org/insurance/${kind}/upload`, e.target.files?.[0], kind)} />
        </label>
        {block.certificate_id && (
          <a
            href={`${(process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '')}/api/org/insurance/${kind}/download`}
            target="_blank"
            rel="noreferrer noopener"
            data-testid={`org-insurance-download-${kind}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-slate-700"
          >
            <Download size={12} /> {block.certificate_filename || 'View PDF'}
          </a>
        )}
      </div>
      {/* v58.13.132dq — Past certificates archive. Collapsible so the
          block stays compact when nothing has been archived. Uploads
          always archive the previous cert (never delete from GridFS)
          so this section grows over time for audit compliance.
          v58.13.132ds — Adds per-row soft-delete + Show-deleted
          toggle. GridFS files never physically deleted. */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowArchive((v) => !v)}
            data-testid={`org-insurance-history-toggle-${kind}`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700"
          >
            {showArchive ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Past certificates ({archived.filter((r) => !r.deleted_at).length})
          </button>
          {showArchive && isAdmin && (
            <label
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none"
              data-testid={`org-insurance-history-show-deleted-${kind}`}
            >
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(e) => setShowDeleted(e.target.checked)}
                className="h-3 w-3"
              />
              Show deleted
            </label>
          )}
          {/* v58.13.132dw — Bulk-purge pill. Only surfaces when
              Show deleted is ON AND at least one soft-deleted row
              exists. Guarded by typed-confirm modal. */}
          {showArchive && isAdmin && showDeleted && (() => {
            const nDeleted = archived.filter((r) => r.deleted_at).length;
            if (nDeleted === 0) return null;
            return (
              <button
                type="button"
                onClick={() => setConfirmPurge({ bulk: true, count: nDeleted })}
                data-testid={`org-insurance-history-purge-all-${kind}`}
                title="Permanently remove all soft-deleted rows from Mongo (GridFS blobs preserved)"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border border-red-300 bg-white text-red-700 hover:bg-red-600 hover:text-white hover:border-red-600"
              >
                <Trash2 size={10} /> Purge all {nDeleted} soft-deleted
              </button>
            );
          })()}
        </div>
        {showArchive && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-white" data-testid={`org-insurance-history-${kind}`}>
            {archived.length === 0 ? (
              <div className="text-[11px] text-slate-400 italic px-3 py-2">
                No archived certificates yet. Uploading a replacement will move the current one here.
              </div>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-semibold">Uploaded</th>
                    <th className="text-left px-2 py-1.5 font-semibold">Policy #</th>
                    <th className="text-left px-2 py-1.5 font-semibold">Expiry</th>
                    <th className="text-left px-2 py-1.5 font-semibold">File</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {archived.map((row) => {
                    const deleted = !!row.deleted_at;
                    return (
                    <tr
                      key={row.certificate_id}
                      className={`border-t border-slate-100 ${deleted ? 'text-slate-400' : ''}`}
                      data-testid={`org-insurance-history-row-${row.certificate_id}`}
                    >
                      <td className={`px-2 py-1.5 font-mono ${deleted ? 'line-through' : ''}`}>
                        {(row.uploaded_at || row.archived_at || '').slice(0, 10)}
                      </td>
                      <td className={`px-2 py-1.5 ${deleted ? 'line-through' : ''}`}>{row.policy_number || '—'}</td>
                      <td className={`px-2 py-1.5 ${deleted ? 'line-through' : ''}`}>{row.expiry_date || '—'}</td>
                      <td className={`px-2 py-1.5 truncate max-w-[200px] ${deleted ? 'line-through' : ''}`}>
                        {row.certificate_filename || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <a
                            href={`${(process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '')}/api/org/insurance/${kind}/history/${row.certificate_id}/download`}
                            target="_blank"
                            rel="noreferrer noopener"
                            data-testid={`org-insurance-history-download-${row.certificate_id}`}
                            className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900"
                          >
                            <Download size={11} /> Download
                          </a>
                          {isAdmin && !deleted && (
                            <button
                              type="button"
                              onClick={() => setConfirmDel(row)}
                              data-testid={`org-insurance-history-delete-${row.certificate_id}`}
                              aria-label="Delete certificate"
                              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                              title="Hide from view (soft-delete)"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                          {isAdmin && deleted && (
                            <button
                              type="button"
                              onClick={() => doUndelete(row)}
                              data-testid={`org-insurance-history-undelete-${row.certificate_id}`}
                              aria-label="Undelete certificate"
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 px-1.5 py-0.5 rounded hover:bg-emerald-50"
                              title="Restore this certificate to the visible list"
                            >
                              <RotateCcw size={11} /> Undelete
                            </button>
                          )}
                          {isAdmin && deleted && (
                            <button
                              type="button"
                              onClick={() => setConfirmPurge({ row })}
                              data-testid={`org-insurance-history-purge-${row.certificate_id}`}
                              aria-label="Purge certificate"
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 hover:text-white hover:bg-red-600 border border-red-300 px-1.5 py-0.5 rounded"
                              title="Permanently remove this row from Mongo (GridFS blob preserved)"
                            >
                              <Trash2 size={11} /> Purge
                            </button>
                          )}
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
      </div>
      {confirmDel && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" data-testid={`org-insurance-history-confirm-${kind}`}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Delete this certificate?
            </h3>
            <p className="text-sm text-slate-700 mb-4">
              Are you sure you want to delete this past certificate? It will be hidden from view but preserved in the audit trail. Continue?
            </p>
            <div className="text-[11px] text-slate-500 mb-4 font-mono truncate">
              {confirmDel.certificate_filename || confirmDel.certificate_id}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDel(null)}
                data-testid={`org-insurance-history-confirm-cancel-${kind}`}
                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700"
              >Cancel</button>
              <button
                type="button"
                onClick={() => doDelete(confirmDel)}
                data-testid={`org-insurance-history-confirm-delete-${kind}`}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
              >Delete</button>
            </div>
          </div>
        </div>
      )}
      {/* v58.13.132dw — Typed-confirm purge dialog. Fires for both
          per-row Purge and Purge-all-soft-deleted. Submit disabled
          until the user types exactly "PURGE". */}
      {confirmPurge && (
        <PurgeConfirmDialog
          kind={kind}
          target={confirmPurge}
          onCancel={() => setConfirmPurge(null)}
          onConfirm={() => {
            if (confirmPurge.bulk) doPurgeAll();
            else doPurge(confirmPurge.row);
          }}
        />
      )}
    </div>
  );
}

function Section({ icon, title, children, elevated, headerRight }) {
  return (
    <div className={`rounded-2xl border p-5 ${
      elevated
        ? 'border-emerald-200 shadow-md ring-2 ring-emerald-100 bg-gradient-to-br from-emerald-50/40 via-white to-white'
        : 'border-slate-200 bg-white'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold flex items-center gap-2">{icon} {title}</h3>
        {headerRight}
      </div>
      {children}
    </div>
  );
}

// ─── v58.13.132dq — Insurance Certificates dispatch modal ────────

function InsuranceEmailModal({ doc, orgName, defaultPreamble, onClose, onSent }) {
  const [recipients, setRecipients] = useState([]);
  const [customRecipient, setCustomRecipient] = useState('');
  const [certificateTypes, setCertificateTypes] = useState([]);
  const [archivedSelections, setArchivedSelections] = useState({});
  const [subject, setSubject] = useState(`${orgName} — Insurance Certificates`);
  const [preamble, setPreamble] = useState(
    defaultPreamble
    || `Please find attached our current insurance certificates. Please retain these for your records.\n\nKind regards,\n${orgName}`,
  );
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  // Simpro customer picker
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [simproConnected, setSimproConnected] = useState(true);
  // v58.13.132dv — Inline delete state. `hiddenCerts[kind]` tracks
  // certificate_ids that were soft-deleted from within this popup,
  // so the row disappears immediately without needing a full doc
  // refetch (parent `doc` prop is refreshed only on modal close). A
  // confirm modal fires before every delete; a "Clear all archived"
  // confirm fires before the bulk endpoint.
  const [hiddenCerts, setHiddenCerts] = useState({});
  const [confirmDelCert, setConfirmDelCert] = useState(null); // {kind, row}
  const [confirmClearKind, setConfirmClearKind] = useState(null); // kind

  useEffect(() => {
    if (search.length < 2) { setSuggestions([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/integrations/simpro/customers/search',
          { params: { q: search, limit: 15 } });
        if (cancelled) return;
        setSuggestions(data?.items || []);
        setSimproConnected(data?.connected !== false);
      } catch (_e) {
        if (cancelled) return;
        setSuggestions([]);
        setSimproConnected(false);
      } finally { if (!cancelled) setSearching(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  const kinds = [
    { kind: 'public_liability',       label: 'Public liability' },
    { kind: 'workers_comp',           label: 'Workers compensation' },
    { kind: 'general_cover',          label: 'General cover' },
    { kind: 'professional_indemnity', label: 'Professional indemnity' },
  ];

  const addRecipient = (email, meta) => {
    const clean = (email || '').trim();
    if (!clean) return;
    if (recipients.some((r) => r.email === clean)) return;
    setRecipients((rs) => [...rs, { email: clean, ...(meta || {}) }]);
    setCustomRecipient('');
    setSearch('');
    setSuggestions([]);
  };
  const removeRecipient = (email) =>
    setRecipients((rs) => rs.filter((r) => r.email !== email));

  const toggleKind = (kind) => setCertificateTypes((ks) =>
    ks.includes(kind) ? ks.filter((k) => k !== kind) : [...ks, kind]);
  const toggleArchived = (kind, fileId) => setArchivedSelections((a) => {
    const cur = a[kind] || [];
    return { ...a, [kind]: cur.includes(fileId) ? cur.filter((f) => f !== fileId) : [...cur, fileId] };
  });

  // v58.13.132dv — Inline soft-delete of an archived certificate row.
  // Wired to the .132ds DELETE endpoint. On success, hide the row
  // locally so the popup reflects the change immediately + drop the
  // certificate_id from any selection state that referenced it.
  const doDeleteArchived = async (kind, row) => {
    try {
      await api.delete(`/org/insurance/${kind}/history/${row.certificate_id}`);
      setHiddenCerts((h) => ({
        ...h,
        [kind]: [...(h[kind] || []), row.certificate_id],
      }));
      setArchivedSelections((a) => ({
        ...a,
        [kind]: (a[kind] || []).filter((f) => f !== row.certificate_id),
      }));
      toast.success('Certificate hidden from view');
      setConfirmDelCert(null);
    } catch (e) { toast.error(apiError(e)); }
  };
  const doClearAllArchived = async (kind) => {
    try {
      const { data } = await api.post(`/org/insurance/${kind}/history/clear-all`);
      const n = data?.cleared || 0;
      // Snap ALL archived rows for this kind into the hidden set.
      const allIds = ((doc[`${kind}_insurance`] || {}).previous_certificates || [])
        .map((r) => r.certificate_id);
      setHiddenCerts((h) => ({ ...h, [kind]: [...(h[kind] || []), ...allIds] }));
      setArchivedSelections((a) => ({ ...a, [kind]: [] }));
      toast.success(`Cleared ${n} archived certificate${n === 1 ? '' : 's'}`);
      setConfirmClearKind(null);
    } catch (e) { toast.error(apiError(e)); }
  };

  const send = async () => {
    if (recipients.length === 0) { toast.error('Add at least one recipient'); return; }
    const anyArchived = Object.values(archivedSelections).some((a) => (a || []).length > 0);
    if (certificateTypes.length === 0 && !anyArchived) {
      toast.error('Pick at least one certificate to attach');
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post('/org/insurance/email', {
        recipients: recipients.map((r) => r.email),
        certificate_types: certificateTypes,
        archived_certificate_ids: archivedSelections,
        subject,
        preamble,
        note: note || null,
      });
      if (data?.mocked) {
        toast.warning('MOCKED — no email sent (Microsoft 365 not configured).', { duration: 4500 });
      } else if (data?.ok) {
        toast.success(`Sent to ${data.sent_to.length} recipient(s).`);
      } else {
        toast.error(data?.error || 'Send failed');
      }
      onSent?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally { setSending(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center px-4"
      data-testid="insurance-email-modal"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto ring-4 ring-emerald-200 border-2 border-emerald-300">
        <div className="sticky top-0 bg-gradient-to-r from-emerald-100 via-emerald-50 to-white border-b-2 border-emerald-200 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-emerald-600" />
            <div>
              <div className="font-display font-semibold text-sm">Insurance Certificates Distribution</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Admin only</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="insurance-email-close">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-5">
          {/* Recipient picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Recipients</label>
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2" data-testid="insurance-email-recipients">
                {recipients.map((r) => (
                  <span key={r.email} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-200">
                    {r.company_name ? `${r.company_name} · ` : ''}{r.email}
                    <button type="button" onClick={() => removeRecipient(r.email)} className="ml-1 text-emerald-700 hover:text-emerald-900">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                className={inputClass}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Simpro customers…"
                data-testid="insurance-email-simpro-search"
              />
              {suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg" data-testid="insurance-email-simpro-suggestions">
                  {suggestions.map((s) => (
                    <button
                      key={s.simpro_customer_id + s.email}
                      type="button"
                      onClick={() => addRecipient(s.email, { company_name: s.company_name })}
                      disabled={!s.email}
                      data-testid={`insurance-email-simpro-option-${s.simpro_customer_id}`}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-emerald-50 flex justify-between items-center ${
                        s.email ? '' : 'opacity-40 cursor-not-allowed'
                      }`}
                    >
                      <span className="font-semibold text-slate-800 truncate">{s.company_name || s.contact_name || '(unnamed)'}</span>
                      <span className="text-slate-500 text-[11px] ml-2 shrink-0">{s.email || 'no email'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {searching && <div className="text-[10px] text-slate-400 mt-1">Searching…</div>}
            {!simproConnected && (
              <div className="text-[11px] text-amber-800 mt-1">
                Simpro customer picker unavailable — use the custom recipient field below.
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <input
                className={inputClass + ' flex-1'}
                value={customRecipient}
                onChange={(e) => setCustomRecipient(e.target.value)}
                placeholder="Or enter a custom email address"
                type="email"
                data-testid="insurance-email-custom-recipient"
              />
              <button type="button" onClick={() => addRecipient(customRecipient)}
                      data-testid="insurance-email-custom-add"
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700">
                Add
              </button>
            </div>
          </div>

          {/* Certificate picker (current + archived)
              v58.13.132dv — Archived rows now filter out soft-deleted
              entries (both from prior `deleted_at` stamps and from
              this session's `hiddenCerts` state). Each archived row
              gets an inline trash button; the section header shows
              a "Clear all archived (N)" pill when N > 0. */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Certificates to attach</label>
            <div className="space-y-3">
              {kinds.map(({ kind, label }) => {
                const block = doc[`${kind}_insurance`] || {};
                const hasCurrent = !!block.certificate_id;
                const rawArchived = block.previous_certificates || [];
                const hiddenSet = new Set(hiddenCerts[kind] || []);
                const archived = rawArchived.filter(
                  (a) => !a.deleted_at && !hiddenSet.has(a.certificate_id),
                );
                return (
                  <div key={kind} className="rounded-lg border border-slate-200 p-3 bg-slate-50/50" data-testid={`insurance-email-cert-block-${kind}`}>
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={certificateTypes.includes(kind)}
                          onChange={() => toggleKind(kind)}
                          disabled={!hasCurrent}
                          data-testid={`insurance-email-cert-${kind}`}
                        />
                        <span className={hasCurrent ? '' : 'text-slate-400'}>{label}</span>
                        {!hasCurrent && <span className="text-[10px] uppercase tracking-wider text-slate-400 ml-1">No certificate uploaded</span>}
                      </label>
                      {archived.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmClearKind(kind)}
                          data-testid={`insurance-email-clear-archived-${kind}`}
                          title={`Soft-delete all ${archived.length} archived certificate(s) for ${label}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border border-red-200 bg-white text-red-700 hover:bg-red-50 hover:border-red-300"
                        >
                          <Trash2 size={10} /> Clear all archived ({archived.length})
                        </button>
                      )}
                    </div>
                    {archived.length > 0 && (
                      <div className="mt-1.5 ml-5 space-y-1 text-[11px] text-slate-600">
                        {archived.map((a) => (
                          <div key={a.certificate_id} className="flex items-center gap-1.5" data-testid={`insurance-email-arch-row-${a.certificate_id}`}>
                            <input
                              type="checkbox"
                              checked={(archivedSelections[kind] || []).includes(a.certificate_id)}
                              onChange={() => toggleArchived(kind, a.certificate_id)}
                              data-testid={`insurance-email-arch-${a.certificate_id}`}
                            />
                            <span className="flex-1 truncate">Archived {(a.uploaded_at || '').slice(0,10)} — {a.certificate_filename || '(no filename)'}</span>
                            <button
                              type="button"
                              onClick={() => setConfirmDelCert({ kind, row: a })}
                              data-testid={`insurance-email-arch-delete-${a.certificate_id}`}
                              aria-label="Delete archived certificate"
                              title="Hide from view (soft-delete, preserves audit)"
                              className="inline-flex items-center justify-center w-5 h-5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* v58.13.132dv — Per-row soft-delete confirm. */}
          {confirmDelCert && (
            <div className="fixed inset-0 z-[60] bg-slate-900/40 flex items-center justify-center p-4" data-testid="insurance-email-arch-delete-confirm">
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                <h3 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-500" /> Delete this certificate?
                </h3>
                <p className="text-sm text-slate-700 mb-4">
                  Are you sure you want to delete this past certificate? It will be hidden from view but preserved in the audit trail. Continue?
                </p>
                <div className="text-[11px] text-slate-500 mb-4 font-mono truncate">
                  {confirmDelCert.row.certificate_filename || confirmDelCert.row.certificate_id}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmDelCert(null)}
                          data-testid="insurance-email-arch-delete-cancel"
                          className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700">Cancel</button>
                  <button type="button" onClick={() => doDeleteArchived(confirmDelCert.kind, confirmDelCert.row)}
                          data-testid="insurance-email-arch-delete-ok"
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
                </div>
              </div>
            </div>
          )}

          {/* v58.13.132dv — Bulk clear-all-archived confirm. */}
          {confirmClearKind && (() => {
            const kind = confirmClearKind;
            const block = doc[`${kind}_insurance`] || {};
            const rawArchived = block.previous_certificates || [];
            const hiddenSet = new Set(hiddenCerts[kind] || []);
            const visible = rawArchived.filter(
              (a) => !a.deleted_at && !hiddenSet.has(a.certificate_id),
            ).length;
            const label = (kinds.find((k) => k.kind === kind) || {}).label || kind;
            return (
              <div className="fixed inset-0 z-[60] bg-slate-900/40 flex items-center justify-center p-4" data-testid="insurance-email-clear-archived-confirm">
                <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                  <h3 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-500" /> Delete all archived?
                  </h3>
                  <p className="text-sm text-slate-700 mb-4">
                    Delete all {visible} archived certificate{visible === 1 ? '' : 's'} for {label}?
                    They will be hidden from view but preserved in the audit trail. Continue?
                  </p>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setConfirmClearKind(null)}
                            data-testid="insurance-email-clear-archived-cancel"
                            className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700">Cancel</button>
                    <button type="button" onClick={() => doClearAllArchived(kind)}
                            data-testid="insurance-email-clear-archived-ok"
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700">Delete all</button>
                  </div>
                </div>
              </div>
            );
          })()}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Subject</label>
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)}
                   data-testid="insurance-email-subject" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Preamble template</label>
            <textarea className={inputClass + ' min-h-[80px]'} value={preamble}
                      onChange={(e) => setPreamble(e.target.value)}
                      data-testid="insurance-email-preamble"/>
            <div className="text-[10px] text-slate-400 mt-1">
              This template is stored on the org so future sends default to it.
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Per-email note (optional)</label>
            <textarea className={inputClass + ' min-h-[50px]'} value={note}
                      onChange={(e) => setNote(e.target.value)}
                      data-testid="insurance-email-note"/>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
                    data-testid="insurance-email-cancel"
                    className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700">
              Cancel
            </button>
            <button type="button" onClick={send} disabled={sending}
                    data-testid="insurance-email-send"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm">
              <Send size={12} /> {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── v58.13.132dq — Insurance email audit log ────────────────────
// v58.13.132ds — Adds per-row soft-delete + Clear-all + Show-deleted
// toggle. Data preserved forever; delete simply flips visibility.

function EmailAuditLog() {
  const [rows, setRows] = useState([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [confirmRow, setConfirmRow] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const load = React.useCallback(() => {
    const params = showDeleted ? { include_deleted: true } : {};
    api.get('/org/insurance/email/log', { params })
      .then(({ data }) => setRows(data?.items || []))
      .catch(() => setRows([]));
  }, [showDeleted]);
  useEffect(() => { load(); }, [load]);
  const doDelete = async (row) => {
    try {
      await api.delete(`/org/insurance/email/log/${row.id}`);
      toast.success('Log entry hidden');
      setConfirmRow(null);
      load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const doUndelete = async (row) => {
    try {
      await api.post(`/org/insurance/email/log/${row.id}/undelete`);
      toast.success('Log entry restored');
      load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const doClearAll = async () => {
    try {
      const { data } = await api.post('/org/insurance/email/log/clear-all');
      const n = data?.cleared || 0;
      toast.success(`Cleared ${n} log entr${n === 1 ? 'y' : 'ies'}`);
      setConfirmClear(false);
      load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const visibleCount = rows.filter((r) => !r.deleted_at).length;
  if (rows.length === 0 && !showDeleted) return null;
  return (
    <div className="mt-5 rounded-lg border border-slate-200 bg-white" data-testid="insurance-email-audit-log">
      <div className="px-3 py-2 border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2 flex-wrap">
        <Clock size={12} /> Insurance email log (last 10)
        <div className="ml-auto flex items-center gap-3">
          <label
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none"
            data-testid="insurance-email-audit-show-deleted"
          >
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
              className="h-3 w-3"
            />
            Show deleted
          </label>
          <button
            type="button"
            disabled={visibleCount === 0}
            onClick={() => setConfirmClear(true)}
            data-testid="insurance-email-audit-clear-all-btn"
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md border border-slate-300 text-slate-700 hover:bg-red-50 hover:border-red-300 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Hide all visible log entries (preserves data)"
          >
            <Trash2 size={11} /> Clear all / Collapse log
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic px-3 py-2">
          No log entries.
        </div>
      ) : (
      <table className="w-full text-[11px]">
        <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
          <tr>
            <th className="text-left px-2 py-1.5 font-semibold">Sent</th>
            <th className="text-left px-2 py-1.5 font-semibold">By</th>
            <th className="text-left px-2 py-1.5 font-semibold">Recipients</th>
            <th className="text-left px-2 py-1.5 font-semibold">Certificates</th>
            <th className="text-left px-2 py-1.5 font-semibold">Status</th>
            <th className="px-2 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const deleted = !!r.deleted_at;
            return (
            <tr
              key={r.id}
              className={`border-t border-slate-100 ${deleted ? 'text-slate-400' : ''}`}
              data-testid={`insurance-email-audit-row-${r.id}`}
            >
              <td className={`px-2 py-1.5 font-mono whitespace-nowrap ${deleted ? 'line-through' : ''}`}>
                {(r.timestamp || '').replace('T', ' ').slice(0, 16)}
              </td>
              <td className={`px-2 py-1.5 ${deleted ? 'line-through' : ''}`}>{r.sent_by_email || r.sent_by_user_id || '—'}</td>
              <td className={`px-2 py-1.5 truncate max-w-[220px] ${deleted ? 'line-through' : ''}`} title={(r.recipients || []).join(', ')}>
                {(r.recipients || []).join(', ')}
              </td>
              <td className={`px-2 py-1.5 ${deleted ? 'line-through' : ''}`}>
                {(r.certificate_types || []).length}
                {(r.archived_included || []).length > 0 && ` +${r.archived_included.length} archived`}
              </td>
              <td className="px-2 py-1.5">
                {r.mocked ? (
                  <span className="text-[10px] uppercase font-semibold text-amber-800 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">MOCKED</span>
                ) : r.ok ? (
                  <span className="text-[10px] uppercase font-semibold text-emerald-800 bg-emerald-100 border border-emerald-200 rounded px-1.5 py-0.5">Sent</span>
                ) : (
                  <span className="text-[10px] uppercase font-semibold text-red-800 bg-red-100 border border-red-200 rounded px-1.5 py-0.5" title={r.error || ''}>Failed</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right">
                {!deleted ? (
                  <button
                    type="button"
                    onClick={() => setConfirmRow(r)}
                    data-testid={`insurance-email-audit-delete-${r.id}`}
                    aria-label="Delete log entry"
                    title="Hide from view (soft-delete)"
                    className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={12} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => doUndelete(r)}
                    data-testid={`insurance-email-audit-undelete-${r.id}`}
                    aria-label="Undelete log entry"
                    title="Restore this log entry to the visible list"
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 px-1.5 py-0.5 rounded hover:bg-emerald-50"
                  >
                    <RotateCcw size={11} /> Undelete
                  </button>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      )}
      {confirmRow && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" data-testid="insurance-email-audit-delete-confirm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Delete this log entry?
            </h3>
            <p className="text-sm text-slate-700 mb-4">
              Are you sure you want to delete this insurance email log entry? It will be hidden from view but preserved in the audit trail. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRow(null)}
                data-testid="insurance-email-audit-delete-confirm-cancel"
                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700"
              >Cancel</button>
              <button
                type="button"
                onClick={() => doDelete(confirmRow)}
                data-testid="insurance-email-audit-delete-confirm-ok"
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
              >Delete</button>
            </div>
          </div>
        </div>
      )}
      {confirmClear && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" data-testid="insurance-email-audit-clear-all-confirm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Clear all log entries?
            </h3>
            <p className="text-sm text-slate-700 mb-4">
              Are you sure? This will hide all {visibleCount} log {visibleCount === 1 ? 'entry' : 'entries'}. Data is preserved in the audit trail — this just hides them from view.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                data-testid="insurance-email-audit-clear-all-cancel"
                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700"
              >Cancel</button>
              <button
                type="button"
                onClick={doClearAll}
                data-testid="insurance-email-audit-clear-all-ok"
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
              >Clear all</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
