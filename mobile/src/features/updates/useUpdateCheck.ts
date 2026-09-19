/**
 * useUpdateCheck — v58.13.132ja
 *
 * Background version check against /api/mobile/downloads/android/version.
 * Compares server version_code vs installed native versionCode.
 * Stores "dismissed for version X" in AsyncStorage.
 */
import { useState, useEffect, useCallback } from 'react';
import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { authGet } from '../../services/apiClient';

const DISMISSED_KEY = 'paneltec_update_dismissed_version';
const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

interface VersionResponse {
  available: boolean;
  version: string;
  version_code: number;
  size_bytes: number;
  sha256: string;
  eas_build_id: string;
  built_at: string;
}

export interface UpdateState {
  /** Whether a newer version is available on server. */
  available: boolean;
  /** Server version label (e.g. "1.0.18"). */
  serverVersion: string;
  /** Server build number. */
  serverBuildCode: number;
  /** Installed build number (native). */
  installedBuildCode: number;
  /** User dismissed this specific version's banner. */
  dismissed: boolean;
  /** Loading state for manual check. */
  checking: boolean;
  /** Error from the last manual check (null = no error / background failures hidden). */
  manualError: string | null;
}

function getInstalledBuildCode(): number {
  if (Platform.OS === 'web') return 0;
  const raw = Application.nativeBuildVersion; // android versionCode string
  return raw ? parseInt(raw, 10) || 0 : 0;
}

export function useUpdateCheck() {
  const installedBuildCode = getInstalledBuildCode();

  const [state, setState] = useState<UpdateState>({
    available: false,
    serverVersion: '',
    serverBuildCode: 0,
    installedBuildCode,
    dismissed: false,
    checking: false,
    manualError: null,
  });

  /** Core check logic. manual=true surfaces errors. */
  const check = useCallback(async (manual: boolean) => {
    if (manual) setState(s => ({ ...s, checking: true, manualError: null }));

    try {
      const res = await authGet<VersionResponse>(
        '/api/mobile/downloads/android/version',
        { timeoutMs: 5_000 },
      );

      if (!res.ok) {
        if (manual) setState(s => ({ ...s, checking: false, manualError: 'error' in res ? res.error : 'Check failed' }));
        else setState(s => ({ ...s, checking: false }));
        return;
      }

      const server = res.data;
      const serverCode = server.version_code || 0;
      const isNewer = serverCode > installedBuildCode;

      // Check if dismissed
      let dismissed = false;
      if (isNewer) {
        const dismissedVer = await AsyncStorage.getItem(DISMISSED_KEY);
        dismissed = dismissedVer === String(serverCode);
      }

      setState(s => ({
        ...s,
        available: isNewer,
        serverVersion: server.version || '',
        serverBuildCode: serverCode,
        dismissed,
        checking: false,
        manualError: null,
      }));
    } catch {
      if (manual) setState(s => ({ ...s, checking: false, manualError: 'Network error' }));
      else setState(s => ({ ...s, checking: false }));
    }
  }, [installedBuildCode]);

  /** Dismiss banner for the current server version. */
  const dismiss = useCallback(async () => {
    await AsyncStorage.setItem(DISMISSED_KEY, String(state.serverBuildCode));
    setState(s => ({ ...s, dismissed: true }));
  }, [state.serverBuildCode]);

  /** Open the APK download URL in the browser. */
  const install = useCallback(() => {
    const url = `${API_BASE}/api/mobile/downloads/android/latest.apk`;
    Linking.openURL(url);
  }, []);

  /** Manual check (from Settings). */
  const manualCheck = useCallback(() => check(true), [check]);

  /** Background check on mount (fire-and-forget). */
  useEffect(() => {
    check(false);
  }, [check]);

  return {
    ...state,
    dismiss,
    install,
    manualCheck,
  };
}
