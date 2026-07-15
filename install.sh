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

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed. Please install Node.js 20+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node --version)
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
RELEASE_TAG_RESOLVED="$(printf '%s' "${RELEASE_JSON}" | node -e 'const fs = require("node:fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(data.tag_name);')"
RELEASE_ARCHIVE_URL="$(printf '%s' "${RELEASE_JSON}" | node -e 'const fs = require("node:fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(data.tarball_url);')"

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
