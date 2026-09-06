/**
 * Home tab — Dashboard with greeting, weather, site status, module tiles.
 * v58.13.132h — M6-reset: Pruned tile grid to Forms/Sites/Profile.
 *   - 3 primary tiles (Forms, Sites, Profile)
 *   - "More modules" for remaining backend modules
 *   - Navy header, white cards with shadow, hero card with weather
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import CompanyPill from '../../src/components/CompanyPill';
import {
  fetchHome,
  setActiveCompany,
  fetchNotificationCount,
  type HomeData,
  type HomeModule,
} from '../../src/services/home';

// ── Icon mapper ──
function moduleIcon(icon: string): keyof typeof Ionicons.glyphMap {
  const map: Record<string, string> = {
    'location': 'location', 'warning': 'warning', 'clipboard': 'clipboard',
    'book': 'book', 'alert-circle': 'alert-circle', 'search': 'search',
    'document': 'document', 'document-text': 'document-text', 'school': 'school',
    'car': 'car', 'ribbon': 'ribbon', 'sparkles': 'sparkles', 'person': 'person',
    'folder': 'folder', 'people': 'people', 'people-circle': 'people-circle',
    'business': 'business', 'shield-checkmark': 'shield-checkmark',
  };
  return (map[icon] || 'grid') as keyof typeof Ionicons.glyphMap;
}

// Primary tiles: Forms (covers all capture modules), Sites, Profile
const PRIMARY_KEYS = ['forms', 'sign_on', 'profile'];
// Form-category keys that are now inside the Forms tab — not standalone tiles
const FORM_MODULE_KEYS = new Set(['hazard', 'pre_start', 'site_diary', 'inspection', 'incident']);
const KNOWN_ROUTES = new Set([
  '/(tabs)/forms', '/(tabs)/sites', '/(tabs)/profile',
]);

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<HomeData>({
    queryKey: ['mobile-home'],
    queryFn: fetchHome,
    staleTime: 60_000,
    retry: 2,
  });

  const { data: notifCount } = useQuery({
    queryKey: ['mobile-notif-count'],
    queryFn: fetchNotificationCount,
    staleTime: 120_000,
  });

  const [refreshing, setRefreshing] = useState(false);
  const [moreExpanded, setMoreExpanded] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleCompanySwitch = useCallback(async (companyId: string) => {
    try {
      await setActiveCompany(companyId);
      queryClient.invalidateQueries({ queryKey: ['mobile-home'] });
    } catch { /* silent */ }
  }, [queryClient]);

  if (isLoading && !data) {
    return (
      <View testID="home-loading" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.loadingCenter}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={s.loadingText}>Loading dashboard…</Text>
        </View>
      </View>
    );
  }

  if (isError && !data) {
    return (
      <View testID="home-error" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.loadingCenter}>
          <Ionicons name="cloud-offline-outline" size={48} color={Colors.textTertiary} />
          <Text style={s.errorTitle}>Could not load dashboard</Text>
          <TouchableOpacity testID="home-retry-btn" style={s.retryBtn} onPress={() => refetch()}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const d = data!;
  const firstName = (d.user.name || '').split(' ')[0] || 'there';
  const badgeCount = notifCount || 0;

  // Split modules: primary 3 + more (excluding form-submodules)
  const primaryModules = PRIMARY_KEYS
    .map(k => d.modules.find(m => m.key === k))
    .filter(Boolean) as HomeModule[];
  const moreModules = d.modules.filter(m => !PRIMARY_KEYS.includes(m.key) && !FORM_MODULE_KEYS.has(m.key));

  return (
    <View testID="home-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* ── Navy header with greeting + company pill + bell ── */}
      <View style={s.navyHeader}>
        <View style={s.headerRow}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{d.user.avatar_initials}</Text>
          </View>
          <View style={s.greetingWrap}>
            <Text testID="home-greeting" style={s.greetingText}>
              {d.today.greeting}, {firstName}
            </Text>
            {d.user.employee_number ? (
              <Text style={s.empNum}>#{d.user.employee_number}</Text>
            ) : null}
          </View>
          <TouchableOpacity
            testID="home-notification-bell"
            style={s.bellBtn}
            onPress={() => {}}
          >
            <Ionicons name="notifications-outline" size={22} color={Colors.white} />
            {badgeCount > 0 && (
              <View style={s.bellBadge}>
                <Text style={s.bellBadgeText}>{badgeCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        {/* Company pill in header (mockup #10 style) */}
        {d.can_switch_company && (
          <View style={s.companyPillRow}>
            <CompanyPill
              companies={d.companies}
              activeId={d.active_company_id}
              canSwitch={d.can_switch_company}
              onSwitch={handleCompanySwitch}
            />
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}
      >
        {/* ── Hero card — Today + weather + site status ── */}
        <View style={s.heroCard}>
          <View style={s.heroLeft}>
            <Text testID="home-today-label" style={s.heroDateLabel}>
              {d.today.day_name}
            </Text>
            <Text style={s.heroDate}>{d.today.date_iso}</Text>
            {d.weather.temperature_c != null && (
              <View style={s.weatherRow}>
                <Ionicons name="partly-sunny" size={16} color="#F59E0B" />
                <Text style={s.weatherTemp}>{d.weather.temperature_c}°C</Text>
                <Text style={s.weatherCond}>{d.weather.condition}</Text>
              </View>
            )}
            {d.weather.wind_kmh != null && (
              <View style={s.weatherRow}>
                <Ionicons name="flag-outline" size={14} color={Colors.textTertiary} />
                <Text style={s.windText}>{d.weather.wind_kmh} km/h {d.weather.wind_dir}</Text>
              </View>
            )}
          </View>
          <View style={s.heroRight}>
            {d.site.signed_in ? (
              <View style={s.siteChip}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                <Text style={s.siteChipText} numberOfLines={2}>
                  Signed in{'\n'}{d.site.site_name}
                </Text>
              </View>
            ) : d.site.nearest ? (
              <TouchableOpacity
                testID="home-sign-in-site-btn"
                style={s.signInCta}
                onPress={() => router.push('/(tabs)/sites')}
              >
                <Ionicons name="location" size={16} color={Colors.white} />
                <Text style={s.signInCtaText}>Sign in to site</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.noSite}>
                <Ionicons name="location-outline" size={18} color={Colors.textTertiary} />
                <Text style={s.noSiteText}>No nearby sites</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Primary tiles 3×2 grid ── */}
        <View style={s.tilesSection}>
          <Text style={s.sectionTitle}>QUICK ACTIONS</Text>
          <View style={s.tilesGrid}>
            {primaryModules.map((m) => (
              <TouchableOpacity
                key={m.key}
                testID={`home-tile-${m.key}`}
                style={s.tile}
                onPress={() => {
                  if (m.key === 'forms') router.push('/(tabs)/forms' as never);
                  else if (m.key === 'sign_on') router.push('/(tabs)/sites' as never);
                  else if (m.key === 'profile') router.push('/(tabs)/profile' as never);
                  else if (KNOWN_ROUTES.has(m.route)) router.push(m.route as never);
                }}
                activeOpacity={0.7}
              >
                <View style={s.tileIconWrap}>
                  <Ionicons name={moduleIcon(m.icon)} size={24} color={Colors.white} />
                </View>
                {m.badge != null && m.badge > 0 && (
                  <View style={s.tileBadge}>
                    <Text style={s.tileBadgeText}>{m.badge}</Text>
                  </View>
                )}
                <Text style={s.tileLabel} numberOfLines={2}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── More modules (collapsible) ── */}
        {moreModules.length > 0 && (
          <View style={s.moreSection}>
            <TouchableOpacity
              testID="home-more-toggle"
              style={s.moreToggle}
              onPress={() => setMoreExpanded(!moreExpanded)}
            >
              <Text style={s.moreToggleText}>More modules</Text>
              <View style={s.moreCount}>
                <Text style={s.moreCountText}>{moreModules.length}</Text>
              </View>
              <Ionicons
                name={moreExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
            {moreExpanded && (
              <View style={s.moreGrid}>
                {moreModules.map((m) => {
                  const active = KNOWN_ROUTES.has(m.route);
                  return (
                    <TouchableOpacity
                      key={m.key}
                      testID={`home-tile-${m.key}`}
                      style={[s.moreTile, !active && s.moreTileMuted]}
                      onPress={() => {
                        if (active) router.push(m.route as any);
                      }}
                      activeOpacity={active ? 0.7 : 1}
                    >
                      <View style={[s.moreTileIcon, !active && s.moreTileIconMuted]}>
                        <Ionicons name={moduleIcon(m.icon)} size={18} color={active ? Colors.white : Colors.textTertiary} />
                      </View>
                      <Text style={[s.moreTileLabel, !active && s.moreTileLabelMuted]} numberOfLines={1}>
                        {m.label}
                      </Text>
                      {!active && <Text style={s.comingSoon}>Soon</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flexGrow: 1 },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  errorTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSecondary, marginTop: 8 },
  retryBtn: { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 12 },
  retryText: { color: Colors.white, fontWeight: '700', fontSize: 15 },

  // ── Navy header ──
  navyHeader: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: Colors.white, fontSize: 17, fontWeight: '800' },
  greetingWrap: { flex: 1, marginLeft: 12 },
  greetingText: { color: Colors.white, fontSize: 20, fontWeight: '700' },
  empNum: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '500', marginTop: 2 },
  bellBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bellBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: Colors.error, borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  bellBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '800' },
  companyPillRow: { marginTop: 10 },

  // ── Hero card ──
  heroCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 18, padding: 18,
    // iOS shadow
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8,
    elevation: 3,
  },
  heroLeft: { flex: 1 },
  heroDateLabel: {
    fontSize: 13, fontWeight: '700', color: Colors.orange,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  heroDate: { fontSize: 15, fontWeight: '600', color: Colors.ink, marginTop: 4 },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  weatherTemp: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  weatherCond: { fontSize: 13, color: Colors.textSecondary },
  windText: { fontSize: 12, color: Colors.textTertiary },
  heroRight: { marginLeft: 12, justifyContent: 'center', alignItems: 'flex-end', maxWidth: 140 },
  siteChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.successSoft, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  siteChipText: { fontSize: 11, fontWeight: '600', color: Colors.success, flexShrink: 1 },
  signInCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.orange, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  signInCtaText: { color: Colors.white, fontSize: 13, fontWeight: '700' },
  noSite: { alignItems: 'center', gap: 4 },
  noSiteText: { fontSize: 12, color: Colors.textTertiary },

  // ── Primary tiles ──
  tilesSection: { paddingHorizontal: 16, marginTop: 24 },
  sectionTitle: {
    fontSize: 11, fontWeight: '800', color: Colors.textTertiary,
    letterSpacing: 1.2, marginBottom: 12,
  },
  tilesGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 12,
  },
  tile: {
    width: '30.5%', minWidth: 100, flexGrow: 1,
    backgroundColor: Colors.surface, borderRadius: 18,
    paddingVertical: 20, paddingHorizontal: 12, alignItems: 'center',
    // Card shadow
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8,
    elevation: 3,
  },
  tileIconWrap: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  tileBadge: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: Colors.orange, borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5,
  },
  tileBadgeText: { color: Colors.white, fontSize: 11, fontWeight: '800' },
  tileLabel: {
    fontSize: 13, fontWeight: '700', color: Colors.ink,
    textAlign: 'center', marginTop: 10,
  },

  // ── More modules ──
  moreSection: { paddingHorizontal: 16, marginTop: 24 },
  moreToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10,
  },
  moreToggleText: {
    fontSize: 13, fontWeight: '700', color: Colors.textSecondary, flex: 1,
  },
  moreCount: {
    backgroundColor: Colors.border, borderRadius: 10,
    minWidth: 24, height: 22, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
  },
  moreCountText: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary },
  moreGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8,
  },
  moreTile: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4,
    elevation: 1,
  },
  moreTileMuted: { opacity: 0.55 },
  moreTileIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  moreTileIconMuted: { backgroundColor: Colors.textTertiary },
  moreTileLabel: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  moreTileLabelMuted: { color: Colors.textTertiary },
  comingSoon: {
    fontSize: 9, fontWeight: '700', color: Colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
});
