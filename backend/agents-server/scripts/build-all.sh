#!/bin/bash
set -e

# Build standalone agent server binaries for all platforms

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_ROOT/dist-binaries"

# Build mode: local (current platform only) or all (all platforms)
BUILD_MODE="${1:-local}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Building Ariana Agents Server - Standalone Binaries"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Mode: $BUILD_MODE"
echo ""

if ! command -v bun &> /dev/null; then
  echo "Error: bun not found. Please install Bun:"
  echo "   https://bun.sh/install"
  exit 1
fi

mkdir -p "$DIST_DIR"

# Function to get bun target for platform
# Using baseline for linux-x64 to support older CPUs (Hetzner VMs use baseline)
get_bun_target() {
  case "$1" in
    linux-x64) echo "bun-linux-x64-baseline" ;;
    linux-arm64) echo "bun-linux-arm64" ;;
    darwin-x64) echo "bun-darwin-x64" ;;
    darwin-arm64) echo "bun-darwin-arm64" ;;
    *) echo "" ;;
  esac
}

# Determine which platforms to build
if [ "$BUILD_MODE" = "local" ]; then
  CURRENT_OS="$(uname -s)"
  CURRENT_ARCH="$(uname -m)"

  if [ "$CURRENT_OS" = "Darwin" ]; then
    if [ "$CURRENT_ARCH" = "arm64" ]; then
      PLATFORMS="darwin-arm64 darwin-x64"
    else
      PLATFORMS="darwin-x64"
    fi
  elif [ "$CURRENT_OS" = "Linux" ]; then
    if [ "$CURRENT_ARCH" = "x86_64" ]; then
      PLATFORMS="linux-x64"
    elif [ "$CURRENT_ARCH" = "aarch64" ]; then
      PLATFORMS="linux-arm64"
    fi
  else
    echo "Unsupported platform: $CURRENT_OS-$CURRENT_ARCH"
    exit 1
  fi

  echo "Local build mode - building for: $PLATFORMS"
else
  PLATFORMS="linux-x64 linux-arm64 darwin-x64 darwin-arm64"
  echo "Full build mode - building for all platforms"
fi

echo ""

# Install Dependencies
echo "━━━ Installing Dependencies ━━━"
echo ""

cd "$PROJECT_ROOT"

if [ ! -d "node_modules" ] || [ ! -f "bun.lockb" ]; then
  echo "Running bun install..."
  bun install
else
  echo "Dependencies already installed"
fi

echo ""

# Compile Agent Server Binaries
echo "━━━ Compiling Agent Server Binaries ━━━"
echo ""

for platform in $PLATFORMS; do
  bun_target=$(get_bun_target "$platform")
  outfile="$DIST_DIR/ariana-agents-server-$platform"

  echo "Compiling for $platform..."
  echo "   Target: $bun_target"

  if bun build src/index.ts \
    --compile \
    --target="$bun_target" \
    --outfile="$outfile" \
    --minify \
    --sourcemap=none; then

    SIZE=$(du -h "$outfile" | cut -f1)
    echo "   Done: $outfile ($SIZE)"
  else
    echo "   Compilation failed for $platform"
  fi

  echo ""
done

# Copy Ariana CLI and skill (runs via bun, not compiled)
echo "━━━ Copying Ariana CLI & Skill ━━━"
echo ""

cp "$PROJECT_ROOT/src/ariana-cli/index.ts" "$DIST_DIR/ariana-cli.ts"
echo "Copied ariana-cli/index.ts -> ariana-cli.ts"

cp "$PROJECT_ROOT/src/ariana-skill/SKILL.md" "$DIST_DIR/ariana-skill.md"
echo "Copied ariana-skill/SKILL.md -> ariana-skill.md"
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Build Complete!"
echo ""

if [ -d "$DIST_DIR" ] && [ "$(ls -A "$DIST_DIR" 2>/dev/null)" ]; then
  echo "Standalone binaries in $DIST_DIR:"
  ls -lh "$DIST_DIR"/ariana-agents-server-* 2>/dev/null || true
  echo ""
  echo "Ariana CLI & Skill:"
  ls -lh "$DIST_DIR"/ariana-cli.ts 2>/dev/null || true
  ls -lh "$DIST_DIR"/ariana-skill.md 2>/dev/null || true
  echo ""
  echo "Each binary includes:"
  echo "  - Agent server code (TypeScript compiled)"
  echo "  - All npm dependencies"
  echo "  - Bun runtime"
  echo ""
  echo "Ariana CLI (ariana-cli.ts):"
  echo "  - Runs via 'bun run' at runtime (not compiled)"
  echo "  - Deployed to /home/ariana/.ariana/ariana on agent machines"
else
  echo "No binaries were built."
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
