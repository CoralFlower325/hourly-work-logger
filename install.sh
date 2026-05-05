#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/Library/Application Support/HourlyWorkLogger"
AGENT_DIR="$HOME/Library/LaunchAgents"
PROMPT_PLIST_PATH="$AGENT_DIR/com.codex.hourly-work-logger.plist"
CONTROL_PLIST_PATH="$AGENT_DIR/com.codex.hourly-work-logger.control-panel.plist"
READING_GUARD_PLIST_PATH="$AGENT_DIR/com.codex.hourly-work-logger.reading-guard.plist"
TICK_SCRIPT_TARGET="$TARGET_DIR/hourly_tick.sh"
PROMPT_SCRIPT_TARGET="$TARGET_DIR/hourly_prompt.js"
CORE_SCRIPT_TARGET="$TARGET_DIR/logger_core.py"
ANALYTICS_SCRIPT_TARGET="$TARGET_DIR/analytics_core.py"
CONTROL_SCRIPT_TARGET="$TARGET_DIR/control_server.py"
READING_GUARD_SOURCE_TARGET="$TARGET_DIR/reading_guard.swift"
READING_GUARD_BINARY_TARGET="$TARGET_DIR/reading_guard"
INDEX_TARGET="$TARGET_DIR/index.html"
APP_JS_TARGET="$TARGET_DIR/app.js"
STYLE_TARGET="$TARGET_DIR/style.css"
SWIFT_MODULE_CACHE_DIR="$TARGET_DIR/swift-module-cache"

mkdir -p "$TARGET_DIR" "$AGENT_DIR"
mkdir -p "$SWIFT_MODULE_CACHE_DIR"
cp "$SCRIPT_DIR/hourly_tick.sh" "$TICK_SCRIPT_TARGET"
cp "$SCRIPT_DIR/hourly_prompt.js" "$PROMPT_SCRIPT_TARGET"
cp "$SCRIPT_DIR/logger_core.py" "$CORE_SCRIPT_TARGET"
cp "$SCRIPT_DIR/analytics_core.py" "$ANALYTICS_SCRIPT_TARGET"
cp "$SCRIPT_DIR/control_server.py" "$CONTROL_SCRIPT_TARGET"
cp "$SCRIPT_DIR/reading_guard.swift" "$READING_GUARD_SOURCE_TARGET"
cp "$SCRIPT_DIR/index.html" "$INDEX_TARGET"
cp "$SCRIPT_DIR/app.js" "$APP_JS_TARGET"
cp "$SCRIPT_DIR/style.css" "$STYLE_TARGET"
chmod +x "$TICK_SCRIPT_TARGET" "$CORE_SCRIPT_TARGET"
CLANG_MODULE_CACHE_PATH="$SWIFT_MODULE_CACHE_DIR" /usr/bin/swiftc "$READING_GUARD_SOURCE_TARGET" -o "$READING_GUARD_BINARY_TARGET"
chmod +x "$READING_GUARD_BINARY_TARGET"

/usr/bin/python3 "$CORE_SCRIPT_TARGET" status >/dev/null

cat > "$PROMPT_PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.codex.hourly-work-logger</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$TICK_SCRIPT_TARGET</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>StartInterval</key>
  <integer>60</integer>

  <key>StandardOutPath</key>
  <string>$TARGET_DIR/stdout.log</string>

  <key>StandardErrorPath</key>
  <string>$TARGET_DIR/stderr.log</string>
</dict>
</plist>
PLIST

cat > "$CONTROL_PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.codex.hourly-work-logger.control-panel</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$CONTROL_SCRIPT_TARGET</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$TARGET_DIR/control-panel.stdout.log</string>

  <key>StandardErrorPath</key>
  <string>$TARGET_DIR/control-panel.stderr.log</string>
</dict>
</plist>
PLIST

cat > "$READING_GUARD_PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.codex.hourly-work-logger.reading-guard</string>

  <key>ProgramArguments</key>
  <array>
    <string>$READING_GUARD_BINARY_TARGET</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$TARGET_DIR/reading-guard.stdout.log</string>

  <key>StandardErrorPath</key>
  <string>$TARGET_DIR/reading-guard.stderr.log</string>
</dict>
</plist>
PLIST

if launchctl print "gui/$(id -u)/com.codex.hourly-work-logger" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)" "$PROMPT_PLIST_PATH" >/dev/null 2>&1 || true
fi

if launchctl print "gui/$(id -u)/com.codex.hourly-work-logger.control-panel" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)" "$CONTROL_PLIST_PATH" >/dev/null 2>&1 || true
fi

if launchctl print "gui/$(id -u)/com.codex.hourly-work-logger.reading-guard" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)" "$READING_GUARD_PLIST_PATH" >/dev/null 2>&1 || true
fi

launchctl bootstrap "gui/$(id -u)" "$PROMPT_PLIST_PATH"
launchctl enable "gui/$(id -u)/com.codex.hourly-work-logger"
launchctl kickstart -k "gui/$(id -u)/com.codex.hourly-work-logger"
launchctl bootstrap "gui/$(id -u)" "$CONTROL_PLIST_PATH"
launchctl enable "gui/$(id -u)/com.codex.hourly-work-logger.control-panel"
launchctl kickstart -k "gui/$(id -u)/com.codex.hourly-work-logger.control-panel"
launchctl bootstrap "gui/$(id -u)" "$READING_GUARD_PLIST_PATH"
launchctl enable "gui/$(id -u)/com.codex.hourly-work-logger.reading-guard"
launchctl kickstart -k "gui/$(id -u)/com.codex.hourly-work-logger.reading-guard"

echo "Installed Hourly Work Logger."
echo "Tick script: $TICK_SCRIPT_TARGET"
echo "Prompt LaunchAgent: $PROMPT_PLIST_PATH"
echo "Control panel LaunchAgent: $CONTROL_PLIST_PATH"
echo "Reading guard LaunchAgent: $READING_GUARD_PLIST_PATH"
echo "Control panel URL: http://127.0.0.1:4173"
