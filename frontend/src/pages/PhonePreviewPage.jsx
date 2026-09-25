// v58.13.132mz — Standalone "Phone Preview" page.
//
// Renders the exact same `PhonePreview` component that used to live
// inside `Settings → Permission Presets → Mobile App Modules` tab.
// No logic duplication: the component is imported from its original
// module. Route: `/app/phone-preview`. Sidebar entry lives in the
// Settings section (registered in `settingsNavRegistry.js` /
// `settings_nav_registry.py`) and is hidden unless the user's
// permission preset grants `mobile_preview.view`.
//
// Route-level gate: the AppShell filters the sidebar entry, and this
// page short-circuits with an "Access denied" card when a user
// deep-links to it without the permission (matches the pattern used
// by `PermissionPresetsAdmin.jsx`).
import React from 'react';
import { PageHeader } from '@/components/capture/Ui';
import { useCan } from '@/lib/permissions';
import { PhonePreview } from '@/components/settings/MobileModulesSection';

export default function PhonePreviewPage() {
  const can = useCan();
  const allowed = can('mobile_preview', 'view');
  const canEdit = can('users', 'edit');

  if (!allowed) {
    return (
      <div
        className="max-w-3xl mx-auto rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500"
        data-testid="phone-preview-denied"
      >
        <div className="text-sm font-semibold text-slate-800 mb-2">
          Phone Preview locked
        </div>
        <p className="text-xs leading-relaxed max-w-md mx-auto">
          Your permission preset does not grant{' '}
          <span className="font-mono">mobile_preview.view</span>. Ask an
          admin to tick that cell on your preset from Settings →
          Permission presets.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto" data-testid="phone-preview-page">
      <PageHeader
        crumb="Phone Preview"
        title="Mobile Phone Preview"
        subtitle="Live preview of the Paneltec Civil mobile app as any role or specific worker. Read-only — writes are blocked server-side."
      />
      {/* PhonePreview was authored for a 380px sticky column inside a
          two-column grid. Wrap it in a 400px-wide left-aligned block
          so it renders sensibly as a page. */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
        <PhonePreview canEdit={canEdit} canOpenPreview={true} />
        <aside
          className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3"
          data-testid="phone-preview-help"
        >
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-violet-700 inline-flex items-center gap-1.5">
            About Phone Preview
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            What you&apos;re seeing
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            The bezel on the left renders the Paneltec Civil mobile
            app as if you were the selected role — or, when a specific
            worker is chosen, as that individual with their real
            profile and data. Writes (form submit, Confirm, etc.) are
            blocked at the server so audit trails stay clean.
          </p>
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <p className="text-[13px] font-semibold text-slate-800">
              Tips
            </p>
            <ul className="text-xs text-slate-600 leading-relaxed list-disc pl-5 space-y-1">
              <li>
                Change role from the dropdown at the top of the phone
                bezel to jump between Paneltec Civil, Viatec Traffic,
                Admin, and External Contractor views.
              </li>
              <li>
                Pick a specific worker to see their real inductions,
                certs, and profile.
              </li>
              <li>
                Click <strong>Exit preview mode</strong> to drop the
                preview session and reload the real onboarding flow
                (welcome → division → PIN).
              </li>
              <li>
                Sidebar visibility of this page is controlled by the{' '}
                <span className="font-mono">mobile_preview.view</span>{' '}
                cell in Settings → Permission presets → matrix.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
