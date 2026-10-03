#!/usr/bin/env bash
set -euo pipefail
exec python3 "$(dirname "$0")/environment_stand.py" provision "$@"
