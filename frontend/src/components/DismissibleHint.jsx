// v160.3.9.33.2 — Dismissible localStorage-scoped hint banner.
// Reused on Users list + Workers pages to nudge admins toward
// running a fresh Simpro ZIP import when photos are missing.
import React, { useState } from 'react';
import { Info, X as XIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * @param {object} props
 * @param {string} props.storageKey — localStorage key so the banner stays
 *   dismissed across sessions per browser.
 * @param {string} props.text — main banner text.
 * @param {string} [props.linkTo] — router path for the CTA button.
 * @param {string} [props.linkLabel] — CTA label.
 * @param {string} [props.testId]
 */
export default function DismissibleHint({
  storageKey,
  text,
  linkTo,
  linkLabel,
  testId = 'dismissible-hint',
}) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(storageKey) === '1';
  });
  if (dismissed) return null;
  const doDismiss = () => {
    try { window.localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };
  return (
    <div
      data-testid={testId}
      className="mt-3 flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm"
    >
      <Info size={16} className="text-sky-600 flex-shrink-0" />
      <div className="flex-1 min-w-0 text-sky-900">
        {text}
      </div>
      {linkTo && (
        <Link
          to={linkTo}
          className="inline-flex items-center gap-1 rounded-md bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold px-2.5 py-1"
          data-testid={`${testId}-cta`}
        >
          {linkLabel || 'Go'}
        </Link>
      )}
      <button
        type="button"
        onClick={doDismiss}
        aria-label="Dismiss hint"
        title="Dismiss"
        data-testid={`${testId}-dismiss`}
        className="text-sky-600 hover:text-sky-900 flex-shrink-0"
      >
        <XIcon size={16} />
      </button>
    </div>
  );
}
