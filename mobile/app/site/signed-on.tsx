/** Signed on — confirmation after site sign-on, leading straight into the pre-start. */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../src/theme/colors';
import { Panel, KV, Hint } from '../../src/components/ui';
import PrimaryButton from '../../src/components/PrimaryButton';
import { workerSignOut } from '../../src/services/sites';

export default function SignedOnScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { siteId, siteName, jobId, crew } = useLocalSearchParams<{ siteId: string; siteName?: string; jobId?: string; crew?: string }>();
  const time = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

  const signOff = () => Alert.alert('Sign off?', `Sign off from ${siteName || 'this site'}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign off', style: 'destructive', onPress: async () => { try { await workerSignOut(); } catch { /* best effort */ } router.replace('/(tabs)/home' as never); } },
  ]);

  return (
    <View testID="signed-on-screen" style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.banner}>
        <Ionicons name="location" size={14} color={Colors.white} />
        <Text style={s.bannerText} numberOfLines={1}>ON-SITE: {(siteName || 'SITE').toUpperCase()}{jobId ? ' · JOB LINKED' : ''}</Text>
        <TouchableOpacity testID="signoff-btn" style={s.signOff} onPress={signOff}>
          <Text style={s.signOffText}>SIGN OFF</Text>
        </TouchableOpacity>
      </View>
      <View style={s.body}>
        <View style={s.hero}>
          <View style={s.tick}><Ionicons name="checkmark" size={34} color={Colors.green} /></View>
          <View>
            <Text style={s.title}>Signed on</Text>
            <Text style={s.sub}>{time} · office notified</Text>
          </View>
        </View>
        <Panel>
          <KV k="SITE" v={siteName || siteId} first />
          {!!crew && <KV k="CREW ON SITE" v={crew} />}
          {!!jobId && <KV k="JOB" v="Linked to today's issued job" />}
        </Panel>
        <View style={{ marginTop: 16, gap: 10 }}>
          <PrimaryButton
            testID="start-prestart"
            title="START DAILY PRE-START"
            variant="green"
            onPress={() => router.replace({ pathname: '/capture/[module]/new', params: { module: 'pre-starts', job_id: jobId || '' } } as never)}
          />
          <PrimaryButton testID="signed-on-home" title="BACK TO HOME" variant="grey" onPress={() => router.replace('/(tabs)/home' as never)} />
        </View>
        <Hint>Your supervisor can see who's on site in the portal.</Hint>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screen },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.orange, paddingVertical: 10, paddingHorizontal: 16 },
  bannerText: { flex: 1, fontSize: 11, fontWeight: '800', color: Colors.white, letterSpacing: 0.8 },
  signOff: { backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minHeight: 32, justifyContent: 'center' },
  signOffText: { fontSize: 10, fontWeight: '800', color: Colors.white },
  body: { padding: 16 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  tick: { width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: Colors.onScreen },
  sub: { fontSize: 12, color: Colors.onScreenMuted, marginTop: 2 },
});
