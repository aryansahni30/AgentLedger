import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { LedgerEvent, RunState, ApiResponse } from "../types.js";
import { useSSE } from "./useSSE.js";

export interface SessionMetrics {
  runId: string;
  goal: string;
  status: string;
  operator?: string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  claimsVerified: number;
  claimsFalsified: number;
  claimsUnverifiable: number;
  toolDenied: number;
  toolWarned: number;
  boundaryViolations: number;
  verificationPassed: boolean;
  events: LedgerEvent[];
}

export interface TrustTrend {
  session: number;
  runId: string;
  trustPct: number;
  claimsTrue: number;
  claimsFalse: number;
}

export interface AggregateMetrics {
  trustScore: number;
  totalClaimsVerified: number;
  totalClaimsFalsified: number;
  totalClaimsUnverifiable: number;
  totalBlocks: number;
  totalEvents: number;
  totalSessions: number;
  liesCaught: number;
}

export interface AnalyticsData {
  aggregate: AggregateMetrics;
  sessions: SessionMetrics[];
  trends: TrustTrend[];
  loading: boolean;
  error: string | null;
}

function resolveDisplayStatus(run: RunState, events: LedgerEvent[]): string {
  const isObserved = events.some(
    (e) =>
      e.event_type === "RUN_CREATED" &&
      e.payload["run_mode"] === "observed",
  );
  if (!isObserved) return run.status;

  // For observed sessions, map orchestrator states to user-meaningful labels
  if (run.status === "completed") return "completed";
  if (run.status === "failed") return "failed";
  // Any mid-run state (planning, executing, verifying, etc.) = active for observed
  return "active";
}

function computeSessionMetrics(
  run: RunState,
  allEvents: LedgerEvent[],
): SessionMetrics {
  const events = allEvents.filter((e) => e.run_id === run.runId);
  return {
    runId: run.runId,
    goal: run.goal,
    status: resolveDisplayStatus(run, events),
    operator: run.operator,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    claimsVerified: events.filter((e) => e.event_type === "CLAIM_VERIFIED").length,
    claimsFalsified: events.filter((e) => e.event_type === "CLAIM_FALSIFIED").length,
    claimsUnverifiable: events.filter((e) => e.event_type === "CLAIM_UNVERIFIABLE").length,
    toolDenied: events.filter((e) => e.event_type === "TOOL_DENIED").length,
    toolWarned: events.filter((e) => e.event_type === "TOOL_WARNED").length,
    boundaryViolations: events.filter((e) => e.event_type === "BOUNDARY_VIOLATION").length,
    verificationPassed: events.some((e) => e.event_type === "VERIFICATION_PASSED"),
    events,
  };
}

export function useAnalytics(): AnalyticsData {
  const [runs, setRuns] = useState<RunState[]>([]);
  const [allEvents, setAllEvents] = useState<LedgerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/runs").then((r) => r.json() as Promise<ApiResponse<RunState[]>>),
      fetch("/api/events/history").then((r) => r.json() as Promise<ApiResponse<LedgerEvent[]>>),
    ])
      .then(([runsRes, eventsRes]) => {
        if (runsRes.success) setRuns(runsRes.data);
        if (eventsRes.success) setAllEvents(eventsRes.data);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useSSE(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchAll, 300);
  });

  const sessions = useMemo(
    () =>
      runs
        .map((r) => computeSessionMetrics(r, allEvents))
        .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? "")),
    [runs, allEvents],
  );

  const aggregate = useMemo<AggregateMetrics>(() => {
    let verified = 0;
    let falsified = 0;
    let unverifiable = 0;
    let blocks = 0;
    for (const s of sessions) {
      verified += s.claimsVerified;
      falsified += s.claimsFalsified;
      unverifiable += s.claimsUnverifiable;
      blocks += s.toolDenied;
    }
    const total = verified + falsified;
    return {
      trustScore: total > 0 ? verified / total : -1,
      totalClaimsVerified: verified,
      totalClaimsFalsified: falsified,
      totalClaimsUnverifiable: unverifiable,
      totalBlocks: blocks,
      totalEvents: allEvents.length,
      totalSessions: sessions.length,
      liesCaught: falsified,
    };
  }, [sessions, allEvents]);

  const trends = useMemo<TrustTrend[]>(() => {
    let runningTrue = 0;
    let runningFalse = 0;
    const result: TrustTrend[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i]!;
      runningTrue += s.claimsVerified;
      runningFalse += s.claimsFalsified;
      const total = runningTrue + runningFalse;
      if (total > 0) {
        result.push({
          session: i + 1,
          runId: s.runId,
          trustPct: Math.round((runningTrue / total) * 100),
          claimsTrue: runningTrue,
          claimsFalse: runningFalse,
        });
      }
    }
    return result;
  }, [sessions]);

  return { aggregate, sessions, trends, loading, error };
}
