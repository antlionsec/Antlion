"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Plus,
  FolderOpen,
  Search,
  MoreVertical,
  Trash2,
  Archive,
  RotateCcw,
  Copy,
  Edit3,
  Tag,
  Calendar,
  Crosshair,
  Bug,
  PlayCircle,
  Lock,
  Settings2,
  Activity,
  Database,
  Cpu,
  Github,
  BookOpen,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { useDiscoveryStore } from "@/lib/stores/discovery-store";
import { useGlobalSettingsStore } from "@/lib/stores/global-settings-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  tags: string[];
  status: string;
  targetCount: number;
  excludedCount: number;
  runCount: number;
  findingCount: number;
  lastActivityAt: string;
  createdAt: string;
  programId?: string | null;
  programName?: string | null;
  programPlatform?: string | null;
}

const COLORS: Record<string, string> = {
  slate: "from-slate-500/20 to-slate-600/10 text-slate-400",
  teal: "from-teal-500/20 to-teal-600/10 text-teal-400",
  amber: "from-amber-500/20 to-amber-600/10 text-amber-400",
  rose: "from-rose-500/20 to-rose-600/10 text-rose-400",
  emerald: "from-emerald-500/20 to-emerald-600/10 text-emerald-400",
  violet: "from-violet-500/20 to-violet-600/10 text-violet-400",
  cyan: "from-cyan-500/20 to-cyan-600/10 text-cyan-400",
};

// Brand links shown in the top bar — update to your repository URL after
// publishing. The wiki link is simply the repo's /wiki page.
const GITHUB_URL = "https://github.com/antlionsec/Antlion";
const WIKI_URL = `${GITHUB_URL}/wiki`;

