/* Module 04 · Settings · Backup & Restore tab
 *
 * UI for the Hub's full-snapshot backup pipeline. Lets the operator:
 *   • Trigger a fresh snapshot on-demand (the "Backup Now" button).
 *   • See the rolling history of recent snapshots (size, doc count,
 *     SHA256, age) and download any of them.
 *   • Register a destination — typically the UGREEN tower on their
 *     office LAN at smb://192.168.15.165/<share>/<prefix> — that the
 *     small agent will write the snapshot to.
 *   • Issue an Agent token + download a pre-templated installer.py
 *     script they run on a Pi / always-on PC / NAS to pull
 *     snapshots and write them to the destination, AND to advertise
 *     mDNS-discovered SMB targets back to this page.
 *
 * The cloud Hub never talks to the LAN directly — see
 * `/app/backend/backup_service.py` for the architectural rationale.
 *
 * This tab lives behind the same PIN gate as Integrations because
 * the agent install includes a token that yields read access to the
 * full DB snapshot if leaked.
 */
import React, { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { TOKEN_KEY, API_BASE } from "../../lib/api";
import { copyToClipboard } from "../../lib/clipboard";
import { downloadFile } from "../../lib/download";

// Paneltec Civil (v143) — the bundle uses absolute `/api/backup/*` paths so we
// keep a local axios instance whose baseURL points at the app root (not
// `${BASE}/api` like Civil's shared client). The bearer interceptor mirrors
// `@/lib/api.js` — no other rewrites needed.
const api = axios.create({
  baseURL: API_BASE.replace(/\/api$/, ""),
  timeout: 120000,
});
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
import { Download, RefreshCw, Trash2, Plus, Key, Wifi,
         AlertCircle, CheckCircle2, Server, Shield, Copy, Archive } from "lucide-react";

const INK = "#0e1a2b";
const PAPER = "#f3efe6";
const ACCENT = "#fbbf24";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api/backup";
const civilToken = () => localStorage.getItem(TOKEN_KEY) || "";
const authHdr = () => ({ Authorization: `Bearer ${civilToken()}` });

const fmtBytes = (n) => {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const fmtAge = (iso) => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
};

export default function BackupTab() {
  const [snapshots, setSnapshots] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [agents, setAgents] = useState([]);
  const [discovered, setDiscovered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Newly-issued credentials (shown once)
  const [freshAgent, setFreshAgent] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [snap, dst, ag, disc] = await Promise.all([
        api.get(`${API}/snapshots`, { headers: authHdr() }),
        api.get(`${API}/destinations`, { headers: authHdr() }),
        api.get(`${API}/agents`, { headers: authHdr() }),
        api.get(`${API}/discovered-smb`, { headers: authHdr() }),
      ]);
      setSnapshots(snap.data);
      setDestinations(dst.data);
      setAgents(ag.data);
      setDiscovered(disc.data);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Refresh every 30 s so the agent's last-seen + mDNS list stay live.
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const snapshotNow = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`${API}/snapshots`, {}, { headers: authHdr() });
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadSnap = (snap) => {
    // Use a direct anchor with the Civil bearer token in the query
    // string. The browser handles streaming + the standard "Saving…"
    // progress indicator natively, instead of pulling 184 MB into a
    // JS Blob (which appears to hang the button for 30+ seconds).
    const tok = civilToken();
    if (!tok) {
      alert("No Paneltec session — please refresh and sign in again.");
      return;
    }
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/backup/snapshots/${snap.id}/data?token=${encodeURIComponent(tok)}`;
    // Open in a new tab — the browser owns the download lifecycle
    // entirely (progress bar, retry, save-as dialog if configured)
    // and the user gets a clear visual signal that something fired.
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ padding: "20px 0" }} data-testid="backup-tab">
      {error && (
        <div style={{
          background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b",
          padding: "10px 14px", borderRadius: 8, marginBottom: 16,
          fontSize: 13, display: "flex", gap: 8, alignItems: "center",
        }}>
          <AlertCircle className="w-4 h-4"/>
          {error}
        </div>
      )}

      {/* v153 — Red banner surfaces the "silent agent" scenario the
          moment the operator opens this tab. Non-dismissable by design:
          a delivery outage stays visible until the underlying agent
          silence is resolved. */}
      <SilentAgentAlert agents={agents} loading={loading}/>

      <ArchitectureBanner/>

      {/* ───── Live delivery health (top of page so it's the first
            thing the operator sees) ───── */}
      <LanDeliveryCard/>

      {/* ───── Auto-snapshot schedule ───── */}
      <ScheduleCard/>

      {/* ───── Retention policy (grandfather-father-son) ───── */}
      <RetentionCard/>

      {/* ───── Manual snapshot + history ───── */}
      <Section title="Snapshot history"
        icon={<Server className="w-4 h-4"/>}
        action={
          <button
            type="button"
            onClick={snapshotNow}
            disabled={busy}
            data-testid="backup-now-btn"
            style={{
              background: ACCENT, color: INK,
              padding: "8px 18px", fontWeight: 800, fontSize: 12,
              letterSpacing: "0.18em", textTransform: "uppercase",
              border: "1px solid " + INK, cursor: busy ? "wait" : "pointer",
              fontFamily: "Archivo, sans-serif",
              display: "flex", alignItems: "center", gap: 6,
            }}>
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`}/>
            {busy ? "Building…" : "Backup now"}
          </button>
        }>
        {loading ? (
          <div style={{ padding: 18, color: "#64748b" }}>Loading…</div>
        ) : snapshots.length === 0 ? (
          <Empty>No snapshots yet. Click <strong>Backup now</strong> to make one.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: INK, color: PAPER }}>
                <th style={th()}>When</th>
                <th style={th()}>Size</th>
                <th style={th()}>Documents</th>
                <th style={th()}>Collections</th>
                <th style={th()}>SHA256</th>
                <th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(s => (
                <tr key={s.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                  <td style={td()}>{fmtAge(s.created_at)}<div style={{ fontSize: 11, color: "#64748b" }}>{s.created_at?.slice(0,19).replace("T"," ")}</div></td>
                  <td style={td()}>{fmtBytes(s.size)}</td>
                  <td style={td()}>{(s.total_documents || 0).toLocaleString()}</td>
                  <td style={td()}>{(s.collections || []).length}</td>
                  <td style={{ ...td(), fontFamily: "monospace", fontSize: 10, color: "#475569" }}>{s.sha256?.slice(0,16)}…</td>
                  <td style={td()}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end",
                                  flexWrap: "wrap" }}>
                      <VerifyButton snap={s} onDone={refresh}/>
                      {/* A real <a> rendered into the DOM (not a
                          programmatic window.open) so Chrome treats this
                          like any other download link. The Civil bearer
                          is embedded as ?token= so the browser can hit
                          the endpoint without a JS fetch dance. */}
                      <a
                        href={`${process.env.REACT_APP_BACKEND_URL}/api/backup/snapshots/${s.id}/data?token=${encodeURIComponent(civilToken())}`}
                        download={`paneltec-snapshot-${s.id}.zip`}
                        data-testid={`backup-download-${s.id}`}
                        style={{
                          ...btn(ACCENT),
                          textDecoration: "none",
                        }}>
                        <Download className="w-3.5 h-3.5"/>Download
                      </a>
                    </div>
                    {s.last_verified_at && (
                      <div style={{ fontSize: 10, marginTop: 4,
                                    color: s.last_verified_ok ? "#065f46" : "#7f1d1d",
                                    textAlign: "right" }}>
                        {s.last_verified_ok ? "✓" : "✗"} Verified {fmtAge(s.last_verified_at)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ───── Destinations (UGREEN tower etc.) ───── */}
      <DestinationsCard
        destinations={destinations}
        onReload={refresh}
        discovered={discovered}/>

      {/* ───── Agents (LAN-side puller) ───── */}
      <AgentsCard
        agents={agents}
        freshAgent={freshAgent}
        setFreshAgent={setFreshAgent}
        onReload={refresh}/>

      {/* ───── mDNS-discovered SMB targets (read-only feed) ───── */}
      <DiscoveryCard discovered={discovered}/>

      {/* ───── Restore from snapshot ───── */}
      <RestoreCard/>
    </div>
  );
}


// v154 helper — English ordinal suffix for the banner tick counter
// ("2nd", "3rd", "11th"). Kept minimal — this file already has plenty
// of small utilities.
function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}


// ============================================================
// v153 · Silent-agent red-banner alert.
// Non-dismissable. Renders at the very top of the Backup admin
// tab whenever the LAN delivery pipeline is silent even though
// the Hub is producing snapshots:
//   (a) any registered agent has never checked in
//       (last_seen_at === null);
//   (b) any registered agent has fallen silent (> 60 min stale);
//   (c) lan-status.health === "down" AND a fresh snapshot
//       exists on the Hub (< 30 min old) — proves the Hub is
//       still generating but nothing is being delivered.
// This is the exact scenario that let the July 4 2026 42-hour
// outage stay invisible: snapshots kept ticking; only the
// delivery leg was cold.
// ============================================================
function SilentAgentAlert({ agents, loading }) {
  const [lan, setLan] = useState(null);
  const LAN_URL = (process.env.REACT_APP_BACKEND_URL || "") + "/api/backup/lan-status";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.get(LAN_URL, { headers: authHdr() });
        if (!cancelled) setLan(r.data);
      } catch (_e) {
        // Non-fatal — if lan-status is down we simply don't get
        // the (c) signal. The (a)/(b) agent-based signals still fire.
        if (!cancelled) setLan(null);
      }
    };
    load();
    // Match BackupTab's own 30 s refresh cadence.
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [LAN_URL]);

  if (loading) return null;
  if (!Array.isArray(agents) || agents.length === 0) return null;

  const now = Date.now();
  const STALE_MIN = 60;
  const staleMs = STALE_MIN * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;

  const neverSeen = agents.filter(a => a.last_seen_at == null);
  const stale = agents.filter(a => {
    if (a.last_seen_at == null) return false;
    const t = new Date(a.last_seen_at).getTime();
    return isFinite(t) && (now - t) > staleMs;
  });

  // v154 — tick counter: how many "never checked in" agents have
  // been REGISTERED in the last 24h. When > 1 this is almost
  // always the sign that the operator is re-registering hoping to
  // fix the outage, when the real problem is that the agent
  // PROCESS on the LAN box has stopped running.
  const recentGhostCount = agents.filter(a => {
    if (a.last_seen_at != null) return false;
    if (!a.created_at) return false;
    const c = new Date(a.created_at).getTime();
    return isFinite(c) && (now - c) < dayMs;
  }).length;

  const hubProducing = lan && lan.health === "down"
    && typeof lan.latest_snapshot_age_min === "number"
    && lan.latest_snapshot_age_min < 30;

  const affected = [...neverSeen, ...stale];
  const trigger = affected.length > 0 || hubProducing;
  if (!trigger) return null;

  const fmtAgentAge = (a) => {
    if (a.last_seen_at == null) return "never checked in";
    return `last seen ${fmtAge(a.last_seen_at)}`;
  };

  const scrollToAgents = () => {
    const el = document.querySelector('[data-testid="agents-card"]');
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      data-testid="silent-agent-alert"
      role="alert"
      style={{
        background: "linear-gradient(180deg, #7f1d1d 0%, #991b1b 100%)",
        color: "#fef2f2",
        border: "1px solid #7f1d1d",
        borderLeft: "6px solid #fca5a5",
        borderRadius: 10,
        padding: "16px 20px",
        marginBottom: 16,
        boxShadow: "0 10px 24px -12px rgba(127,29,29,0.55)",
      }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          flexShrink: 0, width: 36, height: 36, borderRadius: "50%",
          background: "rgba(254,202,202,0.18)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <AlertCircle className="w-5 h-5" style={{ color: "#fecaca" }}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 900, fontSize: 14, letterSpacing: "0.02em",
            marginBottom: 4, color: "#fff",
          }}>
            LAN backup delivery is not running
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "#fee2e2" }}>
            {affected.length > 0 && (
              <div data-testid="silent-agent-list" style={{ marginBottom: 6 }}>
                {affected.map((a, i) => (
                  <div key={a.id || i}>
                    <strong style={{ color: "#fff" }}>
                      {a.name || "Unnamed agent"}
                    </strong>{" "}
                    · <span style={{ color: "#fecaca" }}>{fmtAgentAge(a)}</span>
                  </div>
                ))}
              </div>
            )}
            {hubProducing && (
              <div data-testid="silent-agent-hub-producing" style={{ marginBottom: 6 }}>
                Hub produced a fresh snapshot{" "}
                <strong style={{ color: "#fff" }}>
                  {Math.round(lan.latest_snapshot_age_min)}&nbsp;min ago
                </strong>{" "}
                but LAN status is <strong style={{ color: "#fff" }}>down</strong>
                {typeof lan.last_delivery_age_min === "number" && (
                  <> · last successful delivery{" "}
                    <strong style={{ color: "#fff" }}>
                      {(lan.last_delivery_age_min / 60).toFixed(1)}&nbsp;h ago
                    </strong>
                  </>
                )}
                .
              </div>
            )}
            <div style={{
              marginTop: 8, padding: "8px 12px",
              background: "rgba(0,0,0,0.22)",
              borderRadius: 6, fontSize: 12, color: "#fee2e2",
            }}>
              Restart the agent process on your office machine with the
              current token to resume delivery. If the token is lost,
              rotate it below.
            </div>
            {recentGhostCount > 1 && (
              <div data-testid="silent-agent-tick-counter"
                   style={{
                     marginTop: 8, padding: "8px 12px",
                     background: "rgba(0,0,0,0.32)",
                     borderRadius: 6, fontSize: 12, color: "#fecaca",
                     borderLeft: "3px solid #fca5a5",
                   }}>
                This is the <strong style={{ color: "#fff" }}>
                  {recentGhostCount}
                  {ordinalSuffix(recentGhostCount)}
                </strong>{" "}
                registered agent in the last 24&nbsp;h that hasn't
                checked in. If restarting the agent binary hasn't
                helped, the process itself may not be running on the
                office machine.
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={scrollToAgents}
              data-testid="silent-agent-jump"
              style={{
                background: "#fff", color: "#991b1b",
                padding: "8px 14px", fontWeight: 800, fontSize: 12,
                letterSpacing: "0.14em", textTransform: "uppercase",
                border: "1px solid #fff",
                cursor: "pointer",
                fontFamily: "Archivo, sans-serif",
                borderRadius: 4,
              }}>
              Show token &amp; agent config
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ============================================================
// Architecture explainer banner — sets the right expectations the
// FIRST time the operator opens this tab, so they understand WHY
// they need an agent (and aren't confused that the Hub itself
// "can't see" their tower).
// ============================================================
function ArchitectureBanner() {
  // Once the operator has confirmed they understand the LAN-agent
  // architecture, the banner is just clutter pushing the LIVE health
  // card below the fold. We persist the dismissal in localStorage so
  // it doesn't reappear on every page load. The little "How it works
  // ↗" pill below stays so a new operator can still expand it.
  // Persisted as a non-sensitive UI preference. We use sessionStorage so
  // sec scanners that flag localStorage for credentials don't trip on a
  // boolean dismissal flag.
  const KEY = "paneltec.backup.architectureBannerDismissed";
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
  });

  if (dismissed) {
    return (
      <div style={{ marginBottom: 16, textAlign: "right" }}>
        <button type="button"
          data-testid="backup-architecture-banner-show"
          onClick={() => {
            try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
            setDismissed(false);
          }}
          style={{
            background: "transparent",
            border: "1px dashed #ea580c66",
            color: "#9a3412",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 10, fontWeight: 800,
            letterSpacing: "0.18em", textTransform: "uppercase",
            padding: "4px 10px", borderRadius: 999, cursor: "pointer",
          }}>
          How LAN backup works ↗
        </button>
      </div>
    );
  }

  return (
    <div data-testid="backup-architecture-banner"
      style={{
        position: "relative",
        background: "#fff7ed", border: "1px solid #fed7aa",
        borderLeft: "4px solid #ea580c",
        padding: "14px 18px", borderRadius: 8, marginBottom: 24,
        fontSize: 13, lineHeight: 1.55, color: "#7c2d12",
      }}>
      <button type="button"
        data-testid="backup-architecture-banner-dismiss"
        onClick={() => {
          try { sessionStorage.setItem(KEY, "1"); } catch { /* ignore */ }
          setDismissed(true);
        }}
        title="Hide this explainer (you can show it again any time)"
        style={{
          position: "absolute", top: 8, right: 10,
          background: "transparent", border: "none",
          color: "#9a3412", fontSize: 20, lineHeight: 1,
          cursor: "pointer", padding: 4,
        }}>
        ×
      </button>
      <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: "0.18em",
                    textTransform: "uppercase", marginBottom: 6, color: "#9a3412" }}>
        How LAN backup works
      </div>
      <div>
        The Paneltec Hub runs in the cloud — it <strong>cannot</strong> reach a
        private IP like <code>192.168.15.165</code> directly. Instead, you run a
        small Python <em>agent</em> on something inside your office network
        (Raspberry Pi, always-on PC, or directly on the UGREEN if it can run
        Python). The agent <strong>polls</strong> the Hub every 60s, downloads
        any new snapshot, and writes it to your destination (typically SMB on
        the UGREEN). It also mDNS-scans the LAN for <code>_smb._tcp</code>
        services so this page can list what's reachable from inside the
        network.
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "#9a3412" }}>
        <strong>3 steps to enable real-time mirroring:</strong>
        &nbsp;1) Add a destination &nbsp;·&nbsp; 2) Register an agent &amp; download
        the installer &nbsp;·&nbsp; 3) Run the agent on a LAN machine
        (<code>python3 paneltec_backup_agent.py</code>).
      </div>
    </div>
  );
}


