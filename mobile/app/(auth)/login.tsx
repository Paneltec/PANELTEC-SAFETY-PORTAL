/**
 * Daily PIN login screen — mockup 01 style.
 * Navy bg, Wordmark hero, PIN pad, biometric fallback.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import Wordmark from '../../src/components/Wordmark';
import PinPad from '../../src/components/PinPad';
import { verifyPin, getStoredUser, isBiometricEnabled, isOnboarded } from '../../src/services/auth';
import { MOBILE_BUNDLE_VERSION } from '../../src/lib/version';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [userName, setUserName] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    (async () => {
      // Check if user is onboarded
      const onboarded = await isOnboarded();
      if (!onboarded) {
        router.replace('/(auth)/onboarding');
        return;
      }
      const user = await getStoredUser();
      if (user?.name) setUserName(user.name);

      // Check biometric (native only)
      const bioEnabled = await isBiometricEnabled();
      if (bioEnabled && Platform.OS !== 'web') {
        const LocalAuthentication = require('expo-local-authentication');
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        setBiometricAvailable(hasHardware && isEnrolled);
      }
    })();
  }, []);

  // Lockout timer
  useEffect(() => {
    if (!locked || lockSeconds <= 0) return;
    const t = setInterval(() => {
      setLockSeconds(prev => {
        if (prev <= 1) {
          setLocked(false);
          clearInterval(t);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [locked, lockSeconds]);

  const handlePinChange = useCallback(async (val: string) => {
    setPin(val);
    if (val.length === 4) {
      setLoading(true);
      const result = await verifyPin(val);
      if (result.ok) {
        router.replace('/(tabs)/home');
      } else if (result.locked) {
        setLocked(true);
        setLockSeconds(result.lockSeconds || 60);
        setPin('');
      } else {
        setPin('');
        Alert.alert('Wrong PIN', 'Please try again.');
      }
      setLoading(false);
    }
  }, [router]);

  const handleBiometric = async () => {
    if (Platform.OS === 'web') return;
    const LocalAuthentication = require('expo-local-authentication');
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Sign in to Paneltec Civil Field',
      fallbackLabel: 'Use PIN',
    });
    if (result.success) {
      // For biometric, we just need to verify the stored JWT is still valid
      router.replace('/(tabs)/home');
    }
  };

  return (
    <View testID="login-screen" style={[s.container, { paddingTop: insets.top + 32 }]}>
      <View style={s.header}>
        <Wordmark size="md" />
        {userName ? (
          <Text style={s.greeting}>Welcome back, {userName.split(' ')[0]}</Text>
        ) : null}
      </View>

      {locked ? (
        <View style={s.lockBox}>
          <Ionicons name="lock-closed" size={40} color={Colors.orange} />
          <Text style={s.lockTitle}>Too many attempts</Text>
          <Text style={s.lockSub}>Try again in {lockSeconds}s</Text>
        </View>
      ) : (
        <>
          <Text style={s.prompt}>Enter your PIN</Text>
          {/* PIN dots */}
          <View style={s.pinDots}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[s.pinDot, pin.length > i && s.pinDotFilled]} />
            ))}
          </View>

          <PinPad
            value={pin}
            onChangeValue={handlePinChange}
            disabled={loading}
          />

          {loading && (
            <ActivityIndicator color={Colors.orange} size="small" style={{ marginTop: 16 }} />
          )}
        </>
      )}

      {/* Biometric button */}
      {biometricAvailable && !locked && (
        <TouchableOpacity
          testID="biometric-btn"
          style={s.bioBtn}
          onPress={handleBiometric}
          activeOpacity={0.7}
        >
          <Ionicons name="finger-print" size={28} color={Colors.orange} />
          <Text style={s.bioText}>Use biometrics</Text>
        </TouchableOpacity>
      )}

      <Text style={s.version}>{MOBILE_BUNDLE_VERSION}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.navy,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  header: { alignItems: 'center', marginBottom: 40, gap: 12 },
  greeting: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500',
  },
  prompt: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: 20,
  },
  pinDots: { flexDirection: 'row', gap: 16, marginBottom: 36 },
  pinDot: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
  },
  pinDotFilled: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  lockBox: { alignItems: 'center', gap: 12, marginTop: 40 },
  lockTitle: { fontSize: 20, fontWeight: '700', color: Colors.white },
  lockSub: { fontSize: 15, color: 'rgba(255,255,255,0.6)' },
  bioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 32,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  bioText: { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  version: {
    position: 'absolute',
    bottom: 16,
    fontSize: 10,
    color: 'rgba(255,255,255,0.25)',
    fontWeight: '500',
  },
});