export function DashboardView() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("lastActivity");
  const [statusFilter, setStatusFilter] = useState("active");
  const [createOpen, setCreateOpen] = useState(false);
  const openProject = useAppStore((s) => s.openProject);
  const openDiscovery = useDiscoveryStore((s) => s.openDiscovery);
  const openGlobalSettings = useGlobalSettingsStore((s) => s.openGlobalSettings);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, sort, status: statusFilter });
      const r = await fetch(`/api/projects?${params}`);
      const data = await r.json();
      setProjects(data.projects || []);
    } catch (e) {
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [query, sort, statusFilter]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand — logo + title always take the user back to the homepage */}
          <a
            href="/"
            className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background -m-1 p-1"
            aria-label="Antlion — back to homepage"
          >
            <img
              src="/logo-96.png"
              alt="Antlion logo"
              width={36}
              height={36}
              draggable={false}
              className="h-9 w-9 object-contain flex-shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[15px] font-semibold tracking-tight">
                Antlion
              </div>
              <div className="hidden sm:block text-[11px] text-muted-foreground -mt-0.5">
                Bug bounty recon workspace
              </div>
            </div>
          </a>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => window.open(GITHUB_URL, "_blank", "noopener,noreferrer")}
              aria-label="Antlion on GitHub"
            >
              <Github className="h-4 w-4" />
              <span className="hidden lg:inline">GitHub</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => window.open(WIKI_URL, "_blank", "noopener,noreferrer")}
              aria-label="Antlion wiki"
            >
              <BookOpen className="h-4 w-4" />
              <span className="hidden lg:inline">Wiki</span>
            </Button>
            <div className="h-5 w-px bg-border mx-1 hidden sm:block" aria-hidden="true" />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Settings"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => openGlobalSettings()}
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
            <Button
              onClick={() => setCreateOpen(true)}
              size="sm"
              aria-label="New Project"
              className="bg-primary hover:bg-primary/90"
            >
              <Plus className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">New Project</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-10 view-enter">
        {/* Hero */}
        <div className="mb-10">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-primary mb-3">
            <Crosshair className="h-3 w-3" />
            <span>Local-first · No cloud · No telemetry</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-3 max-w-3xl leading-[1.1]">
            Six platforms. Twenty-seven tools.{" "}
            <span className="text-primary">Nothing out of scope.</span>
          </h1>
          <p className="text-muted-foreground max-w-2xl text-[15px] leading-relaxed">
            Pick a program, import its scope, and point your entire recon stack
            at it — subdomains, live hosts, exposures, secrets. Every target,
            run and finding stays attached to the project it belongs to, and a
            report comes out the other end.
          </p>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard icon={<FolderOpen className="h-4 w-4" />} label="Projects" value={projects.length} />
          <StatCard icon={<Crosshair className="h-4 w-4" />} label="Active Targets" value={projects.reduce((s, p) => s + p.targetCount, 0)} />
          <StatCard icon={<PlayCircle className="h-4 w-4" />} label="Pipeline Runs" value={projects.reduce((s, p) => s + p.runCount, 0)} />
          <StatCard icon={<Bug className="h-4 w-4" />} label="Findings" value={projects.reduce((s, p) => s + p.findingCount, 0)} />
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects by name, tag, or description..."
              className="pl-9 h-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="soft-deleted">Trash</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-10 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lastActivity">Last Activity</SelectItem>
              <SelectItem value="created">Date Created</SelectItem>
              <SelectItem value="name">Name (A–Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Projects grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 rounded-xl border border-border bg-card animate-pulse" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence mode="popLayout">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={() => openProject(p.id)} onChanged={load} />
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Quick actions — Program Discovery is interactive; the other two are
            informational cards describing in-project features */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <QuickAction
            icon={<Database className="h-5 w-5" />}
            title="Program Discovery"
            description="Browse HackerOne, Bugcrowd, Intigriti, YesWeHack, Immunefi and disclose.io. Filter by reward, response time, freshness, and more."
            onClick={() => {
              // Program Discovery is a popup feature window
              openDiscovery();
            }}
          />
          <InfoCard
            icon={<Cpu className="h-5 w-5" />}
            title="Modular Pipeline"
            description="Subfinder, amass, httpx, nuclei, ffuf, trufflehog, and more. Per-stage configuration inside each project."
          />
          <InfoCard
            icon={<Activity className="h-5 w-5" />}
            title="Reporting"
            description="HTML, Markdown, JSON and plain-text reports plus an interactive discovery tree inside each project."
          />
        </div>
      </main>

      <footer className="mt-auto border-t border-border bg-background/60">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Antlion · Local-first · All data persists to SQLite on this machine</span>
          <span className="flex items-center gap-1">
            <Lock className="h-3 w-3" />
            Authorized targets only — ethical use required
          </span>
        </div>
      </footer>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => openProject(id)} />
    </div>
  );
}

