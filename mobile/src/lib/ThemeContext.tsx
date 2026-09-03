/**
 * ThemeContext — v160.3.9.58.13.96
 *
 * Provides runtime palette switching. On mount reads the saved palette
 * from AsyncStorage and applies it to the mutable `Colors` object.
 * Exposes `switchPalette()` for the Settings screen palette picker.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, applyPalette } from './colors';
import { PALETTES, PALETTE_META, type PaletteId } from './palettes';

const STORAGE_KEY = 'paneltec_palette_id';

interface ThemeCtx {
  paletteId: PaletteId;
  switchPalette: (id: PaletteId) => Promise<void>;
}

const ThemeContext = createContext<ThemeCtx>({
  paletteId: 'modern_light',
  switchPalette: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [paletteId, setPaletteId] = useState<PaletteId>('modern_light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved && PALETTES[saved as PaletteId]) {
          const id = saved as PaletteId;
          setPaletteId(id);
          applyPalette(PALETTES[id]);
        }
      } catch {}
      setReady(true);
    })();
  }, []);

  const switchPalette = useCallback(async (id: PaletteId) => {
    if (!PALETTES[id]) return;
    await AsyncStorage.setItem(STORAGE_KEY, id);
    applyPalette(PALETTES[id]);
    setPaletteId(id);
  }, []);

  // Don't render children until palette is loaded to avoid FOUC
  if (!ready) return null;

  return (
    <ThemeContext.Provider value={{ paletteId, switchPalette }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
