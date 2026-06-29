import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AppState, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKEN_KEY, USER_KEY, setForceLogoutHandler } from './api';
import { PermMatrix, getPermissions, setPermissions, clearPermissions, canDo, hasAnyCaptureOpen } from './permissions';
import { ModuleMap, SAFE_FALLBACK, fetchModules, getCachedModules, clearModules } from './modules';
import api from './api';

type AuthCtx = {
  isAuth: boolean;
  setAuth: (v: boolean) => void;
  perms: PermMatrix;
  refreshPerms: () => Promise<void>;
  forceLogout: (reason: string) => void;
  modules: ModuleMap;
  refreshModules: () => Promise<boolean>;
  modulesLoading: boolean;
};

const Ctx = createContext<AuthCtx>({
  isAuth: false, setAuth: () => {}, perms: {},
  refreshPerms: async () => {}, forceLogout: () => {},
  modules: { ...SAFE_FALLBACK }, refreshModules: async () => false, modulesLoading: false,
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

/** Hook: check if a specific module is enabled */
export function useModule(moduleId: keyof ModuleMap): boolean {
  const { modules } = useAuth();
  return modules[moduleId] === true;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuth, setIsAuth] = useState(false);
  const [perms, setPermsState] = useState<PermMatrix>({});
  const [modules, setModulesState] = useState<ModuleMap>({ ...SAFE_FALLBACK });
  const [modulesLoading, setModulesLoading] = useState(false);
  const appState = useRef(AppState.currentState);

  const setAuth = useCallback((v: boolean) => setIsAuth(v), []);

  const refreshPerms = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(data));
      const ep = data.effective_permissions || {};
      await setPermissions(ep);
      setPermsState(ep);
      if (data.token_version !== undefined) {
        await AsyncStorage.setItem('paneltec_token_version', String(data.token_version));
      }
    } catch {
      // If /me fails (e.g. 401), the interceptor handles logout
    }
  }, []);

  const refreshModules = useCallback(async (): Promise<boolean> => {
    setModulesLoading(true);
    try {
      const map = await fetchModules();
      setModulesState(map);
      return true;
    } catch {
      // On failure, keep whatever's cached — don't wipe the state
      return false;
    } finally {
      setModulesLoading(false);
    }
  }, []);

  const forceLogout = useCallback((reason: string) => {
    (async () => {
      await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, 'paneltec_perms', 'paneltec_token_version']);
      await clearModules();
      setPermsState({});
      setModulesState({ ...SAFE_FALLBACK });
      setIsAuth(false);
    })();
    setTimeout(() => { Alert.alert('Session ended', reason); }, 100);
  }, []);

  // Register force-logout handler on api interceptor
  useEffect(() => {
    setForceLogoutHandler(forceLogout);
  }, [forceLogout]);

  // Load cached perms + modules on mount
  useEffect(() => {
    getPermissions().then(p => { if (Object.keys(p).length) setPermsState(p); });
    getCachedModules().then(m => { if (m) setModulesState(m); });
  }, []);

  // Refresh perms + modules on app foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active' && isAuth) {
        refreshPerms();
        refreshModules();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [isAuth, refreshPerms, refreshModules]);

  return (
    <Ctx.Provider value={{ isAuth, setAuth, perms, refreshPerms, forceLogout, modules, refreshModules, modulesLoading }}>
      {children}
    </Ctx.Provider>
  );
}
