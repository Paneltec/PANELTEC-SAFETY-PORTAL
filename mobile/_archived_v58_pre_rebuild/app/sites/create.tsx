/**
 * Create Site — v58.13.107
 *
 * Supervisor-only screen. GPS auto-fetch on mount, reverse-geocode for
 * address, then POST /api/mobile/sites. On success, shows QR modal.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import api, { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { useAuth, useCan } from '../../src/lib/AuthContext';
import QRModal from '../../src/components/QRModal';
import { toast } from '../../src/lib/toast';

type GpsState = {
  lat: number;
  lng: number;
  accuracy: number;
} | null;

type CreateResult = {
  site_id: string;
  token: string;
  visitor_url: string;
  qr_payload: string;
  created: boolean;
};

export default function CreateSiteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { perms } = useAuth();
  const can = useCan();

  // GPS state
  const [gps, setGps] = useState<GpsState>(null);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Success state
  const [result, setResult] = useState<CreateResult | null>(null);
  const [showQR, setShowQR] = useState(false);

  // Fetch GPS
  const fetchGps = useCallback(async () => {
    setGpsLoading(true);
    setGpsError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsError('Location permission denied. Please enable it in Settings.');
        setGpsLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setGps({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? 0,
      });

      // Reverse geocode for address
      try {
        const [geo] = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (geo) {
          const parts = [geo.streetNumber, geo.street, geo.city, geo.region].filter(Boolean);
          if (parts.length > 0 && !address) {
            setAddress(parts.join(', '));
          }
        }
      } catch {}
    } catch (e: any) {
      setGpsError(e?.message || 'Failed to get location');
    }
    setGpsLoading(false);
  }, []);

  useEffect(() => { fetchGps(); }, []);

  // Submit
  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter a site name.');
      return;
    }
    if (!gps) {
      Alert.alert('GPS Required', 'Please wait for GPS lock before creating a site.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        address: address.trim() || undefined,
        gps_lat: gps.lat,
        gps_lng: gps.lng,
        gps_accuracy_m: Math.round(gps.accuracy),
        notes: notes.trim() || undefined,
      };
      const { data } = await api.post('/mobile/sites', payload);
      setResult(data);
      setShowQR(true);
      toast(data.created ? 'Site created!' : 'Reused nearby site');
    } catch (e: any) {
      Alert.alert('Error', apiError(e));
    }
    setSaving(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[s.safe, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity testID="create-site-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={22} color={Colors.blue} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.headerOverline}>NEW</Text>
            <Text style={s.headerTitle}>Create Site</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {/* GPS section */}
          <View style={s.gpsCard}>
            <View style={s.gpsHeader}>
              <Ionicons name="location" size={18} color={Colors.orange} />
              <Text style={s.gpsTitle}>GPS Location</Text>
            </View>
            {gpsLoading ? (
              <View style={s.gpsLoadingRow}>
                <ActivityIndicator size="small" color={Colors.orange} />
                <Text style={s.gpsLoadingText}>Getting your location…</Text>
              </View>
            ) : gpsError ? (
              <View>
                <View style={s.gpsErrorRow}>
                  <Ionicons name="alert-circle" size={16} color={Colors.error} />
                  <Text style={s.gpsErrorText}>{gpsError}</Text>
                </View>
                <TouchableOpacity testID="gps-retry" style={s.refreshBtn} onPress={fetchGps}>
                  <Ionicons name="refresh" size={16} color={Colors.orange} />
                  <Text style={s.refreshText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : gps ? (
              <View>
                <View style={s.gpsDataRow}>
                  <View style={s.gpsDatum}>
                    <Text style={s.gpsDatumLabel}>Latitude</Text>
                    <Text testID="gps-lat" style={s.gpsDatumValue}>{gps.lat.toFixed(6)}</Text>
                  </View>
                  <View style={s.gpsDatum}>
                    <Text style={s.gpsDatumLabel}>Longitude</Text>
                    <Text testID="gps-lng" style={s.gpsDatumValue}>{gps.lng.toFixed(6)}</Text>
                  </View>
                  <View style={s.gpsDatum}>
                    <Text style={s.gpsDatumLabel}>Accuracy</Text>
                    <Text testID="gps-acc" style={s.gpsDatumValue}>±{Math.round(gps.accuracy)}m</Text>
                  </View>
                </View>
                <TouchableOpacity testID="gps-refresh" style={s.refreshBtn} onPress={fetchGps}>
                  <Ionicons name="refresh" size={14} color={Colors.orange} />
                  <Text style={s.refreshText}>Refresh GPS</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {/* Form fields */}
          <Text style={s.fieldLabel}>SITE NAME <Text style={{ color: Colors.error }}>*</Text></Text>
          <TextInput
            testID="site-name-input"
            style={s.input}
            placeholder="e.g. Westfield Tower Crane Pad"
            placeholderTextColor={Colors.placeholder}
            value={name}
            onChangeText={setName}
            returnKeyType="next"
          />

          <Text style={s.fieldLabel}>ADDRESS</Text>
          <TextInput
            testID="site-address-input"
            style={s.input}
            placeholder="Auto-filled from GPS or type manually"
            placeholderTextColor={Colors.placeholder}
            value={address}
            onChangeText={setAddress}
            returnKeyType="next"
          />

          <Text style={s.fieldLabel}>NOTES</Text>
          <TextInput
            testID="site-notes-input"
            style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
            placeholder="Optional site notes"
            placeholderTextColor={Colors.placeholder}
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          {/* Submit */}
          <TouchableOpacity
            testID="create-site-submit"
            style={[s.submitBtn, (!name.trim() || !gps || saving) && { opacity: 0.5 }]}
            onPress={handleCreate}
            disabled={!name.trim() || !gps || saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="add-circle" size={20} color="#FFFFFF" />
            )}
            <Text style={s.submitText}>Create Site</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* QR Modal on success */}
        {result && (
          <QRModal
            visible={showQR}
            onClose={() => { setShowQR(false); router.back(); }}
            siteName={result.created ? name : name}
            visitorUrl={result.visitor_url}
            qrPayload={result.qr_payload}
            reused={!result.created}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerOverline: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: Colors.textTertiary },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  content: { padding: 16, paddingBottom: 48 },
  gpsCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: Colors.border,
    boxShadow: '0px 1px 3px rgba(0,0,0,0.04)',
    elevation: 1,
  },
  gpsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  gpsTitle: { fontSize: 14, fontWeight: '700', color: Colors.ink },
  gpsLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  gpsLoadingText: { fontSize: 13, color: Colors.textSecondary },
  gpsErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  gpsErrorText: { fontSize: 13, color: Colors.error, flex: 1 },
  gpsDataRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  gpsDatum: { flex: 1 },
  gpsDatumLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary, textTransform: 'uppercase', marginBottom: 2 },
  gpsDatumValue: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.orangeSoft,
  },
  refreshText: { fontSize: 12, fontWeight: '600', color: Colors.orange },
  fieldLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textTertiary,
    marginBottom: 6, textTransform: 'uppercase',
  },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    color: Colors.ink, marginBottom: 16, minHeight: 48,
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 16, marginTop: 8, minHeight: 54,
  },
  submitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
