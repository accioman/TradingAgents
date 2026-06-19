"""Reusable analysis runner detached from the interactive CLI."""

from __future__ import annotations

import datetime as dt
import time
import traceback
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from cli.stats_handler import StatsCallbackHandler
from tradingagents.dataflows.symbol_utils import normalize_symbol
from tradingagents.graph.analyst_execution import (
    AnalystWallTimeTracker,
    build_analyst_execution_plan,
    get_initial_analyst_node,
    sync_analyst_tracker_from_chunk,
)
from tradingagents.graph.checkpointer import clear_checkpoint, get_checkpointer, thread_id
from tradingagents.graph.trading_graph import TradingAgentsGraph

from .config_catalog import build_runtime_config
from .reports import (
    SECTION_TITLES,
    build_complete_report,
    extract_report_sections,
    summarize_decision,
    write_report_bundle,
)

ANALYST_ORDER = ["market", "social", "news", "fundamentals"]
ANALYST_AGENT_NAMES = {
    "market": "Market Analyst",
    "social": "Sentiment Analyst",
    "news": "News Analyst",
    "fundamentals": "Fundamentals Analyst",
}
ANALYST_REPORT_MAP = {
    "market": "market_report",
    "social": "sentiment_report",
    "news": "news_report",
    "fundamentals": "fundamentals_report",
}
CRYPTO_SUFFIXES = ("-USD", "-USDT", "-USDC", "-BTC", "-ETH")


@dataclass(slots=True)
class AnalysisConfig:
    ticker: str
    analysis_date: str | None = None
    asset_type: str | None = None
    analysts: list[str] = field(default_factory=lambda: ANALYST_ORDER.copy())
    research_depth: int = 1
    llm_provider: str | None = None
    quick_think_llm: str | None = None
    deep_think_llm: str | None = None
    backend_url: str | None = None
    output_language: str | None = None
    checkpoint_enabled: bool | None = None
    google_thinking_level: str | None = None
    openai_reasoning_effort: str | None = None
    anthropic_effort: str | None = None
    analyst_concurrency_limit: int | None = None
    demo: bool = False

    @classmethod
    def from_mapping(cls, data: dict[str, Any]) -> AnalysisConfig:
        known = {field.name for field in cls.__dataclass_fields__.values()}
        return cls(**{key: value for key, value in data.items() if key in known})


