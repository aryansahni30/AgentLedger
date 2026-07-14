import { useState } from "react";
import { useSSEContext } from "./context/SSEContext.js";
import { UserProvider, useCurrentUser } from "./context/UserContext.js";
import { useRuns } from "./hooks/useRuns.js";
import { RunList } from "./components/RunList.js";
import { RunDetail } from "./components/RunDetail.js";
import { EventFeed } from "./components/EventFeed.js";
import { Leaderboard } from "./components/Leaderboard.js";

type Tab = "runs" | "leaderboard";
type RunFilter = "all" | "mine";

function ConnectionBadge(): React.ReactElement {
  const { connected } = useSSEContext();
  return (
    <div className="connection-badge">
      <span className={`connection-dot${connected ? " connected" : ""}`} />
      <span>{connected ? "Live" : "Reconnecting…"}</span>
    </div>
  );
}

function AppInner(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("runs");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  const { runs } = useRuns();
  const currentUser = useCurrentUser();

  const selectedRun = selectedRunId
    ? (runs.find((r) => r.runId === selectedRunId) ?? null)
    : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>AgentLedger</h1>
        <div className="tab-bar">
          <button
            className={`tab-btn${tab === "runs" ? " active" : ""}`}
            onClick={() => setTab("runs")}
          >
            Runs
          </button>
          <button
            className={`tab-btn${tab === "leaderboard" ? " active" : ""}`}
            onClick={() => setTab("leaderboard")}
          >
            Leaderboard
          </button>
        </div>
        <ConnectionBadge />
      </header>

      <aside className="app-sidebar">
        {tab === "runs" ? (
          <>
            <div className="run-filter-bar">
              <button
                className={`filter-btn${runFilter === "all" ? " active" : ""}`}
                onClick={() => setRunFilter("all")}
              >
                Team
              </button>
              <button
                className={`filter-btn${runFilter === "mine" ? " active" : ""}`}
                onClick={() => setRunFilter("mine")}
                title={`Runs by ${currentUser}`}
              >
                Mine
              </button>
            </div>
            <RunList
              selectedRunId={selectedRunId}
              onSelect={setSelectedRunId}
              filter={runFilter}
            />
          </>
        ) : (
          <div className="run-list-header">Policy Ranks</div>
        )}
      </aside>

      <main className="app-main">
        {tab === "runs" ? (
          <RunDetail run={selectedRun} />
        ) : (
          <Leaderboard />
        )}
      </main>

      <aside className="app-feed">
        <EventFeed />
      </aside>
    </div>
  );
}

export function App(): React.ReactElement {
  return (
    <UserProvider>
      <AppInner />
    </UserProvider>
  );
}
