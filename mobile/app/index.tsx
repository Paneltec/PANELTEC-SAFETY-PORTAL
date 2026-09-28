/**
 * v58.13.132cj — Splash / router decision screen.
 *
 * Routing logic:
 *   1. Web preview with preview_role+preview_token → exchange → (tabs)/home
 *   2. Has valid session_token → (tabs)/home
 *   3. Has device_id but no session → (auth)/pin-entry
 *   4. No device_id → (auth)/welcome (QR provisioning)
 */
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { hasValidSession, isProvisioned } from '../src/services/auth';
import Wordmark from '../src/components/Wordmark';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;
export const PREVIEW_JWT_KEY = 'paneltec_preview_jwt';
export const PREVIEW_USER_KEY = 'paneltec_preview_user';

type Params = {
  token?: string;
  preview_role?: string;
  preview_scope?: string;
  preview_token?: string;
  preview_worker_id?: string;
  reset?: string;
};

async function exchangeForPreviewSession(
  role: string, adminJwt: string, workerId?: string, scope?: string,
) {
  const params = new URLSearchParams();
  if (scope) params.set('scope', scope);
  else params.set('role_id', role);
  if (workerId) params.set('worker_id', workerId);
  const url = `${API}/api/mobile/preview-user?${params.toString()}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${adminJwt}` },
  });
  if (!resp.ok) throw new Error(`Preview exchange failed: ${resp.status}`);
  return resp.json();
}

export default function SplashScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const [previewMsg, setPreviewMsg] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      // Reset request
      if (Platform.OS === 'web' && params.reset === '1') {
        try {
          sessionStorage.removeItem(PREVIEW_JWT_KEY);
          sessionStorage.removeItem(PREVIEW_USER_KEY);
        } catch { /* noop */ }
      }

      // Live Preview branch (web only)
      if (Platform.OS === 'web' && params.preview_role && params.preview_token) {
        try {
          setPreviewMsg(`Loading preview: ${params.preview_role}…`);
          const res = await exchangeForPreviewSession(
            String(params.preview_role),
            String(params.preview_token),
            params.preview_worker_id ? String(params.preview_worker_id) : undefined,
            params.preview_scope ? String(params.preview_scope) : undefined,
          );
          sessionStorage.setItem(PREVIEW_JWT_KEY, res.token);
          sessionStorage.setItem(PREVIEW_USER_KEY, JSON.stringify(res.user));
          await new Promise(r => setTimeout(r, 300));
          router.replace('/(tabs)/home');
          return;
        } catch (e: any) {
          setPreviewMsg(`Preview failed: ${e?.response?.status || 'network error'}`);
          return;
        }
      }

      // Brief splash delay
      await new Promise(r => setTimeout(r, 600));

      // Standard routing
      if (await hasValidSession()) {
        router.replace('/(tabs)/home');
      } else if (await isProvisioned()) {
        router.replace('/(auth)/pin-entry');
      } else {
        router.replace('/(auth)/welcome');
      }
    };
    check();
  }, []);

  return (
    <View testID="splash-screen" style={s.container}>
      <Wordmark size="lg" />
      <ActivityIndicator color={Colors.orange} size="large" style={{ marginTop: 32 }} />
      {previewMsg && (
        <Text style={s.previewMsg} testID="splash-preview-msg">
          {previewMsg}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: Colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  previewMsg: {
    marginTop: 24, color: Colors.orange,
    fontSize: 12, fontWeight: '600', letterSpacing: 0.5,
  },
});
