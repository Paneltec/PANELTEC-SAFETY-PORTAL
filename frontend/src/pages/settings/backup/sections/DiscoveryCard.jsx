/* v155a · Backup admin — mDNS-discovered SMB targets card. */
import React from "react";
import { Wifi } from "lucide-react";
import { Section, INK, PAPER, th, td } from "../lib/styles";

// ============================================================
// mDNS-discovered SMB targets
// ============================================================
export default function DiscoveryCard({ discovered }) {
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
