#!/bin/bash
# yhat-mcp installer (Linux / macOS)
# Run as: curl -fsSL https://raw.githubusercontent.com/ArcKelMiranda/yhat-mcp-server/main/install.sh | bash

set -euo pipefail

REPOSITORY="ArcKelMiranda/yhat-mcp-server"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/yhat-mcp"
BIN_DIR="${HOME}/.local/bin"
BIN_NAME="yhat-mcp"
RELEASE_TAG="${YHAT_RELEASE_TAG:-}"
TMP_ROOT=""

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

die() {
    printf '[ERROR] %s\n' "$1" >&2
    exit 1
}

python_cmd() {
    if command_exists python3; then
        printf '%s\n' python3
        return 0
    fi

    if command_exists python; then
        printf '%s\n' python
        return 0
    fi

    return 1
}

json_field() {
    local field="$1"
    local py=""

    if ! py="$(python_cmd)"; then
        die "python3 is required to parse GitHub release metadata. Install Python 3 and rerun the installer."
    fi

    RELEASE_JSON_INPUT="${RELEASE_JSON}" "$py" -c 'import json, os, sys; field = sys.argv[1]; data = json.loads(os.environ["RELEASE_JSON_INPUT"]); value = data[field]; sys.stdout.write(value if isinstance(value, str) else str(value))' "$field"
}

node_major_version() {
    local node_version="${1#v}"
    printf '%s\n' "${node_version%%.*}"
}

ensure_node_version() {
    local node_version="${1:-}"
    local node_major=""

    node_major="$(node_major_version "${node_version}")"

    if [ "${node_major}" -lt 20 ]; then
        die "Node.js ${node_version} is installed, but Node.js 20+ is required. Upgrade Node.js and rerun the installer."
    fi
}

bootstrap_node_apt() {
    echo "[...] Node.js is missing; bootstrapping Node.js 20+ via apt and NodeSource..."

    if [ "$(id -u)" -eq 0 ]; then
        apt-get update
        apt-get install -y ca-certificates curl gnupg
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
        return 0
    fi

    if ! command_exists sudo; then
        die "Node.js 20+ is required but missing. This apt-based system needs root or sudo to install it automatically. Install Node.js 20+ manually (for example via NodeSource or your distro package manager) and rerun the installer."
    fi

    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
}

bootstrap_node_dnf() {
    echo "[...] Node.js is missing; bootstrapping Node.js 20+ via dnf..."

    if [ "$(id -u)" -eq 0 ]; then
        dnf install -y nodejs
        return 0
    fi

    if ! command_exists sudo; then
        die "Node.js 20+ is required but missing. This Linux system needs root or sudo to install Node.js automatically. Install Node.js 20+ manually and rerun the installer."
    fi

    sudo dnf install -y nodejs
}

bootstrap_node_yum() {
    echo "[...] Node.js is missing; bootstrapping Node.js 20+ via yum..."

    if [ "$(id -u)" -eq 0 ]; then
        yum install -y nodejs
        return 0
    fi

    if ! command_exists sudo; then
        die "Node.js 20+ is required but missing. This Linux system needs root or sudo to install Node.js automatically. Install Node.js 20+ manually and rerun the installer."
    fi

    sudo yum install -y nodejs
}

bootstrap_node_pacman() {
    echo "[...] Node.js is missing; bootstrapping Node.js 20+ via pacman..."

    if [ "$(id -u)" -eq 0 ]; then
        pacman -Sy --noconfirm nodejs npm
        return 0
    fi

    if ! command_exists sudo; then
        die "Node.js 20+ is required but missing. This Linux system needs root or sudo to install Node.js automatically. Install Node.js 20+ manually and rerun the installer."
    fi

    sudo pacman -Sy --noconfirm nodejs npm
}

ensure_node_linux() {
    local node_version=""

    if command_exists node; then
        node_version="$(node --version)"
        ensure_node_version "${node_version}"
        return 0
    fi

    if command_exists apt-get; then
        bootstrap_node_apt
    elif command_exists dnf; then
        bootstrap_node_dnf
    elif command_exists yum; then
        bootstrap_node_yum
    elif command_exists pacman; then
        bootstrap_node_pacman
    else
        die "Node.js 20+ is required but missing, and no supported Linux package manager was found. Install Node.js 20+ manually from https://nodejs.org or using your distro's package manager, then rerun the installer."
    fi

    if ! command_exists node; then
        die "Automatic Node.js installation completed, but node is still unavailable in this shell. Restart your terminal, then rerun the installer."
    fi

    node_version="$(node --version)"
    ensure_node_version "${node_version}"
}

ensure_node_macos() {
    local node_version=""

    if command_exists node; then
        node_version="$(node --version)"
        ensure_node_version "${node_version}"
        return 0
    fi

    if ! command_exists brew; then
        die "Node.js 20+ is required but missing. Homebrew was not found, so automatic installation is unavailable on macOS. Install Node.js 20+ from https://nodejs.org or install Homebrew and rerun the installer."
    fi

    echo "[...] Node.js is missing; bootstrapping Node.js 20+ via Homebrew..."
    brew update
    brew install node

    if ! command_exists node; then
        die "Homebrew finished, but node is still unavailable in this shell. Restart your terminal, then rerun the installer."
    fi

    node_version="$(node --version)"
    ensure_node_version "${node_version}"
}

cleanup() {
    if [ -n "${TMP_ROOT}" ] && [ -d "${TMP_ROOT}" ]; then
        rm -rf "${TMP_ROOT}"
    fi
}

trap cleanup EXIT

