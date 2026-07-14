import type { AgentTask } from "../types.js";
import { StatusBadge } from "./StatusBadge.js";

const NODE_W = 210;
const NODE_H = 82;
const COL_GAP = 90;
const ROW_GAP = 20;

function statusBorderColor(status: AgentTask["status"]): string {
  switch (status) {
    case "completed":             return "var(--green)";
    case "failed":                return "var(--red)";
    case "running":
    case "assigned":              return "var(--blue)";
    case "awaiting_verification": return "var(--yellow)";
    default:                      return "var(--border)";
  }
}

interface Pos {
  task: AgentTask;
  x: number;
  y: number;
}

function computeLayout(tasks: AgentTask[]): Pos[] {
  const idToTask = new Map(tasks.map((t) => [t.taskId, t]));
  const levelCache = new Map<string, number>();

  function level(id: string, stack = new Set<string>()): number {
    if (levelCache.has(id)) return levelCache.get(id)!;
    if (stack.has(id)) return 0; // cycle guard
    stack.add(id);
    const task = idToTask.get(id);
    const lv =
      !task || task.dependencies.length === 0
        ? 0
        : Math.max(...task.dependencies.map((d) => level(d, new Set(stack)))) + 1;
    levelCache.set(id, lv);
    return lv;
  }

  tasks.forEach((t) => level(t.taskId));

  const byLevel = new Map<number, AgentTask[]>();
  for (const t of tasks) {
    const lv = levelCache.get(t.taskId) ?? 0;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv)!.push(t);
  }

  const positions: Pos[] = [];
  byLevel.forEach((col, lv) => {
    col.forEach((task, idx) => {
      positions.push({
        task,
        x: lv * (NODE_W + COL_GAP),
        y: idx * (NODE_H + ROW_GAP),
      });
    });
  });

  return positions;
}

interface TaskGraphProps {
  tasks: AgentTask[];
}

export function TaskGraph({ tasks }: TaskGraphProps): React.ReactElement {
  if (tasks.length === 0) {
    return <p className="task-graph-empty">No tasks in this run.</p>;
  }

  const positions = computeLayout(tasks);
  const posMap = new Map(positions.map((p) => [p.task.taskId, p]));

  const canvasW = Math.max(...positions.map((p) => p.x)) + NODE_W + 2;
  const canvasH = Math.max(...positions.map((p) => p.y)) + NODE_H + 2;

  interface Edge { x1: number; y1: number; x2: number; y2: number }
  const edges: Edge[] = [];
  for (const { task, x, y } of positions) {
    for (const depId of task.dependencies) {
      const src = posMap.get(depId);
      if (!src) continue;
      edges.push({
        x1: src.x + NODE_W,
        y1: src.y + NODE_H / 2,
        x2: x,
        y2: y + NODE_H / 2,
      });
    }
  }

  return (
    <div className="task-graph-scroll">
      <div className="task-graph" style={{ width: canvasW, height: canvasH }}>
        {/* SVG edges */}
        <svg
          className="task-graph-svg"
          width={canvasW}
          height={canvasH}
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <defs>
            <marker
              id="dag-arrow"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="var(--border)" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const cx = (e.x1 + e.x2) / 2;
            return (
              <path
                key={i}
                d={`M ${e.x1} ${e.y1} C ${cx} ${e.y1}, ${cx} ${e.y2}, ${e.x2} ${e.y2}`}
                fill="none"
                stroke="var(--border)"
                strokeWidth="1.5"
                markerEnd="url(#dag-arrow)"
              />
            );
          })}
        </svg>

        {/* Nodes */}
        {positions.map(({ task, x, y }) => (
          <div
            key={task.taskId}
            className="task-node"
            style={{
              left: x,
              top: y,
              width: NODE_W,
              height: NODE_H,
              borderColor: statusBorderColor(task.status),
            }}
          >
            <div className="task-node-top">
              <span className="task-node-id">{task.taskId}</span>
              <StatusBadge status={task.status} />
            </div>
            <div className="task-node-title">{task.title}</div>
            <div className="task-node-owner">{task.owner}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
