import { useState, useCallback, useEffect, useRef } from "react";
import type { PolicyLeaderboard, ApiResponse } from "../types.js";
import { useSSE } from "./useSSE.js";

interface UseLeaderboardResult {
  leaderboard: PolicyLeaderboard | null;
  loading: boolean;
  error: string | null;
}

export function useLeaderboard(): UseLeaderboardResult {
  const [leaderboard, setLeaderboard] = useState<PolicyLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json() as Promise<ApiResponse<PolicyLeaderboard>>)
      .then((body) => {
        if (body.success) {
          setLeaderboard(body.data);
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

  useEffect(() => {
    refresh();
  }, [refresh]);

  useSSE(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refresh, 200);
  });

  return { leaderboard, loading, error };
}
