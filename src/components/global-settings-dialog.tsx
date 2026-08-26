"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Globe,
  Key,
  Palette,
  ServerCog,
  Plus,
  Trash2,
  Send,
  Loader2,
  Save,
  CheckCircle2,
  XCircle,
  Terminal,
  Sun,
  Moon,
  Monitor,
  Eye,
  EyeOff,
  RefreshCw,
  Webhook,
  MessageSquareWarning,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useGlobalSettingsStore } from "@/lib/stores/global-settings-store";
import { useToolStatus } from "@/hooks/use-tool-status";
import { PlatformLoginPanel, type PlatformAuthEntry } from "@/components/antlion/platform-login-panel";
import { DEFAULT_HOOK_EVENTS, type NotifyHook, type HookType, type NotifyEmailConfig } from "@/lib/notify-shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ----------------------------------------------------------------------------
// Global Settings dialog.
//
// Everything in here is GLOBAL: it applies to every project container.
//   • Notification hooks — webhook alerts for pipeline events (all projects)
//   • Platform accounts  — shared auth for discovery & scope import
//   • API keys           — injected into every pipeline tool environment
//   • Appearance         — theme preference
//   • Tools              — machine-level tool detection
// There is deliberately no per-project configuration for any of these.
// ----------------------------------------------------------------------------

const TABS = [
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "accounts", label: "Platform Accounts", icon: Globe },
  { id: "keys", label: "API Keys", icon: Key },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "tools", label: "Tools", icon: ServerCog },
] as const;

const API_KEY_FIELDS = [
  { key: "SHODAN_API_KEY", label: "Shodan API Key" },
  { key: "CENSYS_API_ID", label: "Censys API ID" },
  { key: "CENSYS_API_SECRET", label: "Censys API Secret" },
  { key: "ZOOMEYE_API_KEY", label: "ZoomEye API Key" },
  { key: "GITHUB_TOKEN", label: "GitHub Token (recon)" },
  { key: "VIRUSTOTAL_API_KEY", label: "VirusTotal API Key" },
  { key: "SECURITYTRAILS_API_KEY", label: "SecurityTrails API Key" },
  { key: "CHaos_API_KEY", label: "Chaos API Key" },
];

const HOOK_TYPES: { value: HookType; label: string; hint: string }[] = [
  { value: "discord", label: "Discord", hint: "Server Settings → Integrations → Webhooks" },
  { value: "slack", label: "Slack", hint: "App → Incoming Webhooks" },
  { value: "telegram", label: "Telegram", hint: "Bot token from @BotFather + your chat id" },
  { value: "email", label: "Email (SMTP)", hint: "Gmail app password, Mailgun SMTP, self-hosted — anything that speaks SMTP" },
  { value: "generic", label: "Generic webhook", hint: "Any endpoint accepting JSON POST" },
];

const EMPTY_EMAIL: NotifyEmailConfig = {
  host: "",
  port: 587,
  encryption: "starttls",
  username: "",
  password: "",
  from: "",
  to: "",
};

const ENCRYPTION_LABEL: Record<NotifyEmailConfig["encryption"], string> = {
  starttls: "STARTTLS (587)",
  ssl: "SSL/TLS (465)",
  none: "None (local relay)",
};

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

