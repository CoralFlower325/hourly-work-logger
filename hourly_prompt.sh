#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/Library/Application Support/HourlyWorkLogger"
LOG_FILE="$APP_DIR/hourly-log.csv"
PROMPT_SCRIPT_FILE="$SCRIPT_DIR/hourly_prompt.js"
mkdir -p "$APP_DIR"

if [[ ! -f "$LOG_FILE" ]]; then
  printf 'timestamp,entry\n' > "$LOG_FILE"
fi

escape_for_csv() {
  local value="$1"
  value="${value//\"/\"\"}"
  printf '"%s"' "$value"
}

ENTRY=$(/usr/bin/osascript -l JavaScript "$PROMPT_SCRIPT_FILE")

TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
printf '%s,%s\n' "$(escape_for_csv "$TIMESTAMP")" "$(escape_for_csv "$ENTRY")" >> "$LOG_FILE"
