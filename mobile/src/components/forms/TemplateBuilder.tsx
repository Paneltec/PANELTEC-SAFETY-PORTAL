import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  Modal, ActivityIndicator, Alert, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../lib/api';
import { Colors } from '../../lib/colors';

const FIELD_TYPES = [
  { key: 'text', label: 'Short text', icon: 'create' },
  { key: 'textarea', label: 'Long text', icon: 'document-text' },
  { key: 'date', label: 'Date', icon: 'calendar' },
  { key: 'number', label: 'Number', icon: 'calculator' },
  { key: 'select', label: 'Dropdown (select)', icon: 'list' },
  { key: 'radio', label: 'Choice buttons', icon: 'radio-button-on' },
  { key: 'photo', label: 'Photo capture', icon: 'camera' },
  { key: 'signature', label: 'Signature pad', icon: 'pencil' },
  { key: 'gps', label: 'GPS location', icon: 'location' },
];

const CATEGORIES = [
  { key: 'incident', label: 'Incident' },
  { key: 'inspection', label: 'Inspection' },
  { key: 'toolbox', label: 'Toolbox' },
  { key: 'near_miss', label: 'Near Miss' },
  { key: 'general', label: 'General' },
];

const CAT_COLORS: Record<string, { bg: string; ink: string }> = {
  incident: { bg: '#fde2e4', ink: '#9f1239' },
  inspection: { bg: '#dbeafe', ink: '#1e40af' },
  toolbox: { bg: '#fef3c7', ink: '#92400e' },
  near_miss: { bg: '#fed7aa', ink: '#c2410c' },
  general: { bg: '#e2e8f0', ink: '#475569' },
};

