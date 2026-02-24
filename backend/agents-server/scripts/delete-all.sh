#!/bin/bash
set -e

# Delete all agents-server machines created by this system
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

echo "Finding all agents-server machines created by this system (creator: $CREATOR_ID)..."

# Get only servers with our creator ID
SERVERS=$(hcloud server list -o columns=name,ipv4 | tail -n +2 | grep "agents-server-$CREATOR_ID-" | awk '{print $1}')

if [ -z "$SERVERS" ]; then
    echo "No agents-server machines found."
    exit 0
fi

echo "Found the following agents-server machines:"
echo "$SERVERS"
echo ""

# Count servers
SERVER_COUNT=$(echo "$SERVERS" | wc -l)
echo "Total: $SERVER_COUNT server(s)"
echo ""

# Confirm deletion
read -p "Are you sure you want to delete ALL $SERVER_COUNT agents-server machines? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo "Deleting all agents-server machines in parallel..."

# Use longer poll interval to reduce API calls (default 500ms causes rate limiting)
export POLL_INTERVAL="${HCLOUD_POLL_INTERVAL:-5s}"

# Function to delete a server
delete_server() {
    local server_name=$1
    echo "Deleting $server_name..."
    if echo "y" | hcloud server delete --poll-interval "${POLL_INTERVAL:-5s}" "$server_name" 2>&1; then
        echo "✓ Successfully deleted $server_name"
        return 0
    else
        echo "✗ Failed to delete $server_name"
        return 1
    fi
}

# Export the function so it's available to parallel processes
export -f delete_server

# Delete servers in parallel
# Reduced parallelism to avoid rate limiting (each delete polls the API while waiting)
PARALLEL_JOBS=3
echo "$SERVERS" | xargs -P $PARALLEL_JOBS -I {} bash -c 'delete_server "$@"' _ {}

echo ""
echo "Cleanup complete!"

# Show remaining servers created by this system (should be empty)
REMAINING=$(hcloud server list -o columns=name | tail -n +2 | grep "agents-server-$CREATOR_ID-" || true)
if [ -z "$REMAINING" ]; then
    echo "All your agents-server machines have been deleted."
else
    echo "Warning: Some of your servers may still exist:"
    echo "$REMAINING"
fi