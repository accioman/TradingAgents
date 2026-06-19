"""Small SQLite persistence layer for the local FastAPI app."""

from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.services.analysis_runner import AnalysisConfig, AnalysisEvent, AnalysisResult
from tradingagents.services.reports import SECTION_TITLES, to_json_text


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def default_db_path() -> Path:
    configured = os.environ.get("TRADINGAGENTS_APP_DB")
    if configured:
        return Path(configured).expanduser()
    return Path(DEFAULT_CONFIG["data_cache_dir"]) / "tradingagents_app.sqlite3"


class SQLiteStore:
    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else default_db_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    @contextmanager
    def _connection(self):
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._lock, self._connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS analyses (
                    id TEXT PRIMARY KEY,
                    ticker TEXT NOT NULL,
                    analysis_date TEXT NOT NULL,
                    asset_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    error TEXT,
                    report_markdown TEXT,
                    final_state_json TEXT,
                    stats_json TEXT,
                    summary_json TEXT,
                    result_dir TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS analysis_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
                    event_type TEXT NOT NULL,
                    message TEXT,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS report_sections (
                    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
                    section TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (analysis_id, section)
                );

                CREATE INDEX IF NOT EXISTS idx_analysis_events_analysis_id_id
                    ON analysis_events(analysis_id, id);
                CREATE INDEX IF NOT EXISTS idx_analyses_status_updated
                    ON analyses(status, updated_at);
                """
            )

    def create_analysis(self, config: AnalysisConfig) -> str:
        analysis_id = str(uuid.uuid4())
        now = utc_now()
        with self._lock, self._connection() as conn:
            conn.execute(
                """
                INSERT INTO analyses (
                    id, ticker, analysis_date, asset_type, status, config_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
                """,
                (
                    analysis_id,
                    config.ticker,
                    config.analysis_date,
                    config.asset_type,
                    to_json_text(asdict(config)),
                    now,
                    now,
                ),
            )
        return analysis_id

    def mark_started(self, analysis_id: str) -> None:
        now = utc_now()
        with self._lock, self._connection() as conn:
            conn.execute(
                """
                UPDATE analyses
                SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
                WHERE id = ?
                """,
                (now, now, analysis_id),
            )

    def mark_error(self, analysis_id: str, error: str) -> None:
        now = utc_now()
        with self._lock, self._connection() as conn:
            conn.execute(
                """
                UPDATE analyses
                SET status = 'error', error = ?, completed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (error, now, now, analysis_id),
            )

    def save_result(self, analysis_id: str, result: AnalysisResult) -> None:
        now = utc_now()
        with self._lock, self._connection() as conn:
            conn.execute(
                """
                UPDATE analyses
                SET status = 'completed',
                    report_markdown = ?,
                    final_state_json = ?,
                    stats_json = ?,
                    summary_json = ?,
                    result_dir = ?,
                    completed_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    result.report_markdown,
                    to_json_text(result.final_state),
                    to_json_text(result.stats),
                    to_json_text(result.summary),
                    result.result_dir,
                    now,
                    now,
                    analysis_id,
                ),
            )
            for section, content in result.sections.items():
                title = SECTION_TITLES.get(section, section.replace("_", " ").title())
                conn.execute(
                    """
                    INSERT INTO report_sections (analysis_id, section, title, content, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(analysis_id, section) DO UPDATE SET
                        title = excluded.title,
                        content = excluded.content,
                        updated_at = excluded.updated_at
                    """,
                    (analysis_id, section, title, content, now),
                )

    def append_event(self, analysis_id: str, event: AnalysisEvent) -> int:
        with self._lock, self._connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO analysis_events (
                    analysis_id, event_type, message, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    analysis_id,
                    event.type,
                    event.message,
                    to_json_text(event.payload),
                    event.created_at,
                ),
            )
            if event.type == "report_section":
                section = event.payload.get("section")
                title = event.payload.get("title") or str(section)
                content = event.payload.get("content")
                if section and content is not None:
                    conn.execute(
                        """
                        INSERT INTO report_sections (
                            analysis_id, section, title, content, updated_at
                        ) VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(analysis_id, section) DO UPDATE SET
                            title = excluded.title,
                            content = excluded.content,
                            updated_at = excluded.updated_at
                        """,
                        (analysis_id, section, title, str(content), event.created_at),
                    )
            return int(cursor.lastrowid)

    def get_analysis(self, analysis_id: str) -> dict[str, Any] | None:
        with self._lock, self._connection() as conn:
            row = conn.execute(
                "SELECT * FROM analyses WHERE id = ?",
                (analysis_id,),
            ).fetchone()
        return _analysis_row(row) if row else None

    def list_analyses(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock, self._connection() as conn:
            rows = conn.execute(
                """
                SELECT * FROM analyses
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [_analysis_row(row) for row in rows]

    def list_reports(self, limit: int = 50, query: str | None = None) -> list[dict[str, Any]]:
        params: list[Any] = []
        where = "status = 'completed' AND report_markdown IS NOT NULL"
        if query:
            where += " AND (ticker LIKE ? OR report_markdown LIKE ?)"
            like = f"%{query}%"
            params.extend([like, like])
        params.append(limit)
        with self._lock, self._connection() as conn:
            rows = conn.execute(
                f"""
                SELECT * FROM analyses
                WHERE {where}
                ORDER BY completed_at DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [_analysis_row(row) for row in rows]

    def get_report(self, analysis_id: str) -> dict[str, Any] | None:
        analysis = self.get_analysis(analysis_id)
        if not analysis or not analysis.get("report_markdown"):
            return None
        with self._lock, self._connection() as conn:
            rows = conn.execute(
                """
                SELECT section, title, content, updated_at
                FROM report_sections
                WHERE analysis_id = ?
                ORDER BY updated_at ASC
                """,
                (analysis_id,),
            ).fetchall()
        analysis["sections"] = [dict(row) for row in rows]
        return analysis

    def list_events(self, analysis_id: str, after_id: int = 0) -> list[dict[str, Any]]:
        with self._lock, self._connection() as conn:
            rows = conn.execute(
                """
                SELECT id, analysis_id, event_type, message, payload_json, created_at
                FROM analysis_events
                WHERE analysis_id = ? AND id > ?
                ORDER BY id ASC
                """,
                (analysis_id, after_id),
            ).fetchall()
        return [_event_row(row) for row in rows]

    def health(self) -> dict[str, Any]:
        with self._lock, self._connection() as conn:
            count = conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
        return {"database": str(self.path), "analyses": count}


def _loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _analysis_row(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["config"] = _loads(data.pop("config_json", None), {})
    data["final_state"] = _loads(data.pop("final_state_json", None), None)
    data["stats"] = _loads(data.pop("stats_json", None), None)
    data["summary"] = _loads(data.pop("summary_json", None), None)
    return data


def _event_row(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["type"] = data.pop("event_type")
    data["payload"] = _loads(data.pop("payload_json", None), {})
    return data
