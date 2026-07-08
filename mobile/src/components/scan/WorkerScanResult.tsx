import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert,
  TextInput, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../lib/api';
import { Colors } from '../../lib/colors';

const certTone = (status: string) => {
  const s = (status || '').toLowerCase();
  if (s === 'expired') return { bg: '#FFF1F2', text: '#BE123C', border: '#FECDD3' };
  if (s === 'expiring' || s === 'expiring_soon') return { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' };
  return { bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0' };
};

interface Props { token: string; onReset: () => void; }

export default function WorkerScanResult({ token, onReset }: Props) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [sites, setSites] = useState<any[]>([]);
  const [siteQ, setSiteQ] = useState('');
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/scan/worker/${token}`)
      .then(r => { if (alive) setProfile(r.data); })
      .catch(e => {
        if (!alive) return;
        setError(e?.response?.status === 404
          ? 'Unknown worker QR. The card may have been retired.'
          : e?.response?.data?.detail || e.message);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    if (!signInOpen) return;
    api.get('/forms/pickers/sites', { params: { q: siteQ || undefined, limit: 12 } })
      .then(r => setSites(r.data?.sites || []))
      .catch(() => setSites([]));
  }, [signInOpen, siteQ]);

  const doSignIn = async (site: any) => {
    setSigning(true);
    try {
      await api.post(`/scan/worker/${token}/site-signin`, {
        site_id: site.id, site_name: site.name, gps: null,
      });
      Alert.alert('Success', `Signed in to ${site.name}`);
      setSignInOpen(false);
      // Refetch profile
      const r = await api.get(`/scan/worker/${token}`);
      setProfile(r.data);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || e.message);
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={Colors.blue} />
        <Text style={s.loadText}>Loading worker profile...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.errorCard}>
        <View style={s.errorIcon}>
          <Ionicons name="alert-triangle" size={28} color="#F59E0B" />
        </View>
        <Text style={s.errorTitle}>Scan Error</Text>
        <Text style={s.errorBody}>{error}</Text>
        <TouchableOpacity testID="worker-scan-retry" style={s.retryBtn} onPress={onReset}>
          <Text style={s.retryText}>Scan Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!profile) return null;

  const initials = (profile.name || '?').split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join('');

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      {/* Profile card */}
      <View testID="worker-profile" style={s.profileCard}>
        <View style={s.profileRow}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.workerOverline}>WORKER · {profile.company || 'N/A'}</Text>
            <Text testID="worker-name" style={s.workerName}>{profile.name}</Text>
            {(profile.trade || profile.role) && (
              <Text style={s.workerTrade}>{profile.trade || profile.role}</Text>
            )}
            {profile.active_site_today && (
              <View style={s.activeSiteBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#15803D" />
                <Text style={s.activeSiteText}>Signed in to {profile.active_site_today.name}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Certifications */}
      <View testID="worker-certs" style={s.section}>
        <View style={s.sectionHeader}>
          <Ionicons name="shield-checkmark" size={16} color={Colors.emerald} />
          <Text style={s.sectionTitle}>Certifications</Text>
          <View style={s.countBadge}>
            <Text style={s.countText}>{profile.certifications?.length || 0}</Text>
          </View>
        </View>
        {(!profile.certifications || profile.certifications.length === 0) ? (
          <Text style={s.emptyText}>No certifications on file.</Text>
        ) : (
          profile.certifications.slice(0, 10).map((c: any, i: number) => {
            const tone = certTone(c.status);
            return (
              <View key={i} style={[s.certRow, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                <Text style={[s.certName, { color: tone.text }]} numberOfLines={1}>{c.name}</Text>
                <Text style={[s.certStatus, { color: tone.text }]}>
                  {(c.status || 'current').toUpperCase()}
                  {c.expires_at ? ` · ${c.expires_at.slice(0, 10)}` : ''}
                </Text>
              </View>
            );
          })
        )}
        {profile.certifications?.length > 10 && (
          <Text style={s.moreText}>+ {profile.certifications.length - 10} more</Text>
        )}
      </View>

      {/* Assigned SWMS */}
      {profile.assigned_swms?.length > 0 && (
        <View testID="worker-swms" style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="document-text" size={16} color={Colors.blue} />
            <Text style={s.sectionTitle}>Assigned SWMS</Text>
          </View>
          {profile.assigned_swms.map((sw: any) => (
            <View key={sw.id} style={s.swmsRow}>
              <Text style={s.swmsTitle} numberOfLines={1}>{sw.title} <Text style={s.swmsVer}>v{sw.version}</Text></Text>
              {sw.ack_required && (
                <View style={s.ackBadge}><Text style={s.ackText}>ACK REQ.</Text></View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Sign-in CTA */}
      <TouchableOpacity
        testID="worker-signin-btn"
        style={s.signInBtn}
        onPress={() => setSignInOpen(true)}
        activeOpacity={0.7}
      >
        <Ionicons name="log-in" size={16} color="#fff" />
        <Text style={s.signInText}>Sign in to site</Text>
      </TouchableOpacity>

      <Text style={s.tokenLabel}>Token: {token}</Text>

      <TouchableOpacity testID="worker-scan-back" style={s.backBtn} onPress={onReset}>
        <Ionicons name="arrow-back" size={14} color={Colors.blue} />
        <Text style={s.backText}>Scan another code</Text>
      </TouchableOpacity>

      {/* Site picker modal */}
      {signInOpen && (
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Pick a site to sign in to</Text>
              <TouchableOpacity testID="signin-close" onPress={() => setSignInOpen(false)}>
                <Ionicons name="close" size={20} color={Colors.ink} />
              </TouchableOpacity>
            </View>
            <View style={s.searchBox}>
              <Ionicons name="search" size={14} color={Colors.textTertiary} />
              <TextInput
                testID="signin-search"
                style={s.searchInput}
                value={siteQ}
                onChangeText={setSiteQ}
                placeholder="Search sites..."
                placeholderTextColor={Colors.textTertiary}
              />
            </View>
            <FlatList
              data={sites}
              keyExtractor={item => item.id}
              style={{ maxHeight: 300 }}
              ListEmptyComponent={<Text style={s.emptySites}>No sites found.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  testID={`signin-site-${item.id}`}
                  style={s.siteRow}
                  onPress={() => doSignIn(item)}
                  disabled={signing}
                  activeOpacity={0.7}
                >
                  <Ionicons name="location" size={14} color={Colors.emerald} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.siteRowName} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.siteRowAddr} numberOfLines={1}>{item.address || item.suburb || ''}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadText: { marginTop: 12, fontSize: 14, color: Colors.textSecondary },
  scroll: { padding: 16, paddingBottom: 40 },
  // Error
  errorCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, margin: 16 },
  errorIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#FFFBEB', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink },
  errorBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  retryBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  retryText: { fontSize: 14, fontWeight: '600', color: Colors.blue },
  // Profile
  profileCard: { backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 20, marginBottom: 12 },
  profileRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  avatar: { width: 64, height: 64, borderRadius: 18, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#BFDBFE' },
  avatarText: { fontSize: 22, fontWeight: '700', color: '#1D4ED8' },
  workerOverline: { fontSize: 10, fontWeight: '600', letterSpacing: 1, color: Colors.textTertiary, textTransform: 'uppercase' },
  workerName: { fontSize: 22, fontWeight: '700', color: Colors.ink, marginTop: 2 },
  workerTrade: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  activeSiteBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, backgroundColor: '#F0FDF4', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 },
  activeSiteText: { fontSize: 11, fontWeight: '700', color: '#15803D' },
  // Section
  section: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  countBadge: { backgroundColor: '#F1F5F9', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  countText: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary },
  emptyText: { fontSize: 12, color: Colors.textTertiary },
  // Certs
  certRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, marginBottom: 4 },
  certName: { fontSize: 12, fontWeight: '600', flex: 1, marginRight: 8 },
  certStatus: { fontSize: 10, fontWeight: '700' },
  moreText: { fontSize: 11, color: Colors.textTertiary, marginTop: 4, textAlign: 'center' },
  // SWMS
  swmsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, marginBottom: 4 },
  swmsTitle: { fontSize: 12, fontWeight: '600', color: Colors.ink, flex: 1, marginRight: 8 },
  swmsVer: { color: Colors.textTertiary },
  ackBadge: { backgroundColor: '#FFFBEB', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  ackText: { fontSize: 9, fontWeight: '700', color: '#B45309' },
  // Sign-in
  signInBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2563EB', borderRadius: 16, paddingVertical: 16, marginBottom: 12 },
  signInText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  tokenLabel: { fontSize: 10, color: Colors.textTertiary, textAlign: 'center', letterSpacing: 1, marginBottom: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  backText: { fontSize: 13, color: Colors.blue, fontWeight: '500' },
  // Modal
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modal: { backgroundColor: Colors.surface, borderRadius: 20, width: '100%', maxWidth: 420, maxHeight: '80%', overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, backgroundColor: '#F8FAFC' },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  emptySites: { padding: 16, fontSize: 12, color: Colors.textTertiary, textAlign: 'center' },
  siteRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  siteRowName: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  siteRowAddr: { fontSize: 11, color: Colors.textTertiary },
});
