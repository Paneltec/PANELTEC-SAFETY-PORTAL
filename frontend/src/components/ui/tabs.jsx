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
        ? "inline-flex items-center gap-4"
        : "inline-flex h-10 items-center gap-1 rounded-full bg-white/90 border border-slate-200 p-1 shadow-sm",
      className
    )}
    {...props} />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef(({ className, variant, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      variant === "hero"
        ? cn(
            "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-all cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40",
            "disabled:pointer-events-none disabled:opacity-50",
            // Inactive = text-link
            "text-sm font-semibold text-slate-500 hover:text-[#1e4a8c] hover:underline underline-offset-4 px-1",
            // Active = filled CTA capsule
            "data-[state=active]:no-underline data-[state=active]:text-white",
            "data-[state=active]:bg-[#1e4a8c] data-[state=active]:rounded-full",
            "data-[state=active]:px-5 data-[state=active]:py-2.5 data-[state=active]:text-base",
            "data-[state=active]:shadow-lg data-[state=active]:shadow-[#1e4a8c]/20",
            // Count-badge chip adapts to active/inactive
            "[&_span]:tabular-nums",
            "[&[data-state=active]_span]:!bg-white/20 [&[data-state=active]_span]:!text-white"
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
