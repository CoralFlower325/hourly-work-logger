# Hourly Work Logger

Hourly Work Logger is a macOS productivity tool that combines:

- a background system prompt that appears on a schedule
- a local web control panel for settings and history

It is designed for people who want a simple way to record what they worked on every hour and create a lightweight accountability loop during the workday.

## Features

- Scheduled macOS system dialogs
- Required text input before closing the prompt
- Configurable active hours
- Hourly mode or fixed-interval mode
- Local web UI for editing settings
- History view grouped by day
- Markdown export for selected dates
- Local CSV log storage

## How It Works

The app has two parts:

- A `launchd` background job that checks every minute whether a prompt should appear
- A local web control panel for changing settings, triggering prompts manually, and reviewing saved entries

The actual reminder is a native macOS dialog shown through `osascript`, not a browser popup.

## Requirements

- macOS
- Python 3
- Permission to run user `LaunchAgents`
- Permission for system automation dialogs if macOS asks

## Installation

1. Clone the repository:

```bash
git clone https://github.com/mulyawardani-lang/hourly-work-logger.git
cd hourly-work-logger
```

2. Install the background prompt:

```bash
zsh install.sh
```

3. The installer also starts a local web control panel as a background service.

Open it in your browser any time:

```text
http://127.0.0.1:4173
```

4. If you want to start the control panel manually for debugging:

```bash
zsh serve.sh
```

## Usage

In the web control panel you can:

- enable or pause reminders
- choose hourly or interval-based prompting
- set start and end working hours
- change the dialog title and prompt text
- trigger a prompt immediately
- search past entries
- export entries as Markdown for a selected date range

## Data Storage

The app stores its local data here:

```text
~/Library/Application Support/HourlyWorkLogger
```

Important files:

- `config.json` for settings
- `state.json` for background state
- `hourly-log.csv` for saved entries

## Project Files

- `install.sh` installs and reloads the macOS `LaunchAgent`
- `serve.sh` starts the local web control panel manually
- `logger_core.py` contains scheduling, logging, and prompt logic
- `control_server.py` serves the control panel API
- `hourly_prompt.js` shows the native macOS dialog

## Notes

- This project is built for macOS only
- It is a strong reminder tool, not a system-wide device lock
- iPhone or iPad cannot enforce the same behavior at the system level
