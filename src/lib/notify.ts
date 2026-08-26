import { db } from "@/lib/db";
import nodemailer from "nodemailer";
import type { NotifyEmailConfig, NotifyEvent, NotifyFinding, NotifyHook, NotifyPayload } from "./notify-shared";

export type { HookType, NotifyEmailConfig, NotifyHookEvents, NotifyHook, NotifyEvent, NotifyFinding, NotifyPayload } from "./notify-shared";

// ANTLION — Global Notification Hooks (server-side dispatcher)
//
// Outbound notifications for pipeline events. Hooks are configured
// ONCE in the global settings dialog (landing page → gear icon) and apply to
// EVERY project — there is deliberately no per-project notification config.
//
// Supported targets:
//   discord  — incoming webhook URL (embeds)
//   slack    — incoming webhook URL (mrkdwn blocks)
//   telegram — bot token + chat id
//   email    — any SMTP account (Gmail app password, Mailgun SMTP, self-hosted…)
//   generic  — any HTTP endpoint accepting JSON (payload documented below)
//
// Delivery is best-effort: a failing hook NEVER fails a pipeline run.
//
// NOTE: this module is server-only (db + nodemailer). Client components must
// import types/constants from ./notify-shared instead.

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const SEVERITY_COLOR: Record<string, number> = {
  critical: 0xef4444,
  high: 0xf97316,
  medium: 0xeab308,
  low: 0x3b82f6,
  info: 0x64748b,
};

const EVENT_LABEL: Record<NotifyEvent, string> = {
  "run.completed": "Run completed",
  "run.failed": "Run failed",
  "findings.new": "New findings",
};

// ----------------------------------------------------------------------------
// Storage (DB Setting "notifyHooks" — global, project-independent)
// ----------------------------------------------------------------------------

export async function loadNotifyHooks(): Promise<NotifyHook[]> {
  try {
    const row = await db.setting.findUnique({ where: { id: "notifyHooks" } });
    if (!row?.value) return [];
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (h) => h && (typeof h.url === "string" || (h.email && typeof h.email.host === "string")),
    );
  } catch {
    return [];
  }
}

export async function saveNotifyHooks(hooks: NotifyHook[]): Promise<void> {
  await db.setting.upsert({
    where: { id: "notifyHooks" },
    create: { id: "notifyHooks", value: JSON.stringify(hooks) },
    update: { value: JSON.stringify(hooks) },
  });
}

// ----------------------------------------------------------------------------
// Formatting per platform
// ----------------------------------------------------------------------------

function eventColor(event: NotifyEvent, severity?: string): number {
  if (event === "run.completed") return 0x22c55e;
  if (event === "run.failed") return 0xef4444;
  return SEVERITY_COLOR[severity || "info"] ?? 0x64748b;
}

function findingsBlock(findings: NotifyFinding[]): string {
  return findings
    .map((f) => `• [${f.severity.toUpperCase()}] ${f.title}${f.target ? ` — ${f.target}` : ""}`)
    .join("\n");
}

function buildDiscordBody(event: NotifyEvent, payload: NotifyPayload) {
  const embed: any = {
    title: payload.title,
    description: payload.message,
    color: eventColor(event, payload.severity),
    fields: (payload.fields || []).map((f) => ({ name: f.name, value: f.value, inline: true })),
    footer: { text: `Antlion · ${EVENT_LABEL[event]}` },
    timestamp: new Date().toISOString(),
  };
  if (payload.findings?.length) {
    embed.description = `${payload.message ? payload.message + "\n\n" : ""}${findingsBlock(payload.findings.slice(0, 10))}`;
    if (payload.findings.length > 10) {
      embed.description += `\n• …and ${payload.findings.length - 10} more`;
    }
  }
  return { username: "Antlion", embeds: [embed] };
}

