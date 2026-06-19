import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import {
  Activity,
  AlertTriangle,
  Briefcase,
  CandlestickChart,
  CheckCircle2,
  ClipboardList,
  Coins,
  Cpu,
  Download,
  FileText,
  KeyRound,
  Landmark,
  Layers,
  Play,
  Radio,
  RefreshCw,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  SquareTerminal,
  Telescope,
  Wrench
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { api, API_BASE } from "./api";
import {
  ActivityArea,
  BiasMeter,
  LiveCallsLine,
  LiveTokenArea,
  ProgressRing,
  RatingDonut,
  Sparkline,
  TokenBars,
  ToolFrequencyBars
} from "./charts";
import {
  activitySeries,
  agentProgress,
  compactNumber,
  dailySeries,
  deskBias,
  ratingDistribution,
  statsTimeline,
  tokenBars,
  toolFrequency
} from "./metrics";
import { palette, ratingClass, RATING_ORDER, RATING_WEIGHT } from "./theme";
import { useUIStore, type View } from "./store";
import type { Analysis, AnalysisEvent, AnalysisPayload, ProviderConfig, ReportSection } from "./types";
import { useAnalysisStream } from "./useAnalysisStream";
import schemaUrl from "../../assets/schema.png";

const AGENT_GROUPS: Array<[string, string[]]> = [
  ["Analyst Team", ["Market Analyst", "Sentiment Analyst", "News Analyst", "Fundamentals Analyst"]],
  ["Research Team", ["Bull Researcher", "Bear Researcher", "Research Manager"]],
  ["Trading Team", ["Trader"]],
  ["Risk Management", ["Aggressive Analyst", "Neutral Analyst", "Conservative Analyst"]],
  ["Portfolio", ["Portfolio Manager"]]
];

const PIPELINE: Array<{ key: string; label: string; icon: typeof Telescope; members: string[] }> = [
  { key: "analysts", label: "Analysts", icon: Telescope, members: ["Market Analyst", "Sentiment Analyst", "News Analyst", "Fundamentals Analyst"] },
  { key: "research", label: "Research", icon: Scale, members: ["Bull Researcher", "Bear Researcher", "Research Manager"] },
  { key: "trader", label: "Trader", icon: CandlestickChart, members: ["Trader"] },
  { key: "risk", label: "Risk", icon: ShieldAlert, members: ["Aggressive Analyst", "Neutral Analyst", "Conservative Analyst"] },
  { key: "portfolio", label: "Portfolio", icon: Briefcase, members: ["Portfolio Manager"] }
];

const NAV: { id: View; label: string; icon: typeof CandlestickChart }[] = [
  { id: "dashboard", label: "Overview", icon: Layers },
  { id: "new", label: "New analysis", icon: ClipboardList },
  { id: "monitor", label: "Live monitor", icon: Radio },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "settings", label: "Providers", icon: Settings },
  { id: "terminal", label: "Terminal", icon: SquareTerminal }
];

const today = () => new Date().toISOString().slice(0, 10);

