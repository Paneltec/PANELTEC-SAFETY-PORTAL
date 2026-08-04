// v160.3.9.43.1 — Green + Orange pill-toggle pair.
//
// Shared visual for the two-state tab pairs across the app (Users
// list/dashboard, Workers list/dashboard, Contractors active/archived,
// Outbox sent/failed, etc. — see the v43 audit table for the 12
// approved sites). Semantics live on the surrounding Radix `<Tabs>`
// component — this file owns visuals only. Keyboard nav + focus rings
// are provided by the Radix triggers we render underneath.
//
// Colour mapping is POSITION-BASED, not semantic:
//   • Left  (position 1) → emerald
//   • Right (position 2) → orange
// This matches the user-provided reference screenshot and avoids the
// judgement call of "which state deserves green".
//
// Active tab uses solid fill + white text; inactive tab uses the pale
// tint variant so both pills stay visible at once. Optional inline
// count badge renders inside the pill (soft white translucent for
// active, soft opaque for inactive).
import React from "react";

const COLOURS = {
  emerald: {
    active: "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700",
    inactive: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
    badgeActive: "bg-white/25 text-white",
    badgeInactive: "bg-white text-emerald-800",
  },
  orange: {
    active: "bg-orange-500 text-white border-orange-500 hover:bg-orange-600",
    inactive: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100",
    badgeActive: "bg-white/25 text-white",
    badgeInactive: "bg-white text-orange-800",
  },
};

function Pill({ label, count, active, colour, onClick, testId }) {
  const c = COLOURS[colour] || COLOURS.emerald;
  const cls = active ? c.active : c.inactive;
  const badgeCls = active ? c.badgeActive : c.badgeInactive;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active ? "true" : "false"}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      data-testid={testId}
      data-active={active ? "true" : "false"}
      className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-sm font-medium transition-colors ${cls}`}
    >
      <span>{label}</span>
      {count != null && (
        <span className={`inline-flex items-center justify-center min-w-[24px] px-2 text-[11px] font-semibold rounded-full ${badgeCls}`}>
          {count}
        </span>
      )}
    </button>
  );
}

export function PillTogglePair({
  leftLabel, leftCount, leftActive, leftTestId, onLeftClick,
  rightLabel, rightCount, rightActive, rightTestId, onRightClick,
  leftColour = "emerald", rightColour = "orange",
  className = "",
}) {
  // ArrowLeft / ArrowRight moves focus between the two pills; the
  // active one is the tab-stop (see `tabIndex` above).
  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft" && !leftActive) { onLeftClick && onLeftClick(); e.preventDefault(); }
    if (e.key === "ArrowRight" && !rightActive) { onRightClick && onRightClick(); e.preventDefault(); }
  };
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <Pill label={leftLabel} count={leftCount} active={leftActive}
            colour={leftColour} onClick={onLeftClick} testId={leftTestId} />
      <Pill label={rightLabel} count={rightCount} active={rightActive}
            colour={rightColour} onClick={onRightClick} testId={rightTestId} />
    </div>
  );
}

export default PillTogglePair;