const newFieldId = () =>
  `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function TemplateBuilder({ template, onClose, onSaved }: {
  template: any; onClose: () => void; onSaved: (t?: any) => void;
}) {
  const isEdit = !!template?.id;
  const [name, setName] = useState(template?.name || '');
  const [category, setCategory] = useState(template?.category || 'general');
  const [description, setDescription] = useState(template?.description || '');
  const [fields, setFields] = useState<any[]>(() =>
    template?.fields?.length
      ? template.fields.map((f: any) => ({
          ...f, id: f.id || newFieldId(), options: f.options || [],
        }))
      : [{ id: newFieldId(), label: '', type: 'text', required: false, options: [], placeholder: '' }],
  );
  const [saving, setSaving] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [typePickerIdx, setTypePickerIdx] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const addField = () =>
    setFields((p) => [...p, { id: newFieldId(), label: '', type: 'text', required: false, options: [], placeholder: '' }]);

  const updateField = (idx: number, updates: any) =>
    setFields((p) => p.map((f, i) => (i === idx ? { ...f, ...updates } : f)));

  const removeField = (idx: number) =>
    setFields((p) => p.filter((_, i) => i !== idx));

  const moveField = (idx: number, dir: -1 | 1) => {
    const n = idx + dir;
    if (n < 0 || n >= fields.length) return;
    const next = [...fields];
    [next[idx], next[n]] = [next[n], next[idx]];
    setFields(next);
  };

  const validate = (): string | null => {
    if (!name.trim()) return 'Template name is required';
    if (fields.length === 0) return 'Add at least one field';
    for (const f of fields) {
      if (!f.label?.trim()) return `A field is missing a label`;
      if ((f.type === 'select' || f.type === 'radio') && (!f.options || f.options.length < 2))
        return `"${f.label}" needs at least 2 options`;
    }
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) { Alert.alert('Fix errors', err); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), category, description: description.trim(),
        fields: fields.map((f) => ({
          id: f.id, label: f.label.trim(), type: f.type,
          required: !!f.required,
          options: (f.type === 'select' || f.type === 'radio') ? f.options : [],
          placeholder: f.placeholder || '',
        })),
      };
      if (isEdit) {
        const { data } = await api.patch(`/forms/templates/${template.id}`, payload);
        onSaved?.(data);
      } else {
        const { data } = await api.post('/forms/templates', payload);
        onSaved?.(data);
      }
      onClose();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setSaving(false); }
  };

  const catColor = CAT_COLORS[category] || CAT_COLORS.general;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.safe}>
        {/* Header */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Text style={s.headerLabel}>{isEdit ? 'EDIT TEMPLATE' : 'NEW TEMPLATE'}</Text>
              {template?.source === 'ai' && (
                <View style={s.aiTag}>
                  <Ionicons name="sparkles" size={9} color="#7c3aed" />
                  <Text style={s.aiTagText}>AI DRAFT</Text>
                </View>
              )}
            </View>
            <TextInput testID="builder-name" style={s.nameInput}
              value={name} onChangeText={setName}
              placeholder="Form name" placeholderTextColor={Colors.textTertiary} />
          </View>
          <TouchableOpacity testID="builder-close" onPress={onClose} disabled={saving}
            style={{ padding: 8 }}>
            <Ionicons name="close" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* Meta: category + preview toggle */}
        <View style={s.metaRow}>
          <TouchableOpacity testID="builder-category" style={s.catBtn}
            onPress={() => setCatOpen(true)}>
            <View style={[s.catDot, { backgroundColor: catColor.bg }]} />
            <Text style={s.catBtnText}>
              {CATEGORIES.find((c) => c.key === category)?.label || category}
            </Text>
            <Ionicons name="chevron-down" size={12} color={Colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity style={s.previewToggle}
            onPress={() => setShowPreview(!showPreview)}>
            <Ionicons name={showPreview ? 'create' : 'eye'} size={14} color="#2563eb" />
            <Text style={s.previewToggleText}>
              {showPreview ? 'Editor' : 'Preview'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <TextInput testID="builder-description" style={s.descInput}
            value={description} onChangeText={setDescription}
            placeholder="Short description (shown on card)"
            placeholderTextColor={Colors.textTertiary} />
        </View>

        {showPreview ? (
          <ScrollView style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
            <View style={s.previewBox}>
              <View style={[s.previewCatPill, { backgroundColor: catColor.bg }]}>
                <Text style={[s.previewCatText, { color: catColor.ink }]}>
                  {(category || 'general').replace('_', ' ').toUpperCase()}
                </Text>
              </View>
              <Text style={s.previewTitle}>{name || 'Untitled form'}</Text>
              {description ? <Text style={s.previewDesc}>{description}</Text> : null}
              <View style={{ marginTop: 16, gap: 16 }}>
                {fields.filter((f) => f.label?.trim()).map((f) => (
                  <View key={f.id}>
                    <Text style={s.previewFieldLabel}>
                      {f.label}
                      {f.required ? <Text style={{ color: '#dc2626' }}> *</Text> : null}
                    </Text>
                    <View style={s.previewFieldBox}>
                      <Text style={{ fontSize: 12, color: '#94a3b8' }}>
                        {f.type === 'select'
                          ? '— Select —'
                          : f.type === 'radio'
                          ? (f.options || []).join(' / ')
                          : f.placeholder || f.type}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
              {fields.filter((f) => f.label?.trim()).length === 0 && (
                <Text style={s.emptyPreview}>Add fields to see the preview.</Text>
              )}
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
            keyboardShouldPersistTaps="handled">
            <View style={s.sectionRow}>
              <Text style={s.sectionLabel}>FIELDS ({fields.length})</Text>
              <TouchableOpacity testID="builder-add-field" style={s.addBtn}
                onPress={addField}>
                <Ionicons name="add" size={12} color={Colors.ink} />
                <Text style={s.addBtnText}>Add Field</Text>
              </TouchableOpacity>
            </View>

            {fields.map((f, i) => (
              <View key={f.id} testID={`builder-field-${f.id}`} style={s.fieldCard}>
                {/* Top: reorder + type badge + delete */}
                <View style={s.fieldTopRow}>
                  <TouchableOpacity style={s.moveBtn}
                    onPress={() => moveField(i, -1)} disabled={i === 0}>
                    <Ionicons name="chevron-up" size={14}
                      color={i === 0 ? '#d1d5db' : Colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.moveBtn}
                    onPress={() => moveField(i, 1)}
                    disabled={i === fields.length - 1}>
                    <Ionicons name="chevron-down" size={14}
                      color={i === fields.length - 1 ? '#d1d5db' : Colors.textSecondary} />
                  </TouchableOpacity>
                  <View style={s.fieldTypeBadge}>
                    <Ionicons
                      name={(FIELD_TYPES.find((t) => t.key === f.type)?.icon || 'help') as any}
                      size={10} color="#6366f1" />
                    <Text style={s.fieldTypeBadgeText}>
                      {FIELD_TYPES.find((t) => t.key === f.type)?.label || f.type}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity testID={`builder-remove-${f.id}`}
                    style={{ padding: 4 }} onPress={() => removeField(i)}>
                    <Ionicons name="trash-outline" size={14} color="#dc2626" />
                  </TouchableOpacity>
                </View>

                {/* Label input */}
                <TextInput testID={`builder-label-${f.id}`} style={s.fieldInput}
                  value={f.label}
                  onChangeText={(v) => updateField(i, { label: v })}
                  placeholder={`Field ${i + 1} label`}
                  placeholderTextColor={Colors.textTertiary} />

                {/* Type picker + required toggle */}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity testID={`builder-type-${f.id}`}
                    style={[s.fieldInput, { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                    onPress={() => setTypePickerIdx(i)}>
                    <Text style={{ fontSize: 13, color: Colors.text }}>
                      {FIELD_TYPES.find((t) => t.key === f.type)?.label || f.type}
                    </Text>
                    <Ionicons name="chevron-down" size={12} color={Colors.textTertiary} />
                  </TouchableOpacity>
                  <View style={[s.fieldInput, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 0 }]}>
                    <Text style={{ fontSize: 12, color: Colors.textSecondary }}>Req</Text>
                    <Switch testID={`builder-required-${f.id}`}
                      value={!!f.required}
                      onValueChange={(v) => updateField(i, { required: v })}
                      trackColor={{ false: '#e2e8f0', true: '#bfdbfe' }}
                      thumbColor={f.required ? '#2563eb' : '#94a3b8'} />
                  </View>
                </View>

                {/* Placeholder (text/textarea/number) */}
                {['text', 'textarea', 'number'].includes(f.type) && (
                  <TextInput testID={`builder-placeholder-${f.id}`}
                    style={[s.fieldInput, { marginTop: 8 }]}
                    value={f.placeholder || ''}
                    onChangeText={(v) => updateField(i, { placeholder: v })}
                    placeholder="Placeholder (optional)"
                    placeholderTextColor={Colors.textTertiary} />
                )}

                {/* Options (select/radio) */}
                {(f.type === 'select' || f.type === 'radio') && (
                  <TextInput testID={`builder-options-${f.id}`}
                    style={[s.fieldInput, { marginTop: 8, minHeight: 72, textAlignVertical: 'top' }]}
                    multiline value={(f.options || []).join('\n')}
                    onChangeText={(v) =>
                      updateField(i, {
                        options: v.split('\n').map((x: string) => x.trim()).filter(Boolean),
                      })
                    }
                    placeholder={'One option per line\nYes\nNo\nN/A'}
                    placeholderTextColor={Colors.textTertiary} />
                )}
              </View>
            ))}

            <TouchableOpacity style={s.addAnotherBtn} onPress={addField}>
              <Ionicons name="add" size={14} color={Colors.textSecondary} />
              <Text style={s.addAnotherText}>Add another field</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerHint} numberOfLines={1}>
            {isEdit ? 'Editing template' : 'New template'}
          </Text>
          <TouchableOpacity onPress={onClose} disabled={saving}
            style={s.cancelBtn}>
            <Text style={s.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="builder-save" onPress={save}
            disabled={saving} style={[s.saveBtn, saving && { opacity: 0.5 }]}>
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="save" size={14} color="#fff" />
            )}
            <Text style={s.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>

        {/* Category picker */}
        <Modal visible={catOpen} transparent animationType="fade"
          onRequestClose={() => setCatOpen(false)}>
          <TouchableOpacity style={s.overlay} activeOpacity={1}
            onPress={() => setCatOpen(false)}>
            <View style={s.pickerBox}>
              <Text style={s.pickerTitle}>Select category</Text>
              {CATEGORIES.map((c) => (
                <TouchableOpacity key={c.key}
                  style={[s.pickerItem, category === c.key && { backgroundColor: '#f1f5f9' }]}
                  onPress={() => { setCategory(c.key); setCatOpen(false); }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: (CAT_COLORS[c.key] || CAT_COLORS.general).bg }} />
                    <Text style={s.pickerItemText}>{c.label}</Text>
                  </View>
                  {category === c.key && <Ionicons name="checkmark" size={14} color="#2563eb" />}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Type picker */}
        <Modal visible={typePickerIdx !== null} transparent animationType="fade"
          onRequestClose={() => setTypePickerIdx(null)}>
          <TouchableOpacity style={s.overlay} activeOpacity={1}
            onPress={() => setTypePickerIdx(null)}>
            <View style={s.pickerBox}>
              <Text style={s.pickerTitle}>Select field type</Text>
              {FIELD_TYPES.map((t) => {
                const sel = typePickerIdx !== null && fields[typePickerIdx]?.type === t.key;
                return (
                  <TouchableOpacity key={t.key}
                    style={[s.pickerItem, sel && { backgroundColor: '#f0f9ff' }]}
                    onPress={() => {
                      if (typePickerIdx !== null) updateField(typePickerIdx, { type: t.key });
                      setTypePickerIdx(null);
                    }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name={t.icon as any} size={14} color="#6366f1" />
                      <Text style={s.pickerItemText}>{t.label}</Text>
                    </View>
                    {sel && <Ionicons name="checkmark" size={14} color="#6366f1" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.textTertiary },
  aiTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#f5f3ff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
  },
  aiTagText: { fontSize: 9, fontWeight: '700', color: '#7c3aed', letterSpacing: 0.5 },
  nameInput: {
    fontSize: 20, fontWeight: '800', color: Colors.ink,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4,
  },
  catBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  catBtnText: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  previewToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#eff6ff',
  },
  previewToggleText: { fontSize: 12, fontWeight: '600', color: '#2563eb' },
  descInput: {
    fontSize: 13, color: Colors.text, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 12,
  },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textTertiary },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  addBtnText: { fontSize: 11, fontWeight: '600', color: Colors.ink },
  fieldCard: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: 12, marginBottom: 10,
  },
  fieldTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  moveBtn: {
    width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0',
    alignItems: 'center', justifyContent: 'center',
  },
  fieldTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#eef2ff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  fieldTypeBadgeText: {
    fontSize: 9, fontWeight: '600', color: '#6366f1',
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  fieldInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: Colors.text,
  },
  addAnotherBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed',
    borderColor: '#d1d5db', marginTop: 4,
  },
  addAnotherText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 16, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  footerHint: { fontSize: 11, color: Colors.textTertiary, flex: 1 },
  cancelBtn: {
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#d97706',
  },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },
  previewBox: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 16, padding: 16,
  },
  previewCatPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    alignSelf: 'flex-start', marginBottom: 8,
  },
  previewCatText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  previewTitle: { fontSize: 18, fontWeight: '800', color: Colors.ink },
  previewDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, lineHeight: 17 },
  previewFieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.ink, marginBottom: 4 },
  previewFieldBox: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 44, justifyContent: 'center',
  },
  emptyPreview: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', marginTop: 12 },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  pickerBox: {
    backgroundColor: Colors.surface, borderRadius: 18, padding: 16,
    width: '100%', maxWidth: 340,
  },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink, marginBottom: 8 },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10,
  },
  pickerItemText: { fontSize: 14, color: Colors.text, fontWeight: '500' },
});
