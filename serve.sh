#!/bin/zsh

set -euo pipefail

cd "$(dirname "$0")"
python3 control_server.py
