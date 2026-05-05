#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib import error, request

from logger_core import APP_DIR, ensure_app_files, load_config, read_all_logs


ANALYTICS_CACHE_FILE = APP_DIR / "classification-cache.json"
CATEGORIES = ("学习", "工作", "娱乐")
EMPTY_CATEGORY = "空白"

DEFAULT_ANALYTICS_CACHE: dict[str, Any] = {"days": {}}


def load_analytics_cache() -> dict[str, Any]:
    ensure_app_files()
    if not ANALYTICS_CACHE_FILE.exists():
        return dict(DEFAULT_ANALYTICS_CACHE)

    try:
        with ANALYTICS_CACHE_FILE.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_ANALYTICS_CACHE)

    if not isinstance(data, dict):
        return dict(DEFAULT_ANALYTICS_CACHE)

    days = data.get("days")
    if not isinstance(days, dict):
        days = {}
    return {"days": days}


def save_analytics_cache(cache: dict[str, Any]) -> None:
    ensure_app_files()
    with ANALYTICS_CACHE_FILE.open("w", encoding="utf-8") as handle:
        json.dump(cache, handle, ensure_ascii=False, indent=2)


def get_day_view(date_str: str) -> dict[str, Any]:
    entries = load_logs_for_day(date_str)
    cache = load_analytics_cache()
    cached = cache["days"].get(date_str)
    source_hash = build_source_hash(entries)

    if isinstance(cached, dict) and cached.get("sourceHash") == source_hash:
        return ensure_day_payload_shape(cached, date_str)

    return build_blank_day_payload(date_str, entries)


def get_week_view(anchor_date: str) -> dict[str, Any]:
    start_date, days = week_dates_for(anchor_date)
    return {
        "startDate": start_date,
        "endDate": days[-1],
        "days": [get_day_view(day) for day in days],
    }


def classify_day(date_str: str) -> dict[str, Any]:
    entries = load_logs_for_day(date_str)
    if not entries:
        payload = build_blank_day_payload(date_str, [])
        cache = load_analytics_cache()
        cache["days"][date_str] = payload
        save_analytics_cache(cache)
        return payload

    config = load_config()
    ai_config = config.get("aiClassification", {})
    response_data = request_classification(entries, date_str, ai_config)
    payload = build_classified_day_payload(date_str, entries, response_data)

    cache = load_analytics_cache()
    cache["days"][date_str] = payload
    save_analytics_cache(cache)
    return payload


def classify_week(anchor_date: str) -> dict[str, Any]:
    _, days = week_dates_for(anchor_date)
    for day in days:
        classify_day(day)
    return get_week_view(anchor_date)


def load_logs_for_day(date_str: str) -> list[dict[str, Any]]:
    return [row for row in read_all_logs() if row.get("timestamp", "").startswith(date_str)]


def week_dates_for(anchor_date: str) -> tuple[str, list[str]]:
    anchor = datetime.strptime(anchor_date, "%Y-%m-%d")
    start = anchor - timedelta(days=anchor.weekday())
    days = [(start + timedelta(days=offset)).strftime("%Y-%m-%d") for offset in range(7)]
    return days[0], days


def build_blank_day_payload(date_str: str, entries: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "date": date_str,
        "updatedAt": "",
        "classifiedAt": "",
        "sourceHash": build_source_hash(entries),
        "hasLogs": bool(entries),
        "entryCount": len(entries),
        "summary": summary_from_cells([EMPTY_CATEGORY] * 24),
        "cells": [build_empty_cell(hour) for hour in range(24)],
        "classifiedEntries": [],
    }


