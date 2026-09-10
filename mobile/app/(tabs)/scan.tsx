/**
 * QR Scan tab — one scanner for every Paneltec QR:
 *   site sticker   → sign on to that site (linked to today's job if there is one)
 *   vehicle/plant  → new pre-start with the asset filled in
 *   onboarding card→ /onboard
 * Also lists nearby sites so a worker can sign on without a sticker.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { Screen, PageHeader, SectionLabel, FieldLabel, Input, Loading, Hint } from '../../src/components/ui';
import { fetchSites, workerSignIn, type Site } from '../../src/services/sites';
import { fetchTodayDailyJob } from '../../src/services/dailyJobs';
import { extractOnboardingToken } from '../../src/services/auth';
import { readGps, type Gps } from '../../src/services/geo';

type CamModule = { CameraView: React.ComponentType<any>; useCameraPermissions: () => any };
const Cam: CamModule | null = Platform.OS === 'web' ? null : (() => { try { return require('expo-camera') as CamModule; } catch { return null; } })();
const useCameraPermissionsSafe: () => any = Cam ? Cam.useCameraPermissions : () => [null, async () => {}];

function parseScan(raw: string): { kind: 'site' | 'asset' | 'worker' | 'onboard'; token: string } | null {
  const v = (raw || '').trim();
  let m = v.match(/\/scan\/site\/([^/?#\s]+)/); if (m) return { kind: 'site', token: m[1] };
  m = v.match(/\/scan\/(?:asset|vehicle|plant)\/([^/?#\s]+)/); if (m) return { kind: 'asset', token: m[1] };
  m = v.match(/\/scan\/worker\/([^/?#\s]+)/); if (m) return { kind: 'worker', token: m[1] };
  m = v.match(/\/m\/onboard\/([^/?#\s]+)|[?&]token=([^&#\s]+)/); if (m) return { kind: 'onboard', token: m[1] || m[2] };
  return null;
}

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissionsSafe();
  const [scanned, setScanned] = useState(false);
  const [manual, setManual] = useState('');
  const [sites, setSites] = useState<Site[] | null>(null);
  const [gps, setGps] = useState<Gps>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const g = await readGps(); setGps(g);
    try { const r = await fetchSites(g?.lat, g?.lng); setSites(r.sites.slice(0, 6)); } catch { setSites([]); }
  }, []);
  useFocusEffect(useCallback(() => { setScanned(false); load(); }, [load]));
  useEffect(() => { if (Cam && permission && !permission.granted && permission.canAskAgain) requestPermission(); }, [permission]);

  const signOnTo = async (site: { id: string; name: string }) => {
    setBusy(site.id);
    try {
      let jobId: string | null = null;
      try { const t = await fetchTodayDailyJob(); if (t.assignment && t.assignment.site_id === site.id) jobId = t.assignment.id; } catch { /* no job is fine */ }
      await workerSignIn(site.id, gps ? { lat: gps.lat, lng: gps.lng } : undefined, jobId);
      router.push({ pathname: '/site/signed-on', params: { siteId: site.id, siteName: site.name, jobId: jobId || '' } } as never);
    } catch (e: any) {
      Alert.alert("Couldn't sign on", e?.response?.data?.detail || e?.message || 'Try again in a moment.');
    }
    setBusy(null); setScanned(false);
  };

  const handle = async (raw: string) => {
    const p = parseScan(raw);
    if (!p) {
      const t = extractOnboardingToken(raw);
      if (t) { router.push({ pathname: '/onboard', params: { token: t } } as never); return; }
      Alert.alert('Not a Paneltec code', "That QR isn't a site, vehicle or onboarding code.", [{ text: 'OK', onPress: () => setScanned(false) }]);
      return;
    }
    if (p.kind === 'onboard') { router.push({ pathname: '/onboard', params: { token: p.token } } as never); return; }
    if (p.kind === 'asset') { router.push({ pathname: '/capture/[module]/new', params: { module: 'pre-starts', asset_id: p.token } } as never); return; }
    if (p.kind === 'site') {
      const site = (sites || []).find(x => x.scan_token === p.token);
      if (site) { await signOnTo(site); return; }
      try {
        const all = await fetchSites(gps?.lat, gps?.lng);
        const found = all.sites.find(x => x.scan_token === p.token);
        if (found) { await signOnTo(found); return; }
      } catch { /* fall through */ }
      Alert.alert('Site not found', "This site sticker isn't in the portal yet.", [{ text: 'OK', onPress: () => setScanned(false) }]);
      return;
    }
    Alert.alert('Worker code', 'Worker ID checks are done from the portal for now.', [{ text: 'OK', onPress: () => setScanned(false) }]);
  };

  const CameraView = Cam?.CameraView;
  const cameraOk = !!Cam && !!permission?.granted && !!CameraView;

  return (
    <Screen testID="scan-screen">
      <PageHeader overline="QR SCANNER" title="SCAN & SIGN-ON" sub="Scan a site, vehicle or plant sticker." />
      <View style={s.scanWrap}>
        {cameraOk ? (
          <>
            <CameraView style={s.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned ? undefined : ({ data }: { data: string }) => { setScanned(true); handle(data); }} />
            <View pointerEvents="none" style={s.reticle} />
            {!!busy && <View style={s.busy}><Loading text="Signing on…" /></View>}
          </>
        ) : (
          <View style={s.noCam}>
            <Ionicons name="scan-outline" size={48} color={Colors.orange} />
            <Text style={s.noCamText}>{Cam ? 'Camera permission needed' : 'Camera not available here'}</Text>
            {Cam && <TouchableOpacity testID="scan-allow" style={s.allow} onPress={() => requestPermission()}><Text style={s.allowText}>Allow camera</Text></TouchableOpacity>}
          </View>
        )}
      </View>

      <FieldLabel>OR PASTE A QR LINK</FieldLabel>
      <View style={s.row}>
        <Input testID="scan-manual" style={{ flex: 1 }} value={manual} onChangeText={setManual} placeholder="https://…/scan/site/…" autoCapitalize="none" />
        <TouchableOpacity testID="scan-manual-go" style={[s.go, !manual.trim() && { opacity: 0.4 }]} disabled={!manual.trim()} onPress={() => handle(manual)}>
          <Ionicons name="arrow-forward" size={22} color={Colors.white} />
        </TouchableOpacity>
      </View>

      <SectionLabel style={{ marginTop: 20 }}>{gps ? 'NEAREST SITES' : 'SITES'}</SectionLabel>
      {sites === null ? <Loading /> : sites.length === 0 ? <Hint>No sites listed yet — the office adds them in the portal.</Hint> : (
        <View style={{ gap: 8 }}>
          {sites.map(site => (
            <TouchableOpacity key={site.id} testID={`site-${site.id}`} style={s.site} activeOpacity={0.8} onPress={() => signOnTo(site)} disabled={!!busy}>
              <Ionicons name="location" size={18} color={Colors.orange} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.siteName} numberOfLines={1}>{site.name}</Text>
                <Text style={s.siteSub} numberOfLines={1}>{site.address || ''}{site.distance_km != null ? ` · ${site.distance_km} km` : ''}</Text>
              </View>
              <Text style={s.siteGo}>{busy === site.id ? '…' : 'SIGN ON'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  scanWrap: { height: 240, borderRadius: 16, overflow: 'hidden', backgroundColor: '#0E2645', alignItems: 'center', justifyContent: 'center' },
  camera: { width: '100%', height: '100%' },
  reticle: { position: 'absolute', width: 170, height: 170, borderWidth: 2, borderColor: Colors.orange, borderRadius: 14, borderStyle: 'dashed' },
  busy: { position: 'absolute', inset: 0, backgroundColor: 'rgba(14,38,69,0.85)', alignItems: 'center', justifyContent: 'center' } as any,
  noCam: { alignItems: 'center', gap: 10 },
  noCamText: { color: Colors.onScreenMuted, fontSize: 13 },
  allow: { paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', borderRadius: 10, backgroundColor: Colors.orangeSoftOnNavy },
  allowText: { color: Colors.orange, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  go: { width: 48, height: 48, borderRadius: 10, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center' },
  site: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 12, padding: 12, minHeight: 60 },
  siteName: { fontSize: 14, fontWeight: '700', color: Colors.onCard },
  siteSub: { fontSize: 12, color: Colors.onCardMuted, marginTop: 2 },
  siteGo: { fontSize: 11, fontWeight: '800', color: Colors.green, letterSpacing: 0.5 },
});
