import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/lib/api';
import EmptyState from '../../src/components/EmptyState';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';

export default function SiteDiaryListScreen() {
  const router = useRouter();
  const can = useCan();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = () => api.get('/site-diary').then(r => setItems(r.data)).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  useEffect(() => { load(); }, []);

  return (
    <ScrollView testID="sitediary-list" style={s.scroll} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}>
      <View style={s.header}>
        <Text style={s.heading}>Site Diary</Text>
        {can('site_diary', 'open') && <TouchableOpacity testID="diary-create-btn" style={s.addBtn} onPress={() => router.push('/site-diary/new')}>
          <Ionicons name="add" size={18} color={Colors.imSurface} /><Text style={s.addText}>New</Text>
        </TouchableOpacity>}
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.blue} /> :
       items.length === 0 ? <EmptyState title="No diary entries" body="Capture your first daily diary entry." /> :
       items.map(d => (
        <TouchableOpacity key={d.id} testID={`diary-row-${d.id}`} style={s.card} onPress={() => router.push(`/site-diary/${d.id}`)} activeOpacity={0.7}>
          <View style={s.cardHeader}>
            <Text style={s.date}>{d.date}</Text>
            {d.structured_log && <View style={s.aiBadge}><Text style={s.aiBadgeText}>AI STRUCTURED</Text></View>}
          </View>
          <Text style={s.notes} numberOfLines={2}>{d.raw_notes}</Text>
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  date: { fontSize: 12, color: Colors.textTertiary },
  aiBadge: { backgroundColor: Colors.violetSoft, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  aiBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.violet, letterSpacing: 0.5 },
  notes: { fontSize: 14, color: Colors.text, lineHeight: 20 },
});
