#!/usr/bin/env bash
# status-sdl-mgr.sh - Script to show status of SDL Manager
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
  systemctl --user status sdl-wkr
else
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
fi