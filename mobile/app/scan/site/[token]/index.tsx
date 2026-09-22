/**
 * Site scan resolver — v58.13.132kk
 * Public route: /scan/site/{token}
 *
 * Mirrors web SiteScanResolver. Fetches GET /api/scan/site/{token} (public).
 * - Unauthenticated → redirect to visitor form
 * - Authenticated → worker sign-on
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../src/theme/colors';
import { hasValidSession } from '../../../../src/services/auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function SiteScanResolverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        // Verify token is valid (public endpoint, no auth)
        const res = await fetch(`${API}/api/scan/site/${token}`);
        if (res.status === 404) {
          setError('Invalid or expired QR code. This sign-on link doesn\'t match any active site.');
          return;
        }
        if (!res.ok) {
          setError('Something went wrong. Please try again.');
          return;
        }

        // If user is authenticated → worker sign-on on this screen (future)
        // For now, both authed and non-authed go to visitor form
        const isAuthed = await hasValidSession();
        if (isAuthed) {
          // Worker sign-on — redirect to visitor form for now
          // TODO: build worker-specific sign-on screen
          router.replace({ pathname: '/scan/site/[token]/visitor', params: { token } } as never);
        } else {
          // Visitor → public visitor form
          router.replace({ pathname: '/scan/site/[token]/visitor', params: { token } } as never);
        }
      } catch {
        setError('Network error. Check your connection and try again.');
      }
    })();
  }, [token, router]);

  if (error) {
    return (
      <View testID="site-scan-error" style={[st.container, { paddingTop: insets.top + 40 }]}>
        <View style={st.errorCard}>
          <View style={st.errorIconWrap}>
            <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
          </View>
          <Text style={st.errorTitle}>Invalid QR Code</Text>
          <Text style={st.errorBody}>{error}</Text>
          <Text style={st.errorHint}>Ask your supervisor for a fresh QR.</Text>
        </View>
      </View>
    );
  }

  return (
    <View testID="site-scan-loading" style={[st.container, { paddingTop: insets.top + 40 }]}>
      <ActivityIndicator size="large" color={Colors.orange} />
      <Text style={st.loadingText}>Resolving site…</Text>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { fontSize: 14, color: Colors.textTertiary, marginTop: 12 },
  errorCard: { alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 24, padding: 32, width: '100%', maxWidth: 360 },
  errorIconWrap: { marginBottom: 16 },
  errorTitle: { fontSize: 20, fontWeight: '800', color: Colors.ink, marginBottom: 8 },
  errorBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  errorHint: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center' },
});
