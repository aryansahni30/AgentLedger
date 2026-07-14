import type { RunState } from "../types.js";
import { useRuns } from "../hooks/useRuns.js";
import { useCurrentUser } from "../context/UserContext.js";
import { StatusBadge } from "./StatusBadge.js";

interface RunListProps {
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  filter: "all" | "mine";
}

function OperatorBadge({ operator }: { operator: string }): React.ReactElement {
  const initials = operator
    .split(/[\s._-]+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className="operator-badge" title={operator}>
      {initials || operator[0]?.toUpperCase()}
    </span>
  );
}

export function RunList({ selectedRunId, onSelect, filter }: RunListProps): React.ReactElement {
  const { runs, loading, error } = useRuns();
  const currentUser = useCurrentUser();

  if (loading) return <div className="loading-text">Loading runs…</div>;
  if (error) return <div className="run-list-error">{error}</div>;

  const visible =
    filter === "mine" ? runs.filter((r: RunState) => r.operator === currentUser) : runs;

  return (
    <>
      <div className="run-list-header">
        {filter === "mine" ? "My Runs" : "All Runs"} ({visible.length})
      </div>
      {visible.length === 0 ? (
        <div className="run-list-empty">
          {filter === "mine" ? "No runs started by you." : "No runs yet."}
        </div>
      ) : (
        visible.map((run: RunState) => (
          <div
            key={run.runId}
            className={`run-item${run.runId === selectedRunId ? " selected" : ""}`}
            onClick={() => onSelect(run.runId)}
          >
            <div className="run-item-title">{run.goal}</div>
            <div className="run-item-meta">
              <StatusBadge status={run.status} />
              <span>
                {run.tasks.length} task{run.tasks.length !== 1 ? "s" : ""}
              </span>
              {run.operator !== undefined && <OperatorBadge operator={run.operator} />}
            </div>
          </div>
        ))
      )}
    </>
  );
}
