import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LedgerEvent } from "../types.js";

type Listener = (event: LedgerEvent) => void;

interface SSEContextValue {
  subscribe: (listener: Listener) => () => void;
  connected: boolean;
}

const SSEContext = createContext<SSEContextValue | null>(null);

export function SSEProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const listenersRef = useRef<Set<Listener>>(new Set());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect(): void {
      if (destroyed) return;
      es = new EventSource("/api/events");

      es.onopen = (): void => {
        setConnected(true);
      };

      es.onmessage = (e: MessageEvent<string>): void => {
        try {
          const event = JSON.parse(e.data) as LedgerEvent;
          listenersRef.current.forEach((l) => l(event));
        } catch {
          // malformed — ignore
        }
      };

      es.onerror = (): void => {
        setConnected(false);
        es?.close();
        es = null;
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  const subscribe = useCallback((listener: Listener): (() => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  return (
    <SSEContext.Provider value={{ subscribe, connected }}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSEContext(): SSEContextValue {
  const ctx = useContext(SSEContext);
  if (ctx === null) {
    throw new Error("useSSEContext must be used within SSEProvider");
  }
  return ctx;
}
