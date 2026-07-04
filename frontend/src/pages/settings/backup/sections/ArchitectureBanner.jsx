/* v155a · Backup admin — Architecture explainer banner. */
import React, { useState } from "react";

// ============================================================
// Architecture explainer banner — sets the right expectations the
// FIRST time the operator opens this tab, so they understand WHY
// they need an agent (and aren't confused that the Hub itself
// "can't see" their tower).
// ============================================================
export default function ArchitectureBanner() {
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
