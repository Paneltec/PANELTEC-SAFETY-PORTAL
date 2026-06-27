import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../lib/colors';

const CAT: Record<string, { bg: string; ink: string }> = {
  incident:   { bg: '#fde2e4', ink: '#9f1239' },
  inspection: { bg: '#dbeafe', ink: '#1e40af' },
  toolbox:    { bg: '#fef3c7', ink: '#92400e' },
  near_miss:  { bg: '#fed7aa', ink: '#c2410c' },
  general:    { bg: '#e2e8f0', ink: '#475569' },
};

function ReadOnlyField({ field }: { field: any }) {
  if (field.type === 'photo') return <Text style={s.roHint}>📷  Photo capture (preview only)</Text>;
  if (field.type === 'signature') return <Text style={s.roHint}>✍️  Signature pad (preview only)</Text>;
  if (field.type === 'gps') return <Text style={s.roHint}>📍  GPS location (preview only)</Text>;
  if (field.type === 'select') return (
    <View style={s.disabledInput}><Text style={s.disabledText}>— Select —</Text></View>
  );
  if (field.type === 'radio') return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {(field.options || []).map((o: string) => (
        <View key={o} style={s.roRadio}>
          <Text style={s.roRadioText}>{o}</Text>
        </View>
      ))}
    </View>
  );
  if (field.type === 'textarea') return (
    <View style={[s.disabledInput, { minHeight: 80 }]}>
      <Text style={s.disabledText}>{field.placeholder || ''}</Text>
    </View>
  );
  return (
    <View style={s.disabledInput}>
      <Text style={s.disabledText}>{field.placeholder || ''}</Text>
    </View>
  );
}

export default function PreviewModal({ template, onClose, onFill }: {
  template: any; onClose: () => void; onFill: () => void;
}) {
  const cat = CAT[template.category] || CAT.general;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.safe}>
        {/* Header */}
        <View style={s.header}>
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={[s.pill, { backgroundColor: cat.bg }]}>
                <Text style={[s.pillText, { color: cat.ink }]}>
                  {(template.category || 'general').replace('_', ' ').toUpperCase()}
                </Text>
              </View>
              <View style={[s.pill, { backgroundColor: '#dbeafe' }]}>
                <Ionicons name="phone-portrait-outline" size={10} color="#1e40af" />
                <Text style={[s.pillText, { color: '#1e40af', marginLeft: 3 }]}>PREVIEW</Text>
              </View>
            </View>
            <Text style={s.title}>Preview · {template.name}</Text>
            {template.description ? <Text style={s.desc}>{template.description}</Text> : null}
          </View>
          <TouchableOpacity testID="preview-close" onPress={onClose} style={s.closeBtn}>
            <Ionicons name="close" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* Fields */}
        <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc' }}
          contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 100 }}>
          {(template.fields || []).map((f: any) => (
            <View key={f.id} testID={`preview-field-${f.id}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <Text style={s.fieldLabel}>{f.label}</Text>
                {f.required && <Text style={s.required}>*</Text>}
                <Text style={s.fieldType}>{f.type}</Text>
              </View>
              <ReadOnlyField field={f} />
            </View>
          ))}
        </ScrollView>

        {/* Footer */}
        <View style={s.footer}>
          <TouchableOpacity onPress={onClose} style={s.secondaryBtn}>
            <Text style={s.secondaryBtnText}>Close</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="preview-fill-cta" onPress={onFill} style={s.fillBtn}>
            <Ionicons name="pencil" size={14} color="#fff" />
            <Text style={s.fillBtnText}>Fill out this form</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12,
  },
  pillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  title: { fontSize: 18, fontWeight: '800', color: Colors.ink },
  desc: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  closeBtn: { padding: 8, borderRadius: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.ink },
  required: { fontSize: 14, color: '#dc2626', fontWeight: '700' },
  fieldType: { fontSize: 9, fontWeight: '600', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  disabledInput: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 48,
    justifyContent: 'center',
  },
  disabledText: { fontSize: 13, color: '#94a3b8' },
  roHint: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', paddingVertical: 8 },
  roRadio: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderWidth: 2, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', minHeight: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  roRadioText: { fontSize: 13, fontWeight: '600', color: '#94a3b8' },
  footer: {
    flexDirection: 'row', gap: 8, padding: 16,
    borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: '#fff',
  },
  secondaryBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    minHeight: 50,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  fillBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, backgroundColor: '#1e293b', minHeight: 50,
  },
  fillBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
