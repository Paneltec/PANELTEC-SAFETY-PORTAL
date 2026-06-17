import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';

const SUGGESTED = [
  "Which contractors have docs expiring this month?",
  "What are the recurring incident categories?",
  "Show me open hazards by severity.",
  "Which inspections are overdue?",
];

export default function AskScreen() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  const loadHistory = () => api.get('/ask/history', { params: { limit: 10 } }).then(r => setHistory(r.data)).catch(() => {});
  useEffect(() => { loadHistory(); }, []);

  const submit = async (question?: string) => {
    const ask = question || q;
    if (!ask.trim()) return;
    setBusy(true); setAnswer(null);
    try {
      const { data } = await api.post('/ask', { question: ask });
      setAnswer(data);
      loadHistory();
    } catch (e: any) {
      setAnswer({ title: 'Error', body: apiError(e), confidence: 'low' });
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView testID="ask-page" style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.overline}>ASK INTELLIGENCE</Text>
          <Text style={styles.heading}>Ask Intelligence</Text>
          <Text style={styles.sub}>Natural-language Q&A grounded in your own records.</Text>

          <View style={styles.inputCard}>
            <TextInput
              testID="ask-input"
              style={styles.input}
              value={q}
              onChangeText={setQ}
              placeholder="Ask anything about your safety records..."
              placeholderTextColor={Colors.textTertiary}
              multiline
              numberOfLines={3}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestedRow}>
              {SUGGESTED.map((s, i) => (
                <TouchableOpacity key={i} testID={`suggested-${i}`} style={styles.chip} onPress={() => { setQ(s); submit(s); }}>
                  <Text style={styles.chipText} numberOfLines={1}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              testID="ask-submit"
              style={[styles.submitBtn, busy && { opacity: 0.6 }]}
              onPress={() => submit()}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="sparkles" size={14} color="#fff" />
                  <Text style={styles.submitText}>Ask</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {answer && (
            <View testID="ask-answer" style={styles.answerCard}>
              <View style={styles.answerHeader}>
                <Text style={styles.answerOverline}>INTELLIGENCE BRIEFING</Text>
                <View style={styles.confBadge}>
                  <View style={[styles.confDot, { backgroundColor: answer.confidence === 'high' ? Colors.emerald : Colors.amber }]} />
                  <Text style={styles.confText}>{answer.confidence}</Text>
                </View>
              </View>
              <Text style={styles.answerTitle}>{answer.title}</Text>
              <Text style={styles.answerBody}>{answer.body}</Text>
              {answer.cited_evidence?.length > 0 && (
                <View style={styles.evidenceWrap}>
                  <Text style={styles.evidenceLabel}>CITED EVIDENCE</Text>
                  {answer.cited_evidence.slice(0, 3).map((c: any, i: number) => (
                    <View key={i} style={styles.evidenceChip}>
                      <Text style={styles.evidenceType}>{c.record_type}</Text>
                      <Text style={styles.evidenceText}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {history.length > 0 && (
            <View style={styles.historySection}>
              <Text style={styles.sectionLabel}>RECENT QUESTIONS</Text>
              {history.map((h: any) => (
                <View key={h.id} testID={`history-${h.id}`} style={styles.historyCard}>
                  <Text style={styles.historyDate}>{(h.created_at || '').slice(0, 16).replace('T', ' ')}</Text>
                  <Text style={styles.historyQ}>{h.question}</Text>
                  {h.answer?.body && <Text style={styles.historyA} numberOfLines={2}>{h.answer.body}</Text>}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.violet },
  heading: { fontSize: 28, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4, marginBottom: 16 },
  inputCard: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: '#DDD6FE',
    borderRadius: 16, padding: 16, marginBottom: 16,
  },
  input: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: Colors.text, minHeight: 70, textAlignVertical: 'top',
  },
  suggestedRow: { marginTop: 12 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
    borderColor: '#DDD6FE', marginRight: 8, backgroundColor: Colors.violetSoft,
  },
  chipText: { fontSize: 12, color: Colors.violet },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.violet, borderRadius: 10, paddingVertical: 12, marginTop: 12, minHeight: 48,
  },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  answerCard: {
    borderWidth: 2, borderColor: '#DDD6FE', borderRadius: 16, padding: 16,
    backgroundColor: '#F5F3FF', marginBottom: 16,
  },
  answerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  answerOverline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.violet },
  confBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#fff' },
  confDot: { width: 6, height: 6, borderRadius: 3 },
  confText: { fontSize: 10, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase' },
  answerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  answerBody: { fontSize: 14, color: '#475569', marginTop: 6, lineHeight: 20 },
  evidenceWrap: { marginTop: 12 },
  evidenceLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textTertiary, marginBottom: 6 },
  evidenceChip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10,
    borderWidth: 1, borderColor: '#DDD6FE', borderRadius: 10, backgroundColor: '#fff', marginBottom: 6,
  },
  evidenceType: {
    fontSize: 9, fontWeight: '700', color: Colors.violet, backgroundColor: Colors.violetSoft,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  evidenceText: { fontSize: 12, color: '#475569', flex: 1, lineHeight: 16 },
  historySection: { marginTop: 16 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.textTertiary, marginBottom: 10 },
  historyCard: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  historyDate: { fontSize: 11, color: Colors.textTertiary },
  historyQ: { fontSize: 14, fontWeight: '500', color: Colors.ink, marginTop: 4 },
  historyA: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
});
