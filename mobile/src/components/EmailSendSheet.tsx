import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../lib/api';
import { Colors } from '../lib/colors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  visible: boolean;
  onClose: () => void;
  resourceKind: string;
  recordId: string;
  convenienceEndpoint: string;
  defaultSubject?: string;
  defaultBody?: string;
  defaultRecipients?: string[];
  attachments?: { label: string }[];
};

export default function EmailSendSheet({
  visible, onClose, resourceKind, recordId, convenienceEndpoint,
  defaultSubject = '', defaultBody = '', defaultRecipients = [],
  attachments = [],
}: Props) {
  const [to, setTo] = useState<string[]>(defaultRecipients);
  const [toInput, setToInput] = useState('');
  const [cc, setCc] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultBody);
  const [m365, setM365] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTo(defaultRecipients);
    setSubject(defaultSubject);
    setMessage(defaultBody);
    setCc([]);
    setToInput('');
    setCcInput('');
    api.get('/integrations').then(({ data }) => {
      const m = (data || []).find((x: any) => x.kind === 'microsoft365');
      setM365(m?.status === 'connected');
    }).catch(() => setM365(false));
  }, [visible]);

  const commitEmail = (draft: string, list: string[], set: (v: string[]) => void) => {
    const parts = draft.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean);
    const valid = parts.filter(e => EMAIL_RE.test(e));
    const invalid = parts.filter(e => !EMAIL_RE.test(e));
    if (invalid.length) Alert.alert('Invalid email', invalid.join(', '));
    if (valid.length) set([...list, ...valid.filter(v => !list.includes(v))]);
  };

  const send = async () => {
    if (to.length === 0) { Alert.alert('Error', 'Add at least one recipient'); return; }
    if (!subject.trim()) { Alert.alert('Error', 'Subject required'); return; }
    setBusy(true);
    try {
      const url = convenienceEndpoint.replace('{id}', recordId);
      const { data } = await api.post(url, { to, cc, message });
      const sentNow = data.status === 'sent';
      Alert.alert(
        sentNow ? 'Email sent' : 'Email queued',
        sentNow ? 'Sent via Microsoft 365.' : 'M365 not connected — queued in outbox.',
      );
      onClose();
    } catch (e: any) {
      const msg = apiError(e);
      if (e?.response?.status === 403) Alert.alert('Permission denied', "You don't have permission to email this record.");
      else Alert.alert('Error', msg || 'Failed to send');
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View testID="email-send-modal" style={s.container}>
          <View style={s.header}>
            <View style={s.headerLeft}>
              <View style={s.headerIcon}>
                <Ionicons name="mail" size={16} color={Colors.violet} />
              </View>
              <View>
                <Text style={s.headerTitle}>Send via email</Text>
                <Text style={s.headerSub}>{resourceKind.replace('_', ' ').toUpperCase()}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>TO</Text>
            <View style={s.pillWrap}>
              {to.map(v => (
                <View key={v} style={s.pill}>
                  <Text style={s.pillText}>{v}</Text>
                  <TouchableOpacity onPress={() => setTo(to.filter(x => x !== v))}>
                    <Ionicons name="close-circle" size={14} color={Colors.blue} />
                  </TouchableOpacity>
                </View>
              ))}
              <TextInput
                testID="email-to-input"
                style={s.pillInput}
                value={toInput}
                onChangeText={setToInput}
                onSubmitEditing={() => { commitEmail(toInput, to, setTo); setToInput(''); }}
                onBlur={() => { if (toInput) { commitEmail(toInput, to, setTo); setToInput(''); } }}
                placeholder={to.length === 0 ? 'recipient@example.com' : ''}
                placeholderTextColor={Colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <TouchableOpacity onPress={() => setShowCc(!showCc)} style={s.ccToggle}>
              <Ionicons name={showCc ? 'chevron-down' : 'chevron-forward'} size={12} color={Colors.textTertiary} />
              <Text style={s.ccToggleText}>CC {cc.length > 0 ? `(${cc.length})` : ''}</Text>
            </TouchableOpacity>
            {showCc && (
              <View style={s.pillWrap}>
                {cc.map(v => (
                  <View key={v} style={s.pill}>
                    <Text style={s.pillText}>{v}</Text>
                    <TouchableOpacity onPress={() => setCc(cc.filter(x => x !== v))}>
                      <Ionicons name="close-circle" size={14} color={Colors.blue} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TextInput
                  testID="email-cc-input"
                  style={s.pillInput}
                  value={ccInput}
                  onChangeText={setCcInput}
                  onSubmitEditing={() => { commitEmail(ccInput, cc, setCc); setCcInput(''); }}
                  placeholder="cc@example.com"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            )}

            <Text style={s.label}>SUBJECT</Text>
            <TextInput testID="email-subject-input" style={s.input} value={subject} onChangeText={setSubject} placeholderTextColor={Colors.textTertiary} />

            <Text style={s.label}>MESSAGE</Text>
            <TextInput testID="email-message-input" style={[s.input, { minHeight: 100, textAlignVertical: 'top' }]} value={message} onChangeText={setMessage} multiline placeholder="Add a personal note. Record details are appended automatically." placeholderTextColor={Colors.textTertiary} />

            {attachments.length > 0 && (
              <>
                <Text style={s.label}>ATTACHMENTS</Text>
                <View testID="email-attachments" style={{ gap: 4 }}>
                  {attachments.map((a, i) => (
                    <View key={i} style={s.attachChip}>
                      <Ionicons name="attach" size={12} color={Colors.textTertiary} />
                      <Text style={s.attachText}>{a.label}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {m365 ? (
              <View testID="m365-status" style={s.m365Good}>
                <Ionicons name="checkmark-circle" size={14} color={Colors.emeraldDark} />
                <Text style={s.m365GoodText}>Will send immediately via Microsoft 365.</Text>
              </View>
            ) : (
              <View testID="m365-status" style={s.m365Warn}>
                <Ionicons name="alert-circle" size={14} color={Colors.imBronze} />
                <Text style={s.m365WarnText}>Will queue — Microsoft 365 not connected.</Text>
              </View>
            )}
          </ScrollView>

          <View style={s.footer}>
            <TouchableOpacity testID="email-cancel" style={s.cancelBtn} onPress={onClose}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="email-send-submit" style={[s.sendBtn, (busy || to.length === 0) && { opacity: 0.5 }]} onPress={send} disabled={busy || to.length === 0} activeOpacity={0.7}>
              {busy ? <ActivityIndicator size="small" color={Colors.imSurface} /> : <Ionicons name="send" size={14} color={Colors.imSurface} />}
              <Text style={s.sendText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.violetSoft, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  headerSub: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary },
  closeBtn: { padding: 4 },
  body: { flex: 1, padding: 16 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textTertiary, marginBottom: 6, marginTop: 14 },
  pillWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    padding: 8, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, backgroundColor: Colors.white,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.blueSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
  },
  pillText: { fontSize: 12, color: Colors.blue },
  pillInput: { flex: 1, minWidth: 140, fontSize: 13, color: Colors.text, paddingVertical: 4 },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10, backgroundColor: Colors.white,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: Colors.text,
  },
  ccToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  ccToggleText: { fontSize: 12, color: Colors.textTertiary },
  attachChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  attachText: { fontSize: 12, color: Colors.text },
  m365Good: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, padding: 10, borderRadius: 10, backgroundColor: Colors.mint, borderWidth: 1, borderColor: Colors.emerald },
  m365GoodText: { fontSize: 12, color: Colors.emeraldDark },
  m365Warn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, padding: 10, borderRadius: 10, backgroundColor: Colors.amberSoft, borderWidth: 1, borderColor: Colors.imConcrete },
  m365WarnText: { fontSize: 12, color: Colors.imBronze },
  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.white,
  },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  cancelText: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary },
  sendBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.blue, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  sendText: { fontSize: 14, fontWeight: '600', color: Colors.imSurface },
});
