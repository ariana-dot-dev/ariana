#!/bin/bash
# Build script for moonlight-web on Linux
# Requires: Rust nightly, Node.js, npm

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Building moonlight-web from patched source ==="

# Install Rust nightly if not present
if ! rustup show | grep -q "nightly"; then
    echo "Installing Rust nightly..."
    rustup install nightly
fi
rustup default nightly

# Verify Rust version supports edition 2024
echo "Rust version: $(rustc --version)"

# Build frontend (TypeScript)
echo ""
echo "=== Building frontend (TypeScript) ==="
cd moonlight-web/web-server
npm install
npm run build
cd "$SCRIPT_DIR"

# Build Rust binaries
echo ""
echo "=== Building Rust binaries (release mode) ==="
cargo build --release --package streamer --package web-server

# Create output directory
OUTPUT_DIR="$SCRIPT_DIR/output"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/static"

# Copy binaries
echo ""
echo "=== Copying binaries to output ==="
cp target/release/streamer "$OUTPUT_DIR/"
cp target/release/web-server "$OUTPUT_DIR/"

# Copy frontend
cp -r moonlight-web/web-server/dist/* "$OUTPUT_DIR/static/"

# Make binaries executable
chmod +x "$OUTPUT_DIR/streamer"
chmod +x "$OUTPUT_DIR/web-server"

echo ""
echo "=== Build complete! ==="
echo "Output directory: $OUTPUT_DIR"
echo "  - streamer:   $(ls -lh $OUTPUT_DIR/streamer | awk '{print $5}')"
echo "  - web-server: $(ls -lh $OUTPUT_DIR/web-server | awk '{print $5}')"
echo "  - static/:    $(du -sh $OUTPUT_DIR/static | awk '{print $1}')"
