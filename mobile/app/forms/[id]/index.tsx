/**
 * Form Runner — Fill mode + mandatory Review-before-Submit.
 * v58.13.132l — Draft persistence via AsyncStorage keyed by form+worker.
 *   Fill → Review → Confirm & Submit state machine. Review step is
 *   MANDATORY (no bypass). Draft autosave debounced 800ms, cleared
 *   on successful submit. On reopen: Resume / Discard prompt.
 *   .132l addendum — When isPreviewSession() is true, the Confirm &
 *   Submit button renders in a disabled state with a "Preview mode —
 *   read only" chip below it; server-side 403 remains as safety net.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '../../../src/theme/colors';
import {
  fetchFormTemplate,
  checkTemplateAccess,
  submitForm,
  getCategoryMeta,
  type FormTemplate,
  type FormField,
} from '../../../src/services/forms';
import { getStoredUser, isPreviewSession } from '../../../src/services/auth';
import PhotoCapture from '../../../src/components/PhotoCapture';
import ComplianceQuestion from '../../../src/components/forms/ComplianceQuestion';
import {
  WorkerPicker, VehicleNavixyPicker, CustomerPicker,
  SitePicker, JobPicker, AssetScanPicker, ContactPicker,
} from '../../../src/components/pickers/PickerFields';

type FieldValues = Record<string, unknown>;
type Mode = 'fill' | 'review';

const DRAFT_PREFIX = 'form_draft_';

function draftKey(formId: string, workerId: string) {
  return `${DRAFT_PREFIX}${formId}_${workerId}`;
}

export default function FormRunnerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [values, setValues] = useState<FieldValues>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [mode, setMode] = useState<Mode>('fill');
  const [workerId, setWorkerId] = useState<string>('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

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

  // ── Seed default values for date / time fields ──
  // Mirrors web's behaviour: date → today, time with config.default_now → HH:MM now.
  useEffect(() => {
    if (!template?.fields || !draftLoaded) return;
    const now = new Date();
    const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setValues((prev) => {
      const next = { ...prev };
      let changed = false;
      template.fields.forEach((f) => {
        if (f.type === 'date' && !next[f.id]) { next[f.id] = isoDate; changed = true; }
        if (f.type === 'time' && f.config?.default_now && !next[f.id]) { next[f.id] = nowTime; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [template, draftLoaded]);

  // Load worker ID
  useEffect(() => {
    getStoredUser().then((u) => {
      if (u?.id) setWorkerId(u.id);
      else if (u?.email) setWorkerId(u.email);
    });
  }, []);

  // ── Draft persistence ──

  // Load draft on mount
  useEffect(() => {
    if (!id || !workerId || draftLoaded) return;
    const key = draftKey(id, workerId);
    AsyncStorage.getItem(key).then((raw) => {
      if (raw) {
        try {
          const saved = JSON.parse(raw);
          if (saved && typeof saved === 'object') {
            const hasValues = Object.values(saved).some((v) =>
              v !== null && v !== '' && !(Array.isArray(v) && v.length === 0),
            );
            if (hasValues) {
              Alert.alert(
                'Resume Draft?',
                'You have a saved draft for this form. Would you like to continue where you left off?',
                [
                  { text: 'Discard', style: 'destructive', onPress: () => clearDraft(key) },
                  { text: 'Resume', onPress: () => setValues(saved) },
                ],
              );
            }
          }
        } catch { /* ignore corrupt drafts */ }
      }
      setDraftLoaded(true);
    });
  }, [id, workerId, draftLoaded]);

  // Auto-save draft debounced
  useEffect(() => {
    if (!id || !workerId || !draftLoaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const key = draftKey(id, workerId);
      AsyncStorage.setItem(key, JSON.stringify(values)).catch(() => {});
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [values, id, workerId, draftLoaded]);

  async function clearDraft(key?: string) {
    const k = key || (id && workerId ? draftKey(id, workerId) : null);
    if (k) await AsyncStorage.removeItem(k).catch(() => {});
  }

  // Missing required fields
  const missingFields = useMemo(() => {
    if (!template?.fields) return [];
    return template.fields.filter((f) => {
      if (!f.required) return false;
      const v = values[f.id];
      if (v == null || v === '') return true;
      if (typeof v === 'string' && !v.trim()) return true;
      if (Array.isArray(v) && v.length === 0) return true;
      // Compliance fields: check the status sub-key
      if (f.type === 'compliance' && typeof v === 'object' && v !== null) {
        return !(v as Record<string, unknown>).status;
      }
      return false;
    });
  }, [template, values]);

  const setField = useCallback((fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  // ── Mode transitions ──

  const handleReview = useCallback(() => {
    if (!template) return;
    setSubmitAttempted(true);
    if (missingFields.length > 0) {
      Alert.alert(
        'Missing Fields',
        `Please complete: ${missingFields.map((f) => f.label).join(', ')}`,
      );
      return;
    }
    setMode('review');
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [template, missingFields]);

  const handleEdit = useCallback(() => {
    setMode('fill');
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!template) return;
    setSubmitting(true);
    try {
      const payload = (template.fields || []).map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        value: f.type === 'photo' ? [] : (values[f.id] ?? null),
      }));
      await submitForm(template.id, payload);
      await clearDraft();
      router.replace({
        pathname: '/forms/[id]/submitted',
        params: { id: template.id, name: template.name },
      } as never);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Submission failed';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [template, values, router]);

  // ── Loading state ──
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
        <Header onBack={() => router.back()} title="Form" subtitle="" />
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.textTertiary} />
          <Text style={s.emptyText}>Form template not found</Text>
        </View>
      </View>
    );
  }

  // ── Access denied ──
  if (access && !access.ok) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <Header onBack={() => router.back()} title="Form" subtitle="" />
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

  const filledCount = (template.fields || []).filter((f) => {
    const v = values[f.id];
    return v != null && v !== '' && !(typeof v === 'string' && !v.trim());
  }).length;
  const totalFields = (template.fields || []).length;
  const progress = totalFields > 0 ? filledCount / totalFields : 0;

  return (
    <View testID="form-runner-screen" style={[s.container, { paddingTop: insets.top }]}>
      <Header
        onBack={() => {
          if (mode === 'review') { handleEdit(); return; }
          router.back();
        }}
        title={template.name}
        subtitle={mode === 'review' ? 'Review your answers' : `${filledCount}/${totalFields} fields completed`}
      />

      {/* Progress bar (fill mode only) */}
      {mode === 'fill' && (
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      )}

      {/* Mode pill */}
      <View style={s.modePillRow}>
        <View style={[s.modePill, mode === 'review' && s.modePillReview]}>
          <Ionicons
            name={mode === 'fill' ? 'create-outline' : 'eye-outline'}
            size={14}
            color={mode === 'review' ? Colors.info : Colors.orange}
          />
          <Text style={[s.modePillText, mode === 'review' && s.modePillTextReview]}>
            {mode === 'fill' ? 'Fill Mode' : 'Review Mode'}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView ref={scrollRef} contentContainerStyle={s.scroll}>
          {/* Category + description */}
          {catMeta && (
            <View style={[s.catPill, { backgroundColor: catMeta.bgColor }]}>
              <Text style={[s.catPillText, { color: catMeta.color }]}>{catMeta.label}</Text>
            </View>
          )}
          {template.description ? (
            <Text style={s.description}>{template.description}</Text>
          ) : null}

          {/* Missing fields banner (fill mode, after attempted) */}
          {mode === 'fill' && submitAttempted && missingFields.length > 0 && (
            <View testID="form-missing-banner" style={s.missingBanner}>
              <Ionicons name="alert-circle" size={16} color={Colors.error} />
              <Text style={s.missingText}>
                Please complete: {missingFields.map((f) => f.label).join(', ')}
              </Text>
            </View>
          )}

          {/* Fields */}
          {mode === 'fill' ? (
            (template.fields || []).map((field) => (
              <FieldRenderer
                key={field.id}
                field={field}
                value={values[field.id]}
                onChange={(v) => setField(field.id, v)}
                hasError={submitAttempted && missingFields.some((mf) => mf.id === field.id)}
                allValues={values}
                allFields={template.fields}
              />
            ))
          ) : (
            /* ── Review mode ── */
            <>
              <View testID="form-review-summary" style={s.reviewBanner}>
                <Ionicons name="shield-checkmark-outline" size={20} color={Colors.info} />
                <Text style={s.reviewBannerText}>
                  Please review your answers below before submitting.
                </Text>
              </View>
              {(template.fields || []).map((field) => (
                <ReviewField key={field.id} field={field} value={values[field.id]} />
              ))}
            </>
          )}
        </ScrollView>

        {/* Bottom bar */}
        <View style={s.submitBar}>
          {mode === 'fill' ? (
            <TouchableOpacity
              testID="form-review-btn"
              style={s.reviewBtn}
              onPress={handleReview}
            >
              <Ionicons name="eye-outline" size={20} color={Colors.white} />
              <Text style={s.reviewBtnText}>Review & Submit</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.reviewActions}>
              <TouchableOpacity
                testID="form-edit-btn"
                style={s.editBtn}
                onPress={handleEdit}
              >
                <Ionicons name="create-outline" size={18} color={Colors.orange} />
                <Text style={s.editBtnText}>Edit</Text>
              </TouchableOpacity>
              {/* v58.13.132l — Preview-mode disables submit visibly; server-side
                  403 remains as safety net. */}
              {isPreviewSession() ? (
                <View style={s.reviewSubmitStack}>
                  <View
                    testID="form-submit-btn-preview-disabled"
                    style={[s.confirmBtn, s.confirmBtnDisabled]}
                  >
                    <Ionicons name="lock-closed" size={18} color={Colors.white} />
                    <Text style={s.confirmBtnText}>Confirm & Submit</Text>
                  </View>
                  <View testID="form-preview-chip" style={s.previewChip}>
                    <Ionicons name="eye-outline" size={12} color={Colors.textSecondary} />
                    <Text style={s.previewChipText}>Preview mode — read only</Text>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  testID="form-submit-btn"
                  style={[s.confirmBtn, submitting && s.confirmBtnDisabled]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
                      <Text style={s.confirmBtnText}>Confirm & Submit</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Header ──

function Header({ onBack, title, subtitle }: { onBack: () => void; title: string; subtitle: string }) {
  return (
    <View style={s.header}>
      <TouchableOpacity testID="form-back-btn" style={s.backBtn} onPress={onBack}>
        <Ionicons name="chevron-back" size={24} color={Colors.white} />
      </TouchableOpacity>
      <View style={s.headerCenter}>
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.headerSub}>{subtitle}</Text> : null}
      </View>
      <View style={{ width: 40 }} />
    </View>
  );
}

// ── Review Field (read-only) ──

function ReviewField({ field, value }: { field: FormField; value: unknown }) {
  const displayValue = useMemo(() => {
    if (value == null || value === '') return { text: '—', empty: true };

    switch (field.type) {
      case 'text':
      case 'textarea':
      case 'number':
        return { text: String(value), empty: false };

      case 'date':
        return { text: String(value), empty: false };

      case 'time':
        return { text: String(value), empty: false };

      case 'select':
      case 'radio':
        return { text: String(value), empty: false, isPill: true };

      case 'photo':
        if (Array.isArray(value) && value.length > 0) return { text: `${value.length} photo(s)`, empty: false };
        if (typeof value === 'string' && value) return { text: '1 photo', empty: false };
        return { text: 'No photo', empty: true };

      case 'signature':
        return { text: 'Signed ✓', empty: false };

      case 'gps':
        if (typeof value === 'object' && value !== null) {
          const g = value as { lat?: number; lng?: number; address?: string };
          if (g.address) return { text: g.address, empty: false };
          if (g.lat != null) return { text: `${g.lat}, ${g.lng}`, empty: false };
        }
        return { text: 'No location', empty: true };

      // ── Picker fields ──
      case 'worker_picker':
        if (Array.isArray(value) && value.length > 0) {
          return { text: value.map((w: any) => w.name).join(', '), empty: false };
        }
        if (typeof value === 'object' && value !== null && (value as any).name) {
          return { text: (value as any).name, empty: false };
        }
        return { text: 'No selection', empty: true };

      case 'vehicle_navixy':
        if (typeof value === 'object' && value !== null) {
          const v = value as any;
          return { text: v.label || v.registration || 'Vehicle', empty: false };
        }
        return { text: 'No vehicle', empty: true };

      case 'customer_picker':
        if (typeof value === 'object' && value !== null && (value as any).name) {
          return { text: (value as any).name, empty: false };
        }
        return { text: 'No customer', empty: true };

      case 'site_picker':
        if (typeof value === 'object' && value !== null) {
          const sp = value as any;
          return { text: sp.name || sp.label || 'Site', empty: false };
        }
        return { text: 'No site', empty: true };

      case 'job_picker':
        if (typeof value === 'object' && value !== null) {
          const jp = value as any;
          return { text: jp.name || `Job #${jp.simpro_job_id}`, empty: false };
        }
        return { text: 'No job', empty: true };

      case 'asset_scan':
        if (typeof value === 'object' && value !== null) {
          const a = value as any;
          return { text: a.name || a.rego_serial || 'Asset', empty: false };
        }
        return { text: 'No asset', empty: true };

      case 'contact_picker':
        if (typeof value === 'object' && value !== null && (value as any).name) {
          return { text: (value as any).name, empty: false };
        }
        if (typeof value === 'string' && value) return { text: value, empty: false };
        return { text: 'No contact', empty: true };

      case 'compliance': {
        if (typeof value === 'object' && value !== null) {
          const cv = value as { status?: string; photos?: unknown[]; notes?: string };
          if (cv.status) {
            const statusMap: Record<string, string> = { compliant: 'Compliant ✓', at_risk: 'At Risk ✗', na: 'N/A' };
            const label = statusMap[cv.status] || cv.status;
            const extras: string[] = [];
            if (Array.isArray(cv.photos) && cv.photos.length > 0) extras.push(`${cv.photos.length} photo(s)`);
            if (cv.notes) extras.push('has notes');
            return {
              text: extras.length > 0 ? `${label} · ${extras.join(', ')}` : label,
              empty: false,
              isPill: true,
            };
          }
        }
        return { text: 'Not answered', empty: true };
      }

      default:
        if (typeof value === 'object') return { text: JSON.stringify(value), empty: false };
        return { text: String(value), empty: false };
    }
  }, [field.type, value]);

  return (
    <View testID={`review-field-${field.id}`} style={s.reviewField}>
      <Text style={s.reviewLabel}>
        {field.label}
        {field.required && <Text style={s.required}> *</Text>}
      </Text>
      {displayValue.isPill ? (
        <View style={s.reviewPill}>
          <Text style={s.reviewPillText}>{displayValue.text}</Text>
        </View>
      ) : (
        <Text style={[s.reviewValue, displayValue.empty && s.reviewValueEmpty]}>
          {displayValue.text}
        </Text>
      )}
    </View>
  );
}

// ── Date Picker Field ──

function DatePickerField({ fieldId, value, onChange }: { fieldId: string; value: string; onChange: (v: string) => void }) {
  const [showPicker, setShowPicker] = useState(false);

  const dateValue = useMemo(() => {
    if (value) {
      const d = new Date(value + 'T00:00:00');
      return isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
  }, [value]);

  const handleChange = useCallback((_: unknown, selected?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (selected) {
      const iso = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`;
      onChange(iso);
    }
  }, [onChange]);

  const formatDisplay = (v: string) => {
    if (!v) return 'Tap to select date';
    try {
      const d = new Date(v + 'T00:00:00');
      return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return v; }
  };

  return (
    <View>
      <TouchableOpacity
        testID={`field-date-${fieldId}`}
        style={s.dateBtn}
        onPress={() => setShowPicker(true)}
      >
        <Ionicons name="calendar-outline" size={18} color={Colors.orange} />
        <Text style={s.dateBtnText}>{formatDisplay(value)}</Text>
        <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
      </TouchableOpacity>
      {showPicker && (
        <View>
          <DateTimePicker
            testID={`field-datepicker-${fieldId}`}
            value={dateValue}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleChange}
            textColor={Colors.ink}
          />
          {Platform.OS === 'ios' && (
            <TouchableOpacity testID={`field-datepicker-${fieldId}-done`} style={s.pickerDoneBtn} onPress={() => setShowPicker(false)}>
              <Text style={s.pickerDoneText}>Done</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// ── Time Picker Field ──

function TimePickerField({ fieldId, value, onChange }: { fieldId: string; value: string; onChange: (v: string) => void }) {
  const [showPicker, setShowPicker] = useState(false);

  const timeValue = useMemo(() => {
    if (value && /^\d{2}:\d{2}$/.test(value)) {
      const [h, m] = value.split(':').map(Number);
      const d = new Date(); d.setHours(h, m, 0, 0);
      return d;
    }
    return new Date();
  }, [value]);

  const handleChange = useCallback((_: unknown, selected?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (selected) {
      const hh = String(selected.getHours()).padStart(2, '0');
      const mm = String(selected.getMinutes()).padStart(2, '0');
      onChange(`${hh}:${mm}`);
    }
  }, [onChange]);

  const formatDisplay = (v: string) => {
    if (!v) return 'Tap to select time';
    if (!/^\d{2}:\d{2}$/.test(v)) return v;
    const [h, m] = v.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  return (
    <View>
      <TouchableOpacity
        testID={`field-time-${fieldId}`}
        style={s.dateBtn}
        onPress={() => setShowPicker(true)}
      >
        <Ionicons name="time-outline" size={18} color={Colors.info} />
        <Text style={s.dateBtnText}>{formatDisplay(value)}</Text>
        <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
      </TouchableOpacity>
      {showPicker && (
        <View>
          <DateTimePicker
            testID={`field-timepicker-${fieldId}`}
            value={timeValue}
            mode="time"
            is24Hour={false}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleChange}
            textColor={Colors.ink}
          />
          {Platform.OS === 'ios' && (
            <TouchableOpacity testID={`field-timepicker-${fieldId}-done`} style={s.pickerDoneBtn} onPress={() => setShowPicker(false)}>
              <Text style={s.pickerDoneText}>Done</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// ── Field Renderer (editable) ──

function FieldRenderer({
  field, value, onChange, hasError, allValues, allFields,
}: {
  field: FormField; value: unknown; onChange: (v: unknown) => void; hasError: boolean;
  allValues?: FieldValues; allFields?: FormField[];
}) {
  const borderStyle = hasError ? { borderWidth: 2, borderColor: Colors.error, borderRadius: 14 } : {};

  return (
    <View testID={`form-field-${field.id}`} style={[s.fieldBlock, borderStyle]}>
      {field.type !== 'compliance' && (
        <>
          <Text style={s.fieldLabel}>
            {field.label}
            {field.required && <Text style={s.required}> *</Text>}
          </Text>
          <Text style={s.fieldType}>{field.type}</Text>
        </>
      )}

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
        <DatePickerField fieldId={field.id} value={value as string} onChange={onChange} />
      )}

      {field.type === 'time' && (
        <TimePickerField fieldId={field.id} value={value as string} onChange={onChange} />
      )}

      {(field.type === 'select' || field.type === 'radio') && (
        <View style={s.optionsWrap}>
          {(field.options || []).map((opt) => {
            const isSelected = value === opt;
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

      {!['text', 'textarea', 'number', 'date', 'time', 'select', 'radio', 'photo', 'signature', 'gps', 'compliance',
          'worker_picker', 'vehicle_navixy', 'customer_picker', 'site_picker', 'job_picker', 'asset_scan', 'contact_picker',
        ].includes(field.type) && (
        <View style={s.unsupported}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.textTertiary} />
          <Text style={s.unsupportedText}>{field.type} field (fill on web app)</Text>
        </View>
      )}

      {field.type === 'worker_picker' && (
        <WorkerPicker field={field} value={value} onChange={onChange} allValues={allValues} allFields={allFields} />
      )}
      {field.type === 'vehicle_navixy' && (
        <VehicleNavixyPicker field={field} value={value} onChange={onChange} allValues={allValues} allFields={allFields} />
      )}
      {field.type === 'customer_picker' && (
        <CustomerPicker field={field} value={value} onChange={onChange} allValues={allValues} allFields={allFields} />
      )}
      {field.type === 'site_picker' && (
        <SitePicker field={field} value={value} onChange={onChange} allValues={allValues} allFields={allFields} />
      )}
      {field.type === 'job_picker' && (
        <JobPicker field={field} value={value} onChange={onChange} allValues={allValues} allFields={allFields} />
      )}
      {field.type === 'asset_scan' && (
        <AssetScanPicker field={field} value={value} onChange={onChange} allValues={allValues} allFields={allFields} />
      )}
      {field.type === 'contact_picker' && (
        <ContactPicker field={field} value={value} onChange={onChange} allValues={allValues} allFields={allFields} />
      )}

      {field.type === 'compliance' && (
        <ComplianceQuestion
          field={field}
          value={value}
          onChange={onChange}
        />
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
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: '500', marginTop: 1 },

  // Progress bar
  progressBar: { height: 3, backgroundColor: Colors.border },
  progressFill: { height: 3, backgroundColor: Colors.orange },

  // Mode pill
  modePillRow: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  modePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: Colors.orangeSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
  },
  modePillReview: { backgroundColor: Colors.infoSoft },
  modePillText: { fontSize: 11, fontWeight: '700', color: Colors.orange, textTransform: 'uppercase', letterSpacing: 0.5 },
  modePillTextReview: { color: Colors.info },

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

  // ── Review mode styles ──
  reviewBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.infoSoft, borderRadius: 12, padding: 14, marginBottom: 16,
  },
  reviewBannerText: { flex: 1, fontSize: 13, color: Colors.info, fontWeight: '500', lineHeight: 18 },

  reviewField: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  reviewLabel: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  reviewValue: { fontSize: 15, color: Colors.ink, lineHeight: 22 },
  reviewValueEmpty: { color: Colors.textTertiary, fontStyle: 'italic' },
  reviewPill: {
    alignSelf: 'flex-start', backgroundColor: Colors.orangeSoft,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5,
  },
  reviewPillText: { fontSize: 14, fontWeight: '700', color: Colors.orange },

  // ── Field block ──
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

  // Date / Time
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  dateBtnText: { flex: 1, fontSize: 15, color: Colors.ink },
  pickerDoneBtn: {
    alignSelf: 'flex-end', paddingHorizontal: 16, paddingVertical: 8,
    marginTop: 4, marginBottom: 4,
  },
  pickerDoneText: { fontSize: 15, fontWeight: '700', color: Colors.orange },

  // Options (select/radio)
  optionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface,
    minHeight: 44, alignItems: 'center', justifyContent: 'center',
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

  // ── Bottom bar ──
  submitBar: {
    padding: 16, paddingBottom: 24,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  reviewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 16,
  },
  reviewBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },

  reviewActions: { flexDirection: 'row', gap: 10 },
  reviewSubmitStack: { flex: 2, gap: 6 },
  previewChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: Colors.borderLight, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  previewChipText: {
    fontSize: 11, fontWeight: '600', color: Colors.textSecondary,
    letterSpacing: 0.3,
  },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    flex: 1, backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 16,
    borderWidth: 1.5, borderColor: Colors.orange,
  },
  editBtnText: { color: Colors.orange, fontSize: 15, fontWeight: '700' },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    flex: 2, backgroundColor: Colors.success, borderRadius: 14, paddingVertical: 16,
  },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },

  // Access denied
  accessTitle: { fontSize: 18, fontWeight: '800', color: Colors.ink, marginTop: 8 },
  accessText: { fontSize: 14, color: Colors.textSecondary },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  certDot: { width: 8, height: 8, borderRadius: 4 },
  certLabel: { fontSize: 14, color: Colors.ink, flex: 1 },
  certStatus: { fontSize: 12, fontWeight: '600' },
});
