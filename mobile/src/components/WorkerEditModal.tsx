import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, Switch, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../lib/api';
import { Colors } from '../lib/colors';
import ClientPickerModal from './ClientPickerModal';

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];
const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
const CLIENT_SOURCES = [
  { value: 'paneltec', label: 'Paneltec', bg: '#e6eff9', text: '#1e4a8c' },
  { value: 'viatec',   label: 'Viatec',   bg: '#ece6f4', text: '#4f3a8c' },
  { value: 'both',     label: 'Both',     bg: '#d8ecdd', text: '#1f7a3f' },
];

function emptyAvailability() {
  const a: any = {};
  DAYS.forEach((d) => { a[d.key] = { enabled: false, start: '07:00', end: '17:00' }; });
  return a;
}
function normaliseAvailability(av: any) {
  const out = emptyAvailability();
  if (av && typeof av === 'object') {
    DAYS.forEach((d) => {
      const row = av[d.key] || {};
      out[d.key] = { enabled: !!row.enabled, start: row.start || '07:00', end: row.end || '17:00' };
    });
  }
  return out;
}

function fullName(w: any) { return `${w.first_name || ''} ${w.last_name || ''}`.trim() || '(unnamed)'; }

/* Collapsible section */
function Section({ icon, title, badge, defaultOpen, testid, children }: any) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <View style={cs.sectionWrap} testID={testid}>
      <TouchableOpacity testID={`${testid}-toggle`} style={cs.sectionHeader} onPress={() => setOpen(!open)} activeOpacity={0.7}>
        <Ionicons name={icon} size={14} color={Colors.textSecondary} />
        <Text style={cs.sectionTitle}>{title}</Text>
        {badge ? <View style={cs.sectionBadge}><Text style={cs.sectionBadgeText}>{badge}</Text></View> : null}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textTertiary} />
      </TouchableOpacity>
      {open && <View style={cs.sectionBody}>{children}</View>}
    </View>
  );
}

