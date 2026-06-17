import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import EmailSendModal from './EmailSendModal';
import { Can } from '../lib/permissions';

const CONVENIENCE = {
  swms:          '/swms/{id}/email-for-review',
  pre_starts:    '/pre-starts/{id}/email',
  site_diary:    '/site-diary/{id}/email-daily',
  hazards:       '/hazards/{id}/email',
  incidents:     '/incidents/{id}/email-summary',
  inspections:   '/inspections/{id}/email',
  contractors:   '/contractors/{id}/email',
  renewals:      '/renewals/{id}/email-link',
  audit_exports: '/audit-exports/{id}/email',
};

// Drop-in button that opens an EmailSendModal pre-wired for a given resource.
// Use `variant="primary" | "ghost" | "row"` to match the host page.
export default function EmailButton({
  resourceKind, recordId,
  subject, body, recipients = [], attachments = [],
  label = 'Send via email', variant = 'primary',
  size = 'md',
  className = '',
  testid,
}) {
  const [open, setOpen] = useState(false);
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };

  const cls = variant === 'primary'
    ? 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold hover:bg-blue-600'
    : variant === 'ghost'
      ? 'inline-flex items-center gap-1 text-sm text-brand-blue hover:underline'
      : 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-slate-100 text-slate-700';

  return (
    <Can resource={resourceKind} action="email">
      <button
        onClick={(e) => { stop(e); setOpen(true); }}
        className={`${cls} ${className}`}
        data-testid={testid || `email-btn-${resourceKind}-${recordId || 'x'}`}
        title="Send via email"
      >
        <Mail size={size === 'sm' ? 12 : 14} />
        {label && <span>{label}</span>}
      </button>
      <EmailSendModal
        isOpen={open}
        onClose={() => setOpen(false)}
        resourceKind={resourceKind}
        recordId={recordId}
        defaultSubject={subject || ''}
        defaultBody={body || ''}
        defaultRecipients={recipients}
        attachments={attachments}
        convenienceEndpoint={CONVENIENCE[resourceKind]}
      />
    </Can>
  );
}
