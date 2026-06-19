import type { Analysis, AnalysisEvent, AnalysisPayload, PublicConfig, Report } from "./types";

export const API_BASE = (
  import.meta.env.VITE_TRADINGAGENTS_API_URL
  ?? (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:7000")
).replace(/\/$/, "");
const WS_BASE = API_BASE.replace(/^http/, "ws");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  config: () => request<PublicConfig>("/config"),
  health: () => request<{ status: string; database: string; analyses: number }>("/health"),
  analyses: () => request<Analysis[]>("/analyses"),
  analysis: (id: string) => request<Analysis>(`/analyses/${id}`),
  createAnalysis: (payload: AnalysisPayload) =>
    request<{ id: string; status: string }>("/analyses", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  events: (id: string, afterId = 0) =>
    request<AnalysisEvent[]>(`/analyses/${id}/events?after_id=${afterId}`),
  reports: (query = "") =>
    request<Analysis[]>(`/reports${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  report: (id: string) => request<Report>(`/reports/${id}`),
  saveApiKey: (provider: string, apiKey: string) =>
    request<{ provider: string; api_key_env: string; api_key_available: boolean }>(
      "/config/api-keys",
      { method: "POST", body: JSON.stringify({ provider, api_key: apiKey }) }
    ),
  terminalCommands: () => request<{ commands: string[] }>("/terminal/commands"),
  runTerminalCommand: (command: string) =>
    request<{ command: string; exit_code: number; output: string; error?: string | null }>(
      "/terminal/run",
      { method: "POST", body: JSON.stringify({ command }) }
    )
};

export function analysisStreamUrl(id: string) {
  return `${WS_BASE}/analyses/${id}/stream`;
}