/* Inline picker modal */
function PickerModal({ visible, title, options, selected, onSelect, onClose }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={cs.pickerOverlay} activeOpacity={1} onPress={onClose}>
        <View style={cs.pickerBox}>
          <Text style={cs.pickerTitle}>{title}</Text>
          {options.map((o: any) => (
            <TouchableOpacity key={o.value ?? o} style={cs.pickerItem} onPress={() => onSelect(o.value ?? o)}>
              <Text style={[cs.pickerItemText, (selected === (o.value ?? o)) && { color: '#1e4a8c', fontWeight: '700' }]}>
                {o.label ?? o}
              </Text>
              {selected === (o.value ?? o) && <Ionicons name="checkmark" size={14} color="#1e4a8c" />}
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

/* Time display/edit — shows HH:MM, tap to cycle */
function TimeInput({ testID, value, onChange, disabled }: any) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  if (editing) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <TextInput
          testID={testID}
          style={[cs.timeInput, { width: 56 }]}
          value={draft}
          onChangeText={(v) => {
            // Auto-format: allow digits and colon
            const clean = v.replace(/[^\d:]/g, '');
            if (clean.length === 2 && !clean.includes(':')) {
              setDraft(clean + ':');
            } else {
              setDraft(clean.slice(0, 5));
            }
          }}
          onBlur={() => {
            if (/^\d{2}:\d{2}$/.test(draft)) onChange(draft);
            else setDraft(value);
            setEditing(false);
          }}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          autoFocus
          selectTextOnFocus
        />
      </View>
    );
  }

  return (
    <TouchableOpacity
      testID={testID}
      disabled={disabled}
      style={[cs.timeInput, disabled && { backgroundColor: '#F1F5F9' }]}
      onPress={() => setEditing(true)}
    >
      <Text style={[cs.timeText, disabled && { color: Colors.textTertiary }]}>{value}</Text>
    </TouchableOpacity>
  );
}

export default function WorkerEditModal({ worker, canEdit, onClose, onSaved }: {
  worker: any; canEdit: boolean; onClose: () => void; onSaved: () => void;
}) {
  const isNew = !worker.id;
  const isSimpro = worker.source === 'simpro';

  const [f, setF] = useState({
    first_name: worker.first_name || '',
    last_name:  worker.last_name  || '',
    email:      worker.email      || '',
    phone:      worker.phone      || '',
    mobile:     worker.mobile     || '',
    position:   worker.position   || '',
    active:     worker.active !== false,
    birth_date:     worker.birth_date     || '',
    country:        worker.country        || 'Australia',
    state:          worker.state          || '',
    street_address: worker.street_address || '',
    suburb:         worker.suburb         || '',
    postal_code:    worker.postal_code    || '',
    additional_notes: worker.additional_notes || '',
    availability: normaliseAvailability(worker.availability),
    client_ids: Array.isArray(worker.client_ids) ? [...worker.client_ids] : [],
  });
  const [saving, setSaving] = useState(false);
  const [pickerCompany, setPickerCompany] = useState<string | null>(null);
  const [clientCache, setClientCache] = useState<Record<string, { name: string; company_label: string }>>({});
  const [countryPicker, setCountryPicker] = useState(false);
  const [statePicker, setStatePicker] = useState(false);

  // Availability validation
  const availabilityError = useMemo(() => {
    for (const d of DAYS) {
      const row = f.availability[d.key];
      if (row.enabled && row.start >= row.end) {
        return `${d.label}: end must be after start`;
      }
    }
    return null;
  }, [f.availability]);

  // Hydrate client cache
  useEffect(() => {
    const missing = f.client_ids.filter((id: string) => !clientCache[id]);
    if (!missing.length) return;
    (async () => {
      try {
        const { data } = await api.get('/integrations/simpro/customers?company=both');
        const cache: any = {};
        (data.customers || []).forEach((c: any) => {
          cache[c.simpro_customer_id] = { name: c.name, company_label: c.company_label };
        });
        setClientCache((prev) => ({ ...prev, ...cache }));
      } catch { /* silent */ }
    })();
  }, [f.client_ids.length]);

  const enabledDayCount = Object.values(f.availability).filter((r: any) => r.enabled).length;

  const submit = async () => {
    if (!f.first_name.trim()) { Alert.alert('Required', 'First name is required'); return; }
    if (availabilityError) { Alert.alert('Validation', availabilityError); return; }
    if (f.postal_code && !/^\d{4}$/.test(f.postal_code)) { Alert.alert('Validation', 'Postal code must be 4 digits'); return; }
    setSaving(true);
    try {
      if (isNew) {
        await api.post('/workers', f);
        Alert.alert('Success', 'Worker added');
      } else {
        await api.patch(`/workers/${worker.id}`, f);
        Alert.alert('Success', 'Worker updated');
      }
      onSaved();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {/* Header */}
          <View testID="worker-edit-header" style={cs.header}>
            <View style={{ flex: 1 }}>
              <Text style={cs.headerOverline}>{isNew ? 'NEW WORKER' : 'EDIT WORKER'}</Text>
              <Text style={cs.headerTitle}>{isNew ? 'Add worker' : fullName(worker)}</Text>
            </View>
            <TouchableOpacity testID="worker-edit-close" onPress={onClose} style={{ padding: 6 }}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {isSimpro && (
            <View testID="simpro-banner" style={cs.simproBanner}>
              <Ionicons name="extension-puzzle" size={12} color="#1e4a8c" />
              <Text style={cs.simproBannerText}>Synced from Simpro</Text>
            </View>
          )}

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled">

            {/* 1. Identity — always open */}
            <View testID="section-identity" style={[cs.sectionWrap, { backgroundColor: Colors.white }]}>
              <View style={[cs.sectionHeader, { borderBottomWidth: 0 }]}>
                <Ionicons name="person" size={14} color={Colors.textSecondary} />
                <Text style={cs.sectionTitle}>Identity & contact</Text>
              </View>
              <View style={{ padding: 12, gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={cs.label}>First name *</Text>
                    <TextInput testID="worker-first-name" style={cs.input} value={f.first_name}
                      onChangeText={(v) => setF({ ...f, first_name: v })} placeholder="First name"
                      placeholderTextColor={Colors.textTertiary} editable={canEdit} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={cs.label}>Last name</Text>
                    <TextInput testID="worker-last-name" style={cs.input} value={f.last_name}
                      onChangeText={(v) => setF({ ...f, last_name: v })} placeholder="Last name"
                      placeholderTextColor={Colors.textTertiary} editable={canEdit} />
                  </View>
                </View>
                <View>
                  <Text style={cs.label}>Email</Text>
                  <TextInput testID="worker-email" style={cs.input} value={f.email}
                    onChangeText={(v) => setF({ ...f, email: v })} placeholder="email@example.com"
                    placeholderTextColor={Colors.textTertiary} keyboardType="email-address"
                    autoCapitalize="none" editable={canEdit} />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={cs.label}>Phone</Text>
                    <TextInput testID="worker-phone" style={cs.input} value={f.phone}
                      onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad"
                      placeholderTextColor={Colors.textTertiary} editable={canEdit} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={cs.label}>Mobile</Text>
                    <TextInput testID="worker-mobile" style={cs.input} value={f.mobile}
                      onChangeText={(v) => setF({ ...f, mobile: v })} keyboardType="phone-pad"
                      placeholderTextColor={Colors.textTertiary} editable={canEdit} />
                  </View>
                </View>
                <View>
                  <Text style={cs.label}>Position</Text>
                  <TextInput testID="worker-position" style={cs.input} value={f.position}
                    onChangeText={(v) => setF({ ...f, position: v })} placeholder="e.g. Site Supervisor"
                    placeholderTextColor={Colors.textTertiary} editable={canEdit} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Switch testID="worker-active-toggle" value={f.active}
                    onValueChange={(v) => canEdit && setF({ ...f, active: v })}
                    trackColor={{ true: '#10B981', false: '#CBD5E1' }}
                    disabled={!canEdit} />
                  <Text style={{ fontSize: 13, color: Colors.text }}>Active</Text>
                </View>
              </View>
            </View>

            {/* 2. Personal */}
            <Section icon="location" title="Personal" testid="section-personal"
              badge={[f.state, f.suburb].filter(Boolean).join(', ') || null} defaultOpen={false}>
              <View style={{ gap: 8 }}>
                <View>
                  <Text style={cs.label}>Birth date</Text>
                  <TextInput testID="worker-birth-date" style={cs.input} value={f.birth_date}
                    onChangeText={(v) => setF({ ...f, birth_date: v })} placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.textTertiary} editable={canEdit} />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={cs.label}>Country</Text>
                    <TouchableOpacity testID="worker-country" style={cs.pickerBtn} onPress={() => setCountryPicker(true)}>
                      <Text style={cs.pickerBtnText}>{f.country}</Text>
                      <Ionicons name="chevron-down" size={12} color={Colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                  {f.country === 'Australia' && (
                    <View style={{ flex: 1 }}>
                      <Text style={cs.label}>State</Text>
                      <TouchableOpacity testID="worker-state" style={cs.pickerBtn} onPress={() => setStatePicker(true)}>
                        <Text style={cs.pickerBtnText}>{f.state || '—'}</Text>
                        <Ionicons name="chevron-down" size={12} color={Colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                <View>
                  <Text style={cs.label}>Street address</Text>
                  <TextInput testID="worker-street-address" style={cs.input} value={f.street_address}
                    onChangeText={(v) => setF({ ...f, street_address: v })}
                    placeholderTextColor={Colors.textTertiary} editable={canEdit} />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 2 }}>
                    <Text style={cs.label}>Suburb</Text>
                    <TextInput testID="worker-suburb" style={cs.input} value={f.suburb}
                      onChangeText={(v) => setF({ ...f, suburb: v })}
                      placeholderTextColor={Colors.textTertiary} editable={canEdit} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={cs.label}>Postal code</Text>
                    <TextInput testID="worker-postal-code" style={cs.input} value={f.postal_code}
                      onChangeText={(v) => setF({ ...f, postal_code: v.replace(/\D/g, '').slice(0, 4) })}
                      keyboardType="number-pad" maxLength={4} placeholder="2000"
                      placeholderTextColor={Colors.textTertiary} editable={canEdit} />
                  </View>
                </View>
                <View>
                  <Text style={cs.label}>Additional notes</Text>
                  <TextInput testID="worker-additional-notes" style={[cs.input, { minHeight: 60 }]} multiline
                    value={f.additional_notes} onChangeText={(v) => setF({ ...f, additional_notes: v })}
                    placeholderTextColor={Colors.textTertiary} editable={canEdit} />
                </View>
              </View>
            </Section>

            {/* 3. Availability */}
            <Section icon="calendar" title="Availability" testid="section-availability"
              badge={enabledDayCount > 0 ? `${enabledDayCount} day${enabledDayCount === 1 ? '' : 's'}` : null}
              defaultOpen={false}>
              <View style={{ gap: 4 }}>
                {DAYS.map((d) => {
                  const row = f.availability[d.key];
                  const invalid = row.enabled && row.start >= row.end;
                  const setRow = (patch: any) => setF({
                    ...f,
                    availability: { ...f.availability, [d.key]: { ...row, ...patch } },
                  });
                  return (
                    <View key={d.key} testID={`availability-${d.key}`}
                      style={[cs.dayRow, row.enabled ? cs.dayRowEnabled : cs.dayRowDisabled,
                        invalid && { borderColor: '#e69aa3', borderWidth: 1 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: 70 }}>
                        <Switch
                          testID={`availability-${d.key}-toggle`}
                          value={row.enabled}
                          onValueChange={(v) => canEdit && setRow({ enabled: v })}
                          style={{ transform: [{ scale: 0.7 }] }}
                          trackColor={{ true: '#1e4a8c', false: '#CBD5E1' }}
                          disabled={!canEdit}
                        />
                        <Text style={[cs.dayLabel, row.enabled && { color: '#1e4a8c', fontWeight: '600' }]}>{d.label}</Text>
                      </View>
                      {row.enabled && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                          <TimeInput testID={`availability-${d.key}-start`} value={row.start}
                            onChange={(v: string) => setRow({ start: v })} disabled={!canEdit} />
                          <Text style={{ fontSize: 10, color: Colors.textTertiary }}>to</Text>
                          <TimeInput testID={`availability-${d.key}-end`} value={row.end}
                            onChange={(v: string) => setRow({ end: v })} disabled={!canEdit} />
                        </View>
                      )}
                      {invalid && (
                        <Text style={cs.dayError}>End must be after start</Text>
                      )}
                    </View>
                  );
                })}
                {availabilityError && (
                  <Text testID="availability-error" style={cs.availError}>{availabilityError}</Text>
                )}
              </View>
            </Section>

            {/* 4. Clients */}
            <Section icon="people" title="Clients" testid="section-clients"
              badge={f.client_ids.length ? `${f.client_ids.length} selected` : null}
              defaultOpen={false}>
              <Text style={{ fontSize: 11, color: Colors.textTertiary, marginBottom: 8 }}>Populate from SimPRO:</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {CLIENT_SOURCES.map((src) => (
                  <TouchableOpacity key={src.value} testID={`populate-${src.value}`}
                    style={[cs.srcPill, { backgroundColor: src.bg }]}
                    onPress={() => setPickerCompany(src.value)}>
                    <Text style={[cs.srcPillText, { color: src.text }]}>{src.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {f.client_ids.length === 0 ? (
                <Text style={{ fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic' }}>No clients assigned yet.</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {f.client_ids.map((id: string) => {
                    const meta = clientCache[id];
                    return (
                      <View key={id} testID={`client-chip-${id}`} style={cs.clientChip}>
                        <Text style={cs.clientChipName}>{meta?.name || `#${id}`}</Text>
                        {meta?.company_label && (
                          <View style={[cs.clientChipLabel, {
                            backgroundColor: meta.company_label === 'Paneltec' ? '#e6eff9'
                              : meta.company_label === 'Viatec' ? '#ece6f4' : '#F1F5F9',
                          }]}>
                            <Text style={[cs.clientChipLabelText, {
                              color: meta.company_label === 'Paneltec' ? '#1e4a8c'
                                : meta.company_label === 'Viatec' ? '#4f3a8c' : '#475569',
                            }]}>{meta.company_label}</Text>
                          </View>
                        )}
                        {canEdit && (
                          <TouchableOpacity testID={`client-chip-remove-${id}`}
                            onPress={() => setF({ ...f, client_ids: f.client_ids.filter((x: string) => x !== id) })}>
                            <Ionicons name="close" size={12} color={Colors.textTertiary} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </Section>
          </ScrollView>

          {/* Save footer */}
          {canEdit && (
            <View testID="worker-edit-footer" style={cs.footer}>
              {availabilityError && <Text style={cs.footerError}>{availabilityError}</Text>}
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                <TouchableOpacity testID="modal-cancel" style={cs.cancelBtn} onPress={onClose}>
                  <Text style={cs.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="modal-save" style={[cs.saveBtn, (saving || !!availabilityError) && { opacity: 0.6 }]}
                  onPress={submit} disabled={saving || !!availabilityError}>
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : (
                    <Text style={cs.saveBtnText}>{isNew ? 'Create' : 'Update'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Pickers */}
          <PickerModal visible={countryPicker} title="Country"
            options={[{ value: 'Australia', label: 'Australia' }, { value: 'Other', label: 'Other' }]}
            selected={f.country}
            onSelect={(v: string) => { setF({ ...f, country: v, state: v !== 'Australia' ? '' : f.state }); setCountryPicker(false); }}
            onClose={() => setCountryPicker(false)} />
          <PickerModal visible={statePicker} title="State"
            options={[{ value: '', label: '—' }, ...AU_STATES.map((s) => ({ value: s, label: s }))]}
            selected={f.state}
            onSelect={(v: string) => { setF({ ...f, state: v }); setStatePicker(false); }}
            onClose={() => setStatePicker(false)} />

          {/* Client picker */}
          {pickerCompany && (
            <ClientPickerModal
              company={pickerCompany}
              selectedIds={f.client_ids}
              onClose={() => setPickerCompany(null)}
              onApply={(ids: string[]) => { setF({ ...f, client_ids: ids }); setPickerCompany(null); }}
            />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const cs = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#e6eff9',
    borderBottomWidth: 1, borderBottomColor: '#b9d2ec',
  },
  headerOverline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: '#1e4a8c' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink, marginTop: 2 },
  simproBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#e6eff960', borderBottomWidth: 1, borderBottomColor: '#b9d2ec',
  },
  simproBannerText: { fontSize: 11, color: '#1e4a8c' },
  // Sections
  sectionWrap: { borderWidth: 1, borderColor: Colors.border, borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#F8FAFC',
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sectionTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.ink },
  sectionBadge: { backgroundColor: '#e6eff9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  sectionBadgeText: { fontSize: 9, fontWeight: '700', color: '#1e4a8c', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionBody: { padding: 12, backgroundColor: Colors.white },
  // Form
  label: { fontSize: 11, fontWeight: '500', color: Colors.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: Colors.text,
  },
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 9,
  },
  pickerBtnText: { fontSize: 13, color: Colors.text },
  // Availability
  dayRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
  dayRowEnabled: { backgroundColor: '#e6eff9' },
  dayRowDisabled: { backgroundColor: '#F8FAFC' },
  dayLabel: { fontSize: 12, color: Colors.textSecondary },
  dayError: { fontSize: 10, color: '#7a1f33', fontWeight: '500', marginLeft: 4 },
  availError: { fontSize: 11, color: '#7a1f33', fontWeight: '500', marginTop: 6 },
  timeInput: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4, minWidth: 52, alignItems: 'center',
    fontSize: 12, color: Colors.text,
  },
  timeText: { fontSize: 12, color: Colors.text, textAlign: 'center' },
  // Clients
  srcPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  srcPillText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  clientChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: Colors.border,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4,
  },
  clientChipName: { fontSize: 11, color: Colors.text },
  clientChipLabel: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6 },
  clientChipLabelText: { fontSize: 8, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  // Footer
  footer: {
    paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: '#F8FAFC',
  },
  footerError: { fontSize: 10, color: '#7a1f33', marginBottom: 6 },
  cancelBtn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  cancelBtnText: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  saveBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#1e4a8c',
  },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },
  // Picker modal
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerBox: { backgroundColor: Colors.white, borderRadius: 16, padding: 16, width: '100%', maxWidth: 280 },
  pickerTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink, marginBottom: 12 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  pickerItemText: { fontSize: 14, color: Colors.text },
});
