/* v155a · Backup admin — inline-style tokens and layout atoms.
 * Extracted verbatim from the pre-v155a BackupTab.jsx monolith.
 *
 * The Backup admin surface uses its own bespoke inline-style system
 * (INK / PAPER / ACCENT palette + hand-rolled Section headings and
 * Pills) that predates the app-wide Tailwind rollout — see the file
 * header of the pre-v155a monolith for the Portal→Civil graft
 * history. Keeping the atoms in one place makes future consolidation
 * easier without changing v154 pixel output today.
 */
import React from "react";

export const INK = "#0e1a2b";
export const PAPER = "#f3efe6";
export const ACCENT = "#fbbf24";

export function Section({ title, icon, action, children }) {
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

export function Row({ children }) {
  return <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>{children}</div>;
}

export function Field({ label, children }) {
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

export function Empty({ children }) {
  return <div style={{ padding: 18, color: "#64748b", fontSize: 13 }}>{children}</div>;
}

export function Pill({ ok, mini, children }) {
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

export const inp = () => ({
  width: "100%", padding: "7px 10px", border: `1px solid ${INK}33`,
  borderRadius: 6, fontSize: 13, background: "white",
  fontFamily: "Archivo Narrow, sans-serif",
});
export const th = () => ({
  padding: "8px 10px", textAlign: "left", fontSize: 11,
  letterSpacing: "0.16em", textTransform: "uppercase",
});
export const td = () => ({ padding: "8px 10px", verticalAlign: "middle" });
export const btn = (bg) => ({
  background: bg || "white", color: INK,
  padding: "6px 12px", border: `1px solid ${INK}55`, borderRadius: 6,
  fontSize: 12, fontWeight: 700, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
  fontFamily: "Archivo, sans-serif",
});
export const cardStyle = () => ({
  background: "white", border: `1px solid ${INK}22`,
  padding: 16, borderRadius: 8, marginBottom: 14,
});
