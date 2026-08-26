// ANTLION — Notification hook types & defaults (client-safe).
//
// Pure types + constants shared between the global settings dialog (client)
// and the server-side dispatcher in notify.ts. This file must stay free of
// Node-only imports (nodemailer, db) so it can be bundled for the browser.

export type HookType = "discord" | "slack" | "telegram" | "email" | "generic";

/** SMTP settings for email hooks. Stored locally (SQLite) like telegram bot tokens. */
export interface NotifyEmailConfig {
  /** SMTP server host, e.g. smtp.gmail.com */
  host: string;
  /** SMTP port — 587 (STARTTLS), 465 (SSL), 25 (plain relay). */
  port: number;
  /** Connection security. */
  encryption: "starttls" | "ssl" | "none";
  /** SMTP AUTH username (optional for unauthenticated local relays). */
  username?: string;
  /** SMTP AUTH password / app password. */
  password?: string;
  /** From address, e.g. "Antlion <you@gmail.com>". */
  from: string;
  /** Comma-separated recipient list. */
  to: string;
}

export interface NotifyHookEvents {
  /** Pipeline run finished successfully. */
  runCompleted: boolean;
  /** Pipeline run failed. */
  runFailed: boolean;
  /** New findings were persisted during a run (filtered by minSeverity). */
  newFindings: boolean;
  /** Minimum severity that triggers a newFindings notification. */
  minSeverity: "critical" | "high" | "medium" | "low" | "info";
}

export interface NotifyHook {
  id: string;
  name: string;
  type: HookType;
  /** Webhook URL (discord/slack/generic) or bot token (telegram). Unused for email. */
  url: string;
  /** Telegram chat id — only used by telegram hooks. */
  chatId?: string;
  /** SMTP settings — only used by email hooks. */
  email?: NotifyEmailConfig;
  enabled: boolean;
  events: NotifyHookEvents;
}

export type NotifyEvent = "run.completed" | "run.failed" | "findings.new";

export interface NotifyFinding {
  title: string;
  severity: string;
  target?: string | null;
}

export interface NotifyPayload {
  title: string;
  message?: string;
  fields?: { name: string; value: string }[];
  /** Severity hint for color coding (critical|high|medium|low|info). */
  severity?: string;
  /** Findings to render inline (findings.new only). */
  findings?: NotifyFinding[];
}

export const DEFAULT_HOOK_EVENTS: NotifyHookEvents = {
  runCompleted: true,
  runFailed: true,
  newFindings: true,
  minSeverity: "high",
};
