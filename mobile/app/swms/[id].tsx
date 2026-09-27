/**
 * SWMS detail viewer — v58.13.132kg
 * Read-only view of a SWMS document (hazards, PPE, controls, emergency procedures).
 * Fetches from GET /api/swms/{id}.
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { authGet } from '../../src/services/apiClient';

// ── Types ──

interface SwmsDetail {
  id: string;
  title: string;
  code?: string;
  version?: string;
  status?: string;
  scope?: string;
  job_description?: string;
  review_date?: string;
  prepared_by?: { name?: string; role?: string };
  approved_by?: { name?: string; role?: string };
  activity_analysis?: { activity?: string; hazards?: string; risk_level?: string; controls?: string }[];
  hazards?: { label?: string; risk?: string; description?: string }[];
  controls?: { label?: string; method?: string }[];
  ppe?: (string | { label?: string; item?: string })[];
  environmental_risks?: (string | { label?: string; risk?: string })[];
  training_requirements?: (string | { label?: string })[];
  equipment_list?: (string | { label?: string; item?: string })[];
  emergency_procedures?: { first_aid?: string; fire?: string; spill?: string; evacuation?: string; [k: string]: unknown };
  tasks?: { description?: string; hazard?: string; controls?: string }[];
  [key: string]: unknown;
}

// ── Helpers ──

function itemLabel(item: string | { label?: string; item?: string; activity?: string }): string {
  if (typeof item === 'string') return item;
  return item.label || item.item || item.activity || JSON.stringify(item);
}

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  approved: { bg: '#D1FAE5', text: '#059669' },
  draft:    { bg: '#FEF3C7', text: '#D97706' },
  expired:  { bg: '#FEE2E2', text: '#DC2626' },
  archived: { bg: '#E2E8F0', text: '#64748B' },
};

function statusStyle(s?: string) {
  const key = (s || 'draft').toLowerCase();
  return STATUS_COLOR[key] || STATUS_COLOR.draft;
}

const RISK_COLOR: Record<string, string> = {
  high: '#EF4444', extreme: '#EF4444', critical: '#DC2626',
  medium: '#F59E0B', moderate: '#F59E0B',
  low: '#10B981', minimal: '#10B981',
};

// ── Screen ──

export default function SwmsDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: swms, isLoading, isError, error, refetch, isRefetching } = useQuery<SwmsDetail>({
    queryKey: ['swms-detail', id],
    queryFn: async () => {
      const res = await authGet<SwmsDetail>(`/api/swms/${id}`);
      if (!res.ok) throw new Error(res.expired ? 'SESSION_EXPIRED' : 'Failed to load SWMS');
      return res.data as SwmsDetail;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  const sc = statusStyle(swms?.status);

  // Merge activity_analysis + tasks + hazards into a unified hazard list
  const hazardRows = React.useMemo(() => {
    const rows: { label: string; risk: string; controls: string }[] = [];
    // activity_analysis (legacy SWMS-06 shape)
    (swms?.activity_analysis || []).forEach((a) => {
      rows.push({ label: a.activity || a.hazards || '—', risk: a.risk_level || 'medium', controls: a.controls || '' });
    });
    // tasks (phase-4 shape)
    (swms?.tasks || []).forEach((t) => {
      rows.push({ label: t.description || t.hazard || '—', risk: 'medium', controls: t.controls || '' });
    });
    // hazards array
    (swms?.hazards || []).forEach((h) => {
      rows.push({ label: typeof h === 'string' ? h : (h.label || h.description || '—'), risk: (typeof h === 'string' ? 'medium' : h.risk) || 'medium', controls: '' });
    });
    return rows;
  }, [swms]);

  return (
    <View testID="swms-detail-screen" style={[st.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity testID="swms-back-btn" style={st.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <View style={st.headerCenter}>
          <Text style={st.headerTitle}>SWMS</Text>
          {swms?.code && <Text style={st.headerSub}>{swms.code}</Text>}
        </View>
        {swms?.status && (
          <View style={[st.statusPill, { backgroundColor: sc.bg }]}>
            <Text style={[st.statusText, { color: sc.text }]}>{swms.status}</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={st.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={st.loadingText}>Loading SWMS…</Text>
        </View>
      ) : isError ? (
        <View style={st.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={Colors.error} />
          <Text style={st.errorTitle}>Failed to load SWMS</Text>
          <Text style={st.errorText}>{error?.message || 'Network error'}</Text>
          <TouchableOpacity testID="swms-retry" style={st.retryBtn} onPress={() => refetch()}>
            <Ionicons name="refresh" size={18} color={Colors.white} />
            <Text style={st.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : swms ? (
        <ScrollView
          contentContainerStyle={st.scroll}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.orange} />}
        >
          {/* Title card */}
          <View style={st.titleCard}>
            <Text style={st.swmsTitle}>{swms.title}</Text>
            {swms.version && <Text style={st.swmsVersion}>Version {swms.version}</Text>}
            {swms.job_description && <Text style={st.swmsDesc}>{swms.job_description}</Text>}
            <View style={st.metaRow}>
              {swms.prepared_by?.name && (
                <View style={st.metaChip}>
                  <Ionicons name="person-outline" size={12} color={Colors.textTertiary} />
                  <Text style={st.metaText}>Prepared: {swms.prepared_by.name}</Text>
                </View>
              )}
              {swms.review_date && (
                <View style={st.metaChip}>
                  <Ionicons name="calendar-outline" size={12} color={Colors.textTertiary} />
                  <Text style={st.metaText}>Review: {new Date(swms.review_date).toLocaleDateString()}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Hazards / Activity Analysis */}
          {hazardRows.length > 0 && (
            <View style={st.section}>
              <View style={st.sectionHeader}>
                <Ionicons name="warning-outline" size={18} color="#EF4444" />
                <Text style={st.sectionTitle}>Hazards & Activity Analysis</Text>
                <View style={st.countBadge}><Text style={st.countText}>{hazardRows.length}</Text></View>
              </View>
              {hazardRows.map((h, i) => (
                <View key={i} style={st.hazardRow}>
                  <View style={[st.riskDot, { backgroundColor: RISK_COLOR[h.risk.toLowerCase()] || '#F59E0B' }]} />
                  <View style={st.hazardBody}>
                    <Text style={st.hazardLabel}>{h.label}</Text>
                    {h.controls ? <Text style={st.hazardControls}>{h.controls}</Text> : null}
                  </View>
                  <View style={[st.riskPill, { backgroundColor: (RISK_COLOR[h.risk.toLowerCase()] || '#F59E0B') + '18' }]}>
                    <Text style={[st.riskText, { color: RISK_COLOR[h.risk.toLowerCase()] || '#F59E0B' }]}>{h.risk}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* PPE */}
          {(swms.ppe || []).length > 0 && (
            <View style={st.section}>
              <View style={st.sectionHeader}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#3B82F6" />
                <Text style={st.sectionTitle}>PPE Requirements</Text>
                <View style={st.countBadge}><Text style={st.countText}>{(swms.ppe || []).length}</Text></View>
              </View>
              <View style={st.chipWrap}>
                {(swms.ppe || []).map((item, i) => (
                  <View key={i} style={st.ppeChip}>
                    <Text style={st.ppeText}>{itemLabel(item)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Controls */}
          {(swms.controls || []).length > 0 && (
            <View style={st.section}>
              <View style={st.sectionHeader}>
                <Ionicons name="construct-outline" size={18} color="#10B981" />
                <Text style={st.sectionTitle}>Control Measures</Text>
                <View style={st.countBadge}><Text style={st.countText}>{(swms.controls || []).length}</Text></View>
              </View>
              {(swms.controls || []).map((c, i) => (
                <View key={i} style={st.controlRow}>
                  <View style={st.controlDot} />
                  <Text style={st.controlLabel}>{itemLabel(c)}</Text>
                  {typeof c !== 'string' && c.method && (
                    <View style={st.methodPill}><Text style={st.methodText}>{c.method}</Text></View>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Environmental Risks */}
          {(swms.environmental_risks || []).length > 0 && (
            <View style={st.section}>
              <View style={st.sectionHeader}>
                <Ionicons name="leaf-outline" size={18} color="#059669" />
                <Text style={st.sectionTitle}>Environmental Risks</Text>
              </View>
              {(swms.environmental_risks || []).map((r, i) => (
                <View key={i} style={st.controlRow}>
                  <View style={st.controlDot} />
                  <Text style={st.controlLabel}>{itemLabel(r)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Training Requirements */}
          {(swms.training_requirements || []).length > 0 && (
            <View style={st.section}>
              <View style={st.sectionHeader}>
                <Ionicons name="school-outline" size={18} color="#8B5CF6" />
                <Text style={st.sectionTitle}>Training Requirements</Text>
              </View>
              {(swms.training_requirements || []).map((t, i) => (
                <View key={i} style={st.controlRow}>
                  <View style={st.controlDot} />
                  <Text style={st.controlLabel}>{itemLabel(t)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Equipment */}
          {(swms.equipment_list || []).length > 0 && (
            <View style={st.section}>
              <View style={st.sectionHeader}>
                <Ionicons name="hammer-outline" size={18} color="#F59E0B" />
                <Text style={st.sectionTitle}>Equipment</Text>
              </View>
              <View style={st.chipWrap}>
                {(swms.equipment_list || []).map((e, i) => (
                  <View key={i} style={st.equipChip}>
                    <Text style={st.equipText}>{itemLabel(e)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Emergency Procedures */}
          {swms.emergency_procedures && Object.keys(swms.emergency_procedures).length > 0 && (
            <View style={st.section}>
              <View style={st.sectionHeader}>
                <Ionicons name="medkit-outline" size={18} color="#EF4444" />
                <Text style={st.sectionTitle}>Emergency Procedures</Text>
              </View>
              {Object.entries(swms.emergency_procedures).map(([key, val]) => {
                if (!val || typeof val !== 'string') return null;
                return (
                  <View key={key} style={st.emergRow}>
                    <Text style={st.emergKey}>{key.replace(/_/g, ' ')}</Text>
                    <Text style={st.emergVal}>{val}</Text>
                  </View>
                );
              })}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      ) : null}
    </View>
  );
}

// ── Styles ──

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  scroll: { paddingBottom: 40 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  statusPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginRight: 8 },
  statusText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },

  // Loading / Error
  loadingText: { fontSize: 14, color: '#8A8A8A' },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink, marginTop: 8 },
  errorText: { fontSize: 14, color: '#8A8A8A', textAlign: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 14, marginTop: 16, minHeight: 48,
  },
  retryText: { color: Colors.white, fontSize: 16, fontWeight: '700' },

  // Title card
  titleCard: {
    backgroundColor: Colors.surface, marginHorizontal: 16, marginTop: 12,
    borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  swmsTitle: { fontSize: 20, fontWeight: '800', color: Colors.ink, lineHeight: 26 },
  swmsVersion: { fontSize: 13, color: Colors.orange, fontWeight: '700', marginTop: 4 },
  swmsDesc: { fontSize: 14, color: '#4B4B4B', marginTop: 8, lineHeight: 20 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F1F5F9', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  metaText: { fontSize: 12, color: '#8A8A8A' },

  // Sections
  section: {
    backgroundColor: Colors.surface, marginHorizontal: 16, marginTop: 10,
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.ink },
  countBadge: {
    backgroundColor: '#F1F5F9', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  countText: { fontSize: 11, fontWeight: '700', color: '#8A8A8A' },

  // Hazard rows
  hazardRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  riskDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  hazardBody: { flex: 1 },
  hazardLabel: { fontSize: 14, fontWeight: '600', color: Colors.ink, lineHeight: 20 },
  hazardControls: { fontSize: 12, color: '#8A8A8A', marginTop: 3, lineHeight: 17 },
  riskPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  riskText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },

  // PPE chips
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ppeChip: {
    backgroundColor: '#DBEAFE', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  ppeText: { fontSize: 13, fontWeight: '600', color: '#1D4ED8' },

  // Controls
  controlRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6,
  },
  controlDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' },
  controlLabel: { flex: 1, fontSize: 14, color: Colors.ink, lineHeight: 20 },
  methodPill: {
    backgroundColor: '#F1F5F9', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  methodText: { fontSize: 11, fontWeight: '600', color: '#8A8A8A', textTransform: 'capitalize' },

  // Equipment chips
  equipChip: {
    backgroundColor: '#FEF3C7', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  equipText: { fontSize: 13, fontWeight: '600', color: '#92400E' },

  // Emergency procedures
  emergRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  emergKey: { fontSize: 12, fontWeight: '700', color: '#8A8A8A', textTransform: 'capitalize', marginBottom: 4 },
  emergVal: { fontSize: 14, color: Colors.ink, lineHeight: 20 },
});
