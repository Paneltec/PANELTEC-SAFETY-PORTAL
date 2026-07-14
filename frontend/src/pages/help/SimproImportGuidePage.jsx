// v160.3.7i — Dedicated help page for the Simpro ZIP import walkthrough.
// The guide previously rendered inline on `/settings/users`, which broke
// the Users & Permissions page layout. It now lives here on its own route
// (`/app/settings/help/simpro-import`) with its own scroll container, and
// UsersManagement links to it via a subtle "Need help?" text link above
// the Bulk import ZIPs action.
import React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/capture/Ui';
import SimproZipImportGuide from '../../components/simpro/SimproZipImportGuide';

export default function SimproImportGuidePage() {
  return (
    <div
      className="max-w-4xl mx-auto pb-16"
      data-testid="simpro-import-guide-page"
    >
      <PageHeader
        crumb="Settings / Users & Permissions / Simpro import guide"
        title="Simpro import guide"
        subtitle="Step-by-step walkthrough for admins downloading worker attachment ZIPs out of Simpro and bulk-uploading them into Paneltec."
      />

      <div className="-mt-3 mb-4 text-xs">
        <Link
          to="/app/settings/users"
          className="text-blue-600 hover:underline"
          data-testid="simpro-import-guide-back-link-top"
        >
          ← Back to Users &amp; Permissions
        </Link>
      </div>

      <div className="mt-4" data-testid="simpro-import-guide-container">
        <SimproZipImportGuide />
      </div>

      <div className="mt-8 text-xs text-slate-500">
        Looking for the bulk-upload action?{' '}
        <Link
          to="/app/settings/users"
          className="text-blue-600 hover:underline"
          data-testid="simpro-import-guide-back-link"
        >
          Return to Users &amp; Permissions →
        </Link>
      </div>
    </div>
  );
}
