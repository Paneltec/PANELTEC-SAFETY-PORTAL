/**
 * Splash / router decision screen.
 * Checks if user is onboarded → PIN login, else → onboarding.
 */
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { isOnboarded } from '../src/services/auth';
import Wordmark from '../src/components/Wordmark';

export default function SplashScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const check = async () => {
      // Small delay to show splash branding
      await new Promise(r => setTimeout(r, 800));

      // If deep link has onboarding token, go to onboarding
      if (params.token) {
        router.replace({ pathname: '/(auth)/onboarding', params: { token: params.token } });
        return;
      }

      const onboarded = await isOnboarded();
      if (onboarded) {
        router.replace('/(auth)/login');
      } else {
        router.replace('/(auth)/onboarding');
      }
      setChecking(false);
    };
    check();
  }, []);

  return (
    <View testID="splash-screen" style={s.container}>
      <Wordmark size="lg" />
      <ActivityIndicator color={Colors.orange} size="large" style={{ marginTop: 32 }} />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