// ----------------------------------------------------------------------------
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <div>
        <div className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onChanged,
}: {
  project: ProjectRow;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const colorClass = COLORS[project.color] || COLORS.slate;
  const lastActivity = new Date(project.lastActivityAt);
  const daysSince = Math.floor((Date.now() - lastActivity.getTime()) / 86400000);

  const archive = async () => {
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
      headers: { "Content-Type": "application/json" },
    });
    toast.success("Project archived");
    onChanged();
  };

  const unarchive = async () => {
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
      headers: { "Content-Type": "application/json" },
    });
    toast.success("Project restored to active");
    onChanged();
  };

  const softDelete = async () => {
    await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    toast.success("Project moved to trash");
    onChanged();
  };

  const restoreFromTrash = async () => {
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
      headers: { "Content-Type": "application/json" },
    });
    toast.success("Project restored");
    onChanged();
  };

  const hardDelete = async () => {
    await fetch(`/api/projects/${project.id}?hard=1`, { method: "DELETE" });
    toast.success("Project permanently deleted");
    onChanged();
  };

  const duplicate = async () => {
    const r = await fetch(`/api/projects`, {
      method: "POST",
      body: JSON.stringify({
        name: `${project.name} (copy)`,
        description: project.description,
        color: project.color,
        tags: project.tags,
        duplicateOf: project.id,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const d = await r.json();
    toast.success(
      r.ok ? `Duplicated project (${project.targetCount} targets copied)` : "Could not duplicate",
    );
    onChanged();
    return d;
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
    >
      <Card
        className="group relative overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5"
        onClick={onOpen}
      >
        <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", colorClass)} />
        <CardHeader className="pt-4 pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate">{project.name}</CardTitle>
              <CardDescription className="text-xs mt-0.5 line-clamp-2 min-h-[2rem]">
                {project.description || "No description provided"}
              </CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {project.status === "soft-deleted" ? (
                  <>
                    <DropdownMenuItem onClick={restoreFromTrash}>
                      <RotateCcw className="h-3.5 w-3.5 mr-2" /> Restore from Trash
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={hardDelete}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Permanently
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem onClick={duplicate}>
                      <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                    </DropdownMenuItem>
                    {project.status === "archived" ? (
                      <DropdownMenuItem onClick={unarchive}>
                        <RotateCcw className="h-3.5 w-3.5 mr-2" /> Unarchive
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={archive}>
                        <Archive className="h-3.5 w-3.5 mr-2" /> Archive
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={softDelete}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Move to Trash
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {project.programName && (
            <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted-foreground">
              <Badge variant="outline" className="text-[9px] py-0 px-1.5 font-medium uppercase">
                {project.programPlatform}
              </Badge>
              <span className="truncate">{project.programName}</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="pb-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Targets" value={project.targetCount} />
            <Stat label="Runs" value={project.runCount} />
            <Stat label="Findings" value={project.findingCount} accent={project.findingCount > 0} />
          </div>
        </CardContent>
        <CardFooter className="pt-0 pb-4 px-6 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {daysSince === 0 ? "Today" : daysSince === 1 ? "1 day ago" : `${daysSince}d ago`}
          </span>
          {project.tags && project.tags.length > 0 && (
            <span className="flex items-center gap-1 truncate">
              <Tag className="h-3 w-3" />
              {project.tags.slice(0, 2).join(", ")}
              {project.tags.length > 2 && ` +${project.tags.length - 2}`}
            </span>
          )}
        </CardFooter>
      </Card>
    </motion.div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-md bg-muted/40 py-1.5 px-2">
      <div className={cn("text-sm font-semibold tabular-nums", accent && "text-primary")}>
        {value.toLocaleString()}
      </div>
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}

function QuickAction({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group text-left rounded-xl border border-border bg-card p-5 hover:border-primary/30 hover:bg-accent/30 transition-all"
    >
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
        {icon}
      </div>
      <div className="font-semibold text-sm mb-1">{title}</div>
      <div className="text-xs text-muted-foreground leading-relaxed">{description}</div>
    </button>
  );
}

/** Non-interactive information card — describes a feature without faking a control. */
function InfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
        {icon}
      </div>
      <div className="font-semibold text-sm mb-1">{title}</div>
      <div className="text-xs text-muted-foreground leading-relaxed">{description}</div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 px-6 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4">
        <Shield className="h-6 w-6" />
      </div>
      <h3 className="text-lg font-semibold mb-1">No projects yet</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
        Create your first project to begin scoping a program, defining targets, and running the pipeline.
      </p>
      <Button onClick={onCreate} className="bg-primary hover:bg-primary/90">
        <Plus className="h-4 w-4 mr-1.5" />
        Create Project
      </Button>
    </div>
  );
}

function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("slate");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Project name required");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          color,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
        headers: { "Content-Type": "application/json" },
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      toast.success("Project created");
      onCreated(d.project.id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create new project</DialogTitle>
          <DialogDescription>
            Create new Project to begin scoping a program, defining targets, and running the pipeline.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp — Q4 Recon" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project for?" className="min-h-[60px]" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="color">Color</Label>
              <Select value={color} onValueChange={setColor}>
                <SelectTrigger id="color">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(COLORS).map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="fintech, q4" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-primary hover:bg-primary/90">
            {saving ? "Creating..." : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
