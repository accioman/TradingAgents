// Themed chart primitives built on recharts, plus two hand-rolled SVG/CSS
// gauges. All consume the series produced by metrics.ts.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { chartAxis, chartGrid, palette } from "./theme";
import { compactNumber, type LivePoint, type Slice } from "./metrics";

/* eslint-disable @typescript-eslint/no-explicit-any */

function TooltipBox({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line-strong/70 bg-ink-900/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      {label !== undefined && label !== "" && (
        <div className="mb-1 font-mono text-[11px] text-fg-faint">{label}{unit === "s" ? "s" : ""}</div>
      )}
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center gap-2 py-0.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: entry.color || entry.payload?.color || palette.brass }} />
          <span className="text-fg-muted">{entry.name}</span>
          <span className="ml-auto font-mono font-semibold tabular-nums text-fg">
            {typeof entry.value === "number" ? compactNumber(entry.value) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

const legendFormatter = (value: string) => (
  <span style={{ color: palette.muted, fontSize: 12 }}>{value}</span>
);

const axisProps = {
  stroke: chartAxis,
  fontSize: 11,
  tickLine: false,
  axisLine: false
} as const;

/* Rating distribution donut with a live total in the hub. */
export function RatingDonut({ data, height = 230 }: { data: Slice[]; height?: number }) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const display = total === 0 ? [{ name: "No ratings", value: 1, color: palette.line }] : data.filter((slice) => slice.value > 0);

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={display}
            dataKey="value"
            nameKey="name"
            innerRadius="64%"
            outerRadius="90%"
            paddingAngle={total === 0 ? 0 : 2}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive
          >
            {display.map((slice) => (
              <Cell key={slice.name} fill={slice.color} />
            ))}
          </Pie>
          {total > 0 && <Tooltip content={<TooltipBox />} />}
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="font-mono text-4xl font-semibold tabular-nums text-fg">{total}</div>
          <div className="eyebrow mt-1">rated calls</div>
        </div>
      </div>
    </div>
  );
}