export default function App() {
  const { view, setView } = useUIStore();
  const setActiveAnalysisId = useUIStore((state) => state.setActiveAnalysisId);
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15000 });
  const analyses = useQuery({ queryKey: ["analyses"], queryFn: api.analyses, refetchInterval: 5000 });
  const online = health.data?.status === "ok";

  return (
    <div className="shell min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line/60 bg-ink-900/80 backdrop-blur-xl lg:flex">
        <div className="flex h-14 items-center gap-3 border-b border-line/60 px-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brass-sheen text-ink-900 shadow-brass">
            <Landmark size={19} />
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight">TradingAgents</div>
            <div className="eyebrow">Desk Console</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? "nav-item-active" : ""}`}
                onClick={() => setView(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="border-t border-line/60 p-4">
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span className={`h-2 w-2 rounded-full ${online ? "animate-pulse-dot bg-bull" : "bg-bear"}`} />
            <span>{online ? "Backend online" : "Backend offline"}</span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-fg-faint">{API_BASE}</div>
        </div>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-line/60 bg-ink-900/70 px-4 backdrop-blur-xl lg:px-8">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brass-sheen text-ink-900">
              <Landmark size={17} />
            </span>
            <span className="font-display font-semibold">TradingAgents</span>
          </div>
          <div className="hidden min-w-0 flex-1 lg:block">
            <TickerTape
              analyses={analyses.data ?? []}
              onPick={(id) => {
                setActiveAnalysisId(id);
                setView("monitor");
              }}
            />
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-full border border-line/60 bg-ink-800/60 px-3 py-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${online ? "animate-pulse-dot bg-bull" : "bg-bear"}`} />
            <span className="text-fg-muted">{online ? "Live" : "Offline"}</span>
          </div>
        </header>

        <div className="grid grid-cols-3 gap-1.5 border-b border-line/60 bg-ink-900/60 p-2 lg:hidden">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`mobile-nav ${view === item.id ? "mobile-nav-active" : ""}`}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <section className="mx-auto max-w-7xl px-4 py-7 lg:px-8">
          {view === "dashboard" && <Dashboard />}
          {view === "new" && <NewAnalysis />}
          {view === "monitor" && <Monitor />}
          {view === "reports" && <Reports />}
          {view === "settings" && <SettingsView />}
          {view === "terminal" && <TerminalView />}
        </section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function Dashboard() {
  const setView = useUIStore((state) => state.setView);
  const setActiveAnalysisId = useUIStore((state) => state.setActiveAnalysisId);
  const queryClient = useQueryClient();
  const analyses = useQuery({ queryKey: ["analyses"], queryFn: api.analyses, refetchInterval: 5000 });
  const createDemo = useMutation({
    mutationFn: () =>
      api.createAnalysis({
        ticker: "SPY",
        analysis_date: today(),
        analysts: ["market", "social", "news"],
        research_depth: 1,
        demo: true
      }),
    onSuccess: (created) => {
      setActiveAnalysisId(created.id);
      setView("monitor");
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
    }
  });

  const rows = analyses.data ?? [];
  const running = rows.filter((item) => item.status === "running").length;
  const completed = rows.filter((item) => item.status === "completed").length;
  const errors = rows.filter((item) => item.status === "error").length;

  const distribution = useMemo(() => ratingDistribution(rows), [rows]);
  const bias = useMemo(() => deskBias(rows), [rows]);
  const activity = useMemo(() => activitySeries(rows, 14), [rows]);
  const tokens = useMemo(() => tokenBars(rows, 8), [rows]);
  const sparkTotal = useMemo(() => dailySeries(rows, () => true), [rows]);
  const sparkDone = useMemo(() => dailySeries(rows, (item) => item.status === "completed"), [rows]);
  const sparkErr = useMemo(() => dailySeries(rows, (item) => item.status === "error"), [rows]);

  function open(id: string) {
    setActiveAnalysisId(id);
    setView("monitor");
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-bull" /> Trading desk · {today()}
          </div>
          <h1 className="mt-1.5 font-display text-3xl font-semibold tracking-tight">Desk overview</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {rows.length} analyses on the tape · {running} running now
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => createDemo.mutate()} disabled={createDemo.isPending}>
            <Play size={16} /> Demo run
          </button>
          <button className="btn-primary" onClick={() => setView("new")}>
            <ClipboardList size={16} /> New analysis
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total runs" value={rows.length} icon={Layers} color={palette.brass} spark={sparkTotal} />
        <KpiCard label="Running" value={running} icon={Activity} color={palette.azure} live={running > 0} />
        <KpiCard label="Completed" value={completed} icon={CheckCircle2} color={palette.bull} spark={sparkDone} />
        <KpiCard label="Errors" value={errors} icon={AlertTriangle} color={palette.bear} spark={sparkErr} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="panel xl:col-span-2">
          <div className="panel-title">
            <span>Run volume</span>
            <span className="eyebrow">last 14 days</span>
          </div>
          <ActivityArea data={activity} />
        </div>
        <div className="panel">
          <div className="panel-title">
            <span>Signal mix</span>
            <button className="btn-ghost" onClick={() => analyses.refetch()}>
              <RefreshCw size={14} /> Sync
            </button>
          </div>
          <RatingDonut data={distribution} />
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {distribution.map((slice) => (
              <div key={slice.name} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: slice.color }} />
                <span className="text-fg-muted">{slice.name}</span>
                <span className="ml-auto font-mono tabular-nums text-fg">{slice.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 border-t border-line/50 pt-4">
            <BiasMeter score={bias.score} label={bias.label} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="panel xl:col-span-2">
          <div className="panel-title">
            <span>Recent analyses</span>
            <button className="btn-ghost" onClick={() => setView("reports")}>
              View all
            </button>
          </div>
          <AnalysisTable analyses={rows.slice(0, 8)} onSelect={open} />
        </div>
        <div className="panel">
          <div className="panel-title">
            <span>Token economics</span>
            <Coins size={16} className="text-fg-faint" />
          </div>
          {tokens.length ? (
            <TokenBars data={tokens} />
          ) : (
            <div className="empty-state">No token data yet</div>
          )}
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="panel-title">
          <span>How the desk thinks</span>
          <span className="eyebrow">agent topology</span>
        </div>
        <img src={schemaUrl} alt="TradingAgents workflow" className="w-full rounded-xl border border-line/50 bg-ink-900/60 object-contain p-2" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New analysis                                                        */
/* ------------------------------------------------------------------ */

function NewAnalysis() {
  const queryClient = useQueryClient();
  const setView = useUIStore((state) => state.setView);
  const setActiveAnalysisId = useUIStore((state) => state.setActiveAnalysisId);
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const [initialized, setInitialized] = useState(false);
  const [form, setForm] = useState<AnalysisPayload>({
    ticker: "SPY",
    analysis_date: today(),
    asset_type: "stock",
    analysts: ["market", "social", "news", "fundamentals"],
    research_depth: 1,
    output_language: "English",
    checkpoint_enabled: false,
    demo: false
  });

  useEffect(() => {
    if (!config.data || initialized) return;
    setForm((current) => ({
      ...current,
      llm_provider: config.data.defaults.llm_provider,
      quick_think_llm: config.data.defaults.quick_think_llm,
      deep_think_llm: config.data.defaults.deep_think_llm,
      output_language: config.data.defaults.output_language,
      research_depth: config.data.defaults.research_depth,
      checkpoint_enabled: config.data.defaults.checkpoint_enabled
    }));
    setInitialized(true);
  }, [config.data, initialized]);

  const provider = config.data?.providers.find((item) => item.id === form.llm_provider);
  const create = useMutation({
    mutationFn: api.createAnalysis,
    onSuccess: (created) => {
      setActiveAnalysisId(created.id);
      setView("monitor");
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
    }
  });

  function update<K extends keyof AnalysisPayload>(key: K, value: AnalysisPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeProvider(next: string) {
    const selected = config.data?.providers.find((item) => item.id === next);
    setForm((current) => ({
      ...current,
      llm_provider: next,
      quick_think_llm: selected?.models.quick[0]?.value ?? current.quick_think_llm,
      deep_think_llm: selected?.models.deep[0]?.value ?? current.deep_think_llm,
      backend_url: selected?.default_url ?? undefined
    }));
  }

  return (
    <form
      className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(form);
      }}
    >
      <div className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Order ticket</div>
            <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">New analysis</h1>
          </div>
          <button className="btn-primary" disabled={create.isPending}>
            <Play size={16} /> {create.isPending ? "Launching…" : "Run analysis"}
          </button>
        </div>

        <div className="panel space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="field">
              <span>Ticker</span>
              <input className="input font-mono" list="tickers" value={form.ticker} onChange={(event) => update("ticker", event.target.value.toUpperCase())} />
              <datalist id="tickers">
                {["SPY", "AAPL", "MSFT", "NVDA", "TSLA", "0700.HK", "BTC-USD", "ETH-USD"].map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Analysis date</span>
              <input className="input" type="date" value={form.analysis_date} onChange={(event) => update("analysis_date", event.target.value)} />
            </label>
            <label className="field">
              <span>Market</span>
              <select className="input" value={form.asset_type} onChange={(event) => update("asset_type", event.target.value)}>
                {(config.data?.asset_types ?? ["stock", "crypto"]).map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {["SPY", "AAPL", "MSFT", "NVDA", "TSLA", "BTC-USD", "ETH-USD"].map((item) => (
              <button type="button" key={item} className={`chip ${form.ticker === item ? "border-brass/60 text-brass" : ""}`} onClick={() => update("ticker", item)}>
                {item}
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="field">
              <span>LLM provider</span>
              <select className="input" value={form.llm_provider ?? ""} onChange={(event) => changeProvider(event.target.value)}>
                {(config.data?.providers ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Quick model</span>
              <select className="input" value={form.quick_think_llm ?? ""} onChange={(event) => update("quick_think_llm", event.target.value)}>
                {(provider?.models.quick ?? []).map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Deep model</span>
              <select className="input" value={form.deep_think_llm ?? ""} onChange={(event) => update("deep_think_llm", event.target.value)}>
                {(provider?.models.deep ?? []).map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_160px_160px]">
            <label className="field">
              <span>Backend URL</span>
              <input className="input font-mono text-xs" value={form.backend_url ?? ""} onChange={(event) => update("backend_url", event.target.value || undefined)} />
            </label>
            <label className="field">
              <span>Research depth</span>
              <input className="input" type="number" min={1} max={5} value={form.research_depth} onChange={(event) => update("research_depth", Number(event.target.value))} />
            </label>
            <label className="field">
              <span>Output language</span>
              <select className="input" value={form.output_language} onChange={(event) => update("output_language", event.target.value)}>
                {["English", "Italian", "Chinese", "Japanese", "Korean"].map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-3">
            <div className="section-label">Analyst team</div>
            <div className="grid gap-2 md:grid-cols-4">
              {(config.data?.analysts ?? []).map((analyst) => (
                <label key={analyst.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={form.analysts.includes(analyst.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...form.analysts, analyst.id]
                        : form.analysts.filter((item) => item !== analyst.id);
                      update("analysts", next);
                    }}
                  />
                  <span>{analyst.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="panel space-y-4">
          <div className="section-label">Run options</div>
          <label className="toggle-row">
            <input type="checkbox" checked={!!form.checkpoint_enabled} onChange={(event) => update("checkpoint_enabled", event.target.checked)} />
            <span>Checkpoint / resume</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={!!form.demo} onChange={(event) => update("demo", event.target.checked)} />
            <span>Demo without API key</span>
          </label>
          {provider && (
            <div className="card text-sm">
              <div className="flex items-center gap-2 font-medium text-fg">
                <KeyRound size={15} className="text-brass" />
                {provider.api_key_env ?? "No API key required"}
              </div>
              <div className="mt-2 text-fg-muted">
                {provider.api_key_available === true && "Configured in backend"}
                {provider.api_key_available === false && "Not configured — add it under Providers"}
                {provider.api_key_available === null && "Not required"}
              </div>
            </div>
          )}
          {create.error && <div className="error-box">{String(create.error.message)}</div>}
        </div>

        <div className="panel">
          <div className="section-label mb-3">Pipeline</div>
          <img src={schemaUrl} alt="TradingAgents workflow" className="w-full rounded-lg border border-line/50 bg-ink-900/60 object-contain p-2" />
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Monitor                                                             */
/* ------------------------------------------------------------------ */

function Monitor() {
  const activeAnalysisId = useUIStore((state) => state.activeAnalysisId);
  const setActiveAnalysisId = useUIStore((state) => state.setActiveAnalysisId);
  const analyses = useQuery({ queryKey: ["analyses"], queryFn: api.analyses, refetchInterval: 5000 });
  const analysis = useQuery({
    queryKey: ["analysis", activeAnalysisId],
    queryFn: () => api.analysis(activeAnalysisId!),
    enabled: !!activeAnalysisId,
    refetchInterval: 5000
  });
  const { events, connected } = useAnalysisStream(activeAnalysisId);

  const agentStatus =
    latestPayload(events, "agent_status")?.agent_status ?? latestPayload(events, "progress")?.agent_status ?? {};
  const stats = latestPayload(events, "stats")?.stats ?? analysis.data?.stats ?? {};
  const timeline = useMemo(() => statsTimeline(events), [events]);
  const tools = useMemo(() => toolFrequency(events), [events]);
  const progress = useMemo(() => agentProgress(agentStatus), [agentStatus]);
  const sections = reportSectionsFromEvents(events);
  const logs = events.filter((event) => ["log", "tool", "status", "error"].includes(event.type));

  if (!activeAnalysisId) {
    return (
      <div className="space-y-5">
        <div>
          <div className="eyebrow">Live monitor</div>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Select an analysis</h1>
        </div>
        <div className="panel">
          <AnalysisTable analyses={analyses.data ?? []} onSelect={setActiveAnalysisId} />
        </div>
      </div>
    );
  }

  const liveStats = [
    { label: "LLM calls", value: num(stats.llm_calls), icon: Cpu, color: palette.brass, series: timeline.map((point) => point.llm) },
    { label: "Tool calls", value: num(stats.tool_calls), icon: Wrench, color: palette.bull, series: timeline.map((point) => point.tools) },
    { label: "Tokens in", value: num(stats.tokens_in), icon: Coins, color: palette.azure, series: timeline.map((point) => point.tokensIn) },
    { label: "Tokens out", value: num(stats.tokens_out), icon: Coins, color: palette.iris, series: timeline.map((point) => point.tokensOut) }
  ];
  const elapsed = num(latestPayload(events, "stats")?.elapsed_seconds ?? stats.elapsed_seconds);

  return (
    <div className="space-y-6">
      <div className="panel flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-line/60 bg-ink-900/60 font-display text-lg font-semibold text-brass">
            {(analysis.data?.ticker ?? "··").slice(0, 4)}
          </div>
          <div>
            <div className="font-display text-xl font-semibold tracking-tight">{analysis.data?.ticker ?? "Analysis"}</div>
            <div className="font-mono text-xs text-fg-muted">
              {analysis.data?.analysis_date} · {analysis.data?.asset_type} {elapsed ? `· ${elapsed.toFixed(0)}s` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {analysis.data?.summary?.rating && <RatingPill rating={analysis.data.summary.rating} />}
          <StatusBadge status={analysis.data?.status ?? "running"} />
          <span className="flex items-center gap-2 rounded-full border border-line/60 bg-ink-800/60 px-3 py-1.5 text-xs text-fg-muted">
            <span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse-dot bg-bull" : "bg-fg-faint"}`} />
            stream
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {liveStats.map((item) => (
          <KpiCard key={item.label} label={item.label} value={compactNumber(item.value)} icon={item.icon} color={item.color} spark={item.series} />
        ))}
      </div>

      <div className="panel">
        <div className="panel-title">
          <span>Deliberation pipeline</span>
          <span className="eyebrow">{progress.completed}/{progress.total} agents done</span>
        </div>
        <Pipeline agentStatus={agentStatus} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div className="panel">
            <div className="panel-title"><span>Token throughput</span><span className="eyebrow">cumulative</span></div>
            {timeline.length ? <LiveTokenArea data={timeline} /> : <div className="empty-state">Waiting for stream…</div>}
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="panel">
              <div className="panel-title"><span>Call activity</span></div>
              {timeline.length ? <LiveCallsLine data={timeline} /> : <div className="empty-state">Waiting…</div>}
            </div>
            <div className="panel">
              <div className="panel-title"><span>Tool usage</span></div>
              <ToolFrequencyBars data={tools} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-title"><span>Streaming log</span><span className="eyebrow">{logs.length} events</span></div>
            <div className="log-pane">
              {logs.length === 0 && <div className="text-fg-faint">No events yet…</div>}
              {logs.map((event) => (
                <div key={event.id} className="log-row">
                  <span className="text-fg-faint">{new Date(event.created_at).toLocaleTimeString()}</span>
                  <span className={logTone(event.type)}>{event.type}</span>
                  <span className="break-words text-fg-muted">{event.message ?? event.payload.tool_name ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="panel flex flex-col items-center">
            <div className="panel-title w-full"><span>Agent completion</span></div>
            <ProgressRing pct={progress.pct} primary={palette.bull} secondary={palette.azure} />
            <div className="mt-4 grid w-full grid-cols-3 gap-2 text-center">
              <MiniStat label="Done" value={progress.completed} color={palette.bull} />
              <MiniStat label="Active" value={progress.active} color={palette.azure} />
              <MiniStat label="Total" value={progress.total} color={palette.muted} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-title"><span>Agent timeline</span></div>
            <div className="space-y-4">
              {AGENT_GROUPS.map(([group, agents]) => (
                <div key={group}>
                  <div className="section-label mb-2">{group}</div>
                  <div className="space-y-1.5">
                    {agents.map((agent) => (
                      <div key={agent} className="agent-row" data-status={agentStatus[agent] ?? "pending"}>
                        <span>{agent}</span>
                        <StatusBadge status={agentStatus[agent] ?? "pending"} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {Object.values(sections).length > 0 && (
        <div className="grid gap-5 md:grid-cols-2">
          {Object.values(sections).map((section) => (
            <div key={section.section} className="panel">
              <div className="panel-title"><span>{section.title}</span></div>
              <MarkdownBlock content={section.content} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

function Reports() {
  const { activeReportId, setActiveReportId } = useUIStore();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string | null>(null);
  const reports = useQuery({ queryKey: ["reports", query], queryFn: () => api.reports(query), refetchInterval: 10000 });
  const report = useQuery({ queryKey: ["report", activeReportId], queryFn: () => api.report(activeReportId!), enabled: !!activeReportId });
  const sections = report.data?.sections ?? [];
  const activeSection = sections.find((section) => section.section === (tab ?? sections[0]?.section));

  useEffect(() => {
    if (!activeReportId && reports.data?.[0]) setActiveReportId(reports.data[0].id);
  }, [activeReportId, reports.data, setActiveReportId]);

  useEffect(() => {
    setTab(null);
  }, [activeReportId]);

  return (
    <div className="grid gap-5 xl:grid-cols-[330px_1fr]">
      <div className="panel space-y-4">
        <label className="field">
          <span>Search history</span>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-3 text-fg-faint" />
            <input className="input pl-9" placeholder="Ticker…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        </label>
        <div className="space-y-2">
          {(reports.data ?? []).length === 0 && <div className="empty-state">No reports found</div>}
          {(reports.data ?? []).map((item) => (
            <button
              key={item.id}
              className={`report-row ${activeReportId === item.id ? "report-row-active" : ""}`}
              onClick={() => setActiveReportId(item.id)}
            >
              <span className="font-mono font-semibold text-fg">{item.ticker}</span>
              <RatingPill rating={item.summary?.rating} />
              <span className="font-mono text-xs text-fg-faint">{item.analysis_date}</span>
              <StatusBadge status={item.status} />
            </button>
          ))}
        </div>
      </div>

      <div className="panel min-h-[680px]">
        {report.data ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-4">
                <div className="grid h-12 w-12 place-items-center rounded-xl border border-line/60 bg-ink-900/60 font-display text-lg font-semibold text-brass">
                  {report.data.ticker.slice(0, 4)}
                </div>
                <div>
                  <div className="font-display text-xl font-semibold tracking-tight">{report.data.ticker}</div>
                  <div className="font-mono text-xs text-fg-muted">{report.data.analysis_date}</div>
                </div>
                <RatingPill rating={report.data.summary?.rating} />
              </div>
              <div className="flex gap-2">
                <a className="btn" href={`${API_BASE}/reports/${report.data.id}/export?format=markdown`}>
                  <Download size={15} /> Markdown
                </a>
                <a className="btn" href={`${API_BASE}/reports/${report.data.id}/export?format=json`}>
                  <Download size={15} /> JSON
                </a>
              </div>
            </div>
            <div className="tabs">
              {sections.map((section) => (
                <button
                  key={section.section}
                  className={`tab ${activeSection?.section === section.section ? "tab-active" : ""}`}
                  onClick={() => setTab(section.section)}
                >
                  {section.title}
                </button>
              ))}
            </div>
            {activeSection && <MarkdownBlock content={activeSection.content} />}
          </div>
        ) : (
          <div className="empty-state">Select a report to read</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function SettingsView() {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const saveKey = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) => api.saveApiKey(provider, apiKey),
    onSuccess: (_, variables) => {
      setKeys((current) => ({ ...current, [variables.provider]: "" }));
      queryClient.invalidateQueries({ queryKey: ["config"] });
    }
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Configuration</div>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Providers &amp; keys</h1>
        </div>
        <button className="btn" onClick={() => config.refetch()}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {(config.data?.providers ?? []).map((provider: ProviderConfig) => (
          <div key={provider.id} className="provider-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display font-semibold text-fg">{provider.label}</div>
                <div className="font-mono text-xs text-fg-faint">{provider.api_key_env ?? "keyless"}</div>
              </div>
              <StatusBadge
                status={provider.api_key_available === false && provider.requires_api_key ? "error" : "completed"}
                label={provider.api_key_available === false && provider.requires_api_key ? "missing" : "ready"}
              />
            </div>
            {provider.api_key_env ? (
              <form
                className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = keys[provider.id]?.trim();
                  if (value) saveKey.mutate({ provider: provider.id, apiKey: value });
                }}
              >
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder={`Enter ${provider.api_key_env}`}
                  value={keys[provider.id] ?? ""}
                  onChange={(event) => setKeys((current) => ({ ...current, [provider.id]: event.target.value }))}
                />
                <button className="btn-primary" disabled={saveKey.isPending || !(keys[provider.id] ?? "").trim()}>
                  <KeyRound size={15} /> Save
                </button>
              </form>
            ) : (
              <div className="mt-3 text-sm text-fg-muted">This provider does not need a single key.</div>
            )}
          </div>
        ))}
      </div>
      {saveKey.error && <div className="error-box">{String(saveKey.error.message)}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Terminal                                                            */
/* ------------------------------------------------------------------ */

function TerminalView() {
  const terminalElement = useRef<HTMLDivElement | null>(null);
  const terminal = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const commands = useQuery({ queryKey: ["terminal-commands"], queryFn: api.terminalCommands });
  const run = useMutation({
    mutationFn: api.runTerminalCommand,
    onSuccess: (result) => {
      writeTerminal(result.output);
      if (result.error) writeTerminal(result.error);
      writeTerminal(`exit ${result.exit_code}`);
    },
    onError: (error) => writeTerminal(String(error))
  });

  useEffect(() => {
    if (!terminalElement.current || terminal.current) return;
    terminal.current = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      theme: { background: "#0A0E1A", foreground: "#c2cce0", cursor: "#F5B642" }
    });
    fit.current = new FitAddon();
    terminal.current.loadAddon(fit.current);
    terminal.current.open(terminalElement.current);
    fit.current.fit();
    terminal.current.writeln("TradingAgents PowerShell profile");
    terminal.current.writeln("Root: D:\\Personale\\TradingAgents");
    const observer = new ResizeObserver(() => fit.current?.fit());
    observer.observe(terminalElement.current);
    return () => {
      observer.disconnect();
      terminal.current?.dispose();
      terminal.current = null;
      fit.current = null;
    };
  }, []);

  function writeTerminal(text: string) {
    const term = terminal.current;
    if (!term) return;
    for (const line of text.split(/\r?\n/)) term.writeln(line);
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="eyebrow">Sandbox</div>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">PowerShell terminal</h1>
      </div>
      <div className="panel">
        <div className="section-label mb-3">Whitelisted commands</div>
        <div className="flex flex-wrap gap-2">
          {(commands.data?.commands ?? []).map((command) => (
            <button
              key={command}
              className="btn"
              disabled={run.isPending}
              onClick={() => {
                writeTerminal(`PS> ${command}`);
                run.mutate(command);
              }}
            >
              <Play size={14} /> {command}
            </button>
          ))}
        </div>
      </div>
      <div ref={terminalElement} className="terminal-shell" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared building blocks                                              */
/* ------------------------------------------------------------------ */

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  spark,
  live
}: {
  label: string;
  value: number | string;
  icon: typeof Activity;
  color: string;
  spark?: number[];
  live?: boolean;
}) {
  return (
    <div className="kpi animate-fade-up">
      <div className="flex items-start justify-between">
        <div>
          <div className="kpi-value">{value}</div>
          <div className="kpi-label">{label}</div>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `${color}1A`, color }}>
          <Icon size={18} />
        </span>
      </div>
      <div className="mt-3 h-9">
        {spark && spark.some((value) => value > 0) ? (
          <Sparkline data={spark} color={color} />
        ) : live ? (
          <div className="flex h-full items-center gap-2 text-xs text-fg-faint">
            <span className="h-2 w-2 animate-pulse-dot rounded-full" style={{ background: color }} /> in progress
          </div>
        ) : (
          <div className="flex h-full items-center text-xs text-fg-faint">—</div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-line/50 bg-ink-800/50 py-2">
      <div className="font-mono text-lg font-semibold tabular-nums" style={{ color }}>{value}</div>
      <div className="eyebrow">{label}</div>
    </div>
  );
}

function Pipeline({ agentStatus }: { agentStatus: Record<string, string> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {PIPELINE.map((stage, index) => {
        const status = stageStatus(stage.members, agentStatus);
        const Icon = stage.icon;
        const done = stage.members.filter((member) => agentStatus[member] === "completed").length;
        const tone =
          status === "completed"
            ? "border-bull/40 bg-bull/[0.07] text-bull"
            : status === "in_progress"
              ? "border-azure/45 bg-azure/[0.08] text-azure ring-1 ring-azure/20"
              : "border-line/60 bg-ink-800/40 text-fg-faint";
        return (
          <div key={stage.key} className={`relative rounded-xl border p-3 transition ${tone}`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-fg-faint">0{index + 1}</span>
              {status === "in_progress" && <span className="h-2 w-2 animate-pulse-dot rounded-full bg-azure" />}
              {status === "completed" && <CheckCircle2 size={14} />}
            </div>
            <Icon size={20} className="mt-2" />
            <div className="mt-2 text-sm font-semibold text-fg">{stage.label}</div>
            <div className="font-mono text-[11px] text-fg-faint">
              {done}/{stage.members.length} done
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TickerTape({ analyses, onPick }: { analyses: Analysis[]; onPick: (id: string) => void }) {
  const items = analyses.slice(0, 14);
  if (!items.length) {
    return <div className="font-mono text-xs text-fg-faint">No analyses yet — start one to populate the tape.</div>;
  }
  const loop = [...items, ...items];
  return (
    <div className="group relative overflow-hidden">
      <div className="flex w-max gap-6 animate-marquee group-hover:[animation-play-state:paused]">
        {loop.map((item, index) => {
          const weight = RATING_WEIGHT[normalizeRatingLabel(item.summary?.rating) ?? ""] ?? null;
          const mark = weight === null ? "·" : weight > 0 ? "▲" : weight < 0 ? "▼" : "◆";
          const color =
            weight === null ? palette.faint : weight > 0 ? palette.bull : weight < 0 ? palette.bear : palette.brass;
          return (
            <button
              key={`${item.id}-${index}`}
              className="flex shrink-0 items-center gap-2 font-mono text-xs transition hover:opacity-100"
              onClick={() => onPick(item.id)}
              title={`${item.ticker} · ${item.status}`}
            >
              <span className="font-semibold text-fg">{item.ticker}</span>
              <span style={{ color }}>{mark}</span>
              <span style={{ color }}>{normalizeRatingLabel(item.summary?.rating) ?? item.status}</span>
              <span className="text-fg-faint">·</span>
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-ink-900 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-ink-900 to-transparent" />
    </div>
  );
}

function AnalysisTable({ analyses, onSelect }: { analyses: Analysis[]; onSelect?: (id: string) => void }) {
  if (!analyses.length) {
    return <div className="empty-state">No analyses yet</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Market</th>
            <th>Date</th>
            <th>Status</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          {analyses.map((analysis) => (
            <tr key={analysis.id} onClick={() => onSelect?.(analysis.id)} className={onSelect ? "cursor-pointer" : ""}>
              <td className="font-mono font-semibold text-fg">{analysis.ticker}</td>
              <td><span className="chip">{analysis.asset_type}</span></td>
              <td className="font-mono text-xs">{analysis.analysis_date}</td>
              <td><StatusBadge status={analysis.status} /></td>
              <td><RatingPill rating={analysis.summary?.rating} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`status-badge status-${status}`}>{label ?? status}</span>;
}

function RatingPill({ rating }: { rating?: string | null }) {
  const label = normalizeRatingLabel(rating);
  return <span className={ratingClass(label)}>{label ?? "n/a"}</span>;
}

function MarkdownBlock({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div className={`markdown ${compact ? "markdown-compact" : ""}`}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRatingLabel(rating?: string | null): string | null {
  if (!rating) return null;
  return RATING_ORDER.find((item) => item.toLowerCase() === rating.toLowerCase()) ?? null;
}

function stageStatus(members: string[], agentStatus: Record<string, string>): string {
  const states = members.map((member) => agentStatus[member] ?? "pending");
  if (states.length && states.every((state) => state === "completed")) return "completed";
  if (states.some((state) => state === "in_progress" || state === "running" || state === "completed")) return "in_progress";
  return "pending";
}

function logTone(type: string): string {
  if (type === "error") return "font-semibold text-bear";
  if (type === "tool") return "font-semibold text-bull";
  if (type === "status") return "font-semibold text-brass";
  return "font-semibold text-azure";
}

function latestPayload(events: AnalysisEvent[], type: string) {
  return [...events].reverse().find((event) => event.type === type)?.payload;
}

function reportSectionsFromEvents(events: AnalysisEvent[]): Record<string, ReportSection> {
  return events
    .filter((event) => event.type === "report_section")
    .reduce<Record<string, ReportSection>>((acc, event) => {
      const section = event.payload.section;
      if (section) {
        acc[section] = {
          section,
          title: event.payload.title ?? section,
          content: event.payload.content ?? "",
          updated_at: event.created_at
        };
      }
      return acc;
    }, {});
}
