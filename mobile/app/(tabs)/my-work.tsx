/**
 * My Work / My Records — v58.13.132cz
 * Shows records grouped by type (pre-starts, hazards, incidents, etc.)
 * ⚠️ MOCKED: /api/mobile/records/mine returns 404.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { MOCK_MY_RECORDS, type RecordGroup } from '../../src/services/mockData';

export default function MyWorkScreen() {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggleGroup = (type: string) => {
    setExpanded((prev) => (prev === type ? null : type));
  };

  return (
    <View testID="my-work-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>My Records</Text>
        <View style={s.mockInline}>
          <Text style={s.mockInlineText}>MOCKED</Text>
        </View>
      </View>
      <Text style={s.headerSub}>All your submissions grouped by type</Text>

      <ScrollView contentContainerStyle={s.scrollContent}>
        {/* Mock warning */}
        <View style={s.mockBanner}>
          <Ionicons name="flask-outline" size={14} color="#DC2626" />
          <Text style={s.mockBannerText}>
            /api/mobile/records/mine → 404. This data is mocked.
          </Text>
        </View>

        {MOCK_MY_RECORDS.map((group: RecordGroup) => {
          const isExpanded = expanded === group.type;
          return (
            <View key={group.type}>
              <TouchableOpacity
                testID={`record-group-${group.type}`}
                style={s.groupCard}
                onPress={() => toggleGroup(group.type)}
                activeOpacity={0.7}
              >
                <View style={[s.groupIcon, { backgroundColor: group.color + '18' }]}>
                  <Ionicons name={group.icon as keyof typeof Ionicons.glyphMap} size={22} color={group.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.groupLabel}>{group.label}</Text>
                  <Text style={s.groupCount}>{group.count} record{group.count !== 1 ? 's' : ''}</Text>
                </View>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={Colors.textTertiary}
                />
              </TouchableOpacity>

              {isExpanded && (
                <View style={s.itemsContainer}>
                  {group.items.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      testID={`record-item-${item.id}`}
                      style={s.itemRow}
                      onPress={() => {}}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.itemTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={s.itemMeta}>
                          {item.date} {item.site ? `· ${item.site}` : ''}
                        </Text>
                      </View>
                      <View style={[s.statusPill, {
                        backgroundColor: item.status === 'open' ? Colors.warningSoft
                          : item.status === 'resolved' || item.status === 'closed' ? Colors.successSoft
                          : Colors.infoSoft,
                      }]}>
                        <Text style={[s.statusText, {
                          color: item.status === 'open' ? Colors.warning
                            : item.status === 'resolved' || item.status === 'closed' ? Colors.success
                            : Colors.info,
                        }]}>{item.status}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  {group.items.length < group.count && (
                    <Text style={s.moreText}>
                      + {group.count - group.items.length} more
                    </Text>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* Summary card */}
        <View style={s.summaryCard}>
          <Text style={s.summaryTitle}>Total Records</Text>
          <Text style={s.summaryCount}>
            {MOCK_MY_RECORDS.reduce((sum, g) => sum + g.count, 0)}
          </Text>
          <Text style={s.summaryTypes}>
            across {MOCK_MY_RECORDS.length} categories
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingTop: 16,
  },
  headerTitle: { color: Colors.white, fontSize: 22, fontWeight: '800' },
  headerSub: {
    color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '500',
    paddingHorizontal: 20, marginTop: 2, marginBottom: 8,
  },
  scrollContent: { padding: 16, paddingBottom: 32 },

  mockInline: {
    backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  mockInlineText: { fontSize: 8, fontWeight: '800', color: '#DC2626', letterSpacing: 0.5 },
  mockBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEE2E2', borderRadius: 10, padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: '#FECACA',
  },
  mockBannerText: { fontSize: 11, fontWeight: '600', color: '#DC2626', flex: 1 },

  groupCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  groupIcon: {
    width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  groupLabel: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  groupCount: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },

  itemsContainer: {
    marginLeft: 20, marginBottom: 8, paddingLeft: 16,
    borderLeftWidth: 2, borderLeftColor: Colors.border,
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 12, padding: 12, marginBottom: 4,
  },
  itemTitle: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  itemMeta: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  statusPill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  moreText: {
    fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: '600',
    paddingVertical: 8, paddingLeft: 12,
  },

  summaryCard: {
    backgroundColor: 'rgba(249,115,22,0.08)', borderRadius: 16, padding: 20,
    alignItems: 'center', marginTop: 12,
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.2)',
  },
  summaryTitle: { fontSize: 12, fontWeight: '700', color: Colors.orange, letterSpacing: 0.5, textTransform: 'uppercase' },
  summaryCount: { fontSize: 36, fontWeight: '900', color: Colors.white, marginVertical: 4 },
  summaryTypes: { fontSize: 12, color: 'rgba(255,255,255,0.5)' },
});
