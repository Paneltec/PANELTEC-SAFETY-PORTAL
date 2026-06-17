// Workspace context — selected workspace_id is persisted to localStorage.
// "*" means All workspaces (no filter sent to API).
import React, { createContext, useContext, useEffect, useState } from 'react';
import { getUser } from './auth';

const KEY = 'paneltec_active_workspace';
const Ctx = createContext({ workspaceId: '*', setWorkspaceId: () => {} });

export function WorkspaceProvider({ children }) {
  const [workspaceId, setWorkspaceIdState] = useState(() => localStorage.getItem(KEY) || '*');

  // When the user is known, default to their first workspace (unless they explicitly chose '*')
  useEffect(() => {
    const u = getUser();
    if (!localStorage.getItem(KEY) && u?.workspace_ids?.length) {
      setWorkspaceIdState(u.workspace_ids[0]);
      localStorage.setItem(KEY, u.workspace_ids[0]);
    }
  }, []);

  const setWorkspaceId = (id) => {
    setWorkspaceIdState(id);
    localStorage.setItem(KEY, id);
  };

  return <Ctx.Provider value={{ workspaceId, setWorkspaceId }}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  return useContext(Ctx);
}

// Helper — returns params object that pages spread into axios get
export function wsParams(workspaceId) {
  return workspaceId && workspaceId !== '*' ? { workspace_id: workspaceId } : {};
}
