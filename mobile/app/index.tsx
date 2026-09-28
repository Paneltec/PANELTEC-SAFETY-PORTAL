/**
 * Phase 4 — Splash / router decision screen.
 * Routes to login or tabs based on civil JWT presence.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { hasCivilSession } from '../src/services/civilApi';

const BRAND_BLUE = '#2C6BFF';
const BRAND_BG = '#0F172A';

export default function SplashScreen() {
  const router = useRouter();

  useEffect(() => {
    const check = async () => {
      await new Promise(r => setTimeout(r, 500));
      if (await hasCivilSession()) {
        router.replace('/(tabs)/home');
      } else {
        router.replace('/(auth)/login');
      }
    };
    check();
  }, []);

  return (
    <View testID="splash-screen" style={s.container}>
      <View style={s.logoWrap}>
        <View style={s.chevron}>
          <Ionicons name="shield-checkmark" size={36} color="#FFF" />
        </View>
        <Text style={s.brand}>Paneltec Civil</Text>
        <Text style={s.sub}>WHS Compliance</Text>
      </View>
      <ActivityIndicator color={BRAND_BLUE} size="large" style={{ marginTop: 32 }} />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    alignItems: 'center',
  },
  chevron: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: BRAND_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  brand: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
    marginTop: 4,
  },
});