export function GlobalSettingsDialog() {
  const { open, tab: activeTab, closeGlobalSettings, openGlobalSettings, setTab } = useGlobalSettingsStore();

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? openGlobalSettings() : closeGlobalSettings())}>
      <DialogContent className="sm:max-w-4xl w-[calc(100%-1.5rem)] h-[85vh] max-h-[85vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="p-5 pb-4 border-b border-border flex-shrink-0 pr-14">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4 text-primary" />
            Global Settings
          </DialogTitle>
          <DialogDescription className="text-xs">
            These settings apply to <b>every project</b> — notification hooks, platform accounts and API
            keys are shared across all project containers. Nothing here is configured per-project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          {/* Tab rail — vertical on desktop, horizontal scroll on mobile */}
          <nav className="flex sm:flex-col gap-1 p-2 border-b sm:border-b-0 sm:border-r border-border overflow-x-auto flex-shrink-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0",
                  activeTab === t.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto min-h-0 p-5">
            {activeTab === "notifications" && <NotificationsTab />}
            {activeTab === "accounts" && <AccountsTab />}
            {activeTab === "keys" && <ApiKeysTab />}
            {activeTab === "appearance" && <AppearanceTab />}
            {activeTab === "tools" && <ToolsTab />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Notifications tab — global webhook hooks
// ----------------------------------------------------------------------------

function NotificationsTab() {
  const [hooks, setHooks] = useState<NotifyHook[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/settings");
      const d = await r.json();
      const raw = d.settings?.notifyHooks;
      const parsed: NotifyHook[] = raw ? JSON.parse(raw) : [];
      setHooks(Array.isArray(parsed) ? parsed : []);
      setDirty(false);
    } catch {
      setHooks([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = (id: string, patch: Partial<NotifyHook>) => {
    setHooks((prev) => (prev || []).map((h) => (h.id === id ? { ...h, ...patch } : h)));
    setDirty(true);
  };

  const addHook = () => {
    setHooks((prev) => [
      ...(prev || []),
      {
        id: `hook_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: "",
        type: "discord",
        url: "",
        chatId: "",
        enabled: true,
        events: { ...DEFAULT_HOOK_EVENTS },
      },
    ]);
    setDirty(true);
  };

  const removeHook = (id: string) => {
    setHooks((prev) => (prev || []).filter((h) => h.id !== id));
    setDirty(true);
  };

  const save = async () => {
    const list = hooks || [];
    const bad = list.find((h) => {
      if (!h.enabled) return false;
      if (h.type === "email") {
        const e = h.email;
        return !e?.host?.trim() || !e?.to?.trim() || !e?.from?.trim();
      }
      return !h.url || h.url.trim().length < 8 || (h.type === "telegram" && !h.chatId);
    });
    if (bad) {
      toast.error(
        "An enabled hook is missing required fields (webhook URL, Telegram chat id, or SMTP host / from / to) — fill it in or disable the hook",
      );
      return;
    }
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notifyHooks: JSON.stringify(
            list.map((h) => ({ ...h, name: h.name.trim() || `${h.type} hook` })),
          ),
        }),
      });
      toast.success(`Saved ${list.length} notification hook${list.length === 1 ? "" : "s"}`);
      setDirty(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (hooks === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-40 rounded-lg bg-muted/40 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-[11px] text-muted-foreground leading-relaxed">
        <div className="flex items-center gap-1.5 font-medium text-foreground mb-1">
          <MessageSquareWarning className="h-3.5 w-3.5 text-primary" />
          Global notification hooks
        </div>
        Hooks fire for pipeline events in <b>every project</b>: run completed, run failed, and new
        findings at or above your chosen severity. Configure once here — no per-project setup.
        Delivery is best-effort; a failing webhook never breaks a run.
      </div>

      {hooks.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-8 px-6 text-center">
          <Bell className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          <div className="text-sm font-medium mb-0.5">No notification hooks</div>
          <div className="text-xs text-muted-foreground mb-3">
            Get a Discord, Slack or Telegram webhook — or use any SMTP account for email alerts —
            and add it here. Antlion will ping you when runs finish or findings land, for every project.
          </div>
          <Button size="sm" variant="outline" onClick={addHook}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add hook
          </Button>
        </div>
      )}

      {hooks.map((hook) => (
        <HookCard
          key={hook.id}
          hook={hook}
          onChange={(patch) => update(hook.id, patch)}
          onRemove={() => removeHook(hook.id)}
        />
      ))}

      {(hooks.length > 0 || dirty) && (
        <div className={cn("flex items-center gap-2 pt-1", hooks.length > 0 ? "justify-between" : "justify-end")}>
          {hooks.length > 0 && (
            <Button size="sm" variant="outline" onClick={addHook}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add hook
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!dirty || saving} className="bg-primary hover:bg-primary/90">
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            {dirty ? "Save hooks" : "Saved"}
          </Button>
        </div>
      )}
    </div>
  );
}

function HookCard({
  hook,
  onChange,
  onRemove,
}: {
  hook: NotifyHook;
  onChange: (patch: Partial<NotifyHook>) => void;
  onRemove: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const typeMeta = HOOK_TYPES.find((t) => t.value === hook.type) || HOOK_TYPES[0];
  const email = hook.email || EMPTY_EMAIL;

  const updateEmail = (patch: Partial<NotifyEmailConfig>) =>
    onChange({ email: { ...email, ...patch } });

  const changeType = (v: HookType) =>
    onChange(v === "email" && !hook.email ? { type: v, email: { ...EMPTY_EMAIL } } : { type: v });

  const testable =
    hook.type === "email"
      ? !!(email.host?.trim() && email.to?.trim() && email.from?.trim())
      : !!(hook.url && (hook.type !== "telegram" || hook.chatId));

  const test = async () => {
    setTesting(true);
    try {
      const r = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hook),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Delivery failed");
      toast.success("Test notification delivered");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={cn("rounded-lg border p-3.5 space-y-3", !hook.enabled && "opacity-60")}>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px] uppercase flex-shrink-0">
          {hook.type === "generic" ? "webhook" : hook.type}
        </Badge>
        <div className="flex-1 min-w-[120px] text-xs font-medium truncate">
          {hook.name || "(unnamed hook)"}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Label className="text-[10px] text-muted-foreground">Enabled</Label>
          <Switch checked={hook.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-status-error"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input
            value={hook.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Team Discord"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Type</Label>
          <Select value={hook.type} onValueChange={changeType}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOOK_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {hook.type === "email" ? (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">SMTP host</Label>
              <Input
                value={email.host}
                onChange={(e) => updateEmail({ host: e.target.value })}
                placeholder="smtp.gmail.com"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Port</Label>
              <Input
                type="number"
                min={1}
                max={65535}
                value={email.port || ""}
                onChange={(e) => updateEmail({ port: parseInt(e.target.value, 10) || 0 })}
                placeholder="587"
                className="h-8 text-xs font-mono"
              />
              <div className="text-[10px] text-muted-foreground">587 STARTTLS · 465 SSL · 25 plain</div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Encryption</Label>
              <Select
                value={email.encryption || "starttls"}
                onValueChange={(v) => updateEmail({ encryption: v as NotifyEmailConfig["encryption"] })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ENCRYPTION_LABEL) as NotifyEmailConfig["encryption"][]).map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">
                      {ENCRYPTION_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-[10px] text-muted-foreground">{typeMeta.hint}</div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input
                value={email.from}
                onChange={(e) => updateEmail({ from: e.target.value })}
                placeholder="Antlion <you@gmail.com>"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Username</Label>
              <Input
                value={email.username || ""}
                onChange={(e) => updateEmail({ username: e.target.value })}
                placeholder="you@gmail.com (optional for local relays)"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Password</Label>
              <div className="relative">
                <Input
                  type={showSmtpPass ? "text" : "password"}
                  value={email.password || ""}
                  onChange={(e) => updateEmail({ password: e.target.value })}
                  placeholder="App password for Gmail"
                  className="h-8 text-xs font-mono pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowSmtpPass((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSmtpPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Stored locally in your database, like Telegram bot tokens.
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">To</Label>
              <Input
                value={email.to}
                onChange={(e) => updateEmail({ to: e.target.value })}
                placeholder="team@example.com, you@example.com"
                className="h-8 text-xs font-mono"
              />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {hook.type === "telegram" ? "Bot token" : hook.type === "generic" ? "Endpoint URL" : "Webhook URL"}
              </Label>
              <Input
                value={hook.url}
                onChange={(e) => onChange({ url: e.target.value })}
                placeholder={
                  hook.type === "telegram"
                    ? "123456:ABC-DEF..."
                    : hook.type === "discord"
                      ? "https://discord.com/api/webhooks/..."
                      : "https://hooks.slack.com/services/..."
                }
                className="h-8 text-xs font-mono"
              />
              <div className="text-[10px] text-muted-foreground">{typeMeta.hint}</div>
            </div>
            {hook.type === "telegram" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Chat ID</Label>
                <Input
                  value={hook.chatId || ""}
                  onChange={(e) => onChange({ chatId: e.target.value })}
                  placeholder="-1001234567890"
                  className="h-8 text-xs font-mono"
                />
                <div className="text-[10px] text-muted-foreground">
                  Group chats are negative; DM the bot once first.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Separator />

      <div className="space-y-2.5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Notify on
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <EventToggle
            label="Run completed"
            checked={hook.events?.runCompleted !== false}
            onCheckedChange={(v) => onChange({ events: { ...hook.events, runCompleted: v } })}
          />
          <EventToggle
            label="Run failed"
            checked={hook.events?.runFailed !== false}
            onCheckedChange={(v) => onChange({ events: { ...hook.events, runFailed: v } })}
          />
          <EventToggle
            label="New findings"
            checked={hook.events?.newFindings !== false}
            onCheckedChange={(v) => onChange({ events: { ...hook.events, newFindings: v } })}
          />
        </div>
        {hook.events?.newFindings !== false && (
          <div className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">Minimum severity to alert:</Label>
            <Select
              value={hook.events?.minSeverity || "high"}
              onValueChange={(v) => onChange({ events: { ...hook.events, minSeverity: v as any } })}
            >
              <SelectTrigger className="h-7 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex justify-end pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={test}
          disabled={testing || !testable}
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
          Send test
        </Button>
      </div>
    </div>
  );
}

function EventToggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 cursor-pointer hover:bg-muted/40 transition-colors">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

// ----------------------------------------------------------------------------
// Platform accounts tab — shared across every project
// ----------------------------------------------------------------------------

function AccountsTab() {
  const [authStatus, setAuthStatus] = useState<PlatformAuthEntry[]>([]);

  const loadAuthStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/platform-auth");
      const d = await r.json();
      setAuthStatus(d.status || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // Deferred one tick so state updates land after the commit, not during it.
    const t = window.setTimeout(loadAuthStatus, 0);
    return () => window.clearTimeout(t);
  }, [loadAuthStatus]);

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
        Connect bug bounty platforms once with their official API keys — credentials persist
        locally in the database and are used automatically by <b>every project</b> (discovery,
        scope import, pipeline runs). Each key is validated against the platform&apos;s API before
        it is saved.
      </div>
      {authStatus.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4">Loading platform status…</div>
      ) : (
        authStatus.map((entry) => (
          <PlatformLoginPanel key={entry.platform} entry={entry} onAuthChanged={loadAuthStatus} />
        ))
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// API keys tab — injected into every pipeline tool environment
// ----------------------------------------------------------------------------

function ApiKeysTab() {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/settings");
      const d = await r.json();
      const s: Record<string, string> = {};
      for (const [k, v] of Object.entries(d.settings || {})) {
        if (k.startsWith("apikey_")) s[k.replace("apikey_", "")] = v as string;
      }
      setApiKeys(s);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveKey = async (name: string, value: string) => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ [`apikey_${name}`]: value }),
        headers: { "Content-Type": "application/json" },
      });
      toast.success(`${name} key saved`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
        Stored locally · never transmitted to any third party · injected into the tool environment
        of <b>every pipeline run, in every project</b> (Shodan, Censys and ZoomEye stages need
        their keys to run).
      </div>
      {API_KEY_FIELDS.map(({ key, label }) => (
        <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Label className="text-xs sm:w-44 flex-shrink-0 font-mono">{label}</Label>
          <div className="flex-1 relative flex items-center gap-2">
            <div className="flex-1 relative">
              <Input
                type={showKeys[key] ? "text" : "password"}
                value={apiKeys[key] || ""}
                onChange={(e) => setApiKeys((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={`Enter ${label}`}
                className="h-8 pr-9 font-mono text-xs"
              />
              <button
                onClick={() => setShowKeys((p) => ({ ...p, [key]: !p[key] }))}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKeys[key] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveKey(key, apiKeys[key] || "")}
              disabled={saving}
              className="h-8 flex-shrink-0"
            >
              <Save className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Appearance tab
// ----------------------------------------------------------------------------

function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <ThemeButton icon={Sun} label="Light" active={theme === "light"} onClick={() => setTheme("light")} />
        <ThemeButton icon={Moon} label="Dark" active={theme === "dark"} onClick={() => setTheme("dark")} />
        <ThemeButton icon={Monitor} label="System" active={theme === "system"} onClick={() => setTheme("system")} />
      </div>
      <div className="text-[10px] text-muted-foreground">
        Dark and light themes, with instant switching. Follows your system preference by default.
        Applies to the whole app.
      </div>
    </div>
  );
}

function ThemeButton({ icon: Icon, label, active, onClick }: { icon: React.ElementType; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors",
        active ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted/50",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Tools tab — machine-level detection
// ----------------------------------------------------------------------------

function ToolsTab() {
  const { scan: toolScan, loading: toolsLoading, refresh: refreshTools } = useToolStatus();
  const [refreshing, setRefreshing] = useState(false);

  const doRefresh = async () => {
    setRefreshing(true);
    await refreshTools();
    setRefreshing(false);
    toast.success("Tool scan refreshed from the command line");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[11px] text-muted-foreground max-w-md leading-relaxed">
          Detected by checking the command line (<code className="px-1 bg-muted rounded">which</code>).
          Missing tools are skipped honestly during pipeline runs — in every project.
          {toolScan && (
            <span className="ml-1">
              Last scan: {new Date(toolScan.scannedAt).toLocaleString()} ({(toolScan.durationMs / 1000).toFixed(1)}s).
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {toolScan && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                toolScan.installedCount === toolScan.totalCount
                  ? "border-status-success/40 text-status-success"
                  : "border-amber-500/40 text-amber-500",
              )}
            >
              {toolScan.installedCount} / {toolScan.totalCount} installed
            </Badge>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={doRefresh} disabled={refreshing || toolsLoading}>
            <RefreshCw className={cn("h-3 w-3 mr-1", (refreshing || toolsLoading) && "animate-spin")} />
            Rescan
          </Button>
        </div>
      </div>

      {toolsLoading && !toolScan ? (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {toolScan?.tools.map((tool) => (
            <div
              key={tool.id}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2.5 py-2",
                tool.installed ? "border-border bg-card" : "border-amber-500/30 bg-amber-500/5",
              )}
            >
              <Terminal className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{tool.name}</div>
                <div className="text-[9px] text-muted-foreground font-mono truncate">
                  {tool.installed ? tool.path : tool.binary}
                  {tool.installed && tool.version ? ` · v${tool.version.replace(/^v/, "")}` : ""}
                </div>
              </div>
              {tool.installed ? (
                <Badge variant="secondary" className="text-[9px] bg-status-success/15 text-status-success gap-0.5 flex-shrink-0">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  Found
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[9px] bg-status-error/10 text-status-error gap-0.5 flex-shrink-0">
                  <XCircle className="h-2.5 w-2.5" />
                  Missing
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
