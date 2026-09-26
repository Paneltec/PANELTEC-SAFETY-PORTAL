/**
 * PasteJobSmsModal.tsx — v58.13.132p1
 *
 * iPhone paste flow for job SMS import.
 * Shows a TextInput + paste-from-clipboard shortcut.
 * Parses → previews 7 fields → confirm → POST to backend.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Colors } from '../theme/colors';
import { parseJobSms, type ParsedSms } from '../lib/parseJobSms';
import { authPost } from '../services/apiClient';

interface Props {
  visible: boolean;
  onClose: () => void;
  onJobCreated: (job: any) => void;
}

type Step = 'input' | 'preview' | 'submitting' | 'done' | 'error';

export default function PasteJobSmsModal({ visible, onClose, onJobCreated }: Props) {
  const [step, setStep] = useState<Step>('input');
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedSms | null>(null);
  const [error, setError] = useState('');
  const [createdJob, setCreatedJob] = useState<any>(null);

  const reset = useCallback(() => {
    setStep('input');
    setRawText('');
    setParsed(null);
    setError('');
    setCreatedJob(null);
  }, []);

  const handleClose = () => { reset(); onClose(); };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) setRawText(text);
    } catch { /* ignore */ }
  };

  const handleParse = () => {
    if (!rawText.trim()) return;
    const result = parseJobSms(rawText);
    setParsed(result);
    setStep('preview');
  };

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
        source: 'ios_paste',
      });
      if (res.ok && res.data?.id) {
        setCreatedJob(res.data);
        setStep('done');
        onJobCreated(res.data);
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
      <View key={label} style={ms.fieldRow}>
        <Text style={ms.fieldLabel}>{label}</Text>
        <Text style={[ms.fieldValue, !display && ms.fieldEmpty]}>
          {display || '—'}
        </Text>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={ms.container}>
        {/* Header */}
        <View style={ms.header}>
          <TouchableOpacity testID="paste-modal-close" onPress={handleClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={ms.headerTitle}>
            {step === 'input' ? 'Paste Job SMS' : step === 'preview' ? 'Confirm Details' : step === 'done' ? 'Job Created' : 'Import Job'}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={ms.body} keyboardShouldPersistTaps="handled">
          {/* Step: Input */}
          {step === 'input' && (
            <>
              <Text style={ms.instruction}>
                Copy the job SMS from your Messages app, then paste it below.
              </Text>
              <TouchableOpacity testID="paste-clipboard-btn" style={ms.pasteBtn} onPress={handlePasteFromClipboard}>
                <Ionicons name="clipboard-outline" size={18} color={Colors.info} />
                <Text style={ms.pasteBtnText}>Paste from clipboard</Text>
              </TouchableOpacity>
              <TextInput
                testID="paste-sms-input"
                style={ms.textInput}
                multiline
                numberOfLines={10}
                placeholder="Paste the full SMS text here..."
                placeholderTextColor={Colors.textTertiary}
                value={rawText}
                onChangeText={setRawText}
                textAlignVertical="top"
              />
              <TouchableOpacity
                testID="paste-parse-btn"
                style={[ms.primaryBtn, !rawText.trim() && ms.btnDisabled]}
                onPress={handleParse}
                disabled={!rawText.trim()}
                activeOpacity={0.7}
              >
                <Ionicons name="scan-outline" size={18} color={Colors.white} />
                <Text style={ms.primaryBtnText}>Parse SMS</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Step: Preview */}
          {step === 'preview' && parsed && (
            <>
              <View style={ms.previewCard}>
                {renderField('TRUCK', parsed.truck)}
                {renderField('DATE', parsed.date)}
                {renderField('SITE', parsed.site_name)}
                {renderField('ADDRESS', parsed.address)}
                {renderField('CUSTOMER', parsed.customer)}
                {renderField('STAFF', parsed.staff)}
                {renderField('NOTES', parsed.notes)}
              </View>
              <View style={ms.actionRow}>
                <TouchableOpacity testID="paste-back-btn" style={ms.secondaryBtn} onPress={() => setStep('input')}>
                  <Text style={ms.secondaryBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="paste-confirm-btn" style={ms.primaryBtn} onPress={handleSubmit}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.white} />
                  <Text style={ms.primaryBtnText}>Create Job</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Step: Submitting */}
          {step === 'submitting' && (
            <View style={ms.centerWrap}>
              <ActivityIndicator size="large" color={Colors.orange} />
              <Text style={ms.centerText}>Creating job...</Text>
            </View>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <View style={ms.centerWrap}>
              <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
              <Text style={ms.doneTitle}>Job Created</Text>
              <Text style={ms.doneSubtitle}>
                {createdJob?.site_name || parsed?.site_name || 'New job'} — {createdJob?.truck || parsed?.truck || ''}
              </Text>
              <TouchableOpacity testID="paste-done-btn" style={ms.primaryBtn} onPress={handleClose}>
                <Text style={ms.primaryBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Step: Error */}
          {step === 'error' && (
            <View style={ms.centerWrap}>
              <Ionicons name="alert-circle" size={64} color={Colors.error} />
              <Text style={ms.errorTitle}>Failed</Text>
              <Text style={ms.errorMsg}>{error}</Text>
              <View style={ms.actionRow}>
                <TouchableOpacity style={ms.secondaryBtn} onPress={() => setStep('preview')}>
                  <Text style={ms.secondaryBtnText}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={ms.primaryBtn} onPress={handleClose}>
                  <Text style={ms.primaryBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const ms = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, paddingTop: 20, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  body: { padding: 20, paddingBottom: 40 },
  instruction: { fontSize: 14, color: Colors.textSecondary, lineHeight: 21, marginBottom: 16 },
  pasteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: `${Colors.info}40`, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12,
    backgroundColor: '#EFF6FF',
  },
  pasteBtnText: { fontSize: 14, fontWeight: '700', color: Colors.info },
  textInput: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    padding: 14, fontSize: 14, color: Colors.ink, minHeight: 180,
    backgroundColor: Colors.white, fontFamily: 'monospace',
    marginBottom: 16,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.success, borderRadius: 14, paddingVertical: 16,
    flex: 1, minHeight: 52,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '800', color: Colors.white },
  btnDisabled: { opacity: 0.4 },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 14,
    paddingVertical: 16, flex: 0.7, minHeight: 52, backgroundColor: Colors.white,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  previewCard: {
    backgroundColor: Colors.white, borderRadius: 16, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  fieldRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, width: 80 },
  fieldValue: { fontSize: 14, fontWeight: '600', color: Colors.ink, flex: 1, textAlign: 'right' },
  fieldEmpty: { color: Colors.textTertiary, fontStyle: 'italic' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  centerWrap: { alignItems: 'center', paddingTop: 60, gap: 12 },
  centerText: { fontSize: 14, color: Colors.textTertiary },
  doneTitle: { fontSize: 22, fontWeight: '800', color: Colors.ink },
  doneSubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  errorTitle: { fontSize: 22, fontWeight: '800', color: Colors.error },
  errorMsg: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: 16 },
});
