/**
 * PIN Entry — v58.13.132cj.
 *
 * Pure 4-digit PIN login screen. Hits POST /api/auth/mobile/pin-login.
 * Handles:
 *   200 → store session, navigate to role-based home
 *   401 → inline error (invalid_pin / account_disabled / pin_expired)
 *   429 → countdown timer with rate-limit tiers
 *
 * No create/confirm mode — backend manages PIN creation during onboarding.
 * Role auto-detected from response; no division picker.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import PinPad from '../../src/components/PinPad';
import Wordmark from '../../src/components/Wordmark';
import { pinLogin, isPreviewSession, getDeviceId } from '../../src/services/auth';

type State = 'ready' | 'submitting' | 'error' | 'rate_limited';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_pin: 'Incorrect PIN. Please try again.',
  account_disabled: 'Your account has been disabled. Contact your supervisor.',
  pin_expired: 'Your PIN has expired. Please contact your admin for a new one.',
  network: 'Network error. Check your connection and try again.',
};

export default function PinEntryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [pin, setPin] = useState('');
  const [state, setState] = useState<State>('ready');
  const [errorMsg, setErrorMsg] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [deviceId, setDeviceIdState] = useState<string | null>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Preview bypass
  useEffect(() => {
    if (isPreviewSession()) {
      router.replace('/(tabs)/home');
      return;
    }
    getDeviceId().then(setDeviceIdState);
  }, []);

  // Countdown timer for rate limiting
  useEffect(() => {
    if (countdown <= 0) {
      if (state === 'rate_limited') setState('ready');
      return;
    }
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setState('ready');
          setErrorMsg('');
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [countdown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const shake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 40, useNativeDriver: true, easing: Easing.linear }),
    ]).start();
  }, [shakeAnim]);

  const handlePinChange = useCallback(async (val: string) => {
    if (state === 'submitting' || state === 'rate_limited') return;
    setPin(val);
    setErrorMsg('');

    if (val.length === 4) {
      setState('submitting');
      const result = await pinLogin(val, deviceId || undefined);

      if (result.ok) {
        // Success — navigate to home (role-based landing will read stored role)
        router.replace('/(tabs)/home');
      } else if (result.error === 'rate_limited') {
        setState('rate_limited');
        const secs = 'retryAfterSeconds' in result ? result.retryAfterSeconds : 60;
        setCountdown(secs);
        setErrorMsg(`Too many attempts. Try again in ${formatTime(secs)}.`);
        setPin('');
        shake();
      } else {
        setState('error');
        setErrorMsg(ERROR_MESSAGES[result.error] || 'Login failed. Please try again.');
        setPin('');
        shake();
        // Auto-reset to ready after a brief pause
        setTimeout(() => setState('ready'), 200);
      }
    }
  }, [state, deviceId, router, shake]);

  const formatTime = (secs: number) => {
    if (secs >= 3600) {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      return `${h}h ${m}m`;
    }
    if (secs >= 60) {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${m}m ${s}s`;
    }
    return `${secs}s`;
  };

  // ── Rate limited state ──
  if (state === 'rate_limited') {
    return (
      <View testID="pin-entry-rate-limited" style={[s.container, { paddingTop: insets.top + 40 }]}>
        <View style={s.lockCircle}>
          <Ionicons name="time-outline" size={40} color={Colors.orange} />
        </View>
        <Text style={s.lockTitle}>Too Many Attempts</Text>
        <Text style={s.lockSub}>
          Please wait before trying again.
        </Text>
        <View style={s.countdownBox}>
          <Text testID="rate-limit-countdown" style={s.countdownText}>
            {formatTime(countdown)}
          </Text>
        </View>
        <Text style={s.lockHint}>
          Rate limit tiers: 5 fails → 60s, 10 → 15min, 20 → 24h
        </Text>
      </View>
    );
  }

  return (
    <View
      testID="pin-entry-screen"
      style={[s.container, { paddingTop: insets.top + 32 }]}
    >
      <View style={s.header}>
        <Wordmark size="sm" />
        <Text testID="pin-entry-title" style={s.title}>Enter your PIN</Text>
        <Text style={s.sub}>4-digit passcode to sign in</Text>
      </View>

      {/* PIN dots with shake animation */}
      <Animated.View
        style={[s.pinDots, { transform: [{ translateX: shakeAnim }] }]}
      >
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            testID={`pin-dot-${i}`}
            style={[
              s.pinDot,
              pin.length > i && s.pinDotFilled,
              state === 'error' && pin.length === 0 && s.pinDotError,
            ]}
          />
        ))}
      </Animated.View>

      {/* Error message */}
      {!!errorMsg && (
        <View testID="pin-error-banner" style={s.errorBanner}>
          <Ionicons name="alert-circle" size={16} color={Colors.error} />
          <Text style={s.errorText}>{errorMsg}</Text>
        </View>
      )}

      {/* PIN pad */}
      <PinPad
        value={pin}
        onChangeValue={handlePinChange}
        disabled={state === 'submitting'}
      />

      {state === 'submitting' && (
        <ActivityIndicator
          size="small"
          color={Colors.orange}
          style={{ marginTop: 24 }}
        />
      )}

      <Text style={s.footer}>
        {deviceId ? `Device: ${deviceId.slice(0, 12)}…` : 'No device ID'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: Colors.navy,
    alignItems: 'center', paddingHorizontal: 24,
  },
  header: { alignItems: 'center', marginBottom: 32, gap: 10 },
  title: {
    color: Colors.white, fontSize: 24, fontWeight: '800', textAlign: 'center',
    marginTop: 20,
  },
  sub: {
    color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center',
  },

  pinDots: { flexDirection: 'row', gap: 20, marginBottom: 12 },
  pinDot: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.25)',
  },
  pinDotFilled: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  pinDotError: { borderColor: Colors.error },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    marginBottom: 24, maxWidth: 320,
  },
  errorText: { color: Colors.error, fontSize: 13, fontWeight: '600', flex: 1 },

  // Rate limited
  lockCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(249,115,22,0.12)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  lockTitle: {
    color: Colors.white, fontSize: 22, fontWeight: '800', marginBottom: 6,
  },
  lockSub: {
    color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', marginBottom: 20,
  },
  countdownBox: {
    backgroundColor: 'rgba(249,115,22,0.15)', borderRadius: 16,
    paddingHorizontal: 32, paddingVertical: 16, marginBottom: 16,
  },
  countdownText: {
    color: Colors.orange, fontSize: 36, fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  lockHint: {
    color: 'rgba(255,255,255,0.3)', fontSize: 11, textAlign: 'center',
    lineHeight: 16, maxWidth: 260,
  },

  footer: {
    color: 'rgba(255,255,255,0.2)', fontSize: 10, marginTop: 'auto',
    paddingBottom: 24, fontFamily: 'monospace',
  },
});
