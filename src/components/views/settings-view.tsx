"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/stores/app-store";
import { useGlobalSettingsStore } from "@/lib/stores/global-settings-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Lock,
  Database,
  Download,
  Upload,
  Trash2,
  HardDrive,
  Settings2,
  Webhook,
  Globe,
  Key,
  Loader2,
  ShieldCheck,
  Archive,
  RotateCcw,
  Eye,
  EyeOff,
  FileArchive,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";

// ANTLION — Project Settings.
//
// Deliberately project-scoped ONLY. Notification hooks, platform accounts,
// API keys, appearance and tool detection are GLOBAL — they live in the
// Global Settings dialog (landing page → Settings button) and apply to every
// project container at once. Nothing here is duplicated per-project.
//
// Everything on this page is REAL:
//   • Export encryption uses AES-256-GCM with a scrypt-derived key; only a
//     verifier is stored — never the passphrase.
//   • Backup / export / import / restore all hit the /api/backups* endpoints
//     which write real ZIP archives (optionally encrypted) to db/backups/.
//   • Auto-backup is honored by the scheduler started in instrumentation.ts.
//   • Danger Zone actions call the real project lifecycle endpoints.

interface BackupRecord {
  id: string;
  kind: string;
  size: number;
  createdAt: string;
  file: string;
  encrypted: boolean;
}

export function SettingsView() {
  const { activeProjectId, closeProject } = useAppStore();
  const openGlobalSettings = useGlobalSettingsStore((s) => s.openGlobalSettings);

  const [encryptionEnabled, setEncryptionEnabled] = useState(false);
  const [projectName, setProjectName] = useState("");

  const loadProject = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const r = await fetch(`/api/projects/${activeProjectId}`);
      const d = await r.json();
      if (d.project) {
        setEncryptionEnabled(Boolean(d.project.encryptionEnabled));
        setProjectName(d.project.name || "");
      }
    } catch {
      // ignore
    }
  }, [activeProjectId]);

  useEffect(() => {
    // Defer one tick so state updates happen after the effect returns
    // (avoids cascading renders flagged by react-hooks/set-state-in-effect)
    const t = setTimeout(() => loadProject(), 0);
    return () => clearTimeout(t);
  }, [loadProject]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 sm:p-6 max-w-4xl space-y-4">
        {/* Global settings pointer */}
        <Card className="border-primary/25 bg-primary/[0.03]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              Global settings live outside this project
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-[11px] text-muted-foreground leading-relaxed">
              Notification hooks, platform accounts and API keys are configured once and apply to{" "}
              <b>every project container</b> — they are intentionally not per-project. Open the
              global settings dialog to manage them.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <GlobalSettingChip
                icon={Webhook}
                label="Notification hooks"
                desc="Discord, Slack, Telegram, email (SMTP) or generic webhooks — run and finding alerts for every project"
                onClick={() => openGlobalSettings("notifications")}
              />
              <GlobalSettingChip
                icon={Globe}
                label="Platform accounts"
                desc="Bugcrowd, Intigriti and HackerOne API keys shared by all projects"
                onClick={() => openGlobalSettings("accounts")}
              />
              <GlobalSettingChip
                icon={Key}
                label="API keys"
                desc="Shodan, Censys, ZoomEye and more — injected into every pipeline run"
                onClick={() => openGlobalSettings("keys")}
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => openGlobalSettings()}>
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
              Open Global Settings
            </Button>
          </CardContent>
        </Card>

        {/* Export encryption */}
        <EncryptionCard
          projectId={activeProjectId}
          enabled={encryptionEnabled}
          onEnabledChange={setEncryptionEnabled}
        />

        {/* Backups */}
        <BackupsCard
          projectId={activeProjectId}
          encryptionEnabled={encryptionEnabled}
          onRestored={loadProject}
        />

        {/* Danger zone */}
        <DangerZoneCard
          projectId={activeProjectId}
          projectName={projectName}
          onDeleted={closeProject}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export encryption (AES-256-GCM + scrypt)
