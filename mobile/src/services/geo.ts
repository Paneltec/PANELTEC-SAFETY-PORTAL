/** Small location helpers shared by the job, sign-on and capture screens. */
import { Platform, Linking } from 'react-native';

export type Gps = { lat: number; lng: number; acc: number | null } | null;

export async function readGps(): Promise<Gps> {
  if (Platform.OS === 'web') return null;
  try {
    const Location = require('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy ?? null };
  } catch { return null; }
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180;
  const dp = toR(b.lat - a.lat), dl = toR(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Open turn-by-turn directions in Google Maps (or the phone's default maps app). */
export function openDirections(dest: { lat?: number | null; lng?: number | null; address?: string | null }) {
  const q = dest.lat != null && dest.lng != null ? `${dest.lat},${dest.lng}` : encodeURIComponent(dest.address || '');
  if (!q) return;
  const url = Platform.select({
    ios: `comgooglemaps://?daddr=${q}&directionsmode=driving`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`,
  }) as string;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`));
}

/** Static map image URL when a Google Maps key is configured; null otherwise. */
export function staticMapUrl(lat: number, lng: number, w = 640, h = 360): string | null {
  const key = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || '').trim();
  if (!key) return null;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=${w}x${h}&scale=2&markers=color:0xF97316%7C${lat},${lng}&key=${key}`;
}
