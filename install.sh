#!/bin/bash
# yhat-mcp Install Script (Linux / macOS)
# Run as: curl -sSL https://... | bash
# Or: bash install.sh

set -e

INSTALL_DIR="${HOME}/.local/bin"
BIN_NAME="yhat-mcp"
BIN_SOURCE="$(cd "$(dirname "$0")" && pwd)/dist/cli.js"
BIN_DEST="${INSTALL_DIR}/${BIN_NAME}"

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

# Build if needed
if [ ! -f "${BIN_SOURCE}" ]; then
    echo ""
    echo "[...] dist/cli.js not found. Running npm install && npm run build:cli..."
    npm install
    npm run build:cli
fi

# Create install dir
mkdir -p "${INSTALL_DIR}"

# Copy binary
echo ""
echo "[...] Installing to ${BIN_DEST}..."
cp "${BIN_SOURCE}" "${BIN_DEST}"
chmod +x "${BIN_DEST}"

# Write version file
INSTALL_DIR="${HOME}/.local/share/yhat-mcp"
mkdir -p "${INSTALL_DIR}"
PKG_VERSION=$(node -e "console.log(require('./package.json').version)")
echo "${PKG_VERSION}" > "${INSTALL_DIR}/version.txt"

echo "[OK] Installed to ${BIN_DEST}"

# Add to PATH if needed
SHELL_RC="${HOME}/.bashrc"
if [ -f "${SHELL_RC}" ]; then
    if ! grep -q "${INSTALL_DIR}" "${SHELL_RC}"; then
        echo ""
        echo "[...] Adding ${INSTALL_DIR} to PATH in ${SHELL_RC}..."
        echo "" >> "${SHELL_RC}"
        echo "# yhat-mcp" >> "${SHELL_RC}"
        echo "export PATH=\"\${PATH}:${INSTALL_DIR}\"" >> "${SHELL_RC}"
        echo "[OK] Added to PATH. Run 'source ${SHELL_RC}' or restart your terminal."
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
