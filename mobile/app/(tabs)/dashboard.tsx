import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/lib/api';
import { getUser, initials } from '../../src/lib/auth';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/lib/AuthContext';
import { SAFE_FALLBACK } from '../../src/lib/modules';
import AiBuilderModal from '../../src/components/forms/AiBuilderModal';
import TemplateBuilder from '../../src/components/forms/TemplateBuilder';
import type { ModuleId } from '../../src/lib/modules';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

const METRIC_ROWS: { key: string; label: string; field: string; icon: any; moduleKey: ModuleId }[] = [
  { key: 'swms', label: 'AI SWMS', field: 'swms_count', icon: 'document-text', moduleKey: 'swms' },
  { key: 'pre-starts', label: 'Pre-starts', field: 'prestarts_count', icon: 'clipboard', moduleKey: 'pre_start' },
  { key: 'site-diary', label: 'Site diary', field: 'today', icon: 'book', moduleKey: 'site_diary' },
  { key: 'hazards', label: 'Hazards', field: 'hazards_count', icon: 'warning', moduleKey: 'hazard' },
  { key: 'incidents', label: 'Incidents', field: 'incidents_count', icon: 'alert-circle', moduleKey: 'incident' },
  { key: 'inspections', label: 'Inspections', field: 'inspections_count', icon: 'checkmark-circle', moduleKey: 'inspection' },
];

// v158.1 — Each entry MUST carry a `moduleKey` so the render below can
// hide the tile when the admin turns the module off for the user's role.
// `null` means "always show" — used only for the compliance-hub tab
// container (gated indirectly by its child module toggles) and the users
// tile (kept always-on to match `profile` semantics).
const MANAGE_TOOLS: { key: string; title: string; desc: string; icon: any; route: string; moduleKey: ModuleId | null }[] = [
  { key: 'forms',            title: 'Forms Library',    desc: 'Fillable templates with signature, photo & GPS', icon: 'clipboard',        route: '/forms',            moduleKey: 'forms' },
  { key: 'workers',          title: 'Workers',          desc: 'Field crew synced from Simpro',                  icon: 'people',           route: '/workers',          moduleKey: 'workers' },
  { key: 'suppliers',        title: 'Suppliers',        desc: 'Simpro suppliers, tasks, notes & folders',       icon: 'business',         route: '/suppliers',        moduleKey: 'suppliers' },
  { key: 'document-library', title: 'Document Library', desc: 'Risk & compliance documents',                    icon: 'folder-open',      route: '/document-library', moduleKey: 'document_library' },
  { key: 'users',            title: 'Users',            desc: 'Manage users, imports & permissions',            icon: 'people-circle',    route: '/users',            moduleKey: null },
  { key: 'compliance',       title: 'Compliance Hub',   desc: 'Contractor register & audit exports',            icon: 'shield-checkmark', route: '/(tabs)/compliance', moduleKey: null },
];

const CAPTURE_TOOLS: { key: string; title: string; desc: string; icon: any; route: string; moduleKey: ModuleId }[] = [
  { key: 'swms', title: 'AI SWMS', desc: 'Draft Safe Work Method Statements', icon: 'document-text', route: '/swms', moduleKey: 'swms' },
  { key: 'pre-starts', title: 'Daily Pre-Starts', desc: 'Crew pre-start checks and sign-ons', icon: 'clipboard', route: '/pre-starts', moduleKey: 'pre_start' },
  { key: 'site-diary', title: 'Site Diary AI', desc: 'Auto-summarise notes into daily diary', icon: 'book', route: '/site-diary', moduleKey: 'site_diary' },
  { key: 'hazards', title: 'Hazard Reports', desc: 'Snap a hazard — AI classifies risk', icon: 'warning', route: '/hazards', moduleKey: 'hazard' },
  { key: 'incidents', title: 'Incident Reports', desc: 'Structured incident capture', icon: 'alert-circle', route: '/incidents', moduleKey: 'incident' },
  { key: 'inspections', title: 'Inspections', desc: 'Site walk, plant, height inspections', icon: 'checkmark-circle', route: '/inspections', moduleKey: 'inspection' },
];

