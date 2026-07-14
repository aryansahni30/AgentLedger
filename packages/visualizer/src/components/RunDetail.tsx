import type { RunState } from "../types.js";
import { StatusBadge } from "./StatusBadge.js";
import { TaskGraph } from "./TaskGraph.js";
import { HandoffPanel } from "./HandoffPanel.js";
import { useHandoff } from "../hooks/useHandoff.js";

interface RunDetailProps {
  run: RunState | null;
}

export function RunDetail({ run }: RunDetailProps): React.ReactElement {
  const needsHandoff = run?.status === "failed" || run?.status === "paused";
  const { brief } = useHandoff(needsHandoff ? (run?.runId ?? null) : null);

  if (!run) {
    return <div className="run-detail-empty">Select a run to view details.</div>;
  }

  const duration =
    run.startedAt && run.completedAt
      ? `${((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
      : null;

  return (
    <div>
      <div className="run-detail-header">
        <div style={{ flex: 1 }}>
          <div className="run-detail-goal">{run.goal}</div>
          <div className="run-detail-id">
            {run.runId}
            {duration && <span className="run-detail-duration"> · {duration}</span>}
          </div>
        </div>
        <StatusBadge status={run.status} />
      </div>

      <div className="run-detail-section">
        <div className="run-detail-section-title">
          Task Graph ({run.tasks.length})
        </div>
        <TaskGraph tasks={run.tasks} />
      </div>

      {run.filesModified.length > 0 && (
        <div className="run-detail-section">
          <div className="run-detail-section-title">Files Modified</div>
          <div className="task-card-files" style={{ padding: "0 16px" }}>
            {run.filesModified.map((f) => (
              <span key={f} className="task-card-file">{f}</span>
            ))}
          </div>
        </div>
      )}

      {needsHandoff && brief && (
        <div className="run-detail-section">
          <HandoffPanel brief={brief} />
        </div>
      )}
    </div>
  );
}
