#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
LOG_DIR="$SCRIPT_DIR/.logs"
mkdir -p "$LOG_DIR"
NPM_INSTALL_LOG="$LOG_DIR/npm-install.log"
NPM_PTY_LOG="$LOG_DIR/npm-node-pty.log"
BUILD_LOG="$LOG_DIR/build.log"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'
info()  { echo -e "${GREEN}[INFO]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET} $*"; }
error() { echo -e "${RED}[FAIL]${RESET} $*"; }
echo ""
echo "============================================================"
echo " Interactive Shell MCP - One-shot Setup (Linux/macOS)"
echo "============================================================"
echo " Working directory: $SCRIPT_DIR"
echo " Log directory:     $LOG_DIR"
echo ""
info "[1/8] Checking prerequisites..."
if ! command -v node &>/dev/null; then
    error "Node.js not found on PATH."
    echo "       Install from https://nodejs.org/ (LTS version), then re-run this script."
    exit 1
fi
NODE_VER=$(node --version)
info "Node.js:  $NODE_VER"
if ! command -v npm &>/dev/null; then
    error "npm not found on PATH."
    exit 1
fi
NPM_VER=$(npm --version)
info "npm:      $NPM_VER"
if [[ ! -f package.json ]]; then
    error "package.json not found in current folder."
    echo "       Make sure this script is inside the interactive-shell-mcp folder."
    exit 1
fi
info "package.json: found"
echo ""
info "[2/8] Cleaning previous install artifacts..."
rm -rf node_modules package-lock.json
info "Cleaned."
echo ""
info "[3/8] Installing npm dependencies (with --ignore-scripts)..."
echo "      This skips node-gyp and uses the prebuilt binaries bundled in node-pty."
echo "      Configuring npm for network resilience first..."
echo "      (fetch-timeout = 30 minutes, retries = 5)"
echo ""
npm config set fetch-timeout 1800000 2>/dev/null || true
npm config set fetch-retries 5 2>/dev/null || true
npm config set fetch-retry-mintimeout 20000 2>/dev/null || true
npm config set fetch-retry-maxtimeout 120000 2>/dev/null || true
npm config set fetch-retry-factor 2 2>/dev/null || true
INSTALL_TRIES=0
MAX_INSTALL_TRIES=3
while true; do
    INSTALL_TRIES=$((INSTALL_TRIES + 1))
    echo ""
    echo "  ---- Attempt $INSTALL_TRIES of $MAX_INSTALL_TRIES ----"
    echo "  Running: npm install --ignore-scripts --no-audit --no-fund"
    echo "  (Output is being captured to: $NPM_INSTALL_LOG)"
    echo "  (This may take several minutes. Please be patient.)"
    echo ""
    if npm install --ignore-scripts --no-audit --no-fund > "$NPM_INSTALL_LOG" 2>&1; then
        echo ""
        info "npm install succeeded."
        echo "  ---- Last 10 lines of npm output ----"
        tail -10 "$NPM_INSTALL_LOG"
        echo "  ---- End ----"
        break
    fi
    echo ""
    error "npm install FAILED on attempt $INSTALL_TRIES"
    echo "  ---- Last 30 lines of npm output ----"
    tail -30 "$NPM_INSTALL_LOG"
    echo "  ---- End of npm output ----"
    echo ""
    if [[ $INSTALL_TRIES -lt $MAX_INSTALL_TRIES ]]; then
        warn "Retrying in 10 seconds..."
        sleep 10
    else
        error "npm install failed after $MAX_INSTALL_TRIES attempts."
        echo "       Full log saved at: $NPM_INSTALL_LOG"
        echo "       Common causes:"
        echo "         1. Network connectivity issue - try a different network"
        echo "         2. npm registry issues - try a mirror:"
        echo "            npm config set registry https://registry.npmmirror.com"
        exit 1
    fi
done
echo ""
info "[4/8] Verifying node-pty loads from prebuilts..."
ARCH=$(node -e "console.log(process.platform + '-' + process.arch)")
PTY_PREBUILD="node_modules/node-pty/prebuilds/${ARCH}/pty.node"
if [[ ! -f "$PTY_PREBUILD" ]]; then
    warn "Prebuilts missing at $PTY_PREBUILD — reinstalling node-pty..."
    PTY_TRIES=0
    MAX_PTY_TRIES=3
    while [[ $PTY_TRIES -lt $MAX_PTY_TRIES ]]; do
        PTY_TRIES=$((PTY_TRIES + 1))
        echo ""
        echo "  ---- node-pty reinstall attempt $PTY_TRIES of $MAX_PTY_TRIES ----"
        rm -rf node_modules/node-pty
        if npm install node-pty --ignore-scripts --no-audit --no-fund --no-save > "$NPM_PTY_LOG" 2>&1; then
            if [[ -f "$PTY_PREBUILD" ]]; then
                break
            fi
        fi
        if [[ $PTY_TRIES -lt $MAX_PTY_TRIES ]]; then
            warn "Retrying in 5 seconds..."
            sleep 5
        else
            error "Could not install node-pty with prebuilts after $MAX_PTY_TRIES attempts."
            echo "       You may need to install build dependencies:"
            echo "         Ubuntu/Debian: sudo apt install -y build-essential python3"
            echo "         Fedora/RHEL:   sudo dnf groupinstall 'Development Tools'"
            echo "         macOS:         xcode-select --install"
            echo "       Then run: npm install (without --ignore-scripts)"
            echo "       Full log: $NPM_PTY_LOG"
            exit 1
        fi
    done
