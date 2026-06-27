import React, { useEffect, useState } from 'react';
import { Save, Building2, MapPin, Phone } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader, PrimaryButton, Field, inputClass } from '../components/capture/Ui';

const FIELDS = [
  // single column
  { key: 'name', label: 'Organisation name', required: true },
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
];

export default function OrgSettings() {
  const me = getUser();
  const isAdmin = me?.role === 'admin';
  const [doc, setDoc] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/org');
      setDoc(data);
      setForm({
        name: data.name || '',
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
        timezone: data.timezone || 'Australia/Sydney',
      });
    } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { toast.error('Organisation name required'); return; }
    setBusy(true);
    try {
      const payload = { ...form };
      // Drop empty email so backend EmailStr doesn't choke
      if (!payload.contact_email) delete payload.contact_email;
      const { data } = await api.patch('/org', payload);
      setDoc(data);
      toast.success('Organisation updated');
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  if (!doc) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto" data-testid="org-settings-page">
      <PageHeader
        crumb="Settings / Organisation"
        title="Organisation"
        subtitle="The legal entity behind your account. These details appear on PDF reports, audit exports and renewal emails."
        action={isAdmin ? (
          <PrimaryButton onClick={save} busy={busy} testid="org-save-btn">
            <Save size={14} /> Save changes
          </PrimaryButton>
        ) : null}
      />

      {!isAdmin && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900" data-testid="org-readonly-banner">
          Read-only — contact your administrator to edit organisation details.
        </div>
      )}

      <div className="space-y-4">
        {/* Identity */}
        <Section icon={<Building2 size={14} className="text-brand-blue" />} title="Identity">
          <div className="grid sm:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label} required={f.required}>
                <input
                  className={inputClass}
                  value={form[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  disabled={!isAdmin}
                  data-testid={`org-field-${f.key}`}
                />
              </Field>
            ))}
            <Field label="Slug" hint="Auto-generated. Used in audit export filenames.">
              <input className={inputClass + ' bg-slate-50'} value={doc.slug || ''} disabled data-testid="org-field-slug" />
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
        <Section icon={<MapPin size={14} className="text-brand-blue" />} title="Registered address">
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
        <Section icon={<Phone size={14} className="text-brand-blue" />} title="Primary contact">
          <div className="grid sm:grid-cols-2 gap-3">
            {CONTACT.map((f) => (
              <Field key={f.key} label={f.label}>
                <input
                  type={f.type || 'text'}
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

        {isAdmin && (
          <div className="flex justify-end">
            <PrimaryButton onClick={save} busy={busy} testid="org-save-btn-bottom">
              <Save size={14} /> Save changes
            </PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ icon, title, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-display font-semibold flex items-center gap-2 mb-4">{icon} {title}</h3>
      {children}
    </div>
  );
}
