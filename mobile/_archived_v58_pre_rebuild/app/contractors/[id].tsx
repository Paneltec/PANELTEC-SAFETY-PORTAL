import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import StatusBadge from '../../src/components/StatusBadge';
import { Colors } from '../../src/lib/colors';

const DOC_TYPES: Record<string, string> = {
  public_liability: 'Public liability', workers_comp: 'Workers compensation',
  white_card: 'White card', sw_license: 'SafeWork licence',
  induction: 'Induction', other: 'Other',
};

export default function ContractorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = () =>
    api.get(`/contractors/${id}`)
      .then(r => setDoc(r.data))
      .catch(() => { Alert.alert('Not found'); router.back(); })
      .finally(() => setRefreshing(false));

  useEffect(() => { load(); }, [id]);

  const delDoc = (docId: string) => {
    Alert.alert('Delete document', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/contractors/${id}/documents/${docId}`);
            load();
          } catch (e: any) { Alert.alert('Error', apiError(e)); }
        },
      },
    ]);
  };

  if (!doc) return <View style={s.center}><ActivityIndicator color={Colors.blue} /></View>;

  return (
    <ScrollView
      testID="contractor-detail"
      style={s.scroll}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}
    >
      <Text style={s.heading}>{doc.name}</Text>
      <View style={s.metaRow}>
        <StatusBadge value={doc.status} />
        <Text style={s.metaText}>{doc.trade} · {doc.abn || '—'}</Text>
      </View>

      <View style={s.card}>
        <View style={s.infoRow}>
          <Text style={s.infoLabel}>Contact</Text>
          <Text style={s.infoValue}>{doc.contact_name || '—'}</Text>
        </View>
        <View style={s.infoRow}>
          <Text style={s.infoLabel}>Email</Text>
          <Text style={s.infoValue}>{doc.contact_email || '—'}</Text>
        </View>
        <View style={s.infoRow}>
          <Text style={s.infoLabel}>Phone</Text>
          <Text style={s.infoValue}>{doc.contact_phone || '—'}</Text>
        </View>
      </View>

      <View style={s.card}>
        <View style={s.docHeader}>
          <Text style={s.sectionTitle}>Documents · {doc.documents?.length || 0}</Text>
        </View>

        {(!doc.documents || doc.documents.length === 0) ? (
          <Text style={s.empty}>No documents yet.</Text>
        ) : (
          doc.documents.map((d: any) => (
            <View key={d.id} testID={`doc-row-${d.id}`} style={s.docRow}>
              <Ionicons name="document-text" size={16} color={Colors.textTertiary} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={s.docType}>{DOC_TYPES[d.type] || d.type}</Text>
                <Text style={s.docExpiry}>expires {d.expiry_date || '—'}</Text>
              </View>
              <StatusBadge value={d.status} />
              <TouchableOpacity onPress={() => delDoc(d.id)} style={s.delBtn}>
                <Ionicons name="trash" size={16} color={Colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 24, fontWeight: '700', color: Colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 16 },
  metaText: { fontSize: 12, color: Colors.textTertiary },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  infoLabel: { fontSize: 13, color: Colors.textSecondary },
  infoValue: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  docHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  empty: { fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic' },
  docRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  docType: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  docExpiry: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  delBtn: { padding: 8, marginLeft: 8 },
});
