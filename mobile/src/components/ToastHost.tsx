// v160.0.11.1 — In-house animated toast host. Subscribes to the toast bus
// in `src/lib/toast.ts`. Mounted once at the root layout so any screen can
// fire `toast.success('…')` and see it float above the current view even
// after `router.back()` unmounts the caller.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { _setToastListener, ToastVariant } from '../lib/toast';
import { Colors } from '../lib/colors';

type Msg = { text: string; variant: ToastVariant };

const AUTO_DISMISS_MS = 2600;

function palette(variant: ToastVariant) {
  if (variant === 'success') {
    return { bg: Colors.imSuccess, border: Colors.emerald, icon: 'checkmark-circle' as const, tint: Colors.emerald };
  }
  if (variant === 'error') {
    return { bg: Colors.imError, border: Colors.red, icon: 'alert-circle' as const, tint: Colors.red };
  }
  return { bg: Colors.imInk, border: Colors.orange, icon: 'information-circle' as const, tint: Colors.orange };
}

export default function ToastHost() {
  const [msg, setMsg] = useState<Msg | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-30)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    _setToastListener((text, variant) => {
      if (timer.current) clearTimeout(timer.current);
      setMsg({ text, variant });
      opacity.setValue(0);
      translateY.setValue(-30);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
      timer.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: -30, duration: 260, useNativeDriver: true }),
        ]).start(({ finished }) => { if (finished) setMsg(null); });
      }, AUTO_DISMISS_MS);
    });
    return () => {
      _setToastListener(null);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [opacity, translateY]);

  if (!msg) return null;
  const p = palette(msg.variant);
  return (
    <View pointerEvents="none" style={s.host}>
      <Animated.View
        testID={`toast-${msg.variant}`}
        style={[
          s.toast,
          { backgroundColor: p.bg, borderColor: p.border, opacity, transform: [{ translateY }] },
        ]}
      >
        <Ionicons name={p.icon} size={22} color={p.tint} />
        <Text style={s.text} numberOfLines={3}>{msg.text}</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  host: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 24,
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 520,
    minWidth: 220,
    shadowColor: Colors.imInk,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  text: {
    color: Colors.imConcrete,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
});
