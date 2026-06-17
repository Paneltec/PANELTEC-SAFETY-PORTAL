import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AppState, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKEN_KEY, USER_KEY, setForceLogoutHandler } from './api';
import { PermMatrix, getPermissions, setPermissions, clearPermissions, canDo, hasAnyCaptureOpen } from './permissions';
import api from './api';

type AuthCtx = {
  isAuth: boolean;
  setAuth: (v: boolean) => void;
  perms: PermMatrix;
  refreshPerms: () => Promise<void>;
  forceLogout: (reason: string) => void;
};

const Ctx = createContext<AuthCtx>({
  isAuth: false, setAuth: () => {}, perms: {},
  refreshPerms: async () => {}, forceLogout: () => {},
});

export const useAuth = () => useContext(Ctx);

/** Convenience hook: can(resource, action) */
export function useCan() {
  const { perms } = useAuth();
  return (resource: string, action: string) => canDo(perms, resource, action);
}

/** Convenience component: only renders children if permission is granted */
export function Can({ resource, action, fallback, children }: {
  resource: string; action: string; fallback?: React.ReactNode; children: React.ReactNode;
}) {
  const can = useCan();
  return can(resource, action) ? <>{children}</> : <>{fallback ?? null}</>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuth, setIsAuth] = useState(false);
  const [perms, setPermsState] = useState<PermMatrix>({});
  const appState = useRef(AppState.currentState);

  const setAuth = useCallback((v: boolean) => setIsAuth(v), []);

  const refreshPerms = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(data));
      const ep = data.effective_permissions || {};
      await setPermissions(ep);
      setPermsState(ep);
      // Store token_version defensively
      if (data.token_version !== undefined) {
        await AsyncStorage.setItem('paneltec_token_version', String(data.token_version));
      }
    } catch {
      // If /me fails (e.g. 401), the interceptor handles logout
    }
  }, []);

  const forceLogout = useCallback((reason: string) => {
    (async () => {
      await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, 'paneltec_perms', 'paneltec_token_version']);
      setPermsState({});
      setIsAuth(false);
    })();
    // Show alert after state update
    setTimeout(() => {
      Alert.alert('Session ended', reason);
    }, 100);
  }, []);

  // Register force-logout handler on api interceptor
  useEffect(() => {
    setForceLogoutHandler(forceLogout);
  }, [forceLogout]);

  // Load cached perms on mount
  useEffect(() => {
    getPermissions().then(p => { if (Object.keys(p).length) setPermsState(p); });
  }, []);

  // Refresh perms on app foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active' && isAuth) {
        refreshPerms();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [isAuth, refreshPerms]);

  return (
    <Ctx.Provider value={{ isAuth, setAuth, perms, refreshPerms, forceLogout }}>
      {children}
    </Ctx.Provider>
  );
}
