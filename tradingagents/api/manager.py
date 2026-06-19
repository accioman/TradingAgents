"""Background analysis job manager."""

from __future__ import annotations

import queue
import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

from tradingagents.api.schemas import AnalysisCreate
from tradingagents.services.analysis_runner import (
    AnalysisConfig,
    AnalysisEvent,
    normalize_analysis_config,
    run_analysis,
)
from tradingagents.storage import SQLiteStore


class AnalysisManager:
    def __init__(self, store: SQLiteStore | None = None, max_workers: int = 2) -> None:
        self.store = store or SQLiteStore()
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="analysis")
        self._futures: dict[str, Future[Any]] = {}
        self._subscribers: dict[str, list[queue.Queue[dict[str, Any]]]] = {}
        self._lock = threading.RLock()

    def submit(self, request: AnalysisCreate) -> str:
        request_data = request.model_dump() if hasattr(request, "model_dump") else request.dict()
        config = normalize_analysis_config(AnalysisConfig.from_mapping(request_data))
        analysis_id = self.store.create_analysis(config)
        self._emit(
            analysis_id,
            AnalysisEvent(
                "status",
                "Analysis queued",
                {"status": "pending", "ticker": config.ticker},
            ),
        )
        future = self.executor.submit(self._run_job, analysis_id, config)
        with self._lock:
            self._futures[analysis_id] = future
        return analysis_id

    def _run_job(self, analysis_id: str, config: AnalysisConfig) -> None:
        self.store.mark_started(analysis_id)
        self._emit(
            analysis_id,
            AnalysisEvent("status", "Analysis running", {"status": "running"}),
        )
        try:
            result = run_analysis(config, event_sink=lambda event: self._emit(analysis_id, event))
            self.store.save_result(analysis_id, result)
            self._emit(
                analysis_id,
                AnalysisEvent(
                    "status",
                    "Analysis completed",
                    {"status": "completed", "summary": result.summary},
                ),
            )
        except Exception as exc:
            self.store.mark_error(analysis_id, str(exc))
            self._emit(
                analysis_id,
                AnalysisEvent(
                    "status",
                    str(exc),
                    {
                        "status": "error",
                        "traceback": traceback.format_exc(),
                    },
                ),
            )

    def _emit(self, analysis_id: str, event: AnalysisEvent) -> dict[str, Any]:
        event_id = self.store.append_event(analysis_id, event)
        payload = event.to_dict()
        payload["id"] = event_id
        payload["analysis_id"] = analysis_id
        with self._lock:
            subscribers = list(self._subscribers.get(analysis_id, []))
        for subscriber in subscribers:
            subscriber.put(payload)
        return payload

    def subscribe(self, analysis_id: str) -> queue.Queue[dict[str, Any]]:
        subscriber: queue.Queue[dict[str, Any]] = queue.Queue()
        with self._lock:
            self._subscribers.setdefault(analysis_id, []).append(subscriber)
        return subscriber

    def unsubscribe(self, analysis_id: str, subscriber: queue.Queue[dict[str, Any]]) -> None:
        with self._lock:
            subscribers = self._subscribers.get(analysis_id)
            if not subscribers:
                return
            if subscriber in subscribers:
                subscribers.remove(subscriber)
            if not subscribers:
                self._subscribers.pop(analysis_id, None)

    def get(self, analysis_id: str) -> dict[str, Any] | None:
        return self.store.get_analysis(analysis_id)

    def events(self, analysis_id: str, after_id: int = 0) -> list[dict[str, Any]]:
        return self.store.list_events(analysis_id, after_id=after_id)

    def shutdown(self, wait: bool = True) -> None:
        self.executor.shutdown(wait=wait, cancel_futures=False)
