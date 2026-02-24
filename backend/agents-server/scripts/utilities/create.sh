#!/bin/bash
set -e

# Deploy script - creates a machine from the base snapshot (with all dependencies pre-installed)

# Load .env file if it exists (from parent directory)
if [ -f "$(dirname "${BASH_SOURCE[0]}")/../../.env" ]; then
    set -a
    source "$(dirname "${BASH_SOURCE[0]}")/../../.env"
    set +a
fi

# Export token for hcloud CLI
export HCLOUD_TOKEN

# Cert gateway configuration
CERT_GATEWAY_URL="https://certs.ariana.dev"
CERT_GATEWAY_KEY="${CERT_GATEWAY_KEY:-}"

# hcloud binary (can be overridden via HCLOUD_BIN env var)
HCLOUD="${HCLOUD_BIN:-hcloud}"

# Check token is set
if [ -z "$HCLOUD_TOKEN" ]; then
    echo "Error: HCLOUD_TOKEN not set"
    exit 1
fi

# Check snapshot ID is set
if [ -z "$SNAPSHOT_ID" ]; then
    echo "Error: SNAPSHOT_ID not set"
    echo "Run ./scripts/build-base.sh first to create the base image"
    exit 1
fi

# Get creator ID for machine prefixing
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREATOR_ID=$("$SCRIPT_DIR/get-creator-id.sh")

# Configuration - use creator ID + timestamp for unique server names
TIMESTAMP=$(date +%s)
RANDOM_NUMBER=$(shuf -i 1-1000000 -n 1)
SERVER_NAME="agents-server-$CREATOR_ID-$TIMESTAMP-$RANDOM_NUMBER"
SERVER_TYPE="${SERVER_TYPE:-cx43}"
LOCATION="${LOCATION:-fsn1}"

echo "Using snapshot ID: $SNAPSHOT_ID"

# Get SSH key name (from env or derive from creator ID)
SSH_KEY_NAME="${SSH_KEY_NAME:-ssh-key-$CREATOR_ID}"

# Create the server with SSH key
# Use longer poll interval to reduce API calls (default 500ms causes rate limiting)
POLL_INTERVAL="${HCLOUD_POLL_INTERVAL:-5s}"
echo "Creating server $SERVER_NAME with SSH key $SSH_KEY_NAME..."
$HCLOUD server create \
    --poll-interval "$POLL_INTERVAL" \
    --image "$SNAPSHOT_ID" \
    --name "$SERVER_NAME" \
    --type "$SERVER_TYPE" \
    --location "$LOCATION" \
    --ssh-key "$SSH_KEY_NAME"

# Get server IP
SERVER_IP=$($HCLOUD server ip $SERVER_NAME)

echo "Server created successfully!"
echo "Name: $SERVER_NAME"
echo "IP: $SERVER_IP"

# Register with cert-gateway if key is configured
MACHINE_URL=""
if [ -n "$CERT_GATEWAY_KEY" ]; then
    # Use local word list for 3-word subdomain generation
    WORDS_FILE="$SCRIPT_DIR/words.txt"

    if [ -f "$WORDS_FILE" ]; then
        WORD_COUNT=$(wc -l < "$WORDS_FILE")
        WORD1=$(sed -n "$(shuf -i 1-$WORD_COUNT -n 1)p" "$WORDS_FILE")
        WORD2=$(sed -n "$(shuf -i 1-$WORD_COUNT -n 1)p" "$WORDS_FILE")
        WORD3=$(sed -n "$(shuf -i 1-$WORD_COUNT -n 1)p" "$WORDS_FILE")
        SUBDOMAIN="${WORD1}-${WORD2}-${WORD3}"
    else
        # Fallback to timestamp-based if no word list
        SUBDOMAIN="m${TIMESTAMP}${RANDOM_NUMBER}"
    fi

    echo "Registering subdomain $SUBDOMAIN with cert-gateway..."
    REGISTER_RESPONSE=$(curl -s -X POST "$CERT_GATEWAY_URL/register" \
        -H "Content-Type: application/json" \
        -H "X-Auth-Key: $CERT_GATEWAY_KEY" \
        -d "{\"subdomain\":\"$SUBDOMAIN\",\"target_ip\":\"$SERVER_IP\",\"port\":8911,\"machine_name\":\"$SERVER_NAME\"}")

    # Extract URL from response
    MACHINE_URL=$(echo "$REGISTER_RESPONSE" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)

    if [ -n "$MACHINE_URL" ]; then
        echo "URL: $MACHINE_URL"
    else
        echo "Warning: Failed to register subdomain: $REGISTER_RESPONSE"
    fi

    # Register -desktop subdomain for moonlight-web streaming (port 8090)
    DESKTOP_SUBDOMAIN="${SUBDOMAIN}-desktop"
    echo "Registering desktop subdomain $DESKTOP_SUBDOMAIN with cert-gateway..."
    DESKTOP_REGISTER_RESPONSE=$(curl -s -X POST "$CERT_GATEWAY_URL/register" \
        -H "Content-Type: application/json" \
        -H "X-Auth-Key: $CERT_GATEWAY_KEY" \
        -d "{\"subdomain\":\"$DESKTOP_SUBDOMAIN\",\"target_ip\":\"$SERVER_IP\",\"port\":8090,\"machine_name\":\"${SERVER_NAME}-desktop\"}")

    DESKTOP_URL=$(echo "$DESKTOP_REGISTER_RESPONSE" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)

    if [ -n "$DESKTOP_URL" ]; then
        echo "DESKTOP_URL: $DESKTOP_URL"
    else
        echo "Warning: Failed to register desktop subdomain: $DESKTOP_REGISTER_RESPONSE"
    fi
else
    echo "URL: (none - CERT_GATEWAY_KEY not set)"
fi

# Wait for SSH to be ready
echo "Waiting for server to boot..."
for i in {1..30}; do
    if ssh -i "$HOME/.ssh/id_ed25519" -o ConnectTimeout=2 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@$SERVER_IP "echo 'SSH ready'" >/dev/null 2>&1; then
        echo "✅ Server is ready for connections"
        exit 0
    elif [ $i -eq 30 ]; then
        echo "❌ Server failed to become SSH-ready within 30 seconds"
        exit 1
    else
        echo "Attempt $i/30: Waiting for SSH..."
        sleep 1
    fi
done
