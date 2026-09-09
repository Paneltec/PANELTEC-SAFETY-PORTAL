// v58.13.132ah — Onboarding QR landing page.
//
// .132ah delta: AndroidPanel now surfaces the expected file size
// (~115 MB) + SHA-256 prefix so users can eyeball-verify a completed
// download, a prominent amber "download on Wi-Fi" warning, and a
// "Download stalled? Retry" link that cache-busts the URL for a
// fresh attempt. These are user-facing companions to the backend
// Range-aware handler in `backend/mobile_downloads.py`.
//
// Route: `/m/onboard/:token`
//
// This is the PUBLIC (unauthenticated) page a printed onboarding card
// lands the worker on when they scan the QR with their phone camera.
// It replaces the previous `paneltec://onboard?token=...` custom-scheme
// URL, which failed silently for uninstalled workers ("no app to open
// this token").
//
// User-agent sniff:
//   iOS         → App Store install button + "Already installed? Open in app"
//   Android     → Play Store install button + "Already installed? Open in app"
//   Desktop/other → "Please scan on your phone" + mirror QR of current URL
//
// After the user installs the app and re-scans the QR (or taps the
// deep-link button after install), the mobile app's welcome.tsx
// handler at line 9 picks up `paneltec://onboard?token=...&preload=...`.
//
// TODO(app-store-id): swap the placeholder App Store URL below when the
//   app is submitted. Search "TODO(app-store-id)".
// TODO(play-store-id): same for Play Store — search "TODO(play-store-id)".
// TODO(universal-links): the /.well-known/{apple-app-site-association,
//   assetlinks.json} files are template stubs — populate with real
//   bundle ID + SHA-256 signing fingerprints when signing certs land.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { Loader2, Smartphone, ExternalLink, AlertTriangle, CheckCircle2, Wifi, RefreshCw } from 'lucide-react';

// TODO(app-store-id): replace 0000000000 with the real numeric App Store id
const APP_STORE_URL = 'https://apps.apple.com/app/id0000000000';
// v58.13.132af — Android path swapped from Play Store to direct APK
// download. Play Store URL preserved in a TODO for when the app is
// eventually published — both paths will coexist later (Play Store
// for public discovery + APK for internal/rapid-iteration installs).
// TODO(play-store-id): preserve for future Play Store publish
//   const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.emergent.whscompliance.fv5aib';
const ANDROID_APK_URL = '/api/mobile/downloads/android/latest.apk';

