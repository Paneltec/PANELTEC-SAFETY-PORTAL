import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../lib/api';
import { getUser } from '../../lib/auth';
import { Colors } from '../../lib/colors';

const ELEVATED = new Set(['admin', 'manager', 'hseq_lead', 'supervisor']);

interface Props { token: string; onReset: () => void; }

export default function SiteScanResult({ token, onReset }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState<any>(null);
  const [ackSwms, setAckSwms] = useState<Set<string>>(new Set());
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    getUser().then(setUser);
    let alive = true;
    api.get(`/scan/site/${token}`)
      .then(r => { if (alive) setData(r.data); })
      .catch(e => {
        if (alive) setError(e?.response?.status === 404
          ? 'Invalid or expired QR code. Ask your supervisor for a fresh QR.'
          : e?.response?.data?.detail || e.message);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  const toggleAck = (id: string) => {
    setAckSwms(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const onSignOn = async () => {
    setSigning(true);
    try {
      const payload: any = { swms_acknowledged: Array.from(ackSwms) };
      const r = await api.post(`/scan/site/${token}/sign-on`, payload);
      setSigned(r.data);
    } catch (e: any) {
      Alert.alert('Sign-on failed', e?.response?.data?.detail || e.message);
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={Colors.blue} />
        <Text style={s.loadText}>Resolving site...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.errorCard}>
        <View style={s.errorIcon}>
          <Ionicons name="alert-circle" size={28} color="#E11D48" />
        </View>
        <Text style={s.errorTitle}>QR Error</Text>
        <Text style={s.errorBody}>{error}</Text>
        <TouchableOpacity testID="site-scan-retry" style={s.retryBtn} onPress={onReset}>
          <Text style={s.retryText}>Scan Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!data) return null;
  const site = data.site;

  if (signed) {
    return (
      <ScrollView contentContainerStyle={s.scroll}>
        <View testID="site-signon-confirmation" style={s.successCard}>
          <View style={s.successCircle}>
            <Ionicons name="checkmark" size={32} color="#fff" />
          </View>
          <Text style={s.successTitle}>You're signed on.</Text>
          <Text style={s.successSite}>{site.name}</Text>
          {signed.pass_expires_at && (
            <Text style={s.successExpiry}>
              Quick-access pass expires {new Date(signed.pass_expires_at).toLocaleString()}
            </Text>
          )}
          <Text style={s.successFooter}>Stay safe out there. — Paneltec Civil WHS</Text>
          <TouchableOpacity testID="site-scan-done" style={s.doneBtn} onPress={onReset}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      {/* Site header */}
      <View testID="site-scan-resolver" style={s.siteHeader}>
        <Text style={s.siteOverline}>SITE SIGN-ON</Text>
        <Text style={s.siteName}>{site.name}</Text>
        {(site.address || site.suburb) && (
          <View style={s.addrRow}>
            <Ionicons name="location" size={13} color="rgba(255,255,255,0.85)" />
            <Text style={s.siteAddr}>{site.address || `${site.suburb}, ${site.state || ''}`.trim()}</Text>
          </View>
        )}
      </View>

      {/* SWMS acknowledgment */}
      {data.active_swms?.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="shield-checkmark" size={14} color={Colors.emerald} />
            <Text style={s.sectionTitle}>Acknowledge SWMS for this site</Text>
          </View>
          {data.active_swms.map((sw: any) => (
            <TouchableOpacity
              key={sw.id}
              testID={`ack-swms-${sw.id}`}
              style={[s.swmsRow, ackSwms.has(sw.id) && s.swmsRowActive]}
              onPress={() => toggleAck(sw.id)}
              activeOpacity={0.7}
            >
              <View style={[s.checkbox, ackSwms.has(sw.id) && s.checkboxActive]}>
                {ackSwms.has(sw.id) && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.swmsTitle} numberOfLines={1}>{sw.title}</Text>
                <Text style={s.swmsSub}>{sw.code || '—'} · {sw.version || 'v?'}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Sign-on button */}
      <TouchableOpacity
        testID="site-signon-btn"
        style={[s.signOnBtn, signing && { opacity: 0.6 }]}
        onPress={onSignOn}
        disabled={signing}
        activeOpacity={0.7}
      >
        {signing
          ? <ActivityIndicator size="small" color="#fff" />
          : <Ionicons name="checkmark-circle" size={18} color="#fff" />}
        <Text style={s.signOnText}>Sign me on</Text>
      </TouchableOpacity>

      <Text style={s.disclaimer}>
        By signing on you confirm you're fit-for-work and have read the SWMS above.
      </Text>
      <Text style={s.tokenLabel}>Token: {token}</Text>

      <TouchableOpacity testID="site-scan-back" style={s.backBtn} onPress={onReset}>
        <Ionicons name="arrow-back" size={14} color={Colors.blue} />
        <Text style={s.backText}>Scan another code</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadText: { marginTop: 12, fontSize: 14, color: Colors.textSecondary },
  scroll: { padding: 16, paddingBottom: 40 },
  // Error
  errorCard: { backgroundColor: '#fff', borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, margin: 16 },
  errorIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#FFF1F2', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink },
  errorBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  retryBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  retryText: { fontSize: 14, fontWeight: '600', color: Colors.blue },
  // Site header
  siteHeader: { backgroundColor: '#2563EB', borderRadius: 20, padding: 20, marginBottom: 16 },
  siteOverline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(255,255,255,0.7)' },
  siteName: { fontSize: 24, fontWeight: '700', color: '#fff', marginTop: 4 },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  siteAddr: { fontSize: 13, color: 'rgba(255,255,255,0.9)' },
  // SWMS section
  section: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: Colors.textSecondary, textTransform: 'uppercase' },
  swmsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, marginBottom: 6 },
  swmsRowActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  swmsTitle: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  swmsSub: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  // Sign-on
  signOnBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2563EB', borderRadius: 14, paddingVertical: 16, marginBottom: 12 },
  signOnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disclaimer: { fontSize: 11, color: Colors.textTertiary, textAlign: 'center', marginBottom: 4, lineHeight: 16 },
  tokenLabel: { fontSize: 10, color: Colors.textTertiary, textAlign: 'center', letterSpacing: 1, marginBottom: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  backText: { fontSize: 13, color: Colors.blue, fontWeight: '500' },
  // Success
  successCard: { backgroundColor: '#fff', borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 2, borderColor: '#A7F3D0' },
  successCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { fontSize: 24, fontWeight: '700', color: Colors.ink },
  successSite: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  successExpiry: { fontSize: 12, color: Colors.textTertiary, marginTop: 16 },
  successFooter: { fontSize: 11, color: Colors.textTertiary, marginTop: 4 },
  doneBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, backgroundColor: Colors.emerald },
  doneBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
