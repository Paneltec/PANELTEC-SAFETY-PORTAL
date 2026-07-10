import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/lib/api';
import StatusBadge from '../../src/components/StatusBadge';
import EmptyState from '../../src/components/EmptyState';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';

export default function HazardsListScreen() {
  const router = useRouter();
  const can = useCan();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = () => api.get('/hazards').then(r => setItems(r.data)).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  useEffect(() => { load(); }, []);

  return (
    <ScrollView testID="hazards-list" style={s.scroll} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}>
      <View style={s.header}>
        <Text style={s.heading}>Hazard Reports</Text>
        {can('hazards', 'open') && <TouchableOpacity testID="hazard-create-btn" style={s.addBtn} onPress={() => router.push('/hazards/new')}>
          <Ionicons name="add" size={18} color={Colors.imSurface} /><Text style={s.addText}>Report</Text>
        </TouchableOpacity>}
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.blue} /> :
       items.length === 0 ? <EmptyState title="No hazards reported" body="Report your first hazard." /> :
       items.map(h => (
        <TouchableOpacity key={h.id} testID={`hazard-card-${h.id}`} style={s.card} onPress={() => router.push(`/hazards/${h.id}`)} activeOpacity={0.7}>
          <View style={s.cardTop}>
            <Text style={s.cardTitle} numberOfLines={1}>{h.title}</Text>
            <StatusBadge value={h.severity} />
          </View>
          <Text style={s.desc} numberOfLines={2}>{h.description}</Text>
          <View style={s.cardBottom}>
            <StatusBadge value={h.status} />
            <Text style={s.cardDate}>{(h.created_at || '').slice(0, 10)}</Text>
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
  addText: { color: Colors.imSurface, fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink, flex: 1, marginRight: 8 },
  desc: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  cardDate: { fontSize: 11, color: Colors.textTertiary },
});
