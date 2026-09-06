/**
 * GpsLocationChip — one-tap fetch of the caller's current position +
 * reverse-geocoded street/suburb string. On native (Expo Go) uses
 * `expo-location`; on web falls back to `navigator.geolocation` with
 * a free Nominatim reverse geocode.
 *
 * v160.0.10.1 — introduced for Hazard/Pre-Start/Incident/Plant Inspection
 * to satisfy user's "when you pull up on a site it should put the GPS
 * position street name" request.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Platform, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Colors } from '../lib/colors';

export type GpsFix = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  street?: string;
  suburb?: string;
  formatted?: string;
};

type Props = {
  value?: GpsFix | null;
  onChange: (fix: GpsFix | null) => void;
  testID?: string;
};

async function reverseGeocodeWeb(lat: number, lon: number): Promise<Partial<GpsFix>> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18`,
      { headers: { 'Accept-Language': 'en-AU' } },
    );
    const d = await r.json();
    const addr = d?.address || {};
    const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
    const suburb = addr.suburb || addr.city || addr.town || addr.village || addr.municipality || '';
    return {
      street,
      suburb,
      formatted: [street, suburb].filter(Boolean).join(', ') || d?.display_name,
    };
  } catch {
    return {};
  }
}

export default function GpsLocationChip({ value, onChange, testID }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchFix = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      let lat: number, lon: number, acc: number | null | undefined = null;

      if (Platform.OS === 'web') {
        // Web path — navigator.geolocation. Expo Go on iOS/Android also
        // supports Location.* but browser geolocation is the reliable
        // source on Expo web preview.
        const pos = await new Promise<GeolocationPosition>((res, rej) => {
          if (!navigator.geolocation) return rej(new Error('Geolocation not supported in this browser'));
          navigator.geolocation.getCurrentPosition(res, rej, {
            enableHighAccuracy: true, timeout: 12000, maximumAge: 30000,
          });
        });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        acc = pos.coords.accuracy;
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') throw new Error('Location permission denied');
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        acc = pos.coords.accuracy;
      }

      // Reverse geocode
      let rev: Partial<GpsFix> = {};
      if (Platform.OS === 'web') {
        rev = await reverseGeocodeWeb(lat, lon);
      } else {
        try {
          const [g] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
          if (g) {
            const street = [g.streetNumber, g.street].filter(Boolean).join(' ');
            const suburb = g.district || g.subregion || g.city || g.region || '';
            rev = {
              street, suburb,
              formatted: [street, suburb].filter(Boolean).join(', '),
            };
          }
        } catch { /* geocoding may fail offline; keep coords */ }
      }

      onChange({
        latitude: lat, longitude: lon, accuracy: acc,
        street: rev.street, suburb: rev.suburb,
        formatted: rev.formatted || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      });
    } catch (e: any) {
      setErr(e?.message || 'Failed to fetch GPS');
    } finally {
      setBusy(false);
    }
  }, [onChange]);

  if (!value) {
    return (
      <TouchableOpacity
        testID={testID || 'gps-fetch-btn'}
        style={g.fetchBtn}
        onPress={fetchFix}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator size="small" color={Colors.orange} />
        ) : (
          <Ionicons name="location" size={16} color={Colors.orangeLight} />
        )}
        <Text style={g.fetchBtnText}>{busy ? 'Locating…' : 'Get current location'}</Text>
        {err && <Text style={g.errText}> · {err}</Text>}
      </TouchableOpacity>
    );
  }

  return (
    <View style={g.chip} testID="gps-chip">
      <Ionicons name="location" size={16} color={Colors.orangeLight} />
      <View style={{ flex: 1 }}>
        <Text style={g.chipText} numberOfLines={2}>{value.formatted || `${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}`}</Text>
        <Text style={g.chipMeta}>
          {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}
          {value.accuracy != null ? ` · ±${Math.round(value.accuracy)}m` : ''}
        </Text>
      </View>
      <TouchableOpacity testID="gps-refresh-btn" onPress={fetchFix} disabled={busy} style={g.refreshBtn}>
        {busy ? (
          <ActivityIndicator size="small" color={Colors.orange} />
        ) : (
          <Ionicons name="refresh" size={16} color={Colors.orangeLight} />
        )}
      </TouchableOpacity>
      <TouchableOpacity testID="gps-clear-btn" onPress={() => onChange(null)} style={g.refreshBtn}>
        <Ionicons name="close-circle" size={16} color={Colors.textTertiary} />
      </TouchableOpacity>
    </View>
  );
}

const g = StyleSheet.create({
  fetchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
    backgroundColor: Colors.surfaceLight, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 6,
  },
  fetchBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orangeLight },
  errText: { fontSize: 11, color: Colors.red, marginLeft: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.orangeSoft, borderWidth: 1, borderColor: 'rgba(249,115,22,0.35)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  chipMeta: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  refreshBtn: { padding: 4 },
});
