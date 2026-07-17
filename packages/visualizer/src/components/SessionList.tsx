import type { SessionMetrics } from "../hooks/useAnalytics.js";

interface SessionListProps {
  sessions: SessionMetrics[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SessionRow({
  session,
  selected,
  onClick,
}: {
  session: SessionMetrics;
  selected: boolean;
  onClick: () => void;
}): React.ReactElement {
  const passed = session.verificationPassed;
  const hasClaims = session.claimsVerified + session.claimsFalsified > 0;
  const lies = session.claimsFalsified;
  const blocks = session.toolDenied;
  const violations = session.boundaryViolations;

  return (
    <button
      className={`session-row${selected ? " selected" : ""}`}
      onClick={onClick}
      type="button"
    >
      <div className="session-row-top">
        <span className="session-row-title">
          {session.goal || `Session ${session.runId.slice(0, 8)}`}
        </span>
        <span
          className={`session-badge ${session.status === "completed" ? "pass" : session.status === "failed" ? "fail" : "active"}`}
        >
          {session.status === "completed"
            ? "passed"
            : session.status === "active"
              ? "observed"
              : session.status}
        </span>
      </div>
      <div className="session-row-meta">
        <span className="session-row-time">{formatTime(session.startedAt)}</span>
        {hasClaims && (
          <span className="session-row-stat">
            {session.claimsVerified}/{session.claimsVerified + session.claimsFalsified} claims
          </span>
        )}
        {lies > 0 && (
          <span className="session-row-stat warn">{lies} lie{lies > 1 ? "s" : ""}</span>
        )}
        {blocks > 0 && (
          <span className="session-row-stat">{blocks} blocked</span>
        )}
        {violations > 0 && (
          <span className="session-row-stat warn">{violations} violation{violations > 1 ? "s" : ""}</span>
        )}
        {!hasClaims && lies === 0 && blocks === 0 && passed && (
          <span className="session-row-stat ok">clean</span>
        )}
      </div>
    </button>
  );
}

export function SessionList({
  sessions,
  selectedRunId,
  onSelect,
}: SessionListProps): React.ReactElement {
  if (sessions.length === 0) {
    return (
      <div className="session-list-empty">
        <div className="session-list-empty-icon">◇</div>
        <div className="session-list-empty-text">No sessions yet</div>
        <div className="session-list-empty-hint">
          Sessions appear as you use Claude Code with AgentLedger installed
        </div>
      </div>
    );
  }

  // Show newest first
  const sorted = [...sessions].reverse();

  return (
    <div className="session-list">
      <div className="session-list-header">
        Sessions
        <span className="session-list-count">{sessions.length}</span>
      </div>
      {sorted.map((s) => (
        <SessionRow
          key={s.runId}
          session={s}
          selected={s.runId === selectedRunId}
          onClick={() => onSelect(s.runId)}
        />
      ))}
    </div>
  );
}
