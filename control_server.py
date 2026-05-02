#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import subprocess
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from logger_core import (
    APP_DIR,
    compute_next_due,
    delete_log_entry,
    load_config,
    load_logs,
    load_log_summary,
    load_state,
    save_config,
    update_log_entry,
)


ROOT_DIR = Path(__file__).resolve().parent
PORT = 4173
PROMPT_AGENT_LABEL = "com.codex.hourly-work-logger"
PROMPT_AGENT_PLIST = Path.home() / "Library" / "LaunchAgents" / f"{PROMPT_AGENT_LABEL}.plist"


def sync_prompt_agent(enabled: bool) -> None:
    domain_label = f"gui/{os.getuid()}/{PROMPT_AGENT_LABEL}"
    domain = f"gui/{os.getuid()}"

    if enabled:
        if PROMPT_AGENT_PLIST.exists():
            subprocess.run(["launchctl", "bootstrap", domain, str(PROMPT_AGENT_PLIST)], check=False)
            subprocess.run(["launchctl", "enable", domain_label], check=False)
            subprocess.run(["launchctl", "kickstart", "-k", domain_label], check=False)
        return

    subprocess.run(["launchctl", "disable", domain_label], check=False)
    subprocess.run(["launchctl", "bootout", domain, str(PROMPT_AGENT_PLIST)], check=False)


def prompt_agent_is_running() -> bool:
    domain_label = f"gui/{os.getuid()}/{PROMPT_AGENT_LABEL}"
    result = subprocess.run(["launchctl", "print", domain_label], capture_output=True, text=True, check=False)
    return result.returncode == 0 and "state = running" in result.stdout


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
                }
            )
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

        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            data = {}
        return data if isinstance(data, dict) else {}

    def send_json(self, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), ControlHandler)
    print(f"Hourly Work Logger control panel: http://127.0.0.1:{PORT}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
