import React, { createContext, useContext, useState, useCallback } from 'react';

type AuthCtx = { isAuth: boolean; setAuth: (v: boolean) => void; };
const Ctx = createContext<AuthCtx>({ isAuth: false, setAuth: () => {} });

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuth, setIsAuth] = useState(false);
  const setAuth = useCallback((v: boolean) => setIsAuth(v), []);
  return <Ctx.Provider value={{ isAuth, setAuth }}>{children}</Ctx.Provider>;
}