function buildSlackBody(event: NotifyEvent, payload: NotifyPayload) {
  const lines: string[] = [`*${payload.title}*`];
  if (payload.message) lines.push(payload.message);
  for (const f of payload.fields || []) lines.push(`> *${f.name}:* ${f.value}`);
  if (payload.findings?.length) {
    lines.push("");
    lines.push(payload.findings.slice(0, 10).map((f) => `• *[${f.severity.toUpperCase()}]* ${f.title}${f.target ? ` — ${f.target}` : ""}`).join("\n"));
    if (payload.findings.length > 10) lines.push(`…and ${payload.findings.length - 10} more`);
  }
  return { text: lines.join("\n") };
}

function buildTelegramText(event: NotifyEvent, payload: NotifyPayload): string {
  const lines: string[] = [`<b>${escapeHtml(payload.title)}</b>`];
  if (payload.message) lines.push(escapeHtml(payload.message));
  for (const f of payload.fields || []) lines.push(`<b>${escapeHtml(f.name)}:</b> ${escapeHtml(f.value)}`);
  if (payload.findings?.length) {
    lines.push("");
    lines.push(
      payload.findings
        .slice(0, 10)
        .map((f) => `• <b>[${f.severity.toUpperCase()}]</b> ${escapeHtml(f.title)}${f.target ? ` — ${escapeHtml(f.target)}` : ""}`)
        .join("\n"),
    );
    if (payload.findings.length > 10) lines.push(`…and ${payload.findings.length - 10} more`);
  }
  return lines.join("\n");
}

function buildGenericBody(event: NotifyEvent, payload: NotifyPayload) {
  return {
    source: "antlion",
    event,
    eventLabel: EVENT_LABEL[event],
    title: payload.title,
    message: payload.message ?? null,
    severity: payload.severity ?? null,
    fields: payload.fields ?? [],
    findings: payload.findings ?? [],
    timestamp: new Date().toISOString(),
  };
}

