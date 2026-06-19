"""Pydantic schemas for the FastAPI surface."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AnalysisCreate(BaseModel):
    ticker: str = Field(default="SPY", max_length=32)
    analysis_date: str | None = None
    asset_type: str | None = None
    analysts: list[str] = Field(default_factory=lambda: ["market", "social", "news", "fundamentals"])
    research_depth: int = Field(default=1, ge=1, le=5)
    llm_provider: str | None = None
    quick_think_llm: str | None = None
    deep_think_llm: str | None = None
    backend_url: str | None = None
    output_language: str | None = None
    checkpoint_enabled: bool | None = None
    google_thinking_level: str | None = None
    openai_reasoning_effort: str | None = None
    anthropic_effort: str | None = None
    analyst_concurrency_limit: int | None = Field(default=None, ge=1, le=4)
    demo: bool = False


class AnalysisCreated(BaseModel):
    id: str
    status: str


class APIKeyUpdate(BaseModel):
    provider: str
    api_key: str = Field(min_length=1)


class TerminalCommand(BaseModel):
    command: str


class TerminalResult(BaseModel):
    command: str
    exit_code: int
    output: str
    error: str | None = None


class APIMessage(BaseModel):
    detail: str
    extra: dict[str, Any] | None = None