def build_classified_day_payload(date_str: str, entries: list[dict[str, Any]], response_data: dict[str, Any]) -> dict[str, Any]:
    classifications = {
        str(item.get("id", "")): {
            "category": normalize_category(str(item.get("category", ""))),
            "reason": str(item.get("reason", "")).strip(),
        }
        for item in response_data.get("items", [])
    }

    cells: list[dict[str, Any]] = []
    classified_entries: list[dict[str, Any]] = []
    cell_categories: list[str] = []

    entries_by_hour: dict[int, list[dict[str, Any]]] = {hour: [] for hour in range(24)}
    for entry in entries:
        hour = int(entry["timestamp"][11:13])
        classification = classifications.get(entry["id"], {"category": "工作", "reason": ""})
        normalized_entry = {
            "id": entry["id"],
            "timestamp": entry["timestamp"],
            "hour": hour,
            "entry": entry["entry"],
            "category": classification["category"],
            "reason": classification["reason"],
        }
        classified_entries.append(normalized_entry)
        entries_by_hour[hour].append(normalized_entry)

    for hour in range(24):
        hour_entries = entries_by_hour[hour]
        if not hour_entries:
            cells.append(build_empty_cell(hour))
            cell_categories.append(EMPTY_CATEGORY)
            continue

        representative = hour_entries[-1]
        cell_categories.append(representative["category"])
        cells.append(
            {
                "hour": hour,
                "label": f"{hour:02d}",
                "category": representative["category"],
                "count": len(hour_entries),
                "entries": hour_entries,
                "title": build_cell_title(hour, representative["category"], hour_entries),
            }
        )

    now = datetime.now().isoformat(timespec="seconds")
    return {
        "date": date_str,
        "updatedAt": now,
        "classifiedAt": now,
        "sourceHash": build_source_hash(entries),
        "hasLogs": True,
        "entryCount": len(entries),
        "summary": summary_from_cells(cell_categories),
        "cells": cells,
        "classifiedEntries": classified_entries,
    }


def ensure_day_payload_shape(payload: dict[str, Any], date_str: str) -> dict[str, Any]:
    cells = payload.get("cells")
    if not isinstance(cells, list) or len(cells) != 24:
        return build_blank_day_payload(date_str, load_logs_for_day(date_str))
    payload["summary"] = payload.get("summary") or summary_from_cells([cell.get("category", EMPTY_CATEGORY) for cell in cells])
    payload["date"] = date_str
    payload["hasLogs"] = bool(payload.get("hasLogs"))
    payload["entryCount"] = int(payload.get("entryCount", 0))
    return payload


def request_classification(entries: list[dict[str, Any]], date_str: str, ai_config: dict[str, Any]) -> dict[str, Any]:
    api_key = str(ai_config.get("apiKey") or os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise ValueError("还没有配置 API Key。")

    base_url = canonicalize_base_url(str(ai_config.get("baseURL") or "https://api.openai.com/v1"))
    model = str(ai_config.get("model") or "gpt-5.2").strip() or "gpt-5.2"

    user_prompt = build_user_prompt(entries, date_str)
    responses_payload = {
        "model": model,
        "temperature": 0,
        "input": [
            {
                "role": "system",
                "content": (
                    "你是一个工作日志分类器。"
                    "你只能使用三个分类标签：学习、工作、娱乐。"
                    "请根据每条记录描述的主要意图和行为进行判断。"
                    "不要输出标签之外的类别。"
                ),
            },
            {"role": "user", "content": user_prompt},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "hourly_work_log_classification",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "day": {"type": "string"},
                        "items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "string"},
                                    "category": {"type": "string", "enum": list(CATEGORIES)},
                                    "reason": {"type": "string"},
                                },
                                "required": ["id", "category", "reason"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["day", "items"],
                    "additionalProperties": False,
                },
            }
        },
    }

    chat_payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是一个工作日志分类器。"
                    "你只能使用三个分类标签：学习、工作、娱乐。"
                    "请根据每条记录描述的主要意图和行为进行判断。"
                    "你必须返回 JSON 对象，字段为 day 和 items。"
                ),
            },
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
    }

    try:
        raw_response = post_json(f"{base_url}/responses", responses_payload, api_key)
        response_text = extract_response_text(raw_response)
    except ValueError as exc:
        if not should_try_chat_completions(exc, base_url):
            raise
        raw_response = post_json(f"{base_url}/chat/completions", chat_payload, api_key)
        response_text = extract_chat_completion_text(raw_response)

    if not response_text:
        raise ValueError("模型没有返回可解析的分类结果。")

    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"模型返回的数据不是合法 JSON：{exc}") from exc

    if not isinstance(parsed, dict):
        raise ValueError("模型返回的数据结构不正确。")

    parsed["day"] = str(parsed.get("day", date_str))
    items = parsed.get("items")
    if not isinstance(items, list):
        raise ValueError("模型返回结果缺少 items 数组。")
    parsed["items"] = items
    return parsed


