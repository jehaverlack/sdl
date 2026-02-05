#!/usr/bin/env bash
# start-sdl-mgr.sh - Script to start SDL Manager
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

# Get $SDL_HOME directory from SCRIPT PATH
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDL_HOME="$(cd "$SCRIPT_DIR/.." && pwd)"

if use_systemd; then
  # Systemd mode - let systemd handle it
  echo "Starting SDL Manager (systemd)..."
  systemctl --user start sdl-mgr
  exit 0
fi

# Manual mode - continue with checks
NODE_BIN_DIR="${SDL_HOME}/nodejs/current/bin"
NODE_BIN="${NODE_BIN_DIR}/node"
NPM_BIN="${NODE_BIN_DIR}/npm"

SDL_MGR_APP_DIR="${SDL_HOME}/sdl-mgr/current/app"

# Check that sdl-mgr is not already running
SDL_MGR_PID=""
for pid in $(pgrep -f 'node' 2>/dev/null || true); do
  cwd=$(readlink /proc/$pid/cwd 2>/dev/null || true)
  if [[ "$cwd" == *"sdl-mgr"* ]]; then
    SDL_MGR_PID="$pid"
    break
  fi
done

if [[ -n "$SDL_MGR_PID" ]]; then
    echo "ERROR: SDL Manager is already running with PID ${SDL_MGR_PID}"
    echo "       Stop it first: ${SDL_HOME}/scripts/stop-sdl-mgr.sh"
    exit 1
fi

# Verify paths exist
if [[ ! -f "$NODE_BIN" ]]; then
  echo "ERROR: Node.js not found at: $NODE_BIN"
  echo "       Run install-sdl.sh first"
  exit 1
fi

if [[ ! -d "$SDL_MGR_APP_DIR" ]]; then
  echo "ERROR: SDL Manager app not found at: $SDL_MGR_APP_DIR"
  echo "       Run install-sdl.sh first"
  exit 1
fi

echo "Starting SDL Manager..."
echo "  App Dir: ${SDL_MGR_APP_DIR}"
echo "  Node: