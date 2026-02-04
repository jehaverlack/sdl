#!/usr/bin/env bash
# status-sdl-mgr.sh - Script to show status of SDL Manager
set -euo pipefail

# Get sdl-mgr PID
SDL_MGR_PID=""
for pid in $(pgrep -f 'node' 2>/dev/null || true); do
  cwd=$(readlink /proc/$pid/cwd 2>/dev/null || true)
  if [[ "$cwd" == *"sdl-mgr"* ]]; then
    SDL_MGR_PID="$pid"
    break
  fi
done

if [[ -z "$SDL_MGR_PID" ]]; then
    echo "SDL Manager is not running"
    exit 0
fi

echo "SDL Manager is running with PID: ${SDL_MGR_PID}"
exit 0