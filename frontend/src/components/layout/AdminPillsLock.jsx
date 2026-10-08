/**
 * v58.13.132am — AdminPillsLock: glance-shield over header pills.
 *
 * Locked state (default, admin-only): renders a single 🔒 Admin
 * button. Non-admin users see nothing (the underlying pills also
 * check their own auth so nothing regresses).
 *
 * Unlocked state (session-scoped): renders `children` (the four
 * status pills) + a 🔓 lock button on the right that force-locks.
 * Unlock TTL lives entirely in browser sessionStorage — 60-min
 * hard cap or 5-min idle timeout, whichever hits first. No cookie,
 * no server-side session state.
 *
 * PIN modal handles BOTH first-time set (no hash yet) and unlock
 * (hash exists). Rotation goes through MyProfile in .132an.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Unlock, X as XIcon, Loader2, ShieldCheck } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { getUser } from '../../lib/auth';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

const SS_KEY = 'admin_console_unlocked_until';
const HARD_CAP_MIN = 60;
const IDLE_TIMEOUT_MIN = 5;

function readSessionExpiry() {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime()) || dt <= new Date()) {
      sessionStorage.removeItem(SS_KEY);
      return null;
    }
    return dt;
  } catch { return null; }
}

function writeSessionExpiry(dt) {
  try { sessionStorage.setItem(SS_KEY, dt.toISOString()); } catch {}
}

function clearSession() {
  try { sessionStorage.removeItem(SS_KEY); } catch {}
}

export default function AdminPillsLock({ children }) {
  const currentUser = getUser();
  const isAdmin = currentUser?.role === 'admin';
  const [unlocked, setUnlocked] = useState(() => readSessionExpiry() !== null);
  const [modalOpen, setModalOpen] = useState(false);
  const idleTimerRef = useRef(null);

  // Auto-lock timer wiring — resets on any user interaction while
  // unlocked. Also enforces the 60-min hard cap tick.
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      clearSession();
      setUnlocked(false);
    }, IDLE_TIMEOUT_MIN * 60 * 1000);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    resetIdleTimer();
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, resetIdleTimer, { passive: true }));
    // Hard-cap check every 30 s.
    const capTick = setInterval(() => {
      if (!readSessionExpiry()) {
        clearSession();
        setUnlocked(false);
      }
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdleTimer));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      clearInterval(capTick);
    };
  }, [unlocked, resetIdleTimer]);

  const handleUnlockSuccess = () => {
    writeSessionExpiry(new Date(Date.now() + HARD_CAP_MIN * 60 * 1000));
    setUnlocked(true);
    setModalOpen(false);
  };

  const handleLock = () => {
    // Best-effort backend call; state is client-owned so we don't
    // await the response for UX responsiveness.
    api.post('/auth/admin-console/lock', {}).catch(() => {});
    clearSession();
    setUnlocked(false);
  };

  if (!isAdmin) return null;

  if (unlocked) {
    return (
      <>
        <Link to="/app/settings/payroll-flow" className="text-sm font-semibold text-blue-800 border rounded-lg px-3 py-1">Payroll flow chart</Link>
        {children}
        <button
          onClick={handleLock}
          data-testid="admin-pills-relock"
          title="Re-lock admin console (or wait 5 min idle / 60 min max)"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-300 text-[11px] font-semibold uppercase tracking-wider hover:bg-slate-200"
        >
          <Unlock size={11} /> Lock
        </button>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        data-testid="admin-pills-unlock-btn"
        title="Admin console — reveals status pills after PIN"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 text-white text-[11px] font-semibold uppercase tracking-wider hover:bg-slate-800"
      >
        <Lock size={11} /> Admin
      </button>
      {modalOpen && (
        <PinModal
          onClose={() => setModalOpen(false)}
          onSuccess={handleUnlockSuccess}
        />
      )}
    </>
  );
}

// ── PinModal — dual-mode (set-first-time OR unlock) ─────────────
function PinModal({ onClose, onSuccess }) {
  const [phase, setPhase] = useState('loading'); // loading|unlock|set|confirm
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api.post('/auth/admin-console/status', {})
      .then((r) => {
        setStatus(r.data);
        setPhase(r.data.has_pin ? 'unlock' : 'set');
      })
      .catch((e) => {
        setError(apiError(e) || 'Status check failed');
        setPhase('unlock');
      });
  }, []);

  const tap = (digit) => {
    if (busy) return;
    if (pin.length >= 4) return;
    setError('');
    setPin((p) => (p + digit).slice(0, 4));
  };
  const backspace = () => { if (!busy) { setError(''); setPin((p) => p.slice(0, -1)); } };

  useEffect(() => {
    if (pin.length !== 4 || busy) return;
    if (phase === 'set') {
      // Move to confirm phase.
      setFirstPin(pin);
      setPin('');
      setPhase('confirm');
      return;
    }
    if (phase === 'confirm') {
      if (pin !== firstPin) {
        setError('PINs did not match. Start over.');
        setPin('');
        setFirstPin('');
        setPhase('set');
        return;
      }
      setBusy(true);
      api.post('/auth/admin-console/set-pin', { pin })
        .then(() => api.post('/auth/admin-console/unlock', { pin }))
        .then(() => { toast.success('Admin PIN set. Console unlocked.'); onSuccess(); })
        .catch((e) => {
          setError(apiError(e) || 'Failed to set PIN');
          setBusy(false);
          setPin('');
          setFirstPin('');
          setPhase('set');
        });
      return;
    }
    if (phase === 'unlock') {
      setBusy(true);
      api.post('/auth/admin-console/unlock', { pin })
        .then(() => { onSuccess(); })
        .catch((e) => {
          const msg = apiError(e) || 'Wrong PIN.';
          setError(msg);
          setBusy(false);
          setPin('');
        });
    }
  }, [pin, phase, firstPin, onSuccess, busy]);

  const title = phase === 'loading' ? 'Admin console'
              : phase === 'set'    ? 'Set your admin PIN'
              : phase === 'confirm' ? 'Confirm your admin PIN'
              : 'Admin console';
  const sub = phase === 'loading' ? '…'
            : phase === 'set'    ? 'Choose a 4-digit PIN to shield the header pills.'
            : phase === 'confirm' ? 'Re-enter the 4-digit PIN.'
            : 'Enter your 4-digit PIN';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" data-testid="admin-pin-modal">
      <div className="w-full max-w-xs bg-white rounded-2xl shadow-xl">
        <div className="flex items-start justify-between p-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-slate-700" />
              <div className="font-bold text-slate-900 text-sm">{title}</div>
            </div>
            <div className="text-xs text-slate-500 mt-1">{sub}</div>
          </div>
          <button onClick={onClose} data-testid="admin-pin-close" className="p-1 -mr-1 -mt-1 text-slate-400 hover:text-slate-700">
            <XIcon size={16} />
          </button>
        </div>
        <div className="p-5 flex flex-col items-center">
          <div className="flex gap-2 mb-4" data-testid="admin-pin-dots">
            {[0,1,2,3].map((i) => (
              <div key={i}
                   className={`w-4 h-4 rounded-full border-2 ${
                     i < pin.length
                       ? 'bg-slate-900 border-slate-900'
                       : 'bg-white border-slate-300'
                   }`} />
            ))}
          </div>
          {busy && <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2"><Loader2 size={12} className="animate-spin" /> Working…</div>}
          {error && <div className="text-xs text-red-600 mb-2 text-center max-w-[220px]" data-testid="admin-pin-error">{error}</div>}
          <div className="grid grid-cols-3 gap-2 w-full">
            {[1,2,3,4,5,6,7,8,9].map((n) => (
              <button key={n} onClick={() => tap(String(n))} disabled={busy || phase === 'loading'}
                      data-testid={`admin-pin-key-${n}`}
                      className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-lg font-bold text-slate-800">
                {n}
              </button>
            ))}
            <button onClick={backspace} disabled={busy || phase === 'loading'}
                    data-testid="admin-pin-key-back"
                    className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-xs font-semibold text-slate-600">
              ← Back
            </button>
            <button onClick={() => tap('0')} disabled={busy || phase === 'loading'}
                    data-testid="admin-pin-key-0"
                    className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-lg font-bold text-slate-800">
              0
            </button>
            <button onClick={onClose} disabled={busy}
                    data-testid="admin-pin-key-cancel"
                    className="h-12 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
