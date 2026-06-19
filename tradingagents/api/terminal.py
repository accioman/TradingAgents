"""Whitelisted local command runner for the web terminal mode."""

from __future__ import annotations

import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

COMMANDS: dict[str, list[str]] = {
    "install": ["python", "-m", "pip", "install", "-e", "."],
    "test": ["python", "-m", "pytest"],
    "start-cli": ["python", "-m", "cli.main", "analyze"],
    "clear-checkpoints": [
        "python",
        "-c",
        (
            "from tradingagents.default_config import DEFAULT_CONFIG; "
            "from tradingagents.graph.checkpointer import clear_all_checkpoints; "
            "print(clear_all_checkpoints(DEFAULT_CONFIG['data_cache_dir']))"
        ),
    ],
}


def list_commands() -> list[str]:
    return sorted(COMMANDS)


def run_whitelisted_command(command: str, timeout_seconds: int = 300) -> dict[str, object]:
    if command not in COMMANDS:
        return {
            "command": command,
            "exit_code": 2,
            "output": "",
            "error": "Command is not whitelisted.",
        }
    completed = subprocess.run(
        COMMANDS[command],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        shell=False,
    )
    return {
        "command": command,
        "exit_code": completed.returncode,
        "output": completed.stdout,
        "error": completed.stderr or None,
    }
