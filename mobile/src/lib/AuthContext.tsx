import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AppState, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKEN_KEY, USER_KEY, setForceLogoutHandler } from './api';
import { PermMatrix, getPermissions, setPermissions, clearPermissions, canDo } from './permissions';
import { ModuleMap, SAFE_FALLBACK, fetchModules, getCachedModules, clearModules } from './modules';
import { isPreviewMode, previewToken, previewRole } from './preview';
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
  isPreviewing: boolean;
  previewedRole: string | null;
};

const Ctx = createContext<AuthCtx>({
  isAuth: false, setAuth: () => {}, perms: {},
  refreshPerms: async () => {}, forceLogout: () => {},
  modules: { ...SAFE_FALLBACK }, refreshModules: async () => false, modulesLoading: false,
  isPreviewing: false, previewedRole: null,
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
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewedRole, setPreviewedRole] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);

  const setAuth = useCallback((v: boolean) => setIsAuth(v), []);

  const refreshPerms = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      if (!isPreviewMode) {
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(data));
      }
      const ep = data.effective_permissions || {};
      if (!isPreviewMode) {
        await setPermissions(ep);
      }
      setPermsState(ep);
      if (!isPreviewMode && data.token_version !== undefined) {
        await AsyncStorage.setItem('paneltec_token_version', String(data.token_version));
      }
    } catch {
      // non-fatal
    }
  }, []);

  const refreshModules = useCallback(async (): Promise<boolean> => {
    setModulesLoading(true);
    try {
      const { map, previewed, previewedRole: role } = await fetchModules();
      setModulesState(map);
      setIsPreviewing(previewed);
      setPreviewedRole(role);
      return true;
    } catch {
      return false;
    } finally {
      setModulesLoading(false);
    }
  }, []);

  const forceLogout = useCallback((reason: string) => {
    if (isPreviewMode) return; // Don't force-logout in preview mode
    (async () => {
      await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, 'paneltec_perms', 'paneltec_token_version']);
      await clearModules();
      setPermsState({});
      setModulesState({ ...SAFE_FALLBACK });
      setIsAuth(false);
    })();
    setTimeout(() => { Alert.alert('Session ended', reason); }, 100);
  }, []);

  // Register force-logout handler
  useEffect(() => {
    setForceLogoutHandler(forceLogout);
  }, [forceLogout]);

  // Boot: either preview-mode auto-auth or load cached state
  useEffect(() => {
    if (isPreviewMode && previewToken) {
      // Preview mode: skip storage, just set auth + fetch modules
      setIsAuth(true);
      refreshPerms();
      refreshModules();
    } else {
      // Normal mode: load from cache
      getPermissions().then(p => { if (Object.keys(p).length) setPermsState(p); });
      getCachedModules().then(m => { if (m) setModulesState(m); });
    }
  }, []);

  // Foreground refresh
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
    <Ctx.Provider value={{
      isAuth, setAuth, perms, refreshPerms, forceLogout,
      modules, refreshModules, modulesLoading,
      isPreviewing, previewedRole,
    }}>
      {children}
    </Ctx.Provider>
  );
}
