"use client";

import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/types";

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
  variant?: "solid" | "subtle" | "outline" | "dot";
  size?: "sm" | "md";
  label?: string;
}

const RING_CLASSES: Record<Severity, string> = {
  critical: "border-severity-critical/40",
  high: "border-severity-high/40",
  medium: "border-severity-medium/40",
  low: "border-severity-low/40",
  info: "border-severity-info/40",
};

export function SeverityBadge({
  severity,
  className,
  variant = "subtle",
  size = "sm",
  label,
}: SeverityBadgeProps) {
  const sizeCls = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-1";

  if (variant === "dot") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span
          className={cn("h-1.5 w-1.5 rounded-full", `bg-severity-${severity}`)}
          aria-hidden
        />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label || severity}
        </span>
      </span>
    );
  }

  if (variant === "outline") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wider",
          sizeCls,
          RING_CLASSES[severity],
          className,
        )}
      >
        <span className={cn("h-1 w-1 rounded-full", `bg-severity-${severity}`)} aria-hidden />
        {label || severity}
      </span>
    );
  }

  if (variant === "solid") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-semibold uppercase tracking-wider text-white",
          sizeCls,
          `bg-severity-${severity}`,
          severity === "medium" && "text-black",
          className,
        )}
      >
        {label || severity}
      </span>
    );
  }

  // subtle (default) — tinted background
  const tintCls: Record<Severity, string> = {
    critical: "bg-severity-critical/15 text-severity-critical",
    high: "bg-severity-high/15 text-severity-high",
    medium: "bg-severity-medium/15 text-severity-medium",
    low: "bg-severity-low/15 text-severity-low",
    info: "bg-severity-info/15 text-severity-info",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold uppercase tracking-wider",
        sizeCls,
        tintCls[severity],
        className,
      )}
    >
      <span className={cn("h-1 w-1 rounded-full", `bg-severity-${severity}`)} aria-hidden />
      {label || severity}
    </span>
  );
}

// Status badge for stages/runs/findings
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-status-info/15 text-status-info",
  paused: "bg-status-warning/15 text-status-warning",
  completed: "bg-status-success/15 text-status-success",
  failed: "bg-status-error/15 text-status-error",
  cancelled: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
  new: "bg-primary/15 text-primary",
  todo: "bg-muted text-muted-foreground",
  "in-progress": "bg-status-info/15 text-status-info",
  reported: "bg-status-success/15 text-status-success",
  closed: "bg-muted text-muted-foreground",
  "false-positive": "bg-muted text-muted-foreground",
};

export function StatusBadge({
  status,
  className,
  size = "sm",
  animate = false,
}: {
  status: string;
  className?: string;
  size?: "sm" | "md";
  animate?: boolean;
}) {
  const sizeCls = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-1";
  const color = STATUS_COLORS[status] || "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold uppercase tracking-wider",
        sizeCls,
        color,
        animate && status === "running" && "animate-pulse-live",
        className,
      )}
    >
      {status}
    </span>
  );
}

// NEW badge for program scope items
export function NewBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded bg-primary px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-foreground",
        className,
      )}
    >
      New
    </span>
  );
}
