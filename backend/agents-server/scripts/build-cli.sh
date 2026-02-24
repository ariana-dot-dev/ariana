#!/bin/bash
set -e

# Build Ariana CLI for all platforms

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
CLI_DIR="$PROJECT_ROOT/cli"
OUTPUT_DIR="$PROJECT_ROOT/dist-cli"

echo "🔨 Building Ariana CLI for all platforms..."
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Clean previous builds
rm -rf "$OUTPUT_DIR"/*

cd "$CLI_DIR"

# Build for each platform
PLATFORMS=(
  "linux-x64"
  "linux-arm64"
  "darwin-x64"
  "darwin-arm64"
)

for platform in "${PLATFORMS[@]}"; do
  echo "Building for $platform..."

  # Extract OS and architecture
  IFS='-' read -r os arch <<< "$platform"

  # Determine Bun target
  case "$os-$arch" in
    linux-x64)     target="bun-linux-x64" ;;
    linux-arm64)   target="bun-linux-arm64" ;;
    darwin-x64)    target="bun-darwin-x64" ;;
    darwin-arm64)  target="bun-darwin-arm64" ;;
    *)
      echo "⚠️  Unknown platform: $platform"
      continue
      ;;
  esac

  # Build
  output_file="$OUTPUT_DIR/ariana-cli-$platform"

  bun build cli.ts \
    --compile \
    --target="$target" \
    --outfile="$output_file"

  if [ $? -eq 0 ]; then
    echo "✅ Built: $output_file"
    # Show file size
    size=$(ls -lh "$output_file" | awk '{print $5}')
    echo "   Size: $size"
  else
    echo "❌ Failed to build for $platform"
    exit 1
  fi

  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All CLI binaries built successfully!"
echo ""
echo "Output directory: $OUTPUT_DIR"
echo ""
ls -lh "$OUTPUT_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
