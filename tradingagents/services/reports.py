"""Report assembly helpers shared by service and API layers."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from tradingagents.agents.utils.rating import parse_rating

SECTION_TITLES: dict[str, str] = {
    "market_report": "Market Analysis",
    "sentiment_report": "Social Sentiment",
    "news_report": "News Analysis",
    "fundamentals_report": "Fundamentals Analysis",
    "investment_plan": "Research Team Decision",
    "trader_investment_plan": "Trading Team Plan",
    "final_trade_decision": "Portfolio Management Decision",
}


def json_default(value: Any) -> str:
    return str(value)


def to_json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=json_default)


def extract_report_sections(final_state: dict[str, Any]) -> dict[str, str]:
    sections: dict[str, str] = {}
    for key in ("market_report", "sentiment_report", "news_report", "fundamentals_report"):
        value = final_state.get(key)
        if value:
            sections[key] = str(value)

    debate = final_state.get("investment_debate_state") or {}
    research_parts = []
    if debate.get("bull_history"):
        research_parts.append(f"### Bull Researcher\n{debate['bull_history']}")
    if debate.get("bear_history"):
        research_parts.append(f"### Bear Researcher\n{debate['bear_history']}")
    if debate.get("judge_decision"):
        research_parts.append(f"### Research Manager\n{debate['judge_decision']}")
    if research_parts:
        sections["investment_plan"] = "\n\n".join(research_parts)
    elif final_state.get("investment_plan"):
        sections["investment_plan"] = str(final_state["investment_plan"])

    if final_state.get("trader_investment_plan"):
        sections["trader_investment_plan"] = str(final_state["trader_investment_plan"])

    risk = final_state.get("risk_debate_state") or {}
    risk_parts = []
    if risk.get("aggressive_history"):
        risk_parts.append(f"### Aggressive Analyst\n{risk['aggressive_history']}")
    if risk.get("conservative_history"):
        risk_parts.append(f"### Conservative Analyst\n{risk['conservative_history']}")
    if risk.get("neutral_history"):
        risk_parts.append(f"### Neutral Analyst\n{risk['neutral_history']}")
    if risk.get("judge_decision"):
        risk_parts.append(f"### Portfolio Manager\n{risk['judge_decision']}")
    if risk_parts:
        sections["final_trade_decision"] = "\n\n".join(risk_parts)
    elif final_state.get("final_trade_decision"):
        sections["final_trade_decision"] = str(final_state["final_trade_decision"])

    return sections


def build_complete_report(
    final_state: dict[str, Any],
    ticker: str,
    generated_at: dt.datetime | None = None,
) -> str:
    generated_at = generated_at or dt.datetime.now()
    parts = [
        f"# Trading Analysis Report: {ticker}",
        f"Generated: {generated_at.strftime('%Y-%m-%d %H:%M:%S')}",
    ]
    for section, content in extract_report_sections(final_state).items():
        title = SECTION_TITLES.get(section, section.replace("_", " ").title())
        parts.append(f"## {title}\n\n{content}")
    return "\n\n".join(parts).strip() + "\n"


def summarize_decision(final_state: dict[str, Any]) -> dict[str, str | None]:
    decision = (
        (final_state.get("risk_debate_state") or {}).get("judge_decision")
        or final_state.get("final_trade_decision")
        or ""
    )
    return {
        "rating": parse_rating(str(decision)) if decision else None,
        "decision": str(decision) if decision else None,
    }


def write_report_bundle(final_state: dict[str, Any], ticker: str, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "complete_report.md"
    report_path.write_text(build_complete_report(final_state, ticker), encoding="utf-8")

    sections_dir = output_dir / "sections"
    for section, content in extract_report_sections(final_state).items():
        sections_dir.mkdir(exist_ok=True)
        (sections_dir / f"{section}.md").write_text(content, encoding="utf-8")

    (output_dir / "final_state.json").write_text(
        json.dumps(final_state, indent=2, ensure_ascii=False, default=json_default),
        encoding="utf-8",
    )
    return report_path
