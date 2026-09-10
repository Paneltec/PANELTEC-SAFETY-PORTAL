/**
 * Onboarding — the QR card flow.
 *
 *   Worker portal prints a card  →  worker scans it with the phone camera
 *   →  /m/onboard/<token> web page ("Download the app" / "Open in app")
 *   →  paneltec://onboard?token=…  →  THIS SCREEN
 *
 * Steps: redeem token → confirm "that's me" → choose a 4-digit PIN
 * (twice) → sign in with it → Home. After this the phone is bound to the
 * worker and the normal PIN screen is used every time.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../src/theme/colors';
import Wordmark from '../src/components/Wordmark';
import PrimaryButton from '../src/components/PrimaryButton';
import PinPad from '../src/components/PinPad';
import Card from '../src/components/Card';
import {
  ensureDeviceId, redeemOnboardingToken, setPinWithTempSession, pinLogin,
  type OnboardingRedeemResponse,
} from '../src/services/auth';
import { requestPushPermission, registerDeviceToken } from '../src/services/push';

type Step = 'redeeming' | 'error' | 'confirm' | 'pin' | 'pin2' | 'saving';

export default function OnboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string }>();

  const [step, setStep] = useState<Step>('redeeming');
  const [error, setError] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [data, setData] = useState<OnboardingRedeemResponse | null>(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => {
    (async () => {
      const token = (params.token || '').toString().trim();
      if (!token) {
        setError('No setup code was found in the link. Scan the QR code on your onboarding card again.');
        setStep('error');
        return;
      }
      try {
        const id = await ensureDeviceId();
        setDeviceId(id);
        const res = await redeemOnboardingToken(token, id);
        setData(res);
        setStep('confirm');
      } catch (e: any) {
        setError(e?.message || 'Could not read this setup code.');
        setStep('error');
      }
    })();
  }, [params.token]);

  const onPin = (v: string) => {
    setPin(v);
    if (v.length === 4) setTimeout(() => setStep('pin2'), 150);
  };

  const onPin2 = async (v: string) => {
    setPin2(v);
    if (v.length < 4) return;
    if (v !== pin) {
      setMismatch(true);
      setPin(''); setPin2('');
      setTimeout(() => { setMismatch(false); setStep('pin'); }, 900);
      return;
    }
    setStep('saving');
    try {
      await setPinWithTempSession(pin, data!.temp_session, deviceId);
      const login = await pinLogin(pin, deviceId);
      if (!login.ok) throw new Error('PIN saved, but signing in failed. Open the app again and enter your PIN.');
      try {
        const pushToken = await requestPushPermission();
        if (pushToken) await registerDeviceToken(pushToken);
      } catch { /* push is optional */ }
      router.replace('/(tabs)/home');
    } catch (e: any) {
      setError(e?.message || 'Could not finish setup.');
      setStep('error');
    }
  };

  const Header = ({ title, sub }: { title: string; sub: string }) => (
    <View style={s.hero}>
      <Wordmark size="md" color={Colors.white} showSubtitle={false} />
      <Text style={s.title}>{title}</Text>
      <Text style={s.sub}>{sub}</Text>
    </View>
  );

  if (step === 'redeeming' || step === 'saving') {
    return (
      <View testID="onboard-busy" style={[s.container, { paddingTop: insets.top + 80 }]}>
        <ActivityIndicator size="large" color={Colors.orange} />
        <Text style={s.busyText}>{step === 'redeeming' ? 'Reading your setup code…' : 'Saving your PIN…'}</Text>
      </View>
    );
  }

  if (step === 'error') {
    return (
      <View testID="onboard-error" style={[s.container, { paddingTop: insets.top + 32 }]}>
        <Header title="Setup didn't finish" sub={error} />
        <View style={s.bottom}>
          <PrimaryButton testID="onboard-error-back" title="Back to start" onPress={() => router.replace('/(auth)/welcome')} />
        </View>
      </View>
    );
  }

  if (step === 'confirm' && data) {
    return (
      <View testID="onboard-confirm" style={[s.container, { paddingTop: insets.top + 32 }]}>
        <Header title="Welcome to the team" sub="Check these details match you, then choose a PIN." />
        <Card style={s.card}>
          <Row label="NAME" value={data.user.name} testID="onboard-name" />
          <Row label="EMPLOYEE NUMBER" value={data.user.simpro_employee_id} testID="onboard-employee-id" />
          <Row label="COMPANY" value={data.user.company_name} testID="onboard-company" />
        </Card>
        <View style={s.bottom}>
          <PrimaryButton testID="onboard-confirm-btn" title="That's me — choose a PIN" onPress={() => setStep('pin')} />
          <TouchableOpacity testID="onboard-not-me" onPress={() => router.replace('/(auth)/welcome')} style={s.linkBtn}>
            <Text style={s.linkText}>That's not me</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const confirming = step === 'pin2';
  return (
    <View testID={confirming ? 'onboard-pin2' : 'onboard-pin'} style={[s.container, { paddingTop: insets.top + 32 }]}>
      <Header
        title={confirming ? 'Enter it once more' : 'Choose a 4-digit PIN'}
        sub={confirming ? 'Just to make sure we have it right.' : "You'll use this every time you open the app."}
      />
      <View style={s.dots}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={[s.dot, ((confirming ? pin2 : pin).length > i) && s.dotOn, mismatch && s.dotBad]} />
        ))}
      </View>
      {mismatch && (
        <View style={s.mismatch}>
          <Ionicons name="alert-circle" size={16} color={Colors.error} />
          <Text style={s.mismatchText}>PINs didn't match — try again</Text>
        </View>
      )}
      <View style={s.pad}>
        <PinPad value={confirming ? pin2 : pin} onChangeValue={confirming ? onPin2 : onPin} disabled={mismatch} />
      </View>
    </View>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text testID={testID} style={s.rowValue}>{value || '—'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy, paddingHorizontal: 24 },
  busyText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 14, textAlign: 'center' },
  hero: { alignItems: 'center', gap: 10, marginBottom: 24 },
  title: { color: Colors.white, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  sub: { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 320 },
  card: { width: '100%', gap: 14 },
  row: { gap: 3 },
  rowLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: Colors.textTertiary },
  rowValue: { fontSize: 16, fontWeight: '600', color: Colors.ink },
  bottom: { marginTop: 'auto', marginBottom: 32, gap: 12 },
  linkBtn: { alignItems: 'center', paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  linkText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '600' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginVertical: 16 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  dotOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  dotBad: { borderColor: Colors.error, backgroundColor: 'transparent' },
  mismatch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 8 },
  mismatchText: { color: Colors.error, fontSize: 13, fontWeight: '600' },
  pad: { marginTop: 'auto', marginBottom: 24 },
});
