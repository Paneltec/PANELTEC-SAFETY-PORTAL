/**
 * Submitted success screen — shown after form submission.
 * v58.13.132k — Tick animation + form name + timestamp + Done / Submit Another.
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../src/theme/colors';

export default function SubmittedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();

  // Entrance animation
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scaleAnim, fadeAnim]);

  const formName = name || 'Form';
  const ts = new Date().toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <View testID="form-submitted-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Submitted</Text>
      </View>

      <View style={s.body}>
        <Animated.View style={[s.checkCircle, { transform: [{ scale: scaleAnim }] }]}>
          <Ionicons name="checkmark" size={48} color={Colors.white} />
        </Animated.View>

        <Animated.View style={[s.textBlock, { opacity: fadeAnim }]}>
          <Text testID="submitted-title" style={s.title}>Form Submitted</Text>
          <Text testID="submitted-form-name" style={s.subtitle}>{formName}</Text>
          <Text testID="submitted-timestamp" style={s.timestamp}>{ts}</Text>

          <View style={s.infoBanner}>
            <Ionicons name="cloud-done-outline" size={20} color={Colors.success} />
            <Text style={s.infoText}>
              Your submission has been recorded and is available to supervisors immediately.
            </Text>
          </View>
        </Animated.View>

        <Animated.View style={[s.actions, { opacity: fadeAnim }]}>
          <TouchableOpacity
            testID="submitted-done-btn"
            style={s.doneBtn}
            onPress={() => router.replace('/(tabs)/forms' as never)}
          >
            <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="submitted-another-btn"
            style={s.anotherBtn}
            onPress={() => {
              if (id) {
                router.replace({ pathname: '/forms/[id]', params: { id } } as never);
              } else {
                router.replace('/(tabs)/forms' as never);
              }
            }}
          >
            <Ionicons name="add-circle-outline" size={20} color={Colors.orange} />
            <Text style={s.anotherBtnText}>Submit Another</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    backgroundColor: Colors.navy, paddingHorizontal: 20, paddingVertical: 16,
    alignItems: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },

  body: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 24,
  },

  checkCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.success,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.success, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },

  textBlock: { alignItems: 'center', gap: 6 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.ink },
  subtitle: { fontSize: 16, fontWeight: '600', color: '#4B4B4B', textAlign: 'center' },
  timestamp: { fontSize: 13, color: '#8A8A8A', marginTop: 2 },

  infoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.successSoft, borderRadius: 14, padding: 14,
    marginTop: 16, maxWidth: 340,
  },
  infoText: { flex: 1, fontSize: 13, color: '#4B4B4B', lineHeight: 18 },

  actions: { width: '100%', maxWidth: 340, gap: 10, marginTop: 8 },
  doneBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 16,
  },
  doneBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },

  anotherBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 16,
    borderWidth: 1.5, borderColor: Colors.orange,
  },
  anotherBtnText: { color: Colors.orange, fontSize: 16, fontWeight: '700' },
});
