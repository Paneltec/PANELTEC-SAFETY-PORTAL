import React, { useEffect, useMemo, useState } from 'react';
import { Save, Building2, MapPin, Phone, Shield, AlertTriangle, UploadCloud, Download, Trash2, Info, Globe } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { useCan } from '../lib/permissions';
import { PageHeader, PrimaryButton, Field, inputClass } from '../components/capture/Ui';

// v58.13.132dp — Organisation Settings expansion (5 items).
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
  { key: 'portal_url', label: 'Portal URL', placeholder: 'https://portal.paneltec.com.au',
    hint: 'Rendered on the footer of every PDF report so recipients can find the login.' },
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
      for (const k of ['public_liability_insurance', 'workers_comp_insurance']) {
        const b = payload[k] || {};
        if (!b.policy_number && !b.expiry_date) delete payload[k];
      }
      const { data } = await api.patch('/org', payload);
      setDoc(data);
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
        className="mb-4 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-3 flex items-start gap-3"
      >
        <span
          data-testid="org-importance-chip"
          className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-600 text-white"
        >
          <Info size={11} /> Important
        </span>
        <div className="text-xs text-slate-700 leading-relaxed">
          This information appears on <span className="font-semibold">PDF reports</span>,{' '}
          <span className="font-semibold">audit exports</span>,{' '}
          <span className="font-semibold">renewal emails</span> and the{' '}
          <span className="font-semibold">public portal footer</span>.
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
        <Section icon={<Shield size={14} className="text-emerald-600" />} title="Insurance policies" elevated>
          <p className="text-xs text-slate-500 mb-3">
            Policy expiries drive the 30-day banner above and the 7-day critical alert. Both certificates
            are stored in GridFS — never on disk.
          </p>
          <InsuranceBlock
            kind="public_liability"
            label="Public liability insurance"
            form={form}
            doc={doc}
            isAdmin={isAdmin}
            setInsurance={setInsurance}
            uploadFile={uploadFile}
            uploading={uploading}
          />
          <div className="mt-4">
            <InsuranceBlock
              kind="workers_comp"
              label="Workers compensation insurance"
              form={form}
              doc={doc}
              isAdmin={isAdmin}
              setInsurance={setInsurance}
              uploadFile={uploadFile}
              uploading={uploading}
            />
          </div>
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
    </div>
  );
}

function InsuranceBlock({ kind, label, form, doc, isAdmin, setInsurance, uploadFile, uploading }) {
  const block = doc[`${kind}_insurance`] || {};
  const status = (doc.insurance_status || {})[kind] || {};
  const level = status.level;
  const days = status.days_until_expiry;
  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50" data-testid={`org-insurance-block-${kind}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm text-slate-800 flex items-center gap-2">
          <Shield size={14} className="text-emerald-600" /> {label}
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
    </div>
  );
}

function Section({ icon, title, children, elevated }) {
  return (
    <div className={`rounded-2xl border bg-white p-5 ${
      elevated
        ? 'border-slate-200 shadow-sm ring-1 ring-emerald-50/60'
        : 'border-slate-200'
    }`}>
      <h3 className="font-display font-semibold flex items-center gap-2 mb-4">{icon} {title}</h3>
      {children}
    </div>
  );
}
