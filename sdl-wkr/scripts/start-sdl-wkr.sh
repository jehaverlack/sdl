#!/usr/bin/env bash
# start-sdl-wkr.sh - Script to start SDL Worker
set -euo pipefail

# Get $SDL_HOME directory from SCRIPT PATH
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDL_HOME="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_BIN_DIR="${SDL_HOME}/nodejs/current/bin"
NODE_BIN="${NODE_BIN_DIR}/node"
NPM_BIN="${NODE_BIN_DIR}/npm"

SDL_WKR_APP_DIR="${SDL_HOME}/sdl-wkr/current/app"

# Check that sdl-wkr is not already running
SDL_WKR_PID=""
for pid in $(pgrep -f 'node' 2>/dev/null || true); do
  cwd=$(readlink /proc/$pid/cwd 2>/dev/null || true)
  if [[ "$cwd" == *"sdl-wkr"* ]]; then
    SDL_WKR_PID="$pid"
    break
  fi
done

if [[ -n "$SDL_WKR_PID" ]]; then
    echo "ERROR: SDL Worker is already running with PID ${SDL_WKR_PID}"
    echo "       Stop it first: kill ${SDL_WKR_PID}"
    exit 1
fi

# Verify paths exist
if [[ ! -f "$NODE_BIN" ]]; then
  echo "ERROR: Node.js not found at: $NODE_BIN"
  echo "       Run install-sdl.sh first"
  exit 1
fi

if [[ ! -d "$SDL_WKR_APP_DIR" ]]; then
  echo "ERROR: SDL Worker app not found at: $SDL_WKR_APP_DIR"
  exit 1
fi

echo "Starting SDL Worker..."
echo "  App Dir: ${SDL_WKR_APP_DIR}"
echo "  Node:    ${NODE_BIN}"

export PATH="${NODE_BIN_DIR}:${PATH}"
cd "${SDL_WKR_APP_DIR}"

# Start in foreground (use nohup or systemd for background)
exec "${NPM_BIN}" start