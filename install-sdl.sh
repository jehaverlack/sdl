#!/usr/bin/env bash
# install-sdl.sh - SDL Installer Script
set -euo pipefail

# ------------------------------------------------------------
# Functions
# ------------------------------------------------------------

resolve_dirs() {
  local json="$1"
  declare -A raw resolved

  while IFS='=' read -r key val; do
    raw["$key"]="$val"
  done < <(jq -r '.DIRS | to_entries[] | "\(.key)=\(.value)"' "$json")

  if [[ -z "${raw[SDL_HOME]:-}" ]]; then
    echo "ERROR: DIRS.SDL_HOME is not defined in config.json"
    exit 1
  fi

  resolved["SDL_HOME"]="${raw[SDL_HOME]/#\~/$HOME}"

  local changed=true
  while $changed; do
    changed=false
    for key in "${!raw[@]}"; do
      [[ -n "${resolved[$key]:-}" ]] && continue

      local val="${raw[$key]}"
      for rkey in "${!resolved[@]}"; do
        val="${val/$rkey/${resolved[$rkey]:-}}"
      done

      if [[ "$val" != *SDL_* ]]; then
        resolved["$key"]="$val"
        changed=true
      fi
    done
  done

  for key in "${!raw[@]}"; do
    [[ -z "${resolved[$key]:-}" ]] && {
      echo "ERROR: Unresolved DIR: $key=${raw[$key]}"
      exit 1
    }
  done

  for key in "${!resolved[@]}"; do
    export "$key=${resolved[$key]}"
    printf "  %-12s %s\n" "$key:" "${resolved[$key]}"
    mkdir -p "${resolved[$key]}"
  done
}


# ------------------------------------------------------------
# Main
# ------------------------------------------------------------

# ------------------------------------------------------------
# Require non root user
# ------------------------------------------------------------
if [[ $EUID -eq 0 ]]; then
  echo "ERROR: install-sdl.sh must be run as a non-root user"
  exit 1
fi

# ------------------------------------------------------------
# Requirements
# ------------------------------------------------------------
for cmd in awk curl grep jq sed sha256sum tar unzip; do
  command -v "$cmd" >/dev/null || {
    echo "ERROR: $cmd is required"
    exit 1
  }
done

# ------------------------------------------------------------
# Resolve SDL_ROOT
# ------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDL_ROOT="$(cd "$SCRIPT_DIR" && pwd)"

CONFIG_FILE="$SDL_ROOT/config.json"
META_FILE="$SDL_ROOT/metadata.json"

[[ -f "$CONFIG_FILE" ]] || { echo "ERROR: config.json not found"; exit 1; }
[[ -f "$META_FILE" ]]   || { echo "ERROR: metadata.json not found"; exit 1; }

# ------------------------------------------------------------
# Hostname detection
# ------------------------------------------------------------
HOSTNAME="$(hostname)"

# ------------------------------------------------------------
# OS / platform detection
# ------------------------------------------------------------
OS_ID="unknown"
OS_LIKE=""
OS_NAME=""
OS_VERSION=""
OS_FAMILY="unknown"
OS_ARCH="unknown"
OS_PLATFORM="unknown"

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_LIKE="${ID_LIKE:-}"
  OS_NAME="${NAME:-unknown}"
  OS_VERSION="${VERSION_ID:-}"
fi

case "$OS_ID" in
  debian|ubuntu|raspbian|zorin)
    OS_FAMILY="debian"
    OS_PLATFORM="linux"
    ;;
  rhel|rocky|almalinux|centos|fedora)
    OS_FAMILY="rhel"
    OS_PLATFORM="linux"
    ;;
  *)
    if [[ "$OS_LIKE" == *debian* ]]; then
      OS_FAMILY="debian"
    elif [[ "$OS_LIKE" == *rhel* ]]; then
      OS_FAMILY="rhel"
    fi
    ;;
esac

# ------------------------------------------------------------
# CPU architecture detection
# ------------------------------------------------------------
ARCH_RAW="$(uname -m)"

case "$ARCH_RAW" in
  x86_64) OS_ARCH="x64" ;;
  aarch64|arm64) OS_ARCH="arm64" ;;
  armv7l) OS_ARCH="armv7l" ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH_RAW"
    exit 1
    ;;
