import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/lib/api';
import EmptyState from '../../src/components/EmptyState';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';

export default function PreStartsListScreen() {
  const router = useRouter();
  const can = useCan();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = () => api.get('/pre-starts').then(r => setItems(r.data)).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  useEffect(() => { load(); }, []);

  return (
    <ScrollView testID="prestarts-list" style={s.scroll} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}>
      <View style={s.header}>
        <Text style={s.heading}>Daily Pre-Starts</Text>
        {can('pre_starts', 'open') && <TouchableOpacity testID="prestart-create-btn" style={s.addBtn} onPress={() => router.push('/pre-starts/new')}>
          <Ionicons name="add" size={18} color={Colors.imSurface} /><Text style={s.addText}>New</Text>
        </TouchableOpacity>}
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.blue} /> :
       items.length === 0 ? <EmptyState title="No pre-starts yet" body="Capture your first daily pre-start." /> :
       items.map(p => (
        <TouchableOpacity key={p.id} testID={`prestart-card-${p.id}`} style={s.card} onPress={() => router.push(`/pre-starts/${p.id}`)} activeOpacity={0.7}>
          <Text style={s.date}>{p.date}</Text>
          <Text style={s.lead}>{p.crew_lead}</Text>
          <Text style={s.summary} numberOfLines={2}>{p.work_summary}</Text>
          <Text style={s.signons}>{p.sign_ons?.length || 0} signed on</Text>
        </TouchableOpacity>
       ))}
    </ScrollView>
  );
}
const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg }, content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.blue, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  addText: { color: Colors.imSurface, fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8 },
  date: { fontSize: 12, color: Colors.textTertiary },
  lead: { fontSize: 15, fontWeight: '600', color: Colors.ink, marginTop: 4 },
  summary: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  signons: { fontSize: 12, color: Colors.textTertiary, marginTop: 8 },
});
