#!/usr/bin/env bash
# install-sdl-wkr.sh - Script to install SDL Worker
# Usage: curl -s http://<SDL_MGR_IP>:8081/dist/install-sdl-wkr.sh | bash -s <SDL_MGR_IP>
set -euo pipefail

# ------------------------------------------------------------
# Functions
# ------------------------------------------------------------

install_nodejs() {
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

    # case "$OS_PLATFORM" in
    #   linux)  NODE_PLATFORM="linux" ;;
    #   darwin) NODE_PLATFORM="darwin" ;;
    #   win)    NODE_PLATFORM="win" ;;
    #   *)
    #     echo "ERROR: Unsupported platform for NodeJS"
    #     exit 1
    #     ;;
    # esac

    case "$OS_PLATFORM" in
        linux)   EXT="tar.xz" ;;
        darwin)  EXT="tar.gz" ;;
        win)   EXT="zip" ;;
        *) echo "ERROR: Unknown NodeJS target OS: $OS_ID"; exit 1 ;;
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


    NODE_VER=$(curl -s http://${SDL_MGR_IP}:8081/api/config | jq -r '.nodejs.version')
    NODE_DIR="${SDL_HOME}/nodejs"
    NODE_VER_BASE="node-${NODE_VER}-${OS_PLATFORM}-${OS_ARCH}"
    NODE_FILE="node-${NODE_VER}-${OS_PLATFORM}-${OS_ARCH}.${EXT}"
    # NODE_VER_BASE="node-${NODE_VER}-${NODE_PLATFORM}-${OS_ARCH}"
    # NODE_FILE="${NODE_VER_BASE}.${EXT}"
    NODE_URL="http://${SDL_MGR_IP}:8081/dist/${NODE_FILE}"

    
    #echo "NodeJS Version: ${NODE_VER}"
    #echo "NodeJS URL: ${NODE_URL}"

    mkdir -p "${NODE_DIR}"
    curl -sSL --fail "${NODE_URL}" -o "${TMP_DIR}/${NODE_FILE}" || { echo "Failed to download Node.js"; exit 1; }
    # test Checksum
    curl -sSL --fail "${NODE_URL}.sha256" -o "${TMP_DIR}/${NODE_FILE}.sha256" || { echo "Failed to download Node.js SHA256"; exit 1; }
    cd "${TMP_DIR}"
    sha256sum -c "${NODE_FILE}.sha256"
    if [ $? -ne 0 ]; then
      echo "SHA256 checksum verification failed."
      exit 1
    fi

    if ([ "${EXT}" == "zip" ]); then
      unzip "${TMP_DIR}/${NODE_FILE}" -d "${NODE_DIR}"
    elif ([ "${EXT}" == "tar.xz" ] || [ "${EXT}" == "tar.xz" ]); then
      tar -xJf "${TMP_DIR}/${NODE_FILE}" -C "${NODE_DIR}"
    elif ([ "${EXT}" == "tar.gz" ] || [ "${EXT}" == "tar.xz" ]); then
      tar -xzf "${TMP_DIR}/${NODE_FILE}" -C "${NODE_DIR}"
    fi
    # tar -xzf "${TMP_DIR}/${NODE_FILE}" -C "${NODE_DIR}"
    rm -f "${TMP_DIR}/${NODE_FILE}"
    ln -sfn "${NODE_DIR}/${NODE_VER_BASE}" "${NODE_DIR}/current"
}

# ------------------------------------------------------------
# Require non root user
# ------------------------------------------------------------
if [[ $EUID -eq 0 ]]; then
  echo "ERROR: install-sdl-wkr.sh must be run as a non-root user"
  exit 1
fi

# ------------------------------------------------------------
# Requirements
# ------------------------------------------------------------
for cmd in awk curl grep jq sed sha256sum tar unzip; do
  command -v "$cmd" >/dev/null || {
    echo "ERROR: $cmd is required"
    echo "Please install:"
    echo "   sudo apt -y install gawk coreutils curl jq grep sed sha256sum tar unzip"
    exit 1
  }
done

# Check if SDL-MGR IP is provided as an argument
if [ -z "$1" ]; then
  echo "Usage: $0 <SDL_MGR_IP>"
  exit 1
fi

SDL_MGR_IP=$1