esac

SDL_PLATFORM="${OS_FAMILY}:${OS_ARCH}"


# ------------------------------------------------------------
# SELinux detection (warn-only)
# ------------------------------------------------------------
SELINUX_MODE="disabled"

if command -v getenforce >/dev/null 2>&1; then
  SELINUX_MODE="$(getenforce | tr '[:upper:]' '[:lower:]')"
fi


# ------------------------------------------------------------
# systemd user service check
# ------------------------------------------------------------
if ! systemctl --user status >/dev/null 2>&1; then
  echo "ERROR: systemd user services are not available"
  echo "       SDL requires systemd --user support"
  exit 1
fi

SDL_VERSION="$(jq -r '.METADATA.version' "$META_FILE")"
SDL_VERSION_DATE="$(jq -r '.METADATA.version_date' "$META_FILE")"
SDL_COPYRIGHT="$(jq -r '.METADATA.copyright' "$META_FILE")"
SDL_AUTHOR="$(jq -r '.METADATA.author' "$META_FILE")"
SDL_LICENSE="$(jq -r '.METADATA.license' "$META_FILE")"
SDL_HOMEPAGE="$(jq -r '.METADATA.homepage' "$META_FILE")"
SDL_REPO="$(jq -r '.METADATA.git_repo' "$META_FILE")"


# ------------------------------------------------------------
# NodeJS detection
# ------------------------------------------------------------
NODE_VERSION="$(jq -r '.NODEJS.VERSION' "$CONFIG_FILE")"
NODE_PLATFORMS="$(jq -r '.NODEJS.TARGETS[]' "$CONFIG_FILE" | tr '\n' ' ')"
NODE_PLATFORMS="${NODE_PLATFORMS%% }"


echo "####################################"
echo "Software Defined Laboratory (SDL)"
echo "####################################"
echo "  Version:      $SDL_VERSION"
echo "  Version Date: $SDL_VERSION_DATE"
echo "  Copyright:    (C) $SDL_COPYRIGHT"
echo "  Author:       $SDL_AUTHOR"
echo "  License:      $SDL_LICENSE"
echo "  Homepage:     $SDL_HOMEPAGE"
echo "  Repository:   $SDL_REPO"
echo ""

echo "NodeJS:"
echo "  Version:      $NODE_VERSION"
echo "  Platforms:   " 
for np in $NODE_PLATFORMS; do
  echo "    $np"
done
echo ""

echo "Target System:"
echo "  Hostname:  $HOSTNAME"
echo "  OS:        $OS_NAME $OS_VERSION"
echo "  Family:    $OS_FAMILY"
echo "  Platform:  $OS_PLATFORM"
echo "  Arch:      $OS_ARCH"
echo "  systemd:   user services available"
echo "  SELinux:   $SELINUX_MODE"
echo ""

if [[ "$OS_PLATFORM" == "win32" ]]; then
  echo "ERROR: win32 host install not supported by this installer"
  exit 1
fi

echo "Directories:"
echo "  SDL_ROOT:    $SDL_ROOT"
resolve_dirs "$CONFIG_FILE"


# ------------------------------------------------------------
# Build sdl-mgr tarball to SDL_DIST
# Always rebuild sdl-mgr_version.tgz from source
# ------------------------------------------------------------
echo ""
echo "Generating: $SDL_DIST/sdl-mgr_$SDL_VERSION.tgz"
tar -czf "$SDL_DIST/sdl-mgr_$SDL_VERSION.tgz" -C "$SDL_ROOT" sdl-mgr
sha256sum "$SDL_DIST/sdl-mgr_$SDL_VERSION.tgz"  | awk '{sub(".*/","",$2); print}' > "$SDL_DIST/sdl-mgr_$SDL_VERSION.tgz.sha256"

# ------------------------------------------------------------
# Build sdl-wkr tarball to SDL_DIST
# Always rebuild sdl-wkr_version.tgz from source
# ------------------------------------------------------------
echo ""
echo "Generating: $SDL_DIST/sdl-wkr_$SDL_VERSION.tgz"
tar -czf "$SDL_DIST/sdl-wkr_$SDL_VERSION.tgz" -C "$SDL_ROOT" sdl-wkr
sha256sum "$SDL_DIST/sdl-wkr_$SDL_VERSION.tgz"  | awk '{sub(".*/","",$2); print}' > "$SDL_DIST/sdl-wkr_$SDL_VERSION.tgz.sha256"

