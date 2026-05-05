#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from analytics_core import classify_day, classify_week, get_day_view, get_week_view
from logger_core import (
    APP_DIR,
    compute_next_due,
    delete_log_entry,
    load_config,
    load_logs,
    load_log_summary,
    load_reading_guard_state,
    load_state,
    save_config,
    update_log_entry,
)


ROOT_DIR = Path(__file__).resolve().parent
PORT = 4173
PROMPT_AGENT_LABEL = "com.codex.hourly-work-logger"
PROMPT_AGENT_PLIST = Path.home() / "Library" / "LaunchAgents" / f"{PROMPT_AGENT_LABEL}.plist"
HERMES_DB_PATH = Path.home() / ".hermes" / "state.db"


def sync_prompt_agent(enabled: bool) -> None:
    domain_label = f"gui/{os.getuid()}/{PROMPT_AGENT_LABEL}"
    domain = f"gui/{os.getuid()}"

    if enabled:
        if PROMPT_AGENT_PLIST.exists():
            subprocess.run(["launchctl", "enable", domain_label], check=False)
            status = subprocess.run(["launchctl", "print", domain_label], capture_output=True, text=True, check=False)
            if status.returncode != 0:
                subprocess.run(["launchctl", "bootstrap", domain, str(PROMPT_AGENT_PLIST)], check=False)
            subprocess.run(["launchctl", "kickstart", "-k", domain_label], check=False)
        return

    subprocess.run(["launchctl", "bootout", domain, str(PROMPT_AGENT_PLIST)], check=False)
    subprocess.run(["launchctl", "disable", domain_label], check=False)


def prompt_agent_is_running() -> bool:
    domain_label = f"gui/{os.getuid()}/{PROMPT_AGENT_LABEL}"
    result = subprocess.run(["launchctl", "print", domain_label], capture_output=True, text=True, check=False)
    return result.returncode == 0


def load_hermes_usage_snapshot() -> dict:
    return load_hermes_usage(scope="session")


def load_hermes_usage(scope: str = "total", model: str = "", session_id: str = "") -> dict:
    if not HERMES_DB_PATH.exists():
        return {
            "available": False,
            "error": "未找到 Hermes 状态库",
        }

    try:
        return _read_hermes_usage(scope=scope, model=model, session_id=session_id)
    except sqlite3.Error as exc:
        return {
            "available": False,
            "error": f"Hermes 状态库读取失败：{exc}",
        }


