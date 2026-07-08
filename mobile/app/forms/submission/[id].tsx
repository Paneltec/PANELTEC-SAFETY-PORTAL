import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Image, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError, API_BASE } from '../../../src/lib/api';
import { Colors } from '../../../src/lib/colors';

export default function SubmissionViewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    api.get(`/forms/submissions/${id}`)
      .then(({ data: d }) => setData(d))
      .catch((e) => Alert.alert('Error', apiError(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const openPdf = async () => {
    setPdfBusy(true);
    try {
      const { data: tok } = await api.post('/forms/submissions/pdf-token', {
        submission_id: id, action: 'view',
      });
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      await Linking.openURL(`${base}${tok.path}`);
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setPdfBusy(false); }
  };

  const renderValue = (f: any) => {
    const v = f.value;
    if (f.type === 'photo') {
      if (!Array.isArray(v) || v.length === 0) return <Text style={vs.noVal}>No photos.</Text>;
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
          {v.map((p: any, i: number) => (
            <Image key={i} source={{ uri: `${base}${p.file_url}` }}
              style={{ width: 120, height: 120, borderRadius: 10, marginRight: 8, borderWidth: 1, borderColor: Colors.border }} />
          ))}
        </ScrollView>
      );
    }
    if (f.type === 'signature') {
      if (!v) return <Text style={vs.noVal}>Not signed.</Text>;
      return <Image source={{ uri: v }} style={vs.sigImage} resizeMode="contain" />;
    }
    if (f.type === 'gps') {
      if (!v || v.lat == null) return <Text style={vs.noVal}>Not captured.</Text>;
      return (
        <View style={vs.gpsBox}>
          <View style={vs.gpsRow}>
            <View style={vs.gpsCell}><Text style={vs.gpsCellLabel}>LAT</Text><Text style={vs.gpsCellVal}>{Number(v.lat).toFixed(5)}</Text></View>
            <View style={vs.gpsCell}><Text style={vs.gpsCellLabel}>LNG</Text><Text style={vs.gpsCellVal}>{Number(v.lng).toFixed(5)}</Text></View>
            <View style={vs.gpsCell}><Text style={vs.gpsCellLabel}>± M</Text><Text style={vs.gpsCellVal}>{Math.round(v.accuracy ?? 0)}</Text></View>
          </View>
        </View>
      );
    }
    if (f.type === 'textarea') return <Text style={vs.valText}>{v || '—'}</Text>;
    return <Text style={vs.valText}>{v ?? '—'}</Text>;
  };

  if (loading) return <SafeAreaView style={vs.safe}><ActivityIndicator testID="subview-loading" style={{ marginTop: 60 }} color={Colors.blue} /></SafeAreaView>;
  if (!data) return <SafeAreaView style={vs.safe}><Text style={{ padding: 24 }}>Submission not found.</Text></SafeAreaView>;

  return (
    <SafeAreaView style={vs.safe} edges={['top']}>
      <View testID="subview-header" style={vs.header}>
        <TouchableOpacity testID="subview-back" onPress={() => router.back()} style={{ padding: 4 }}>
          <Ionicons name="arrow-back" size={20} color="#1e4a8c" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={vs.headerOverline}>SUBMISSION</Text>
          <Text style={vs.headerTitle} numberOfLines={1}>{data.template_name_snapshot || '…'}</Text>
          <Text style={vs.headerMeta}>
            By {data.submitted_by_name} · {(data.submitted_at || '').slice(0, 16).replace('T', ' ')}
          </Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {(data.fields || []).map((f: any) => (
          <View key={f.id} testID={`subview-field-${f.id}`} style={vs.fieldWrap}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              <Text style={vs.fieldLabel}>{f.label}</Text>
              <Text style={vs.fieldType}>{f.type}</Text>
            </View>
            {renderValue(f)}
          </View>
        ))}
      </ScrollView>

      <View style={vs.footer}>
        <TouchableOpacity testID="subview-pdf" style={vs.pdfBtn} onPress={openPdf} disabled={pdfBusy}>
          {pdfBusy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="document" size={14} color="#fff" />}
          <Text style={vs.pdfBtnText}>Download PDF</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const vs = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerOverline: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: Colors.orangeLight },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  headerMeta: { fontSize: 11, color: Colors.orangeLight, marginTop: 2, opacity: 0.8 },
  fieldWrap: { marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.ink },
  fieldType: { fontSize: 9, fontWeight: '600', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  noVal: { fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic' },
  valText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  sigImage: { width: '100%', height: 120, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, marginTop: 4 },
  gpsBox: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, marginTop: 4 },
  gpsRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 12 },
  gpsCell: { flex: 1 },
  gpsCellLabel: { fontSize: 9, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 1, textTransform: 'uppercase' },
  gpsCellVal: { fontSize: 12, fontWeight: '600', color: Colors.ink, marginTop: 2 },
  footer: {
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 24,
    borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg,
  },
  pdfBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1e4a8c', borderRadius: 12, paddingVertical: 14, minHeight: 50,
  },
  pdfBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
