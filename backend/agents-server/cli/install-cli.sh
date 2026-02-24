#!/bin/bash
set -e

# Ariana CLI Installation Script
# This script downloads and installs the Ariana CLI

CLI_VERSION="${CLI_VERSION:-latest}"
GITHUB_REPO="ariana-dot-dev/agent-server"
INSTALL_PATH="/usr/local/bin/ariana"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_error() {
  echo -e "${RED}❌ Error: $1${NC}" >&2
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  print_warning "This script requires sudo/root access"
  echo "Attempting to re-run with sudo..."
  exec sudo bash "$0" "$@"
fi

print_info "Installing Ariana CLI..."

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)  OS_TYPE="linux" ;;
  Darwin*) OS_TYPE="darwin" ;;
  *)
    print_error "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64)  ARCH_TYPE="x64" ;;
  aarch64|arm64) ARCH_TYPE="arm64" ;;
  *)
    print_error "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

PLATFORM="${OS_TYPE}-${ARCH_TYPE}"
print_info "Detected platform: $PLATFORM"

# Determine download URL
if [ "$CLI_VERSION" = "latest" ]; then
  RELEASE_URL="https://github.com/$GITHUB_REPO/releases/latest/download"
else
  RELEASE_URL="https://github.com/$GITHUB_REPO/releases/download/cli-v${CLI_VERSION}"
fi

BINARY_NAME="ariana-cli-${PLATFORM}"
DOWNLOAD_URL="${RELEASE_URL}/${BINARY_NAME}"

print_info "Downloading from: $DOWNLOAD_URL"

# Download binary
TEMP_FILE=$(mktemp)
if ! curl -L --fail --progress-bar "$DOWNLOAD_URL" -o "$TEMP_FILE"; then
  print_error "Failed to download Ariana CLI"
  rm -f "$TEMP_FILE"
  exit 1
fi

# Install binary
mv "$TEMP_FILE" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"

print_success "Ariana CLI installed to $INSTALL_PATH"

# Verify installation
if command -v ariana &> /dev/null; then
  print_success "Installation verified!"
  ariana version
else
  print_warning "CLI installed but not in PATH"
  print_info "You may need to add $INSTALL_PATH to your PATH"
fi

echo ""
print_info "Get started with: ariana help"
echo ""

# If token provided, install and connect agent server immediately
if [ -n "$1" ]; then
  print_info "Token provided, installing and connecting agent server..."
  ariana connect --token "$1"
fi
