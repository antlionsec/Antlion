// ============================================================================
// ANTLION — Types
// Shared TypeScript types across the application.
// ============================================================================

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type FindingType =
  | "vulnerability"
  | "subdomain"
  | "asset"
  | "port"
  | "secret"
  | "takeover"
  | "endpoint"
  | "tech";

export type ProjectStatus = "active" | "archived" | "soft-deleted";
export type ProjectColor =
  | "slate"
  | "teal"
  | "amber"
  | "rose"
  | "emerald"
  | "violet"
  | "cyan";

export type ViewKind =
  | "dashboard"
  | "target-selection"
  | "pipeline-config"
  | "pipeline-run"
  | "results"
  | "reports"
  | "settings"
  | "audit-log"
  | "overview";

export type FindingStatus =
  | "new"
  | "todo"
  | "in-progress"
  | "reported"
  | "closed"
  | "false-positive";

export interface TargetAsset {
  id: string;
  value: string;
  type: "wildcard" | "domain" | "url" | "ip" | "cidr" | "mobile" | "api";
  origin: string;
  isNew?: boolean;
  inScope: boolean;
  updatedAt?: string;
  instructions?: string;
}

export interface PipelineStageConfig {
  id: string;
  name: string;
  toolIds: string[];
  enabled: boolean;
  intensity?: "stealth" | "normal" | "aggressive";
  parallelSafe: boolean;
  description: string;
  category: string;
  required: boolean;
}

export interface PipelineConfig {
  stages: PipelineStageConfig[];
  concurrency: number;
  rateLimit: number;
  enableScreenshots: boolean;
  pauseAfterVulnScan: boolean;
  userAgentRotation: boolean;
  outputDir: string;
}

export interface RunStageState {
  id: string;
  name: string;
  tool: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "paused";
  progress: number;
  logs: { ts: string; level: "inf" | "wrn" | "err"; text: string }[];
  startedAt?: string;
  finishedAt?: string;
  findingsCount: number;
  error?: string;
}

export interface RunState {
  id: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  stages: RunStageState[];
  currentStageIndex: number;
  startedAt?: string;
  finishedAt?: string;
  etaSeconds?: number;
  totalFindings: number;
  totalAssets: number;
  resourceStats: { cpu: number; ram: number; disk: number };
}
