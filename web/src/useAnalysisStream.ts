import { useEffect, useState } from "react";
import { analysisStreamUrl } from "./api";
import type { AnalysisEvent } from "./types";

export function useAnalysisStream(analysisId: string | null) {
  const [events, setEvents] = useState<AnalysisEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setEvents([]);
    if (!analysisId) {
      setConnected(false);
      return;
    }

    const socket = new WebSocket(analysisStreamUrl(analysisId));
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setConnected(false);
    socket.onmessage = (message) => {
      const event = JSON.parse(message.data) as AnalysisEvent;
      setEvents((current) => {
        if (current.some((item) => item.id === event.id)) return current;
        return [...current, event].sort((a, b) => a.id - b.id);
      });
    };

    return () => {
      socket.close();
    };
  }, [analysisId]);

  return { events, connected };
}
