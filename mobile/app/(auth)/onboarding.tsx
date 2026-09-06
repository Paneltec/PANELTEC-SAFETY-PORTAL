/**
 * Onboarding wizard — 3 steps.
 * Step 1: Welcome + company from token
 * Step 2: Identity confirmation (name + employee number)
 * Step 3: Create 4-digit PIN
 *
 * If no deep-link token, shows a fallback "Enter setup code" screen.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors } from '../../src/theme/colors';
import { Spacing } from '../../src/theme/spacing';
import Wordmark from '../../src/components/Wordmark';
import PrimaryButton from '../../src/components/PrimaryButton';
import PinPad from '../../src/components/PinPad';
import Card from '../../src/components/Card';
import { redeemOnboardingToken, setPin } from '../../src/services/auth';
import { requestPushPermission, registerDeviceToken } from '../../src/services/push';

type UserData = {
  name: string;
  simpro_employee_id: string;
  company_id: string;
  company_name: string;
};

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string }>();

  const [step, setStep] = useState(0); // 0 = code entry/welcome, 1 = identity, 2 = PIN
  const [code, setCode] = useState(params.token || '');
  const [loading, setLoading] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [tempSession, setTempSession] = useState('');
  const [pin, setPin2] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinStep, setPinStep] = useState<'create' | 'confirm'>('create');

  // If we got a token from deep link, auto-redeem
  useEffect(() => {
    if (params.token) {
      handleRedeem(params.token);
    }
  }, [params.token]);

  const handleRedeem = async (tokenVal?: string) => {
    const t = tokenVal || code.trim();
    if (!t) {
      Alert.alert('Required', 'Please enter your setup code.');
      return;
    }
    setLoading(true);
    try {
      const data = await redeemOnboardingToken(t);
      setUserData(data.user);
      setTempSession(data.temp_session);
      setStep(1);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Invalid or expired code. Check with your office.';
      Alert.alert('Setup Error', msg);
    }
    setLoading(false);
  };

  const handleConfirmIdentity = () => {
    setStep(2);
  };

  const handlePinEntry = async (val: string) => {
    if (pinStep === 'create') {
      setPin2(val);
      if (val.length === 4) {
        // Auto-advance to confirm
        setTimeout(() => {
          setPinStep('confirm');
        }, 200);
      }
    } else {
      setPinConfirm(val);
      if (val.length === 4) {
        if (val !== pin) {
          Alert.alert('Mismatch', 'PINs do not match. Try again.');
          setPin2('');
          setPinConfirm('');
          setPinStep('create');
          return;
        }
        // Submit PIN
        setLoading(true);
        try {
          await setPin(pin, tempSession);
          // Request push permission
          try {
            const pushToken = await requestPushPermission();
            if (pushToken) {
              await registerDeviceToken(pushToken);
            }
          } catch {}
          router.replace('/(tabs)/home');
        } catch (e: any) {
          Alert.alert('Error', e?.response?.data?.detail || 'Failed to set PIN');
          setPin2('');
          setPinConfirm('');
          setPinStep('create');
        }
        setLoading(false);
      }
    }
  };

  // Progress dots
  const ProgressDots = () => (
    <View testID="onboarding-progress" style={s.dots}>
      {[0, 1, 2].map(i => (
        <View key={i} style={[s.dot, i === step && s.dotActive, i < step && s.dotDone]} />
      ))}
    </View>
  );

  // Step 0: Enter code / Welcome
  if (step === 0) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View testID="onboarding-step-0" style={[s.container, { paddingTop: insets.top + 24 }]}>
          <ProgressDots />
          <View style={s.hero}>
            <Wordmark size="md" color={Colors.navy} />
            <Text style={s.heroTitle}>Welcome to the team</Text>
            <Text style={s.heroSub}>
              Enter the 6-digit setup code from your office install card, or scan the QR code.
            </Text>
          </View>

          <Card style={{ width: '100%' }}>
            <Text style={s.fieldLabel}>SETUP CODE</Text>
            <TextInput
              testID="setup-code-input"
              style={s.codeInput}
              placeholder="000000"
              placeholderTextColor={Colors.placeholder}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={40}
              autoFocus
            />
          </Card>

          <View style={s.bottomAction}>
            <PrimaryButton
              testID="onboarding-redeem-btn"
              title="Continue"
              onPress={() => handleRedeem()}
              loading={loading}
              disabled={!code.trim()}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Step 1: Identity confirmation
  if (step === 1 && userData) {
    return (
      <View testID="onboarding-step-1" style={[s.container, { paddingTop: insets.top + 24 }]}>
        <ProgressDots />
        <View style={s.hero}>
          <Text style={s.heroTitle}>Confirm your identity</Text>
          <Text style={s.heroSub}>Check these details match your employee record.</Text>
        </View>

        <Card style={{ width: '100%', gap: 16 }}>
          <View>
            <Text style={s.fieldLabel}>NAME</Text>
            <Text testID="onboarding-name" style={s.fieldValue}>{userData.name}</Text>
          </View>
          <View>
            <Text style={s.fieldLabel}>EMPLOYEE NUMBER</Text>
            <Text testID="onboarding-employee-id" style={s.fieldValue}>{userData.simpro_employee_id}</Text>
          </View>
          <View>
            <Text style={s.fieldLabel}>COMPANY</Text>
            <Text testID="onboarding-company" style={s.fieldValue}>{userData.company_name}</Text>
          </View>
        </Card>

        <View style={s.bottomAction}>
          <PrimaryButton
            testID="onboarding-confirm-btn"
            title="That's me — continue"
            onPress={handleConfirmIdentity}
          />
        </View>
      </View>
    );
  }

  // Step 2: Create PIN
  return (
    <View testID="onboarding-step-2" style={[s.pinContainer, { paddingTop: insets.top + 24 }]}>
      <ProgressDots />
      <Text style={s.pinTitle}>
        {pinStep === 'create' ? 'Create your PIN' : 'Confirm your PIN'}
      </Text>
      <Text style={s.pinSub}>
        {pinStep === 'create' ? 'Choose a 4-digit PIN for daily sign-in.' : 'Enter it again to confirm.'}
      </Text>

      {/* PIN dots display */}
      <View style={s.pinDots}>
        {[0, 1, 2, 3].map(i => (
          <View
            key={i}
            style={[
              s.pinDot,
              (pinStep === 'create' ? pin : pinConfirm).length > i && s.pinDotFilled,
            ]}
          />
        ))}
      </View>

      <PinPad
        value={pinStep === 'create' ? pin : pinConfirm}
        onChangeValue={(v) => handlePinEntry(v)}
        disabled={loading}
      />

      {loading && (
        <ActivityIndicator color={Colors.orange} size="large" style={{ marginTop: 24 }} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    paddingHorizontal: Spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.border,
  },
  dotActive: { backgroundColor: Colors.orange },
  dotDone: { backgroundColor: Colors.textTertiary },
  hero: {
    alignItems: 'center',
    marginBottom: 32,
    gap: 8,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.ink,
    marginTop: 16,
    textAlign: 'center',
  },
  heroSub: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  fieldValue: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.ink,
  },
  codeInput: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.ink,
    textAlign: 'center',
    paddingVertical: 16,
    letterSpacing: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    backgroundColor: Colors.bg,
  },
  bottomAction: {
    marginTop: 'auto',
    paddingBottom: 32,
    paddingTop: 24,
  },
  pinContainer: {
    flex: 1,
    backgroundColor: Colors.navy,
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  pinTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.white,
    marginBottom: 8,
  },
  pinSub: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 32,
    textAlign: 'center',
  },
  pinDots: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 40,
  },
  pinDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'transparent',
  },
  pinDotFilled: {
    backgroundColor: Colors.orange,
    borderColor: Colors.orange,
  },
});
