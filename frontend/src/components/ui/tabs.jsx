import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

// v160.3.6h — Segmented-control tab switcher. Both tabs read as first-class
// buttons: active is a filled Paneltec-blue capsule, inactive keeps bold
// slate-700 text (not muted) with a hover tint so the affordance is obvious.
// Any consumer already using shadcn Tabs picks the new look up for free.
//
// v160.3.6i — Optional `variant="hero"` on TabsList + TabsTrigger promotes
// the active tab to a full CTA (large pill, blue fill, shadow) while the
// inactive tab retracts to a text-link. Perfect for "list is the primary
// action, dashboard is the summary" pages. Opt-in — legacy consumers still
// get the equal-weight v160.3.6h segmented control.
const TabsList = React.forwardRef(({ className, variant, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      variant === "hero"
        ? "inline-flex flex-row-reverse items-center gap-4"
        : "inline-flex h-10 items-center gap-1 rounded-full bg-white/90 border border-slate-200 p-1 shadow-sm",
      className
    )}
    {...props} />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef(({ className, variant, emphasis, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      variant === "hero"
        ? emphasis === "secondary"
          // v160.3.6k — Secondary tab (Dashboard): ALWAYS subdued text-link.
          // Never a peer to the primary capsule. Tiny inactive, slightly
          // heavier when active but never a capsule / border / shadow.
          ? cn(
              "inline-flex items-center gap-1 whitespace-nowrap transition-all cursor-pointer",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40",
              "text-[11px] font-medium uppercase tracking-wider text-slate-400 px-1 py-1",
              "hover:text-slate-600 hover:underline underline-offset-4 decoration-slate-300",
              "data-[state=active]:text-[#1e4a8c] data-[state=active]:text-sm",
              "data-[state=active]:font-semibold data-[state=active]:normal-case data-[state=active]:tracking-normal",
              "data-[state=active]:underline data-[state=active]:decoration-[#1e4a8c]/50",
              "[&_span]:tabular-nums"
            )
          // v160.3.6k — Primary tab (List): ALWAYS a big capsule. Filled when
          // active, outlined when inactive. Same physical size in both states,
          // so List commands attention permanently rather than shrinking away
          // whenever Dashboard is selected.
          : cn(
              "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-all cursor-pointer",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40",
              "disabled:pointer-events-none disabled:opacity-50",
              // Base capsule (INACTIVE) — outlined blue on white
              "rounded-full px-5 py-2.5 text-base font-semibold",
              "border-2 border-[#1e4a8c] text-[#1e4a8c] bg-white hover:bg-[#e6eff9]",
              // ACTIVE state — filled blue with white text + shadow lift
              "data-[state=active]:bg-[#1e4a8c] data-[state=active]:text-white data-[state=active]:border-transparent",
              "data-[state=active]:shadow-lg data-[state=active]:shadow-[#1e4a8c]/20",
              // v160.3.6l — Count badge is an elliptical oval:
              // wider than tall via px-2.5 py-0.5 + rounded-full = true ellipse.
              // Inactive: solid Paneltec-blue oval with white text on the white capsule.
              // Active: subtly translucent white oval with a ring inset so the
              // number floats gracefully on the blue capsule without a hard pill.
              "[&_span]:tabular-nums [&_span]:leading-none",
              "[&_span]:!px-2.5 [&_span]:!py-0.5 [&_span]:!rounded-full",
              "[&_span]:!bg-[#1e4a8c] [&_span]:!text-white",
              "[&[data-state=active]_span]:!bg-white/25 [&[data-state=active]_span]:!text-white",
              "[&[data-state=active]_span]:ring-1 [&[data-state=active]_span]:ring-inset [&[data-state=active]_span]:ring-white/40"
            )
        : cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all cursor-pointer",
            "text-slate-700 hover:bg-slate-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40",
            "disabled:pointer-events-none disabled:opacity-50",
            "data-[state=active]:bg-[#1e4a8c] data-[state=active]:text-white data-[state=active]:shadow",
            "[&_span]:tabular-nums [&[data-state=active]_span]:text-white/80 [&[data-state=active]_span]:!bg-white/15 [&[data-state=active]_span]:!text-white"
          ),
      className
    )}
    {...props} />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props} />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
