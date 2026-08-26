"use client";

import { useState } from "react";
import {
  Globe,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  ShieldCheck,
  ExternalLink,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PLATFORM_META, type PlatformId } from "@/lib/platform-meta";

export interface PlatformAuthEntry {
  platform: string;
  requiresAuth: boolean;
  authenticated: boolean;
  account?: string;
  savedAt?: string;
  verifiedAt?: string;
  hint?: string;
}

/**
 * Inline platform login panel. Used inside the Program Discovery dialog and
 * the Settings view. The user pastes platform-issued API credentials; they
 * are validated against the platform's real API and persist in the local DB
 * for every project.
 */
export function PlatformLoginPanel({
  entry,
  onAuthChanged,
  compact,
}: {
  entry: PlatformAuthEntry;
  onAuthChanged?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const platform = entry.platform as PlatformId;
  const meta = PLATFORM_META[platform];
  const label = meta?.label || entry.platform;
  const apiFields = meta?.apiKeyFields || [];
  const keyUrl = meta?.keyUrl;
  // Platforms without API fields (fully public sources) have nothing to
  // connect — no dead Connect button for them.
  const connectable = apiFields.length > 0;

  const setField = (key: string, value: string) =>
    setFields((f) => ({ ...f, [key]: value }));

  const allFilled = apiFields.every((f) => (fields[f.key] || "").trim().length > 0);

  const login = async () => {
    setLoggingIn(true);
    try {
      const r = await fetch("/api/platform-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: entry.platform, fields }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Login failed");
      toast.success(
        `Connected to ${label}${d.account ? ` (${d.account})` : ""}`,
      );
      setOpen(false);
      setFields({});
      onAuthChanged?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      await fetch(`/api/platform-auth?platform=${entry.platform}`, {
        method: "DELETE",
      });
      toast.success(`Disconnected from ${label}`);
      onAuthChanged?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoggingOut(false);
    }
  };

  if (compact) {
    return entry.authenticated ? (
      <Badge className="bg-status-success/15 text-status-success gap-1 border-status-success/30">
        <ShieldCheck className="h-3 w-3" />
        {label} connected
      </Badge>
    ) : entry.requiresAuth ? (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors font-medium"
      >
        <KeyRound className="h-3 w-3" />
        Connect {label}
      </button>
    ) : null;
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-medium truncate">{label}</span>
          {entry.requiresAuth && (
            <Badge variant="outline" className="text-[9px] uppercase">
              API key required
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {entry.authenticated ? (
            <>
              <Badge className="bg-status-success/15 text-status-success gap-1">
                <ShieldCheck className="h-3 w-3" />
                Connected{entry.account ? ` · ${entry.account}` : ""}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                disabled={loggingOut}
                className="h-7 text-xs text-muted-foreground hover:text-status-error"
              >
                {loggingOut ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <LogOut className="h-3 w-3" />
                )}
              </Button>
            </>
          ) : connectable ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              className="h-7 text-xs"
            >
              <LogIn className="h-3 w-3 mr-1" />
              Connect
            </Button>
          ) : (
            <Badge variant="outline" className="text-[9px] uppercase text-muted-foreground">
              Public — no key needed
            </Badge>
          )}
        </div>
      </div>
      {entry.hint && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">{entry.hint}</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-lg z-[60]"
          overlayClassName="z-[60] bg-black/80 backdrop-blur-sm"
        >
          <DialogHeader>
            <DialogTitle>Connect {label}</DialogTitle>
            <DialogDescription>
              {entry.hint ||
                "Paste your platform API key. It is validated against the platform right now and stored locally."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md bg-muted/40 border border-border p-2.5 text-[11px] text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-foreground mb-0.5">
                  Where to get your API key
                </p>
                <ol className="list-decimal ml-4 space-y-0.5">
                  <li>
                    Open{" "}
                    <a
                      href={keyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline hover:no-underline inline-flex items-center gap-0.5 wrap-anywhere"
                    >
                      {keyUrl?.replace("https://", "")}
                      <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                    </a>
                  </li>
                  <li>Create a new key and copy the values shown</li>
                  <li>Paste them below — the key is verified live before it is saved</li>
                </ol>
              </div>
            </div>
            {apiFields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`${f.key}-${entry.platform}`} className="text-xs">
                  {f.label}
                </Label>
                <Input
                  id={`${f.key}-${entry.platform}`}
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  value={fields[f.key] || ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.placeholder || ""}
                  className="font-mono text-[11px] h-9"
                />
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              The key is validated against {label}&apos;s official API right now and stored
              encrypted-at-rest in the local database. It stays on this machine and is only
              ever sent to {label}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={login}
              disabled={loggingIn || !allFilled}
              className="bg-primary hover:bg-primary/90"
            >
              {loggingIn ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <LogIn className="h-3.5 w-3.5 mr-1.5" />
                  Connect account
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