def build_user_prompt(entries: list[dict[str, Any]], date_str: str) -> str:
    lines = [
        f"请把 {date_str} 这一天的工作记录分类到 学习 / 工作 / 娱乐 之一。",
        "输出 JSON，并且 items 里的 id 必须与输入完全一致。",
        "如果是看书、上课、练习、学习某项技能，归为 学习。",
        "如果是开发、开会、写文档、处理正式任务，归为 工作。",
        "如果是刷视频、聊天消遣、看剧、打游戏，归为 娱乐。",
        "",
        "记录列表：",
    ]

    for entry in entries:
        lines.append(f"- id={entry['id']} time={entry['timestamp']} text={entry['entry']}")
    return "\n".join(lines)


def post_json(url: str, payload: dict[str, Any], api_key: str) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with request.urlopen(req, timeout=60) as response:
            data = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(f"模型 API 请求失败：HTTP {exc.code} {detail}") from exc
    except error.URLError as exc:
        raise ValueError(f"模型 API 请求失败：{exc.reason}") from exc

    try:
        parsed = json.loads(data)
    except json.JSONDecodeError as exc:
        raise ValueError("模型 API 返回了无法解析的响应。") from exc

    if not isinstance(parsed, dict):
        raise ValueError("模型 API 返回了异常数据结构。")
    return parsed


def extract_response_text(payload: dict[str, Any]) -> str:
    direct_text = payload.get("output_text")
    if isinstance(direct_text, str) and direct_text.strip():
        return direct_text.strip()

    for output in payload.get("output", []):
        if not isinstance(output, dict):
            continue
        for content in output.get("content", []):
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()
            text_obj = content.get("output_text")
            if isinstance(text_obj, str) and text_obj.strip():
                return text_obj.strip()

    return ""


def extract_chat_completion_text(payload: dict[str, Any]) -> str:
    for choice in payload.get("choices", []):
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
    return ""


def canonicalize_base_url(base_url: str) -> str:
    normalized = base_url.strip().rstrip("/")
    if not normalized:
        return "https://api.openai.com/v1"

    if "open.bigmodel.cn" in normalized and "/api/paas/v4" not in normalized:
        return f"{normalized}/api/paas/v4"

    return normalized


def should_try_chat_completions(exc: ValueError, base_url: str) -> bool:
    message = str(exc)
    if "open.bigmodel.cn" in base_url:
        return True
    return "HTTP 404" in message or "HTTP 405" in message


def build_source_hash(entries: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for entry in entries:
        digest.update(entry.get("id", "").encode("utf-8"))
        digest.update(entry.get("timestamp", "").encode("utf-8"))
        digest.update(entry.get("entry", "").encode("utf-8"))
    return digest.hexdigest()


def normalize_category(value: str) -> str:
    if value in CATEGORIES:
        return value
    return "工作"


def build_empty_cell(hour: int) -> dict[str, Any]:
    return {
        "hour": hour,
        "label": f"{hour:02d}",
        "category": EMPTY_CATEGORY,
        "count": 0,
        "entries": [],
        "title": f"{hour:02d}:00 没有记录",
    }


def build_cell_title(hour: int, category: str, entries: list[dict[str, Any]]) -> str:
    previews = " | ".join(entry["entry"][:48].replace("\n", " ") for entry in entries)
    return f"{hour:02d}:00 {category} · {previews}"


def summary_from_cells(categories: list[str]) -> dict[str, int]:
    summary = {category: 0 for category in (*CATEGORIES, EMPTY_CATEGORY)}
    for category in categories:
        summary[category if category in summary else EMPTY_CATEGORY] += 1
    return summary
