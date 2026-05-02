#!/usr/bin/env python3

from __future__ import annotations

import json
import subprocess
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from logger_core import APP_DIR, compute_next_due, load_config, load_logs, load_log_summary, load_state, save_config


ROOT_DIR = Path(__file__).resolve().parent
PORT = 4173


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
                }
            )
            return

        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/config":
            payload = self.read_json_body()
            config = save_config(payload)
            self.send_json({"ok": True, "config": config})
            return

        if parsed.path == "/api/trigger":
            subprocess.Popen([sys.executable, str(ROOT_DIR / "logger_core.py"), "trigger"])
            self.send_json({"ok": True})
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
