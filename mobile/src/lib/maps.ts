/**
 * maps.ts — v58.13.132p2
 * Shared map / navigation helpers.
 */
import { Platform, Linking } from 'react-native';

/**
 * Open native maps app with turn-by-turn navigation to the given address.
 * iOS: Apple Maps, Android: Google Maps, Web: Google Maps URL.
 */
export function openMapsToAddress(address: string) {
  const encoded = encodeURIComponent(address);
  const url = Platform.select({
    ios: `maps://?daddr=${encoded}&dirflg=d`,
    android: `google.navigation:q=${encoded}&mode=d`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${encoded}`,
  });
  Linking.openURL(url!).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`)
  );
}

/**
 * Build a Google Static Maps URL (for map card image).
 * Returns null if EXPO_PUBLIC_GOOGLE_MAPS_KEY is not set.
 */
export function getStaticMapUrl(address: string): string | null {
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
  if (!key) return null;
  const encoded = encodeURIComponent(address);
  return `https://maps.googleapis.com/maps/api/staticmap?center=${encoded}&zoom=15&size=640x300&markers=color:red|${encoded}&key=${key}`;
}
