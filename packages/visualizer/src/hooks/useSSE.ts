import { useEffect, useRef } from "react";
import type { LedgerEvent } from "../types.js";
import { useSSEContext } from "../context/SSEContext.js";

/**
 * Subscribes to the shared SSE stream via SSEContext.
 * Calls onEvent for each parsed LedgerEvent.
 */
export function useSSE(onEvent: (event: LedgerEvent) => void): void {
  const { subscribe } = useSSEContext();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    return subscribe((event) => onEventRef.current(event));
  }, [subscribe]);
}
