import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import PrimaryButton from '../../src/components/PrimaryButton';
import GhostButton from '../../src/components/GhostButton';
import { Colors } from '../../src/lib/colors';

const TEMPLATES: Record<string, string[]> = {
  'Site walk': [
    'Emergency egress routes clear', 'First aid kit stocked and accessible',
    'Fire extinguishers in date', 'Edge protection in place',
    'Housekeeping in laydown areas', 'Hi-vis worn by all on site',
    'SWMS available at work face', 'Toolbox talk record complete',
  ],
  'Plant inspection': [
    'Operator licence sighted', 'Pre-start log completed', 'Hydraulic leaks — none',
    'Mirrors and cameras clean', 'Reversing alarm operational',
    'Fire extinguisher on board', 'Tyres / tracks in good condition', 'Service log up to date',
  ],
  'Working at height': [
    'EWP pre-start completed', 'Anchor points certified', 'Harnesses inspected and in date',
    'Rescue plan documented', 'Exclusion zone established', 'Tools tethered',
    'Weather conditions acceptable', 'Permit issued',
  ],
};

type CheckItem = { label: string; response: 'pass' | 'fail' | 'na'; notes: string };

export default function InspectionNewScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState('');
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), checklist_items: [] as CheckItem[], notes: '' });

  const pickTpl = (name: string) => {
    setTpl(name);
    setForm(f => ({ ...f, checklist_items: TEMPLATES[name].map(label => ({ label, response: 'pass' as const, notes: '' })) }));
  };

  const updItem = (i: number, patch: Partial<CheckItem>) =>
    setForm(f => ({ ...f, checklist_items: f.checklist_items.map((c, j) => j === i ? { ...c, ...patch } : c) }));

  const save = async () => {
    if (!tpl) { Alert.alert('Error', 'Pick a template first'); return; }
    setBusy(true);
    try {
      const user = await getUser();
      await api.post('/inspections', { ...form, workspace_id: user?.workspace_ids?.[0], template_name: tpl });
      Alert.alert('Success', 'Inspection saved');
      router.back();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  const summary = useMemo(() => {
    const c = form.checklist_items;
    return { pass: c.filter(x => x.response === 'pass').length, fail: c.filter(x => x.response === 'fail').length, na: c.filter(x => x.response === 'na').length };
  }, [form.checklist_items]);

  if (!tpl) {
    return (
      <ScrollView testID="inspection-new" style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.heading}>New Inspection</Text>
        <Text style={s.sub}>Choose a template to start.</Text>
        <View testID="template-picker">
          {Object.keys(TEMPLATES).map(name => (
            <TouchableOpacity
              key={name}
              testID={`tpl-${name.replace(/\s/g, '-').toLowerCase()}`}
              style={s.tplCard}
              onPress={() => pickTpl(name)}
              activeOpacity={0.7}
            >
              <View style={s.tplIcon}>
                <Ionicons name={name === 'Site walk' ? 'walk' : name === 'Plant inspection' ? 'construct' : 'arrow-up'} size={22} color={Colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.tplTitle}>{name}</Text>
                <Text style={s.tplSub}>{TEMPLATES[name].length} checklist items</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView testID="inspection-new" style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.tplHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.tplLabel}>TEMPLATE</Text>
            <Text style={s.tplName}>{tpl}</Text>
          </View>
          <TouchableOpacity onPress={() => { setTpl(''); setForm(f => ({ ...f, checklist_items: [] })); }}>
            <Text style={s.changeLink}>Change</Text>
          </TouchableOpacity>
        </View>

        <View style={s.card}>
          <Text style={s.label}>Date *</Text>
          <TextInput testID="insp-date" style={s.input} value={form.date} onChangeText={v => setForm({ ...form, date: v })} placeholderTextColor={Colors.textTertiary} />
        </View>

        <View style={s.checklistCard}>
          {form.checklist_items.map((item, i) => (
            <View key={i} testID={`insp-item-${i}`} style={[s.checkItem, i > 0 && s.checkItemBorder]}>
              <Text style={s.checkLabel}>{item.label}</Text>
              <View style={s.responseRow}>
                {(['pass', 'fail', 'na'] as const).map(r => (
                  <TouchableOpacity
                    key={r}
                    testID={`insp-${i}-${r}`}
                    style={[
                      s.respBtn,
                      item.response === r && (
                        r === 'pass' ? s.respPass :
                        r === 'fail' ? s.respFail :
                        s.respNA
                      ),
                    ]}
                    onPress={() => updItem(i, { response: r })}
                  >
                    <Text style={[
                      s.respText,
                      item.response === r && (
                        r === 'pass' ? s.respPassText :
                        r === 'fail' ? s.respFailText :
                        s.respNAText
                      ),
                    ]}>
                      {r === 'na' ? 'N/A' : r.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {item.response !== 'pass' && (
                <TextInput
                  testID={`insp-${i}-notes`}
                  style={[s.input, { marginTop: 8 }]}
                  placeholder="Notes (required for fail)"
                  placeholderTextColor={Colors.textTertiary}
                  value={item.notes}
                  onChangeText={v => updItem(i, { notes: v })}
                />
              )}
            </View>
          ))}
        </View>

        <View style={s.card}>
          <Text style={s.label}>Inspector notes</Text>
          <TextInput style={[s.input, { minHeight: 50, textAlignVertical: 'top' }]} value={form.notes} onChangeText={v => setForm({ ...form, notes: v })} multiline placeholderTextColor={Colors.textTertiary} />
        </View>

        <View style={s.summaryRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.summaryText}>
              <Text style={{ color: Colors.emeraldDark, fontWeight: '600' }}>{summary.pass}</Text> pass ·{' '}
              <Text style={{ color: summary.fail > 0 ? Colors.red : Colors.textSecondary, fontWeight: summary.fail > 0 ? '600' : '400' }}>{summary.fail}</Text> fail ·{' '}
              {summary.na} N/A
            </Text>
          </View>
          <View style={s.btnRow}>
            <GhostButton testID="insp-cancel" onPress={() => router.back()}>Cancel</GhostButton>
            <PrimaryButton testID="insp-submit" onPress={save} busy={busy}>Save</PrimaryButton>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2, marginBottom: 16 },
  tplCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: 16, marginBottom: 10,
  },
  tplIcon: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  tplTitle: { fontSize: 16, fontWeight: '600', color: Colors.ink },
  tplSub: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  tplHeader: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 12,
  },
  tplLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary, textTransform: 'uppercase' },
  tplName: { fontSize: 16, fontWeight: '600', color: Colors.ink, marginTop: 2 },
  changeLink: { fontSize: 13, color: Colors.blue, fontWeight: '500' },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '500', color: '#334155', marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text },
  checklistCard: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, overflow: 'hidden', marginBottom: 12 },
  checkItem: { padding: 14 },
  checkItemBorder: { borderTopWidth: 1, borderTopColor: Colors.borderLight },
  checkLabel: { fontSize: 14, fontWeight: '500', color: Colors.ink, marginBottom: 8 },
  responseRow: { flexDirection: 'row', gap: 6 },
  respBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  respPass: { borderColor: '#A7F3D0', backgroundColor: Colors.mint },
  respFail: { borderColor: '#FECACA', backgroundColor: Colors.redSoft },
  respNA: { borderColor: Colors.border, backgroundColor: Colors.bg },
  respText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: Colors.textTertiary, textTransform: 'uppercase' },
  respPassText: { color: Colors.emeraldDark },
  respFailText: { color: Colors.red },
  respNAText: { color: Colors.textSecondary },
  summaryRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginTop: 4 },
  summaryText: { fontSize: 13, color: Colors.textSecondary },
  btnRow: { flexDirection: 'row', gap: 8 },
});
