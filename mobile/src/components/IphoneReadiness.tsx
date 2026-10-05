import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

export default function IphoneReadiness() {
  const [checked, setChecked] = useState(false);
  useEffect(() => { SplashScreen.hideAsync().catch(() => {}); }, []);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <StatusBar style="dark" />
      <Text style={styles.brand}>PANELTEC</Text>
      <Text style={styles.badge}>IPHONE INSTALLATION TEST</Text>
      <Text accessibilityRole="header" style={styles.title}>Your app has opened</Text>
      <Text style={styles.body}>This early build checks installation and opening on your iPhone.</Text>
      <View style={styles.card}>
        <Text style={styles.subtitle}>Server connection pending</Text>
        <Text style={styles.body}>Sign-in, forms and live staff data will become available in a later build once the server address is ready. This version does not save or send work records.</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => setChecked(true)} style={styles.button}>
        <Text style={styles.buttonText}>Test this button</Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{checked ? 'Button responded successfully.' : 'Tap to check that the screen responds.'}</Text>
      <Text style={styles.note}>Installation test 1 · For testing only</Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: '#f6f8fc', padding: 28, paddingTop: 80, paddingBottom: 50, justifyContent: 'center' },
  brand: { color: '#f97316', fontSize: 30, fontWeight: '800', marginBottom: 26 },
  badge: { color: '#475569', fontSize: 12, fontWeight: '700', marginBottom: 16 },
  title: { color: '#0f172a', fontSize: 30, fontWeight: '700', marginBottom: 16 },
  subtitle: { color: '#0f172a', fontSize: 20, fontWeight: '700', marginBottom: 10 },
  body: { color: '#475569', fontSize: 17, lineHeight: 26 },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 16, marginVertical: 24 },
  button: { backgroundColor: '#2563eb', padding: 18, borderRadius: 12, marginBottom: 16 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '700', fontSize: 17 },
  note: { color: '#64748b', fontSize: 13, marginTop: 32 },
});
