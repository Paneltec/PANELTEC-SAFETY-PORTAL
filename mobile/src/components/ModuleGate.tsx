// Paneltec Civil · v158 — mobile module gate.
//
// Wrap a screen in <ModuleGate module="forms"> to hide it entirely when
// the calling user's role doesn't have that module toggled on in the
// admin allocator (`/api/settings/mobile-modules`). Shows a friendly
// "module disabled" screen instead of the real content, with a Back
// button so the user isn't stranded.
//
// Companion to `useModule()` in AuthContext — that hook returns a bool;
// this component renders the fallback UI so screens don't have to
// duplicate the same "please contact your admin" JSX.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useModule } from '../lib/AuthContext';
import { ModuleId } from '../lib/modules';
import { Colors } from '../lib/colors';

export function ModuleGate({
  module: moduleId,
  children,
  featureName,
}: {
  module: ModuleId;
  children: React.ReactNode;
  featureName?: string;
}) {
  const enabled = useModule(moduleId);
  if (enabled) return <>{children}</>;
  return <ModuleDisabledScreen featureName={featureName || moduleId} />;
}

export function ModuleDisabledScreen({ featureName }: { featureName: string }) {
  const router = useRouter();
  return (
    <SafeAreaView style={s.root} testID="module-disabled">
      <View style={s.card}>
        <View style={s.iconWrap}>
          <Ionicons name="lock-closed" size={32} color={Colors.orange || '#F97316'} />
        </View>
        <Text style={s.title}>{featureName} is turned off</Text>
        <Text style={s.body}>
          Your administrator hasn't enabled this feature for your role on the mobile app.
          Ask your Paneltec Civil administrator if you need access.
        </Text>
        <TouchableOpacity
          style={s.btn}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/dashboard')}
          testID="module-disabled-back">
          <Text style={s.btnText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 28,
    maxWidth: 420,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    boxShadow: '0 4px 16px rgba(11,18,32,0.08)',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDBA74',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0B1220',
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  btn: {
    backgroundColor: '#F97316',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});

export default ModuleGate;
