import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/lib/api';
import StatusBadge from '../../src/components/StatusBadge';
import EmptyState from '../../src/components/EmptyState';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';

const CATS: Record<string, string> = { near_miss: 'Near miss', first_aid: 'First aid', medical: 'Medical', ltc: 'Lost-time', env: 'Environmental', property: 'Property' };

export default function IncidentsListScreen() {
  const router = useRouter();
  const can = useCan();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = () => api.get('/incidents').then(r => setItems(r.data)).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  useEffect(() => { load(); }, []);

  return (
    <ScrollView testID="incidents-list" style={s.scroll} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}>
      <View style={s.header}>
        <Text style={s.heading}>Incident Reports</Text>
        {can('incidents', 'open') && <TouchableOpacity testID="incident-create-btn" style={s.addBtn} onPress={() => router.push('/incidents/new')}>
          <Ionicons name="add" size={18} color="#fff" /><Text style={s.addText}>New</Text>
        </TouchableOpacity>}
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.blue} /> :
       items.length === 0 ? <EmptyState title="No incidents" body="Log your first incident." /> :
       items.map(inc => (
        <TouchableOpacity key={inc.id} testID={`incident-row-${inc.id}`} style={s.card} onPress={() => router.push(`/incidents/${inc.id}`)} activeOpacity={0.7}>
          <Text style={s.cardTitle}>{inc.title}</Text>
          <Text style={s.desc} numberOfLines={1}>{inc.description}</Text>
          <View style={s.cardBottom}>
            <Text style={s.catBadge}>{CATS[inc.category] || inc.category}</Text>
            <StatusBadge value={inc.follow_up_status} />
            <Text style={s.cardDate}>{(inc.occurred_at || '').slice(0, 10)}</Text>
          </View>
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
  addText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  desc: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  catBadge: { fontSize: 11, backgroundColor: Colors.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, color: Colors.text },
  cardDate: { fontSize: 11, color: Colors.textTertiary, marginLeft: 'auto' },
});
