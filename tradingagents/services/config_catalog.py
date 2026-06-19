"""Public, secret-safe configuration metadata for UI and API clients."""

from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any

from dotenv import find_dotenv, set_key

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.llm_clients.api_key_env import get_api_key_env
from tradingagents.llm_clients.model_catalog import MODEL_OPTIONS

try:
    from tradingagents.llm_clients.openai_client import OPENAI_COMPATIBLE_PROVIDERS
except Exception:  # pragma: no cover - defensive fallback for partial installs
    OPENAI_COMPATIBLE_PROVIDERS = {}


PROVIDER_LABELS: dict[str, str] = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "google": "Google",
    "azure": "Azure OpenAI",
    "bedrock": "Amazon Bedrock",
    "xai": "xAI",
    "deepseek": "DeepSeek",
    "qwen": "Qwen",
    "qwen-cn": "Qwen China",
    "glm": "GLM",
    "glm-cn": "GLM China",
    "minimax": "MiniMax",
    "minimax-cn": "MiniMax China",
    "openrouter": "OpenRouter",
    "mistral": "Mistral",
    "kimi": "Kimi",
    "groq": "Groq",
    "nvidia": "NVIDIA NIM",
    "ollama": "Ollama",
    "openai_compatible": "OpenAI-compatible",
}

NATIVE_PROVIDER_DEFAULT_URLS: dict[str, str | None] = {
    "anthropic": "https://api.anthropic.com/",
    "google": None,
    "azure": None,
    "bedrock": None,
}

ANALYSTS: list[dict[str, str]] = [
    {"id": "market", "label": "Market Analyst"},
    {"id": "social", "label": "Sentiment Analyst"},
    {"id": "news", "label": "News Analyst"},
    {"id": "fundamentals", "label": "Fundamentals Analyst"},
]

ASSET_TYPES = ["stock", "crypto"]


def provider_default_url(provider: str) -> str | None:
    """Return the default backend URL for a provider without reading secrets."""
    key = provider.lower()
    spec = OPENAI_COMPATIBLE_PROVIDERS.get(key)
    if spec is not None:
        env_base_url = os.environ.get(spec.base_url_env) if spec.base_url_env else None
        return env_base_url or spec.base_url
    return NATIVE_PROVIDER_DEFAULT_URLS.get(key)


def provider_key_optional(provider: str) -> bool:
    spec = OPENAI_COMPATIBLE_PROVIDERS.get(provider.lower())
    return bool(spec and spec.key_optional)


def provider_requires_key(provider: str) -> bool:
    env_var = get_api_key_env(provider)
    return bool(env_var) and not provider_key_optional(provider)


def save_provider_api_key(provider: str, api_key: str) -> dict[str, Any]:
    """Persist an API key for a provider without returning the secret."""
    provider_key = provider.lower().strip()
    env_var = get_api_key_env(provider_key)
    if not env_var:
        raise ValueError(f"Provider '{provider}' does not use a single API key env var")

    key = api_key.strip()
    if not key:
        raise ValueError("api_key cannot be empty")

    env_path = find_dotenv(usecwd=True) or str(Path.cwd() / ".env")
    Path(env_path).touch(exist_ok=True)
    set_key(env_path, env_var, key)
    os.environ[env_var] = key

    return {
        "provider": provider_key,
        "api_key_env": env_var,
        "api_key_available": True,
    }


def build_runtime_config(overrides: dict[str, Any]) -> dict[str, Any]:
    """Merge request overrides into DEFAULT_CONFIG for a service-run analysis."""
    config = copy.deepcopy(DEFAULT_CONFIG)
    provider = str(overrides.get("llm_provider") or config["llm_provider"]).lower()

    config["llm_provider"] = provider
    config["deep_think_llm"] = overrides.get("deep_think_llm") or config["deep_think_llm"]
    config["quick_think_llm"] = overrides.get("quick_think_llm") or config["quick_think_llm"]
    config["backend_url"] = (
        overrides.get("backend_url")
        or config.get("backend_url")
        or provider_default_url(provider)
    )
    config["output_language"] = overrides.get("output_language") or config["output_language"]
    config["max_debate_rounds"] = int(
        overrides.get("research_depth") or config["max_debate_rounds"]
    )
    config["max_risk_discuss_rounds"] = int(
        overrides.get("research_depth") or config["max_risk_discuss_rounds"]
    )

    optional_keys = (
        "google_thinking_level",
        "openai_reasoning_effort",
        "anthropic_effort",
        "analyst_concurrency_limit",
        "checkpoint_enabled",
    )
    for key in optional_keys:
        if key in overrides and overrides[key] is not None:
            config[key] = overrides[key]

    return config


def get_public_config() -> dict[str, Any]:
    """Return frontend-safe configuration metadata.

    API key values are never included. The frontend receives only the env-var
    name and whether a non-empty value is present in the backend process.
    """
    providers = []
    for provider, mode_options in MODEL_OPTIONS.items():
        env_var = get_api_key_env(provider)
        providers.append(
            {
                "id": provider,
                "label": PROVIDER_LABELS.get(provider, provider),
                "default_url": provider_default_url(provider),
                "api_key_env": env_var,
                "api_key_available": bool(os.environ.get(env_var)) if env_var else None,
                "requires_api_key": provider_requires_key(provider),
                "key_optional": provider_key_optional(provider),
                "models": {
                    mode: [
                        {"label": label, "value": value}
                        for label, value in options
                    ]
                    for mode, options in mode_options.items()
                },
            }
        )

    return {
        "defaults": {
            "llm_provider": DEFAULT_CONFIG["llm_provider"],
            "quick_think_llm": DEFAULT_CONFIG["quick_think_llm"],
            "deep_think_llm": DEFAULT_CONFIG["deep_think_llm"],
            "output_language": DEFAULT_CONFIG["output_language"],
            "research_depth": DEFAULT_CONFIG["max_debate_rounds"],
            "checkpoint_enabled": DEFAULT_CONFIG["checkpoint_enabled"],
        },
        "analysts": ANALYSTS,
        "asset_types": ASSET_TYPES,
        "providers": providers,
    }
