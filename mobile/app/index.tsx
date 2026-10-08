/**
 * v58.13.132cj — Splash / router decision screen.
 *
 * Routing logic:
 *   Legacy preview links now use the normal mobile sign-in.
 *   2. Has valid session_token → (tabs)/home
 *   3. Has device_id but no session → (auth)/pin-entry
 *   4. No device_id → (auth)/welcome (QR provisioning)
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { hasValidSession, isProvisioned } from '../src/services/auth';
import Wordmark from '../src/components/Wordmark';

export default function SplashScreen() {
  const router = useRouter();
  useEffect(() => {
    const check = async () => {
      if (Platform.OS === 'web') {
        sessionStorage.removeItem('paneltec_preview_jwt');
        sessionStorage.removeItem('paneltec_preview_user');
      }
      if (await hasValidSession()) router.replace('/(tabs)/home');
      else if (await isProvisioned()) router.replace('/(auth)/pin-entry');
      else router.replace('/(auth)/welcome');
    };
    check();
  }, []);
  return <View testID="splash-screen" style={s.container}><Wordmark size="lg" /><ActivityIndicator color={Colors.orange} size="large" style={{ marginTop:32 }} /></View>;
}
const s = StyleSheet.create({container:{flex:1,backgroundColor:Colors.navy,alignItems:'center',justifyContent:'center'}});
