import type { LeaderboardEntry } from "../types.js";
import { useLeaderboard } from "../hooks/useLeaderboard.js";

function scoreClass(score: number): string {
  if (score >= 70) return "score-high";
  if (score >= 40) return "score-medium";
  return "score-low";
}

export function Leaderboard(): React.ReactElement {
  const { leaderboard, loading, error } = useLeaderboard();

  if (loading) return <div className="loading-text">Loading leaderboard…</div>;
  if (error) return <div className="error-text">{error}</div>;
  if (!leaderboard || leaderboard.entries.length === 0) {
    return <div className="leaderboard-empty">No data yet.</div>;
  }

  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>Task</th>
          <th>Run ID</th>
          <th>Boundary Viol.</th>
          <th>Tool Denials</th>
          <th>Denies</th>
          <th>Risk Score</th>
        </tr>
      </thead>
      <tbody>
        {leaderboard.entries.map((entry: LeaderboardEntry) => (
          <tr key={`${entry.runId}-${entry.taskId}`}>
            <td>{entry.title}</td>
            <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
              {entry.runId.slice(0, 8)}…
            </td>
            <td>{entry.boundaryViolationCount}</td>
            <td>{entry.toolDenialCount}</td>
            <td>{entry.denyCount}</td>
            <td>
              <span className={`leaderboard-score ${scoreClass(entry.riskScore)}`}>
                {entry.riskScore.toFixed(1)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
