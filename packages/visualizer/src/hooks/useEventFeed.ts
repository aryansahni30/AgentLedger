import { useState } from "react";
import type { LedgerEvent } from "../types.js";
import { useSSE } from "./useSSE.js";

const MAX_EVENTS = 100;

interface UseEventFeedResult {
  events: LedgerEvent[];
}

export function useEventFeed(): UseEventFeedResult {
  const [events, setEvents] = useState<LedgerEvent[]>([]);

  useSSE((event) => {
    setEvents((prev) => {
      const next = [...prev, event];
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
    });
  });

  return { events };
}
