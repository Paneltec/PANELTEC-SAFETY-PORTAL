/* v155a · Backup admin — shared axios client + auth helpers.
 *
 * Extracted verbatim from the pre-v155a BackupTab.jsx monolith.
 * Paneltec Civil (v143) — the bundle uses absolute `/api/backup/*`
 * paths so we keep a local axios instance whose baseURL points at
 * the app root (not `${BASE}/api` like Civil's shared client).
 * The bearer interceptor mirrors `@/lib/api.js` — no other
 * rewrites needed.
 */
import axios from "axios";
import { TOKEN_KEY, API_BASE } from "../../../../lib/api";

export const api = axios.create({
  baseURL: API_BASE.replace(/\/api$/, ""),
  timeout: 120000,
});
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api/backup";
export const civilToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const authHdr = () => ({ Authorization: `Bearer ${civilToken()}` });
