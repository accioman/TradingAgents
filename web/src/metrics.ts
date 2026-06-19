// Pure transforms from API payloads -> chart-ready series.
// Every number shown in a chart traces back to real backend data.

import type { Analysis, AnalysisEvent } from "./types";
import { RATING_COLOR, RATING_ORDER, RATING_WEIGHT } from "./theme";

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRating(rating?: string | null): string | null {
  if (!rating) return null;
  const match = RATING_ORDER.find((item) => item.toLowerCase() === rating.toLowerCase());
  return match ?? null;
}

export type Slice = { name: string; value: number; color: string };

/** Full 5-tier rating distribution (zeros kept so the donut shape stays stable). */
export function ratingDistribution(analyses: Analysis[]): Slice[] {
  const counts = new Map<string, number>(RATING_ORDER.map((rating) => [rating, 0]));
  for (const analysis of analyses) {
    const rating = normalizeRating(analysis.summary?.rating);
    if (rating) counts.set(rating, (counts.get(rating) ?? 0) + 1);
  }
  return RATING_ORDER.map((rating) => ({
    name: rating,
    value: counts.get(rating) ?? 0,
    color: RATING_COLOR[rating]
  }));
}

export function ratedCount(analyses: Analysis[]): number {
  return analyses.filter((analysis) => normalizeRating(analysis.summary?.rating)).length;
}

/** Aggregate desk bias in [-1, 1] from the weighted rating mix. */
export function deskBias(analyses: Analysis[]): { score: number; label: string } {
  const weights = analyses
    .map((analysis) => normalizeRating(analysis.summary?.rating))
    .filter((rating): rating is string => Boolean(rating))
    .map((rating) => RATING_WEIGHT[rating]);
  if (!weights.length) return { score: 0, label: "No signal" };
  const score = weights.reduce((sum, weight) => sum + weight, 0) / weights.length;
  const label =
    score > 0.33 ? "Bullish" : score > 0.1 ? "Lean bullish" : score < -0.33 ? "Bearish" : score < -0.1 ? "Lean bearish" : "Neutral";
  return { score, label };
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function countByDay(analyses: Analysis[], predicate: (analysis: Analysis) => boolean): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const analysis of analyses) {
    if (!predicate(analysis)) continue;
    const key = (analysis.created_at || analysis.analysis_date || "").slice(0, 10);
    if (key) byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return byDay;
}

/** Continuous daily run volume over a trailing calendar window. */
export function activitySeries(analyses: Analysis[], days = 14): Array<{ date: string; label: string; runs: number }> {
  const byDay = countByDay(analyses, () => true);
  const series: Array<{ date: string; label: string; runs: number }> = [];
  const end = new Date();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setDate(end.getDate() - offset);
    const key = dayKey(date);
    series.push({
      date: key,
      label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
      runs: byDay.get(key) ?? 0
    });
  }
  return series;
}

/** Trailing daily counts for a status, for KPI sparklines. */
export function dailySeries(analyses: Analysis[], predicate: (analysis: Analysis) => boolean, days = 14): number[] {
  const byDay = countByDay(analyses, predicate);
  const series: number[] = [];
  const end = new Date();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setDate(end.getDate() - offset);
    series.push(byDay.get(dayKey(date)) ?? 0);
  }
  return series;
}

/** Token economics for the most recent completed runs. */
export function tokenBars(
  analyses: Analysis[],
  limit = 8
): Array<{ name: string; tokensIn: number; tokensOut: number }> {
  return analyses
    .filter((analysis) => analysis.stats && (num(analysis.stats.tokens_in) || num(analysis.stats.tokens_out)))
    .slice(0, limit)
    .reverse()
    .map((analysis, index) => ({
      name: `${analysis.ticker}·${index + 1}`,
      tokensIn: num(analysis.stats?.tokens_in),
      tokensOut: num(analysis.stats?.tokens_out)
    }));
}

export function statusBreakdown(analyses: Analysis[]): Record<string, number> {
  return analyses.reduce<Record<string, number>>((acc, analysis) => {
    acc[analysis.status] = (acc[analysis.status] ?? 0) + 1;
    return acc;
  }, {});
}

// ---- Live stream metrics -------------------------------------------------

export type LivePoint = {
  t: number;
  tokensIn: number;
  tokensOut: number;
  llm: number;
  tools: number;
};

/** Cumulative stats sampled over elapsed time, from streamed "stats" events. */
export function statsTimeline(events: AnalysisEvent[]): LivePoint[] {
  const points: LivePoint[] = [];
  let lastT = -1;
  for (const event of events) {
    if (event.type !== "stats") continue;
    const stats = (event.payload.stats ?? {}) as Record<string, unknown>;
    const t = Math.round(num(event.payload.elapsed_seconds));
    const point: LivePoint = {
      t,
      tokensIn: num(stats.tokens_in),
      tokensOut: num(stats.tokens_out),
      llm: num(stats.llm_calls),
      tools: num(stats.tool_calls)
    };
    if (t === lastT && points.length) points[points.length - 1] = point;
    else points.push(point);
    lastT = t;
  }
  return points;
}

/** Tool-call frequency leaderboard from streamed "tool" events. */
export function toolFrequency(events: AnalysisEvent[], limit = 7): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "tool") continue;
    const name = (event.payload.tool_name as string) || event.message || "tool";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function agentProgress(agentStatus: Record<string, string>): { completed: number; active: number; total: number; pct: number } {
  const values = Object.values(agentStatus);
  const total = values.length;
  const completed = values.filter((status) => status === "completed").length;
  const active = values.filter((status) => status === "in_progress" || status === "running").length;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  return { completed, active, total, pct };
}

export function compactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}
