/**
 * useSectionExpansion — AsyncStorage-backed expansion state for SCS sections.
 * v58.13.132kx — Ported from web sessionStorage hook (.132kd).
 * Fresh load → all collapsed. Persisted per-template.
 */
import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function useSectionExpansion(templateId: string | undefined) {
  const storageKey = `scs-expansion-${templateId || 'default'}`;
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((raw) => {
      if (raw) {
        try { setOpenKeys(new Set(JSON.parse(raw))); } catch { /* ignore */ }
      }
    });
  }, [storageKey]);

  const persist = useCallback((next: Set<string>) => {
    AsyncStorage.setItem(storageKey, JSON.stringify(Array.from(next))).catch(() => {});
  }, [storageKey]);

  const toggle = useCallback((key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persist(next);
      return next;
    });
  }, [persist]);

  const setAll = useCallback((keys: string[], isOpen: boolean) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (isOpen) keys.forEach((k) => next.add(k));
      else keys.forEach((k) => next.delete(k));
      persist(next);
      return next;
    });
  }, [persist]);

  return { openKeys, toggle, setAll };
}
