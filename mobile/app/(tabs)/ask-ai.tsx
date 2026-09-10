/**
 * Ask AI — v58.13.132cz
 * Placeholder for AI assistant.
 * ⚠️ MOCKED: No AI endpoint wired yet.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';

const SUGGESTIONS = [
  'What pre-starts are due today?',
  'Show my expiring certifications',
  'Any open hazards on my sites?',
  'Summarise yesterday\'s incidents',
];

export default function AskAIScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<string | null>(null);

  const handleSend = () => {
    if (!query.trim()) return;
    setResponse(`[MOCKED RESPONSE]\n\nYou asked: "${query}"\n\nThis is a placeholder. The AI assistant endpoint is not yet wired. When connected, it will query your organisation's compliance data and return real-time answers.`);
    setQuery('');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View testID="ask-ai-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Ionicons name="sparkles" size={20} color={Colors.orange} />
          <Text style={s.headerTitle}>Ask AI</Text>
          <View style={s.mockPill}>
            <Text style={s.mockPillText}>MOCKED</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {!response ? (
            <>
              {/* Welcome */}
              <View style={s.welcomeSection}>
                <View style={s.aiCircle}>
                  <Ionicons name="sparkles" size={36} color={Colors.orange} />
                </View>
                <Text style={s.welcomeTitle}>Intelligence Assistant</Text>
                <Text style={s.welcomeSub}>
                  Ask questions about your compliance data, site status, certifications, and more.
                </Text>
              </View>

              {/* Suggestions */}
              <Text style={s.suggestLabel}>SUGGESTED QUESTIONS</Text>
              {SUGGESTIONS.map((q, i) => (
                <TouchableOpacity
                  key={i}
                  testID={`ai-suggestion-${i}`}
                  style={s.suggestionRow}
                  onPress={() => setQuery(q)}
                >
                  <Ionicons name="chatbubble-outline" size={16} color={Colors.orange} />
                  <Text style={s.suggestionText}>{q}</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : (
            <View style={s.responseCard}>
              <View style={s.responseHeader}>
                <Ionicons name="sparkles" size={16} color={Colors.orange} />
                <Text style={s.responseLabel}>AI Response</Text>
              </View>
              <Text style={s.responseText}>{response}</Text>
              <View style={s.mockBadge}>
                <Ionicons name="flask-outline" size={12} color="#DC2626" />
                <Text style={s.mockBadgeText}>No AI endpoint — response is mocked</Text>
              </View>
              <TouchableOpacity testID="ai-clear-btn" style={s.clearBtn} onPress={() => setResponse(null)}>
                <Text style={s.clearBtnText}>Ask another question</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* Input bar */}
        <View style={[s.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            testID="ai-input"
            style={s.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Ask anything about your sites..."
            placeholderTextColor={Colors.textTertiary}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            testID="ai-send-btn"
            style={[s.sendBtn, !query.trim() && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!query.trim()}
          >
            <Ionicons name="send" size={18} color={Colors.white} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  headerTitle: { color: Colors.white, fontSize: 22, fontWeight: '800', flex: 1 },
  mockPill: {
    backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  mockPillText: { fontSize: 8, fontWeight: '800', color: '#DC2626', letterSpacing: 0.5 },

  scrollContent: { padding: 16, paddingBottom: 100 },

  welcomeSection: { alignItems: 'center', paddingVertical: 32 },
  aiCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(249,115,22,0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  welcomeTitle: { fontSize: 20, fontWeight: '800', color: Colors.white, marginBottom: 8 },
  welcomeSub: {
    fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 20,
    maxWidth: 300,
  },

  suggestLabel: {
    color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: '700',
    letterSpacing: 0.8, marginBottom: 8,
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12,
    padding: 14, marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  suggestionText: { fontSize: 13, color: 'rgba(255,255,255,0.7)', flex: 1 },

  responseCard: {
    backgroundColor: Colors.surface, borderRadius: 18, padding: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  responseHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  responseLabel: { fontSize: 13, fontWeight: '700', color: Colors.orange },
  responseText: { fontSize: 14, color: Colors.ink, lineHeight: 22 },
  clearBtn: { alignSelf: 'center', marginTop: 16 },
  clearBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orange, textDecorationLine: 'underline' },

  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 10,
    backgroundColor: 'rgba(15,23,42,0.95)',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    color: Colors.white, fontSize: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },

  mockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEE2E2', borderRadius: 10, padding: 8, marginTop: 12,
    borderWidth: 1, borderColor: '#FECACA',
  },
  mockBadgeText: { fontSize: 10, fontWeight: '700', color: '#DC2626' },
});
