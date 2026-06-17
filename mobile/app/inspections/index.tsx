import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/lib/api';
import EmptyState from '../../src/components/EmptyState';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';

export default function InspectionsListScreen() {
  const router = useRouter();
  const can = useCan();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => api.get('/inspections').then(r => setItems(r.data)).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  useEffect(() => { load(); }, []);

  return (
    <ScrollView testID="inspections-list" style={s.scroll} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}>
      <View style={s.header}>
        <Text style={s.heading}>Inspection Reports</Text>
        {can('inspections', 'open') && <TouchableOpacity testID="inspection-create-btn" style={s.addBtn} onPress={() => router.push('/inspections/new')}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={s.addText}>New</Text>
        </TouchableOpacity>}
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.blue} /> :
       items.length === 0 ? <EmptyState title="No inspections yet" body="Run your first inspection." /> :
       items.map(it => {
         const total = it.checklist_items?.length || 0;
         const passed = it.checklist_items?.filter((c: any) => c.response === 'pass').length || 0;
         const failed = it.checklist_items?.filter((c: any) => c.response === 'fail').length || 0;
         const na = total - passed - failed;
         return (
           <View key={it.id} testID={`inspection-row-${it.id}`} style={s.card}>
             <Text style={s.cardTitle}>{it.template_name}</Text>
             <Text style={s.cardDate}>{it.date}</Text>
             <View style={s.resultsRow}>
               <View style={[s.resultBadge, { backgroundColor: Colors.mint }]}>
                 <Text style={[s.resultText, { color: Colors.emeraldDark }]}>{passed} pass</Text>
               </View>
               <View style={[s.resultBadge, { backgroundColor: failed > 0 ? Colors.redSoft : Colors.bg }]}>
                 <Text style={[s.resultText, { color: failed > 0 ? Colors.red : Colors.textTertiary }]}>{failed} fail</Text>
               </View>
               <View style={[s.resultBadge, { backgroundColor: Colors.bg }]}>
                 <Text style={[s.resultText, { color: Colors.textTertiary }]}>{na} N/A</Text>
               </View>
             </View>
           </View>
         );
       })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.blue, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  addText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  cardDate: { fontSize: 12, color: Colors.textTertiary, marginTop: 4 },
  resultsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  resultBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  resultText: { fontSize: 12, fontWeight: '600' },
});
