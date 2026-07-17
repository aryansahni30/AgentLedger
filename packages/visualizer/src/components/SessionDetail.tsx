import { useState } from "react";
import type { SessionMetrics } from "../hooks/useAnalytics.js";
import type { LedgerEvent } from "../types.js";

interface SessionDetailProps {
  session: SessionMetrics | null;
}

interface HumanizedEvent {
  icon: string;
  label: string;
  detail?: string | undefined;
  severity: "info" | "success" | "warning" | "error";
  raw: LedgerEvent;
}

function humanize(event: LedgerEvent): HumanizedEvent | null {
  const p = event.payload;
  switch (event.event_type) {
    case "RUN_CREATED":
      return {
        icon: "▶",
        label: "Session started",
        detail: typeof p["run_mode"] === "string" ? p["run_mode"] : undefined,
        severity: "info",
        raw: event,
      };
    case "VERIFICATION_PASSED":
      return {
        icon: "✓",
        label: "Verification passed",
        detail: typeof p["test_command"] === "string" ? `${p["test_command"]} → exit 0` : undefined,
        severity: "success",
        raw: event,
      };
    case "VERIFICATION_FAILED":
      return {
        icon: "✗",
        label: "Verification failed",
        detail: typeof p["reason"] === "string" ? p["reason"] : undefined,
        severity: "error",
        raw: event,
      };
    case "TOOL_DENIED":
      return {
        icon: "🛡",
        label: `Blocked write to ${typeof p["file_path"] === "string" ? p["file_path"].split("/").pop() : "file"}`,
        detail: typeof p["matched_pattern"] === "string" ? `Pattern: ${p["matched_pattern"]}` : undefined,
        severity: "warning",
        raw: event,
      };
    case "TOOL_WARNED":
      return {
        icon: "⚠",
        label: `Warning: edit to ${typeof p["file_path"] === "string" ? p["file_path"].split("/").pop() : "file"}`,
        detail: typeof p["matched_pattern"] === "string" ? `Sensitive pattern: ${p["matched_pattern"]}` : undefined,
        severity: "warning",
        raw: event,
      };
    case "BOUNDARY_VIOLATION":
      return {
        icon: "⚠",
        label: "Boundary violation detected",
        detail: Array.isArray(p["violations"])
          ? (p["violations"] as Array<{ file?: string }>).map((v) => v.file).join(", ")
          : undefined,
        severity: "error",
        raw: event,
      };
    case "CLAIM_VERIFIED":
      return {
        icon: "✓",
        label: `Claim verified: "${typeof p["claim_text"] === "string" ? p["claim_text"] : "..."}"`,
        severity: "success",
        raw: event,
      };
    case "CLAIM_FALSIFIED": {
      const claim = typeof p["claim_text"] === "string" ? p["claim_text"] : "...";
      const actual = typeof p["actual"] === "string" ? p["actual"] : "";
      return {
        icon: "✗",
        label: `False claim caught — Claude said "${claim}"`,
        detail: actual ? `Actual: ${actual}` : undefined,
        severity: "error",
        raw: event,
      };
    }
    case "CLAIM_UNVERIFIABLE":
      return {
        icon: "?",
        label: `Unverifiable claim: "${typeof p["claim_text"] === "string" ? p["claim_text"] : "..."}"`,
        detail: typeof p["reason"] === "string" ? p["reason"] : undefined,
        severity: "info",
        raw: event,
      };
    case "RUN_COMPLETED":
      return {
        icon: "✓",
        label: "Session completed",
        severity: "success",
        raw: event,
      };
    case "RUN_FAILED":
      return {
        icon: "✗",
        label: "Session failed",
        detail: typeof p["reason"] === "string" ? p["reason"] : undefined,
        severity: "error",
        raw: event,
      };
    default:
      // Skip TOOL_CALLED, INTENT_COMPILED etc — noise
      return null;
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function TimelineEvent({ item }: { item: HumanizedEvent }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`timeline-event ${item.severity}`}>
      <div
        className="timeline-event-row"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") setExpanded(!expanded);
        }}
      >
        <span className="timeline-event-icon">{item.icon}</span>
        <span className="timeline-event-label">{item.label}</span>
        <span className="timeline-event-time">
          {formatTimestamp(item.raw.timestamp)}
        </span>
        <span className="timeline-event-expand">{expanded ? "▾" : "▸"}</span>
      </div>
      {item.detail && (
        <div className="timeline-event-detail">{item.detail}</div>
      )}
      {expanded && (
        <pre className="timeline-event-raw">
          {JSON.stringify(item.raw.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function SessionDetail({
  session,
}: SessionDetailProps): React.ReactElement {
  if (!session) {
    return (
      <div className="detail-empty">
        <div className="detail-empty-icon">←</div>
        <div className="detail-empty-text">Select a session to view details</div>
      </div>
    );
  }

  const humanized = session.events
    .map(humanize)
    .filter((h): h is HumanizedEvent => h !== null);

  const claims = session.claimsVerified + session.claimsFalsified;

  return (
    <div className="session-detail">
      <div className="session-detail-header">
        <h2 className="session-detail-title">
          {session.goal || `Session ${session.runId.slice(0, 8)}`}
        </h2>
        <span
          className={`session-badge ${session.status === "completed" ? "pass" : session.status === "failed" ? "fail" : "active"}`}
        >
          {session.status}
        </span>
      </div>

      <div className="session-detail-meta">
        <span className="session-detail-id">{session.runId.slice(0, 12)}</span>
        {session.operator && (
          <span className="session-detail-operator">{session.operator}</span>
        )}
      </div>

      <div className="session-detail-stats">
        {claims > 0 && (
          <div className="detail-stat">
            <span className="detail-stat-value">{session.claimsVerified}/{claims}</span>
            <span className="detail-stat-label">claims verified</span>
          </div>
        )}
        {session.claimsFalsified > 0 && (
          <div className="detail-stat warn">
            <span className="detail-stat-value">{session.claimsFalsified}</span>
            <span className="detail-stat-label">lies caught</span>
          </div>
        )}
        {session.toolDenied > 0 && (
          <div className="detail-stat">
            <span className="detail-stat-value">{session.toolDenied}</span>
            <span className="detail-stat-label">writes blocked</span>
          </div>
        )}
        <div className="detail-stat">
          <span className="detail-stat-value">{session.events.length}</span>
          <span className="detail-stat-label">events</span>
        </div>
      </div>

      <div className="session-detail-timeline">
        <div className="timeline-header">Timeline</div>
        {humanized.length > 0 ? (
          <div className="timeline-list">
            {humanized.map((item, i) => (
              <TimelineEvent key={`${item.raw.event_id}-${i}`} item={item} />
            ))}
          </div>
        ) : (
          <div className="timeline-empty">No notable events in this session</div>
        )}
      </div>
    </div>
  );
}
