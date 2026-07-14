import { useState } from "react";
import type { HandoffBrief, FailureReason, UnresolvedRisk } from "../types.js";

interface HandoffPanelProps {
  brief: HandoffBrief;
}

function failureReasonLabel(reason: FailureReason): string {
  switch (reason) {
    case "boundary_violation":     return "boundary violation";
    case "verification_failed":    return "verification failed";
    case "governance_denied":      return "governance denied";
    case "human_approval_rejected": return "approval rejected";
    case "tool_denial":            return "tool denied";
    case "tool_call_limit_exceeded": return "tool call limit exceeded";
    default:                       return "unknown";
  }
}

function riskSeverityClass(severity: UnresolvedRisk["severity"]): string {
  switch (severity) {
    case "critical": return "handoff-risk-critical";
    case "high":     return "handoff-risk-high";
    default:         return "handoff-risk-medium";
  }
}

function CopyButton({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button className="handoff-copy-btn" onClick={handleCopy}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export function HandoffPanel({ brief }: HandoffPanelProps): React.ReactElement {
  const [contextExpanded, setContextExpanded] = useState(false);

  const actionLabel = brief.resumptionGuidance.action.replace(/_/g, " ");

  return (
    <div className="handoff-panel">
      <div className="handoff-header">
        <span className="handoff-title">HANDOFF BRIEF</span>
        <span className={`handoff-status status-badge ${brief.runStatus}`}>
          {brief.runStatus}
        </span>
      </div>

      {/* ── Failed Tasks ───────────────────────────────────────────────────── */}
      {brief.failedTasks.length > 0 && (
        <div className="handoff-section">
          <div className="handoff-section-title">Failed Tasks ({brief.failedTasks.length})</div>
          {brief.failedTasks.map((t) => {
            const ctxDetail = t.context?.violatedFile
              ? `violated: ${t.context.violatedFile}`
              : t.context?.detail
                ? t.context.detail.slice(0, 100)
                : null;
            return (
              <div key={t.taskId} className="handoff-task handoff-task-failed">
                <div className="handoff-task-row">
                  <span className="handoff-task-icon">✗</span>
                  <span className="handoff-task-title">{t.title}</span>
                  <span className="handoff-reason-badge">{failureReasonLabel(t.reason)}</span>
                </div>
                {ctxDetail && (
                  <div className="handoff-task-detail">{ctxDetail}</div>
                )}
                {t.attemptedFiles.length > 0 && (
                  <div className="handoff-files">
                    {t.attemptedFiles.map((f) => (
                      <span key={f} className="task-card-file">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Pending / In-Progress Tasks ────────────────────────────────────── */}
      {(brief.pendingTasks.length > 0 || brief.inProgressTasks.length > 0) && (
        <div className="handoff-section">
          <div className="handoff-section-title">
            Remaining Tasks (
            {brief.inProgressTasks.length + brief.pendingTasks.length})
          </div>
          {brief.inProgressTasks.map((t) => (
            <div key={t.taskId} className="handoff-task">
              <div className="handoff-task-row">
                <span className="handoff-task-icon handoff-icon-progress">↺</span>
                <span className="handoff-task-title">{t.title}</span>
                <span className="handoff-task-owner">{t.owner}</span>
              </div>
            </div>
          ))}
          {brief.pendingTasks.map((t) => {
            const ready = t.blockedBy.length === 0;
            return (
              <div key={t.taskId} className="handoff-task">
                <div className="handoff-task-row">
                  <span className="handoff-task-icon">→</span>
                  <span className="handoff-task-title">{t.title}</span>
                  <span className={`handoff-blocked-badge ${ready ? "handoff-ready" : "handoff-blocked"}`}>
                    {ready ? "ready" : `blocked by ${t.blockedBy.length}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Unresolved Risks ──────────────────────────────────────────────── */}
      {brief.unresolvedRisks.length > 0 && (
        <div className="handoff-section">
          <div className="handoff-section-title">
            Unresolved Risks ({brief.unresolvedRisks.length})
          </div>
          {brief.unresolvedRisks.map((r, i) => (
            <div key={i} className="handoff-risk">
              <span className={`handoff-severity ${riskSeverityClass(r.severity)}`}>
                {r.severity}
              </span>
              <span className="handoff-risk-category">{r.category.replace(/_/g, " ")}</span>
              <span className="handoff-risk-file">{r.filePath}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── File Inventory ────────────────────────────────────────────────── */}
      {(brief.fileInventory.mergedFiles.length > 0 ||
        brief.fileInventory.worktreeFiles.length > 0) && (
        <div className="handoff-section">
          <div className="handoff-section-title">File Inventory</div>
          {brief.fileInventory.mergedFiles.length > 0 && (
            <div className="handoff-file-group">
              <span className="handoff-file-label handoff-file-merged">Merged</span>
              <div className="task-card-files">
                {brief.fileInventory.mergedFiles.map((f) => (
                  <span key={f} className="task-card-file">{f}</span>
                ))}
              </div>
            </div>
          )}
          {brief.fileInventory.worktreeFiles.length > 0 && (
            <div className="handoff-file-group">
              <span className="handoff-file-label handoff-file-worktree">Unmerged</span>
              <div className="task-card-files">
                {brief.fileInventory.worktreeFiles.map((f) => (
                  <span key={f} className="task-card-file">{f}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Resumption Guidance ───────────────────────────────────────────── */}
      <div className="handoff-section handoff-guidance">
        <div className="handoff-section-title">Next Action</div>
        <div className="handoff-guidance-action">{actionLabel}</div>
        <div className="handoff-guidance-detail">{brief.resumptionGuidance.detail}</div>
        <div className="handoff-command-row">
          <code className="handoff-command">{brief.resumptionGuidance.command}</code>
          <CopyButton text={brief.resumptionGuidance.command} />
        </div>
      </div>

      {/* ── Context Summary (Agent Prompt) ────────────────────────────────── */}
      <div className="handoff-section">
        <div className="handoff-context-header">
          <div className="handoff-section-title">Agent Context</div>
          <div className="handoff-context-actions">
            <CopyButton text={brief.contextSummary} />
            <button
              className="handoff-expand-btn"
              onClick={() => setContextExpanded((v) => !v)}
            >
              {contextExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>
        {contextExpanded && (
          <pre className="handoff-context-body">{brief.contextSummary}</pre>
        )}
        {!contextExpanded && (
          <div className="handoff-context-preview">
            {brief.contextSummary.slice(0, 200)}…
          </div>
        )}
      </div>
    </div>
  );
}
