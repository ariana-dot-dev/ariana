#!/bin/bash
set -e

# Find agents-server machine(s) by name pattern (only machines created by this system)
# Run this from your dev machine where you have hcloud logged in

# Load .env file if it exists
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Get creator ID for filtering machines
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREATOR_ID=$("$SCRIPT_DIR/get-creator-id.sh")

# Usage examples:
# ./find-machine.sh                      # List all agents-server machines
# ./find-machine.sh agents-server-123    # Find machines matching pattern
# ./find-machine.sh 91.99.181.88         # Find machine by IP

SEARCH_PATTERN="${1:-}"

if [ -z "$SEARCH_PATTERN" ]; then
    # No search pattern - list all agents-server machines created by this system
    echo "All your agents-server machines (creator: $CREATOR_ID):"
    echo ""

    # Single API call - capture full output and split header/body locally
    FULL_OUTPUT=$(hcloud server list -o columns=name,status,ipv4,datacenter,age)
    HEADER=$(echo "$FULL_OUTPUT" | head -1)
    SERVERS=$(echo "$FULL_OUTPUT" | tail -n +2 | grep "agents-server-$CREATOR_ID-" || true)

    echo "$HEADER"

    if [ -z "$SERVERS" ]; then
        echo "No agents-server machines found."
        exit 0
    fi

    echo "$SERVERS"
    echo ""

    # Count and summary
    SERVER_COUNT=$(echo "$SERVERS" | wc -l)
    echo "Total: $SERVER_COUNT agents-server machine(s)"
    
else
    # Search for specific pattern
    echo "Searching for agents-server machines matching: '$SEARCH_PATTERN'"
    echo ""

    # Single API call - capture full output and filter locally
    FULL_OUTPUT=$(hcloud server list -o columns=name,status,ipv4,datacenter,age)
    HEADER=$(echo "$FULL_OUTPUT" | head -1)
    ALL_OUR_SERVERS=$(echo "$FULL_OUTPUT" | tail -n +2 | grep "agents-server-$CREATOR_ID-" || true)

    # Check if search pattern is an IP address
    if [[ "$SEARCH_PATTERN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Searching by IP address..."
    else
        echo "Searching by name pattern..."
    fi

    echo "$HEADER"
    SERVERS=$(echo "$ALL_OUR_SERVERS" | grep "$SEARCH_PATTERN" || true)

    if [ -z "$SERVERS" ]; then
        echo "No agents-server machines found matching '$SEARCH_PATTERN'."
        echo ""
        echo "All available agents-server machines:"
        if [ -z "$ALL_OUR_SERVERS" ]; then
            echo "  No agents-server machines found."
        else
            echo "$ALL_OUR_SERVERS"
        fi
        exit 0
    fi
    
    echo "$SERVERS"
    echo ""
    
    # Count and summary  
    SERVER_COUNT=$(echo "$SERVERS" | wc -l)
    echo "Found: $SERVER_COUNT matching agents-server machine(s)"
    
    # If only one match, show additional details
    if [ "$SERVER_COUNT" -eq 1 ]; then
        SERVER_NAME=$(echo "$SERVERS" | awk '{print $1}')
        SERVER_IP=$(echo "$SERVERS" | awk '{print $3}')
        
        echo ""
        echo "Machine details:"
        echo "  Name: $SERVER_NAME"
        echo "  IP: $SERVER_IP"
        echo ""
        echo "Quick commands for this machine:"
        echo "  View logs: ./view-logs.sh $SERVER_NAME"
        echo "  Sync code: ./sync-dev.sh $SERVER_NAME" 
        echo "  Delete: ./delete-machine.sh $SERVER_NAME"
        echo "  SSH: ssh root@$SERVER_IP"
        echo "  Health check: curl http://$SERVER_IP:8911/health"
    fi
fi