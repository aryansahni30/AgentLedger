import { useState, useCallback, useEffect, useRef } from "react";
import type { RunState, ApiResponse } from "../types.js";
import { useSSE } from "./useSSE.js";

interface UseRunsResult {
  runs: RunState[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useRuns(): UseRunsResult {
  const [runs, setRuns] = useState<RunState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch("/api/runs")
      .then((r) => r.json() as Promise<ApiResponse<RunState[]>>)
      .then((body) => {
        if (body.success) {
          setRuns(body.data);
          setError(null);
        } else {
          setError(body.error ?? "Unknown error");
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch on any new ledger event (debounced — SSE may emit bursts).
  useSSE(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refresh, 200);
  });

  return { runs, loading, error, refresh };
}
