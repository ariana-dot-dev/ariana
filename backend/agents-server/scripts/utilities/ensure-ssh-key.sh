#!/bin/bash
set -e

# Ensure SSH key exists and is uploaded to Hetzner
# This script runs once at startup to avoid race conditions

# Load .env file if it exists (from parent directory)
if [ -f "$(dirname "${BASH_SOURCE[0]}")/../../.env" ]; then
    set -a
    source "$(dirname "${BASH_SOURCE[0]}")/../../.env"
    set +a
fi

# Export token for hcloud CLI
export HCLOUD_TOKEN

# hcloud binary (can be overridden via HCLOUD_BIN env var)
HCLOUD="${HCLOUD_BIN:-hcloud}"

# Check token is set
if [ -z "$HCLOUD_TOKEN" ]; then
    echo "Error: HCLOUD_TOKEN not set"
    exit 1
fi

# Get creator ID for machine naming
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREATOR_ID=$("$SCRIPT_DIR/get-creator-id.sh")

# SSH key name can be overridden via environment variable
# This allows using different Hetzner SSH key names while keeping local SSH keys unchanged
SSH_KEY_NAME="${SSH_KEY_NAME:-ssh-key-$CREATOR_ID}"

echo "Ensuring SSH key '$SSH_KEY_NAME' exists in Hetzner..."
echo "(Creator ID: $CREATOR_ID, SSH key name can differ via SSH_KEY_NAME env var)"

# Check for SSH keys from environment variables
SSH_DIR="$HOME/.ssh"
mkdir -p "$SSH_DIR"

if [ -n "$SSH_PUBLIC_KEY" ] && [ -n "$SSH_PRIVATE_KEY" ]; then
    echo "Using SSH keys from environment variables..."
    echo "$SSH_PUBLIC_KEY" > "$SSH_DIR/id_ed25519.pub"
    echo "$SSH_PRIVATE_KEY" > "$SSH_DIR/id_ed25519"
    chmod 644 "$SSH_DIR/id_ed25519.pub"
    chmod 600 "$SSH_DIR/id_ed25519"
    SSH_KEY_FILE="$SSH_DIR/id_ed25519.pub"
elif [ -f "$SSH_DIR/id_ed25519.pub" ] && [ -f "$SSH_DIR/id_ed25519" ]; then
    echo "Using existing ed25519 SSH key..."
    SSH_KEY_FILE="$SSH_DIR/id_ed25519.pub"
elif [ -f "$SSH_DIR/id_rsa.pub" ] && [ -f "$SSH_DIR/id_rsa" ]; then
    echo "Using existing RSA SSH key..."
    SSH_KEY_FILE="$SSH_DIR/id_rsa.pub"
else
    echo "No SSH key found. Set SSH_PUBLIC_KEY and SSH_PRIVATE_KEY in .env file"
    exit 1
fi

# Check if key already exists in Hetzner
EXISTING_KEY=$($HCLOUD ssh-key list -o columns=name | grep "^$SSH_KEY_NAME$" || true)

# Use longer poll interval to reduce API calls (default 500ms causes rate limiting)
POLL_INTERVAL="${HCLOUD_POLL_INTERVAL:-5s}"

if [ -z "$EXISTING_KEY" ]; then
    echo "Uploading SSH key to Hetzner as '$SSH_KEY_NAME'..."
    CREATE_OUTPUT=$($HCLOUD ssh-key create --poll-interval "$POLL_INTERVAL" --name "$SSH_KEY_NAME" --public-key-from-file "$SSH_KEY_FILE" 2>&1) || {
        # Check if it's a uniqueness error (key already exists with different name)
        if echo "$CREATE_OUTPUT" | grep -q "uniqueness_error"; then
            echo "SSH key already exists in Hetzner (same fingerprint, possibly different name) - this is OK"
        else
            echo "Key upload failed, trying to delete and recreate..."
            $HCLOUD ssh-key delete "$SSH_KEY_NAME" 2>/dev/null || true
            $HCLOUD ssh-key create --poll-interval "$POLL_INTERVAL" --name "$SSH_KEY_NAME" --public-key-from-file "$SSH_KEY_FILE"
        fi
    }
    echo "SSH key uploaded successfully"
else
    echo "SSH key '$SSH_KEY_NAME' already exists in Hetzner"
fi

echo "SSH key setup complete: $SSH_KEY_NAME"

# Verify the keys are actually there
echo "Verifying SSH keys are in place:"
ls -la "$SSH_DIR/id_ed25519" 2>/dev/null && echo "✓ Private key exists" || echo "✗ Private key missing"
ls -la "$SSH_DIR/id_ed25519.pub" 2>/dev/null && echo "✓ Public key exists" || echo "✗ Public key missing"