import type { AgentTask } from "../types.js";
import { StatusBadge } from "./StatusBadge.js";

interface TaskCardProps {
  task: AgentTask;
}

export function TaskCard({ task }: TaskCardProps): React.ReactElement {
  return (
    <div className="task-card">
      <div className="task-card-header">
        <span className="task-card-title">{task.title}</span>
        <span className="task-card-owner">{task.owner}</span>
        <StatusBadge status={task.status} />
      </div>
      {task.description && (
        <div className="task-card-description">{task.description}</div>
      )}
      {task.allowedFiles.length > 0 && (
        <div className="task-card-files">
          {task.allowedFiles.map((f) => (
            <span key={f} className="task-card-file">{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}
