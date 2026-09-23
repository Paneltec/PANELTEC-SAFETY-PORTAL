/**
 * Docs tab — DISABLED v58.13.132mc
 * Document Library is now web-only (admin cutover .132ma/.132mb).
 * This stub redirects to Home with an informational toast.
 * File kept because expo-router requires the route file to exist.
 */
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';

export default function DocsRedirect() {
  const router = useRouter();

  useEffect(() => {
    Alert.alert(
      'Documents are web-only',
      'Please use the web app for the document library.',
      [{ text: 'OK', onPress: () => router.replace('/(tabs)/home') }],
    );
  }, [router]);

  return null;
}