// ---------------------------------------------------------------------------
function EncryptionCard({
  projectId,
  enabled,
  onEnabledChange,
}: {
  projectId: string | null;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  // Disable-flow state
  const [disablePass, setDisablePass] = useState("");
  const [disableOpen, setDisableOpen] = useState(false);

  const enable = async () => {
    if (!projectId) return;
    if (passphrase.length < 8) {
      toast.error("Passphrase must be at least 8 characters");
      return;
    }
    if (passphrase !== confirm) {
      toast.error("Passphrases do not match");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/encryption`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to enable encryption");
      onEnabledChange(true);
      setPassphrase("");
      setConfirm("");
      toast.success("Export encryption enabled", {
        description: "Exports and manual backups will be AES-256-GCM encrypted.",
      });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/encryption`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: disablePass }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to disable encryption");
      onEnabledChange(false);
      setDisableOpen(false);
      setDisablePass("");
      toast.success("Export encryption disabled");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" />
          Export Encryption
          {enabled && (
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-status-success/10 text-status-success border border-status-success/25">
              <ShieldCheck className="h-2.5 w-2.5" /> Enabled
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          When enabled, every <b>export</b> and <b>manual backup</b> of this project is encrypted
          with AES-256-GCM using a key derived from your passphrase (scrypt, 16K rounds). The
          passphrase itself is never stored — only a cryptographic verifier that can confirm it.
          Automatic snapshots stay unencrypted because there is no stored key to encrypt them with;
          use manual backups when you need encryption at rest.
        </p>
        <Separator />
        {enabled ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-status-success">
              <ShieldCheck className="h-4 w-4" />
              Archives are protected — a passphrase is required to export, back up or restore.
            </div>
            <Button variant="outline" size="sm" onClick={() => setDisableOpen(true)} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Disable encryption
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="enc-pass" className="text-xs">Passphrase (min 8 chars)</Label>
                <div className="relative">
                  <Input
                    id="enc-pass"
                    type={show ? "text" : "password"}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="A strong passphrase"
                    className="font-mono text-xs pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={show ? "Hide passphrase" : "Show passphrase"}
                  >
                    {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="enc-confirm" className="text-xs">Confirm passphrase</Label>
                <Input
                  id="enc-confirm"
                  type={show ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat the passphrase"
                  className="font-mono text-xs"
                />
              </div>
            </div>
            <Button size="sm" onClick={enable} disabled={busy || !passphrase || !confirm}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5 mr-1.5" />}
              Enable encryption
            </Button>
            <div className="text-[10px] text-muted-foreground">
              Losing the passphrase means encrypted archives can never be recovered. Store it safely.
            </div>
          </div>
        )}
      </CardContent>

      {/* Disable confirmation */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base">Disable export encryption?</DialogTitle>
            <DialogDescription className="text-xs">
              Existing encrypted archives stay encrypted and still need the passphrase. Enter the
              passphrase to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            value={disablePass}
            onChange={(e) => setDisablePass(e.target.value)}
            placeholder="Current passphrase"
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDisableOpen(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={disable} disabled={busy || !disablePass}>
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Disable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Backups & export — all actions are real HTTP calls
// ---------------------------------------------------------------------------
function BackupsCard({
  projectId,
  encryptionEnabled,
  onRestored,
}: {
  projectId: string | null;
  encryptionEnabled: boolean;
  onRestored: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  // Shared passphrase prompt state
  const [passDialogOpen, setPassDialogOpen] = useState(false);
  const [passValue, setPassValue] = useState("");
  const [passAction, setPassAction] = useState<"backup" | "export" | null>(null);

  // Export dialog
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPass, setExportPass] = useState("");
  const [exportShow, setExportShow] = useState(false);

  // Import dialog
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPass, setImportPass] = useState("");
  const [importMode, setImportMode] = useState<"new" | "replace">("new");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore dialog
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [records, setRecords] = useState<BackupRecord[]>([]);
  const [restorePass, setRestorePass] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);

  // Auto-backup + retention
  const [autoBackup, setAutoBackup] = useState(false);
  const [retentionDays, setRetentionDays] = useState(7);
  const [retentionSaving, setRetentionSaving] = useState(false);

  const loadBackups = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await fetch(`/api/backups?projectId=${projectId}`);
      const d = await r.json();
      if (r.ok) {
        setRecords(d.backups || []);
        setAutoBackup(Boolean(d.autoBackup));
        setRetentionDays(d.retentionDays ?? 7);
      }
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  // ---- Backup now ----
  const doBackup = async (passphrase?: string) => {
    if (!projectId) return;
    setBusy("backup");
    try {
      const r = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, passphrase: passphrase || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Backup failed");
      toast.success(`Snapshot saved (${formatBytes(d.record.size)})`, {
        description: d.encrypted ? "AES-256-GCM encrypted archive" : "Stored in db/backups/",
      });
      await loadBackups();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setPassDialogOpen(false);
      setPassValue("");
      setPassAction(null);
    }
  };

  // ---- Export (download without storing a record) ----
  const doExport = async (passphrase?: string) => {
    if (!projectId) return;
    setBusy("export");
    try {
      const r = await fetch("/api/backups/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, passphrase: passphrase || undefined }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "Export failed");
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="([^"]+)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] || "antlion-export.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded", {
        description: passphrase ? "Encrypted archive (.enc)" : "Plain ZIP archive",
      });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setExportOpen(false);
      setExportPass("");
    }
  };

  // ---- Import ----
  const doImport = async () => {
    if (!importFile) {
      toast.error("Choose an archive file first");
      return;
    }
    setBusy("import");
    try {
      const buf = await importFile.arrayBuffer();
      const dataBase64 = arrayBufferToBase64(buf);
      const r = await fetch("/api/backups/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataBase64,
          passphrase: importPass || undefined,
          asNew: importMode === "new",
          projectId: importMode === "replace" ? projectId : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Import failed");
      const c = d.counts || {};
      toast.success(
        d.created ? "Imported as a new project" : "Project data replaced from archive",
        {
          description: `${c.targets ?? 0} targets · ${c.findings ?? 0} findings · ${c.runs ?? 0} runs · ${c.notes ?? 0} notes`,
        },
      );
      setImportOpen(false);
      setImportFile(null);
      setImportPass("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      window.dispatchEvent(new CustomEvent("antlion:project-updated"));
      onRestored();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  // ---- Restore from a stored record ----
  const doRestore = async (record: BackupRecord) => {
    if (!projectId) return;
    if (record.encrypted && !restorePass) {
      toast.error("This backup is encrypted — enter its passphrase below");
      return;
    }
    setBusy(`restore-${record.id}`);
    try {
      const r = await fetch("/api/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, recordId: record.id, passphrase: restorePass || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Restore failed");
      const c = d.counts || {};
      toast.success("Project restored from backup", {
        description: `${c.targets ?? 0} targets · ${c.findings ?? 0} findings · ${c.runs ?? 0} runs`,
      });
      setRestoreOpen(false);
      setRestorePass("");
      setRestoreTarget(null);
      window.dispatchEvent(new CustomEvent("antlion:project-updated"));
      onRestored();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const deleteRecord = async (record: BackupRecord) => {
    setBusy(`delete-${record.id}`);
    try {
      const r = await fetch(`/api/backups?id=${record.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
      toast.success("Backup deleted");
      await loadBackups();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const toggleAutoBackup = async (v: boolean) => {
    if (!projectId) return;
    setAutoBackup(v);
    try {
      const r = await fetch("/api/backups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, autoBackup: v }),
      });
      if (!r.ok) throw new Error("Failed to save");
      toast.success(v ? "Automatic backups enabled (daily)" : "Automatic backups disabled");
    } catch (e: any) {
      setAutoBackup(!v);
      toast.error(e.message);
    }
  };

  const saveRetention = async () => {
    setRetentionSaving(true);
    try {
      const r = await fetch("/api/backups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays }),
      });
      if (!r.ok) throw new Error("Failed to save retention");
      toast.success(`Retention set to ${retentionDays} day(s)`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRetentionSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          Backups & Export
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <BackupAction
            icon={Download}
            label="Export Project ZIP"
            desc={encryptionEnabled ? "Encrypted archive download (.enc)" : "Full project archive download (.zip)"}
            busy={busy === "export"}
            onClick={() => (encryptionEnabled ? setExportOpen(true) : doExport())}
          />
          <BackupAction
            icon={Upload}
            label="Import Project"
            desc="Restore an exported archive (new project or replace)"
            busy={busy === "import"}
            onClick={() => setImportOpen(true)}
          />
          <BackupAction
            icon={HardDrive}
            label="Backup Now"
            desc={encryptionEnabled ? "Encrypted snapshot to db/backups/" : "Manual snapshot stored in db/backups/"}
            busy={busy === "backup"}
            onClick={() => (encryptionEnabled ? (setPassAction("backup"), setPassDialogOpen(true)) : doBackup())}
          />
          <BackupAction
            icon={RotateCcw}
            label="Restore from Backup"
            desc={`Roll back to a previous snapshot (${records.length} stored)`}
            busy={busy?.startsWith("restore-") === true}
            onClick={() => (setRestoreOpen(true), loadBackups())}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <Label className="text-xs flex items-center gap-1.5">
            <HardDrive className="h-3 w-3" />
            Automatic backups
          </Label>
          <Switch checked={autoBackup} onCheckedChange={toggleAutoBackup} />
        </div>
        <div className="text-[10px] text-muted-foreground">
          Daily snapshot stored locally while the app is running. Automatic snapshots are{" "}
          <b>not</b> passphrase-encrypted (no key is stored) — use Backup Now for encrypted copies.
        </div>

        <div className="flex items-end gap-2">
          <div className="space-y-1.5 flex-1 max-w-[180px]">
            <Label htmlFor="retention" className="text-xs">Retention (days)</Label>
            <Input
              id="retention"
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(e) => setRetentionDays(parseInt(e.target.value || "7", 10))}
              className="text-xs"
            />
          </div>
          <Button size="sm" variant="outline" onClick={saveRetention} disabled={retentionSaving}>
            {retentionSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save
          </Button>
        </div>
        <div className="text-[10px] text-muted-foreground">
          Older snapshots (and their files) are pruned automatically on every backup.
        </div>
      </CardContent>

      {/* Passphrase prompt (backup now, encrypted) */}
      <Dialog open={passDialogOpen} onOpenChange={(v) => !v && (setPassDialogOpen(false), setPassValue(""))}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base">Passphrase required</DialogTitle>
            <DialogDescription className="text-xs">
              This project has export encryption enabled — the snapshot will be AES-256-GCM
              encrypted with your passphrase.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            value={passValue}
            onChange={(e) => setPassValue(e.target.value)}
            placeholder="Project passphrase"
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPassDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => passAction === "backup" && doBackup(passValue)} disabled={!passValue || busy === "backup"}>
              {busy === "backup" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create encrypted backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export dialog (encryption enabled → passphrase required) */}
      <Dialog open={exportOpen} onOpenChange={(v) => !v && setExportOpen(false)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <FileArchive className="h-4 w-4 text-primary" />
              Export encrypted archive
            </DialogTitle>
            <DialogDescription className="text-xs">
              The download will be AES-256-GCM encrypted. Keep the passphrase safe — it is the only
              way to import this file later.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Input
              type={exportShow ? "text" : "password"}
              value={exportPass}
              onChange={(e) => setExportPass(e.target.value)}
              placeholder="Passphrase for this export"
              className="font-mono text-xs pr-9"
            />
            <button
              type="button"
              onClick={() => setExportShow(!exportShow)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={exportShow ? "Hide passphrase" : "Show passphrase"}
            >
              {exportShow ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setExportOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => doExport(exportPass)} disabled={!exportPass || busy === "export"}>
              {busy === "export" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Download .enc
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={(v) => !v && setImportOpen(false)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              Import project archive
            </DialogTitle>
            <DialogDescription className="text-xs">
              Choose a previously exported Antlion archive (.zip or encrypted .enc). Encrypted
              archives require their passphrase.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.enc,.aza,application/zip,application/octet-stream"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="block w-full text-xs border border-border rounded-md p-2 cursor-pointer file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:bg-muted file:text-xs file:cursor-pointer"
            />
            {importFile && (
              <div className="text-[11px] text-muted-foreground">
                {importFile.name} · {formatBytes(importFile.size)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setImportMode("new")}
                className={`text-left rounded-md border p-2.5 transition-colors ${importMode === "new" ? "border-primary/50 bg-primary/[0.04]" : "border-border hover:bg-muted/40"}`}
              >
                <div className="text-xs font-medium">As new project</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Creates a separate copy</div>
              </button>
              <button
                onClick={() => setImportMode("replace")}
                disabled={!projectId}
                className={`text-left rounded-md border p-2.5 transition-colors disabled:opacity-50 ${importMode === "replace" ? "border-destructive/50 bg-destructive/[0.04]" : "border-border hover:bg-muted/40"}`}
              >
                <div className="text-xs font-medium">Replace current project</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Overwrites this project's data</div>
              </button>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Passphrase (for encrypted archives)</Label>
              <Input
                type="password"
                value={importPass}
                onChange={(e) => setImportPass(e.target.value)}
                placeholder="Leave empty for plain .zip archives"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={doImport} disabled={!importFile || busy === "import"}>
              {busy === "import" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {importMode === "new" ? "Import as new project" : "Replace project data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore dialog */}
      <Dialog open={restoreOpen} onOpenChange={(v) => !v && (setRestoreOpen(false), setRestorePass(""), setRestoreTarget(null))}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-primary" />
              Restore from backup
            </DialogTitle>
            <DialogDescription className="text-xs">
              Restoring replaces this project's current targets, findings, notes and runs with the
              snapshot contents. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[45vh] overflow-y-auto space-y-1.5">
            {records.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-8">
                No backups stored yet — create one with "Backup Now".
              </div>
            ) : (
              records.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-3 rounded-md border p-2.5 ${restoreTarget?.id === r.id ? "border-primary/50 bg-primary/[0.04]" : "border-border"}`}
                  onClick={() => setRestoreTarget(r)}
                >
                  <FileArchive className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {new Date(r.createdAt).toLocaleString()}
                      {r.encrypted && (
                        <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-status-warning/10 text-status-warning border border-status-warning/25">
                          ENCRYPTED
                        </span>
                      )}
                      <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                        {r.kind}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {r.file} · {formatBytes(r.size)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); deleteRecord(r); }}
                    disabled={busy === `delete-${r.id}`}
                    title="Delete this backup"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
          {records.some((r) => r.encrypted) && (
            <div className="space-y-1.5">
              <Label className="text-xs">Passphrase (for encrypted backups)</Label>
              <Input
                type="password"
                value={restorePass}
                onChange={(e) => setRestorePass(e.target.value)}
                placeholder="Only needed for encrypted snapshots"
                className="font-mono text-xs"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRestoreOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              variant="default"
              disabled={!restoreTarget || busy?.startsWith("restore-") === true}
              onClick={() => restoreTarget && doRestore(restoreTarget)}
            >
              {busy?.startsWith("restore-") && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Restore selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Danger zone — real archive / trash / permanent delete
// ---------------------------------------------------------------------------
function DangerZoneCard({
  projectId,
  projectName,
  onDeleted,
}: {
  projectId: string | null;
  projectName: string;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const archive = async () => {
    if (!projectId) return;
    setBusy("archive");
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      toast.success("Project archived — find it under the Archived filter on the dashboard");
      onDeleted();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const trash = async () => {
    if (!projectId) return;
    setBusy("trash");
    try {
      await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      toast.success("Project moved to trash — restore it from the dashboard Trash filter");
      onDeleted();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const hardDelete = async () => {
    if (!projectId) return;
    setBusy("hard");
    try {
      await fetch(`/api/projects/${projectId}?hard=1`, { method: "DELETE" });
      toast.success("Project permanently deleted");
      onDeleted();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-destructive">
          <Trash2 className="h-4 w-4" />
          Danger Zone
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          Archiving keeps the project data but hides it from the active list. Moving to trash
          soft-deletes it (restorable from the dashboard Trash filter). Deleting permanently
          removes its targets, runs, findings, notes and reports from the local database. Global
          settings (hooks, accounts, keys) are unaffected — they belong to the workspace, not to
          this project.
        </div>
        <div className="flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={!!busy}>
                <Archive className="h-3.5 w-3.5 mr-1.5" />
                Archive project
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Archive “{projectName}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  The project is hidden from the active list but keeps all data. You can unarchive
                  it anytime from the dashboard's Archived filter.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={archive}>Archive</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-status-warning" disabled={!!busy}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Move to trash
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Move “{projectName}” to trash?</AlertDialogTitle>
                <AlertDialogDescription>
                  The project is soft-deleted and disappears from the workspace. Restore it later
                  from the dashboard's Trash filter, or delete it permanently from there.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={trash}>Move to trash</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={!!busy}>
                {busy === "hard" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                Delete permanently
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{projectName}” permanently?</AlertDialogTitle>
                <AlertDialogDescription>
                  This erases every target, run, stage, finding, note and audit entry for this
                  project from the local database. There is no undo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={hardDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete forever
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function GlobalSettingChip({
  icon: Icon,
  label,
  desc,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-md border border-border p-3 hover:border-primary/40 hover:bg-muted/40 transition-colors"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-[10px] text-muted-foreground leading-relaxed">{desc}</div>
    </button>
  );
}

function BackupAction({
  icon: Icon,
  label,
  desc,
  onClick,
  busy,
}: {
  icon: React.ElementType;
  label: string;
  desc: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="text-left rounded-md border border-border p-3 hover:bg-muted/50 hover:border-primary/30 transition-colors disabled:opacity-60"
    >
      <div className="flex items-center gap-1.5 mb-1">
        {busy ? <Loader2 className="h-4 w-4 text-primary animate-spin" /> : <Icon className="h-4 w-4 text-primary" />}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{desc}</div>
    </button>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
