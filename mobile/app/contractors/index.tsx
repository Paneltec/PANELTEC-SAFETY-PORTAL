import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/lib/api';
import StatusBadge from '../../src/components/StatusBadge';
import EmptyState from '../../src/components/EmptyState';
import { Colors } from '../../src/lib/colors';

export default function ContractorsListScreen() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const load = () => {
    const params: any = {};
    if (statusFilter) params.status = statusFilter;
    api.get('/contractors', { params }).then(r => setItems(r.data)).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { load(); }, [statusFilter]);

  const STATUS_OPTIONS = ['active', 'inactive', 'suspended'];

  return (
    <ScrollView testID="contractors-list" style={s.scroll} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.heading}>Contractor Register</Text>
          <Text style={s.sub}>Companies, ABNs, insurances and licences.</Text>
        </View>
        <TouchableOpacity testID="contractor-create-btn" style={s.addBtn} onPress={() => router.push('/contractors/new')}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={s.addText}>Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
        <TouchableOpacity
          testID="contractor-filter-all"
          style={[s.filterChip, !statusFilter && s.filterChipActive]}
          onPress={() => setStatusFilter('')}
        >
          <Text style={[s.filterText, !statusFilter && s.filterTextActive]}>All</Text>
        </TouchableOpacity>
        {STATUS_OPTIONS.map(st => (
          <TouchableOpacity
            key={st}
            testID={`contractor-filter-${st}`}
            style={[s.filterChip, statusFilter === st && s.filterChipActive]}
            onPress={() => setStatusFilter(statusFilter === st ? '' : st)}
          >
            <Text style={[s.filterText, statusFilter === st && s.filterTextActive]}>{st}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.blue} /> :
       items.length === 0 ? <EmptyState title="No contractors" body="Add your first contractor." /> :
       items.map(c => {
         const cs = c.compliance_summary || { valid: 0, expiring_soon: 0, expired: 0, total: 0 };
         return (
           <TouchableOpacity key={c.id} testID={`contractor-row-${c.id}`} style={s.card} onPress={() => router.push(`/contractors/${c.id}`)} activeOpacity={0.7}>
             <View style={s.cardTop}>
               <View style={{ flex: 1 }}>
                 <Text style={s.cardTitle}>{c.name}</Text>
                 <Text style={s.cardAbn}>{c.abn || '—'}</Text>
               </View>
               <StatusBadge value={c.status} />
             </View>
             <Text style={s.cardTrade}>{c.trade}</Text>
             <View style={s.complianceRow}>
               <Text style={s.compValid}>{cs.valid}/{cs.total} valid</Text>
               {cs.expiring_soon > 0 && <Text style={s.compExpiring}>· {cs.expiring_soon} expiring</Text>}
               {cs.expired > 0 && <Text style={s.compExpired}>· {cs.expired} expired</Text>}
             </View>
           </TouchableOpacity>
         );
       })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.blue, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  addText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  filterRow: { marginBottom: 14, flexGrow: 0 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, marginRight: 8 },
  filterChipActive: { borderColor: Colors.blue, backgroundColor: Colors.blueSoft },
  filterText: { fontSize: 13, color: Colors.textSecondary, textTransform: 'capitalize' },
  filterTextActive: { color: Colors.blue, fontWeight: '600' },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  cardAbn: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  cardTrade: { fontSize: 13, color: Colors.textSecondary, marginTop: 6 },
  complianceRow: { flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'center' },
  compValid: { fontSize: 12, color: Colors.emeraldDark, fontWeight: '600' },
  compExpiring: { fontSize: 12, color: Colors.amber, fontWeight: '500' },
  compExpired: { fontSize: 12, color: Colors.red, fontWeight: '500' },
});
