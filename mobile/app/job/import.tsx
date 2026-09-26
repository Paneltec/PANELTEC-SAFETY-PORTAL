/**
 * job/import.tsx — v58.13.132p1
 *
 * Deep-link handler for paneltec://job/import?text=<url-encoded-sms>
 * Also handles paneltec-mobile://job/import?text=<url-encoded-sms>
 *
 * Flow: decode SMS → parse → preview → confirm → POST → navigate to Home.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { parseJobSms, type ParsedSms } from '../../src/lib/parseJobSms';
import { authPost } from '../../src/services/apiClient';

export default function JobImportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string }>();
  const [parsed, setParsed] = useState<ParsedSms | null>(null);
  const [step, setStep] = useState<'parsing' | 'preview' | 'submitting' | 'done' | 'error'>('parsing');
  const [error, setError] = useState('');
  const [, setCreatedJob] = useState<any>(null);

  useEffect(() => {
    const raw = params.text ? decodeURIComponent(params.text) : '';
    if (!raw.trim()) {
      setError('No SMS text provided');
      setStep('error');
      return;
    }
    const result = parseJobSms(raw);
    if (!result.truck && !result.site_name && !result.address) {
      setError("Couldn't read this SMS — check the format");
      setStep('error');
      return;
    }
    setParsed(result);
    setStep('preview');
  }, [params.text]);

  const handleSubmit = async () => {
    if (!parsed) return;
    setStep('submitting');
    try {
      const res = await authPost<any>('/api/mobile/daily-jobs', {
        truck: parsed.truck || '',
        date: parsed.date || new Date().toISOString().slice(0, 10),
        site_name: parsed.site_name || '',
        address: parsed.address || '',
        customer: parsed.customer || '',
        staff: parsed.staff,
        notes: parsed.notes || '',
        source: 'deep_link',
      });
      if (res.ok && res.data?.id) {
        setCreatedJob(res.data);
        setStep('done');
      } else {
        setError((res as any)?.data?.detail || 'Failed to create job');
        setStep('error');
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
      setStep('error');
    }
  };

  const renderField = (label: string, value: string | null | string[]) => {
    const display = Array.isArray(value) ? value.join(', ') : value;
    return (
      <View key={label} style={s.fieldRow}>
        <Text style={s.fieldLabel}>{label}</Text>
        <Text style={[s.fieldValue, !display && { color: Colors.textTertiary, fontStyle: 'italic' }]}>{display || '—'}</Text>
      </View>
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace('/(tabs)/home')} hitSlop={12}>
          <Ionicons name="close" size={24} color={Colors.white} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Import Job from SMS</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={s.body}>
        {step === 'parsing' && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.orange} />
            <Text style={s.centerText}>Parsing SMS...</Text>
          </View>
        )}

        {step === 'preview' && parsed && (
          <>
            <View style={s.card}>
              {renderField('TRUCK', parsed.truck)}
              {renderField('DATE', parsed.date)}
              {renderField('SITE', parsed.site_name)}
              {renderField('ADDRESS', parsed.address)}
              {renderField('CUSTOMER', parsed.customer)}
              {renderField('STAFF', parsed.staff)}
              {renderField('NOTES', parsed.notes)}
            </View>
            <TouchableOpacity testID="import-confirm-btn" style={s.confirmBtn} onPress={handleSubmit}>
              <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
              <Text style={s.confirmBtnText}>Create Job</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'submitting' && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.orange} />
            <Text style={s.centerText}>Creating job...</Text>
          </View>
        )}

        {step === 'done' && (
          <View style={s.center}>
            <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
            <Text style={s.doneTitle}>Job Created</Text>
            <TouchableOpacity style={s.confirmBtn} onPress={() => router.replace('/(tabs)/home')}>
              <Text style={s.confirmBtnText}>Go to Home</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'error' && (
          <View style={s.center}>
            <Ionicons name="alert-circle" size={64} color={Colors.error} />
            <Text style={s.errorTitle}>Import Failed</Text>
            <Text style={s.errorMsg}>{error}</Text>
            <TouchableOpacity style={s.confirmBtn} onPress={() => router.replace('/(tabs)/home')}>
              <Text style={s.confirmBtnText}>Go to Home</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navyLight },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.navy, padding: 16, paddingTop: 8, paddingBottom: 14,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },
  body: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  fieldRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, width: 80 },
  fieldValue: { fontSize: 14, fontWeight: '600', color: Colors.ink, flex: 1, textAlign: 'right' },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.success, borderRadius: 14, paddingVertical: 16, minHeight: 52,
  },
  confirmBtnText: { fontSize: 15, fontWeight: '800', color: Colors.white },
  center: { alignItems: 'center', paddingTop: 60, gap: 12 },
  centerText: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  doneTitle: { fontSize: 22, fontWeight: '800', color: Colors.white },
  errorTitle: { fontSize: 22, fontWeight: '800', color: Colors.error },
  errorMsg: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginBottom: 16 },
});
