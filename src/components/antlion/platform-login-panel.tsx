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
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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

export interface PlatformAuthEntry {
  platform: string;
  requiresAuth: boolean;
  authenticated: boolean;
  account?: string;
  savedAt?: string;
  verifiedAt?: string;
  hint?: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  hackerone: "HackerOne",
  bugcrowd: "Bugcrowd",
  intigriti: "Intigriti",
  yeswehack: "YesWeHack",
  immunefi: "Immunefi",
};

const PLATFORM_URLS: Record<string, string> = {
  hackerone: "https://hackerone.com",
  bugcrowd: "https://bugcrowd.com",
  intigriti: "https://app.intigriti.com",
};

/**
 * Inline platform login panel. Used inside the Program Discovery dialog and
 * the Settings view. Credentials are validated against the real platform and
 * persist in the local DB for every project.
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
  const [cookie, setCookie] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const login = async () => {
    setLoggingIn(true);
    try {
      const r = await fetch("/api/platform-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: entry.platform, cookie }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Login failed");
      toast.success(
        `Connected to ${PLATFORM_LABELS[entry.platform] || entry.platform}${d.account ? ` (${d.account})` : ""}`,
      );
      setOpen(false);
      setCookie("");
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
      toast.success(`Disconnected from ${PLATFORM_LABELS[entry.platform] || entry.platform}`);
      onAuthChanged?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoggingOut(false);
    }
  };

  const label = PLATFORM_LABELS[entry.platform] || entry.platform;

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
              Login required
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
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              className="h-7 text-xs"
            >
              <LogIn className="h-3 w-3 mr-1" />
              Connect
            </Button>
          )}
        </div>
      </div>
      {entry.hint && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">{entry.hint}</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect {label}</DialogTitle>
            <DialogDescription>
              {entry.hint ||
                "Paste your session cookie to authenticate. It is stored locally and used for every project."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md bg-muted/40 border border-border p-2.5 text-[11px] text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-primary flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground mb-0.5">How to copy your session cookie</p>
                <ol className="list-decimal ml-4 space-y-0.5">
                  <li>
                    Sign in to{" "}
                    <a
                      href={PLATFORM_URLS[entry.platform]}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline hover:no-underline inline-flex items-center gap-0.5"
                    >
                      {PLATFORM_URLS[entry.platform]?.replace("https://", "")}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </li>
                  <li>Open DevTools (F12) → Network tab → reload the page</li>
                  <li>Click any request to the site → Request Headers</li>
                  <li>Copy the entire <code className="px-1 bg-muted rounded">Cookie:</code> header value and paste it below</li>
                </ol>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`cookie-${entry.platform}`} className="text-xs">
                Cookie header
              </Label>
              <Textarea
                id={`cookie-${entry.platform}`}
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder="_session_id=abc123; _pk_id.1.2=..."
                className="min-h-[90px] font-mono text-[11px]"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              The cookie is validated against {label} right now and stored encrypted-at-rest in the
              local database. It stays on this machine and is only ever sent to {label}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={login}
              disabled={loggingIn || cookie.trim().length < 10}
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
