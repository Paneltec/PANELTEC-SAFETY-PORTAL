/**
 * My Sites — v58.13.107
 *
 * Supervisor-only screen. Lists sites created by the current user.
 * View QR and Close actions per site.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import QRModal from '../../src/components/QRModal';
import { toast } from '../../src/lib/toast';

type Site = {
  id: string;
  name: string;
  address?: string;
  created_at: string;
  visitor_url: string;
  qr_payload: string;
  token: string;
  closed?: boolean;
};

export default function MySitesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);

  const loadSites = useCallback(async () => {
    try {
      const { data } = await api.get('/mobile/sites/mine', { params: { active: true } });
      setSites(Array.isArray(data) ? data : data?.sites || data?.items || []);
    } catch (e: any) {
      toast(apiError(e));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { loadSites(); }, []);

  const handleClose = (site: Site) => {
    Alert.alert(
      'Close Site',
      `Are you sure you want to close "${site.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Site',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data } = await api.patch(`/mobile/sites/${site.id}/close`);
              if (data?.already) {
                toast('Already closed');
              } else {
                toast('Site closed');
              }
              loadSites();
            } catch (e: any) {
              Alert.alert('Error', apiError(e));
            }
          },
        },
      ],
    );
  };

  const renderSite = ({ item }: { item: Site }) => {
    const created = new Date(item.created_at);
    const timeStr = created.toLocaleString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    return (
      <View testID={`site-card-${item.id}`} style={s.card}>
        <View style={s.cardHeader}>
          <View style={s.siteIcon}>
            <Ionicons name="location" size={18} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardName}>{item.name}</Text>
            {item.address ? <Text style={s.cardAddress} numberOfLines={1}>{item.address}</Text> : null}
          </View>
        </View>

        <View style={s.cardMeta}>
          <Ionicons name="time-outline" size={13} color={Colors.textTertiary} />
          <Text style={s.metaText}>{timeStr}</Text>
        </View>

        <View style={s.cardActions}>
          <TouchableOpacity
            testID={`site-view-qr-${item.id}`}
            style={s.actionBtn}
            onPress={() => setSelectedSite(item)}
          >
            <Ionicons name="qr-code" size={16} color={Colors.orange} />
            <Text style={s.actionBtnText}>View QR</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID={`site-close-${item.id}`}
            style={[s.actionBtn, s.closeBtn]}
            onPress={() => handleClose(item)}
          >
            <Ionicons name="close-circle-outline" size={16} color={Colors.error} />
            <Text style={[s.actionBtnText, { color: Colors.error }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={[s.safe, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity testID="my-sites-back" onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.blue} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.headerOverline}>SUPERVISOR</Text>
          <Text style={s.headerTitle}>My Sites</Text>
        </View>
        <TouchableOpacity testID="create-site-fab" onPress={() => router.push('/sites/create')} style={s.addBtn}>
          <Ionicons name="add" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={s.centerText}>Loading sites…</Text>
        </View>
      ) : (
        <FlatList
          data={sites}
          keyExtractor={item => item.id}
          renderItem={renderSite}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadSites(); }} tintColor={Colors.orange} />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="location-outline" size={40} color={Colors.textTertiary} />
              <Text style={s.emptyTitle}>No active sites</Text>
              <Text style={s.emptyBody}>Create a site to start tracking sign-ons.</Text>
              <TouchableOpacity testID="empty-create-site" style={s.emptyBtn} onPress={() => router.push('/sites/create')}>
                <Ionicons name="add-circle" size={18} color="#FFFFFF" />
                <Text style={s.emptyBtnText}>Create Site</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* QR Modal */}
      {selectedSite && (
        <QRModal
          visible={!!selectedSite}
          onClose={() => setSelectedSite(null)}
          siteName={selectedSite.name}
          visitorUrl={selectedSite.visitor_url}
          qrPayload={selectedSite.qr_payload}
        />
      )}
    </View>
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
  addBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.blue,
  },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
    boxShadow: '0px 1px 3px rgba(0,0,0,0.04)',
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  siteIcon: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  cardName: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  cardAddress: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, paddingLeft: 50 },
  metaText: { fontSize: 12, color: Colors.textTertiary },
  cardActions: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, minHeight: 44,
  },
  closeBtn: { borderColor: Colors.redSoft },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orange },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centerText: { fontSize: 14, color: Colors.textSecondary },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginBottom: 12 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12,
  },
  emptyBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