def _read_hermes_usage(scope: str = "total", model: str = "", session_id: str = "") -> dict:
    db_uri = f"file:{HERMES_DB_PATH}?mode=ro"
    selected_scope = "session" if scope == "session" else "total"
    selected_model = model.strip()
    selected_session_id = session_id.strip()

    with sqlite3.connect(db_uri, uri=True) as conn:
        conn.row_factory = sqlite3.Row
        model_options = [
            {
                "value": "",
                "label": "全部模型",
                "sessionCount": int(row["session_count"] or 0),
            }
            for row in [
                conn.execute(
                    """
                    SELECT COUNT(*) AS session_count
                    FROM sessions
                    WHERE model IS NOT NULL AND model != ''
                    """
                ).fetchone()
            ]
        ]
        model_options.extend(
            [
                {
                    "value": str(row["model"] or ""),
                    "label": str(row["model"] or ""),
                    "sessionCount": int(row["session_count"] or 0),
                }
                for row in conn.execute(
                    """
                    SELECT model, COUNT(*) AS session_count
                    FROM sessions
                    WHERE model IS NOT NULL AND model != ''
                    GROUP BY model
                    ORDER BY MAX(started_at) DESC
                    """
                ).fetchall()
            ]
        )

        session_where_sql, session_params = build_hermes_filter_sql(selected_model)
        latest_row = conn.execute(
            f"""
            SELECT id, source, model, input_tokens, output_tokens,
                   estimated_cost_usd, actual_cost_usd, cost_status,
                   cost_source, billing_provider, billing_base_url,
                   billing_mode, started_at, ended_at
            FROM sessions
            {session_where_sql}
            ORDER BY started_at DESC
            LIMIT 1
            """,
            session_params,
        ).fetchone()

        active_row = conn.execute(
            """
            SELECT id, source, model, input_tokens, output_tokens,
                   estimated_cost_usd, actual_cost_usd, cost_status,
                   cost_source, billing_provider, billing_base_url,
                   billing_mode, started_at, ended_at
            FROM sessions
            WHERE ended_at IS NULL
            """
            + (" AND model = ?" if selected_model else "")
            + """
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (selected_model,) if selected_model else (),
        ).fetchone()

        session_rows = conn.execute(
            f"""
            SELECT id, source, model, input_tokens, output_tokens,
                   estimated_cost_usd, actual_cost_usd, cost_status,
                   cost_source, billing_provider, billing_base_url,
                   billing_mode, started_at, ended_at
            FROM sessions
            {session_where_sql}
            ORDER BY started_at DESC
            LIMIT 80
            """,
            session_params,
        ).fetchall()

        resolved_session_row = None
        resolved_session_id = ""
        if selected_scope == "session":
            if selected_session_id:
                resolved_session_row = conn.execute(
                    f"""
                    SELECT id, source, model, input_tokens, output_tokens,
                           estimated_cost_usd, actual_cost_usd, cost_status,
                           cost_source, billing_provider, billing_base_url,
                           billing_mode, started_at, ended_at
                    FROM sessions
                    WHERE id = ?
                    """
                    + (" AND model = ?" if selected_model else ""),
                    (selected_session_id, selected_model) if selected_model else (selected_session_id,),
                ).fetchone()

            if resolved_session_row is None:
                resolved_session_row = latest_row

            if resolved_session_row is not None:
                resolved_session_id = str(resolved_session_row["id"] or "")

        aggregate_row = conn.execute(
            f"""
            SELECT COUNT(*) AS session_count,
                   COALESCE(SUM(input_tokens), 0) AS input_tokens,
                   COALESCE(SUM(output_tokens), 0) AS output_tokens,
                   COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0) AS display_cost_usd,
                   COALESCE(SUM(COALESCE(estimated_cost_usd, 0)), 0) AS estimated_cost_usd,
                   COALESCE(SUM(COALESCE(actual_cost_usd, 0)), 0) AS actual_cost_usd,
                   MIN(started_at) AS first_started_at,
                   MAX(started_at) AS last_started_at
            FROM sessions
            {session_where_sql}
            """,
            session_params,
        ).fetchone()

    session_options = [
        {
            "value": str(row["id"] or ""),
            "label": format_hermes_session_label(row),
        }
        for row in session_rows
    ]

    focus = (
        serialize_hermes_session_row(resolved_session_row)
        if selected_scope == "session"
        else serialize_hermes_aggregate_row(aggregate_row, selected_model)
    )

    return {
        "available": focus is not None,
        "updatedAt": format_epoch_timestamp(latest_row["started_at"]) if latest_row is not None else "",
        "selected": {
            "scope": selected_scope,
            "model": selected_model,
            "sessionId": resolved_session_id,
        },
        "modelOptions": model_options,
        "sessionOptions": session_options,
        "focus": focus,
        "latestSession": serialize_hermes_session_row(latest_row),
        "activeSession": serialize_hermes_session_row(active_row),
    }


def build_hermes_filter_sql(model: str) -> tuple[str, tuple]:
    if model:
        return "WHERE model = ?", (model,)
    return "", ()


def serialize_hermes_session_row(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None

    input_tokens = int(row["input_tokens"] or 0)
    output_tokens = int(row["output_tokens"] or 0)
    estimated_cost = float(row["estimated_cost_usd"] or 0.0)
    actual_cost = row["actual_cost_usd"]
    actual_cost_value = None if actual_cost is None else float(actual_cost)
    display_cost = actual_cost_value if actual_cost_value is not None else estimated_cost

    return {
        "type": "session",
        "title": f"{str(row['model'] or '未记录模型')} · 单会话",
        "description": str(row["id"] or ""),
        "sessionId": str(row["id"] or ""),
        "source": str(row["source"] or ""),
        "model": str(row["model"] or ""),
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": input_tokens + output_tokens,
        "estimatedCostUsd": round(estimated_cost, 6),
        "actualCostUsd": None if actual_cost_value is None else round(actual_cost_value, 6),
        "displayCostUsd": round(display_cost, 6),
        "costStatus": str(row["cost_status"] or "unknown"),
        "costSource": str(row["cost_source"] or ""),
        "billingProvider": str(row["billing_provider"] or ""),
        "billingBaseURL": str(row["billing_base_url"] or ""),
        "billingMode": str(row["billing_mode"] or ""),
        "startedAt": format_epoch_timestamp(row["started_at"]),
        "endedAt": format_epoch_timestamp(row["ended_at"]),
        "isActive": row["ended_at"] is None,
    }


def serialize_hermes_aggregate_row(row: sqlite3.Row | None, model: str) -> dict | None:
    if row is None:
        return None

    input_tokens = int(row["input_tokens"] or 0)
    output_tokens = int(row["output_tokens"] or 0)
    session_count = int(row["session_count"] or 0)
    estimated_cost = float(row["estimated_cost_usd"] or 0.0)
    actual_cost = float(row["actual_cost_usd"] or 0.0)
    display_cost = float(row["display_cost_usd"] or 0.0)
    title = f"{model} · 总消耗" if model else "全部模型 · 总消耗"

    return {
        "type": "total",
        "title": title,
        "description": f"共 {session_count} 个会话",
        "sessionId": "",
        "source": "aggregate",
        "model": model,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": input_tokens + output_tokens,
        "sessionCount": session_count,
        "estimatedCostUsd": round(estimated_cost, 6),
        "actualCostUsd": round(actual_cost, 6),
        "displayCostUsd": round(display_cost, 6),
        "costStatus": "unknown",
        "costSource": "",
        "billingProvider": "",
        "billingBaseURL": "",
        "billingMode": "",
        "startedAt": format_epoch_timestamp(row["first_started_at"]),
        "endedAt": format_epoch_timestamp(row["last_started_at"]),
        "isActive": False,
    }


def format_hermes_session_label(row: sqlite3.Row) -> str:
    started_at = format_epoch_timestamp(row["started_at"])
    model = str(row["model"] or "未记录模型")
    source = str(row["source"] or "unknown")
    token_total = int(row["input_tokens"] or 0) + int(row["output_tokens"] or 0)
    return f"{started_at[5:16] if started_at else '未知时间'} · {model} · {source} · {token_total} tokens"


def format_epoch_timestamp(value: object) -> str:
    from datetime import datetime

    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return ""

    return datetime.fromtimestamp(seconds).strftime("%Y-%m-%d %H:%M:%S")


def local_day_start_timestamp() -> float:
    from datetime import datetime

    now = datetime.now().astimezone()
    return now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


class ControlHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self.send_json(
                {
                    "config": load_config(),
                    "state": load_state(),
                    "logs": load_logs(),
                    "summary": load_log_summary(),
                    "nextDueAt": compute_next_due(),
                    "appDir": str(APP_DIR),
                    "promptAgentRunning": prompt_agent_is_running(),
                    "readingGuardState": load_reading_guard_state(),
                    "hermesUsage": load_hermes_usage_snapshot(),
                }
            )
            return

        if parsed.path == "/api/analytics/day":
            params = parse_qs(parsed.query)
            date_str = str(params.get("date", [""])[0]).strip()
            self.send_json(get_day_view(date_str or today_date()))
            return

        if parsed.path == "/api/analytics/week":
            params = parse_qs(parsed.query)
            date_str = str(params.get("date", [""])[0]).strip()
            self.send_json(get_week_view(date_str or today_date()))
            return

        if parsed.path == "/api/hermes-usage":
            params = parse_qs(parsed.query)
            scope = str(params.get("scope", ["total"])[0]).strip()
            model = str(params.get("model", [""])[0]).strip()
            session_id = str(params.get("sessionId", [""])[0]).strip()
            self.send_json(load_hermes_usage(scope=scope, model=model, session_id=session_id))
            return

        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/config":
            payload = self.read_json_body()
            config = save_config(payload)
            sync_prompt_agent(bool(config.get("enabled", True)))
            self.send_json({"ok": True, "config": config})
            return

        if parsed.path == "/api/trigger":
            subprocess.Popen([sys.executable, str(ROOT_DIR / "logger_core.py"), "trigger"])
            self.send_json({"ok": True})
            return

        if parsed.path == "/api/logs/update":
            payload = self.read_json_body()
            updated = update_log_entry(str(payload.get("id", "")), str(payload.get("entry", "")).strip())
            self.send_json({"ok": updated})
            return

        if parsed.path == "/api/logs/delete":
            payload = self.read_json_body()
            deleted = delete_log_entry(str(payload.get("id", "")))
            self.send_json({"ok": deleted})
            return

        if parsed.path == "/api/analytics/classify-day":
            payload = self.read_json_body()
            date_str = str(payload.get("date", "")).strip() or today_date()
            try:
                result = classify_day(date_str)
            except ValueError as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True, "day": result})
            return

        if parsed.path == "/api/analytics/classify-week":
            payload = self.read_json_body()
            date_str = str(payload.get("date", "")).strip() or today_date()
            try:
                result = classify_week(date_str)
            except ValueError as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"ok": True, "week": result})
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            data = {}
        return data if isinstance(data, dict) else {}

    def send_json(self, data: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def today_date() -> str:
    from datetime import datetime

    return datetime.now().strftime("%Y-%m-%d")


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), ControlHandler)
    print(f"Behavior Engine · Mirror Review: http://127.0.0.1:{PORT}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
