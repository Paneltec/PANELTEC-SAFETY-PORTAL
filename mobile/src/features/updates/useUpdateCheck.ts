/**
 * useUpdateCheck — v58.13.132jg
 *
 * Background version check against /api/mobile/downloads/android/version.
 * Compares server version_code (integer) vs installed native versionCode.
 * Stores "dismissed for version X" in AsyncStorage.
 *
 * .132jg fix: check() now returns a CheckResult so callers can await the
 * actual result instead of reading stale closure state via setTimeout.
 * Also adds console.warn logging and clearDismissed() for debugging.
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
  available: boolean;
  serverVersion: string;
  serverBuildCode: number;
  installedBuildCode: number;
  installedVersion: string;
  dismissed: boolean;
  checking: boolean;
  manualError: string | null;
}

/** Result returned by check() so callers can act on it directly. */
export interface CheckResult {
  available: boolean;
  serverVersion: string;
  serverBuildCode: number;
  installedVersion: string;
  installedBuildCode: number;
  error: string | null;
}

function getInstalledBuildCode(): number {
  if (Platform.OS === 'web') return 0;
  const raw = Application.nativeBuildVersion; // android versionCode string
  return raw ? parseInt(raw, 10) || 0 : 0;
}

function getInstalledVersion(): string {
  if (Platform.OS === 'web') return '0.0.0';
  return Application.nativeApplicationVersion || '0.0.0';
}

export function useUpdateCheck() {
  const installedBuildCode = getInstalledBuildCode();
  const installedVersion = getInstalledVersion();

  const [state, setState] = useState<UpdateState>({
    available: false,
    serverVersion: '',
    serverBuildCode: 0,
    installedBuildCode,
    installedVersion,
    dismissed: false,
    checking: false,
    manualError: null,
  });

  /**
   * Core check logic. Returns CheckResult so manual callers can await it.
   * manual=true surfaces errors in state; background failures are silent.
   */
  const check = useCallback(async (manual: boolean): Promise<CheckResult> => {
    if (manual) setState(s => ({ ...s, checking: true, manualError: null }));

    const result: CheckResult = {
      available: false,
      serverVersion: '',
      serverBuildCode: 0,
      installedVersion,
      installedBuildCode,
      error: null,
    };

    try {
      const res = await authGet<VersionResponse>(
        '/api/mobile/downloads/android/version',
        { timeoutMs: 8_000 },
      );

      if (!res.ok) {
        const errMsg = 'error' in res ? (res as any).error : 'Check failed';
        result.error = errMsg;
        if (manual) setState(s => ({ ...s, checking: false, manualError: errMsg }));
        else setState(s => ({ ...s, checking: false }));

        console.warn('[update-check]', {
          manual,
          installedBuildCode,
          installedVersion,
          error: errMsg,
        });
        return result;
      }

      const server = res.data;
      const serverCode = server.version_code || 0;
      const isNewer = serverCode > installedBuildCode;

      result.available = isNewer;
      result.serverVersion = server.version || '';
      result.serverBuildCode = serverCode;

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
        installedVersion,
        dismissed,
        checking: false,
        manualError: null,
      }));

      console.warn('[update-check]', {
        manual,
        installedBuildCode,
        installedVersion,
        serverBuildCode: serverCode,
        serverVersion: server.version,
        hasUpdate: isNewer,
        dismissed,
      });

      return result;
    } catch (e: any) {
      const errMsg = e?.message || 'Network error';
      result.error = errMsg;
      if (manual) setState(s => ({ ...s, checking: false, manualError: errMsg }));
      else setState(s => ({ ...s, checking: false }));

      console.warn('[update-check]', {
        manual,
        installedBuildCode,
        installedVersion,
        error: errMsg,
      });
      return result;
    }
  }, [installedBuildCode, installedVersion]);

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

  /** Manual check (from Settings). Returns the CheckResult directly. */
  const manualCheck = useCallback(() => check(true), [check]);

  /** Clear the dismissed flag and retrigger check. For debug gesture. */
  const clearDismissedAndRecheck = useCallback(async () => {
    await AsyncStorage.removeItem(DISMISSED_KEY);
    setState(s => ({ ...s, dismissed: false }));
    console.warn('[update-check] Cleared dismissed flag, rechecking...');
    return check(true);
  }, [check]);

  /** Background check on mount (fire-and-forget). */
  useEffect(() => {
    check(false);
  }, [check]);

  return {
    ...state,
    dismiss,
    install,
    manualCheck,
    clearDismissedAndRecheck,
  };
}
