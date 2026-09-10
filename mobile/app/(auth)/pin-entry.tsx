/**
 * PIN Entry — v58.13.132cl.
 *
 * "Welcome back" flow:
 *   1. On mount, fetch GET /api/auth/mobile/device-hint?device_id=<uuid>
 *   2. If bound → "Welcome back {first_name}" with role/org subtitle
 *   3. If unbound → generic "Enter your 4-digit PIN"
 *   4. "Not you?" link clears device_id + session, reloads in first-time state
 *
 * PIN submission → POST /api/auth/mobile/pin-login.
 * Handles 200/401/429. Rate-limit countdown timer.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Animated, Easing,
  TouchableOpacity, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import PinPad from '../../src/components/PinPad';
import Wordmark from '../../src/components/Wordmark';
import {
  pinLogin, isPreviewSession, getDeviceId,
  fetchDeviceHint, fullWipe, clearDeviceHintCache,
  type DeviceHintResponse,
} from '../../src/services/auth';

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
  const [hint, setHint] = useState<DeviceHintResponse | null>(null);
  const [hintLoading, setHintLoading] = useState(true);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Init: load device ID + fetch hint ──
  useEffect(() => {
    if (isPreviewSession()) {
      router.replace('/(tabs)/home');
      return;
    }
    (async () => {
      const id = await getDeviceId();
      setDeviceIdState(id);
      if (id) {
        const h = await fetchDeviceHint(id);
        setHint(h);
      }
      setHintLoading(false);
    })();
  }, []);

  // ── Countdown timer for rate limiting ──
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
        setTimeout(() => setState('ready'), 200);
      }
    }
  }, [state, deviceId, router, shake]);

  const handleNotYou = useCallback(() => {
    Alert.alert(
      'Switch User',
      'This will unlink this device — you\u2019ll need to sign in fresh.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink & Reset',
          style: 'destructive',
          onPress: async () => {
            await fullWipe();
            clearDeviceHintCache();
            setHint(null);
            setDeviceIdState(null);
            setHintLoading(false);
            setPin('');
            setErrorMsg('');
            // Navigate to welcome for re-provisioning
            router.replace('/(auth)/welcome');
          },
        },
      ],
    );
  }, [router]);

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

  const isBound = hint?.bound === true;

  // ── Rate limited state ──
  if (state === 'rate_limited') {
    return (
      <View testID="pin-entry-rate-limited" style={[s.container, { paddingTop: insets.top + 40 }]}>
        <View style={s.lockCircle}>
          <Ionicons name="time-outline" size={40} color={Colors.orange} />
        </View>
        <Text style={s.lockTitle}>Too Many Attempts</Text>
        <Text style={s.lockSub}>Please wait before trying again.</Text>
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
      style={[s.container, { paddingTop: insets.top + 24 }]}
    >
      {/* Brand wordmark */}
      <View style={s.brandRow}>
        <Wordmark size="sm" />
      </View>

      {/* Greeting header — bound vs unbound */}
      <View style={s.header}>
        {hintLoading ? (
          <ActivityIndicator size="small" color="rgba(255,255,255,0.3)" />
        ) : isBound ? (
          <>
            <Text testID="pin-entry-title" style={s.welcomeTitle}>
              Welcome back {hint.user_first_name}
            </Text>
            <Text testID="pin-hint-subtitle" style={s.hintSubtitle}>
              {hint.role_label} · {hint.org_name}
            </Text>
            <Text style={s.sub}>Enter your 4-digit PIN to continue</Text>
          </>
        ) : (
          <>
            <Text testID="pin-entry-title" style={s.title}>Enter your 4-digit PIN</Text>
            <Text style={s.sub}>
              First-time setup — your device will be linked{'\n'}to your account after login
            </Text>
          </>
        )}
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
          style={{ marginTop: 16 }}
        />
      )}

      {/* "Not you?" link — only when device is bound */}
      {isBound && (
        <TouchableOpacity
          testID="not-you-btn"
          style={s.notYouBtn}
          onPress={handleNotYou}
        >
          <Text style={s.notYouText}>Not you? Sign in as a different user</Text>
        </TouchableOpacity>
      )}

      <Text style={s.footer}>
        {deviceId ? `Device: ${deviceId.slice(0, 16)}…` : 'No device ID'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: Colors.navy,
    alignItems: 'center', paddingHorizontal: 24,
  },

  brandRow: { marginBottom: 20 },

  header: { alignItems: 'center', marginBottom: 28, gap: 6 },
  title: {
    color: Colors.white, fontSize: 22, fontWeight: '800', textAlign: 'center',
  },
  welcomeTitle: {
    color: Colors.white, fontSize: 24, fontWeight: '800', textAlign: 'center',
  },
  hintSubtitle: {
    color: Colors.orange, fontSize: 13, fontWeight: '700',
    textAlign: 'center', letterSpacing: 0.3,
  },
  sub: {
    color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center',
    lineHeight: 19, marginTop: 2,
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
    marginBottom: 20, maxWidth: 320,
  },
  errorText: { color: Colors.error, fontSize: 13, fontWeight: '600', flex: 1 },

  // Not you link
  notYouBtn: { marginTop: 20, paddingVertical: 8 },
  notYouText: {
    color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: '600',
    textDecorationLine: 'underline',
  },

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
    color: 'rgba(255,255,255,0.15)', fontSize: 10, marginTop: 'auto',
    paddingBottom: 24, fontFamily: 'monospace',
  },
});
