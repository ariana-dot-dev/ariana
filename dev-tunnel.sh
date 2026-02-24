#!/bin/bash
# Start a tunnel to expose local backend to Hetzner machines
# Sources TUNNEL_URL variable for use by caller
# Usage: source ./dev-tunnel.sh

PORT=${1:-3000}
TUNNEL_LOG="/tmp/cloudflared-tunnel-$$.log"

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "cloudflared not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install cloudflared
    elif command -v apt &> /dev/null; then
        curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
        sudo dpkg -i /tmp/cloudflared.deb
    else
        curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
        chmod +x /tmp/cloudflared
        sudo mv /tmp/cloudflared /usr/local/bin/
    fi
fi

# Kill any existing tunnel
pkill -f "cloudflared tunnel" 2>/dev/null || true

echo "Starting tunnel to localhost:$PORT..."

# Start tunnel in background
cloudflared tunnel --url http://localhost:$PORT 2>&1 | tee "$TUNNEL_LOG" &
TUNNEL_PID=$!

# Wait for tunnel URL
echo "Waiting for tunnel URL..."
export TUNNEL_URL=""
for i in {1..30}; do
    sleep 1
    TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
done

if [ -z "$TUNNEL_URL" ]; then
    echo "Failed to get tunnel URL"
    cat "$TUNNEL_LOG"
    exit 1
fi

echo ""
echo "================================================"
echo "Tunnel URL: $TUNNEL_URL"
echo "================================================"
echo ""

# Export for caller
export TUNNEL_URL
export TUNNEL_PID
