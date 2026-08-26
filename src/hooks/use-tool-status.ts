"use client";

import { useEffect, useState, useCallback } from "react";

export interface ToolStatusClient {
  id: string;
  name: string;
  binary: string;
  category: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  requiresApiKey: boolean;
  apiKeyName?: string;
  apiKeyPresent: boolean;
}

export interface ToolScanClient {
  tools: ToolStatusClient[];
  scannedAt: string;
  durationMs: number;
  installedCount: number;
  totalCount: number;
}

/**
 * Fetches the real command-line tool detection scan from /api/tools.
 * The scan itself runs server-side via `which` at startup (and on refresh).
 */
export function useToolStatus() {
  const [scan, setScan] = useState<ToolScanClient | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tools${refresh ? "?refresh=1" : ""}`);
      const d = await r.json();
      if (!d.error) setScan(d);
    } catch {
      // keep previous state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const statusById = (id: string): ToolStatusClient | undefined =>
    scan?.tools.find((t) => t.id === id);

  return { scan, loading, refresh: () => load(true), statusById };
}
