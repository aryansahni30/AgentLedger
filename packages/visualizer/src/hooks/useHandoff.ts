import { useState, useCallback, useEffect } from "react";
import type { HandoffBrief, ApiResponse } from "../types.js";
import { useSSE } from "./useSSE.js";

interface UseHandoffResult {
  brief: HandoffBrief | null;
  loading: boolean;
  error: string | null;
}

export function useHandoff(runId: string | null): UseHandoffResult {
  const [brief, setBrief] = useState<HandoffBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!runId) {
      setBrief(null);
      return;
    }
    setLoading(true);
    fetch(`/api/runs/${runId}/handoff`)
      .then((r) => r.json() as Promise<ApiResponse<HandoffBrief>>)
      .then((body) => {
        if (body.success) {
          setBrief(body.data);
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
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  useSSE(load);

  return { brief, loading, error };
}
