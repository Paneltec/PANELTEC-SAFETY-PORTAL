/**
 * Form Runner — fill and submit a form from the library.
 * v58.13.132h M6-reset
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import {
  fetchFormTemplate,
  checkTemplateAccess,
  submitForm,
  getCategoryMeta,
  type FormTemplate,
  type FormField,
} from '../../src/services/forms';
import PhotoCapture from '../../src/components/PhotoCapture';

type FieldValues = Record<string, unknown>;

export default function FormRunnerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [values, setValues] = useState<FieldValues>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Fetch template
  const { data: template, isLoading } = useQuery<FormTemplate>({
    queryKey: ['form-template', id],
    queryFn: () => fetchFormTemplate(id || ''),
    enabled: !!id,
    staleTime: 60_000,
  });

  // Check access (cert gating)
  const { data: access } = useQuery({
    queryKey: ['form-access', id],
    queryFn: () => checkTemplateAccess(id || ''),
    enabled: !!id,
    staleTime: 60_000,
  });

  const catMeta = template ? getCategoryMeta(template.category) : null;

  // Missing required fields
  const missingFields = useMemo(() => {
    if (!template?.fields) return [];
    return template.fields.filter((f) => {
      if (!f.required) return false;
      const v = values[f.id];
      if (v == null || v === '') return true;
      if (typeof v === 'string' && !v.trim()) return true;
      if (Array.isArray(v) && v.length === 0) return true;
      return false;
    });
  }, [template, values]);

  const setField = useCallback((fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!template) return;
    setSubmitAttempted(true);

    if (missingFields.length > 0) {
      Alert.alert(
        'Missing Fields',
        `Please complete: ${missingFields.map((f) => f.label).join(', ')}`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload = (template.fields || []).map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        value: f.type === 'photo' ? [] : (values[f.id] ?? null),
      }));
      await submitForm(template.id, payload);
      setSubmitted(true);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Submission failed';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [template, values, missingFields]);

  // Loading
  if (isLoading) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
        </View>
      </View>
    );
  }

  if (!template) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <Header onBack={() => router.back()} title="Form" />
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.textTertiary} />
          <Text style={s.emptyText}>Form template not found</Text>
        </View>
      </View>
    );
  }

  // Access denied
  if (access && !access.ok) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <Header onBack={() => router.back()} title="Form" />
        <View style={s.center}>
          <Ionicons name="lock-closed" size={40} color={Colors.error} />
          <Text style={s.accessTitle}>Access Restricted</Text>
          <Text style={s.accessText}>You need the following certifications:</Text>
          {access.required.map((r) => (
            <View key={r.slug} style={s.certRow}>
              <View style={[s.certDot, { backgroundColor: r.status === 'valid' ? Colors.success : Colors.error }]} />
              <Text style={s.certLabel}>{r.label}</Text>
              <Text style={[s.certStatus, { color: r.status === 'valid' ? Colors.success : Colors.error }]}>
                {r.status}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  // Success screen
  if (submitted) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <Header onBack={() => router.back()} title="Submitted" />
        <View style={s.center}>
          <View style={s.successCircle}>
            <Ionicons name="checkmark" size={40} color={Colors.white} />
          </View>
          <Text style={s.successTitle}>Form Submitted</Text>
          <Text style={s.successText}>{template.name} has been submitted successfully.</Text>
          <TouchableOpacity testID="form-done-btn" style={s.doneBtn} onPress={() => router.back()}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View testID="form-runner-screen" style={[s.container, { paddingTop: insets.top }]}>
      <Header onBack={() => router.back()} title={template.name} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={s.scroll}>
          {/* Category + description */}
          {catMeta && (
            <View style={[s.catPill, { backgroundColor: catMeta.bgColor }]}>
              <Text style={[s.catPillText, { color: catMeta.color }]}>{catMeta.label}</Text>
            </View>
          )}
          {template.description ? (
            <Text style={s.description}>{template.description}</Text>
          ) : null}

          {/* Missing fields banner */}
          {submitAttempted && missingFields.length > 0 && (
            <View testID="form-missing-banner" style={s.missingBanner}>
              <Ionicons name="alert-circle" size={16} color={Colors.error} />
              <Text style={s.missingText}>
                Please complete: {missingFields.map((f) => f.label).join(', ')}
              </Text>
            </View>
          )}

          {/* Fields */}
          {(template.fields || []).map((field) => (
            <FieldRenderer
              key={field.id}
              field={field}
              value={values[field.id]}
              onChange={(v) => setField(field.id, v)}
              hasError={submitAttempted && missingFields.some((mf) => mf.id === field.id)}
            />
          ))}
        </ScrollView>

        {/* Submit bar */}
        <View style={s.submitBar}>
          <TouchableOpacity
            testID="form-submit-btn"
            style={[s.submitBtn, submitting && s.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
                <Text style={s.submitBtnText}>Submit Form</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Header ──

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={s.header}>
      <TouchableOpacity testID="form-back-btn" style={s.backBtn} onPress={onBack}>
        <Ionicons name="chevron-back" size={24} color={Colors.white} />
      </TouchableOpacity>
      <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

// ── Field Renderer ──

function FieldRenderer({
  field,
  value,
  onChange,
  hasError,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  hasError: boolean;
}) {
  const borderStyle = hasError ? { borderWidth: 2, borderColor: Colors.error, borderRadius: 14 } : {};

  return (
    <View testID={`form-field-${field.id}`} style={[s.fieldBlock, borderStyle]}>
      <Text style={s.fieldLabel}>
        {field.label}
        {field.required && <Text style={s.required}> *</Text>}
      </Text>
      <Text style={s.fieldType}>{field.type}</Text>

      {field.type === 'text' && (
        <TextInput
          testID={`field-input-${field.id}`}
          style={s.textInput}
          value={(value as string) || ''}
          onChangeText={onChange}
          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
          placeholderTextColor={Colors.textTertiary}
        />
      )}

      {field.type === 'textarea' && (
        <TextInput
          testID={`field-input-${field.id}`}
          style={[s.textInput, s.textArea]}
          value={(value as string) || ''}
          onChangeText={onChange}
          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
          placeholderTextColor={Colors.textTertiary}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      )}

      {field.type === 'number' && (
        <TextInput
          testID={`field-input-${field.id}`}
          style={s.textInput}
          value={(value as string) || ''}
          onChangeText={onChange}
          placeholder={field.placeholder || '0'}
          placeholderTextColor={Colors.textTertiary}
          keyboardType="numeric"
        />
      )}

      {field.type === 'date' && (
        <TouchableOpacity
          testID={`field-date-${field.id}`}
          style={s.dateBtn}
          onPress={() => {
            const today = new Date().toISOString().split('T')[0];
            onChange(today);
          }}
        >
          <Ionicons name="calendar-outline" size={18} color={Colors.orange} />
          <Text style={s.dateBtnText}>
            {(value as string) || 'Tap to set today\'s date'}
          </Text>
        </TouchableOpacity>
      )}

      {(field.type === 'select' || field.type === 'radio') && (
        <View style={s.optionsWrap}>
          {(field.options || []).map((opt) => {
            const isSelected = value === opt;
            // Radio tri-state: Yes=green, No=red, N/A=grey
            const isYes = opt.toLowerCase() === 'yes';
            const isNo = opt.toLowerCase() === 'no';
            const isNA = opt.toLowerCase() === 'n/a' || opt.toLowerCase() === 'na';

            let selectedBg = Colors.orange;
            let selectedText = Colors.white;
            if (field.type === 'radio') {
              if (isYes) { selectedBg = Colors.success; selectedText = Colors.white; }
              else if (isNo) { selectedBg = Colors.error; selectedText = Colors.white; }
              else if (isNA) { selectedBg = Colors.border; selectedText = Colors.ink; }
            }

            return (
              <TouchableOpacity
                key={opt}
                testID={`field-opt-${field.id}-${opt}`}
                style={[
                  s.optionBtn,
                  isSelected && { backgroundColor: selectedBg, borderColor: selectedBg },
                ]}
                onPress={() => onChange(isSelected ? null : opt)}
              >
                <Text style={[s.optionText, isSelected && { color: selectedText }]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {field.type === 'photo' && (
        <PhotoCapture
          imageUri={(value as string) || null}
          onImageCaptured={(uri) => onChange(uri)}
          onClear={() => onChange(null)}
          label={`Capture ${field.label}`}
        />
      )}

      {field.type === 'signature' && (
        <View style={s.sigPlaceholder}>
          <Ionicons name="create-outline" size={24} color={Colors.textTertiary} />
          <Text style={s.sigText}>Signature capture</Text>
          <Text style={s.sigHint}>Tap to sign</Text>
        </View>
      )}

      {field.type === 'gps' && (
        <TouchableOpacity
          testID={`field-gps-${field.id}`}
          style={s.gpsBtn}
          onPress={() => {
            onChange({ lat: -34.79, lng: 149.13, address: 'Location captured' });
          }}
        >
          <Ionicons name="location" size={18} color={Colors.info} />
          <Text style={s.gpsBtnText}>
            {value ? 'Location captured' : 'Tap to capture location'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Fallback for unsupported types */}
      {!['text', 'textarea', 'number', 'date', 'select', 'radio', 'photo', 'signature', 'gps'].includes(field.type) && (
        <View style={s.unsupported}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.textTertiary} />
          <Text style={s.unsupportedText}>{field.type} field (fill on web app)</Text>
        </View>
      )}

      {hasError && (
        <View style={s.errorRow}>
          <Text style={s.errorText}>This field is required</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
  emptyText: { fontSize: 15, color: Colors.textTertiary },
  scroll: { padding: 16, paddingBottom: 100 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white, flex: 1, textAlign: 'center' },

  // Category pill
  catPill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  catPillText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  description: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 16 },

  // Missing banner
  missingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.errorSoft, borderRadius: 12, padding: 12, marginBottom: 12,
  },
  missingText: { fontSize: 12, color: Colors.error, fontWeight: '500', flex: 1 },

  // Field block
  fieldBlock: { marginBottom: 16, padding: 4 },
  fieldLabel: { fontSize: 14, fontWeight: '700', color: Colors.ink, marginBottom: 2 },
  fieldType: { fontSize: 10, color: Colors.textTertiary, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 },
  required: { color: Colors.error },

  // Text inputs
  textInput: {
    backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.ink, borderWidth: 1, borderColor: Colors.border,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' },

  // Date
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  dateBtnText: { fontSize: 15, color: Colors.ink },

  // Options (select/radio)
  optionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface,
    minHeight: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  optionText: { fontSize: 14, fontWeight: '600', color: Colors.ink },

  // GPS
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.infoSoft, borderRadius: 12, padding: 14,
  },
  gpsBtnText: { fontSize: 14, color: Colors.info, fontWeight: '500' },

  // Signature placeholder
  sigPlaceholder: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 24,
    borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
  },
  sigText: { fontSize: 14, fontWeight: '600', color: Colors.textTertiary },
  sigHint: { fontSize: 11, color: Colors.textTertiary },

  // Unsupported
  unsupported: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.borderLight, borderRadius: 10, padding: 10,
  },
  unsupportedText: { fontSize: 12, color: Colors.textTertiary },

  // Error
  errorRow: { marginTop: 6 },
  errorText: { fontSize: 12, color: Colors.error, fontWeight: '600' },

  // Submit bar
  submitBar: {
    padding: 16, paddingBottom: 24,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 16,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },

  // Access denied
  accessTitle: { fontSize: 18, fontWeight: '800', color: Colors.ink, marginTop: 8 },
  accessText: { fontSize: 14, color: Colors.textSecondary },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  certDot: { width: 8, height: 8, borderRadius: 4 },
  certLabel: { fontSize: 14, color: Colors.ink, flex: 1 },
  certStatus: { fontSize: 12, fontWeight: '600' },

  // Success
  successCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.success,
    alignItems: 'center', justifyContent: 'center',
  },
  successTitle: { fontSize: 22, fontWeight: '800', color: Colors.ink, marginTop: 12 },
  successText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  doneBtn: {
    marginTop: 20, backgroundColor: Colors.orange, borderRadius: 14,
    paddingHorizontal: 40, paddingVertical: 14,
  },
  doneBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