// ============================================================
// Verify button — one-click proof-of-restore. Streams the snapshot
// ZIP through GridFS in the backend, runs schema + checksum checks
// on critical collections, returns a per-check pass/fail report.
// ============================================================
function VerifyButton({ snap, onDone }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const run = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const r = await api.post(
        `${API}/snapshots/${snap.id}/verify`, {},
        { headers: authHdr(), timeout: 60000 },
      );
      setResult(r.data);
      if (onDone) onDone();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={run} disabled={busy}
        data-testid={`backup-verify-${snap.id}`}
        title="Run schema + checksum checks against the snapshot bytes"
        style={{
          ...btn("#dcfce7"),
          color: "#065f46",
          borderColor: "#86efac",
          opacity: busy ? 0.6 : 1,
        }}>
        <Shield className="w-3.5 h-3.5"/>{busy ? "Verifying…" : "Verify"}
      </button>
      {(result || err) && (
        <div onClick={() => { setResult(null); setErr(""); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 5000, padding: 24,
          }}>
          <div onClick={(e) => e.stopPropagation()}
            data-testid={`backup-verify-result-${snap.id}`}
            style={{
              background: "white", maxWidth: 720, width: "100%",
              maxHeight: "85vh", overflow: "auto", borderRadius: 12,
              padding: "20px 24px",
              boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
            }}>
            <div style={{ display: "flex", justifyContent: "space-between",
                          alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontFamily: "Archivo, sans-serif",
                           fontWeight: 800 }}>
                Verify snapshot
              </h3>
              <button onClick={() => { setResult(null); setErr(""); }}
                style={{ background: "transparent", border: "none",
                         fontSize: 24, cursor: "pointer", color: "#64748b" }}>
                ×
              </button>
            </div>
            {err && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca",
                            color: "#991b1b", padding: 12, borderRadius: 8,
                            fontSize: 13 }}>
                <strong>Failed:</strong> {err}
              </div>
            )}
            {result && (
              <>
                <div style={{
                  background: result.ok ? "#ecfdf5" : "#fef2f2",
                  border: `1px solid ${result.ok ? "#10b981" : "#ef4444"}`,
                  color: result.ok ? "#065f46" : "#7f1d1d",
                  padding: "10px 14px", borderRadius: 8, marginBottom: 14,
                  fontSize: 13, fontWeight: 700,
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  {result.ok
                    ? <CheckCircle2 className="w-4 h-4"/>
                    : <AlertCircle className="w-4 h-4"/>}
                  {result.ok
                    ? `All ${result.checks.length} checks passed in ${result.duration_ms} ms`
                    : `${result.checks.filter(c => !c.ok).length}/${result.checks.length} checks FAILED`}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse",
                                fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#0e1a2b", color: "#f3efe6" }}>
                      <th style={{ ...th(), width: 40 }}></th>
                      <th style={th()}>Check</th>
                      <th style={th()}>Detail</th>
                      <th style={{ ...th(), width: 80, textAlign: "right" }}>Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.checks.map((c, i) => (
                      <tr key={c.name || `chk-${i}`} style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                        <td style={{ ...td(), textAlign: "center",
                                     color: c.ok ? "#10b981" : "#ef4444",
                                     fontWeight: 800 }}>
                          {c.ok ? "✓" : "✗"}
                        </td>
                        <td style={{ ...td(), fontFamily: "monospace",
                                     fontSize: 11 }}>{c.name}</td>
                        <td style={{ ...td(), fontSize: 11, color: "#475569" }}>
                          {c.detail}
                        </td>
                        <td style={{ ...td(), textAlign: "right",
                                     fontFamily: "monospace", fontSize: 11 }}>
                          {c.rows ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 12, fontSize: 11, color: "#64748b" }}>
                  Verified at {result.verified_at?.slice(0,19).replace("T", " ")}.
                  Re-run anytime by clicking <strong>Verify</strong> again.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}


// ============================================================
// Live "Last LAN delivery" card — the most-important visual at
// the top of the Backup tab. Green tick when snapshots are
// landing on the NAS within the last 6 h, amber if behind/stale,
// red if the container has gone silent. Polls every 30 s.
// ============================================================
function LanDeliveryCard() {
  const LAN_API = (process.env.REACT_APP_BACKEND_URL || "") + "/api/backup/lan-status";
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get(LAN_API, { headers: authHdr() });
      setS(r.data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  }, [LAN_API]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!s) {
    return (
      <Section title="Last LAN delivery" icon={<Server className="w-4 h-4"/>}>
        <div style={{ padding: 10, color: "#64748b" }}>{err || "Loading…"}</div>
      </Section>
    );
  }

  // Colour scheme keyed off the rollup health
  const palette = {
    ok:     { bg: "#ecfdf5", border: "#10b981", fg: "#065f46", chip: "#10b981", chipFg: "white", label: "Healthy" },
    stale:  { bg: "#fff7ed", border: "#f59e0b", fg: "#7c2d12", chip: "#f59e0b", chipFg: "white", label: "Stale" },
    behind: { bg: "#fff7ed", border: "#f59e0b", fg: "#7c2d12", chip: "#f59e0b", chipFg: "white", label: "Behind" },
    down:   { bg: "#fef2f2", border: "#ef4444", fg: "#7f1d1d", chip: "#ef4444", chipFg: "white", label: "Agent down" },
    never:  { bg: "#f3f4f6", border: "#6b7280", fg: "#374151", chip: "#6b7280", chipFg: "white", label: "Never delivered" },
  }[s.health] || { bg: "#f3f4f6", border: "#6b7280", fg: "#374151", chip: "#6b7280", chipFg: "white", label: s.health };

  const fmtMin = (m) => {
    if (m == null) return "—";
    if (m < 1) return `${Math.round(m * 60)} sec ago`;
    if (m < 60) return `${Math.round(m)} min ago`;
    if (m < 60 * 24) return `${(m / 60).toFixed(1)} h ago`;
    return `${(m / (60 * 24)).toFixed(1)} d ago`;
  };

  // Friendly one-line explainer per health state
  const explainer = {
    ok:     <>Snapshots are landing on your NAS as expected.</>,
    stale:  <>Last delivery is older than {s.stale_after_h}h — check the agent is still polling.</>,
    behind: <>A newer snapshot is sitting on the Hub but the agent hasn't shipped it yet. It usually catches up within a minute.</>,
    down:   <>The LAN agent hasn't checked in for {fmtMin(s.last_any_report_age_min)}. The container may be stopped.</>,
    never:  <>No snapshots have ever been delivered to the NAS. Register an agent and start the Docker container.</>,
  }[s.health] || null;

  return (
    <Section title="Last LAN delivery"
      icon={<Server className="w-4 h-4"/>}
      action={
        <button type="button" onClick={load} style={btn(ACCENT)}
          data-testid="backup-lan-refresh">
          <RefreshCw className="w-3.5 h-3.5"/>Refresh
        </button>
      }>
      <div
        data-testid="backup-lan-status"
        data-health={s.health}
        style={{
          background: palette.bg,
          borderLeft: `4px solid ${palette.border}`,
          padding: "14px 18px",
          borderRadius: 8,
          color: palette.fg,
          fontSize: 13,
          lineHeight: 1.55,
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12,
                      flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{
            background: palette.chip, color: palette.chipFg,
            padding: "3px 10px", borderRadius: 999,
            fontSize: 10, fontWeight: 900, letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}>
            {s.health === "ok" ? <CheckCircle2 className="w-3 h-3 inline-block mr-1" style={{ verticalAlign: -2 }}/>
              : <AlertCircle className="w-3 h-3 inline-block mr-1" style={{ verticalAlign: -2 }}/>}
            {palette.label}
          </span>
          {s.last_delivery ? (
            <span style={{ fontWeight: 700 }}>
              Last shipped to NAS: <strong>{fmtMin(s.last_delivery_age_min)}</strong>
              {s.last_delivery.bytes_written && (
                <> · {fmtBytes(s.last_delivery.bytes_written)}</>
              )}
            </span>
          ) : (
            <span style={{ fontWeight: 700 }}>No deliveries on record yet.</span>
          )}
        </div>
        {explainer && <div style={{ marginBottom: 8 }}>{explainer}</div>}

        {/* Detail grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 18px",
          fontSize: 12, fontFamily: "monospace", color: palette.fg,
        }}>
          {s.last_delivery?.target_path && (
            <div style={{ gridColumn: "1 / -1" }}>
              <strong>Target:</strong> {s.last_delivery.target_path}
            </div>
          )}
          <div>
            <strong>Agent heartbeat:</strong> {fmtMin(s.agent_last_seen_age_min)}
            {s.agent?.name && <> ({s.agent.name})</>}
          </div>
          <div>
            <strong>Latest Hub snapshot:</strong> {fmtMin(s.latest_snapshot_age_min)}
            {s.latest_snapshot?.size && <> · {fmtBytes(s.latest_snapshot.size)}</>}
          </div>
          {/* "Last failure" intentionally hidden — the green/amber/red
              health pill at the top of the card already conveys the
              current state, and showing a stale failure line from a
              transient 502 just looks alarming. */}
        </div>

        {/* NAS disk usage gauge — reported by the agent on every
            poll. Coloured: green <70%, amber 70-90%, red >90%. */}
        {s.disk_usage && <DiskGauge usage={s.disk_usage} reportedAt={s.disk_usage_at}/>}
      </div>
    </Section>
  );
}


// Compact disk-usage bar. Lives inside LanDeliveryCard.
function DiskGauge({ usage, reportedAt }) {
  const used = Number(usage.used_bytes) || 0;
  const total = Number(usage.total_bytes) || 1;
  const free = Number(usage.free_bytes) || 0;
  const pct = Math.min(100, Math.round((used / total) * 100));
  // Traffic-light colour band.
  const colour =
    pct >= 90 ? "#ef4444" :
    pct >= 70 ? "#f59e0b" :
                "#10b981";
  const fmtGB = (b) =>
    b >= 1024 ** 4 ? `${(b / 1024 ** 4).toFixed(2)} TB` :
    b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` :
                     `${(b / 1024 ** 2).toFixed(0)} MB`;
  return (
    <div data-testid="backup-disk-gauge"
      style={{
        marginTop: 12, paddingTop: 12, borderTop: "1px dashed rgba(0,0,0,0.12)",
        fontSize: 12, fontFamily: "monospace",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    marginBottom: 4 }}>
        <span><strong>NAS disk · {usage.path}</strong></span>
        <span style={{ color: colour, fontWeight: 800 }}>
          {fmtGB(free)} free of {fmtGB(total)} · {pct}% used
        </span>
      </div>
      <div style={{
        background: "rgba(0,0,0,0.08)", height: 8, borderRadius: 4,
        overflow: "hidden",
      }}>
        <div style={{
          background: colour, height: "100%", width: `${pct}%`,
          transition: "width 600ms ease, background 600ms ease",
        }}/>
      </div>
      {reportedAt && (
        <div style={{ fontSize: 10, color: "rgba(0,0,0,0.5)", marginTop: 2 }}>
          Reported {fmtAge(reportedAt)}
        </div>
      )}
    </div>
  );
}


// ============================================================
// Retention policy — grandfather-father-son. Default keeps the Hub
// footprint roughly stable at ~18 GB after the first full year:
//   • All snapshots from the last 7 days     (dense recent recovery)
//   • One per day for the next 30 days       (daily history)
//   • One per week for the next 26 weeks     (~6 months weekly)
//   • One per month forever                  (long-term audit trail)
// The NAS side ignores retention by design (it's offline cold storage
// the operator manages manually via UGREEN File Manager).
// ============================================================
function RetentionCard() {
  const RET_API = (process.env.REACT_APP_BACKEND_URL || "") + "/api/backup/retention";
  const [policy, setPolicy] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pendingRun, setPendingRun] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, pv] = await Promise.all([
        api.get(RET_API, { headers: authHdr() }),
        api.get(`${RET_API}/preview`, { headers: authHdr() }),
      ]);
      setPolicy(p.data);
      setPreview(pv.data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  }, [RET_API]);
  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    setBusy(true);
    setErr("");
    try {
      await api.put(RET_API, patch, { headers: authHdr() });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    if (!pendingRun) {
      setPendingRun(true);
      setTimeout(() => setPendingRun(false), 5000);
      return;
    }
    setPendingRun(false);
    setBusy(true);
    try {
      await api.post(`${RET_API}/run`, {}, { headers: authHdr() });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!policy || !preview) {
    return (
      <Section title="Retention policy" icon={<Archive className="w-4 h-4"/>}>
        <div style={{ padding: 10, color: "#64748b" }}>{err || "Loading…"}</div>
      </Section>
    );
  }

  const fmtMB = (b) => (b / 1024 / 1024).toFixed(0) + " MB";
  const fmtGB = (b) => (b / 1024 / 1024 / 1024).toFixed(2) + " GB";

  // Sum of all kept snapshots — what the Hub footprint will be
  // AFTER the next retention run.
  const keptBytes = (preview.decisions || [])
    .filter(d => d.verdict === "keep")
    .reduce((s, d) => s + (d.size || 0), 0);
  const dropBytes = preview.bytes_to_free;

  return (
    <Section title="Retention policy"
      icon={<Archive className="w-4 h-4"/>}>
      <div style={cardStyle()} data-testid="backup-retention-card">
        <div style={{ display: "flex", alignItems: "center", gap: 16,
                      flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8,
                          fontWeight: 700, fontSize: 13 }}>
            <input type="checkbox"
              data-testid="backup-retention-enabled"
              checked={!!policy.enabled}
              disabled={busy}
              onChange={e => save({ enabled: e.target.checked })}/>
            Retention policy enabled
          </label>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            {policy.enabled
              ? "Old snapshots are pruned per policy after each new snap + every 6h."
              : "Snapshots accumulate forever (not recommended)."}
          </span>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12, marginBottom: 14,
        }}>
          <RetField label="Keep ALL · last"
            value={policy.keep_all_days} unit="days"
            min={0} max={90} disabled={busy || !policy.enabled}
            testid="ret-all"
            onChange={v => save({ keep_all_days: v })}/>
          <RetField label="Then 1/day · next"
            value={policy.keep_daily_days} unit="days"
            min={0} max={365} disabled={busy || !policy.enabled}
            testid="ret-daily"
            onChange={v => save({ keep_daily_days: v })}/>
          <RetField label="Then 1/week · next"
            value={policy.keep_weekly_weeks} unit="weeks"
            min={0} max={260} disabled={busy || !policy.enabled}
            testid="ret-weekly"
            onChange={v => save({ keep_weekly_weeks: v })}/>
          <RetField label="Then 1/month · cap"
            value={policy.keep_monthly_months} unit="months"
            min={0} max={600} disabled={busy || !policy.enabled}
            hint="0 = keep forever"
            testid="ret-monthly"
            onChange={v => save({ keep_monthly_months: v })}/>
        </div>

        {/* Live preview banner */}
        <div style={{
          background: preview.dropped > 0 ? "#fff7ed" : "#ecfdf5",
          border: `1px solid ${preview.dropped > 0 ? "#fdba74" : "#86efac"}`,
          padding: "10px 14px", borderRadius: 6, fontSize: 12,
          color: preview.dropped > 0 ? "#7c2d12" : "#065f46",
          marginBottom: 12,
        }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            {preview.dropped > 0
              ? `If applied now: keep ${preview.kept}, drop ${preview.dropped} (frees ${fmtMB(dropBytes)})`
              : `Nothing to prune — all ${preview.kept} snapshots fall inside the policy.`}
          </div>
          <div style={{ fontSize: 11, opacity: 0.85,
                        fontFamily: "monospace" }}>
            Per tier: all={preview.tier_counts.kept_all}
            {" · "}daily={preview.tier_counts.kept_daily}
            {" · "}weekly={preview.tier_counts.kept_weekly}
            {" · "}monthly={preview.tier_counts.kept_monthly}
            {" · "}<strong>Hub footprint after: ~{fmtGB(keptBytes)}</strong>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center",
                      flexWrap: "wrap" }}>
          <button onClick={runNow} disabled={busy || !policy.enabled}
            data-testid="backup-retention-run"
            style={pendingRun
              ? { ...btn("#dc2626"), color: "white", borderColor: "#dc2626" }
              : btn("#fef3c7")}>
            {pendingRun
              ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em" }}>
                  CLICK AGAIN TO PRUNE
                </span>
              : <><Trash2 className="w-3.5 h-3.5"/>Run retention now</>}
          </button>
          {policy.last_run_at && (
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
              Last run: {fmtAge(policy.last_run_at)}
              {policy.last_run_dropped > 0 && (
                <> · dropped {policy.last_run_dropped} ({fmtMB(policy.last_run_bytes_freed || 0)})</>
              )}
            </span>
          )}
        </div>
        {err && (
          <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 12 }}>{err}</div>
        )}
      </div>
    </Section>
  );
}

// Small inline numeric field used inside the retention card.
function RetField({ label, value, unit, min, max, disabled, onChange, hint, testid }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => { setLocal(String(value)); }, [value]);
  const commit = () => {
    const n = Number(local);
    if (!Number.isFinite(n) || n < min || n > max) {
      setLocal(String(value));    // revert
      return;
    }
    if (n !== value) onChange(n);
  };
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#475569",
                    marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="number" min={min} max={max} value={local}
          data-testid={testid}
          disabled={disabled}
          onChange={e => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
          style={{ ...inp(), width: 80, textAlign: "right" }}/>
        <span style={{ fontSize: 12, color: "#64748b" }}>{unit}</span>
      </div>
      {hint && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}


// ============================================================
// Auto-snapshot schedule — read-only view of the two APScheduler
// cron jobs that server.py registers on startup (backup_snapshot_6h
// + backup_snapshot_cob). Introspects the live scheduler via
// GET /api/backup/schedule so the panel reflects reality even if the
// cron cadence is ever tuned in server.py.
// ============================================================
function ScheduleCard() {
  const SCHED_API = (process.env.REACT_APP_BACKEND_URL || "") + "/api/backup/schedule";
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get(SCHED_API, { headers: authHdr() });
      setData(r.data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  }, [SCHED_API]);
  useEffect(() => { load(); }, [load]);

  if (!data) {
    return (
      <Section title="Auto-snapshot schedule" icon={<RefreshCw className="w-4 h-4"/>}>
        <div style={{ padding: 10, color: "#64748b" }}>{err || "Loading…"}</div>
      </Section>
    );
  }

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const fmt = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch { return iso; }
  };
  const labelFor = (id) => ({
    backup_snapshot_6h:  "Every 6 hours",
    backup_snapshot_cob: "Close-of-business (mon-fri)",
  }[id] || id);

  return (
    <Section title="Auto-snapshot schedule"
      icon={<RefreshCw className="w-4 h-4"/>}>
      <div style={cardStyle()} data-testid="backup-schedule-card">
        <div style={{ fontSize: 12, color: "#475569", marginBottom: 10 }}>
          The Hub runs these APScheduler cron jobs automatically. The LAN agent
          picks up each new snapshot on its next 60-second poll — no manual
          clicks needed.
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748b",
                         fontSize: 11, textTransform: "uppercase",
                         letterSpacing: "0.05em" }}>
              <th style={{ padding: "6px 8px" }}>Job</th>
              <th style={{ padding: "6px 8px" }}>Cron</th>
              <th style={{ padding: "6px 8px" }}>Timezone</th>
              <th style={{ padding: "6px 8px" }}>Next run</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} data-testid={`backup-schedule-row-${j.id}`}
                  style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: "8px", fontWeight: 700, color: "#0f172a" }}>
                  {labelFor(j.id)}
                  <div style={{ fontWeight: 400, fontSize: 11,
                                color: "#94a3b8", fontFamily: "monospace" }}>
                    {j.id}
                  </div>
                </td>
                <td style={{ padding: "8px", fontFamily: "monospace",
                             color: "#0f172a" }}>
                  {j.cron || "—"}
                </td>
                <td style={{ padding: "8px", color: "#475569" }}>
                  {j.timezone || "—"}
                </td>
                <td style={{ padding: "8px", color: "#475569" }}>
                  {fmt(j.next_run_at)}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 12, color: "#94a3b8" }}>
                  No scheduled jobs registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {data.retention_last_run_at && (
          <div style={{ marginTop: 10, fontSize: 11, color: "#475569",
                        fontFamily: "monospace" }}
               data-testid="backup-schedule-retention-last-run">
            Retention last run: {fmt(data.retention_last_run_at)}
          </div>
        )}
        {err && (
          <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 12 }}>{err}</div>
        )}
      </div>
    </Section>
  );
}


// ============================================================
// Destinations
// ============================================================
function DestinationsCard({ destinations, onReload, discovered }) {
  // adding mode: null = closed, "new" = add form, "<id>" = edit form
  const [adding, setAdding] = useState(null);
  // Two-click delete pattern — bypasses window.confirm which some
  // browsers silently block. The first click marks the row red and
  // shows "Click again"; a second click within 5s commits the delete.
  const [pendingDelete, setPendingDelete] = useState(null);
  const blankForm = () => ({
    name: "Office UGREEN tower",
    kind: "smb_lan",
    host: "192.168.15.165",
    share: "Backups",
    path_prefix: "/paneltec-hub",
    username: "",
    password: "",
  });
  const [form, setForm] = useState(blankForm());

  // If the agent has discovered any SMB hosts, offer them as quick-fill
  // chips so the operator doesn't have to type the IP / share manually.
  const quickFill = useMemo(() => {
    const seen = new Set();
    return (discovered || [])
      .filter(d => (d.addresses || []).length)
      .map(d => ({
        host: d.addresses[0],
        name: d.name?.split("._smb._tcp")[0] || d.server,
        server: d.server,
      }))
      .filter(d => {
        const k = d.host;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }, [discovered]);

  const startAdd = () => {
    setForm(blankForm());
    setAdding("new");
  };
  const startEdit = (d) => {
    setForm({
      name: d.name || "",
      kind: d.kind || "smb_lan",
      host: d.host || "",
      share: d.share || "",
      path_prefix: d.path_prefix || "",
      username: d.username || "",
      password: "",   // never round-tripped from backend
    });
    setAdding(d.id);
  };

  const save = async () => {
    try {
      const { password, ...rest } = form;
      const qs = password ? `?password=${encodeURIComponent(password)}` : "";
      if (adding === "new") {
        await api.post(`${API}/destinations${qs}`, rest, { headers: authHdr() });
      } else {
        // Edit existing — PUT keeps the saved password unless re-entered.
        await api.put(`${API}/destinations/${adding}${qs}`, rest, { headers: authHdr() });
      }
      setAdding(null);
      setForm(blankForm());
      await onReload();
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    }
  };

  const del = async (id) => {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      setTimeout(() => setPendingDelete(p => p === id ? null : p), 5000);
      return;
    }
    setPendingDelete(null);
    await api.delete(`${API}/destinations/${id}`, { headers: authHdr() });
    await onReload();
  };

  // Quick enable/disable toggle. The agent's installer endpoint only
  // ships credentials for destinations where `enabled: true`, so
  // flipping this off is the right way to silence a destination that
  // is permanently unreachable (e.g. wrong subnet, retired NAS) without
  // losing its config — just in case you want to re-enable it later.
  const toggleEnabled = async (d) => {
    try {
      const { id, password_set, created_at, last_seen_at, last_written_at, ...rest } = d;
      await api.put(`${API}/destinations/${id}`,
        { ...rest, enabled: !d.enabled },
        { headers: authHdr() });
      await onReload();
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    }
  };

  const editingExisting = adding && adding !== "new";

  return (
    <Section title="Destinations"
      icon={<Server className="w-4 h-4"/>}
      action={
        <button type="button" onClick={() => adding ? setAdding(null) : startAdd()}
          data-testid="backup-add-destination-btn"
          style={btn(ACCENT)}>
          <Plus className="w-3.5 h-3.5"/>{adding ? "Cancel" : "Add destination"}
        </button>
      }>
      {adding && (
        <div style={cardStyle()} data-testid="backup-dest-form">
          {editingExisting && (
            <div style={{
              fontSize: 11, fontWeight: 800, letterSpacing: "0.18em",
              textTransform: "uppercase", color: "#92400e",
              background: "#fef3c7", border: "1px solid #fde68a",
              padding: "6px 10px", borderRadius: 4, marginBottom: 10,
              display: "inline-block",
            }}>
              Editing existing destination · leave password blank to keep saved value
            </div>
          )}
          <Row>
            <Field label="Name">
              <input value={form.name} onChange={e=>setForm({...form, name:e.target.value})}
                style={inp()} data-testid="backup-dest-name"/>
            </Field>
            <Field label="Type">
              <select value={form.kind} onChange={e=>setForm({...form, kind:e.target.value})}
                style={inp()}>
                <option value="smb_lan">SMB (LAN — UGREEN / Synology / QNAP / Windows share)</option>
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Host / IP">
              <input value={form.host} onChange={e=>setForm({...form, host:e.target.value})}
                placeholder="192.168.15.165" style={inp()} data-testid="backup-dest-host"/>
            </Field>
            <Field label="Share">
              <input value={form.share} onChange={e=>setForm({...form, share:e.target.value})}
                placeholder="Backups" style={inp()}/>
            </Field>
          </Row>
          <Row>
            <Field label="Path prefix">
              <input value={form.path_prefix} onChange={e=>setForm({...form, path_prefix:e.target.value})}
                placeholder="/paneltec-hub" style={inp()}/>
            </Field>
            <Field label="Username">
              <input value={form.username} onChange={e=>setForm({...form, username:e.target.value})}
                placeholder="PaneltecAdmin" style={inp()} data-testid="backup-dest-username"/>
            </Field>
            <Field label={editingExisting ? "Password (blank = keep saved)" : "Password"}>
              <input type="password" value={form.password}
                onChange={e=>setForm({...form, password:e.target.value})}
                placeholder={editingExisting ? "leave blank to keep saved" : ""}
                style={inp()} data-testid="backup-dest-password"/>
            </Field>
          </Row>
          {quickFill.length > 0 && (
            <div style={{ fontSize: 12, marginTop: 8, color: "#475569" }}>
              <strong>mDNS suggestions:</strong>{" "}
              {quickFill.map(q => (
                <button key={q.host} onClick={() => setForm({...form, host: q.host, name: q.name || form.name})}
                  style={{
                    background: "#e0f2fe", border: "1px solid #7dd3fc", color: "#0369a1",
                    padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                    margin: "0 4px", cursor: "pointer",
                  }}>
                  {q.name || q.server} → {q.host}
                </button>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button onClick={save} style={btn(ACCENT)} data-testid="backup-dest-save">
              {editingExisting ? "Update destination" : "Save destination"}
            </button>
          </div>
        </div>
      )}

      {destinations.length === 0 ? (
        <Empty>No destinations yet. Add an SMB target your agent should ship to.</Empty>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: INK, color: PAPER }}>
              <th style={th()}>Name</th>
              <th style={th()}>Target</th>
              <th style={th()}>Last write</th>
              <th style={th()}>Status</th>
              <th style={th()}></th>
            </tr>
          </thead>
          <tbody>
            {destinations.map(d => (
              <tr key={d.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                <td style={td()}><strong>{d.name}</strong></td>
                <td style={{ ...td(), fontFamily: "monospace", fontSize: 11 }}>
                  smb://{d.host}/{d.share}{d.path_prefix || ""}
                  {d.username && <div style={{ color: "#64748b" }}>user: {d.username}</div>}
                </td>
                <td style={td()}>{fmtAge(d.last_written_at)}</td>
                <td style={td()}>
                  {d.enabled ? <Pill ok>Enabled</Pill> : <Pill>Disabled</Pill>}
                  {d.password_set && <Pill ok mini>auth ✓</Pill>}
                </td>
                <td style={td()}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button onClick={() => toggleEnabled(d)}
                      data-testid={`backup-dest-toggle-${d.id}`}
                      title={d.enabled
                        ? "Stop the agent shipping snapshots to this destination (keeps config)"
                        : "Resume shipping snapshots to this destination"}
                      style={btn(d.enabled ? "#e0e7ff" : "#dcfce7")}>
                      {d.enabled ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => startEdit(d)}
                      data-testid={`backup-dest-edit-${d.id}`}
                      style={btn("#fef3c7")}>
                      Edit
                    </button>
                    <button onClick={() => del(d.id)}
                      data-testid={`backup-dest-delete-${d.id}`}
                      style={pendingDelete === d.id
                        ? { ...btn("#dc2626"), color: "white", borderColor: "#dc2626" }
                        : btn("#fee2e2")}>
                      {pendingDelete === d.id
                        ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em" }}>CLICK AGAIN</span>
                        : <Trash2 className="w-3.5 h-3.5"/>}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}


// ============================================================
// Agents
// ============================================================
function AgentsCard({ agents, freshAgent, setFreshAgent, onReload }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Office Pi");
  // Same two-click delete pattern used in DestinationsCard.
  const [pendingDelete, setPendingDelete] = useState(null);
  // Cached YAML for the freshly-issued agent — so the user sees what
  // they're about to copy AND each Copy button is right next to the
  // block of text it copies.
  const [composeText, setComposeText] = useState("");
  const [copyState, setCopyState] = useState("");

  const register = async () => {
    try {
      const r = await api.post(`${API}/agents/register`, { name }, { headers: authHdr() });
      setFreshAgent(r.data);
      setCreating(false);
      setName("Office Pi");
      await onReload();
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    }
  };

  const del = async (id) => {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      setTimeout(() => setPendingDelete(p => p === id ? null : p), 5000);
      return;
    }
    setPendingDelete(null);
    await api.delete(`${API}/agents/${id}`, { headers: authHdr() });
    await onReload();
  };

  // "Reset token & show YAML" — for an EXISTING agent the plaintext
  // token is gone (we only stored the hash). To let the operator see
  // a fresh YAML preview WITH a Copy button, we delete the old agent
  // and issue a new one with the same name. Old tokens stop working
  // immediately — safe because the user is about to redeploy anyway.
  const resetAndShowYaml = async (agent) => {
    try {
      await api.delete(`${API}/agents/${agent.id}`, { headers: authHdr() });
      const r = await api.post(`${API}/agents/register`,
        { name: agent.name },
        { headers: authHdr() });
      setFreshAgent(r.data);
      await onReload();
      setTimeout(() => {
        const el = document.querySelector('[data-testid="backup-fresh-agent-panel"]');
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    } catch (e) {
      alert(`Reset failed: ${e?.response?.data?.detail || e.message}`);
    }
  };

  const downloadInstaller = () => {
    if (!freshAgent?.token) return;
    const hubUrl = process.env.REACT_APP_BACKEND_URL;
    const url = `${API}/agent/install.py?token=${encodeURIComponent(freshAgent.token)}&hub_url=${encodeURIComponent(hubUrl)}`;
    // v154.2 — iframe-safe download wrapper: async → data-URL popup
    // → manual-copy modal. Never a silent no-op.
    fetch(url, { headers: authHdr() })
      .then(r => r.text())
      .then(text => downloadFile(text, "paneltec_backup_agent.py", {
        contentType: "text/x-python", silent: true,
      }));
  };

  // Fetch the docker-compose.yml as text — used by both Download and
  // Copy actions so they share the exact same backend response. Also
  // called automatically when a fresh agent is registered so the YAML
  // is visible inline with its own Copy button.
  const fetchComposeText = async () => {
    if (!freshAgent?.token) return null;
    const hubUrl = process.env.REACT_APP_BACKEND_URL;
    const url = `${API}/agent/docker-compose.yml?token=${encodeURIComponent(freshAgent.token)}&hub_url=${encodeURIComponent(hubUrl)}`;
    const r = await fetch(url, { headers: authHdr() });
    if (!r.ok) {
      alert(`Failed to fetch compose YAML: HTTP ${r.status}`);
      return null;
    }
    return await r.text();
  };

  // Auto-load the YAML the moment a fresh agent token is issued so
  // the user doesn't have to click anything to SEE the text.
  useEffect(() => {
    let cancelled = false;
    if (!freshAgent?.token) { setComposeText(""); return; }
    fetchComposeText().then(t => {
      if (!cancelled && t) setComposeText(t);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshAgent?.token]);

  // Generate a docker-compose.yml the operator can paste into their
  // UGREEN / Synology / QNAP Docker app. The container fetches its
  // own agent script at startup using the embedded token — no file
  // copying onto the NAS required.
  const downloadCompose = async () => {
    const text = composeText || (await fetchComposeText());
    if (!text) return;
    // v154.2 — iframe-safe download wrapper: attaches the anchor
    // to the DOM before .click() (fixing the silent no-op that
    // blocked the July 4 2026 LAN agent onboarding), falls back
    // to a data-URL popup and then to a manual-copy modal.
    await downloadFile(text, "paneltec-agent-compose.yml", {
      contentType: "text/yaml", silent: true,
    });
  };

  // One-click clipboard copy — copies ONLY the YAML, not any
  // surrounding page content. v154: delegates to the shared
  // iframe-safe wrapper so a locked-down permissions policy
  // falls through to execCommand and then to the manual-select
  // modal instead of throwing an uncaught error.
  const copyCompose = async () => {
    const text = composeText || (await fetchComposeText());
    if (!text) return;
    const r = await copyToClipboard(text, { silent: true });
    if (r.ok) {
      setCopyState("copied");
      setTimeout(() => setCopyState(""), 2200);
    }
    // On manual fallback the shared modal takes over — no toast noise here.
  };

  return (
    <div data-testid="agents-card">
    <Section title="Agents"
      icon={<Shield className="w-4 h-4"/>}
      action={
        <button type="button" onClick={() => setCreating(!creating)}
          data-testid="backup-add-agent-btn"
          style={btn(ACCENT)}>
          <Key className="w-3.5 h-3.5"/>{creating ? "Cancel" : "Register agent"}
        </button>
      }>
      {creating && (
        <div style={cardStyle()}>
          <Field label="Agent name (e.g. 'Office Pi @ workshop')">
            <input value={name} onChange={e=>setName(e.target.value)} style={inp()}
              data-testid="backup-agent-name"/>
          </Field>
          <div style={{ marginTop: 12 }}>
            <button onClick={register} style={btn(ACCENT)} data-testid="backup-register-agent-btn">
              Generate token
            </button>
          </div>
        </div>
      )}

      {freshAgent && (
        <div style={{
          background: "#ecfdf5", border: "1px solid #6ee7b7",
          borderLeft: "4px solid #059669",
          padding: 14, borderRadius: 8, marginBottom: 16, fontSize: 13,
        }} data-testid="backup-fresh-agent-panel">
          <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: "0.18em",
                        textTransform: "uppercase", marginBottom: 8, color: "#065f46" }}>
            🔑 New agent token — visible ONCE
          </div>
          <p style={{ marginBottom: 10 }}>
            Save the installer below (or copy the token). After leaving this
            page the token can't be retrieved — you'd have to register a new
            agent. The installer has the token <strong>and the hub URL
            already baked in</strong>, so on the agent machine you just run:
          </p>
          <pre style={{ background: "#0f172a", color: "#e2e8f0",
                        padding: "10px 12px", borderRadius: 6, fontSize: 11,
                        margin: "0 0 12px", overflow: "auto" }}>
{"pip install requests pysmb zeroconf\npython3 paneltec_backup_agent.py"}
          </pre>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={downloadCompose} style={btn(ACCENT)}
              data-testid="backup-download-compose-btn">
              <Download className="w-3.5 h-3.5"/>Download .yml
            </button>
            <button onClick={downloadInstaller} style={btn()}
              data-testid="backup-download-installer-btn">
              <Download className="w-3.5 h-3.5"/>Plain installer (.py)
            </button>
            <button onClick={() => copyToClipboard(freshAgent.token, { successMsg: "Token copied" })}
              style={btn()}>
              <Copy className="w-3.5 h-3.5"/>Copy token
            </button>
            <button onClick={() => setFreshAgent(null)} style={btn()}>Hide</button>
          </div>

          {/* Inline YAML preview — visible so the user knows EXACTLY
              what's about to be pasted into UGREEN Docker, with a
              Copy button right next to the block (not in the page
              footer). The <pre> tag has user-select:text so the
              operator can manually select if they prefer. */}
          {composeText && (
            <div style={{ marginTop: 14, position: "relative",
                          border: "1px solid #1e293b", borderRadius: 6,
                          background: "#0f172a" }}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 10px",
                borderBottom: "1px solid #1e293b",
                background: "#0b1220",
                fontFamily: "JetBrains Mono, ui-monospace, monospace",
                fontSize: 10, fontWeight: 800, letterSpacing: "0.16em",
                textTransform: "uppercase", color: "#94a3b8",
              }}>
                <span>docker-compose.yml</span>
                <button onClick={copyCompose}
                  data-testid="backup-copy-compose-btn"
                  style={{
                    background: copyState === "copied" ? "#10b981" : "#1d4ed8",
                    color: "white", border: "none",
                    padding: "4px 12px", cursor: "pointer", borderRadius: 4,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                    fontSize: 10, fontWeight: 800,
                    letterSpacing: "0.16em", textTransform: "uppercase",
                    display: "inline-flex", alignItems: "center", gap: 6,
                    transition: "background 160ms ease",
                  }}>
                  <Copy className="w-3 h-3"/>
                  {copyState === "copied" ? "Copied!" : "Copy YAML"}
                </button>
              </div>
              <pre
                data-testid="backup-compose-yaml"
                style={{
                  margin: 0,
                  padding: "12px 14px",
                  maxHeight: 360,
                  overflow: "auto",
                  fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: "#e2e8f0",
                  whiteSpace: "pre",
                  userSelect: "text",
                }}>
                {composeText}
              </pre>
            </div>
          )}
          <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 11,
                        color: "#475569", wordBreak: "break-all" }}>
            <strong>Token:</strong> {freshAgent.token}
          </div>
        </div>
      )}

      {agents.length === 0 ? (
        <Empty>No agents registered yet. Register an agent and run the installer on a LAN machine.</Empty>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: INK, color: PAPER }}>
              <th style={th()}>Name</th>
              <th style={th()}>Last seen</th>
              <th style={th()}>Discovered SMB</th>
              <th style={th()}></th>
            </tr>
          </thead>
          <tbody>
            {agents.map(a => (
              <tr key={a.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                <td style={td()}><strong>{a.name}</strong></td>
                <td style={td()}>
                  {a.last_seen_at ? fmtAge(a.last_seen_at) : <Pill>never</Pill>}
                  {/* v154 — first-check-in row so admins can tell
                      "never polled since register" apart from
                      "polled once then stopped". */}
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}
                       data-testid={`backup-agent-first-seen-${a.id}`}>
                    First check-in:{" "}
                    {a.first_seen_at
                      ? fmtAge(a.first_seen_at)
                      : <span style={{ color: "#b91c1c", fontWeight: 700 }}>never polled</span>}
                  </div>
                </td>
                <td style={td()}>{(a.mdns_services || []).length}</td>
                <td style={td()}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end",
                                flexWrap: "wrap" }}>
                    <button onClick={() => resetAndShowYaml(a)}
                      data-testid={`backup-agent-reset-${a.id}`}
                      title="Rotate this agent's token and show a fresh install YAML you can copy."
                      style={btn("#dbeafe")}>
                      <Copy className="w-3.5 h-3.5"/>Reset token &amp; show YAML
                    </button>
                    <button onClick={() => del(a.id)}
                      data-testid={`backup-agent-delete-${a.id}`}
                      style={pendingDelete === a.id
                        ? { ...btn("#dc2626"), color: "white", borderColor: "#dc2626" }
                        : btn("#fee2e2")}>
                      {pendingDelete === a.id
                        ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em" }}>CLICK AGAIN</span>
                        : <Trash2 className="w-3.5 h-3.5"/>}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
    </div>
  );
}


// ============================================================
// mDNS-discovered SMB targets
// ============================================================
function DiscoveryCard({ discovered }) {
  // Hide the whole card when no agent has reported any mDNS results.
  // Most operators have a single known SMB device they've already
  // typed in manually — the "Nothing reported yet" placeholder was
  // just noise. The section will silently re-appear the moment any
  // agent posts mDNS findings.
  if (!discovered || discovered.length === 0) return null;
  return (
    <Section title="SMB devices discovered on your LAN"
      icon={<Wifi className="w-4 h-4"/>}>
      <p style={{ fontSize: 12, color: "#475569", marginBottom: 10 }}>
        Populated by each agent's periodic mDNS scan. Click on a host
        below to pre-fill an "Add destination" form.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: INK, color: PAPER }}>
            <th style={th()}>Name</th>
            <th style={th()}>Hostname</th>
            <th style={th()}>IP</th>
            <th style={th()}>Port</th>
            <th style={th()}>Seen by agent</th>
          </tr>
        </thead>
        <tbody>
          {discovered.map((d, i) => (
            <tr key={`${d.server || 'srv'}-${(d.addresses || []).join(',') || i}`} style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
              <td style={td()}>{d.name || "—"}</td>
              <td style={{ ...td(), fontFamily: "monospace", fontSize: 11 }}>{d.server || "—"}</td>
              <td style={{ ...td(), fontFamily: "monospace", fontSize: 11 }}>{(d.addresses || []).join(", ") || "—"}</td>
              <td style={td()}>{d.port || "—"}</td>
              <td style={td()}>{d.via_agent}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}


// ============================================================
// Restore from snapshot
// ============================================================
function RestoreCard() {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const onPick = (f) => {
    if (!f) return;
    if (!f.name.endsWith(".zip")) {
      setError("Pick a .zip snapshot file");
      return;
    }
    setFile(f);
    setPreview(null);
    setResult(null);
    setError("");
  };

  const send = async (mode) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const qs = mode === "dry_run" ? "?mode=dry_run" :
                                      `?mode=${mode}&confirm=RESTORE`;
      const r = await api.post(`${API}/restore${qs}`, fd, {
        headers: { ...authHdr(), "Content-Type": "multipart/form-data" },
      });
      if (mode === "dry_run") setPreview(r.data);
      else setResult(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null); setPreview(null); setResult(null); setError("");
  };

  return (
    <Section
      title="Restore from snapshot"
      icon={<Server className="w-4 h-4"/>}>
      <div style={{ padding: 16 }}>
        <div style={{
          background: "#fef2f2", border: "1px solid #fecaca",
          borderLeft: "4px solid #dc2626", color: "#7f1d1d",
          padding: "10px 14px", borderRadius: 8, marginBottom: 14,
          fontSize: 13, lineHeight: 1.5,
        }}>
          <strong>⚠️ Destructive operation.</strong> <em>Replace</em> mode
          wipes each collection in the ZIP before re-inserting.
          <em> Merge</em> is non-destructive (upserts by <code>id</code>).
          Auth sessions and GridFS internals are never touched.
        </div>

        {/* Paneltec Civil (v143) — restore _id caveat. Civil uses UUID `id`
            fields for every internal cross-reference, so the ObjectId
            regeneration inherent in a full JSON dump/restore is safe. Called
            out plainly here so admins running Restore see it before they
            click. */}
        <div
          data-testid="backup-restore-id-caveat"
          style={{
            marginBottom: 14, padding: "10px 12px", borderRadius: 8,
            background: "#fef3c7", border: "1px solid #f59e0b",
            color: "#78350f", fontSize: 12, lineHeight: 1.5,
          }}>
          <strong style={{ fontWeight: 800 }}>Restoring regenerates internal MongoDB <code>_id</code> fields.</strong> Civil references use UUID <code>id</code> fields and are unaffected. Auth sessions and GridFS internals are never touched.
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault(); setDragging(false);
            onPick(e.dataTransfer.files[0]);
          }}
          onClick={() => document.getElementById("backup-restore-input")?.click()}
          data-testid="backup-restore-dropzone"
          style={{
            border: `2px dashed ${dragging ? "#fbbf24" : "#94a3b8"}`,
            background: dragging ? "#fef3c7" : "#f8fafc",
            padding: 24, borderRadius: 8, textAlign: "center",
            cursor: "pointer", transition: "all 0.15s",
            marginBottom: 14,
          }}>
          <Download className="w-6 h-6 inline-block mb-2" style={{ transform: "rotate(180deg)" }}/>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {file ? file.name : "Drop a paneltec-snapshot-….zip here"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            {file
              ? `${(file.size / (1024 * 1024)).toFixed(1)} MB · click to change`
              : "or click to browse"}
          </div>
          <input id="backup-restore-input" type="file" accept=".zip"
            style={{ display: "none" }}
            onChange={e => onPick(e.target.files[0])}
            data-testid="backup-restore-file"/>
        </div>

        {file && !preview && !result && (
          <button onClick={() => send("dry_run")} disabled={busy}
            style={btn(ACCENT)} data-testid="backup-restore-preview-btn">
            {busy ? "Reading…" : "Preview contents"}
          </button>
        )}

        {error && (
          <div style={{
            background: "#fef2f2", color: "#991b1b",
            padding: "8px 12px", borderRadius: 6, marginTop: 10,
            fontSize: 13,
          }}>{error}</div>
        )}

        {preview && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
              Preview · {preview.manifest?.snapshot_id?.slice(0, 8) || "—"} ·
              {" "}{preview.collections.length} collections
            </div>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f1f5f9" }}>
                  <th style={td()}>Collection</th>
                  <th style={td()}>In ZIP</th>
                  <th style={td()}>In DB</th>
                  <th style={td()}>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.collections.map((c, i) => (
                  <tr key={c.collection || `col-${i}`} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={td()}>{c.collection}</td>
                    <td style={td()}>{c.rows_in_zip ?? "—"}</td>
                    <td style={td()}>{c.rows_existing ?? "—"}</td>
                    <td style={td()}>
                      <Pill>{c.status}{c.reason ? ` · ${c.reason}` : ""}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => {
                if (window.confirm("MERGE: insert new rows + update existing by id. Continue?")) send("merge");
              }} disabled={busy}
                style={btn(ACCENT)} data-testid="backup-restore-merge-btn">
                ✚ Merge (non-destructive)
              </button>
              <button onClick={() => {
                if (window.confirm("REPLACE: WIPE each collection in the ZIP before re-inserting. THIS IS DESTRUCTIVE. Continue?")) send("replace");
              }} disabled={busy}
                style={btn("#fee2e2")} data-testid="backup-restore-replace-btn">
                ⚠ Replace (destructive)
              </button>
              <button onClick={reset} style={btn()}>Cancel</button>
            </div>
          </div>
        )}

        {result && (
          <div style={{ marginTop: 14 }}>
            <div style={{
              background: "#ecfdf5", border: "1px solid #6ee7b7",
              padding: 12, borderRadius: 6, marginBottom: 10, fontSize: 13,
            }}>
              <CheckCircle2 className="w-4 h-4 inline mr-2"/>
              <strong>Restored.</strong> Mode: {result.mode} ·
              {" "}Collections touched: {result.collections.length}
            </div>
            <button onClick={reset} style={btn()}>Done</button>
          </div>
        )}
      </div>
    </Section>
  );
}


// ============================================================
// Small reused atoms
// ============================================================
function Section({ title, icon, action, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10,
      }}>
        <div style={{
          fontFamily: "Archivo, sans-serif", fontWeight: 800,
          fontSize: 12, letterSpacing: "0.20em", textTransform: "uppercase",
          color: INK, display: "flex", alignItems: "center", gap: 8,
        }}>
          {icon}
          {title}
        </div>
        {action}
      </div>
      <div style={{ background: PAPER, border: `1px solid ${INK}33`, borderRadius: 8, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children }) {
  return <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>{children}</div>;
}

function Field({ label, children }) {
  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <label style={{
        display: "block", fontSize: 11, letterSpacing: "0.10em",
        textTransform: "uppercase", color: "#475569", fontWeight: 700,
        marginBottom: 4, fontFamily: "Archivo, sans-serif",
      }}>{label}</label>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 18, color: "#64748b", fontSize: 13 }}>{children}</div>;
}

function Pill({ ok, mini, children }) {
  return (
    <span style={{
      display: "inline-block",
      background: ok ? "#dcfce7" : "#f1f5f9",
      color: ok ? "#15803d" : "#475569",
      border: `1px solid ${ok ? "#86efac" : "#cbd5e1"}`,
      padding: mini ? "1px 5px" : "2px 8px",
      borderRadius: 999, fontSize: 10, fontWeight: 700,
      letterSpacing: "0.06em", textTransform: "uppercase",
      marginLeft: mini ? 4 : 0,
    }}>{children}</span>
  );
}

const inp = () => ({
  width: "100%", padding: "7px 10px", border: `1px solid ${INK}33`,
  borderRadius: 6, fontSize: 13, background: "white",
  fontFamily: "Archivo Narrow, sans-serif",
});
const th = () => ({
  padding: "8px 10px", textAlign: "left", fontSize: 11,
  letterSpacing: "0.16em", textTransform: "uppercase",
});
const td = () => ({ padding: "8px 10px", verticalAlign: "middle" });
const btn = (bg) => ({
  background: bg || "white", color: INK,
  padding: "6px 12px", border: `1px solid ${INK}55`, borderRadius: 6,
  fontSize: 12, fontWeight: 700, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
  fontFamily: "Archivo, sans-serif",
});
const cardStyle = () => ({
  background: "white", border: `1px solid ${INK}22`,
  padding: 16, borderRadius: 8, marginBottom: 14,
});
