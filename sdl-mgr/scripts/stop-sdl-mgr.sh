#!/usr/bin/env bash
# stop-sdl-mgr.sh - Script to stop SDL Manager
set -euo pipefail

use_systemd() {
  # Check if systemd user mode is available and service exists
  if systemctl --user status >/dev/null 2>&1; then
    # Check if our service file exists
    if systemctl --user list-unit-files | grep -q "^sdl-mgr.service"; then
      return 0  # Use systemd
    fi
  fi
  return 1  # Use manual scripts
}

if use_systemd; then
  # Systemd mode - let systemd handle it
  echo "Stopping SDL Manager (systemd)..."
  systemctl --user stop sdl-mgr --quiet 2>/dev/null || true
  echo "SDL Manager stopped"
  exit 0
fi

# Manual mode - find and kill process
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

echo "Stopping SDL Manager (PID: ${SDL_MGR_PID})..."

# Send SIGTERM for graceful shutdown
kill "$SDL_MGR_PID"

# Wait up to 10 seconds for process to exit
for i in {1..10}; do
  if ! kill -0 "$SDL_MGR_PID" 2>/dev/null; then
    echo "SDL Manager stopped successfully"
    exit 0
  fi
  sleep 1
done

# If still running after 10 seconds, force kill
if kill -0 "$SDL_MGR_PID" 2>/dev/null; then
  echo "WARNING: Graceful shutdown failed, forcing kill..."
  kill -9 "$SDL_MGR_PID"
  sleep 1
  
  if kill -0 "$SDL_MGR_PID" 2>/dev/null; then
    echo "ERROR: Failed to stop SDL Manager"
    exit 1
  fi
fi

echo "SDL Manager stopped"