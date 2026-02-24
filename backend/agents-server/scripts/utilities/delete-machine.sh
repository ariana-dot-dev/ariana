#!/bin/bash
set -e

# Delete a specific agents-server machine
# Run this from your dev machine where you have hcloud logged in

# Load .env file if it exists
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Cert gateway configuration
CERT_GATEWAY_URL="https://certs.ariana.dev"
CERT_GATEWAY_KEY="${CERT_GATEWAY_KEY:-}"

# Usage examples:
# ./delete-machine.sh agents-server-1234567890  # Delete by server name
# ./delete-machine.sh 91.99.181.88              # Delete by IP address

if [ -z "$1" ]; then
    echo "Usage: $0 <server-name-or-ip>"
    echo ""
    echo "Examples:"
    echo "  $0 agents-server-1234567890  # Delete by server name"
    echo "  $0 91.99.181.88              # Delete by IP address"
    echo ""
    echo "Available agents-server machines:"
    hcloud server list -o columns=name,ipv4 | tail -n +2 | grep "agents-server" || echo "  No agents-server machines found."
    exit 1
fi

SERVER_NAME=""

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

echo ""
echo "Server details:"
echo "  Name: $SERVER_NAME"
echo "  IP: $SERVER_IP"
echo ""

# Proceed with deletion without confirmation
echo "Proceeding with deletion..."

# Use longer poll interval to reduce API calls (default 500ms causes rate limiting)
POLL_INTERVAL="${HCLOUD_POLL_INTERVAL:-5s}"
echo "Deleting server '$SERVER_NAME'..."

# Unregister from cert-gateway if key is configured (using machine_name)
if [ -n "$CERT_GATEWAY_KEY" ] && [ -n "$SERVER_NAME" ]; then
    echo "Unregistering machine $SERVER_NAME from cert-gateway..."
    curl -s -X POST "$CERT_GATEWAY_URL/unregister" \
        -H "Content-Type: application/json" \
        -H "X-Auth-Key: $CERT_GATEWAY_KEY" \
        -d "{\"machine_name\":\"$SERVER_NAME\"}" > /dev/null || echo "Warning: Failed to unregister from cert-gateway"
    # Also unregister the desktop subdomain
    curl -s -X POST "$CERT_GATEWAY_URL/unregister" \
        -H "Content-Type: application/json" \
        -H "X-Auth-Key: $CERT_GATEWAY_KEY" \
        -d "{\"machine_name\":\"${SERVER_NAME}-desktop\"}" > /dev/null || echo "Warning: Failed to unregister desktop from cert-gateway"
fi

if echo "y" | hcloud server delete --poll-interval "$POLL_INTERVAL" "$SERVER_NAME"; then
    echo "Successfully deleted server '$SERVER_NAME'"
else
    echo "Failed to delete server '$SERVER_NAME'"
    exit 1
fi

echo ""
echo "Server '$SERVER_NAME' has been deleted."