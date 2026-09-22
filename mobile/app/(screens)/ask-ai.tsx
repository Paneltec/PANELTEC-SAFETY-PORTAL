/**
 * Ask AI — v58.13.132kr
 * Wired to POST /api/mobile/ai/ask (real endpoint).
 * Handles 429 rate limit with retry-after countdown.
 * Added back arrow + X close buttons in header.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { clearSession } from '../../src/services/auth';
import { authPost } from '../../src/services/apiClient';

const SUGGESTIONS = [
  'What pre-starts are due today?',
  'Show my expiring certifications',
  'Any open hazards on my sites?',
  'Summarise yesterday\u0027s incidents',
];

interface AskResponse {
  answer: string;
  sources: string[];
}

export default function AskAIScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const startCountdown = useCallback((seconds: number) => {
    setRateLimitCountdown(seconds);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setRateLimitCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleSend = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    if (rateLimitCountdown > 0) return;

    setLoading(true);
    setError('');
    setResponse(null);
    setSources([]);

    const res = await authPost<AskResponse>('/api/mobile/ai/ask', { prompt: q });

    if (res.ok) {
      setResponse(res.data.answer);
      setSources(res.data.sources || []);
      setQuery('');
    } else if ('expired' in res && res.expired) {
      await clearSession();
      router.replace('/(auth)/pin-entry');
    } else if ('rateLimited' in res && res.rateLimited) {
      startCountdown(res.retryAfter || 30);
      setError(`Rate limited. Try again in ${res.retryAfter || 30}s.`);
    } else {
      setError('error' in res ? res.error : 'Request failed');
    }
    setLoading(false);
  }, [query, rateLimitCountdown, router, startCountdown]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View testID="ask-ai-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity
            testID="ask-ai-back-btn"
            style={s.headerBtn}
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color={Colors.white} />
          </TouchableOpacity>
          <Ionicons name="sparkles" size={20} color={Colors.orange} />
          <Text style={s.headerTitle}>Ask AI</Text>
          <TouchableOpacity
            testID="ask-ai-close-btn"
            style={s.headerBtn}
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={22} color={Colors.white} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color={Colors.orange} />
              <Text style={s.loadingText}>Thinking...</Text>
            </View>
          ) : response ? (
            <View style={s.responseCard}>
              <View style={s.responseHeader}>
                <Ionicons name="sparkles" size={16} color={Colors.orange} />
                <Text style={s.responseLabel}>AI Response</Text>
              </View>
              <Text style={s.responseText}>{response}</Text>
              {sources.length > 0 && (
                <View style={s.sourcesSection}>
                  <Text style={s.sourcesLabel}>Sources</Text>
                  {sources.map((src, i) => (
                    <Text key={i} style={s.sourceText}>• {src}</Text>
                  ))}
                </View>
              )}
              <TouchableOpacity testID="ai-clear-btn" style={s.clearBtn} onPress={() => { setResponse(null); setSources([]); }}>
                <Text style={s.clearBtnText}>Ask another question</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={s.welcomeSection}>
                <View style={s.aiCircle}>
                  <Ionicons name="sparkles" size={36} color={Colors.orange} />
                </View>
                <Text style={s.welcomeTitle}>Intelligence Assistant</Text>
                <Text style={s.welcomeSub}>
                  Ask questions about your compliance data, site status, certifications, and more.
                </Text>
              </View>

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
          )}

          {error ? (
            <View style={s.errorBanner}>
              <Ionicons name="alert-circle" size={14} color={Colors.error} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          {rateLimitCountdown > 0 && (
            <View style={s.countdownBanner}>
              <Ionicons name="timer-outline" size={16} color={Colors.warning} />
              <Text style={s.countdownText}>Rate limit — retry in {rateLimitCountdown}s</Text>
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
            editable={!loading && rateLimitCountdown === 0}
          />
          <TouchableOpacity
            testID="ai-send-btn"
            style={[s.sendBtn, (!query.trim() || loading || rateLimitCountdown > 0) && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!query.trim() || loading || rateLimitCountdown > 0}
          >
            {loading ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="send" size={18} color={Colors.white} />
            )}
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
  headerBtn: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  scrollContent: { padding: 16, paddingBottom: 100 },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '600' },

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
  sourcesSection: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  sourcesLabel: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  sourceText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  clearBtn: { alignSelf: 'center', marginTop: 16 },
  clearBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orange, textDecorationLine: 'underline' },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEE2E2', borderRadius: 10, padding: 10, marginTop: 12,
    borderWidth: 1, borderColor: '#FECACA',
  },
  errorText: { fontSize: 11, fontWeight: '600', color: '#DC2626', flex: 1 },

  countdownBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.warningSoft, borderRadius: 10, padding: 10, marginTop: 8,
    borderWidth: 1, borderColor: '#F59E0B30',
  },
  countdownText: { fontSize: 11, fontWeight: '700', color: Colors.warning },

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
});
