"""FastAPI app for the local TradingAgents dashboard."""

from __future__ import annotations

import asyncio
import os
import queue
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from tradingagents.api.manager import AnalysisManager
from tradingagents.api.schemas import (
    AnalysisCreate,
    AnalysisCreated,
    APIKeyUpdate,
    TerminalCommand,
)
from tradingagents.api.terminal import list_commands, run_whitelisted_command
from tradingagents.services.config_catalog import get_public_config, save_provider_api_key
from tradingagents.storage import SQLiteStore


def create_app(manager: AnalysisManager | None = None) -> FastAPI:
    if manager is None:
        store = SQLiteStore()
        analysis_manager = AnalysisManager(store=store)
    else:
        analysis_manager = manager
        store = manager.store
    app = FastAPI(title="TradingAgents Local API", version="0.1.0")
    app.state.analysis_manager = analysis_manager
    app.state.store = store

    @app.on_event("shutdown")
    def shutdown_manager() -> None:
        analysis_manager.shutdown(wait=False)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
            "http://localhost:7000",
            "http://127.0.0.1:7000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", **store.health()}

    @app.get("/config")
    def config() -> dict[str, Any]:
        return get_public_config()

    @app.post("/config/api-keys")
    def update_api_key(payload: APIKeyUpdate) -> dict[str, Any]:
        try:
            return save_provider_api_key(payload.provider, payload.api_key)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/analyses", response_model=AnalysisCreated, status_code=202)
    def create_analysis(payload: AnalysisCreate) -> AnalysisCreated:
        try:
            analysis_id = analysis_manager.submit(payload)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return AnalysisCreated(id=analysis_id, status="pending")

    @app.get("/analyses")
    def list_analyses(limit: int = Query(default=50, ge=1, le=200)) -> list[dict[str, Any]]:
        return store.list_analyses(limit=limit)

    @app.get("/analyses/{analysis_id}")
    def get_analysis(analysis_id: str) -> dict[str, Any]:
        analysis = store.get_analysis(analysis_id)
        if not analysis:
            raise HTTPException(status_code=404, detail="Analysis not found")
        return analysis

    @app.get("/analyses/{analysis_id}/events")
    def get_events(
        analysis_id: str,
        after_id: int = Query(default=0, ge=0),
    ) -> list[dict[str, Any]]:
        if not store.get_analysis(analysis_id):
            raise HTTPException(status_code=404, detail="Analysis not found")
        return store.list_events(analysis_id, after_id=after_id)

    @app.websocket("/analyses/{analysis_id}/stream")
    async def stream_analysis(websocket: WebSocket, analysis_id: str) -> None:
        await websocket.accept()
        if not store.get_analysis(analysis_id):
            await websocket.close(code=1008, reason="Analysis not found")
            return

        terminal = False
        last_id = 0
        for event in store.list_events(analysis_id):
            last_id = max(last_id, int(event["id"]))
            await websocket.send_json(event)
            if _is_terminal(event):
                terminal = True
        if terminal:
            await websocket.close()
            return

        subscriber = analysis_manager.subscribe(analysis_id)
        try:
            while True:
                event = await _queue_get(subscriber)
                if int(event.get("id", 0)) <= last_id:
                    continue
                last_id = int(event["id"])
                await websocket.send_json(event)
                if _is_terminal(event):
                    await websocket.close()
                    return
        except WebSocketDisconnect:
            return
        finally:
            analysis_manager.unsubscribe(analysis_id, subscriber)

    @app.get("/reports")
    def list_reports(
        limit: int = Query(default=50, ge=1, le=200),
        q: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        return store.list_reports(limit=limit, query=q)

    @app.get("/reports/{analysis_id}")
    def get_report(analysis_id: str) -> dict[str, Any]:
        report = store.get_report(analysis_id)
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        return report

    @app.get("/reports/{analysis_id}/export")
    def export_report(
        analysis_id: str,
        format: str = Query(default="markdown"),
    ):
        if format not in {"markdown", "json"}:
            raise HTTPException(status_code=422, detail="format must be markdown or json")
        report = store.get_report(analysis_id)
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        if format == "json":
            return JSONResponse(report)
        filename = f"{report['ticker']}_{report['analysis_date']}.md"
        return PlainTextResponse(
            report["report_markdown"],
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.get("/terminal/commands")
    def terminal_commands() -> dict[str, list[str]]:
        return {"commands": list_commands()}

    @app.post("/terminal/run")
    def terminal_run(payload: TerminalCommand) -> dict[str, object]:
        return run_whitelisted_command(payload.command)

    _mount_frontend(app)

    return app


async def _queue_get(subscriber: queue.Queue[dict[str, Any]]) -> dict[str, Any]:
    while True:
        try:
            return await asyncio.to_thread(subscriber.get, True, 1)
        except queue.Empty:
            await asyncio.sleep(0)


def _is_terminal(event: dict[str, Any]) -> bool:
    status = (event.get("payload") or {}).get("status")
    return event.get("type") in {"completed", "error"} or status in {"completed", "error"}


def _mount_frontend(app: FastAPI) -> None:
    dist_dir = Path(__file__).resolve().parents[2] / "web" / "dist"
    index_file = dist_dir / "index.html"
    assets_dir = dist_dir / "assets"
    if not index_file.exists():
        return
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/", include_in_schema=False)
    def frontend_index():
        return FileResponse(index_file)

    @app.get("/{full_path:path}", include_in_schema=False)
    def frontend_fallback(full_path: str):
        candidate = dist_dir / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_file)


app = create_app()


def main() -> None:
    import uvicorn

    host = os.environ.get("TRADINGAGENTS_API_HOST", "127.0.0.1")
    port = int(os.environ.get("TRADINGAGENTS_API_PORT", "7000"))
    uvicorn.run("tradingagents.api.app:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
