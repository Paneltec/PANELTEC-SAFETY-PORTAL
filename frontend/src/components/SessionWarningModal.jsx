// Phase 3.16 — Session warning modal. Shown when the idle-watch hook fires
// `onWarn`. Carries a live countdown; "Stay logged in" resets the timer in
// the parent hook, "Log out now" exits immediately.
import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

export default function SessionWarningModal({ secondsRemaining, onStay, onLogout }) {
  const [n, setN] = useState(secondsRemaining || 60);
  useEffect(() => {
    if (n <= 0) { onLogout?.(); return; }
    const t = setTimeout(() => setN((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [n, onLogout]);
  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/70 grid place-items-center p-6"
         data-testid="session-warning-modal" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 grid place-items-center text-amber-600 flex-shrink-0">
            <ShieldAlert size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-slate-900">Are you still there?</h3>
            <p className="text-sm text-slate-600 mt-1">
              You'll be logged out in <strong data-testid="session-countdown">{n}</strong> second{n === 1 ? '' : 's'} for inactivity.
            </p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onLogout} data-testid="session-logout-now-btn"
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
            Log out now
          </button>
          <button onClick={onStay} data-testid="session-stay-btn"
            className="px-4 py-2 rounded-lg bg-[#1e4a8c] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#143263]">
            Stay logged in
          </button>
        </div>
      </div>
    </div>
  );
}
