/**
 * v58.13.132al — Root React ErrorBoundary + crash-recovery gate.
 *
 * Two responsibilities:
 *
 *   1. `ErrorBoundary` (class component) — catches any error thrown
 *      during React tree render / lifecycle. Renders a full-screen
 *      scrollable red diagnostic view + persists the error to
 *      `AsyncStorage` under key `LAST_CRASH` so the very next boot
 *      can surface it even if the offending code path crashes again.
 *
 *   2. `CrashRecoveryGate` — on first mount, checks AsyncStorage
 *      for `LAST_CRASH` / `LAST_UNHANDLED_REJECTION` / `BOOT_TRACE`.
 *      If any exist, renders a recovery screen with the full text +
 *      "Copy to clipboard" + "Dismiss" (which clears the keys and
 *      falls through to normal app render). Instrumentation for
 *      Stephen's `.132ai` blinks-and-disappears bug.
 */
import React from 'react';
import {
  ScrollView, View, Text, StyleSheet, Pressable, Platform,
} from 'react-native';
// v58.13.132ba — expo-clipboard stripped from this diagnostic build.
// The copy-to-clipboard action degrades to a fallback that just
// leaves the crash payload visible on-screen (the user can still
// long-press to select). `Clipboard` is loaded lazily so a missing
// module never blocks the entire ErrorBoundary render.
// TODO(.132bb): restore expo-clipboard once we know it's not the
// launch-crash trigger.
let Clipboard: { setStringAsync?: (s: string) => Promise<void> } = {};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Clipboard = require('expo-clipboard');
} catch {
  Clipboard = {};
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

export const LAST_CRASH_KEY = 'LAST_CRASH';
export const LAST_REJECTION_KEY = 'LAST_UNHANDLED_REJECTION';
export const BOOT_TRACE_KEY = 'BOOT_TRACE';

// ── ErrorBoundary ────────────────────────────────────────────────

type EBProps = { children: React.ReactNode };
type EBState = { error: Error | null; info: string | null };

export class ErrorBoundary extends React.Component<EBProps, EBState> {
  state: EBState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<EBState> {
    return { error };
  }

  async componentDidCatch(error: Error, info: React.ErrorInfo) {
    const payload = {
      source: 'ErrorBoundary',
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: error?.stack || '',
      componentStack: info?.componentStack || '',
      versionCode: (Constants?.expoConfig as any)?.android?.versionCode ?? 'unknown',
      version: Constants?.expoConfig?.version ?? 'unknown',
      platform: Platform.OS,
      timestamp: new Date().toISOString(),
    };
    // Persist FIRST — even if setState below throws, at least the next
    // boot will show what happened.
    try {
      await AsyncStorage.setItem(LAST_CRASH_KEY, JSON.stringify(payload));
    } catch (persistErr) {
      // eslint-disable-next-line no-console
      console.error('[.132al] failed to persist LAST_CRASH', persistErr);
    }
    this.setState({ info: info?.componentStack || null });
  }

  render() {
    if (this.state.error) {
      return (
        <CrashScreen
          title="App crashed — React tree threw during render"
          errorName={this.state.error.name || 'Error'}
          errorMessage={this.state.error.message || String(this.state.error)}
          stack={this.state.error.stack || ''}
          extra={this.state.info || ''}
          onDismiss={() => this.setState({ error: null, info: null })}
        />
      );
    }
    return this.props.children;
  }
}

// ── CrashRecoveryGate ────────────────────────────────────────────

type Recovery =
  | { kind: 'crash'; payload: any }
  | { kind: 'rejection'; payload: any }
  | { kind: 'boot_trace'; payload: any };

export function CrashRecoveryGate({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = React.useState(false);
  const [items, setItems] = React.useState<Recovery[]>([]);

  React.useEffect(() => {
    (async () => {
      const found: Recovery[] = [];
      try {
        const c = await AsyncStorage.getItem(LAST_CRASH_KEY);
        if (c) found.push({ kind: 'crash', payload: safeParse(c) });
      } catch {}
      try {
        const r = await AsyncStorage.getItem(LAST_REJECTION_KEY);
        if (r) found.push({ kind: 'rejection', payload: safeParse(r) });
      } catch {}
      try {
        const b = await AsyncStorage.getItem(BOOT_TRACE_KEY);
        if (b) {
          const trace = safeParse(b);
          if (trace && Array.isArray(trace) && trace.some((s: any) => s.status === 'error')) {
            found.push({ kind: 'boot_trace', payload: trace });
          }
        }
      } catch {}
      setItems(found);
      setChecked(true);
    })();
  }, []);

  const dismiss = async () => {
    try { await AsyncStorage.multiRemove([LAST_CRASH_KEY, LAST_REJECTION_KEY, BOOT_TRACE_KEY]); } catch {}
    setItems([]);
  };

  if (!checked) return null; // brief flash; parent splash still visible
  if (items.length === 0) return <>{children}</>;

  const first = items[0];
  const rest = items.slice(1);
  const title = first.kind === 'crash'
    ? 'Previous crash detected'
    : first.kind === 'rejection'
      ? 'Previous unhandled promise rejection'
      : 'Previous boot failure';
  const errName = first.payload?.name || first.kind;
  const errMsg = first.payload?.message
    || first.payload?.reason
    || (first.kind === 'boot_trace' ? 'Boot step failed — see trace below' : 'Unknown');
  const stack = first.payload?.stack || '';
  const extra = first.kind === 'boot_trace'
    ? JSON.stringify(first.payload, null, 2)
    : (first.payload?.componentStack || '');
  const extraAll = rest.length
    ? '\n\n── additional records ──\n' + JSON.stringify(rest, null, 2)
    : '';

  return (
    <CrashScreen
      title={title}
      errorName={errName}
      errorMessage={errMsg}
      stack={stack}
      extra={extra + extraAll}
      onDismiss={dismiss}
    />
  );
}

// ── Shared crash-screen UI ───────────────────────────────────────

function CrashScreen({
  title, errorName, errorMessage, stack, extra, onDismiss,
}: {
  title: string;
  errorName: string;
  errorMessage: string;
  stack: string;
  extra: string;
  onDismiss: () => void;
}) {
  const versionCode = (Constants?.expoConfig as any)?.android?.versionCode ?? 'unknown';
  const version = Constants?.expoConfig?.version ?? 'unknown';
  const [copied, setCopied] = React.useState(false);

  const fullBlob = React.useMemo(() => [
    `Paneltec Field App · Crash Report`,
    `Version: ${version} · versionCode ${versionCode} · ${Platform.OS}`,
    `Captured: ${new Date().toISOString()}`,
    ``,
    `${errorName}: ${errorMessage}`,
    ``,
    `── STACK ──`,
    stack || '(no stack captured)',
    ``,
    `── EXTRA ──`,
    extra || '(none)',
  ].join('\n'), [errorName, errorMessage, stack, extra, versionCode, version]);

  const copy = async () => {
    try {
      // v58.13.132ba — Clipboard is stripped in this diagnostic
      // build; guard the call so a missing module doesn't blow up
      // the error screen itself.
      if (Clipboard.setStringAsync) {
        await Clipboard.setStringAsync(fullBlob);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.wrapContent}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.subtitle}>
        {version} · vc {String(versionCode)} · {Platform.OS}
      </Text>
      <Text style={s.captureNote}>
        Screenshot this screen and send it to your admin. Then tap Dismiss to try again.
      </Text>

      <View style={s.card}>
        <Text style={s.errName}>{errorName}</Text>
        <Text style={s.errMsg}>{errorMessage}</Text>
      </View>

      {!!stack && (
        <View style={s.card}>
          <Text style={s.sectionLabel}>Stack</Text>
          <Text style={s.mono} selectable>{stack}</Text>
        </View>
      )}

      {!!extra && (
        <View style={s.card}>
          <Text style={s.sectionLabel}>Details</Text>
          <Text style={s.mono} selectable>{extra}</Text>
        </View>
      )}

      <View style={s.buttonRow}>
        <Pressable style={s.buttonPrimary} onPress={copy}>
          <Text style={s.buttonPrimaryText}>{copied ? 'Copied ✓' : 'Copy to clipboard'}</Text>
        </Pressable>
        <Pressable style={s.buttonSecondary} onPress={onDismiss}>
          <Text style={s.buttonSecondaryText}>Dismiss & continue</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return { raw: s }; }
}

// ── Styles ──────────────────────────────────────────────────────

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#7F1D1D' },
  wrapContent: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  title: {
    color: '#FEE2E2',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
  },
  subtitle: {
    color: '#FCA5A5',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 14,
  },
  captureNote: {
    color: '#FEE2E2',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#450A0A',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#B91C1C',
  },
  errName: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  errMsg: {
    color: '#FEF2F2',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  sectionLabel: {
    color: '#FCA5A5',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  mono: {
    color: '#FECACA',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 15,
  },
  buttonRow: {
    marginTop: 8,
    gap: 10,
  },
  buttonPrimary: {
    backgroundColor: '#FEE2E2',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonPrimaryText: {
    color: '#7F1D1D',
    fontSize: 15,
    fontWeight: '800',
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonSecondaryText: {
    color: '#FEE2E2',
    fontSize: 14,
    fontWeight: '700',
  },
});