/* Daily run volume. */
export function ActivityArea({
  data,
  height = 210
}: {
  data: Array<{ label: string; runs: number }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-runs" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.brass} stopOpacity={0.45} />
            <stop offset="100%" stopColor={palette.brass} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis allowDecimals={false} width={28} {...axisProps} />
        <Tooltip content={<TooltipBox />} cursor={{ stroke: palette.lineStrong, strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="runs"
          name="Runs"
          stroke={palette.brass}
          strokeWidth={2}
          fill="url(#grad-runs)"
          dot={false}
          activeDot={{ r: 4, fill: palette.brassBright, stroke: palette.ink900, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* Token economics per recent run. */
export function TokenBars({
  data,
  height = 230
}: {
  data: Array<{ name: string; tokensIn: number; tokensOut: number }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barGap={3}>
        <defs>
          <linearGradient id="grad-in" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.azure} stopOpacity={0.95} />
            <stop offset="100%" stopColor={palette.azure} stopOpacity={0.35} />
          </linearGradient>
          <linearGradient id="grad-out" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.iris} stopOpacity={0.95} />
            <stop offset="100%" stopColor={palette.iris} stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
        <XAxis dataKey="name" {...axisProps} interval={0} />
        <YAxis tickFormatter={compactNumber} width={40} {...axisProps} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Legend formatter={legendFormatter} iconType="circle" iconSize={8} />
        <Bar dataKey="tokensIn" name="Tokens in" fill="url(#grad-in)" radius={[4, 4, 0, 0]} maxBarSize={34} />
        <Bar dataKey="tokensOut" name="Tokens out" fill="url(#grad-out)" radius={[4, 4, 0, 0]} maxBarSize={34} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* Live cumulative token throughput over elapsed seconds. */
export function LiveTokenArea({ data, height = 220 }: { data: LivePoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-live-in" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.azure} stopOpacity={0.4} />
            <stop offset="100%" stopColor={palette.azure} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grad-live-out" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.iris} stopOpacity={0.4} />
            <stop offset="100%" stopColor={palette.iris} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
        <XAxis dataKey="t" tickFormatter={(value) => `${value}s`} {...axisProps} />
        <YAxis tickFormatter={compactNumber} width={40} {...axisProps} />
        <Tooltip content={<TooltipBox unit="s" />} cursor={{ stroke: palette.lineStrong, strokeWidth: 1 }} />
        <Legend formatter={legendFormatter} iconType="circle" iconSize={8} />
        <Area type="monotone" dataKey="tokensIn" name="Tokens in" stroke={palette.azure} strokeWidth={2} fill="url(#grad-live-in)" dot={false} isAnimationActive={false} />
        <Area type="monotone" dataKey="tokensOut" name="Tokens out" stroke={palette.iris} strokeWidth={2} fill="url(#grad-live-out)" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* Live call counters over elapsed seconds. */
export function LiveCallsLine({ data, height = 200 }: { data: LivePoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
        <XAxis dataKey="t" tickFormatter={(value) => `${value}s`} {...axisProps} />
        <YAxis allowDecimals={false} width={28} {...axisProps} />
        <Tooltip content={<TooltipBox unit="s" />} cursor={{ stroke: palette.lineStrong, strokeWidth: 1 }} />
        <Legend formatter={legendFormatter} iconType="circle" iconSize={8} />
        <Line type="monotone" dataKey="llm" name="LLM calls" stroke={palette.brass} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="tools" name="Tool calls" stroke={palette.bull} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* Tool-call frequency leaderboard (horizontal). */
export function ToolFrequencyBars({
  data,
  height = 200
}: {
  data: Array<{ name: string; count: number }>;
  height?: number;
}) {
  if (!data.length) {
    return <div className="grid h-40 place-items-center text-sm text-fg-faint">No tool calls yet</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <defs>
          <linearGradient id="grad-tool" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={palette.bull} stopOpacity={0.4} />
            <stop offset="100%" stopColor={palette.bull} stopOpacity={0.95} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axisProps} />
        <YAxis type="category" dataKey="name" width={120} {...axisProps} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey="count" name="Calls" fill="url(#grad-tool)" radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* Compact KPI sparkline. */
export function Sparkline({ data, color }: { data: number[]; color: string }) {
  const id = `spark-${color.replace("#", "")}`;
  const points = data.length ? data.map((value, index) => ({ index, value })) : [{ index: 0, value: 0 }];
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={points} margin={{ top: 3, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* Agent completion ring (hand-rolled SVG for crisp control). */
export function ProgressRing({
  pct,
  size = 132,
  primary,
  secondary
}: {
  pct: number;
  size?: number;
  primary: string;
  secondary: string;
}) {
  const stroke = 11;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={primary} />
            <stop offset="100%" stopColor={secondary} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(44,60,96,0.5)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-mono text-3xl font-semibold tabular-nums text-fg">{pct}%</div>
          <div className="eyebrow mt-0.5">complete</div>
        </div>
      </div>
    </div>
  );
}

/* Diverging bull/bear bias meter (CSS). score in [-1, 1]. */
export function BiasMeter({ score, label }: { score: number; label: string }) {
  const position = ((Math.max(-1, Math.min(1, score)) + 1) / 2) * 100;
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="eyebrow text-bear">Bearish</span>
        <span className="eyebrow text-fg-faint">Neutral</span>
        <span className="eyebrow text-bull">Bullish</span>
      </div>
      <div
        className="relative mt-2.5 h-2.5 rounded-full"
        style={{ background: `linear-gradient(90deg, ${palette.bear} 0%, ${palette.brass} 50%, ${palette.bull} 100%)` }}
      >
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-900 bg-fg shadow-lift"
          style={{ left: `${position}%` }}
        />
      </div>
      <div className="mt-3 flex items-baseline justify-center gap-2">
        <span className="font-display text-lg font-semibold text-fg">{label}</span>
        <span className="font-mono text-sm tabular-nums text-fg-faint">{score >= 0 ? "+" : ""}{score.toFixed(2)}</span>
      </div>
    </div>
  );
}