SDL_HOME=$(curl -s http://${SDL_MGR_IP}:8081/api/config | jq -r '.dirs.sdlhome')

SDL_VER=$(curl -s http://${SDL_MGR_IP}:8081/api/config | jq -r '.package.version')
SDL_DESC=$(curl -s http://${SDL_MGR_IP}:8081/api/config | jq -r '.package.description')
SDL_ABBR=$(curl -s http://${SDL_MGR_IP}:8081/api/config | jq -r '.package.abbr')
SDL_COPYRT=$(curl -s http://${SDL_MGR_IP}:8081/api/config | jq -r '.package.copyright') 

echo "###############################################"
echo "${SDL_DESC} (${SDL_ABBR})"
echo "Version: ${SDL_VER}"
echo "Copyright: (C) ${SDL_COPYRT}"
echo "Installing SDL Worker..."
echo "  to: ${SDL_HOME}"
echo ""


TMP_DIR="${SDL_HOME}/tmp"
SDL_WKR_DIR="${SDL_HOME}/sdl-wkr"
SDL_WKR_VERSION=$(curl -s http://${SDL_MGR_IP}:8081/api/config | jq -r '.package.version')
SDL_WKR_TGZ="sdl-wkr_${SDL_WKR_VERSION}.tgz"
SDL_CONF_DIR="${SDL_HOME}/conf"
SLD_LOGS_DIR="${SDL_HOME}/logs"


# ------------------------------------------------------------
# Create Directories
# ------------------------------------------------------------
mkdir -p "${SDL_HOME}"
mkdir -p "${SDL_CONF_DIR}"
mkdir -p "${SLD_LOGS_DIR}"
mkdir -p "${SDL_WKR_DIR}"
mkdir -p "${TMP_DIR}"


# Download the latest sdl-wkr version to TMP_DIR
WKR_TGZ_URL="http://${SDL_MGR_IP}:8081/dist/${SDL_WKR_TGZ}"
WKR_TGZ_SHA256_URL="http://${SDL_MGR_IP}:8081/dist/${SDL_WKR_TGZ}.sha256"

curl -sSL --fail "${WKR_TGZ_URL}" -o "${TMP_DIR}/${SDL_WKR_TGZ}" || { echo "Failed to download sdl-wkr"; exit 1; }
curl -sSL --fail "${WKR_TGZ_SHA256_URL}" -o "${TMP_DIR}/${SDL_WKR_TGZ}.sha256" || { echo "Failed to download sdl-wkr SHA256"; exit 1; }

# Verify the SHA256 checksum
cd "${TMP_DIR}"
sha256sum --quiet -c "${TMP_DIR}/${SDL_WKR_TGZ}.sha256"
if [ $? -ne 0 ]; then
  echo "SHA256 checksum verification failed."
  exit 1
fi

cd "${SDL_HOME}"

# Extract and move to versioned directory
VERSIONED_DIR="${SDL_WKR_DIR}/sdl-wkr_${SDL_WKR_VERSION}"
rm -rf "${VERSIONED_DIR}"
tar -xzf "${TMP_DIR}/${SDL_WKR_TGZ}" -C "${SDL_WKR_DIR}"
mv "${SDL_WKR_DIR}/sdl-wkr" "${VERSIONED_DIR}"

# Create a symlink for the current version
if [ -d "${SDL_WKR_DIR}/current" ]; then
  rm -rf "${SDL_WKR_DIR}/current"
fi
ln -sfn "${VERSIONED_DIR}" "${SDL_WKR_DIR}/current"

# Copy initial configuration files
if [ ! -e "${SDL_HOME}/conf/sdl-wkr-config.json" ]; then
  cp "${SDL_WKR_DIR}/current/conf/default-sdl-wkr-config.json" "${SDL_HOME}/conf/sdl-wkr-config.json"
fi
mkdir -p ~/.config/systemd/user
cp "$SDL_WKR_DIR/current/scripts/sdl-wkr.service" ~/.config/systemd/user/


# Install Node.js idempotently
NODE_VER=$(curl -s http://${SDL_MGR_IP}:8081/api/config | jq -r '.nodejs.version')
NODE_DIR="${SDL_HOME}/nodejs"
NODE_BIN="${NODE_DIR}/current/bin/node"
NPM_BIN="${NODE_DIR}/current/bin/npm"

# echo "NodeJS Version: ${NODE_VER}"
# echo "NodeJS BIN version: ${NODE_BIN_VER}"
# echo "NodeJS BIN: ${NODE_BIN}"

if [ -e "${NODE_BIN}" ]; then
  NODE_BIN_VER=$(${NODE_BIN} --version)
  if [ ${NODE_BIN_VER} != "${NODE_VER}" ]; then
    install_nodejs
  fi
else
  install_nodejs
fi

# ------------------------------------------------------------
# Install sdl-mgr Node Dependencies
# ------------------------------------------------------------
echo ""
echo "Installing NodeJS Dependencies"
cd "$SDL_WKR_DIR/current/app"
export PATH="$NODE_DIR/current/bin:$PATH"
$NPM_BIN install

# Start sdl-wkr systemd service
systemctl --user daemon-reload --no-pager
systemctl --user restart sdl-wkr --no-pager
sleep 3
systemctl --user status sdl-wkr --no-pager

# systemd commands
echo ""
echo "SDL Worker deployed:"
echo ""

echo "SDL Controls:"
echo "  systemctl --user status sdl-wkr"
echo "  systemctl --user start sdl-wkr"
echo "  systemctl --user stop sdl-wkr"

echo ""
echo "Removal Commands:"
echo "  systemctl --user disable sdl-wkr"
echo "  rm -rf $SDL_HOME"
