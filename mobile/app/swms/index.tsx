import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/lib/api';
import StatusBadge from '../../src/components/StatusBadge';
import EmptyState from '../../src/components/EmptyState';
import PrimaryButton from '../../src/components/PrimaryButton';
import { Colors } from '../../src/lib/colors';

export default function SwmsListScreen() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => api.get('/swms').then(r => setItems(r.data)).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  useEffect(() => { load(); }, []);

  return (
    <ScrollView testID="swms-list" style={s.scroll} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.heading}>Safe Work Method Statements</Text>
          <Text style={s.sub}>Draft, review and approve SWMS.</Text>
        </View>
        <TouchableOpacity testID="swms-create-btn" style={s.addBtn} onPress={() => router.push('/swms/new')}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={s.addText}>Create</Text>
        </TouchableOpacity>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.blue} /> :
       items.length === 0 ? <EmptyState title="No SWMS yet" body="Draft your first Safe Work Method Statement." /> :
       items.map(sw => (
        <TouchableOpacity key={sw.id} testID={`swms-row-${sw.id}`} style={s.card} onPress={() => router.push(`/swms/${sw.id}`)}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{sw.title}</Text>
            <Text style={s.cardSub} numberOfLines={1}>{sw.job_description}</Text>
          </View>
          <View style={s.cardRight}>
            <StatusBadge value={sw.status} />
            <Text style={s.cardDate}>{(sw.created_at || '').slice(0, 10)}</Text>
          </View>
        </TouchableOpacity>
       ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.blue, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  addText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  cardSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  cardDate: { fontSize: 11, color: Colors.textTertiary },
});
