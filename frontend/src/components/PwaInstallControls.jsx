// v58.13.112 — PWA install button + one-time banner + iOS walk-through.
//
// Renders three related surfaces that key off `usePwaInstall()`:
//   1. `<PwaInstallButton />` — a compact sidebar-footer button that
//      surfaces the native `beforeinstallprompt` on Chrome/Edge/Android
//      (or opens the iOS Add-to-Home-Screen modal on iOS Safari). Hidden
//      when the app is already running in standalone mode.
//   2. `<IOSInstallModal />` — a shadcn Dialog with step-by-step iOS
//      Safari instructions ("Tap Share → Add to Home Screen"). Rendered
//      inside `<PwaInstallButton />` so callers only mount the button.
//   3. `<PwaInstallBanner />` — a one-time top banner that surfaces the
//      install affordance to first-time desktop Chrome users who missed
//      the sidebar button. Auto-persists a "seen" flag after 30s so it
//      never reappears, per the .112 brief. Dismissible via a Not-now
//      button (session-only dismiss) or the ✕ (same as Not-now).
//
// No emoji — every icon comes from lucide-react.
import React, { useEffect, useRef, useState } from 'react';
import { Download, Smartphone, Share, PlusSquare, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import usePwaInstall from '../hooks/usePwaInstall';

const BANNER_SEEN_KEY = 'paneltec_pwa_install_banner_seen_v112';
const BANNER_SESSION_DISMISS_KEY = 'paneltec_pwa_install_banner_dismissed';

// ─────────────────────────── iOS walk-through ─────────────────────────
function IOSInstallModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="pwa-ios-install-modal"
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200">
          <div className="rounded-lg bg-[#e6eff9] p-2 border border-[#b9d2ec]">
            <Smartphone size={18} className="text-[#1e4a8c]" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-slate-900">Add Paneltec Civil to your Home Screen</h2>
            <p className="text-xs text-slate-500 mt-0.5">Two-step iOS Safari install</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="pwa-ios-install-close"
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            <XIcon size={16} />
          </button>
        </div>
        <ol className="px-5 py-4 space-y-3 text-sm text-slate-700">
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-[11px] font-bold">1</span>
            <div className="flex-1">
              <div className="font-medium text-slate-900 flex items-center gap-1.5">
                Tap the <Share size={14} className="text-blue-600" /> Share icon
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Bottom bar in Safari on iPhone; top-right in Safari on iPad.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-[11px] font-bold">2</span>
            <div className="flex-1">
              <div className="font-medium text-slate-900 flex items-center gap-1.5">
                Choose <PlusSquare size={14} className="text-slate-700" /> Add to Home Screen
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Scroll down the share sheet if you don't see it — then tap Add.
              </p>
            </div>
          </li>
        </ol>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500">
          Once installed, Paneltec Civil launches full-screen from your Home Screen just like a native app.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────── Sidebar footer button ────────────────────────
export function PwaInstallButton({ collapsed = false }) {
  const { canPrompt, isIOS, isInstalled, promptInstall } = usePwaInstall();
  const [showIOS, setShowIOS] = useState(false);
  if (isInstalled) return null;
  if (!canPrompt && !isIOS) return null;
  const handleClick = async () => {
    if (canPrompt) {
      const r = await promptInstall();
      if (r.outcome === 'accepted') {
        toast.success('Installing Paneltec Civil…');
      } else if (r.outcome === 'dismissed') {
        toast.message('Install cancelled — you can install any time from this button.');
      }
      return;
    }
    if (isIOS) setShowIOS(true);
  };
  return (
    <>
      <div className={`border-t border-slate-200 py-2 ${collapsed ? 'px-1' : 'px-3'}`}>
        <button
          type="button"
          onClick={handleClick}
          data-testid="pwa-install-btn"
          data-can-prompt={canPrompt ? 'true' : 'false'}
          data-ios={isIOS ? 'true' : 'false'}
          title="Install Paneltec Civil as an app"
          className={
            'w-full inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100 hover:border-orange-300 font-semibold text-xs uppercase tracking-wider transition-colors ' +
            (collapsed ? 'justify-center px-2 py-2' : 'justify-center px-3 py-2')
          }
        >
          <Download size={14} />
          {!collapsed && <span>Install app</span>}
        </button>
      </div>
      <IOSInstallModal open={showIOS} onClose={() => setShowIOS(false)} />
    </>
  );
}

// ───────────────────────── One-time top banner ────────────────────────
export function PwaInstallBanner() {
  const { canPrompt, isIOS, isInstalled, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      if (window.localStorage.getItem(BANNER_SEEN_KEY) === '1') return true;
      if (window.sessionStorage.getItem(BANNER_SESSION_DISMISS_KEY) === '1') return true;
    } catch { /* private mode etc. */ }
    return false;
  });
  const [showIOS, setShowIOS] = useState(false);
  const persistedRef = useRef(false);
  // Auto-persist after 30 s of visibility so the banner really is a
  // one-time affordance (per .112 brief). Cleared on unmount.
  useEffect(() => {
    if (isInstalled || dismissed) return;
    if (!canPrompt && !isIOS) return;
    const t = setTimeout(() => {
      try { window.localStorage.setItem(BANNER_SEEN_KEY, '1'); } catch { /* noop */ }
      persistedRef.current = true;
    }, 30_000);
    return () => clearTimeout(t);
  }, [canPrompt, isIOS, isInstalled, dismissed]);
  if (isInstalled || dismissed) return null;
  if (!canPrompt && !isIOS) return null;
  const persist = () => {
    try { window.localStorage.setItem(BANNER_SEEN_KEY, '1'); } catch { /* noop */ }
    persistedRef.current = true;
    setDismissed(true);
  };
  const sessionDismiss = () => {
    try { window.sessionStorage.setItem(BANNER_SESSION_DISMISS_KEY, '1'); } catch { /* noop */ }
    setDismissed(true);
  };
  const handleInstall = async () => {
    if (canPrompt) {
      const r = await promptInstall();
      if (r.outcome === 'accepted') {
        toast.success('Installing Paneltec Civil…');
        persist();
      } else {
        sessionDismiss();
      }
      return;
    }
    if (isIOS) setShowIOS(true);
  };
  return (
    <>
      <div
        role="region"
        aria-label="Install Paneltec Civil"
        data-testid="pwa-install-banner"
        className="border-b border-orange-200 bg-orange-50 px-4 py-2 flex items-center gap-3 text-sm"
      >
        <div className="rounded-md bg-orange-100 p-1.5 border border-orange-200 hidden sm:block">
          <Download size={14} className="text-orange-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-orange-900 truncate">Install Paneltec Civil</div>
          <div className="text-xs text-orange-800/80 truncate">
            {isIOS
              ? 'Add to your iPhone Home Screen to launch full-screen and work offline.'
              : 'One click to install as an app — full-screen, offline-ready, no store.'}
          </div>
        </div>
        <button
          type="button"
          onClick={handleInstall}
          data-testid="pwa-install-banner-install"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold uppercase tracking-wider hover:bg-orange-700"
        >
          <Download size={12} /> Install
        </button>
        <button
          type="button"
          onClick={sessionDismiss}
          data-testid="pwa-install-banner-not-now"
          className="text-xs font-semibold text-orange-900 hover:underline px-2"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={sessionDismiss}
          aria-label="Dismiss"
          data-testid="pwa-install-banner-dismiss"
          className="p-1 rounded hover:bg-orange-100 text-orange-800"
        >
          <XIcon size={14} />
        </button>
      </div>
      <IOSInstallModal open={showIOS} onClose={() => setShowIOS(false)} />
    </>
  );
}
