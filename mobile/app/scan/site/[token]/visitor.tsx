/**
 * Visitor Sign-In — v58.13.132lg
 * Public route: /scan/site/{token}/visitor
 *
 * Mirrors web VisitorSignIn. Fully public — never redirects to login.
 * Fetches GET /api/scan/site/{token} (public) for site info.
 * Submits POST /api/scan/site/{token}/sign-on-visitor (public).
 * .132lg — removed "Who visiting" + "Vehicle Rego" fields.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../src/theme/colors';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

// ── Types ──

interface SitePayload {
  site: {
    id: string;
    name: string;
    address?: string;
    suburb?: string;
    state?: string;
  };
  active_swms?: { id: string; title: string; code?: string; version?: string }[];
  signon_questions?: { id: string; label: string; type: string; required?: boolean; choices?: string[] }[];
}

// ── Purpose options ──
const PURPOSE_OPTIONS = ['Contractor', 'Delivery', 'Client', 'Interview', 'Other'];

// ── Screen ──

export default function VisitorSignInScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();

  // Data
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SitePayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [safetyAck, setSafetyAck] = useState(false);
  const [ackSwms, setAckSwms] = useState<Set<string>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [signed, setSigned] = useState<{ signed_at?: string; gps_warning?: boolean; gps_distance_m?: number } | null>(null);

  // Fetch site info (public, no auth)
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API}/api/scan/site/${token}`);
        if (res.status === 404) { setFetchError('Site not found'); return; }
        if (!res.ok) { setFetchError('Failed to load site info'); return; }
        const json = await res.json();
        setData(json);
      } catch {
        setFetchError('Network error');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const toggleSwmsAck = (id: string) => {
    setAckSwms((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const setAnswer = (qid: string, val: string) => {
    setAnswers((a) => ({ ...a, [qid]: val }));
  };

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      setSubmitError('Please enter your full name.');
      return;
    }
    if (!safetyAck) {
      setSubmitError('Please acknowledge the safety induction.');
      return;
    }

    // Check required questions
    const qs = data?.signon_questions || [];
    const missing = qs.find((q) => q.required && !answers[q.id]?.trim());
    if (missing) {
      setSubmitError(`Please answer: ${missing.label}`);
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    try {
      const answersList = Object.entries(answers).map(([qid, value]) => ({ question_id: qid, value }));

      const res = await fetch(`${API}/api/scan/site/${token}/sign-on-visitor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          company: company.trim() || null,
          phone: phone.trim() || null,
          purpose: purpose || null,
          safety_induction_ack: safetyAck,
          swms_acknowledged: Array.from(ackSwms),
          answers: answersList,
          gps_lat: null,
          gps_long: null,
          gps_accuracy_m: null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSubmitError(body?.detail || `Sign-on failed (${res.status})`);
        return;
      }

      const result = await res.json();
      setSigned(result);
    } catch {
      setSubmitError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [name, company, phone, purpose, safetyAck, ackSwms, answers, data, token]);

  const site = data?.site;

  // ── Success screen ──
  if (signed) {
    return (
      <View testID="visitor-signed-screen" style={[st.container, { paddingTop: insets.top }]}>
        <ScrollView contentContainerStyle={st.successScroll}>
          <View style={st.successCard}>
            <View style={st.successIconWrap}>
              <Ionicons name="checkmark-circle" size={64} color="#10B981" />
            </View>
            <Text style={st.successTitle}>{"You're signed on."}</Text>
            <Text style={st.successSite}>{site?.name || 'Site'}</Text>
            {signed.signed_at && (
              <Text style={st.successTime}>{new Date(signed.signed_at).toLocaleString()}</Text>
            )}
            {signed.gps_warning && (
              <View style={st.gpsWarning}>
                <Ionicons name="alert-circle" size={14} color="#D97706" />
                <Text style={st.gpsWarningText}>
                  GPS was {signed.gps_distance_m}m from the registered site — supervisor notified.
                </Text>
              </View>
            )}
            {/* SWMS summary chips */}
            {(data?.active_swms || []).length > 0 && ackSwms.size > 0 && (
              <View style={st.swmsSummary}>
                <Text style={st.swmsSummaryLabel}>SWMS ACKNOWLEDGED</Text>
                <View style={st.swmsChips}>
                  {(data?.active_swms || []).filter((s) => ackSwms.has(s.id)).map((s) => (
                    <View key={s.id} style={st.swmsChip}>
                      <Ionicons name="shield-checkmark" size={12} color="#059669" />
                      <Text style={st.swmsChipText}>{s.title}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            <Text style={st.safetyNote}>Stay safe out there. — Paneltec Civil WHS</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <View testID="visitor-loading" style={[st.container, st.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.orange} />
        <Text style={st.loadingText}>Loading site info…</Text>
      </View>
    );
  }

  // ── Error ──
  if (fetchError || !data) {
    return (
      <View testID="visitor-error" style={[st.container, st.center, { paddingTop: insets.top }]}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
        <Text style={st.errorTitle}>{fetchError || 'Failed to load'}</Text>
      </View>
    );
  }

  // ── Form ──
  return (
    <KeyboardAvoidingView
      style={st.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View testID="visitor-signin-screen" style={{ flex: 1, paddingTop: insets.top }}>
        {/* Header */}
        <View style={st.header}>
          <Text style={st.headerLabel}>VISITOR SIGN-IN</Text>
          <Text style={st.headerSite}>{site?.name || 'Site'}</Text>
          {(site?.address || site?.suburb) && (
            <View style={st.addressRow}>
              <Ionicons name="location-outline" size={14} color="rgba(255,255,255,0.7)" />
              <Text style={st.addressText}>{site?.address || `${site?.suburb || ''}, ${site?.state || ''}`.trim()}</Text>
            </View>
          )}
        </View>

        <ScrollView contentContainerStyle={st.formScroll} keyboardShouldPersistTaps="handled">
          {/* Name */}
          <Text style={st.label}>Full Name *</Text>
          <TextInput
            testID="visitor-name-input"
            style={st.input}
            value={name}
            onChangeText={setName}
            placeholder="Enter your full name"
            placeholderTextColor={Colors.textTertiary}
            autoCapitalize="words"
          />

          {/* Company */}
          <Text style={st.label}>Company</Text>
          <TextInput
            testID="visitor-company-input"
            style={st.input}
            value={company}
            onChangeText={setCompany}
            placeholder="Company name"
            placeholderTextColor={Colors.textTertiary}
          />

          {/* Phone */}
          <Text style={st.label}>Phone</Text>
          <TextInput
            testID="visitor-phone-input"
            style={st.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone number"
            placeholderTextColor={Colors.textTertiary}
            keyboardType="phone-pad"
          />

          {/* Purpose */}
          <Text style={st.label}>Purpose of Visit</Text>
          <View style={st.purposeRow}>
            {PURPOSE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                testID={`visitor-purpose-${opt.toLowerCase()}`}
                style={[st.purposePill, purpose === opt && st.purposeActive]}
                onPress={() => setPurpose(purpose === opt ? '' : opt)}
              >
                <Text style={[st.purposeText, purpose === opt && st.purposeActiveText]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Dynamic sign-on questions */}
          {(data.signon_questions || []).length > 0 && (
            <View style={st.questionsSection}>
              <Text style={st.sectionTitle}>Sign-On Questions</Text>
              {(data.signon_questions || []).map((q) => (
                <View key={q.id} style={st.questionCard}>
                  <Text style={st.questionLabel}>
                    {q.label}{q.required && <Text style={{ color: Colors.error }}> *</Text>}
                  </Text>
                  {q.type === 'yesno' && (
                    <View style={st.yesnoRow}>
                      {['yes', 'no'].map((v) => (
                        <TouchableOpacity
                          key={v}
                          testID={`q-${q.id}-${v}`}
                          style={[st.yesnoPill, answers[q.id] === v && st.yesnoActive]}
                          onPress={() => setAnswer(q.id, answers[q.id] === v ? '' : v)}
                        >
                          <Text style={[st.yesnoText, answers[q.id] === v && st.yesnoActiveText]}>
                            {v === 'yes' ? 'Yes' : 'No'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  {q.type === 'text' && (
                    <TextInput
                      testID={`q-${q.id}-input`}
                      style={st.input}
                      value={answers[q.id] || ''}
                      onChangeText={(v) => setAnswer(q.id, v)}
                      placeholder="Type your answer…"
                      placeholderTextColor={Colors.textTertiary}
                    />
                  )}
                </View>
              ))}
            </View>
          )}

          {/* SWMS acknowledgements */}
          {(data.active_swms || []).length > 0 && (
            <View style={st.swmsSection}>
              <View style={st.swmsHeader}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#8B5CF6" />
                <Text style={st.sectionTitle}>Acknowledge SWMS</Text>
              </View>
              {(data.active_swms || []).map((sw) => (
                <TouchableOpacity
                  key={sw.id}
                  testID={`ack-swms-${sw.id}`}
                  style={[st.swmsRow, ackSwms.has(sw.id) && st.swmsRowAck]}
                  onPress={() => toggleSwmsAck(sw.id)}
                >
                  <Ionicons
                    name={ackSwms.has(sw.id) ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={ackSwms.has(sw.id) ? '#10B981' : Colors.textTertiary}
                  />
                  <View style={st.swmsInfo}>
                    <Text style={st.swmsTitle}>{sw.title}</Text>
                    <Text style={st.swmsCode}>{sw.code || '—'} · {sw.version || 'v?'}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Safety induction checkbox */}
          <TouchableOpacity
            testID="visitor-safety-ack"
            style={st.ackRow}
            onPress={() => setSafetyAck(!safetyAck)}
          >
            <Ionicons
              name={safetyAck ? 'checkbox' : 'square-outline'}
              size={24}
              color={safetyAck ? Colors.orange : Colors.textTertiary}
            />
            <Text style={st.ackText}>
              I confirm I have completed the site safety induction and I am fit for work.
            </Text>
          </TouchableOpacity>

          {/* Error */}
          {submitError && (
            <View style={st.submitErrorRow}>
              <Ionicons name="alert-circle" size={16} color={Colors.error} />
              <Text style={st.submitErrorText}>{submitError}</Text>
            </View>
          )}

          {/* Submit */}
          <TouchableOpacity
            testID="visitor-submit-btn"
            style={[st.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
            )}
            <Text style={st.submitText}>Sign On as Visitor</Text>
          </TouchableOpacity>

          <Text style={st.footerNote}>
            By signing on you confirm you&apos;re fit-for-work and have read the SWMS above.{'\n'}
            Powered by Paneltec Civil WHS.
          </Text>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ──

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 14, color: Colors.textTertiary, marginTop: 12 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink, marginTop: 12 },

  // Header
  header: {
    backgroundColor: '#0F172A', paddingHorizontal: 20, paddingVertical: 20,
  },
  headerLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange, marginBottom: 4 },
  headerSite: { fontSize: 22, fontWeight: '800', color: Colors.white },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  addressText: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },

  // Form
  formScroll: { padding: 20 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 16, color: Colors.ink,
  },

  // Purpose pills
  purposeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  purposePill: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    minHeight: 44,
  },
  purposeActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  purposeText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  purposeActiveText: { color: Colors.white },

  // Questions
  questionsSection: { marginTop: 20 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.ink, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  questionCard: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, padding: 14, marginBottom: 8,
  },
  questionLabel: { fontSize: 14, fontWeight: '600', color: Colors.ink, marginBottom: 8 },
  yesnoRow: { flexDirection: 'row', gap: 8 },
  yesnoPill: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    minHeight: 44,
  },
  yesnoActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  yesnoText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  yesnoActiveText: { color: Colors.white },

  // SWMS
  swmsSection: { marginTop: 20 },
  swmsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  swmsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, padding: 12, marginBottom: 6,
  },
  swmsRowAck: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  swmsInfo: { flex: 1 },
  swmsTitle: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  swmsCode: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },

  // Ack checkbox
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 20 },
  ackText: { flex: 1, fontSize: 14, color: Colors.ink, lineHeight: 20 },

  // Submit
  submitErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, backgroundColor: '#FEE2E2', borderRadius: 12 },
  submitErrorText: { flex: 1, fontSize: 13, color: Colors.error },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 14,
    paddingVertical: 16, marginTop: 20, minHeight: 52,
  },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  footerNote: { fontSize: 11, color: Colors.textTertiary, textAlign: 'center', marginTop: 20, lineHeight: 16 },

  // Success
  successScroll: { alignItems: 'center', justifyContent: 'center', flex: 1, padding: 24 },
  successCard: { alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 24, padding: 32, width: '100%', maxWidth: 380 },
  successIconWrap: { marginBottom: 16 },
  successTitle: { fontSize: 24, fontWeight: '800', color: Colors.ink },
  successSite: { fontSize: 15, color: Colors.textSecondary, marginTop: 4 },
  successTime: { fontSize: 12, color: Colors.textTertiary, marginTop: 4 },
  gpsWarning: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginTop: 16,
  },
  gpsWarningText: { flex: 1, fontSize: 12, color: '#92400E' },
  swmsSummary: { marginTop: 20, width: '100%' },
  swmsSummaryLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textTertiary, marginBottom: 6 },
  swmsChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swmsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4,
  },
  swmsChipText: { fontSize: 11, fontWeight: '600', color: '#065F46' },
  safetyNote: { fontSize: 11, color: Colors.textTertiary, marginTop: 20, textAlign: 'center' },
});
