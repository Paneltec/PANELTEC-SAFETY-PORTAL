/**
 * My Inductions list — v58.13.132i
 * Reads from /api/workers/inductions/matrix (auto-scoped to own worker).
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { fetchInductionMatrix, type InductionMatrix } from '../../src/services/profileExtended';

function chipColor(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'current':        return { bg: Colors.successSoft, fg: Colors.success };
    case 'expiring':       return { bg: Colors.warningSoft, fg: Colors.warning };
    case 'expired':        return { bg: Colors.errorSoft, fg: Colors.error };
    case 'not_held':       return { bg: Colors.borderLight, fg: Colors.textTertiary };
    case 'held_no_expiry': return { bg: Colors.successSoft, fg: Colors.success };
    default:               return { bg: Colors.borderLight, fg: Colors.textTertiary };
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'current':        return 'Current';
    case 'expiring':       return 'Expiring';
    case 'expired':        return 'Expired';
    case 'not_held':       return 'Not Held';
    case 'held_no_expiry': return 'Held';
    case 'invalid_date':   return 'Invalid';
    default:               return 'Unknown';
  }
}

export default function InductionsListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading } = useQuery<InductionMatrix>({
    queryKey: ['inductions-matrix'],
    queryFn: fetchInductionMatrix,
    staleTime: 60_000,
    retry: 2,
  });

  // Extract my induction cells from the matrix
  const myRow = data?.rows?.[0]; // Matrix auto-scoped to own worker
  const columns = data?.columns || [];
  const cells = myRow?.cells || {};

  // Build flat list of inductions
  const inductionList = columns.map(col => ({
    key: col.column_key,
    header: col.header,
    category: col.category,
    cell: cells[col.column_key] || null,
  }));

  // Group by category
  const grouped: Record<string, typeof inductionList> = {};
  for (const ind of inductionList) {
    const cat = ind.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(ind);
  }

  const categoryLabels: Record<string, string> = {
    site_induction: 'Site Inductions',
    competency: 'Competencies',
    license: 'Licences',
    other: 'Other',
  };

  return (
    <View testID="inductions-list-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity testID="inductions-back-btn" style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Inductions</Text>
        <View style={s.countBadge}>
          <Text style={s.countText}>{inductionList.length}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.orange} /></View>
      ) : inductionList.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="checkmark-circle-outline" size={40} color={Colors.textTertiary} />
          <Text style={s.emptyText}>No inductions recorded</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {Object.entries(grouped).map(([cat, items]) => (
            <View key={cat} testID={`induction-group-${cat}`}>
              <Text style={s.sectionLabel}>{categoryLabels[cat] || cat.toUpperCase()}</Text>
              {items.map((ind) => {
                const status = ind.cell?.status || 'unknown';
                const color = chipColor(status);
                return (
                  <View
                    key={ind.key}
                    testID={`induction-row-${ind.key}`}
                    style={s.indRow}
                  >
                    <View style={[s.statusDot, { backgroundColor: color.fg }]} />
                    <View style={s.indInfo}>
                      <Text style={s.indName} numberOfLines={1}>{ind.header}</Text>
                      {ind.cell?.expiry_date ? (
                        <Text style={s.indExpiry}>Expires: {ind.cell.expiry_date}</Text>
                      ) : null}
                    </View>
                    <View style={[s.statusPill, { backgroundColor: color.bg }]}>
                      <Text style={[s.statusText, { color: color.fg }]}>{statusLabel(status)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  scroll: { paddingBottom: 40 },
  emptyText: { fontSize: 15, color: Colors.textTertiary },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white, flex: 1 },
  countBadge: {
    backgroundColor: 'rgba(124,58,237,0.2)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3, marginRight: 8,
  },
  countText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: Colors.textTertiary,
    letterSpacing: 1.2, paddingHorizontal: 16, marginTop: 16, marginBottom: 8,
  },

  indRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  indInfo: { flex: 1 },
  indName: { fontSize: 14, fontWeight: '700', color: Colors.ink },
  indExpiry: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
});
