#!/bin/bash
set -e

# Add bin to PATH for packer access
export PATH="$HOME/bin:$PATH"

# Load .env file if it exists (from parent directory)
if [ -f "$(dirname "${BASH_SOURCE[0]}")/../.env" ]; then
    set -a
    source "$(dirname "${BASH_SOURCE[0]}")/../.env"
    set +a
fi

# Check if token is provided
if [ -z "$HCLOUD_TOKEN" ]; then
    echo "Error: HCLOUD_TOKEN environment variable not set"
    exit 1
fi

echo "Building base image with all dependencies..."
echo "This runs install-all-deps.sh."
echo "Takes ~30-45 minutes but only needs to be done once or when dependencies change."
echo ""

# Change to agents-server directory
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Verify moonlight-fork exists
if [ ! -d "../../moonlight-fork" ]; then
    echo "Error: moonlight-fork not found at ../../moonlight-fork"
    echo "Make sure you're on a branch that has the moonlight-fork directory"
    exit 1
fi

echo "Using moonlight-fork from ../../moonlight-fork"

# Initialize and build base image
packer init base-image.pkr.hcl
packer build -var "hcloud_token=$HCLOUD_TOKEN" base-image.pkr.hcl

# Get the snapshot ID
echo ""
echo "Base image built! Getting snapshot ID..."
SNAPSHOT_ID=$(hcloud image list --type=snapshot --selector=type=base -o noheader | tail -1 | awk '{print $1}')

echo ""
echo "=========================================="
echo "  SNAPSHOT_ID=$SNAPSHOT_ID"
echo "=========================================="
echo ""
echo "Save this ID to your .env file to use when creating machines."
