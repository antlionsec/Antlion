"use client";

import { useState } from "react";
import {
  FileText,
  FileJson,
  FileCode,
  File,
  Download,
  Loader2,
  Shield,
  AlertCircle,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DiscoveryTree } from "@/components/antlion/discovery-tree";

interface ReportFormat {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  mime: string;
  ext: string;
}

const FORMATS: ReportFormat[] = [
  {
    id: "html",
    label: "Interactive HTML",
    description: "Self-contained, styled HTML report. Best for sharing a polished snapshot — opens in any browser, no dependencies.",
    icon: FileCode,
    mime: "text/html",
    ext: "html",
  },
  {
    id: "md",
    label: "Markdown",
    description: "Markdown source — ideal for pasting into GitHub issues, Notion, GitLab wikis, or static-site generators.",
    icon: FileText,
    mime: "text/markdown",
    ext: "md",
  },
  {
    id: "json",
    label: "JSON",
    description: "Raw structured data — every finding, scope item, and run record. Suited for pipeline automation and post-processing.",
    icon: FileJson,
    mime: "application/json",
    ext: "json",
  },
  {
    id: "txt",
    label: "Plain Text",
    description: "ASCII-formatted report for archival, plain-text emails, or terminal-friendly review.",
    icon: File,
    mime: "text/plain",
    ext: "txt",
  },
];

export function ReportsView() {
  const { activeProjectId } = useAppStore();
  const [generating, setGenerating] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const generate = async (format: string) => {
    if (!activeProjectId) {
      toast.error("Active project required");
      return;
    }
    setGenerating(format);
    try {
      const r = await fetch("/api/reports", {
        method: "POST",
        body: JSON.stringify({ projectId: activeProjectId, format }),
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) throw new Error("Report generation failed");
      if (format === "html") {
        const html = await r.text();
        // Open in a new tab by blob URL
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setPreviewHtml(html);
        toast.success("HTML report opened in new tab");
      } else {
        // Download as attachment
        const blob = await r.blob();
        const disposition = r.headers.get("Content-Disposition") || "";
        const match = disposition.match(/filename="([^"]+)"/);
        const filename = match?.[1] || `report.${format}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`${format.toUpperCase()} report downloaded`);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-shrink-0 px-4 sm:px-6 py-4 border-b border-border bg-background/40">
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Reports</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Interactive discovery tree of every domain and finding · one-click generation of comprehensive reports · executive summary, methodology, scope, findings with evidence & remediation
        </p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-4 sm:p-6 space-y-6">
          {/* Interactive discovery tree */}
          <DiscoveryTree projectId={activeProjectId} />

          {/* Format selection */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">
              Generate New Report
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FORMATS.map((fmt) => {
                const Icon = fmt.icon;
                const isGenerating = generating === fmt.id;
                return (
                  <Card
                    key={fmt.id}
                    className="cursor-pointer hover:border-primary/30 hover:shadow-md transition-all"
                  >
                    <button
                      onClick={() => generate(fmt.id)}
                      disabled={!!generating}
                      className="w-full text-left disabled:opacity-50"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                            {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm">{fmt.label}</span>
                              <Badge variant="outline" className="text-[9px] uppercase font-mono">.{fmt.ext}</Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">{fmt.description}</p>
                          </div>
                          <Download className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        </div>
                      </CardContent>
                    </button>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Methodology / contents */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Report Contents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="font-semibold mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Sections</div>
                  <ul className="space-y-1.5 text-foreground/80">
                    <li>• Executive summary with severity counts</li>
                    <li>• Methodology overview (stages & tools)</li>
                    <li>• Scope (in-scope & out-of-scope tables)</li>
                    <li>• Findings with evidence & remediation</li>
                    <li>• Run history with timestamps</li>
                    <li>• Appendix with raw tool output</li>
                  </ul>
                </div>
                <div>
                  <div className="font-semibold mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Per-finding metadata</div>
                  <ul className="space-y-1.5 text-foreground/80">
                    <li>• Title, severity, type</li>
                    <li>• Target URL / asset</li>
                    <li>• CVSS score & CVE reference (when available)</li>
                    <li>• Detection source (tool name)</li>
                    <li>• Evidence (request/response)</li>
                    <li>• Recommended remediation</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Ethical notice */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2 text-xs text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p>
              All reports are generated from data scoped to this project only. Findings remain subject to the originating
              program&apos;s disclosure policy. Antlion does not transmit reports externally — they are produced entirely
              on this machine and saved to your downloads folder.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
