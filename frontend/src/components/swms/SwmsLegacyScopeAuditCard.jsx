// v58.13.132n3 — SWMS legacy-scope audit card.
//
// A compact admin-only card that reports how many SWMS in the
// current org carry a legacy / empty `applies_to` matrix. Live
// data at ship time: 11 of 14 active SWMS in Paneltec Pty Ltd
// need tagging — this card surfaces the number so admins can
// action it.
//
// Rules of engagement:
//   · READ-ONLY. Never mutates any SWMS. The "Review" CTA just
//     sets the selected SWMS id in the parent page so the admin
//     can start tagging one at a time via the existing editor.
//   · Admin-only per the backend gate — a non-admin user gets a
//     403 from `/api/admin/swms/legacy-scope-count`. The card
//     hides itself on any error so non-admins never see it (the
//     enclosing page is admin-only anyway, but defence in depth).
//   · No auto-refresh polling. The `ttl_seconds: 60` hint on
//     the response is honoured only via manual refetch (parent
//     re-mount or window focus).
import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import api from '../../lib/api';

export default function SwmsLegacyScopeAuditCard({ onReviewClick }) {
  const [state, setState] = useState({ loading: true, data: null, hidden: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/admin/swms/legacy-scope-count');
        if (!cancelled) setState({ loading: false, data, hidden: false });
      } catch {
        // Any error — hide the card. The parent page still works.
        if (!cancelled) setState({ loading: false, data: null, hidden: true });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.hidden || state.loading || !state.data) return null;

  const { count, count_effectively_null, total_active, sample_ids } = state.data;
  const total_needing = (count || 0) + (count_effectively_null || 0);

  // Nothing to audit — hide the card entirely rather than showing
  // "0 SWMS need tagging" which is a noisy no-op.
  if (total_needing === 0 || !total_active) return null;

  const firstSample = sample_ids && sample_ids.length ? sample_ids[0] : null;
  const pct = Math.round((total_needing / total_active) * 100);

  return (
    <div
      className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm max-w-3xl mb-5
                 inline-flex items-start gap-2"
      data-testid="swms-legacy-scope-audit-card"
    >
      <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="font-semibold text-amber-900 mb-0.5">
          {total_needing} of {total_active} SWMS need a coverage matrix
          <span className="ml-1.5 text-xs font-normal text-amber-700">({pct}%)</span>
        </div>
        <div className="text-slate-700 text-xs mb-1.5 leading-relaxed">
          These SWMS currently rely on the legacy &ldquo;visible to everyone in the
          org&rdquo; fallback because their <code>applies_to</code> is unset. Tag
          each SWMS with the roles, workers, companies, asset types or asset kinds
          it applies to so workers only see what&rsquo;s relevant. See{' '}
          <span className="font-mono">.132kn</span> in the changelog for the
          visibility contract.
        </div>
        {firstSample && (
          <button
            type="button"
            onClick={() => onReviewClick && onReviewClick(firstSample)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800
                       hover:text-amber-900 hover:underline"
            data-testid="swms-legacy-scope-review-btn"
          >
            Review the first one
            <ChevronRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