export default function DashboardScreen() {
  const router = useRouter();
  const { modules } = useAuth();
  const [metrics, setMetrics] = useState<any>(null);
  const [briefing, setBriefing] = useState<any>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [builderTemplate, setBuilderTemplate] = useState<any | null>(null);

  const canEdit = WRITE_ROLES.has(user?.role);
  const visibleMetrics = useMemo(() => METRIC_ROWS.filter(m => modules[m.moduleKey]), [modules]);
  const visibleCapture = useMemo(() => CAPTURE_TOOLS.filter(t => modules[t.moduleKey]), [modules]);
  // v158.1 — Tiles with `moduleKey: null` (users, compliance hub) are always
  // visible; tiles with a moduleKey must have that module toggled on for
  // the current user's role.
  const visibleManage  = useMemo(() => MANAGE_TOOLS.filter(t => t.moduleKey == null || modules[t.moduleKey]), [modules]);

  const loadData = async () => {
    try {
      const u = await getUser(); setUser(u);
      const wsParam = u?.workspace_ids?.[0] ? { workspace_id: u.workspace_ids[0] } : {};
      const [m, b] = await Promise.allSettled([
        api.get('/dashboard/metrics', { params: wsParam }).then(r => r.data),
        api.get('/ask/briefing', { params: wsParam }).then(r => r.data),
      ]);
      if (m.status === 'fulfilled') setMetrics(m.value);
      if (b.status === 'fulfilled') setBriefing(b.value);
    } catch {} finally { setLoading(false); setBriefingLoading(false); setRefreshing(false); }
  };

  useEffect(() => { loadData(); }, []);
  const onRefresh = () => { setRefreshing(true); setBriefingLoading(true); loadData(); };

  const score = metrics?.attention_score ?? 0;
  const band = metrics?.attention_band ?? 'Strong';
  const bandColor = band === 'Strong' ? Colors.emerald : band === 'Watch' ? Colors.amber : Colors.red;

  const isSafeFallback = useMemo(() => {
    const sf = SAFE_FALLBACK;
    return Object.keys(sf).every(k => modules[k as ModuleId] === sf[k as ModuleId]) && !modules.pre_start;
  }, [modules]);

  return (
    <SafeAreaView style={d.safe}>
      <ScrollView testID="dashboard-page" style={d.scroll} contentContainerStyle={d.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}>

        <View style={d.header}>
          <View>
            <Text style={d.overline}>PANELTEC CIVIL</Text>
            <Text style={d.heading}>HOME</Text>
          </View>
          <View style={d.avatar}>
            <Text style={d.avatarText}>{initials(user)}</Text>
          </View>
        </View>

        {isSafeFallback && (
          <View testID="safe-fallback-banner" style={d.fallbackBanner}>
            <Ionicons name="cloud-offline" size={16} color={Colors.amber} />
            <Text style={d.fallbackText}>Couldn't load app config — showing minimal features. Pull down on Profile to retry.</Text>
          </View>
        )}

        {/* Attention score */}
        <View testID="attention-score-card" style={d.scoreCard}>
          <View style={d.scoreRow}>
            <View style={[d.scoreCircle, { borderColor: bandColor }]}>
              <Text style={[d.scoreNum, { color: bandColor }]}>{score}</Text>
              <Text style={[d.scoreLbl, { color: bandColor }]}>{band.toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={d.scoreTitle}>{band.toUpperCase()} · {score}/100</Text>
              <Text style={d.scoreDesc}>
                {band === 'Strong' ? 'Compliance signal strong across all workspaces.' :
                 band === 'Watch' ? 'A few items need attention.' : 'Multiple items need immediate review.'}
              </Text>
              <Text style={d.scoreExtra}>{metrics?.records_needing_attention ?? 0} records pending</Text>
            </View>
          </View>
        </View>

        {/* AI Briefing */}
        {modules.ask_intel && briefingLoading ? (
          <View style={d.briefingCard}>
            <ActivityIndicator color={Colors.violet} />
            <Text style={d.briefingLoading}>Generating AI briefing...</Text>
          </View>
        ) : modules.ask_intel && briefing ? (
          <View testID="briefing-card" style={d.briefingCard}>
            <View style={d.briefingHeader}>
              <Text style={d.briefingOverline}>INTELLIGENCE BRIEFING</Text>
              <View style={d.confBadge}>
                <View style={[d.confDot, { backgroundColor: briefing.confidence === 'high' ? Colors.emerald : Colors.amber }]} />
                <Text style={d.confText}>{(briefing.confidence || 'high').toUpperCase()}</Text>
              </View>
            </View>
            <Text style={d.briefingTitle}>{briefing.title}</Text>
            <Text style={d.briefingBody}>{briefing.body}</Text>
            {briefing.cited_evidence?.length > 0 && (
              <View style={d.evidenceWrap}>
                <Text style={d.evidenceLabel}>CITED EVIDENCE</Text>
                {briefing.cited_evidence.slice(0, 3).map((c: any, i: number) => (
                  <View key={i} style={d.evidenceChip}>
                    <Text style={d.evidenceType}>{c.record_type}</Text>
                    <Text style={d.evidenceText}>{c.label}</Text>
                  </View>
                ))}
              </View>
            )}
            <TouchableOpacity testID="ask-intelligence-link" style={d.askLink} onPress={() => router.push('/(tabs)/ask' as any)}>
              <Ionicons name="sparkles" size={14} color={Colors.violet} />
              <Text style={d.askLinkText}>Ask Intelligence anything</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Metrics */}
        {visibleMetrics.length > 0 && (
          <>
            <Text style={d.sectionLabel}>COMPLIANCE SNAPSHOT</Text>
            <View style={d.metricsGrid}>
              {visibleMetrics.map((row) => (
                <View key={row.key} testID={`metric-${row.key}`} style={d.metricCard}>
                  <View style={d.metricIcon}>
                    <Ionicons name={row.icon} size={16} color={Colors.orange} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={d.metricLabel}>{row.label}</Text>
                    <Text style={d.metricSub}>THIS QUARTER</Text>
                  </View>
                  <Text style={d.metricValue}>{loading ? '...' : (metrics?.[row.field] ?? 0)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Manage */}
        {visibleManage.length > 0 && <Text style={d.sectionLabel}>MANAGE & COMPLY</Text>}
        {visibleManage.map((t) => (
          <TouchableOpacity key={t.key} testID={`manage-card-${t.key}`} style={d.captureCard}
            onPress={() => router.push(t.route as any)} activeOpacity={0.7}>
            <View style={d.captureIcon}>
              <Ionicons name={t.icon as any} size={18} color={Colors.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={d.captureTitle}>{t.title}</Text>
              <Text style={d.captureDesc}>{t.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </TouchableOpacity>
        ))}

        {/* Capture */}
        {visibleCapture.length > 0 && <Text style={d.sectionLabel}>CREATE & CAPTURE</Text>}
        {canEdit && (
          <TouchableOpacity testID="dashboard-generate-form-ai" style={d.aiTile} onPress={() => setAiOpen(true)} activeOpacity={0.7}>
            <View style={d.aiIcon}><Ionicons name="sparkles" size={18} color={Colors.violet} /></View>
            <View style={{ flex: 1 }}>
              <Text style={d.aiTitle}>Generate Form (AI)</Text>
              <Text style={d.aiDesc}>Describe what you need — AI builds a draft template</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.violet} />
          </TouchableOpacity>
        )}
        {visibleCapture.map((t) => (
          <TouchableOpacity key={t.key} testID={`capture-card-${t.key}`} style={d.captureCard}
            onPress={() => router.push(t.route as any)} activeOpacity={0.7}>
            <View style={d.captureIcon}>
              <Ionicons name={t.icon as any} size={18} color={Colors.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={d.captureTitle}>{t.title}</Text>
              <Text style={d.captureDesc}>{t.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {aiOpen && <AiBuilderModal onClose={() => setAiOpen(false)} onCreated={(t: any) => setBuilderTemplate(t)} />}
      {builderTemplate !== null && <TemplateBuilder template={builderTemplate} onClose={() => setBuilderTemplate(null)} onSaved={() => setBuilderTemplate(null)} />}
    </SafeAreaView>
  );
}

const d = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.ink, marginTop: 4, letterSpacing: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  fallbackBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.amberSoft, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)', borderRadius: 12, padding: 12, marginBottom: 16 },
  fallbackText: { fontSize: 12, color: Colors.amber, flex: 1, lineHeight: 18 },
  scoreCard: { borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 16, backgroundColor: Colors.surface },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  scoreCircle: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  scoreNum: { fontSize: 18, fontWeight: '800' },
  scoreLbl: { fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  scoreTitle: { fontSize: 16, fontWeight: '800', color: Colors.ink, letterSpacing: 0.5 },
  scoreDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, lineHeight: 18 },
  scoreExtra: { fontSize: 12, color: Colors.textTertiary, marginTop: 4 },
  briefingCard: { borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)', borderRadius: 16, padding: 16, backgroundColor: Colors.violetSoft, marginBottom: 16 },
  briefingLoading: { fontSize: 13, color: Colors.violet, marginTop: 8, textAlign: 'center' },
  briefingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  briefingOverline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: Colors.violet },
  confBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: Colors.surface },
  confDot: { width: 6, height: 6, borderRadius: 3 },
  confText: { fontSize: 9, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  briefingTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  briefingBody: { fontSize: 14, color: Colors.textSecondary, marginTop: 6, lineHeight: 20 },
  evidenceWrap: { marginTop: 12 },
  evidenceLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: Colors.textTertiary, marginBottom: 6 },
  evidenceChip: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)', borderRadius: 10, backgroundColor: Colors.surface, marginBottom: 6 },
  evidenceType: { fontSize: 9, fontWeight: '700', color: Colors.violet, backgroundColor: Colors.violetSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, letterSpacing: 0.5 },
  evidenceText: { fontSize: 12, color: Colors.textSecondary, flex: 1, lineHeight: 16 },
  askLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(167,139,250,0.2)' },
  askLinkText: { fontSize: 13, color: Colors.violet, fontWeight: '600' },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.textTertiary, marginBottom: 10, marginTop: 8 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  metricCard: { width: '48%', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12 },
  metricIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  metricLabel: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  metricSub: { fontSize: 8, color: Colors.textTertiary, fontWeight: '700', letterSpacing: 0.8 },
  metricValue: { fontSize: 20, fontWeight: '800', color: Colors.orange },
  captureCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 8 },
  captureIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  captureTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  captureDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  aiTile: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.violetSoft, borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)', borderRadius: 14, padding: 14, marginBottom: 8 },
  aiIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(167,139,250,0.2)', alignItems: 'center', justifyContent: 'center' },
  aiTitle: { fontSize: 15, fontWeight: '600', color: Colors.violet },
  aiDesc: { fontSize: 12, color: Colors.violet, marginTop: 2, opacity: 0.7 },
});
