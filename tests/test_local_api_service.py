import datetime as dt
import time

from fastapi.testclient import TestClient

from tradingagents.api.app import create_app
from tradingagents.api.manager import AnalysisManager
from tradingagents.services.config_catalog import get_public_config
from tradingagents.storage import SQLiteStore


def test_public_config_reports_key_availability_without_secret(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret")

    config = get_public_config()
    openai = next(provider for provider in config["providers"] if provider["id"] == "openai")

    assert openai["api_key_available"] is True
    assert "sk-test-secret" not in repr(config)


def test_api_key_update_persists_secret_without_echoing(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    store = SQLiteStore(tmp_path / "app.sqlite3")
    manager = AnalysisManager(store=store, max_workers=1)
    app = create_app(manager=manager)

    with TestClient(app) as client:
        response = client.post(
            "/config/api-keys",
            json={"provider": "openai", "api_key": "sk-from-ui"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "provider": "openai",
        "api_key_env": "OPENAI_API_KEY",
        "api_key_available": True,
    }
    assert "sk-from-ui" not in response.text
    assert "OPENAI_API_KEY='sk-from-ui'" in (tmp_path / ".env").read_text()


def test_demo_analysis_persists_report_and_events(tmp_path):
    store = SQLiteStore(tmp_path / "app.sqlite3")
    manager = AnalysisManager(store=store, max_workers=1)
    app = create_app(manager=manager)

    with TestClient(app) as client:
        created = client.post(
            "/analyses",
            json={
                "ticker": "SPY",
                "analysis_date": dt.date.today().strftime("%Y-%m-%d"),
                "demo": True,
                "analysts": ["market", "news"],
                "research_depth": 1,
            },
        )
        assert created.status_code == 202
        analysis_id = created.json()["id"]

        for _ in range(30):
            analysis = client.get(f"/analyses/{analysis_id}").json()
            if analysis["status"] in {"completed", "error"}:
                break
            time.sleep(0.2)

        assert analysis["status"] == "completed"
        report = client.get(f"/reports/{analysis_id}")
        assert report.status_code == 200
        report_body = report.json()
        assert report_body["summary"]["rating"] == "Hold"
        assert len(report_body["sections"]) >= 3

        events = client.get(f"/analyses/{analysis_id}/events").json()
        assert any(event["type"] == "report_section" for event in events)
        assert any(event["type"] == "completed" for event in events)
