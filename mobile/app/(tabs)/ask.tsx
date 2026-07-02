import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import { Colors } from '../../src/lib/colors';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);
const CATEGORIES = ['contractors', 'incidents', 'hazards', 'inspections', 'swms', 'risk', 'other'];

export default function AskScreen() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);

  // Suggestions state
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null); // null | 'new' | suggestion obj
  const [savingForm, setSavingForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canEdit = WRITE_ROLES.has(user?.role);

  useEffect(() => { getUser().then(setUser); }, []);

  const loadHistory = () => api.get('/ask/history', { params: { limit: 10 } }).then(r => setHistory(r.data)).catch(() => {});
  const loadSuggestions = () => {
    api.get('/ask/suggestions')
      .then(r => setSuggestions(r.data || []))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  };

  useEffect(() => { loadHistory(); loadSuggestions(); }, []);

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

  const askFromChip = (question: string) => { setQ(question); submit(question); };

  const saveSuggestion = async (payload: { question: string; category: string | null }) => {
    setSavingForm(true);
    try {
      if (editing === 'new') {
        await api.post('/ask/suggestions', payload);
        Alert.alert('Success', 'Suggestion added');
      } else if (editing?.id) {
        await api.patch(`/ask/suggestions/${editing.id}`, payload);
        Alert.alert('Success', 'Suggestion updated');
      }
      setEditing(null);
      await loadSuggestions();
    } catch (e: any) {
      Alert.alert('Error', apiError(e));
    } finally { setSavingForm(false); }
  };

  const handleDelete = async (s: any, confirm = false, cancel = false) => {
    if (cancel) { setConfirmDeleteId(null); return; }
    if (!confirm) { setConfirmDeleteId(s.id); return; }
    try {
      await api.delete(`/ask/suggestions/${s.id}`);
      Alert.alert('Success', 'Suggestion deleted');
      setConfirmDeleteId(null);
      await loadSuggestions();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
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

            {/* Suggestions row */}
            <View testID="suggestions-row" style={styles.suggestionsWrap}>
              {suggestionsLoading && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <ActivityIndicator size="small" color={Colors.violet} />
                  <Text style={styles.sugLoadingText}>Loading suggestions...</Text>
                </View>
              )}

              {!suggestionsLoading && suggestions.length === 0 && editing !== 'new' && (
                <View testID="suggestions-empty" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.sugEmptyText}>No suggested questions yet{canEdit ? '' : ' — admins can add some'}.</Text>
                  {canEdit && (
                    <TouchableOpacity testID="suggestion-empty-add" onPress={() => setEditing('new')}>
                      <Text style={styles.sugAddLink}>+ Add the first one</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {!suggestionsLoading && suggestions.map((s) => (
                  editing?.id === s.id ? (
                    <SuggestionForm key={s.id} initial={s} busy={savingForm}
                      onSave={saveSuggestion} onCancel={() => setEditing(null)} />
                  ) : confirmDeleteId === s.id ? (
                    <View key={s.id} style={styles.deleteConfirmChip}>
                      <Text style={styles.deleteConfirmText}>Delete?</Text>
                      <TouchableOpacity testID={`suggestion-delete-confirm-${s.id}`}
                        onPress={() => handleDelete(s, true)} style={styles.deleteConfirmYes}>
                        <Ionicons name="checkmark" size={14} color="#7a1f33" />
                      </TouchableOpacity>
                      <TouchableOpacity testID={`suggestion-delete-cancel-${s.id}`}
                        onPress={() => handleDelete(s, false, true)} style={styles.deleteConfirmNo}>
                        <Ionicons name="close" size={14} color={Colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View key={s.id} style={styles.sugChipWrap}>
                      <TouchableOpacity testID={`suggested-${s.id}`} style={styles.chip}
                        onPress={() => askFromChip(s.question)}>
                        <Text style={styles.chipText} numberOfLines={1}>{s.question}</Text>
                      </TouchableOpacity>
                      {canEdit && (
                        <View style={styles.chipActions}>
                          <TouchableOpacity testID={`suggestion-edit-${s.id}`}
                            onPress={() => { setConfirmDeleteId(null); setEditing(s); }}
                            style={styles.chipActionBtn}>
                            <Ionicons name="pencil" size={10} color={Colors.violet} />
                          </TouchableOpacity>
                          <TouchableOpacity testID={`suggestion-delete-${s.id}`}
                            onPress={() => handleDelete(s)}
                            style={styles.chipActionBtn}>
                            <Ionicons name="close" size={10} color={Colors.red} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )
                ))}

                {editing === 'new' && (
                  <SuggestionForm initial={null} busy={savingForm}
                    onSave={saveSuggestion} onCancel={() => setEditing(null)} />
                )}

                {canEdit && !suggestionsLoading && editing !== 'new' && suggestions.length > 0 && (
                  <TouchableOpacity testID="suggestion-add-btn" style={styles.addSugChip}
                    onPress={() => { setConfirmDeleteId(null); setEditing('new'); }}>
                    <Ionicons name="add" size={12} color={Colors.violet} />
                    <Text style={styles.addSugText}>Add question</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>

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

/* ─── Inline suggestion form ─── */
function SuggestionForm({ initial, busy, onSave, onCancel }: any) {
  const [question, setQuestion] = useState(initial?.question || '');
  const [category, setCategory] = useState(initial?.category || '');
  const [catOpen, setCatOpen] = useState(false);
  const canSave = question.trim().length >= 3 && !busy;

  return (
    <View testID="suggestion-form" style={styles.sugForm}>
      <TextInput
        testID="suggestion-question-input"
        style={styles.sugFormInput}
        value={question}
        onChangeText={setQuestion}
        placeholder="Suggested question..."
        placeholderTextColor={Colors.textTertiary}
        maxLength={240}
        autoFocus
      />
      <TouchableOpacity testID="suggestion-category-select" style={styles.sugCatBtn} onPress={() => setCatOpen(true)}>
        <Text style={styles.sugCatText}>{category || 'No category'}</Text>
        <Ionicons name="chevron-down" size={10} color={Colors.textTertiary} />
      </TouchableOpacity>
      <TouchableOpacity testID="suggestion-save" style={[styles.sugSaveBtn, !canSave && { opacity: 0.4 }]}
        onPress={() => canSave && onSave({ question: question.trim(), category: category.trim() || null })} disabled={!canSave}>
        {busy ? <ActivityIndicator size="small" color="#10B981" /> : <Ionicons name="checkmark" size={14} color="#10B981" />}
      </TouchableOpacity>
      <TouchableOpacity testID="suggestion-cancel" style={styles.sugCancelBtn} onPress={onCancel}>
        <Ionicons name="close" size={14} color={Colors.textTertiary} />
      </TouchableOpacity>

      <Modal visible={catOpen} transparent animationType="fade" onRequestClose={() => setCatOpen(false)}>
        <TouchableOpacity style={styles.catOverlay} activeOpacity={1} onPress={() => setCatOpen(false)}>
          <View style={styles.catBox}>
            <Text style={styles.catTitle}>Category</Text>
            <TouchableOpacity style={styles.catItem} onPress={() => { setCategory(''); setCatOpen(false); }}>
              <Text style={[styles.catItemText, !category && { fontWeight: '700', color: Colors.violet }]}>No category</Text>
            </TouchableOpacity>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c} style={styles.catItem} onPress={() => { setCategory(c); setCatOpen(false); }}>
                <Text style={[styles.catItemText, category === c && { fontWeight: '700', color: Colors.violet }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.violet },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.ink, marginTop: 4, letterSpacing: 1 },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4, marginBottom: 16 },
  inputCard: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)',
    borderRadius: 16, padding: 16, marginBottom: 16,
  },
  input: {
    backgroundColor: Colors.surfaceLight, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: Colors.text, minHeight: 70, textAlignVertical: 'top',
  },
  // Suggestions
  suggestionsWrap: { marginTop: 12, minHeight: 36 },
  sugLoadingText: { fontSize: 11, color: Colors.textTertiary },
  sugEmptyText: { fontSize: 11, color: Colors.textTertiary },
  sugAddLink: { fontSize: 11, fontWeight: '600', color: Colors.violet },
  sugChipWrap: { flexDirection: 'row', alignItems: 'center', marginRight: 6, marginBottom: 4 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.3)', backgroundColor: Colors.violetSoft,
  },
  chipText: { fontSize: 12, color: Colors.violet, maxWidth: 220 },
  chipActions: { flexDirection: 'row', marginLeft: 2 },
  chipActionBtn: { padding: 4 },
  addSugChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.violet, marginBottom: 4,
  },
  addSugText: { fontSize: 11, color: Colors.violet, fontWeight: '500' },
  deleteConfirmChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20,
    backgroundColor: Colors.redSoft, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', marginRight: 6, marginBottom: 4,
  },
  deleteConfirmText: { fontSize: 10, fontWeight: '600', color: Colors.red },
  deleteConfirmYes: { padding: 3 },
  deleteConfirmNo: { padding: 3 },
  // Suggestion form
  sugForm: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.violet, borderRadius: 20,
    backgroundColor: Colors.surfaceLight, paddingHorizontal: 6, paddingVertical: 4,
    marginRight: 6, marginBottom: 4,
  },
  sugFormInput: { fontSize: 12, color: Colors.text, width: 180, paddingHorizontal: 6, paddingVertical: 4 },
  sugCatBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, paddingVertical: 4 },
  sugCatText: { fontSize: 10, color: Colors.textSecondary },
  sugSaveBtn: { padding: 4 },
  sugCancelBtn: { padding: 4 },
  catOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  catBox: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, width: '100%', maxWidth: 260, borderWidth: 1, borderColor: Colors.border },
  catTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink, marginBottom: 8 },
  catItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  catItemText: { fontSize: 14, color: Colors.text },
  // Submit
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.violet, borderRadius: 10, paddingVertical: 12, marginTop: 12, minHeight: 48,
  },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  // Answer
  answerCard: {
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)', borderRadius: 16, padding: 16,
    backgroundColor: Colors.violetSoft, marginBottom: 16,
  },
  answerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  answerOverline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: Colors.violet },
  confBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: Colors.surface },
  confDot: { width: 6, height: 6, borderRadius: 3 },
  confText: { fontSize: 10, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase' },
  answerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  answerBody: { fontSize: 14, color: Colors.textSecondary, marginTop: 6, lineHeight: 20 },
  evidenceWrap: { marginTop: 12 },
  evidenceLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textTertiary, marginBottom: 6 },
  evidenceChip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10,
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)', borderRadius: 10, backgroundColor: Colors.surface, marginBottom: 6,
  },
  evidenceType: {
    fontSize: 9, fontWeight: '700', color: Colors.violet, backgroundColor: Colors.violetSoft,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  evidenceText: { fontSize: 12, color: Colors.textSecondary, flex: 1, lineHeight: 16 },
  // History
  historySection: { marginTop: 16 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: Colors.textTertiary, marginBottom: 10 },
  historyCard: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  historyDate: { fontSize: 11, color: Colors.textTertiary },
  historyQ: { fontSize: 14, fontWeight: '500', color: Colors.ink, marginTop: 4 },
  historyA: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
});
