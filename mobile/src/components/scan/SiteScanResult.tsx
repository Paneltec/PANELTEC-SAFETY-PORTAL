import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
  Alert, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import api from '../../lib/api';
import { getUser } from '../../lib/auth';
import { Colors } from '../../lib/colors';
import { setActiveSignOn, clearActiveSignOn } from '../../lib/signon';

interface Props { token: string; onReset: () => void; }

export default function SiteScanResult({ token, onReset }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState<any>(null);
  const [signingOff, setSigningOff] = useState(false);
  const [ackSwms, setAckSwms] = useState<Set<string>>(new Set());
  const [user, setUser] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsState, setGpsState] = useState<'idle' | 'loading' | 'ok' | 'denied'>('idle');

  useEffect(() => {
    getUser().then(setUser);
    let alive = true;
    api.get(`/scan/site/${token}`)
      .then(r => { if (alive) setData(r.data); })
      .catch(e => {
        if (alive) setError(e?.response?.status === 404
          ? 'Invalid or expired QR code. Ask your supervisor for a fresh QR.'
          : e?.response?.data?.detail || e.message);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  const captureGps = useCallback(async () => {
    setGpsState('loading');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setGpsState('denied'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setGps({ lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy });
      setGpsState('ok');
    } catch {
      setGpsState('denied');
    }
  }, []);

  useEffect(() => {
    if (data && gpsState === 'idle') captureGps();
  }, [data, gpsState, captureGps]);

  const toggleAck = (id: string) => {
    setAckSwms(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const updateAnswer = (qid: string, value: string) => {
    setAnswers(prev => ({ ...prev, [qid]: value }));
  };

  const requiredMissing = () => {
    const qs = data?.signon_questions || [];
    return qs.some((q: any) => q.required && (!answers[q.id] || answers[q.id] === ''));
  };

  const onSignOn = async () => {
    if (requiredMissing()) {
      Alert.alert('Missing answers', 'Please answer all required questions.');
      return;
    }
    setSigning(true);
    setError(null);
    try {
      const answersList = Object.entries(answers).map(([qid, value]) => ({ question_id: qid, value }));
      const gpsPayload = gps
        ? { gps_lat: gps.lat, gps_long: gps.lng, gps_accuracy_m: gps.accuracy }
        : { gps_lat: null, gps_long: null, gps_accuracy_m: null };
      const r = await api.post(`/scan/site/${token}/sign-on`, {
        swms_acknowledged: Array.from(ackSwms),
        answers: answersList,
        ...gpsPayload,
      });
      setSigned(r.data);
      await setActiveSignOn({
        signon_id: r.data.signon_id || r.data.id || '',
        site_name: data.site?.name || 'Site',
        signed_at: r.data.signed_at || new Date().toISOString(),
      });
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setSigning(false);
    }
  };

  const onSignOff = () => {
    Alert.alert('Sign off?', `Sign off from ${data?.site?.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign off', style: 'destructive', onPress: async () => {
          setSigningOff(true);
          try {
            await api.post('/me/signoff-active');
            await clearActiveSignOn();
            Alert.alert('Signed off', 'You have been signed off.');
            onReset();
          } catch (e: any) {
            Alert.alert('Error', e?.response?.data?.detail || e.message);
          } finally {
            setSigningOff(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={Colors.blue} />
        <Text style={s.loadText}>Resolving site...</Text>
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={s.errorCard}>
        <View style={s.errorIcon}>
          <Ionicons name="alert-circle" size={28} color={Colors.imError} />
        </View>
        <Text style={s.errorTitle}>QR Error</Text>
        <Text style={s.errorBody}>{error}</Text>
        <TouchableOpacity testID="site-scan-retry" style={s.retryBtn} onPress={onReset}>
          <Text style={s.retryText}>Scan Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!data) return null;
  const site = data.site;

  if (signed) {
    return (
      <ScrollView contentContainerStyle={s.scroll}>
        <View testID="site-signon-confirmation" style={s.successCard}>
          <View style={s.successCircle}>
            <Ionicons name="checkmark" size={32} color={Colors.imSurface} />
          </View>
          <Text style={s.successTitle}>You're signed on.</Text>
          <Text style={s.successSite}>{site.name}</Text>
          <Text style={s.successTime}>
            Signed on at {new Date(signed.signed_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          {signed.gps_warning && (
            <View testID="signon-gps-warning" style={s.gpsWarning}>
              <Ionicons name="warning" size={14} color={Colors.imInk} />
              <Text style={s.gpsWarningText}>
                GPS was {signed.gps_distance_m}m from the registered site location — your supervisor has been notified.
              </Text>
            </View>
          )}
          {signed.pass_expires_at && (
            <Text style={s.successExpiry}>
              Quick-access pass expires {new Date(signed.pass_expires_at).toLocaleString()}
            </Text>
          )}
          <Text style={s.signOffHint}>Sign off by re-scanning the QR or tapping Sign off below.</Text>
          <TouchableOpacity
            testID="site-signoff-btn"
            style={s.signOffBtn}
            onPress={onSignOff}
            disabled={signingOff}
            activeOpacity={0.7}
          >
            {signingOff
              ? <ActivityIndicator size="small" color={Colors.imError} />
              : <Ionicons name="log-out" size={16} color={Colors.imError} />}
            <Text style={s.signOffBtnText}>Sign off</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="site-scan-done" style={s.doneBtn} onPress={onReset}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
          <Text style={s.successFooter}>Stay safe out there. — Paneltec Civil WHS</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View testID="site-scan-resolver" style={s.siteHeader}>
        <Text style={s.siteOverline}>SITE SIGN-ON</Text>
        <Text style={s.siteName}>{site.name}</Text>
        {(site.address || site.suburb) && (
          <View style={s.addrRow}>
            <Ionicons name="location" size={13} color="rgba(255,255,255,0.85)" />
            <Text style={s.siteAddr}>{site.address || `${site.suburb}, ${site.state || ''}`.trim()}</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        testID="site-signon-gps-btn"
        style={[s.gpsChip, gpsState === 'ok' && s.gpsOk, gpsState === 'denied' && s.gpsDenied]}
        onPress={captureGps}
        disabled={gpsState === 'loading'}
        activeOpacity={0.7}
      >
        {gpsState === 'loading' ? (
          <ActivityIndicator size="small" color={Colors.textSecondary} />
        ) : (
          <Ionicons name="navigate" size={13} color={gpsState === 'ok' ? Colors.imSuccess : gpsState === 'denied' ? Colors.imInk : Colors.textSecondary} />
        )}
        <Text style={[s.gpsText, gpsState === 'ok' && { color: Colors.imSuccess }, gpsState === 'denied' && { color: Colors.imInk }]}>
          {gpsState === 'ok' && `Location captured (±${Math.round(gps?.accuracy || 0)}m)`}
          {gpsState === 'denied' && 'Location unavailable — proceed without'}
          {gpsState === 'loading' && 'Getting location…'}
          {gpsState === 'idle' && 'Capture location'}
        </Text>
      </TouchableOpacity>

      {user && (
        <View style={s.workerChip}>
          <Ionicons name="person" size={13} color={Colors.blue} />
          <Text style={s.workerName}>Signing on as {user.name || user.email}</Text>
        </View>
      )}

      {(data.signon_questions || []).length > 0 && (
        <View testID="signon-questions" style={s.section}>
          <Text style={s.sectionTitleText}>SIGN-ON QUESTIONS</Text>
          {data.signon_questions.map((q: any) => (
            <View key={q.id} testID={`signon-q-${q.id}`} style={s.questionCard}>
              <Text style={s.questionLabel}>
                {q.label}{q.required ? <Text style={{ color: Colors.imError }}> *</Text> : null}
              </Text>
              {q.type === 'yesno' && (
                <View style={s.yesnoRow}>
                  {['yes', 'no'].map(v => (
                    <TouchableOpacity
                      key={v}
                      testID={`q-${q.id}-${v}`}
                      style={[s.yesnoBtn, answers[q.id] === v && s.yesBtnActive]}
                      onPress={() => updateAnswer(q.id, v)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.yesBtnText, answers[q.id] === v && { color: Colors.imSurface }]}>
                        {v === 'yes' ? 'Yes' : 'No'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {q.type === 'text' && (
                <TextInput
                  testID={`q-${q.id}-input`}
                  style={s.questionInput}
                  value={answers[q.id] || ''}
                  onChangeText={(t) => updateAnswer(q.id, t)}
                  placeholder="Your answer…"
                  placeholderTextColor={Colors.textTertiary}
                />
              )}
              {q.type === 'choice' && (
                <View style={s.choiceList}>
                  {(q.choices || []).map((c: string) => (
                    <TouchableOpacity
                      key={c}
                      testID={`q-${q.id}-choice-${c}`}
                      style={[s.choiceRow, answers[q.id] === c && s.choiceActive]}
                      onPress={() => updateAnswer(q.id, c)}
                      activeOpacity={0.7}
                    >
                      <View style={[s.radio, answers[q.id] === c && s.radioActive]}>
                        {answers[q.id] === c && <View style={s.radioDot} />}
                      </View>
                      <Text style={s.choiceText}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {data.active_swms?.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="shield-checkmark" size={14} color={Colors.emerald} />
            <Text style={s.sectionTitleText}>ACKNOWLEDGE SWMS</Text>
          </View>
          {data.active_swms.map((sw: any) => (
            <TouchableOpacity
              key={sw.id}
              testID={`ack-swms-${sw.id}`}
              style={[s.swmsRow, ackSwms.has(sw.id) && s.swmsRowActive]}
              onPress={() => toggleAck(sw.id)}
              activeOpacity={0.7}
            >
              <View style={[s.checkbox, ackSwms.has(sw.id) && s.checkboxActive]}>
                {ackSwms.has(sw.id) && <Ionicons name="checkmark" size={12} color={Colors.imSurface} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.swmsTitle} numberOfLines={1}>{sw.title}</Text>
                <Text style={s.swmsSub}>{sw.code || '—'} · {sw.version || 'v?'}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {error && (
        <View style={s.errorBanner}>
          <Ionicons name="alert-circle" size={14} color={Colors.imError} />
          <Text style={s.errorBannerText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity
        testID="site-signon-btn"
        style={[s.signOnBtn, signing && { opacity: 0.6 }]}
        onPress={onSignOn}
        disabled={signing}
        activeOpacity={0.7}
      >
        {signing
          ? <ActivityIndicator size="small" color={Colors.imSurface} />
          : <Ionicons name="checkmark-circle" size={18} color={Colors.imSurface} />}
        <Text style={s.signOnText}>Sign me on</Text>
      </TouchableOpacity>

      <Text style={s.disclaimer}>
        By signing on you confirm you're fit-for-work and have read the SWMS above.
      </Text>

      <TouchableOpacity testID="site-scan-back" style={s.backBtn} onPress={onReset}>
        <Ionicons name="arrow-back" size={14} color={Colors.blue} />
        <Text style={s.backText}>Scan another code</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadText: { marginTop: 12, fontSize: 14, color: Colors.textSecondary },
  scroll: { padding: 16, paddingBottom: 40 },
  errorCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, margin: 16 },
  errorIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: Colors.imConcrete, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink },
  errorBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  retryBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  retryText: { fontSize: 14, fontWeight: '600', color: Colors.blue },
  siteHeader: { backgroundColor: Colors.imInk, borderRadius: 20, padding: 20, marginBottom: 16 },
  siteOverline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.imBronze },
  siteName: { fontSize: 24, fontWeight: '700', color: Colors.imSurface, marginTop: 4 },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  siteAddr: { fontSize: 13, color: 'rgba(255,255,255,0.9)' },
  gpsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, marginBottom: 12,
  },
  gpsOk: { borderColor: Colors.emerald, backgroundColor: Colors.imConcrete },
  gpsDenied: { borderColor: Colors.imConcrete, backgroundColor: Colors.imConcrete },
  gpsText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  workerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    backgroundColor: Colors.imConcrete, marginBottom: 16,
  },
  workerName: { fontSize: 13, fontWeight: '600', color: Colors.blue },
  section: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  sectionTitleText: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textSecondary, marginBottom: 12 },
  questionCard: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, marginBottom: 8 },
  questionLabel: { fontSize: 14, fontWeight: '600', color: Colors.ink, marginBottom: 10 },
  yesnoRow: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', alignSelf: 'flex-start' },
  yesnoBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: Colors.surface },
  yesBtnActive: { backgroundColor: Colors.imBronze },
  yesBtnText: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  questionInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.ink, backgroundColor: Colors.imConcrete,
  },
  choiceList: { gap: 6 },
  choiceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  choiceActive: { borderColor: Colors.imBronze, backgroundColor: Colors.imConcrete },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.imBorder, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: Colors.imBronze },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.imBronze },
  choiceText: { fontSize: 14, color: Colors.ink },
  swmsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, marginBottom: 6 },
  swmsRowActive: { borderColor: Colors.paneltecBlue, backgroundColor: Colors.imConcrete },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: Colors.imBorder, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: Colors.paneltecBlue, borderColor: Colors.paneltecBlue },
  swmsTitle: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  swmsSub: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.red, backgroundColor: Colors.imConcrete, marginBottom: 12,
  },
  errorBannerText: { fontSize: 12, color: Colors.imError, flex: 1, lineHeight: 18 },
  signOnBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.imBronze, borderRadius: 14, paddingVertical: 16, marginBottom: 12 },
  signOnText: { color: Colors.imSurface, fontSize: 16, fontWeight: '700' },
  disclaimer: { fontSize: 11, color: Colors.textTertiary, textAlign: 'center', marginBottom: 16, lineHeight: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  backText: { fontSize: 13, color: Colors.orangeLight, fontWeight: '500' },
  successCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 2, borderColor: Colors.emerald },
  successCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.imSuccess, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { fontSize: 24, fontWeight: '700', color: Colors.ink },
  successSite: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  successTime: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  gpsWarning: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
    backgroundColor: Colors.imConcrete, borderWidth: 1, borderColor: Colors.imConcrete,
  },
  gpsWarningText: { fontSize: 12, color: Colors.imInk, flex: 1, lineHeight: 18 },
  successExpiry: { fontSize: 12, color: Colors.textTertiary, marginTop: 16 },
  signOffHint: { fontSize: 12, color: Colors.textTertiary, marginTop: 12, textAlign: 'center', lineHeight: 18 },
  signOffBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 16, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.red, backgroundColor: Colors.imConcrete,
  },
  signOffBtnText: { fontSize: 14, fontWeight: '600', color: Colors.imError },
  doneBtn: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, backgroundColor: Colors.emerald },
  doneBtnText: { color: Colors.imSurface, fontSize: 15, fontWeight: '600' },
  successFooter: { fontSize: 11, color: Colors.textTertiary, marginTop: 8 },
});
