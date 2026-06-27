import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';

const CAT_COLORS: Record<string, { bg: string; ink: string }> = {
  incident:   { bg: '#fbe4e7', ink: '#7a1f33' },
  inspection: { bg: '#ece6f4', ink: '#4f3a8c' },
  toolbox:    { bg: '#f7eed1', ink: '#8c6a1a' },
  near_miss:  { bg: '#f8d7c3', ink: '#9c4f1a' },
  general:    { bg: '#f1f5f9', ink: '#334155' },
};

const TYPE_ICONS: Record<string, string> = {
  text: 'create', textarea: 'document-text', number: 'calculator',
  date: 'calendar', select: 'list', radio: 'radio-button-on',
  photo: 'camera', signature: 'pencil', gps: 'location',
};

export default function TemplateDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tpl, setTpl] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/forms/templates/${id}`)
      .then(({ data }) => setTpl(data))
      .catch((e) => Alert.alert('Error', apiError(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const cat = CAT_COLORS[tpl?.category] || CAT_COLORS.general;

  if (loading) {
    return (
      <SafeAreaView style={s.safe}><ActivityIndicator testID="tpl-loading" style={{ marginTop: 60 }} color={Colors.blue} /></SafeAreaView>
    );
  }
  if (!tpl) {
    return (
      <SafeAreaView style={s.safe}>
        <Text style={{ padding: 24, color: Colors.textSecondary }}>Template not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View testID="tpl-header" style={[s.header, { backgroundColor: cat.bg, borderBottomColor: cat.ink + '30' }]}>
        <TouchableOpacity testID="tpl-back" onPress={() => router.back()} style={{ padding: 4 }}>
          <Ionicons name="arrow-back" size={20} color={cat.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[s.catBadge, { backgroundColor: cat.ink + '18' }]}>
              <Text style={[s.catBadgeText, { color: cat.ink }]}>
                {(tpl.category || 'general').replace('_', ' ').toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={[s.headerTitle, { color: cat.ink }]}>{tpl.name}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {tpl.description ? (
          <Text testID="tpl-description" style={s.desc}>{tpl.description}</Text>
        ) : null}

        <Text style={s.sectionLabel}>FIELDS ({(tpl.fields || []).length})</Text>
        {(tpl.fields || []).map((f: any, i: number) => (
          <View key={f.id || i} testID={`detail-field-${f.id}`} style={s.fieldCard}>
            <View style={s.fieldTop}>
              <View style={s.typeBadge}>
                <Ionicons name={(TYPE_ICONS[f.type] || 'help') as any} size={10} color={Colors.textSecondary} />
                <Text style={s.typeBadgeText}>{f.type}</Text>
              </View>
              <Text style={s.fieldLabel}>{f.label}</Text>
              {f.required && <Text style={s.requiredDot}>*</Text>}
            </View>
            {f.placeholder ? <Text style={s.fieldPlaceholder}>Placeholder: {f.placeholder}</Text> : null}
            {(f.options || []).length > 0 && (
              <View style={s.optionsRow}>
                {f.options.map((o: string) => (
                  <View key={o} style={s.optionChip}>
                    <Text style={s.optionChipText}>{o}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Bottom CTA */}
      <View style={s.ctaWrap}>
        <TouchableOpacity testID="open-fillout-btn" style={s.ctaBtn}
          onPress={() => router.push(`/forms/fill/${id}`)}>
          <Ionicons name="add-circle" size={16} color="#fff" />
          <Text style={s.ctaBtnText}>Fill out this form</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="view-submissions-btn" style={s.secondaryBtn}
          onPress={() => router.push(`/forms/submissions/${id}`)}>
          <Ionicons name="list" size={14} color={Colors.textSecondary} />
          <Text style={s.secondaryBtnText}>
            View submissions{tpl.submission_count ? ` (${tpl.submission_count})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', marginTop: 4 },
  catBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  catBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  desc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 16 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textTertiary, marginBottom: 8 },
  fieldCard: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  fieldTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#f1f5f9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  typeBadgeText: { fontSize: 9, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.ink, flex: 1 },
  requiredDot: { fontSize: 14, color: '#a8324c', fontWeight: '700' },
  fieldPlaceholder: { fontSize: 11, color: Colors.textTertiary, marginTop: 4 },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  optionChip: { backgroundColor: '#f1f5f9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  optionChipText: { fontSize: 10, color: Colors.textSecondary },
  ctaWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 32,
    backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.border, gap: 8,
  },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1e4a8c', borderRadius: 12, paddingVertical: 14, minHeight: 50,
  },
  ctaBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingVertical: 12,
    backgroundColor: Colors.white,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
});
