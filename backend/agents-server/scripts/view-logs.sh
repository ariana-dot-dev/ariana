#!/bin/bash

# View logs from agents-server
# Run this from your dev machine where you have hcloud logged in

# Load .env file if it exists (from parent directory)
if [ -f "$(dirname "${BASH_SOURCE[0]}")/../.env" ]; then
    set -a
    source "$(dirname "${BASH_SOURCE[0]}")/../.env"
    set +a
fi

# Get creator ID for filtering machines
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREATOR_ID=$("$SCRIPT_DIR/utilities/get-creator-id.sh")

# Usage examples:
# ./view-logs.sh                          # Auto-find most recent server, show 1000 lines
# ./view-logs.sh agents-server-1234567890 # Use specific server name  
# ./view-logs.sh 142.132.183.208          # Use specific IP
# ./view-logs.sh agents-server-1234567890 200 # Show 200 lines
# ./view-logs.sh agents-server-1234567890 100 --follow # Follow logs
# ./view-logs.sh agents-server-1234567890 100 --head # Show first 100 lines

LINES="${2:-1000}"
MODE="${3:-}"

# Determine target server
if [ -n "$1" ]; then
    if [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        # Argument is an IP address
        SERVER_IP="$1"
        echo "Using provided IP: $SERVER_IP"
    else
        # Argument is a server name
        SERVER_NAME="$1"
        echo "Using provided server name: $SERVER_NAME"
        SERVER_IP=$(hcloud server ip "$SERVER_NAME" 2>/dev/null)
        if [ -z "$SERVER_IP" ]; then
            echo "Error: Server '$SERVER_NAME' not found"
            exit 1
        fi
        echo "Server IP: $SERVER_IP"
    fi
else
    # Auto-find most recent agents-server with our creator ID (sort by name to get highest timestamp)
    echo "Auto-finding most recent agents-server for creator $CREATOR_ID..."
    SERVER_INFO=$(hcloud server list -o columns=name,ipv4 | tail -n +2 | grep "agents-server-$CREATOR_ID-" | sort -r | head -1)
    if [ -z "$SERVER_INFO" ]; then
        echo "Error: No agents-server found. Create one first with ./scripts/utilities/create.sh"
        exit 1
    fi
    SERVER_NAME=$(echo "$SERVER_INFO" | awk '{print $1}')
    SERVER_IP=$(echo "$SERVER_INFO" | awk '{print $2}')
    echo "Found server: $SERVER_NAME ($SERVER_IP)"
fi

echo "Connecting to $SERVER_IP..."

if [ "$MODE" == "--follow" ] || [ "$MODE" == "-f" ]; then
    ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@$SERVER_IP "journalctl -u ariana-agent -n $LINES -f --no-pager"
elif [ "$MODE" == "--head" ] || [ "$MODE" == "-h" ]; then
    ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@$SERVER_IP "journalctl -u ariana-agent -n $LINES --no-pager | head -n $LINES"
else
    ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@$SERVER_IP "journalctl -u ariana-agent -n $LINES --no-pager"
fi