import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../lib/api';
import { Colors } from '../../lib/colors';

interface Props { token: string; onReset: () => void; }

export default function SupplierScanResult({ token, onReset }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState<any>(null);
  const [ackDocs, setAckDocs] = useState<Set<string>>(new Set());
  const [ackSwms, setAckSwms] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    api.get(`/scan/supplier/${token}`)
      .then(r => { if (alive) setData(r.data); })
      .catch(e => {
        if (alive) setError(e?.response?.status === 404
          ? 'Invalid supplier QR. Contact your safety officer for a fresh QR.'
          : e?.response?.data?.detail || e.message);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  const toggleDoc = (k: string) => {
    setAckDocs(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };
  const toggleSwms = (k: string) => {
    setAckSwms(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };

  const onComplete = async () => {
    setSigning(true);
    try {
      const r = await api.post(`/scan/supplier/${token}/complete-induction`, {
        acknowledged_docs: Array.from(ackDocs),
        acknowledged_swms: Array.from(ackSwms),
      });
      setSigned(r.data);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || e.message);
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#7C3AED" />
        <Text style={s.loadText}>Resolving supplier...</Text>
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
        <TouchableOpacity testID="supplier-scan-retry" style={s.retryBtn} onPress={onReset}>
          <Text style={s.retryText}>Scan Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!data) return null;
  const c = data.contractor;

  if (signed) {
    return (
      <ScrollView contentContainerStyle={s.scroll}>
        <View testID="supplier-induction-confirmation" style={s.successCard}>
          <View style={s.successCircle}>
            <Ionicons name="checkmark" size={32} color="#fff" />
          </View>
          <Text style={s.successTitle}>Induction complete.</Text>
          <Text style={s.successSub}>{c.name}</Text>
          {signed.induction_expires_at && (
            <Text style={s.successExpiry}>Valid through {new Date(signed.induction_expires_at).toLocaleDateString()}</Text>
          )}
          <Text style={s.successFooter}>Welcome aboard. — Paneltec Civil WHS</Text>
          <TouchableOpacity testID="supplier-scan-done" style={s.doneBtn} onPress={onReset}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      {/* Supplier header */}
      <View testID="supplier-scan-resolver" style={s.supplierHeader}>
        <Text style={s.headerOverline}>SUPPLIER INDUCTION</Text>
        <Text style={s.headerName}>{c.name}</Text>
        <View style={s.chipRow}>
          {c.abn && (
            <View style={s.chip}>
              <Text style={s.chipText}>ABN {c.abn}</Text>
            </View>
          )}
          {c.trade && (
            <View style={s.chip}>
              <Ionicons name="briefcase" size={10} color="rgba(255,255,255,0.8)" />
              <Text style={s.chipText}>{c.trade}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Required documents */}
      {data.documents?.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="shield-checkmark" size={14} color="#7C3AED" />
            <Text style={s.sectionTitle}>Required documents</Text>
          </View>
          {data.documents.map((d: any, i: number) => {
            const key = `${d.type || 'doc'}-${i}`;
            return (
              <TouchableOpacity
                key={key}
                testID={`ack-doc-${key}`}
                style={[s.docRow, ackDocs.has(key) && s.docRowActive]}
                onPress={() => toggleDoc(key)}
                activeOpacity={0.7}
              >
                <View style={[s.checkbox, ackDocs.has(key) && s.checkboxActive]}>
                  {ackDocs.has(key) && <Ionicons name="checkmark" size={12} color="#fff" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.docTitle}>{(d.type || 'document').replace(/_/g, ' ')}</Text>
                  <Text style={s.docSub}>
                    {d.status || 'unknown'}
                    {d.expiry_date ? ` · expires ${d.expiry_date.slice(0, 10)}` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* SWMS */}
      {data.active_swms?.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="document-text" size={14} color="#7C3AED" />
            <Text style={s.sectionTitle}>Acknowledge SWMS</Text>
          </View>
          {data.active_swms.map((sw: any) => (
            <TouchableOpacity
              key={sw.id}
              testID={`ack-swms-${sw.id}`}
              style={[s.docRow, ackSwms.has(sw.id) && s.docRowActive]}
              onPress={() => toggleSwms(sw.id)}
              activeOpacity={0.7}
            >
              <View style={[s.checkbox, ackSwms.has(sw.id) && s.checkboxActive]}>
                {ackSwms.has(sw.id) && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.docTitle} numberOfLines={1}>{sw.title}</Text>
                <Text style={s.docSub}>{sw.code || '—'} · {sw.version || 'v?'}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Complete button */}
      <TouchableOpacity
        testID="supplier-signon-btn"
        style={[s.completeBtn, signing && { opacity: 0.6 }]}
        onPress={onComplete}
        disabled={signing}
        activeOpacity={0.7}
      >
        {signing
          ? <ActivityIndicator size="small" color="#fff" />
          : <Ionicons name="checkmark-circle" size={18} color="#fff" />}
        <Text style={s.completeBtnText}>Complete induction</Text>
      </TouchableOpacity>

      <Text style={s.disclaimer}>
        By completing this induction you confirm you've read the documents above and agree to Paneltec Civil's site rules.
      </Text>
      <Text style={s.tokenLabel}>Token: {token}</Text>

      <TouchableOpacity testID="supplier-scan-back" style={s.backBtn} onPress={onReset}>
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
  errorCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, margin: 16 },
  errorIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#FFF1F2', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink },
  errorBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  retryBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  retryText: { fontSize: 14, fontWeight: '600', color: Colors.blue },
  // Header
  supplierHeader: { backgroundColor: '#7C3AED', borderRadius: 20, padding: 20, marginBottom: 16 },
  headerOverline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(255,255,255,0.7)' },
  headerName: { fontSize: 24, fontWeight: '700', color: '#fff', marginTop: 4 },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chipText: { fontSize: 11, color: 'rgba(255,255,255,0.9)', fontWeight: '500' },
  // Section
  section: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: Colors.textSecondary, textTransform: 'uppercase' },
  // Doc rows
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, marginBottom: 6 },
  docRowActive: { borderColor: '#7C3AED', backgroundColor: '#FAF5FF' },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  docTitle: { fontSize: 14, fontWeight: '600', color: Colors.ink, textTransform: 'capitalize' },
  docSub: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  // Complete
  completeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#7C3AED', borderRadius: 14, paddingVertical: 16, marginBottom: 12 },
  completeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disclaimer: { fontSize: 11, color: Colors.textTertiary, textAlign: 'center', marginBottom: 4, lineHeight: 16 },
  tokenLabel: { fontSize: 10, color: Colors.textTertiary, textAlign: 'center', letterSpacing: 1, marginBottom: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  backText: { fontSize: 13, color: Colors.orangeLight, fontWeight: '500' },
  // Success
  successCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 2, borderColor: Colors.emerald },
  successCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { fontSize: 24, fontWeight: '700', color: Colors.ink },
  successSub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  successExpiry: { fontSize: 12, color: Colors.textTertiary, marginTop: 16 },
  successFooter: { fontSize: 11, color: Colors.textTertiary, marginTop: 4 },
  doneBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, backgroundColor: Colors.emerald },
  doneBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