function detectPlatform() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export default function OnboardMobileLanding() {
  const { token } = useParams();
  const [sp] = useSearchParams();
  const preload = sp.get('preload') || 'civil';

  const [state, setState] = useState({ status: 'loading' });

  const platform = useMemo(() => detectPlatform(), []);
  const deepLink = `paneltec://onboard?token=${token}&preload=${preload}`;
  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  const [mirrorQrDataUrl, setMirrorQrDataUrl] = useState(null);
  useEffect(() => {
    // Backend endpoint is /api/*. Use relative /api so the same
    // origin resolves via the ingress → 8001.
    fetch(`/api/mobile/onboarding/validate/${encodeURIComponent(token || '')}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.valid) {
          setState({ status: 'valid', firstName: j.first_name });
        } else {
          setState({ status: 'invalid', reason: j.reason });
        }
      })
      .catch(() => setState({ status: 'invalid', reason: 'network' }));
  }, [token]);

  useEffect(() => {
    if (platform === 'desktop' && currentUrl) {
      QRCode.toDataURL(currentUrl, { margin: 1, width: 320 })
        .then(setMirrorQrDataUrl)
        .catch(() => setMirrorQrDataUrl(null));
    }
  }, [platform, currentUrl]);

  const heading = state.firstName
    ? `Welcome, ${state.firstName}`
    : "Welcome to the Paneltec Civil Field App";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" data-testid="onboard-landing">
      {/* Navy header with chevron + wordmark — matches printed card. */}
      <header className="bg-slate-900 text-white px-6 py-5">
        <div className="flex items-center gap-3">
          <div
            className="w-6 h-6 flex items-center justify-center"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="24" height="24">
              <polygon points="12,3 22,20 2,20" fill="#F97316" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-lg font-bold tracking-tight">PANELTEC CIVIL</div>
            <div className="text-xs font-semibold text-orange-400 tracking-widest uppercase">
              Field App · Onboarding
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-5 pt-8 pb-16">
        {state.status === 'loading' && (
          <div className="mt-24 flex flex-col items-center gap-3 text-slate-500">
            <Loader2 className="animate-spin" size={26} />
            <div className="text-sm">Loading your card…</div>
          </div>
        )}

        {state.status === 'invalid' && (
          <InvalidCard reason={state.reason} />
        )}

        {state.status === 'valid' && (
          <>
            <h1
              className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-2"
              data-testid="onboard-heading"
            >
              {heading}
            </h1>
            <p className="text-slate-500 text-center text-sm mb-8 max-w-md">
              Let's get you set up on the Field App. Follow the steps for your
              device below.
            </p>

            {platform === 'ios' && <IOSPanel deepLink={deepLink} />}
            {platform === 'android' && <AndroidPanel deepLink={deepLink} />}
            {platform === 'desktop' && (
              <DesktopPanel mirrorQrDataUrl={mirrorQrDataUrl} currentUrl={currentUrl} />
            )}
          </>
        )}
      </main>

      <footer className="px-6 py-4 text-center text-xs text-slate-400">
        For Paneltec Civil employees only.
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function InvalidCard({ reason }) {
  const message =
    reason === 'expired'
      ? "This onboarding card has expired."
      : reason === 'used'
      ? "This onboarding card has already been redeemed."
      : "This onboarding card is no longer valid.";
  return (
    <div
      className="mt-16 max-w-md w-full bg-white border border-amber-200 rounded-2xl p-6 text-center"
      data-testid="onboard-invalid-card"
    >
      <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="text-amber-600" size={22} />
      </div>
      <h2 className="text-lg font-bold text-slate-900 mb-2">{message}</h2>
      <p className="text-sm text-slate-500">
        Please ask your admin for a fresh onboarding card.
      </p>
    </div>
  );
}

function IOSPanel({ deepLink }) {
  return (
    <div
      className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-6"
      data-testid="onboard-ios-panel"
    >
      <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-slate-500 uppercase mb-3">
        <Smartphone size={14} /> For iOS
      </div>
      <a
        href={APP_STORE_URL}
        data-testid="ios-install-btn"
        className="w-full inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-xl text-sm mb-3"
      >
        <ExternalLink size={16} /> Install for iOS
      </a>
      <a
        href={deepLink}
        data-testid="ios-open-btn"
        className="w-full inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-900 font-semibold py-3 rounded-xl text-sm border border-slate-300"
      >
        Already installed? Open in app
      </a>
      <div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500 space-y-1">
        <p><span className="font-semibold text-slate-700">1.</span> Tap <em>Install for iOS</em> above.</p>
        <p><span className="font-semibold text-slate-700">2.</span> Once installed, open the app.</p>
        <p><span className="font-semibold text-slate-700">3.</span> Re-scan this QR (or tap <em>Open in app</em>) to sign in.</p>
      </div>
    </div>
  );
}

function AndroidPanel({ deepLink }) {
  // v58.13.132ah — fetch expected size + SHA prefix so the user can
  // eyeball-verify a completed download (partial downloads look like
  // a successful install file otherwise).
  const [manifest, setManifest] = useState(null);
  // Cache-bust nonce for "Download stalled? Retry" — bumped on every
  // click, appended as `?nocache=<ts>` to force a fresh request rather
  // than resuming from a poisoned partial in Chrome's cache.
  const [nocache, setNocache] = useState(0);

  useEffect(() => {
    fetch('/api/mobile/downloads/android/version')
      .then((r) => r.json())
      .then((j) => {
        if (j && j.available) setManifest(j);
      })
      .catch(() => {});
  }, []);

  const sizeMb = manifest?.size_bytes
    ? Math.round(manifest.size_bytes / (1024 * 1024))
    : 115;
  const shaPrefix = manifest?.sha256
    ? manifest.sha256.slice(0, 8)
    : null;

  const downloadHref = nocache
    ? `${ANDROID_APK_URL}?nocache=${nocache}`
    : ANDROID_APK_URL;

  return (
    <div
      className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-6"
      data-testid="onboard-android-panel"
    >
      <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-slate-500 uppercase mb-3">
        <Smartphone size={14} /> For Android
      </div>

      {/* v58.13.132ah — expected size + SHA prefix strip. */}
      <div
        className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px]"
        data-testid="android-file-meta"
      >
        <div>
          <div className="font-bold text-slate-700 tracking-wide uppercase text-[10px]">File size</div>
          <div className="text-slate-900 font-semibold" data-testid="android-file-size">~{sizeMb} MB</div>
        </div>
        {shaPrefix && (
          <div className="text-right">
            <div className="font-bold text-slate-700 tracking-wide uppercase text-[10px]">Verify</div>
            <div className="text-slate-900 font-mono" data-testid="android-file-sha">{shaPrefix}…</div>
          </div>
        )}
      </div>

      {/* v58.13.132ah — Wi-Fi warning box (amber). */}
      <div
        className="flex items-start gap-2 mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200"
        data-testid="android-wifi-warning"
      >
        <Wifi size={16} className="text-amber-600 shrink-0 mt-[2px]" />
        <p className="text-[11px] text-amber-900 leading-snug">
          <span className="font-bold">Please download on Wi-Fi.</span> A {sizeMb} MB download on
          mobile data often fails partway. If your download completes at less than {sizeMb} MB,
          retry on Wi-Fi.
        </p>
      </div>

      <a
        href={downloadHref}
        data-testid="android-install-btn"
        className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl text-sm mb-2"
      >
        <ExternalLink size={16} /> Download &amp; install
      </a>

      {/* v58.13.132ah — retry link (cache-busted). */}
      <button
        type="button"
        onClick={() => {
          const ts = Date.now();
          setNocache(ts);
          // Kick off the retry immediately in the same tap.
          window.location.href = `${ANDROID_APK_URL}?nocache=${ts}`;
        }}
        data-testid="android-retry-link"
        className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-900 mb-3"
      >
        <RefreshCw size={12} /> Download stalled? Tap here to retry
      </button>

      <p className="text-[11px] text-slate-500 leading-snug mb-3">
        Chrome may ask you to allow install from unknown sources — this is
        normal for direct installs. Approve the prompt and the app will
        install.
      </p>
      <a
        href={deepLink}
        data-testid="android-open-btn"
        className="w-full inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-900 font-semibold py-3 rounded-xl text-sm border border-slate-300"
      >
        Already installed? Open in app
      </a>
      <div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500 space-y-1">
        <p><span className="font-semibold text-slate-700">1.</span> Tap <em>Download &amp; install</em> above.</p>
        <p><span className="font-semibold text-slate-700">2.</span> Approve the "unknown sources" prompt, then open the app.</p>
        <p><span className="font-semibold text-slate-700">3.</span> Re-scan this QR (or tap <em>Open in app</em>) to sign in.</p>
      </div>
    </div>
  );
}

function DesktopPanel({ mirrorQrDataUrl, currentUrl }) {
  return (
    <div
      className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center"
      data-testid="onboard-desktop-panel"
    >
      <div className="flex items-center justify-center gap-2 text-xs font-bold tracking-widest text-slate-500 uppercase mb-3">
        <Smartphone size={14} /> Open on your phone
      </div>
      <p className="text-sm text-slate-600 mb-5">
        The Field App is a mobile app — you can't install it on this
        device. Scan the QR below on the phone you want to install it on.
      </p>
      {mirrorQrDataUrl ? (
        <img
          src={mirrorQrDataUrl}
          alt="Scan to open on phone"
          data-testid="onboard-mirror-qr"
          className="mx-auto w-56 h-56 rounded-lg border border-slate-200"
        />
      ) : (
        <div className="mx-auto w-56 h-56 flex items-center justify-center border border-slate-200 rounded-lg text-slate-400 text-xs">
          Generating QR…
        </div>
      )}
      <p className="mt-4 text-[11px] text-slate-400 break-all">{currentUrl}</p>
      <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-emerald-700">
        <CheckCircle2 size={13} /> This card is valid.
      </div>
    </div>
  );
}