get_release_json() {
    local url
    url="https://api.github.com/repos/${REPOSITORY}/releases/latest"
    if [ -n "${RELEASE_TAG}" ]; then
        url="https://api.github.com/repos/${REPOSITORY}/releases/tags/${RELEASE_TAG}"
    fi

    if [ -n "${GITHUB_TOKEN:-}" ]; then
        curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "User-Agent: yhat-mcp-installer" "${url}"
    else
        curl -fsSL -H "User-Agent: yhat-mcp-installer" "${url}"
    fi
}

extract_release_root() {
    local extract_dir="$1"
    local source_dir=""
    for source_dir in "${extract_dir}"/*; do
        if [ -d "${source_dir}" ]; then
            printf '%s\n' "${source_dir}"
            return 0
        fi
    done

    return 1
}

echo "=== yhat-mcp Installer ==="
echo ""

# Check Node.js or bootstrap it when missing
case "$(uname -s)" in
    Darwin)
        ensure_node_macos
        ;;
    Linux)
        ensure_node_linux
        ;;
    *)
        if ! command_exists node; then
            die "Node.js 20+ is required but missing. Install Node.js 20+ from https://nodejs.org and rerun the installer."
        fi

        NODE_VERSION="$(node --version)"
        ensure_node_version "${NODE_VERSION}"
        ;;
esac

NODE_VERSION="$(node --version)"
echo "[OK] Node.js found: ${NODE_VERSION}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm is not installed."
    exit 1
fi

TMP_ROOT="$(mktemp -d)"
SOURCE_ARCHIVE="${TMP_ROOT}/release.tar.gz"
EXTRACT_DIR="${TMP_ROOT}/source"
mkdir -p "${EXTRACT_DIR}"

echo ""
echo "[...] Resolving release archive from GitHub Releases..."
RELEASE_JSON="$(get_release_json)"
RELEASE_TAG_RESOLVED="$(json_field tag_name)"
RELEASE_ARCHIVE_URL="$(json_field tarball_url)"

echo "[...] Downloading ${RELEASE_TAG_RESOLVED}..."
if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsSL -L -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "User-Agent: yhat-mcp-installer" -o "${SOURCE_ARCHIVE}" "${RELEASE_ARCHIVE_URL}"
else
    curl -fsSL -L -H "User-Agent: yhat-mcp-installer" -o "${SOURCE_ARCHIVE}" "${RELEASE_ARCHIVE_URL}"
fi

echo "[...] Extracting and building release source..."
tar -xzf "${SOURCE_ARCHIVE}" -C "${EXTRACT_DIR}"
SOURCE_DIR="$(extract_release_root "${EXTRACT_DIR}")"

pushd "${SOURCE_DIR}" > /dev/null
npm ci
npm run build:cli
popd > /dev/null

# Create install dirs
mkdir -p "${APP_DIR}"
mkdir -p "${BIN_DIR}"

# Copy binary and native bindings
echo ""
CLI_SOURCE="${SOURCE_DIR}/dist/cli.cjs"
CLI_DEST="${APP_DIR}/cli.cjs"
KEYTAR_SOURCE="${SOURCE_DIR}/node_modules/keytar"
KEYTAR_DEST_DIR="${APP_DIR}/node_modules/keytar"

echo "[...] Installing to ${CLI_DEST}..."
cp "${CLI_SOURCE}" "${CLI_DEST}"
chmod +x "${CLI_DEST}"

if [ -d "${KEYTAR_SOURCE}" ]; then
    mkdir -p "$(dirname "${KEYTAR_DEST_DIR}")"
    cp -R "${KEYTAR_SOURCE}" "${KEYTAR_DEST_DIR}"
else
    echo "[WARN] keytar bindings not found; falling back to YHAT_DB_PASSWORD if set."
fi

cat > "${BIN_DIR}/${BIN_NAME}" <<EOF
#!/bin/sh
exec node "${CLI_DEST}" "\$@"
EOF
chmod +x "${BIN_DIR}/${BIN_NAME}"

echo "[OK] Installed to ${CLI_DEST}"

# Add to PATH if needed
case "${SHELL:-}" in
    */zsh)
        SHELL_RC="${HOME}/.zshrc"
        PATH_LINE="export PATH=\"\${PATH}:${BIN_DIR}\""
        ;;
    */fish)
        SHELL_RC="${HOME}/.config/fish/config.fish"
        PATH_LINE="set -gx PATH ${BIN_DIR} \$PATH"
        ;;
    *)
        SHELL_RC="${HOME}/.bashrc"
        PATH_LINE="export PATH=\"\${PATH}:${BIN_DIR}\""
        ;;
esac

mkdir -p "$(dirname "${SHELL_RC}")"
if [ -f "${SHELL_RC}" ]; then
    if ! grep -Fq "${BIN_DIR}" "${SHELL_RC}"; then
        echo ""
        echo "[...] Adding ${BIN_DIR} to PATH in ${SHELL_RC}..."
        echo "" >> "${SHELL_RC}"
        echo "# yhat-mcp" >> "${SHELL_RC}"
        echo "${PATH_LINE}" >> "${SHELL_RC}"
        echo "[OK] Added to PATH. Restart your terminal or source ${SHELL_RC}."
    fi
fi

echo ""
echo "=== Installation complete! ==="
echo ""
echo "Run the setup wizard:"
echo "  ${BIN_NAME} setup"
echo ""
echo "Other commands:"
echo "  ${BIN_NAME} install   - Add to OpenCode config"
echo "  ${BIN_NAME} config   - Edit whitelist"
echo "  ${BIN_NAME} start    - Start the server"
echo "  ${BIN_NAME} update   - Check for updates"
echo ""
