import type { RunStatus, TaskStatus } from "../types.js";

interface StatusBadgeProps {
  status: RunStatus | TaskStatus;
}

export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  return (
    <span className={`status-badge ${status}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
