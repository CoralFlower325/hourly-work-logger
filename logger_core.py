#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any


APP_DIR = Path.home() / "Library" / "Application Support" / "HourlyWorkLogger"
LOG_FILE = APP_DIR / "hourly-log.csv"
CONFIG_FILE = APP_DIR / "config.json"
STATE_FILE = APP_DIR / "state.json"
PROMPT_SCRIPT_FILE = APP_DIR / "hourly_prompt.js"


DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": True,
    "scheduleMode": "hourly",
    "minuteOfHour": 0,
    "intervalMinutes": 60,
    "activeStart": "09:00",
    "activeEnd": "18:00",
    "title": "Hourly Work Logger",
    "promptText": "请记录刚才这一小时你做了什么：",
}


DEFAULT_STATE: dict[str, Any] = {
    "lastPromptAt": "",
    "lastPromptSlot": "",
    "lastEntryPreview": "",
}


@dataclass
class PromptResult:
    timestamp: str
    entry: str


def ensure_app_files() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    if not CONFIG_FILE.exists():
      save_json(CONFIG_FILE, DEFAULT_CONFIG)
    if not STATE_FILE.exists():
      save_json(STATE_FILE, DEFAULT_STATE)
    if not LOG_FILE.exists():
      with LOG_FILE.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["timestamp", "entry"])


def load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return dict(default)

    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return dict(default)

    merged = dict(default)
    merged.update(data if isinstance(data, dict) else {})
    return merged


