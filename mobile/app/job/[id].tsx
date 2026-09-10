/**
 * Job screen — the whiteboard → phone flow, on one screen.
 *
 *   map/address · when · task  →  ACCEPT / DECLINE
 *   once accepted:  NAVIGATE (Google Maps) · SIGN ON TO SITE (GPS or site QR)
 *
 * Data: GET /api/mobile/daily-jobs/today (assignment issued by the office),
 * POST …/{id}/accept | decline. Sign-on: POST /api/sites/{site}/signon-v127
 * with the job id attached, then → /site/signed-on.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Alert, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { Screen, BackHeader, Panel, KV, Loading, Chip, Hint, Empty } from '../../src/components/ui';
import PrimaryButton from '../../src/components/PrimaryButton';
import { fetchTodayDailyJob, acceptDailyJob, declineDailyJob, type TodayJob } from '../../src/services/dailyJobs';
import { workerSignIn } from '../../src/services/sites';
import { readGps, distanceKm, openDirections, staticMapUrl, type Gps } from '../../src/services/geo';

const SIGNON_RADIUS_KM = 1.0;

function fmtWhen(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

export default function JobScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<TodayJob | null | undefined>(undefined);
  const [gps, setGps] = useState<Gps>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | 'signon' | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchTodayDailyJob();
      setJob(r.assignment && (!id || r.assignment.id === id) ? r.assignment : r.assignment ?? null);
    } catch { setJob(null); }
  }, [id]);

  useEffect(() => { load(); readGps().then(setGps); }, [load]);

  const j: any = job || {};
  const coords = job?.site_coords || null;
  const km = gps && coords ? distanceKm({ lat: gps.lat, lng: gps.lng }, coords) : null;
  const mapUrl = coords ? staticMapUrl(coords.lat, coords.lng) : null;
  const accepted = job?.status === 'accepted';
  const pending = job?.status === 'pending_accept';

  const act = async (kind: 'accept' | 'decline') => {
    if (!job) return;
    if (kind === 'decline') {
      const ok = await new Promise<boolean>(res => Alert.alert('Decline this job?', 'The office will be told straight away.', [
        { text: 'Keep it', style: 'cancel', onPress: () => res(false) },
        { text: 'Decline', style: 'destructive', onPress: () => res(true) },
      ]));
      if (!ok) return;
    }
    setBusy(kind);
    try {
      const updated = kind === 'accept' ? await acceptDailyJob(job.id) : await declineDailyJob(job.id);
      setJob(updated);
      if (kind === 'decline') router.back();
    } catch (e: any) {
      Alert.alert("Couldn't update the job", e?.response?.data?.detail || e?.message || 'Try again in a moment.');
    }
    setBusy(null);
  };

  const signOn = async () => {
    if (!job) return;
    const here = gps || (await readGps());
    if (here) setGps(here);
    if (coords && here) {
      const d = distanceKm({ lat: here.lat, lng: here.lng }, coords);
      if (d > SIGNON_RADIUS_KM) {
        Alert.alert('Not at the site yet', `You look to be ${d.toFixed(1)} km away. Sign on when you arrive, or scan the site QR code.`, [
          { text: 'OK' }, { text: 'Scan site QR', onPress: () => router.push('/(tabs)/scan' as never) },
        ]);
        return;
      }
    }
    setBusy('signon');
    try {
      await workerSignIn(job.site_id, here ? { lat: here.lat, lng: here.lng } : undefined, job.id);
      router.replace({ pathname: '/site/signed-on', params: { siteId: job.site_id, siteName: job.site_name || '', jobId: job.id } } as never);
    } catch (e: any) {
      Alert.alert("Couldn't sign on", e?.response?.data?.detail || e?.message || 'Try the site QR code instead.');
    }
    setBusy(null);
  };

  return (
    <Screen testID="job-screen" bottomPad={40}>
      <BackHeader title={j.title || j.site_name || 'Your job'} right={job ? <Chip text={accepted ? 'ACCEPTED' : pending ? 'NEW' : job.status.toUpperCase()} tone={accepted ? 'green' : 'orange'} /> : undefined} />
      {job === undefined ? <Loading text="Loading job…" /> : job === null ? (
        <Empty icon="briefcase-outline" title="No job issued today" body="When the office allocates one from the whiteboard it appears here and you get a notification." />
      ) : (
        <>
          <Text style={s.overline}>{pending ? `ISSUED ${fmtWhen(job.assigned_at)}` : accepted ? `ACCEPTED ${fmtWhen(job.accepted_at)}` : ''}</Text>

          <View style={s.mapCard}>
            {mapUrl ? (
              <Image source={{ uri: mapUrl }} style={s.map} resizeMode="cover" />
            ) : (
              <TouchableOpacity style={s.mapPlaceholder} activeOpacity={0.8} onPress={() => openDirections({ ...(coords || {}), address: job.site_address })}>
                <Ionicons name="map-outline" size={40} color={Colors.onCardSubtle} />
                <Text style={s.mapText}>Tap to open in Google Maps</Text>
              </TouchableOpacity>
            )}
            <View style={s.addrRow}>
              <Ionicons name="location" size={18} color={Colors.orange} />
              <View style={{ flex: 1 }}>
                <Text style={s.addr}>{job.site_address || job.site_name || 'Address to follow'}</Text>
                {km != null && <Text style={s.addrSub}>{km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} from you</Text>}
              </View>
            </View>
          </View>

          <Panel style={{ marginTop: 10 }}>
            <KV k="SITE" v={job.site_name} first />
            <KV k="WHEN" v={fmtWhen(j.start_at || job.assigned_at)} />
            {!!j.task && <KV k="TASK" v={j.task} />}
            {!!j.supervisor && <KV k="SUPERVISOR" v={j.supervisor} />}
            {!!j.notes && <KV k="NOTES" v={j.notes} />}
          </Panel>

          {pending && (
            <View style={s.btnRow}>
              <PrimaryButton testID="job-decline" title="DECLINE" variant="grey" style={{ flex: 1 }} onPress={() => act('decline')} loading={busy === 'decline'} disabled={!!busy} />
              <PrimaryButton testID="job-accept" title="ACCEPT JOB" variant="green" style={{ flex: 2 }} onPress={() => act('accept')} loading={busy === 'accept'} disabled={!!busy} />
            </View>
          )}
          <View style={s.btnRow}>
            <PrimaryButton testID="job-navigate" title="NAVIGATE" variant="orange" style={{ flex: 1 }} onPress={() => openDirections({ ...(coords || {}), address: job.site_address })} disabled={!accepted} />
            <PrimaryButton testID="job-signon" title="SIGN ON" variant="outline" style={{ flex: 1 }} onPress={signOn} loading={busy === 'signon'} disabled={!accepted || !!busy} />
          </View>
          <Hint>{accepted ? 'Sign-on uses your GPS at the site, or scan the site QR code.' : 'Navigate and Sign on unlock once you accept. The office sees your answer straight away.'}</Hint>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange, marginBottom: 10 },
  mapCard: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 14, overflow: 'hidden' },
  map: { width: '100%', height: 190 },
  mapPlaceholder: { height: 150, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#E8EBE4' },
  mapText: { fontSize: 12, color: Colors.onCardMuted, fontWeight: '600' },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  addr: { fontSize: 14, fontWeight: '700', color: Colors.onCard },
  addrSub: { fontSize: 12, color: Colors.onCardMuted, marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
