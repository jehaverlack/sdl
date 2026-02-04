#!/usr/bin/env bash
# stop-sdl-wkr.sh - Script to stop SDL Worker
set -euo pipefail

# Get sdl-wkr PID
SDL_WKR_PID=""
for pid in $(pgrep -f 'node' 2>/dev/null || true); do
  cwd=$(readlink /proc/$pid/cwd 2>/dev/null || true)
  if [[ "$cwd" == *"sdl-wkr"* ]]; then
    SDL_WKR_PID="$pid"
    break
  fi
done

if [[ -z "$SDL_WKR_PID" ]]; then
    echo "SDL Worker is not running"
    exit 0
fi

echo "Stopping SDL Worker (PID: ${SDL_WKR_PID})..."

# Send SIGTERM for graceful shutdown
kill "$SDL_WKR_PID"

# Wait up to 10 seconds for process to exit
for i in {1..10}; do
  if ! kill -0 "$SDL_WKR_PID" 2>/dev/null; then
    echo "SDL Worker stopped successfully"
    exit 0
  fi
  sleep 1
done

# If still running after 10 seconds, force kill
if kill -0 "$SDL_WKR_PID" 2>/dev/null; then
  echo "WARNING: Graceful shutdown failed, forcing kill..."
  kill -9 "$SDL_WKR_PID"
  sleep 1
  
  if kill -0 "$SDL_WKR_PID" 2>/dev/null; then
    echo "ERROR: Failed to stop SDL Worker"
    exit 1
  fi
fi

echo "SDL Worker stopped"