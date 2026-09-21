/**
 * QR Scan — New Pre-Start screen — v58.13.132dc
 * Wired to POST /api/mobile/prestart/submit (real endpoint).
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { clearSession } from '../../src/services/auth';
import { authPost } from '../../src/services/apiClient';

type PreStartState = 'scanner' | 'form' | 'submitting' | 'submitted';

const CHECKLIST_ITEMS = [
  'Engine oil level',
  'Coolant level',
  'Hydraulic fluid',
  'Tyre condition & pressure',
  'Lights & indicators',
  'Mirrors & visibility',
  'Seatbelt & ROPS',
  'Fire extinguisher',
  'Brakes — service & park',
  'Reversing alarm / camera',
];

interface SubmitResponse {
  submission_id: string;
  status: string;
}

export default function QRScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [state, setState] = useState<PreStartState>('scanner');
  const [assetId, setAssetId] = useState('');
  const [assetName, setAssetName] = useState('');
  const [checks, setChecks] = useState<Record<number, 'pass' | 'fail' | null>>(
    Object.fromEntries(CHECKLIST_ITEMS.map((_, i) => [i, null]))
  );
  const [submissionId, setSubmissionId] = useState('');
  const [submitError, setSubmitError] = useState('');

  const handleScan = (id: string) => {
    setAssetId(id);
    setAssetName(''); // Will be populated from QR payload or backend lookup
    setState('form');
  };

  const handleSubmit = async () => {
    setState('submitting');
    setSubmitError('');

    const failedItems = CHECKLIST_ITEMS.filter((_, i) => checks[i] === 'fail');
    const hazards = failedItems.length > 0 ? `Failed items: ${failedItems.join(', ')}` : 'None';

    const res = await authPost<SubmitResponse>('/api/mobile/prestart/submit', {
      vehicle_rego: assetId,
      date: new Date().toISOString().split('T')[0],
      crew_lead: 'Current User',
      crew_members: [],
      work_summary: `Pre-start check for ${assetName} (${assetId})`,
      hazards,
      sign_ons: [{ name: 'Current User', timestamp: new Date().toISOString() }],
    });

    if (res.ok) {
      setSubmissionId(res.data.submission_id);
      setState('submitted');
    } else if ('expired' in res && res.expired) {
      await clearSession();
      router.replace('/(auth)/pin-entry');
    } else {
      const errMsg = 'error' in res ? res.error : 'Submission failed';
      setSubmitError(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
      setState('form');
      Alert.alert('Submission Error', typeof errMsg === 'string' ? errMsg : 'Please try again.');
    }
  };

  const toggleCheck = (idx: number) => {
    setChecks((prev) => ({
      ...prev,
      [idx]: prev[idx] === 'pass' ? 'fail' : prev[idx] === 'fail' ? null : 'pass',
    }));
  };

  const resetForm = () => {
    setState('scanner');
    setAssetId('');
    setAssetName('');
    setSubmissionId('');
    setSubmitError('');
    setChecks(Object.fromEntries(CHECKLIST_ITEMS.map((_, i) => [i, null])));
  };

  const allChecked = Object.values(checks).every((v) => v !== null);

  if (state === 'submitted') {
    return (
      <View testID="prestart-submitted" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.successCenter}>
          <View style={s.successCircle}>
            <Ionicons name="checkmark" size={48} color={Colors.success} />
          </View>
          <Text style={s.successTitle}>Pre-Start Submitted</Text>
          <Text style={s.successSub}>{assetName} — {assetId}</Text>
          {submissionId && (
            <View style={s.submissionIdCard}>
              <Text style={s.submissionIdLabel}>Submission ID</Text>
              <Text testID="submission-id" style={s.submissionIdValue}>{submissionId.slice(0, 8)}...</Text>
            </View>
          )}
          <TouchableOpacity testID="prestart-new-btn" style={s.newBtn} onPress={resetForm}>
            <Text style={s.newBtnText}>Start Another</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (state === 'submitting') {
    return (
      <View testID="prestart-submitting" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.successCenter}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={s.submittingText}>Submitting pre-start...</Text>
        </View>
      </View>
    );
  }

  if (state === 'form') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View testID="prestart-form" style={[s.container, { paddingTop: insets.top }]}>
          <View style={s.header}>
            <TouchableOpacity testID="prestart-back" onPress={() => setState('scanner')} style={s.backBtn}>
              <Ionicons name="chevron-back" size={24} color={Colors.white} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Pre-Start Check</Text>
          </View>
          <ScrollView contentContainerStyle={s.scrollContent}>
            <View style={s.assetCard}>
              <View style={s.assetIcon}>
                <Ionicons name="car" size={24} color={Colors.orange} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.assetName}>{assetName}</Text>
                <Text style={s.assetIdText}>ID: {assetId}</Text>
              </View>
              <View style={s.autoFillPill}>
                <Text style={s.autoFillText}>QR Auto-fill</Text>
              </View>
            </View>

            <Text style={s.checklistLabel}>INSPECTION CHECKLIST</Text>
            {CHECKLIST_ITEMS.map((item, idx) => (
              <TouchableOpacity
                key={idx}
                testID={`check-item-${idx}`}
                style={s.checkRow}
                onPress={() => toggleCheck(idx)}
              >
                <View style={[
                  s.checkCircle,
                  checks[idx] === 'pass' && { backgroundColor: Colors.success },
                  checks[idx] === 'fail' && { backgroundColor: Colors.error },
                ]}>
                  {checks[idx] === 'pass' && <Ionicons name="checkmark" size={16} color={Colors.white} />}
                  {checks[idx] === 'fail' && <Ionicons name="close" size={16} color={Colors.white} />}
                </View>
                <Text style={[s.checkText, checks[idx] !== null && { color: Colors.ink }]}>{item}</Text>
                {checks[idx] === 'fail' && (
                  <View style={s.failPill}>
                    <Text style={s.failPillText}>FAIL</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}

            {submitError ? (
              <View style={s.errorBanner}>
                <Ionicons name="alert-circle" size={14} color={Colors.error} />
                <Text style={s.errorBannerText}>{submitError}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              testID="prestart-submit-btn"
              style={[s.submitBtn, !allChecked && s.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!allChecked}
            >
              <Text style={s.submitBtnText}>Submit Pre-Start</Text>
            </TouchableOpacity>
            <View style={{ height: 32 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Scanner view
  return (
    <View testID="qr-scan-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Scan Asset QR</Text>
      </View>
      <View style={s.scannerArea}>
        <View style={s.scanFrame}>
          <View style={[s.scanCorner, s.scanTL]} />
          <View style={[s.scanCorner, s.scanTR]} />
          <View style={[s.scanCorner, s.scanBL]} />
          <View style={[s.scanCorner, s.scanBR]} />
          <Ionicons name="scan-outline" size={80} color="rgba(255,255,255,0.15)" />
          <Text style={s.scanHint}>
            {Platform.OS === 'web'
              ? 'Camera not available on web preview'
              : 'Point camera at asset QR code'}
          </Text>
        </View>
      </View>

      <View style={s.manualSection}>
        <Text style={s.manualLabel}>Or enter asset ID manually</Text>
        <View style={s.manualRow}>
          <TextInput
            testID="asset-id-input"
            style={s.manualInput}
            value={assetId}
            onChangeText={setAssetId}
            placeholder="e.g. AST-001"
            placeholderTextColor="rgba(255,255,255,0.3)"
            autoCapitalize="characters"
          />
          <TouchableOpacity
            testID="manual-scan-btn"
            style={[s.goBtn, !assetId.trim() && s.goBtnDisabled]}
            onPress={() => handleScan(assetId.trim() || 'AST-001')}
            disabled={!assetId.trim()}
          >
            <Ionicons name="arrow-forward" size={22} color={Colors.white} />
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity testID="demo-scan-btn" style={s.demoBtn} onPress={() => handleScan('AST-001')}>
        <Ionicons name="flash-outline" size={16} color={Colors.orange} />
        <Text style={s.demoBtnText}>Quick demo scan</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { color: Colors.white, fontSize: 18, fontWeight: '700' },
  scrollContent: { padding: 16 },

  scannerArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  scanFrame: {
    width: 240, height: 240, alignItems: 'center', justifyContent: 'center', gap: 16,
    position: 'relative',
  },
  scanCorner: {
    position: 'absolute', width: 32, height: 32,
    borderColor: Colors.orange, borderWidth: 3,
  },
  scanTL: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0 },
  scanTR: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0 },
  scanBL: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0 },
  scanBR: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0 },
  scanHint: { color: 'rgba(255,255,255,0.35)', fontSize: 12, textAlign: 'center', lineHeight: 18 },

  manualSection: { paddingHorizontal: 24, marginBottom: 12 },
  manualLabel: {
    color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600',
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
  },
  manualRow: { flexDirection: 'row', gap: 10 },
  manualInput: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    color: Colors.white, fontSize: 15,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  goBtn: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center',
  },
  goBtnDisabled: { opacity: 0.4 },

  demoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 24, marginBottom: 32, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: 'rgba(249,115,22,0.3)',
    backgroundColor: 'rgba(249,115,22,0.06)',
  },
  demoBtnText: { color: Colors.orange, fontSize: 14, fontWeight: '700' },

  assetCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  assetIcon: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center',
  },
  assetName: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  assetIdText: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  autoFillPill: {
    backgroundColor: Colors.successSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  autoFillText: { fontSize: 10, fontWeight: '700', color: Colors.success },

  checklistLabel: {
    color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, marginBottom: 10,
  },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 6,
  },
  checkCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  checkText: { fontSize: 14, color: Colors.textSecondary, flex: 1, fontWeight: '500' },
  failPill: { backgroundColor: Colors.errorSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  failPillText: { fontSize: 9, fontWeight: '800', color: Colors.error },

  submitBtn: {
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 16,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEE2E2', borderRadius: 10, padding: 10, marginTop: 8,
    borderWidth: 1, borderColor: '#FECACA',
  },
  errorBannerText: { fontSize: 11, fontWeight: '600', color: '#DC2626', flex: 1 },

  successCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  successCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: Colors.successSoft, alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  successTitle: { fontSize: 22, fontWeight: '800', color: Colors.white, marginBottom: 6 },
  successSub: { fontSize: 14, color: 'rgba(255,255,255,0.55)', marginBottom: 16 },
  submissionIdCard: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 12,
    alignItems: 'center', marginBottom: 12, width: '100%',
  },
  submissionIdLabel: { fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  submissionIdValue: { fontSize: 14, color: Colors.white, fontWeight: '700', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  submittingText: { color: Colors.white, fontSize: 16, fontWeight: '600', marginTop: 16 },
  newBtn: {
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32,
    marginTop: 8,
  },
  newBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
