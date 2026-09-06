/**
 * Sites tab — site list with sign-in/out + visitor entry card.
 * v58.13.132c — M3 implementation (mockup 06).
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import CompanyPill from '../../src/components/CompanyPill';
import SignInModal from '../../src/components/SignInModal';
import SignOutModal from '../../src/components/SignOutModal';
import { fetchHome } from '../../src/services/home';
import {
  fetchSites, workerSignIn, workerSignOut,
  type Site, type SitesResponse,
} from '../../src/services/sites';
import { enqueue } from '../../src/services/offline-queue';

export default function SitesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();

  const [userLat, setUserLat] = useState<number | undefined>();
  const [userLng, setUserLng] = useState<number | undefined>();
  const [gpsStatus, setGpsStatus] = useState<'pending' | 'granted' | 'denied'>('pending');

  // GPS permission (web fallback)
  useEffect(() => {
    (async () => {
      if (Platform.OS === 'web') {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => { setUserLat(pos.coords.latitude); setUserLng(pos.coords.longitude); setGpsStatus('granted'); },
            () => setGpsStatus('denied'),
            { timeout: 5000 }
          );
        } else {
          setGpsStatus('denied');
        }
        return;
      }
      try {
        const Location = require('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          setGpsStatus('granted');
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserLat(loc.coords.latitude);
          setUserLng(loc.coords.longitude);
        } else {
          setGpsStatus('denied');
        }
      } catch {
        setGpsStatus('denied');
      }
    })();
  }, []);

  const { data: homeData } = useQuery({ queryKey: ['mobile-home'], queryFn: fetchHome, staleTime: 60000 });
  const { data, isLoading, refetch } = useQuery<SitesResponse>({
    queryKey: ['mobile-sites', userLat, userLng],
    queryFn: () => fetchSites(userLat, userLng),
    staleTime: 30000,
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => { setRefreshing(true); await refetch(); setRefreshing(false); }, [refetch]);

  // Sign-in modal state
  const [signInSite, setSignInSite] = useState<Site | null>(null);
  const [signInLoading, setSignInLoading] = useState(false);
  const [signOutSiteId, setSignOutSiteId] = useState<string | null>(null);
  const [signOutSiteName, setSignOutSiteName] = useState('');
  const [signOutLoading, setSignOutLoading] = useState(false);

  const handleSignIn = useCallback(async (photoUri?: string) => {
    if (!signInSite) return;
    setSignInLoading(true);
    try {
      const gps = userLat && userLng ? { lat: userLat, lng: userLng } : undefined;
      await workerSignIn(signInSite.id, gps, photoUri);
      setSignInSite(null);
      Alert.alert('Signed in', `You are now signed in to ${signInSite.name}`);
      qc.invalidateQueries({ queryKey: ['mobile-sites'] });
      qc.invalidateQueries({ queryKey: ['mobile-home'] });
    } catch (err: any) {
      if (err?.message?.includes('Network')) {
        await enqueue({ method: 'POST', url: `/api/mobile/sites/${signInSite.id}/sign-in`, body: { kind: 'worker', gps: userLat && userLng ? { lat: userLat, lng: userLng } : null } });
        Alert.alert('Queued', 'Sign-in queued — will sync when online');
        setSignInSite(null);
      } else {
        Alert.alert('Error', err?.response?.data?.detail || 'Sign-in failed');
      }
    }
    setSignInLoading(false);
  }, [signInSite, userLat, userLng, qc]);

  const handleSignOut = useCallback(async () => {
    if (!signOutSiteId) return;
    setSignOutLoading(true);
    try {
      const gps = userLat && userLng ? { lat: userLat, lng: userLng } : undefined;
      await workerSignOut(signOutSiteId, gps);
      setSignOutSiteId(null);
      Alert.alert('Signed out', 'You have been signed out');
      qc.invalidateQueries({ queryKey: ['mobile-sites'] });
      qc.invalidateQueries({ queryKey: ['mobile-home'] });
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.detail || 'Sign-out failed');
    }
    setSignOutLoading(false);
  }, [signOutSiteId, userLat, userLng, qc]);

  const activeSiteId = data?.user_active_sign_in_site_id;

  // Loading
  if (isLoading && !data) {
    return (
      <View testID="sites-loading" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}><ActivityIndicator size="large" color={Colors.orange} /></View>
      </View>
    );
  }

  const sites = data?.sites || [];

  return (
    <View testID="sites-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Sites</Text>
        {homeData?.can_switch_company && (
          <CompanyPill
            companies={homeData.companies}
            activeId={homeData.active_company_id}
            canSwitch={homeData.can_switch_company}
          />
        )}
      </View>

      {gpsStatus === 'denied' && (
        <View style={s.gpsBanner}>
          <Ionicons name="navigate-outline" size={16} color={Colors.warning} />
          <Text style={s.gpsBannerText}>Location access denied — sites sorted alphabetically</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}
      >
        {/* Section: Sign me in */}
        <Text style={s.sectionTitle}>{"SIGN ME IN \u2014 TODAY\u2019S SITES"}</Text>

        {sites.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            isSignedIn={site.user_signed_in}
            onSignIn={() => setSignInSite(site)}
            onSignOut={() => { setSignOutSiteId(site.id); setSignOutSiteName(site.name); }}
          />
        ))}

        {sites.length === 0 && (
          <View style={s.emptyCard}>
            <Ionicons name="location-outline" size={32} color={Colors.textTertiary} />
            <Text style={s.emptyText}>No sites available</Text>
          </View>
        )}

        {/* Visitor section */}
        <View style={s.divider} />
        <Text style={s.sectionTitle}>VISITORS</Text>
        <TouchableOpacity
          testID="visitor-card"
          style={[s.visitorCard, !activeSiteId && s.visitorDisabled]}
          onPress={() => {
            if (!activeSiteId) {
              Alert.alert('Not signed in', 'Sign in to a site first to host a visitor');
              return;
            }
            router.push({ pathname: '/visitor/[siteId]/step1', params: { siteId: activeSiteId } } as any);
          }}
          activeOpacity={activeSiteId ? 0.7 : 1}
        >
          <View style={s.visitorIcon}>
            <Ionicons name="person-add-outline" size={24} color={activeSiteId ? Colors.orange : Colors.textTertiary} />
          </View>
          <View style={s.visitorText}>
            <Text style={[s.visitorTitle, !activeSiteId && s.textDisabled]}>Sign in a visitor</Text>
            <Text style={s.visitorSub}>
              {activeSiteId ? 'Induction, PPE, escort details' : 'Sign in to a site first to host a visitor'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={activeSiteId ? Colors.orange : Colors.textTertiary} />
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modals */}
      <SignInModal
        visible={!!signInSite}
        site={signInSite}
        onConfirm={handleSignIn}
        onCancel={() => setSignInSite(null)}
        loading={signInLoading}
      />
      <SignOutModal
        visible={!!signOutSiteId}
        siteName={signOutSiteName}
        onConfirm={handleSignOut}
        onCancel={() => setSignOutSiteId(null)}
        loading={signOutLoading}
      />
    </View>
  );
}