@dataclass(slots=True)
class AnalysisEvent:
    type: str
    message: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(
        default_factory=lambda: dt.datetime.now(dt.timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class AnalysisResult:
    final_state: dict[str, Any]
    report_markdown: str
    sections: dict[str, str]
    stats: dict[str, Any]
    summary: dict[str, str | None]
    result_dir: str | None = None


EventSink = Callable[[AnalysisEvent], None]


class ProgressState:
    FIXED_AGENTS = {
        "Research Team": ["Bull Researcher", "Bear Researcher", "Research Manager"],
        "Trading Team": ["Trader"],
        "Risk Management": [
            "Aggressive Analyst",
            "Neutral Analyst",
            "Conservative Analyst",
        ],
        "Portfolio Management": ["Portfolio Manager"],
    }
    REPORT_SECTIONS = {
        "market_report": ("market", "Market Analyst"),
        "sentiment_report": ("social", "Sentiment Analyst"),
        "news_report": ("news", "News Analyst"),
        "fundamentals_report": ("fundamentals", "Fundamentals Analyst"),
        "investment_plan": (None, "Research Manager"),
        "trader_investment_plan": (None, "Trader"),
        "final_trade_decision": (None, "Portfolio Manager"),
    }

    def __init__(self, emit: EventSink) -> None:
        self.emit = emit
        self.messages: list[tuple[str, str, str]] = []
        self.tool_calls: list[tuple[str, str, dict[str, Any]]] = []
        self.selected_analysts: list[str] = []
        self.agent_status: dict[str, str] = {}
        self.report_sections: dict[str, str | None] = {}
        self.current_report: str | None = None
        self.final_report: str | None = None
        self._processed_message_ids: set[str] = set()

    def init_for_analysis(self, selected_analysts: list[str]) -> None:
        self.selected_analysts = [item.lower() for item in selected_analysts]
        self.agent_status = {}
        for analyst in self.selected_analysts:
            name = ANALYST_AGENT_NAMES.get(analyst)
            if name:
                self.agent_status[name] = "pending"
        for team_agents in self.FIXED_AGENTS.values():
            for agent in team_agents:
                self.agent_status[agent] = "pending"
        self.report_sections = {}
        for section, (analyst_key, _) in self.REPORT_SECTIONS.items():
            if analyst_key is None or analyst_key in self.selected_analysts:
                self.report_sections[section] = None
        self.emit_snapshot()

    def emit_snapshot(self) -> None:
        self.emit(
            AnalysisEvent(
                "progress",
                payload={
                    "agent_status": self.agent_status,
                    "report_sections": {
                        key: bool(value) for key, value in self.report_sections.items()
                    },
                },
            )
        )

    def add_message(self, message_type: str, content: str) -> None:
        timestamp = dt.datetime.now().strftime("%H:%M:%S")
        self.messages.append((timestamp, message_type, content))
        self.emit(
            AnalysisEvent(
                "log",
                message=content,
                payload={"time": timestamp, "message_type": message_type},
            )
        )

    def add_tool_call(self, tool_name: str, args: dict[str, Any]) -> None:
        timestamp = dt.datetime.now().strftime("%H:%M:%S")
        self.tool_calls.append((timestamp, tool_name, args))
        self.emit(
            AnalysisEvent(
                "tool",
                message=tool_name,
                payload={"time": timestamp, "tool_name": tool_name, "args": args},
            )
        )

    def update_agent_status(self, agent: str, status: str) -> None:
        if agent in self.agent_status and self.agent_status[agent] != status:
            self.agent_status[agent] = status
            self.emit(
                AnalysisEvent(
                    "agent_status",
                    message=f"{agent}: {status}",
                    payload={"agent": agent, "status": status, "agent_status": self.agent_status},
                )
            )

    def update_report_section(self, section_name: str, content: Any) -> None:
        if section_name not in self.report_sections or content is None:
            return
        text = "\n".join(str(item) for item in content) if isinstance(content, list) else str(content)
        if not text.strip() or self.report_sections.get(section_name) == text:
            return
        self.report_sections[section_name] = text
        self._update_current_report()
        self.emit(
            AnalysisEvent(
                "report_section",
                message=SECTION_TITLES.get(section_name, section_name),
                payload={
                    "section": section_name,
                    "title": SECTION_TITLES.get(section_name, section_name),
                    "content": text,
                },
            )
        )

    def _update_current_report(self) -> None:
        latest_section = None
        latest_content = None
        for section, content in self.report_sections.items():
            if content:
                latest_section = section
                latest_content = content
        if latest_section and latest_content:
            title = SECTION_TITLES.get(latest_section, latest_section)
            self.current_report = f"### {title}\n{latest_content}"
        parts = []
        for section, content in self.report_sections.items():
            if content:
                parts.append(f"## {SECTION_TITLES.get(section, section)}\n\n{content}")
        self.final_report = "\n\n".join(parts) if parts else None


def normalize_ticker(ticker: str) -> str:
    return normalize_symbol(ticker.strip()) if ticker and ticker.strip() else "SPY"


def detect_asset_type(ticker: str) -> str:
    canonical = normalize_ticker(ticker)
    return "crypto" if canonical.endswith(CRYPTO_SUFFIXES) else "stock"


def normalize_analysis_config(raw_config: AnalysisConfig | dict[str, Any]) -> AnalysisConfig:
    config = (
        raw_config
        if isinstance(raw_config, AnalysisConfig)
        else AnalysisConfig.from_mapping(raw_config)
    )
    config.ticker = normalize_ticker(config.ticker)
    config.analysis_date = config.analysis_date or dt.date.today().strftime("%Y-%m-%d")
    _validate_analysis_date(config.analysis_date)
    config.asset_type = (config.asset_type or detect_asset_type(config.ticker)).lower()
    if config.asset_type not in {"stock", "crypto"}:
        raise ValueError("asset_type must be 'stock' or 'crypto'")
    selected = [item.lower() for item in (config.analysts or ANALYST_ORDER)]
    selected = [item for item in ANALYST_ORDER if item in selected]
    if config.asset_type == "crypto":
        selected = [item for item in selected if item != "fundamentals"]
    config.analysts = selected or ["market"]
    config.research_depth = max(1, int(config.research_depth or 1))
    return config


def run_analysis(
    raw_config: AnalysisConfig | dict[str, Any],
    event_sink: EventSink | None = None,
) -> AnalysisResult:
    """Run an analysis and emit machine-readable progress events.

    This is the service-layer entry point used by the FastAPI job manager. It
    accepts a non-interactive config object and returns the final report bundle.
    """
    config = normalize_analysis_config(raw_config)
    emitted: list[AnalysisEvent] = []

    def emit(event: AnalysisEvent) -> None:
        emitted.append(event)
        if event_sink:
            event_sink(event)

    if config.demo:
        return _run_demo_analysis(config, emit)

    start_time = time.time()
    emit(
        AnalysisEvent(
            "status",
            "Analysis starting",
            {"status": "running", "ticker": config.ticker, "analysis_date": config.analysis_date},
        )
    )

    runtime_config = build_runtime_config(asdict(config))
    stats_handler = StatsCallbackHandler()
    selected_analysts = config.analysts
    analyst_execution_plan = build_analyst_execution_plan(
        selected_analysts,
        concurrency_limit=runtime_config["analyst_concurrency_limit"],
    )
    wall_time_tracker = AnalystWallTimeTracker(analyst_execution_plan)
    progress = ProgressState(emit)
    progress.init_for_analysis(selected_analysts)

    graph = TradingAgentsGraph(
        selected_analysts,
        config=runtime_config,
        debug=True,
        callbacks=[stats_handler],
    )
    graph.ticker = config.ticker
    graph._resolve_pending_entries(config.ticker)

    result_dir = (
        Path(runtime_config["results_dir"])
        / config.ticker
        / str(config.analysis_date)
        / "service_run"
    )
    result_dir.mkdir(parents=True, exist_ok=True)

    checkpoint_ctx = None
    try:
        if runtime_config.get("checkpoint_enabled"):
            checkpoint_ctx = get_checkpointer(runtime_config["data_cache_dir"], config.ticker)
            saver = checkpoint_ctx.__enter__()
            graph.graph = graph.workflow.compile(checkpointer=saver)

        progress.add_message("System", f"Selected ticker: {config.ticker}")
        progress.add_message("System", f"Detected asset type: {config.asset_type}")
        progress.add_message("System", f"Analysis date: {config.analysis_date}")
        progress.add_message("System", f"Selected analysts: {', '.join(selected_analysts)}")

        first_analyst = get_initial_analyst_node(analyst_execution_plan)
        progress.update_agent_status(first_analyst, "in_progress")
        wall_time_tracker.mark_started(selected_analysts[0])

        instrument_context = graph.resolve_instrument_context(
            config.ticker,
            config.asset_type or "stock",
        )
        past_context = graph.memory_log.get_past_context(config.ticker)
        init_agent_state = graph.propagator.create_initial_state(
            config.ticker,
            str(config.analysis_date),
            asset_type=config.asset_type or "stock",
            past_context=past_context,
            instrument_context=instrument_context,
        )
        args = graph.propagator.get_graph_args(callbacks=[stats_handler])
        if runtime_config.get("checkpoint_enabled"):
            args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = thread_id(
                config.ticker,
                str(config.analysis_date),
            )

        trace: list[dict[str, Any]] = []
        for chunk in graph.graph.stream(init_agent_state, **args):
            _handle_stream_chunk(progress, chunk, wall_time_tracker)
            trace.append(chunk)
            emit(
                AnalysisEvent(
                    "stats",
                    payload={
                        "stats": stats_handler.get_stats(),
                        "elapsed_seconds": round(time.time() - start_time, 2),
                    },
                )
            )

        final_state: dict[str, Any] = {}
        for chunk in trace:
            final_state.update(chunk)
        final_state = _complete_final_state(final_state)

        for agent in list(progress.agent_status):
            progress.update_agent_status(agent, "completed")
        for section, content in extract_report_sections(final_state).items():
            progress.update_report_section(section, content)

        if final_state.get("final_trade_decision"):
            graph._log_state(str(config.analysis_date), final_state)
            graph.memory_log.store_decision(
                ticker=config.ticker,
                trade_date=str(config.analysis_date),
                final_trade_decision=final_state["final_trade_decision"],
            )

        if runtime_config.get("checkpoint_enabled"):
            clear_checkpoint(runtime_config["data_cache_dir"], config.ticker, str(config.analysis_date))

        report_path = write_report_bundle(final_state, config.ticker, result_dir)
        stats = stats_handler.get_stats()
        stats["elapsed_seconds"] = round(time.time() - start_time, 2)
        result = AnalysisResult(
            final_state=final_state,
            report_markdown=report_path.read_text(encoding="utf-8"),
            sections=extract_report_sections(final_state),
            stats=stats,
            summary=summarize_decision(final_state),
            result_dir=str(result_dir),
        )
        emit(
            AnalysisEvent(
                "completed",
                "Analysis completed",
                {
                    "status": "completed",
                    "stats": stats,
                    "summary": result.summary,
                    "result_dir": result.result_dir,
                },
            )
        )
        return result
    except Exception as exc:
        emit(
            AnalysisEvent(
                "error",
                str(exc),
                {"status": "error", "traceback": traceback.format_exc()},
            )
        )
        raise
    finally:
        if checkpoint_ctx is not None:
            checkpoint_ctx.__exit__(None, None, None)
            graph.graph = graph.workflow.compile()


def _handle_stream_chunk(
    progress: ProgressState,
    chunk: dict[str, Any],
    wall_time_tracker: AnalystWallTimeTracker,
) -> None:
    for message in chunk.get("messages", []):
        msg_id = getattr(message, "id", None)
        if msg_id is not None:
            if msg_id in progress._processed_message_ids:
                continue
            progress._processed_message_ids.add(msg_id)

        msg_type, content = classify_message_type(message)
        if content and content.strip():
            progress.add_message(msg_type, content)

        for tool_call in getattr(message, "tool_calls", []) or []:
            if isinstance(tool_call, dict):
                progress.add_tool_call(tool_call.get("name", "tool"), tool_call.get("args", {}))
            else:
                progress.add_tool_call(tool_call.name, tool_call.args)

    update_analyst_statuses(progress, chunk, wall_time_tracker)

    debate_state = chunk.get("investment_debate_state")
    if debate_state:
        bull_hist = (debate_state.get("bull_history") or "").strip()
        bear_hist = (debate_state.get("bear_history") or "").strip()
        judge = (debate_state.get("judge_decision") or "").strip()
        if bull_hist or bear_hist:
            update_research_team_status(progress, "in_progress")
        if bull_hist:
            progress.update_report_section("investment_plan", f"### Bull Researcher Analysis\n{bull_hist}")
        if bear_hist:
            progress.update_report_section("investment_plan", f"### Bear Researcher Analysis\n{bear_hist}")
        if judge:
            progress.update_report_section("investment_plan", f"### Research Manager Decision\n{judge}")
            update_research_team_status(progress, "completed")
            progress.update_agent_status("Trader", "in_progress")

    if chunk.get("trader_investment_plan"):
        progress.update_report_section("trader_investment_plan", chunk["trader_investment_plan"])
        progress.update_agent_status("Trader", "completed")
        progress.update_agent_status("Aggressive Analyst", "in_progress")

    risk_state = chunk.get("risk_debate_state")
    if risk_state:
        agg_hist = (risk_state.get("aggressive_history") or "").strip()
        con_hist = (risk_state.get("conservative_history") or "").strip()
        neu_hist = (risk_state.get("neutral_history") or "").strip()
        judge = (risk_state.get("judge_decision") or "").strip()
        if agg_hist:
            progress.update_agent_status("Aggressive Analyst", "in_progress")
            progress.update_report_section(
                "final_trade_decision",
                f"### Aggressive Analyst Analysis\n{agg_hist}",
            )
        if con_hist:
            progress.update_agent_status("Conservative Analyst", "in_progress")
            progress.update_report_section(
                "final_trade_decision",
                f"### Conservative Analyst Analysis\n{con_hist}",
            )
        if neu_hist:
            progress.update_agent_status("Neutral Analyst", "in_progress")
            progress.update_report_section(
                "final_trade_decision",
                f"### Neutral Analyst Analysis\n{neu_hist}",
            )
        if judge:
            progress.update_agent_status("Portfolio Manager", "in_progress")
            progress.update_report_section(
                "final_trade_decision",
                f"### Portfolio Manager Decision\n{judge}",
            )
            progress.update_agent_status("Aggressive Analyst", "completed")
            progress.update_agent_status("Conservative Analyst", "completed")
            progress.update_agent_status("Neutral Analyst", "completed")
            progress.update_agent_status("Portfolio Manager", "completed")


def update_analyst_statuses(
    progress: ProgressState,
    chunk: dict[str, Any],
    wall_time_tracker: AnalystWallTimeTracker | None = None,
) -> None:
    selected = progress.selected_analysts
    found_active = False
    if wall_time_tracker is not None:
        sync_analyst_tracker_from_chunk(wall_time_tracker, chunk)
    for analyst_key in ANALYST_ORDER:
        if analyst_key not in selected:
            continue
        agent_name = ANALYST_AGENT_NAMES[analyst_key]
        report_key = ANALYST_REPORT_MAP[analyst_key]
        if chunk.get(report_key):
            progress.update_report_section(report_key, chunk[report_key])
        has_report = bool(progress.report_sections.get(report_key))
        if has_report:
            progress.update_agent_status(agent_name, "completed")
        elif not found_active:
            progress.update_agent_status(agent_name, "in_progress")
            found_active = True
        else:
            progress.update_agent_status(agent_name, "pending")
    if (
        not found_active
        and selected
        and progress.agent_status.get("Bull Researcher") == "pending"
    ):
        progress.update_agent_status("Bull Researcher", "in_progress")


def update_research_team_status(progress: ProgressState, status: str) -> None:
    for agent in ("Bull Researcher", "Bear Researcher", "Research Manager"):
        progress.update_agent_status(agent, status)


def extract_content_string(content: Any) -> str | None:
    import ast

    def is_empty(value: Any) -> bool:
        if value is None or value == "":
            return True
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return True
            try:
                return not bool(ast.literal_eval(stripped))
            except (ValueError, SyntaxError):
                return False
        return not bool(value)

    if is_empty(content):
        return None
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, dict):
        text = content.get("text", "")
        return text.strip() if not is_empty(text) else None
    if isinstance(content, list):
        parts = [
            item.get("text", "").strip()
            if isinstance(item, dict) and item.get("type") == "text"
            else (item.strip() if isinstance(item, str) else "")
            for item in content
        ]
        result = " ".join(item for item in parts if item and not is_empty(item))
        return result or None
    return str(content).strip() if not is_empty(content) else None


def classify_message_type(message: Any) -> tuple[str, str | None]:
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

    content = extract_content_string(getattr(message, "content", None))
    if isinstance(message, HumanMessage):
        if content and content.strip() == "Continue":
            return ("Control", content)
        return ("User", content)
    if isinstance(message, ToolMessage):
        return ("Data", content)
    if isinstance(message, AIMessage):
        return ("Agent", content)
    return ("System", content)


def _complete_final_state(final_state: dict[str, Any]) -> dict[str, Any]:
    final_state.setdefault("investment_debate_state", {})
    final_state.setdefault("risk_debate_state", {})
    for key in (
        "company_of_interest",
        "trade_date",
        "market_report",
        "sentiment_report",
        "news_report",
        "fundamentals_report",
        "investment_plan",
        "trader_investment_plan",
        "final_trade_decision",
    ):
        final_state.setdefault(key, "")
    for key in ("bull_history", "bear_history", "history", "current_response", "judge_decision"):
        final_state["investment_debate_state"].setdefault(key, "")
    for key in (
        "aggressive_history",
        "conservative_history",
        "neutral_history",
        "history",
        "judge_decision",
    ):
        final_state["risk_debate_state"].setdefault(key, "")
    return final_state


def _validate_analysis_date(value: str) -> None:
    try:
        parsed = dt.datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("analysis_date must use YYYY-MM-DD") from exc
    if parsed > dt.date.today():
        raise ValueError("analysis_date cannot be in the future")


def _run_demo_analysis(config: AnalysisConfig, emit: EventSink) -> AnalysisResult:
    start = time.time()
    emit(AnalysisEvent("status", "Demo analysis starting", {"status": "running"}))
    progress = ProgressState(emit)
    progress.init_for_analysis(config.analysts)
    progress.add_message("System", f"Demo mode for {config.ticker}")
    for analyst in config.analysts:
        agent = ANALYST_AGENT_NAMES[analyst]
        progress.update_agent_status(agent, "in_progress")
        time.sleep(0.2)
        report_key = ANALYST_REPORT_MAP[analyst]
        progress.update_report_section(
            report_key,
            (
                f"Demo {SECTION_TITLES[report_key].lower()} for {config.ticker}. "
                "This mock content verifies streaming, persistence, and rendering."
            ),
        )
        progress.update_agent_status(agent, "completed")

    update_research_team_status(progress, "completed")
    progress.update_agent_status("Trader", "completed")
    progress.update_agent_status("Aggressive Analyst", "completed")
    progress.update_agent_status("Neutral Analyst", "completed")
    progress.update_agent_status("Conservative Analyst", "completed")
    progress.update_agent_status("Portfolio Manager", "completed")

    final_state = _complete_final_state(
        {
            "company_of_interest": config.ticker,
            "trade_date": config.analysis_date,
            "market_report": progress.report_sections.get("market_report") or "",
            "sentiment_report": progress.report_sections.get("sentiment_report") or "",
            "news_report": progress.report_sections.get("news_report") or "",
            "fundamentals_report": progress.report_sections.get("fundamentals_report") or "",
            "investment_debate_state": {
                "bull_history": "Demo bull case: momentum and liquidity remain constructive.",
                "bear_history": "Demo bear case: valuation and event risk require position sizing.",
                "judge_decision": "Rating: Hold. Demo research manager recommends waiting for confirmation.",
            },
            "trader_investment_plan": "Demo trading plan: maintain a watchlist entry and avoid leverage.",
            "risk_debate_state": {
                "aggressive_history": "Demo aggressive view: small tactical exposure is acceptable.",
                "conservative_history": "Demo conservative view: protect downside with strict stops.",
                "neutral_history": "Demo neutral view: risk/reward is balanced.",
                "judge_decision": "Rating: Hold. Demo portfolio decision is to monitor without adding exposure.",
            },
            "investment_plan": "Rating: Hold. Demo research manager recommends waiting for confirmation.",
            "final_trade_decision": "Rating: Hold. Demo portfolio decision is to monitor without adding exposure.",
        }
    )
    sections = extract_report_sections(final_state)
    for section, content in sections.items():
        progress.update_report_section(section, content)
    stats = {"llm_calls": 0, "tool_calls": 0, "tokens_in": 0, "tokens_out": 0}
    stats["elapsed_seconds"] = round(time.time() - start, 2)
    result = AnalysisResult(
        final_state=final_state,
        report_markdown=build_complete_report(final_state, config.ticker),
        sections=sections,
        stats=stats,
        summary=summarize_decision(final_state),
        result_dir=None,
    )
    emit(
        AnalysisEvent(
            "completed",
            "Demo analysis completed",
            {"status": "completed", "stats": stats, "summary": result.summary},
        )
    )
    return result
