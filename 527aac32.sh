#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'
info()  { echo -e "${GREEN}[INFO]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET} $*"; }
error() { echo -e "${RED}[FAIL]${RESET} $*"; }
echo ""
echo "============================================================"
echo " Interactive Shell MCP - Run Only (Linux/macOS)"
echo "============================================================"
echo " Working directory: $SCRIPT_DIR"
echo ""
info "[1/4] Verifying previously-built artifacts..."
if ! command -v node &>/dev/null; then
    error "Node.js not found on PATH."
    echo "       Install from https://nodejs.org/ (LTS version)."
    exit 1
fi
NODE_VER=$(node --version)
info "Node.js:  $NODE_VER"
if [[ ! -f package.json ]]; then
    error "package.json not found in current folder."
    echo "       Make sure this script is inside the interactive-shell-mcp folder."
    exit 1
fi
info "package.json: found"
if [[ ! -d node_modules ]]; then
    error "node_modules folder missing."
    echo "       You must run setup-and-run.sh first to install dependencies."
    exit 1
fi
info "node_modules: found"
ARCH=$(node -e "console.log(process.platform + '-' + process.arch)")
PTY_PREBUILD="node_modules/node-pty/prebuilds/${ARCH}/pty.node"
if [[ ! -f "$PTY_PREBUILD" ]]; then
    error "node-pty prebuilt binary missing at $PTY_PREBUILD"
    echo "       node_modules is incomplete. Re-run setup-and-run.sh to repair."
    exit 1
fi
info "node-pty prebuilt: found ($PTY_PREBUILD)"
if [[ ! -f dist/src/server.js ]]; then
    error "dist/src/server.js missing."
    echo "       Build output not found. Re-run setup-and-run.sh to rebuild."
    exit 1
fi
info "dist/src/server.js: found"
echo ""
info "[2/4] Loading auth token..."
TOKEN_FILE="$SCRIPT_DIR/.mcp-auth-token"
if [[ ! -f "$TOKEN_FILE" ]]; then
    error "Token file not found: $TOKEN_FILE"
    echo "       Run setup-and-run.sh first to generate one."
    exit 1
fi
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
info "[3/4] Choose how to expose the server:"
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
info "[4/4] Preparing to start MCP server..."
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
    echo "  If you want to expose the server, install cloudflared and run:"
    echo "    cloudflared tunnel --url http://localhost:8808"
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