# ------------------------------------------------------------
# Copy install-sdl-wkr.sh to SDL_DIST
# ------------------------------------------------------------
echo ""
echo "Copying: $SDL_DIST/install-sdl-wkr.sh"
cp "$SDL_ROOT/sdl-wkr/scripts/install-sdl-wkr.sh" "$SDL_DIST/install-sdl-wkr.sh"
sha256sum "$SDL_DIST/install-sdl-wkr.sh" | awk '{sub(".*/","",$2); print}' > "$SDL_DIST/install-sdl-wkr.sh.sha256"

# ------------------------------------------------------------
# Fetch NodeJS Tarballs / Zips to SDL_DIST
# ------------------------------------------------------------
echo ""
echo "Fetching NodeJS Binaries to $SDL_DIST"
SHASUM_URL="https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
curl -sSL "$SHASUM_URL" -o "$SDL_DIST/NODE_SHASUMS256.txt"

# Download NodeJS tarball

for np in $NODE_PLATFORMS; do
  IFS=":" read -r OS ARCH <<< "$np"

  case "$OS" in
    linux)   EXT="tar.xz" ;;
    darwin)  EXT="tar.gz" ;;
    win)   EXT="zip" ;;
    *) echo "ERROR: Unknown NodeJS target OS: $OS"; exit 1 ;;
  esac

  PLATFORM="${OS}-${ARCH}"
  NODE_DIR="node-v${NODE_VERSION}-${PLATFORM}"
  NODE_TARBALL="${NODE_DIR}.$EXT"
  NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"

  echo "  $np: $NODE_TARBALL"

  if [ ! -e "$SDL_DIST/$NODE_TARBALL" ]; then

    curl -sSL "$NODE_URL" -o "$SDL_DIST/$NODE_TARBALL"

    EXPECTED_SHA="$(grep " $NODE_TARBALL\$" "$SDL_DIST/NODE_SHASUMS256.txt" | awk '{print $1}')"

    if [[ -z "$EXPECTED_SHA" ]]; then
        echo "Error: SHA256 not found for $NODE_TARBALL"
        exit 1
    fi

    ACTUAL_SHA="$(sha256sum "$SDL_DIST/$NODE_TARBALL" | awk '{print $1}')"

    if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
        echo "SHA mismatch $NODE_TARBALL"
        rm -f "$SDL_DIST/$NODE_TARBALL"
        exit 1
    fi

    echo "$EXPECTED_SHA  $NODE_TARBALL" > "$SDL_DIST/$NODE_TARBALL.sha256"
  fi
done

unset OS ARCH


# ------------------------------------------------------------
# Extract sdl-mgr-VERSION tarball from SDL_DIST to SDL_MGR
# Symlink to SDL_MGR/current
# ------------------------------------------------------------
echo ""
echo "Extracting: $SDL_DIST/sdl-mgr_$SDL_VERSION.tgz to $SDL_MGR/sdl-mgr_$SDL_VERSION"
rm -rf "$SDL_MGR/sdl-mgr_$SDL_VERSION"
tar -xzf "$SDL_DIST/sdl-mgr_$SDL_VERSION.tgz" -C "$SDL_MGR"
mv "$SDL_MGR/sdl-mgr" "$SDL_MGR/sdl-mgr_$SDL_VERSION"
# rm "$SDL_MGR/current"
ln -sfn "$SDL_MGR/sdl-mgr_$SDL_VERSION" "$SDL_MGR/current"

# ------------------------------------------------------------
# Copy SDL_MGR/current/conf/efault-sdl-mgr-config.json to SDL_CONF/sdl-mgr-config.json
# ------------------------------------------------------------

if [ ! -e "$SDL_CONF/sdl-mgr-config.json" ]; then
    echo ""
    echo "Copying: $SDL_MGR/current/conf/default-sdl-mgr-config.json to $SDL_CONF/sdl-mgr-config.json"
    cp "$SDL_MGR/current/conf/default-sdl-mgr-config.json" "$SDL_CONF/sdl-mgr-config.json"
fi

