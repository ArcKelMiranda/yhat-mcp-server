#!/bin/bash
# yhat-mcp Install Script (Linux / macOS)
# Run as: bash install.sh
# Or: INSTALL_SOURCE_DIR=/path/to/package bash install.sh

set -e

APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/yhat-mcp"
BIN_DIR="${HOME}/.local/bin"
BIN_NAME="yhat-mcp"
SCRIPT_DIR="${INSTALL_SOURCE_DIR:-$(pwd)}"
CLI_SOURCE="${SCRIPT_DIR}/dist/cli.cjs"
CLI_DEST="${APP_DIR}/cli.cjs"
KEYTAR_SOURCE="${SCRIPT_DIR}/node_modules/keytar"
KEYTAR_DEST_DIR="${APP_DIR}/node_modules/keytar"

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
if [ ! -f "${CLI_SOURCE}" ]; then
    echo ""
    echo "[...] dist/cli.cjs not found. Running npm install && npm run build:cli..."
    npm install
    npm run build:cli
fi

# Create install dirs
mkdir -p "${APP_DIR}"
mkdir -p "${BIN_DIR}"

# Copy binary and native bindings
echo ""
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
    if ! grep -q "${BIN_DIR}" "${SHELL_RC}"; then
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
