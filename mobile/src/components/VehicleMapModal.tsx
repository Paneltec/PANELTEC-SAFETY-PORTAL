import React from 'react';
import {
  View, Text, Modal, StyleSheet, TouchableOpacity, SafeAreaView,
  Platform, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { Colors } from '../lib/colors';
import LiveCountersCard from './LiveCountersCard';
import TripSummaryCard from './TripSummaryCard';

// On web we use an iframe; on native we'd use react-native-webview.
// For the Expo web preview we render an iframe directly.
let WebView: any = null;
try {
  if (Platform.OS !== 'web') {
    WebView = require('react-native-webview').WebView;
  }
} catch {}

type Props = {
  vehicle: any;
  visible: boolean;
  onClose: () => void;
};

export default function VehicleMapModal({ vehicle, visible, onClose }: Props) {
  if (!vehicle) return null;
  const hasGps = typeof vehicle.lat === 'number' && typeof vehicle.lng === 'number';
  const vehicleAsAsset = { ...vehicle, kind: 'vehicle', navixy_device_id: vehicle.id };
  const isLive = vehicle.status !== 'offline';
  const trackerId = vehicle.id;
  const embedSrc = hasGps
    ? `https://maps.google.com/maps?q=${vehicle.lat},${vehicle.lng}&z=15&output=embed`
    : '';
  const directionsUrl = hasGps
    ? `https://www.google.com/maps/dir/?api=1&destination=${vehicle.lat},${vehicle.lng}`
    : '';
  const navixyUrl = trackerId ? `https://my.us.navixy.com/?tracker=${trackerId}` : '';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={s.safe}>
        <View testID="vehicle-map-modal" style={s.container}>
          {/* Header */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text testID="vmm-label" style={s.headerTitle} numberOfLines={1}>{vehicle.label || 'Vehicle'}</Text>
              <View style={s.headerMeta}>
                <View style={[s.dot, { backgroundColor: isLive ? Colors.emerald : Colors.textTertiary }]} />
                <Text style={[s.headerStatus, { color: isLive ? '#047857' : Colors.textTertiary }]}>
                  GPS {isLive ? 'Live' : 'Offline'}
                </Text>
                <Text style={s.headerDivider}>·</Text>
                <Text style={s.headerTracker}>Tracker ID {trackerId}</Text>
              </View>
            </View>
            <TouchableOpacity testID="vehicle-map-close" onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {/* Map body */}
          <View testID="vehicle-map-body" style={s.body}>
            {!hasGps ? (
              <View testID="vehicle-map-no-gps" style={s.noGps}>
                <View style={s.noGpsIcon}>
                  <Ionicons name="location" size={28} color={Colors.textTertiary} />
                </View>
                <Text style={s.noGpsTitle}>Position not currently available</Text>
                <Text style={s.noGpsBody}>This vehicle has not reported a GPS position recently. Try again when the tracker is online.</Text>
              </View>
            ) : Platform.OS === 'web' ? (
              // Web: iframe
              <iframe
                title={`Map of ${vehicle.label || 'vehicle'}`}
                src={embedSrc}
                style={{ border: 0, width: '100%', height: '100%', display: 'block' } as any}
                data-testid="vmm-iframe"
              />
            ) : WebView ? (
              // Native: WebView
              <WebView
                source={{ uri: embedSrc }}
                style={{ flex: 1 }}
                testID="vmm-webview"
              />
            ) : (
              <View style={s.noGps}>
                <Text style={s.noGpsBody}>Map unavailable</Text>
              </View>
            )}
          </View>

          {/* Bottom strip */}
          {hasGps && (
            <View testID="vmm-strip" style={s.strip}>
              <Text testID="vmm-coords" style={s.coords}>
                {vehicle.lat.toFixed(5)}, {vehicle.lng.toFixed(5)}
              </Text>
              <View style={s.links}>
                {directionsUrl ? (
                  <TouchableOpacity testID="vmm-directions" style={s.linkBtn} onPress={() => Linking.openURL(directionsUrl)}>
                    <Text style={s.linkText}>Directions</Text>
                    <Ionicons name="open-outline" size={11} color={Colors.blue} />
                  </TouchableOpacity>
                ) : null}
                {navixyUrl ? (
                  <TouchableOpacity testID="vmm-navixy" style={s.linkBtn} onPress={() => Linking.openURL(navixyUrl)}>
                    <Text style={s.linkText}>Open in Navixy</Text>
                    <Ionicons name="open-outline" size={11} color={Colors.blue} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}

          {/* Asset detail cards */}
          <ScrollView testID="vehicle-cards-section" style={s.cardsSection} contentContainerStyle={s.cardsContent}>
            <LiveCountersCard asset={vehicleAsAsset} />
            <TripSummaryCard asset={vehicleAsAsset} />
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  headerStatus: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  headerDivider: { fontSize: 11, color: Colors.textTertiary },
  headerTracker: { fontSize: 11, color: Colors.textTertiary },
  closeBtn: { padding: 6 },
  body: { height: 280, backgroundColor: '#F1F5F9' },
  cardsSection: { flex: 1, backgroundColor: Colors.bg },
  cardsContent: { padding: 12 },
  noGps: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  noGpsIcon: { width: 64, height: 64, borderRadius: 16, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  noGpsTitle: { fontSize: 20, fontWeight: '700', color: Colors.ink, textAlign: 'center' },
  noGpsBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, maxWidth: 300 },
  strip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.white,
  },
  coords: { fontSize: 12, color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  links: { flexDirection: 'row', gap: 16 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText: { fontSize: 12, fontWeight: '600', color: Colors.blue },
});
