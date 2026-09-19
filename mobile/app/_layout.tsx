/**
 * v58.13.132cz — Root layout (crash-safe rewrite).
 *
 * Changes from .132al:
 *   - Sentry native DISABLED (enableNative: false) — suspected Android crash cause
 *   - JS-level Sentry kept for non-fatal error capture
 *   - ErrorBoundary + CrashRecoveryGate retained
 *   - Boot trace retained
 *   - No expo-notifications init at module scope
 */
import React, { useEffect } from 'react';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ErrorBoundary, CrashRecoveryGate,
  LAST_CRASH_KEY, LAST_REJECTION_KEY, BOOT_TRACE_KEY,
} from '../src/components/ErrorBoundary';
import { getSimulateRole, getCachedSimulateRole, ROLE_OPTIONS, type SimulateRoleId } from '../src/services/simulateRole';

// v58.13.132cj — Sentry init: NATIVE DISABLED to avoid Android pre-JS crash.
// JS-level capture still works for React errors + unhandled promises.
const _SENTRY_DSN = (process.env.EXPO_PUBLIC_SENTRY_DSN || '').trim();
if (_SENTRY_DSN.startsWith('https://')) {
  try {
    Sentry.init({
      dsn: _SENTRY_DSN,
      environment: 'preview',
      tracesSampleRate: 0.1,
      release: 'paneltec-field-app@1.0.7+138',
      debug: false,
      enableNative: false,           // ← DISABLED: suspected crash trigger
      enableAutoSessionTracking: false, // ← DISABLED: native dependency
    });
  } catch (e) {
    console.warn('[.132cj] Sentry.init failed', e);
  }
}

// Keep splash on-screen until mount completes
try { SplashScreen.preventAutoHideAsync().catch(() => {}); } catch {}

// Global JS error + unhandled rejection handlers
const g: any = globalThis;
const originalGlobalHandler = (g?.ErrorUtils?.getGlobalHandler?.() ?? null) as
  | ((error: Error, isFatal?: boolean) => void) | null;

if (g?.ErrorUtils?.setGlobalHandler) {
  g.ErrorUtils.setGlobalHandler(async (error: Error, isFatal?: boolean) => {
    try {
      await AsyncStorage.setItem(LAST_CRASH_KEY, JSON.stringify({
        source: 'GlobalErrorHandler',
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || '',
        isFatal: !!isFatal,
        timestamp: new Date().toISOString(),
        platform: Platform.OS,
      }));
    } catch {}
    if (originalGlobalHandler) {
      try { originalGlobalHandler(error, isFatal); } catch {}
    }
  });
}

const originalRejectionHandler = g?.onunhandledrejection;
g.onunhandledrejection = async (ev: any) => {
  const reason = ev?.reason ?? ev;
  try {
    await AsyncStorage.setItem(LAST_REJECTION_KEY, JSON.stringify({
      reason: String(reason?.message || reason),
      name: reason?.name || 'UnhandledPromiseRejection',
      stack: reason?.stack || '',
      timestamp: new Date().toISOString(),
      platform: Platform.OS,
    }));
  } catch {}
  if (typeof originalRejectionHandler === 'function') {
    try { originalRejectionHandler(ev); } catch {}
  }
};

// Boot trace
type BootStep = { step: string; status: 'ok' | 'error'; error?: string; ts: string };
const bootTrace: BootStep[] = [];

async function traceStep<T>(step: string, fn: () => Promise<T> | T): Promise<T | null> {
  const ts = new Date().toISOString();
  try {
    const result = await fn();
    bootTrace.push({ step, status: 'ok', ts });
    AsyncStorage.setItem(BOOT_TRACE_KEY, JSON.stringify(bootTrace)).catch(() => {});
    return result;
  } catch (e: any) {
    bootTrace.push({
      step, status: 'error',
      error: `${e?.name || 'Error'}: ${e?.message || String(e)}\n${e?.stack || ''}`.slice(0, 4000),
      ts,
    });
    AsyncStorage.setItem(BOOT_TRACE_KEY, JSON.stringify(bootTrace)).catch(() => {});
    console.warn(`[.132cj] boot step "${step}" failed:`, e);
    return null;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 60_000 } },
});

// Preview banner (web-only)
function PreviewBanner() {
  const [role, setRole] = React.useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const check = () => {
      try {
        const raw = sessionStorage.getItem('paneltec_preview_user');
        if (raw) { setRole(JSON.parse(raw)?.role_id || 'role'); }
        else { setRole(null); }
      } catch { setRole(null); }
    };
    check();
    const id = setInterval(check, 1500);
    return () => clearInterval(id);
  }, []);
  if (!role) return null;
  return (
    <View style={s.banner} pointerEvents="none">
      <Text style={s.bannerText} numberOfLines={1}>
        PREVIEW · {String(role).toUpperCase()} · READ-ONLY
      </Text>
    </View>
  );
}

// Simulate-role banner (all platforms, admin-only)
function SimulateBanner() {
  const [role, setRole] = React.useState<SimulateRoleId>('');
  useEffect(() => {
    getSimulateRole().then(setRole);
    const id = setInterval(() => { setRole(getCachedSimulateRole()); }, 2000);
    return () => clearInterval(id);
  }, []);
  if (!role) return null;
  const label = ROLE_OPTIONS.find(o => o.id === role)?.label || role;
  return (
    <View style={s.simBanner} pointerEvents="none">
      <Text style={s.simBannerText} numberOfLines={1}>
        ⚡ SIMULATING: {label.toUpperCase()}
      </Text>
    </View>
  );
}

export default Sentry.wrap(RootLayout);

function RootLayout() {
  useEffect(() => {
    (async () => {
      await traceStep('root-layout-mounted', async () => true);
      if (!bootTrace.some((s) => s.status === 'error')) {
        try { await AsyncStorage.removeItem(BOOT_TRACE_KEY); } catch {}
      }
      try { await SplashScreen.hideAsync(); } catch {}
    })();
  }, []);

  return (
    <ErrorBoundary>
      <CrashRecoveryGate>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <PreviewBanner />
          <SimulateBanner />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="visitor" />
            <Stack.Screen name="forms" />
            <Stack.Screen name="profile" />
          </Stack>
        </QueryClientProvider>
      </CrashRecoveryGate>
    </ErrorBoundary>
  );
}

const s = StyleSheet.create({
  banner: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999,
    backgroundColor: '#F5B301', paddingVertical: 4, paddingHorizontal: 12,
    alignItems: 'center',
  },
  bannerText: {
    color: '#111', fontSize: 10, fontWeight: '800', letterSpacing: 1.2,
  },
  simBanner: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9998,
    backgroundColor: '#7C3AED', paddingVertical: 4, paddingHorizontal: 12,
    alignItems: 'center',
  },
  simBannerText: {
    color: '#FFF', fontSize: 10, fontWeight: '800', letterSpacing: 1.2,
  },
});