fi
info "Prebuilt found: $PTY_PREBUILD"
info "Verifying node-pty loads at runtime..."
if ! node verify-node-pty.js; then
    error "node-pty failed to load at runtime."
    echo "       This usually means the .node file is corrupt or for the wrong ABI."
    echo "       Try:"
    echo "         1. Delete node_modules/node-pty and re-run setup-and-run.sh"
    echo "         2. Check your Node.js version is LTS (e.g. v22.x)"
    exit 1
fi
echo ""
info "[5/8] Building TypeScript..."
echo "  Running: npm run build"
echo "  (Output captured to: $BUILD_LOG)"
echo ""
if ! npm run build > "$BUILD_LOG" 2>&1; then
    error "TypeScript build FAILED"
    echo "  ---- Full build output ----"
    cat "$BUILD_LOG"
    echo "  ---- End of build output ----"
    exit 1
fi
if [[ ! -f dist/src/server.js ]]; then
    error "dist/src/server.js not found after build."
    cat "$BUILD_LOG"
    exit 1
fi
info "Build OK: dist/src/server.js"
echo ""
info "[6/8] Setting up auth token..."
TOKEN_FILE="$SCRIPT_DIR/.mcp-auth-token"
MCP_HTTP_AUTH_TOKEN=$(node 4f72e6a6.js "$TOKEN_FILE")
if [[ -z "$MCP_HTTP_AUTH_TOKEN" ]]; then
    error "Token management script did not output a token."
    echo "       Run manually to diagnose: node 4f72e6a6.js \"$TOKEN_FILE\""
    exit 1
fi
if [[ ${#MCP_HTTP_AUTH_TOKEN} -lt 16 ]]; then
    error "Token is too short (<16 chars): \"$MCP_HTTP_AUTH_TOKEN\""
    echo "       Delete $TOKEN_FILE and re-run setup-and-run.sh to regenerate."
    exit 1
fi
info "Token: $MCP_HTTP_AUTH_TOKEN"
echo ""
info "[7/8] Choose how to expose the server:"
echo "  [1] Localhost only (127.0.0.1) - safe default; pair with cloudflared/Tailscale"
echo "  [2] All interfaces (0.0.0.0)    - use only on trusted LAN / Tailscale"
read -r -p "Enter 1 or 2 [default 1]: " HOST_CHOICE || HOST_CHOICE="1"
HOST_CHOICE="${HOST_CHOICE:-1}"
if [[ "$HOST_CHOICE" == "2" ]]; then
    BIND_HOST="0.0.0.0"
else
    BIND_HOST="127.0.0.1"
fi
info "Selected: $BIND_HOST"
echo ""
info "[8/8] Preparing to start MCP server..."
CF_STARTED=0
CF_PID=""
CF_LOG="$(mktemp /tmp/mcp-cloudflared.XXXXXX.log)"
if command -v cloudflared &>/dev/null; then
    echo ""
    info "cloudflared detected on PATH."
    echo "  Starting cloudflared in the background..."
    cloudflared tunnel --url http://localhost:8808 &>"$CF_LOG" &
    CF_PID=$!
    CF_STARTED=1
    sleep 3
    TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | head -1)
    if [[ -n "$TUNNEL_URL" ]]; then
        info "Tunnel URL: $TUNNEL_URL"
        echo ""
        echo "  Your AI agent uses:"
        echo "    URL:    ${TUNNEL_URL}/mcp"
        echo "    Token:  $MCP_HTTP_AUTH_TOKEN"
    else
        warn "Tunnel URL not yet available. Check $CF_LOG"
        echo "  Your AI agent uses:"
        echo "    URL:    https://<tunnel-url>/mcp"
        echo "    Token:  $MCP_HTTP_AUTH_TOKEN"
    fi
else
    echo ""
    echo "  cloudflared not found on PATH - skipping tunnel."
    echo "  To expose the server, install cloudflared and run:"
    echo "    cloudflared tunnel --url http://localhost:8808"
    echo ""
    echo "  Or use Tailscale:"
    echo "    tailscale ip -4   # get your Tailscale IP"
    echo "    node dist/src/server.js --transport http --host <tailscale-ip> --port 8808"
fi
echo ""
cleanup() {
    echo ""
    info "Shutting down..."
    if [[ "$CF_STARTED" == "1" && -n "$CF_PID" ]]; then
        info "Stopping cloudflared (PID $CF_PID)..."
        kill "$CF_PID" 2>/dev/null || true
        wait "$CF_PID" 2>/dev/null || true
    fi
    if [[ -n "${CF_LOG:-}" && -f "$CF_LOG" ]]; then
        rm -f "$CF_LOG"
    fi
    info "Server stopped (exit code ${SERVER_EXIT:-0})."
    exit "${SERVER_EXIT:-0}"
}
trap cleanup SIGINT SIGTERM
echo "============================================================"
echo " STARTING MCP SERVER"
echo "============================================================"
echo " Endpoint:  http://$BIND_HOST:8808/mcp"
echo " Token:     $MCP_HTTP_AUTH_TOKEN"
echo " Logs go to this terminal. Press Ctrl+C to stop."
echo "============================================================"
echo ""
export MCP_HTTP_AUTH_TOKEN
node dist/src/server.js --transport http --host "$BIND_HOST" --port 8808 || SERVER_EXIT=$?
SERVER_EXIT=${SERVER_EXIT:-0}
cleanup
