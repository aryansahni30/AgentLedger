import { useEffect, useRef } from "react";
import type { LedgerEvent } from "../types.js";
import { useEventFeed } from "../hooks/useEventFeed.js";

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function summarizePayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload).slice(0, 3);
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
}

export function EventFeed(): React.ReactElement {
  const { events } = useEventFeed();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <>
      <div className="event-feed-header">
        <span>Live Events</span>
        <span className="event-feed-count">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className="event-feed-empty">Waiting for events…</div>
      ) : (
        <div className="event-list">
          {events.map((event: LedgerEvent) => (
            <div key={event.event_id} className="event-item">
              <div className="event-item-type">{event.event_type}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <span className="event-item-actor">{event.actor}</span>
                <span className="event-item-ts">{formatTs(event.timestamp)}</span>
              </div>
              {Object.keys(event.payload).length > 0 && (
                <div className="event-item-payload">
                  {summarizePayload(event.payload)}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </>
  );
}