function buildEmailMessage(event: NotifyEvent, payload: NotifyPayload): { subject: string; text: string; html: string } {
  const subject = `[Antlion] ${payload.title}`;

  const textLines: string[] = [];
  if (payload.message) textLines.push(payload.message, "");
  for (const f of payload.fields || []) textLines.push(`${f.name}: ${f.value}`);
  if (payload.fields?.length) textLines.push("");
  if (payload.findings?.length) {
    textLines.push("Findings:");
    textLines.push(findingsBlock(payload.findings.slice(0, 25)));
    if (payload.findings.length > 25) textLines.push(`…and ${payload.findings.length - 25} more`);
    textLines.push("");
  }
  textLines.push(`— Antlion · ${EVENT_LABEL[event]}`);

  const html: string[] = [`<h3 style="margin:0 0 12px">${escapeHtml(payload.title)}</h3>`];
  if (payload.message) html.push(`<p style="margin:0 0 12px">${escapeHtml(payload.message)}</p>`);
  if (payload.fields?.length) {
    html.push('<table style="border-collapse:collapse;margin:0 0 12px">');
    for (const f of payload.fields) {
      html.push(
        `<tr><td style="padding:2px 12px 2px 0;color:#777">${escapeHtml(f.name)}</td><td style="padding:2px 0"><b>${escapeHtml(f.value)}</b></td></tr>`,
      );
    }
    html.push("</table>");
  }
  if (payload.findings?.length) {
    html.push('<ul style="margin:0 0 12px;padding-left:18px">');
    for (const f of payload.findings.slice(0, 25)) {
      html.push(
        `<li><b>[${escapeHtml(f.severity.toUpperCase())}]</b> ${escapeHtml(f.title)}${f.target ? ` — ${escapeHtml(f.target)}` : ""}</li>`,
      );
    }
    html.push("</ul>");
    if (payload.findings.length > 25) html.push(`<p style="color:#777">…and ${payload.findings.length - 25} more</p>`);
  }
  html.push(`<p style="color:#999;font-size:12px">Antlion · ${escapeHtml(EVENT_LABEL[event])}</p>`);

  return { subject, text: textLines.join("\n"), html: html.join("") };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ----------------------------------------------------------------------------
// Delivery
// ----------------------------------------------------------------------------

async function deliverOne(hook: NotifyHook, event: NotifyEvent, payload: NotifyPayload): Promise<void> {
  let url: string;
  let body: unknown;

  if (hook.type === "email") {
    await deliverEmail(hook, event, payload);
    return;
  }

  switch (hook.type) {
    case "discord":
      url = hook.url;
      body = buildDiscordBody(event, payload);
      break;
    case "slack":
      url = hook.url;
      body = buildSlackBody(event, payload);
      break;
    case "telegram":
      if (!hook.chatId) throw new Error("Telegram hook is missing a chat id");
      url = `https://api.telegram.org/bot${hook.url.replace(/^.*bot/, "").trim()}/sendMessage`;
      body = { chat_id: hook.chatId, text: buildTelegramText(event, payload), parse_mode: "HTML" };
      break;
    default:
      url = hook.url;
      body = buildGenericBody(event, payload);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
}

/** Send one notification over SMTP via the hook's mail account. */
async function deliverEmail(hook: NotifyHook, event: NotifyEvent, payload: NotifyPayload): Promise<void> {
  const cfg = hook.email;
  if (!cfg?.host?.trim()) throw new Error("Email hook is missing its SMTP host");
  if (!cfg.to?.trim()) throw new Error("Email hook is missing the recipient address");

  const transport = {
    host: cfg.host.trim(),
    port: Number(cfg.port) || 587,
    secure: cfg.encryption === "ssl", // implicit TLS (465)
    requireTLS: cfg.encryption === "starttls", // fail if the server can't upgrade
    ignoreTLS: cfg.encryption === "none", // never upgrade (local relays)
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    ...(cfg.username || cfg.password ? { auth: { user: cfg.username || "", pass: cfg.password || "" } } : {}),
  };

  const message = buildEmailMessage(event, payload);
  const transporter = nodemailer.createTransport(transport);
  try {
    await transporter.sendMail({
      from: cfg.from?.trim() || "Antlion <antlion@localhost>",
      to: cfg.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } finally {
    transporter.close();
  }
}

function hookWantsEvent(hook: NotifyHook, event: NotifyEvent, payload: NotifyPayload): boolean {
  if (!hook.enabled) return false;
  if (event === "run.completed") return hook.events?.runCompleted !== false;
  if (event === "run.failed") return hook.events?.runFailed !== false;
  if (event === "findings.new") {
    if (hook.events?.newFindings === false) return false;
    const min = SEVERITY_RANK[hook.events?.minSeverity || "high"] ?? 4;
    // Only findings at/above the hook's threshold trigger delivery.
    return (payload.findings || []).some((f) => (SEVERITY_RANK[f.severity] ?? 1) >= min);
  }
  return false;
}

/**
 * Fire a notification to every enabled global hook subscribed to the event.
 * Never throws — a broken webhook must not break a pipeline run.
 */
export async function dispatchNotifications(event: NotifyEvent, payload: NotifyPayload): Promise<void> {
  try {
    const hooks = await loadNotifyHooks();
    const targets = hooks.filter((h) => hookWantsEvent(h, event, payload));
    if (targets.length === 0) return;

    const results = await Promise.allSettled(
      targets.map(async (h) => {
        try {
          await deliverOne(h, event, payload);
        } catch (e: any) {
          console.error(`[notify] hook "${h.name}" (${h.type}) failed: ${e?.message || e}`);
        }
      }),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) console.error(`[notify] ${failed}/${targets.length} hook(s) rejected`);
  } catch (e: any) {
    console.error(`[notify] dispatch failed: ${e?.message || e}`);
  }
}

/**
 * Send a test notification to a single (possibly unsaved) hook config.
 * Used by the "Send test" button in the global settings dialog.
 */
export async function sendTestNotification(hook: NotifyHook): Promise<void> {
  await deliverOne(hook, "findings.new", {
    title: "Antlion test notification",
    message: "If you can read this, the hook is wired up correctly. It will fire for every project.",
    fields: [{ name: "Hook", value: hook.name || "(unnamed)" }, { name: "Type", value: hook.type }],
    severity: "info",
  });
}