// ── Site Card component ──
function SiteCard({ site, isSignedIn, onSignIn, onSignOut }: {
  site: Site; isSignedIn: boolean; onSignIn: () => void; onSignOut: () => void;
}) {
  const timeSince = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  return (
    <View testID={`site-card-${site.id}`} style={[s.card, site.is_nearest && s.cardNearest]}>
      {/* Map placeholder */}
      <View style={s.mapThumb}>
        <Ionicons name="location" size={20} color={Colors.orange} />
      </View>

      {/* Info */}
      <View style={s.cardInfo}>
        <View style={s.cardNameRow}>
          <Text style={s.cardName} numberOfLines={1}>{site.name}</Text>
          {site.is_nearest && (
            <View style={s.nearestChip}>
              <Text style={s.nearestText}>Nearest</Text>
            </View>
          )}
        </View>
        <Text style={s.cardAddr} numberOfLines={1}>{site.address || 'No address'}</Text>
        {site.distance_km != null && (
          <View style={s.distChip}>
            <Ionicons name="navigate" size={12} color={Colors.textTertiary} />
            <Text style={s.distText}>{site.distance_km} km away</Text>
          </View>
        )}
      </View>

      {/* Action */}
      <View style={s.cardAction}>
        {isSignedIn ? (
          <>
            <View style={s.signedInChip}>
              <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
              <Text style={s.signedInText}>Signed in</Text>
              {site.signed_in_at && (
                <Text style={s.signedInTime}>{timeSince(site.signed_in_at)}</Text>
              )}
            </View>
            <TouchableOpacity testID={`signout-btn-${site.id}`} style={s.signOutGhost} onPress={onSignOut}>
              <Text style={s.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity testID={`signin-btn-${site.id}`} style={s.signInPill} onPress={onSignIn}>
            <Text style={s.signInText}>Sign in</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Styles ──
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.ink },
  gpsBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.warningSoft, paddingHorizontal: 16, paddingVertical: 8,
  },
  gpsBannerText: { fontSize: 12, color: Colors.warning, fontWeight: '500' },
  scroll: { padding: 16, paddingBottom: 32 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: Colors.textTertiary,
    letterSpacing: 1, marginBottom: 12, marginTop: 8,
  },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 10, gap: 12,
  },
  cardNearest: { borderColor: Colors.orange, borderWidth: 2 },
  mapThumb: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: Colors.orangeSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardInfo: { flex: 1 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardName: { fontSize: 15, fontWeight: '700', color: Colors.ink, flexShrink: 1 },
  nearestChip: {
    backgroundColor: Colors.orangeSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  nearestText: { fontSize: 10, fontWeight: '700', color: Colors.orange },
  cardAddr: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  distChip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  distText: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' },
  cardAction: { alignItems: 'flex-end', gap: 4 },
  signInPill: {
    backgroundColor: Colors.orange, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  signInText: { color: Colors.white, fontSize: 13, fontWeight: '700' },
  signedInChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successSoft, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  signedInText: { fontSize: 11, fontWeight: '600', color: Colors.success },
  signedInTime: { fontSize: 10, color: Colors.textTertiary },
  signOutGhost: { paddingHorizontal: 8, paddingVertical: 4 },
  signOutText: { fontSize: 12, color: Colors.textTertiary, fontWeight: '500' },
  emptyCard: {
    alignItems: 'center', padding: 32, gap: 8,
    backgroundColor: Colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  emptyText: { fontSize: 14, color: Colors.textTertiary },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 16 },
  visitorCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 2, borderColor: Colors.border, borderStyle: 'dashed', gap: 12,
  },
  visitorDisabled: { opacity: 0.5 },
  visitorIcon: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.orangeSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  visitorText: { flex: 1 },
  visitorTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  textDisabled: { color: Colors.textTertiary },
  visitorSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
});