# ------------------------------------------------------------
# Extract NodeJS tarball from SDL_DIST to SDL_NODEJS
# Symlink to SDL_NODEJS/current
# ------------------------------------------------------------

# Check if NodeJS is already installed
NODE_BIN="$SDL_NODEJS/current/bin/node"
NPM_BIN="$SDL_NODEJS/current/bin/npm"
# echo "NodeJS binary: $NODE_BIN"

if [ -e "$NODE_BIN" ]; then
    NODE_BIN_VERSION="$("$NODE_BIN" --version)"
    # echo "NodeJS bin version: $NODE_BIN_VERSION"
    # echo "NodeJS version: v$NODE_VERSION"
    case "$OS_PLATFORM" in
      linux)  EXT="tar.xz"; TAR_OPTS="-xJf" ;;
      darwin) EXT="tar.gz"; TAR_OPTS="-xzf" ;;
      win)  EXT="zip" ;;
      *) echo "ERROR: Unsupported OS platform: $OS_PLATFORM"; exit 1 ;;
    esac

    if [ "$NODE_BIN_VERSION" != "v$NODE_VERSION" ]; then
        echo ""
        echo "Installing NodeJS: node-v${NODE_VERSION}-${OS_PLATFORM}-${OS_ARCH}"
    
        echo "Extracting: $SDL_DIST/node-v${NODE_VERSION}-${OS_PLATFORM}-${OS_ARCH}.$EXT"
        if [ $OS_PLATFORM == "win32" ]; then
          echo "ERROR: win32 host install not supported by this installer"
          exit 1
          # unzip "$SDL_DIST/node-v${NODE_VERSION}-${OS_PLATFORM}-${OS_ARCH}.$EXT" -d "$SDL_NODEJS"
        else 
          tar $TAR_OPTS "$SDL_DIST/node-v${NODE_VERSION}-${OS_PLATFORM}-${OS_ARCH}.$EXT" -C "$SDL_NODEJS"
        fi
        # rm "$SDL_NODEJS/current"
        ln -sfn "$SDL_NODEJS/node-v${NODE_VERSION}-${OS_PLATFORM}-${OS_ARCH}" "$SDL_NODEJS/current"
    else
        echo ""
        echo "NodeJS $OS_PLATFORM-$OS_ARCH v$NODE_VERSION already installed"
    fi
else
    echo ""
    echo "Installing NodeJS $NODE_VERSION"
    
    echo "Extracting: $SDL_DIST/node-v${NODE_VERSION}-${OS_PLATFORM}-${OS_ARCH}.tar.xz"
    tar -xJf "$SDL_DIST/node-v${NODE_VERSION}-${OS_PLATFORM}-${OS_ARCH}.tar.xz" -C "$SDL_NODEJS"
    ln -sfn "$SDL_NODEJS/node-v${NODE_VERSION}-${OS_PLATFORM}-${OS_ARCH}" "$SDL_NODEJS/current"
fi


# ------------------------------------------------------------
# Install sdl-mgr Node Dependencies
# ------------------------------------------------------------
echo ""
echo "Installing NodeJS Dependencies"
cd "$SDL_MGR/current/app"
export PATH="$SDL_NODEJS/current/bin:$PATH"
$NPM_BIN install

# ------------------------------------------------------------
# Install Systemd Unit Files
# Copy SDL_MGR/current/scripts/sdl-mgr.service to ~/.config/systemd/user
# ------------------------------------------------------------
echo ""
echo "Installing SystemD Unit Files"

mkdir -p ~/.config/systemd/user
cp "$SDL_MGR/current/scripts/sdl-mgr.service" ~/.config/systemd/user/

systemctl --user daemon-reload --no-pager
systemctl --user restart sdl-mgr --no-pager
sleep 3
systemctl --user status sdl-mgr --no-pager

echo ""
echo "SDL Manager deployed:"
echo "  to: $SDL_HOME"

echo "SDL Controls:"
echo "  systemctl --user status sdl-mgr"
echo "  systemctl --user start sdl-mgr"
echo "  systemctl --user stop sdl-mgr"

echo ""
echo "Removal Commands:"
echo "  WARNING: Backup data directory first!!!!"
echo "  systemctl --user disable sdl-mgr"
echo "  rm -rf $SDL_HOME"