def save_json(path: Path, data: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def load_config() -> dict[str, Any]:
    ensure_app_files()
    return load_json(CONFIG_FILE, DEFAULT_CONFIG)


def save_config(config: dict[str, Any]) -> dict[str, Any]:
    ensure_app_files()
    normalized = normalize_config(config)
    save_json(CONFIG_FILE, normalized)
    return normalized


def load_state() -> dict[str, Any]:
    ensure_app_files()
    return load_json(STATE_FILE, DEFAULT_STATE)


def save_state(state: dict[str, Any]) -> None:
    ensure_app_files()
    save_json(STATE_FILE, state)


def normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(DEFAULT_CONFIG)
    normalized.update(config)
    normalized["enabled"] = parse_bool(normalized.get("enabled", True))
    normalized["scheduleMode"] = "interval" if normalized.get("scheduleMode") == "interval" else "hourly"
    normalized["minuteOfHour"] = clamp(int(normalized.get("minuteOfHour", 0)), 0, 59)
    normalized["intervalMinutes"] = clamp(int(normalized.get("intervalMinutes", 60)), 5, 240)
    normalized["activeStart"] = normalize_time_string(str(normalized.get("activeStart", "09:00")))
    normalized["activeEnd"] = normalize_time_string(str(normalized.get("activeEnd", "18:00")))
    normalized["title"] = str(normalized.get("title", DEFAULT_CONFIG["title"]))[:120]
    normalized["promptText"] = str(normalized.get("promptText", DEFAULT_CONFIG["promptText"]))[:500]
    return normalized


def clamp(value: int, min_value: int, max_value: int) -> int:
    return max(min_value, min(max_value, value))


def parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def normalize_time_string(value: str) -> str:
    try:
        parsed = datetime.strptime(value, "%H:%M")
    except ValueError:
        return "09:00"
    return parsed.strftime("%H:%M")


def parse_time(value: str) -> time:
    return datetime.strptime(value, "%H:%M").time()


def is_within_active_window(now: datetime, config: dict[str, Any]) -> bool:
    start = parse_time(config["activeStart"])
    end = parse_time(config["activeEnd"])
    current = now.time()

    if start == end:
        return True
    if start < end:
        return start <= current <= end
    return current >= start or current <= end


def slot_key_for(now: datetime, config: dict[str, Any]) -> str | None:
    if not config.get("enabled", True):
        return None
    if not is_within_active_window(now, config):
        return None

    if config["scheduleMode"] == "interval":
        interval = int(config["intervalMinutes"])
        minutes_since_midnight = now.hour * 60 + now.minute
        slot_index = minutes_since_midnight // interval
        slot_start = slot_index * interval
        return f"interval:{now.strftime('%Y-%m-%d')}:{slot_start}"

    if now.minute != int(config["minuteOfHour"]):
        return None
    return f"hourly:{now.strftime('%Y-%m-%dT%H')}:{config['minuteOfHour']}"


def should_prompt(now: datetime, config: dict[str, Any], state: dict[str, Any]) -> tuple[bool, str | None]:
    slot_key = slot_key_for(now, config)
    if slot_key is None:
        return False, None
    if state.get("lastPromptSlot") == slot_key:
        return False, slot_key
    return True, slot_key


def run_prompt(config: dict[str, Any]) -> PromptResult:
    ensure_app_files()
    env = os.environ.copy()
    env["HWL_TITLE"] = config["title"]
    env["HWL_PROMPT"] = config["promptText"]

    result = subprocess.run(
        ["/usr/bin/osascript", "-l", "JavaScript", str(PROMPT_SCRIPT_FILE)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        check=True,
    )

    entry = result.stdout.strip()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    append_log(timestamp, entry)
    return PromptResult(timestamp=timestamp, entry=entry)


def append_log(timestamp: str, entry: str) -> None:
    ensure_app_files()
    with LOG_FILE.open("a", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([timestamp, entry])


def tick() -> bool:
    ensure_app_files()
    now = datetime.now()
    config = load_config()
    state = load_state()
    due, slot_key = should_prompt(now, config, state)

    if not due or slot_key is None:
        return False

    result = run_prompt(config)
    state["lastPromptAt"] = result.timestamp
    state["lastPromptSlot"] = slot_key
    state["lastEntryPreview"] = result.entry[:120]
    save_state(state)
    return True


def trigger_now() -> PromptResult:
    config = load_config()
    result = run_prompt(config)
    state = load_state()
    state["lastPromptAt"] = result.timestamp
    state["lastPromptSlot"] = f"manual:{datetime.now().isoformat(timespec='seconds')}"
    state["lastEntryPreview"] = result.entry[:120]
    save_state(state)
    return result


def load_logs(limit: int = 200) -> list[dict[str, str]]:
    ensure_app_files()
    if not LOG_FILE.exists():
        return []

    rows = read_all_logs()

    recent = rows[-limit:]
    recent.reverse()
    return [
        {
            "id": row.get("id", ""),
            "timestamp": row.get("timestamp", ""),
            "entry": row.get("entry", ""),
        }
        for row in recent
    ]


def read_all_logs() -> list[dict[str, str]]:
    ensure_app_files()
    if not LOG_FILE.exists():
        return []

    with LOG_FILE.open("r", encoding="utf-8", newline="") as handle:
        return [
            {
                "id": str(index),
                "timestamp": row.get("timestamp", ""),
                "entry": row.get("entry", ""),
            }
            for index, row in enumerate(csv.DictReader(handle), start=1)
        ]


def write_all_logs(rows: list[dict[str, str]]) -> None:
    ensure_app_files()
    with LOG_FILE.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["timestamp", "entry"])
        for row in rows:
            writer.writerow([row.get("timestamp", ""), row.get("entry", "")])


def update_log_entry(log_id: str, entry: str) -> bool:
    rows = read_all_logs()
    updated = False

    for row in rows:
        if row.get("id") == str(log_id):
            row["entry"] = entry
            updated = True
            break

    if updated:
        write_all_logs(rows)
    return updated


def delete_log_entry(log_id: str) -> bool:
    rows = read_all_logs()
    filtered = [row for row in rows if row.get("id") != str(log_id)]
    if len(filtered) == len(rows):
        return False

    write_all_logs(filtered)
    return True


def load_log_summary() -> dict[str, int]:
    ensure_app_files()
    if not LOG_FILE.exists():
        return {"todayCount": 0, "totalCount": 0}

    today = datetime.now().strftime("%Y-%m-%d")
    total_count = 0
    today_count = 0

    with LOG_FILE.open("r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            total_count += 1
            if row.get("timestamp", "").startswith(today):
                today_count += 1

    return {"todayCount": today_count, "totalCount": total_count}


def compute_next_due(now: datetime | None = None) -> str:
    current = now or datetime.now()
    config = load_config()
    if not config.get("enabled", True):
        return ""

    for offset in range(0, 60 * 24 * 3):
        candidate = current + timedelta(minutes=offset)
        aligned = candidate.replace(second=0, microsecond=0)
        due, _ = should_prompt(aligned, config, {"lastPromptSlot": ""})
        if due and aligned >= current.replace(second=0, microsecond=0):
            return aligned.isoformat(timespec="minutes")
    return ""


def print_json(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def main(argv: list[str]) -> int:
    ensure_app_files()
    if len(argv) == 1:
        print("Usage: logger_core.py [tick|trigger|config|logs|status]")
        return 0

    command = argv[1]
    if command == "tick":
        tick()
        return 0
    if command == "trigger":
        result = trigger_now()
        print_json({"timestamp": result.timestamp, "entry": result.entry})
        return 0
    if command == "config":
        print_json(load_config())
        return 0
    if command == "logs":
        print_json(load_logs())
        return 0
    if command == "status":
        print_json(
            {
                "config": load_config(),
                "state": load_state(),
                "nextDueAt": compute_next_due(),
                "logPath": str(LOG_FILE),
                "summary": load_log_summary(),
            }
        )
        return 0

    print(f"Unknown command: {command}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
